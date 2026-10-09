"""Tests for the party challenge (party.py).

Run from the project root:  python3 -m unittest discover -s tests -p 'test_*.py'

Every call goes through a JSON round trip first, the way the hub stores the
party in its world document between requests.
"""
import copy
import json
import random
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import party  # noqa: E402
from party import PartyError  # noqa: E402

A, B = 'alice', 'bob~2'
T0 = 1_800_000_000_000
OPS = {'+': lambda a, b: a + b, '-': lambda a, b: a - b, '*': lambda a, b: a * b, '/': lambda a, b: a // b}


def walk(value, skip=()):
  """Yield (key, value) for every node of a JSON-able value, skipping subtrees under `skip` keys."""
  if isinstance(value, dict):
    for k, v in value.items():
      if k in skip:
        continue
      yield k, v
      yield from walk(v, skip)
  elif isinstance(value, list):
    for v in value:
      yield None, v
      yield from walk(v, skip)


class PartyCase(unittest.TestCase):
  seed = 7

  def setUp(self):
    self.rng = random.Random(self.seed)
    self.t = T0
    self.p = party.new_party('party-1', A, B, {A: 'Alice', B: 'Bob'}, self.t, self.rng)

  # --- driving the party ---------------------------------------------------------------------------

  def roundtrip(self):
    self.p = json.loads(json.dumps(self.p))

  def tick(self):
    self.roundtrip()
    return party.tick(self.p, self.t, self.rng)

  def at(self, t):
    self.t = t
    return self.tick()

  def wait(self, ms):
    return self.at(self.t + ms)

  def act(self, pid, kind, **fields):
    self.roundtrip()
    party.apply_action(self.p, pid, {'type': kind, **fields}, self.t, self.rng)

  def refused(self, pid, kind, **fields):
    with self.assertRaises(PartyError) as err:
      self.act(pid, kind, **fields)
    self.assertTrue(str(err.exception))
    return str(err.exception)

  def view(self, pid):
    return party.public_view(self.p, pid, self.t)

  def game(self):
    return self.p['game']

  def go_at(self):
    return self.p['secret']['go_at']

  def to_quickdraw(self):
    self.act(A, 'ready')
    self.act(B, 'ready')
    self.assertEqual((self.p['phase'], self.game()['kind'], self.game()['stage']), ('play', 'quickdraw', 'armed'))

  def win_quickdraw(self, winner=A):
    if self.p['phase'] == 'intro':
      self.to_quickdraw()
    self.at(self.go_at())
    self.t += 300
    self.act(winner, 'draw', ms=200)
    self.act(A if winner == B else B, 'draw', ms=400)
    self.assertEqual(self.p['phase'], 'result')

  def to_rps(self):
    self.win_quickdraw()
    self.wait(party.RESULT_MS)
    self.assertEqual((self.p['phase'], self.game()['kind'], self.game()['stage']), ('play', 'rps', 'choose'))

  def pick(self, a_choice, b_choice):
    self.act(A, 'rps', choice=a_choice)
    self.act(B, 'rps', choice=b_choice)

  def win_rps(self, winner=A):
    loser = A if winner == B else B
    for _ in range(2):
      self.act(winner, 'rps', choice='rock')
      self.act(loser, 'rps', choice='scissors')
      self.wait(party.RPS_REVEAL_MS)
    self.assertEqual(self.p['phase'], 'result')

  def to_sprint(self):
    self.to_rps()
    self.win_rps()
    self.wait(party.RESULT_MS)
    self.assertEqual((self.p['phase'], self.game()['kind'], self.game()['stage']), ('play', 'sprint', 'countdown'))

  def answer_for(self, pid):
    problem = self.view(pid)['game']['problem']
    return problem['index'], OPS[problem['op']](problem['a'], problem['b'])

  def solve(self, pid):
    index, value = self.answer_for(pid)
    self.act(pid, 'answer', index=index, value=value)


class HappyPathTests(PartyCase):
  def test_a_full_party_from_intro_to_closing(self):
    v = self.view(A)
    self.assertEqual((v['phase'], v['deadline'], v['me'], v['opponent']), ('intro', T0 + party.INTRO_MS, A, B))
    self.assertEqual(v['games'], ['quickdraw', 'rps', 'sprint'])
    self.assertEqual(v['names'], {A: 'Alice', B: 'Bob'})
    self.assertEqual(v['wake_at'], v['deadline'])

    # 1. Quick Draw: the intro runs out, the duel is armed, DRAW, Alice is quicker.
    self.at(T0 + party.INTRO_MS)
    self.assertEqual((self.p['phase'], self.game()['kind']), ('play', 'quickdraw'))
    go_at = self.go_at()
    lo, hi = party.QD_DELAY_MS
    self.assertTrue(self.t + lo <= go_at <= self.t + hi)
    self.assertEqual(self.view(A)['game']['window'], [self.t + lo, self.t + hi])
    self.assertTrue(self.at(go_at))
    self.t += 250
    self.act(A, 'draw', ms=212)
    self.act(B, 'draw', ms=287)
    v = self.view(B)
    self.assertEqual((v['phase'], v['scores']), ('result', {A: 1, B: 0}))
    self.assertEqual((v['results'][0]['game'], v['results'][0]['winner'], v['results'][0]['reason']),
                     ('quickdraw', A, 'faster'))
    self.assertEqual(v['results'][0]['duels'][0]['presses'][B], {'outcome': 'valid', 'ms': 287})
    self.assertEqual(v['deadline'], self.t + party.RESULT_MS)

    # 2. Rock-Paper-Scissors: Alice takes two rounds.
    self.wait(party.RESULT_MS)
    g = self.view(A)['game']
    self.assertEqual((g['kind'], g['round'], g['stage'], g['deadline']), ('rps', 1, 'choose', self.t + party.RPS_ROUND_MS))
    self.pick('rock', 'scissors')
    g = self.view(B)['game']
    self.assertEqual((g['stage'], g['wins'], g['deadline']), ('reveal', {A: 1, B: 0}, self.t + party.RPS_REVEAL_MS))
    self.wait(party.RPS_REVEAL_MS)
    self.pick('paper', 'rock')
    self.assertEqual(self.game()['decided'], {'winner': A, 'reason': 'two_wins'})
    self.assertEqual(self.p['phase'], 'play', 'the deciding reveal is still shown')
    self.wait(party.RPS_REVEAL_MS)
    self.assertEqual((self.p['phase'], self.p['scores']), ('result', {A: 2, B: 0}))
    self.assertEqual(self.p['results'][1]['wins'], {A: 2, B: 0})

    # 3. Speed Sprint: a countdown, then Alice solves all five.
    self.wait(party.RESULT_MS)
    g = self.view(A)['game']
    self.assertEqual((g['kind'], g['stage'], g['problem']), ('sprint', 'countdown', None))
    self.assertEqual(g['deadline'] - g['starts_at'], party.SPRINT_MS)
    self.assertEqual(self.view(A)['wake_at'], g['starts_at'])
    self.at(g['starts_at'])
    for i in range(party.SPRINT_COUNT):
      self.t += 900
      self.assertEqual(self.view(A)['game']['problem']['index'], i)
      self.solve(A)
    self.assertEqual(self.p['phase'], 'result')
    sprint = self.p['results'][2]
    self.assertEqual((sprint['winner'], sprint['reason'], sprint['solved']), (A, 'finished', {A: 5, B: 0}))
    self.assertEqual(sprint['times'][A], 4500)
    self.assertEqual(len(sprint['problems']), 5)

    # Final: Alice wins 3-0; it stays until both close.
    self.wait(party.RESULT_MS)
    v = self.view(B)
    self.assertEqual((v['phase'], v['winner'], v['draw'], v['end'], v['scores']), ('final', A, False, 'points', {A: 3, B: 0}))
    self.assertEqual(v['deadline'], self.t + party.FINAL_MS)
    self.act(A, 'close')
    self.assertFalse(party.is_finished(self.p))
    self.act(B, 'close')
    self.assertTrue(party.is_finished(self.p))
    self.refused(A, 'close')

  def test_both_ready_skips_the_intro(self):
    self.act(A, 'ready')
    self.act(A, 'ready')   # Repeating is harmless.
    self.assertEqual((self.p['phase'], self.p['ready']), ('intro', [A]))
    self.t += 500
    self.act(B, 'ready')
    self.assertEqual((self.p['phase'], self.p['phase_at']), ('play', T0 + 500))
    self.refused(A, 'ready')

  def test_the_intro_runs_out_by_itself(self):
    self.assertFalse(self.at(T0 + party.INTRO_MS - 1))
    self.assertEqual(self.p['phase'], 'intro')
    self.assertTrue(self.at(T0 + party.INTRO_MS))
    self.assertEqual(self.p['phase'], 'play')

  def test_three_games_are_always_played(self):
    self.win_quickdraw(A)
    self.wait(party.RESULT_MS)
    self.win_rps(A)
    self.wait(party.RESULT_MS)
    self.assertEqual((self.p['phase'], self.game()['kind']), ('play', 'sprint'), 'a 2-0 lead does not end the party')


class QuickDrawTests(PartyCase):
  def setUp(self):
    super().setUp()
    self.to_quickdraw()

  def test_the_draw_moment_is_secret_until_it_passes(self):
    go_at = self.go_at()
    armed_at = self.t
    for t in range(armed_at, go_at, 37):
      self.t = t
      self.tick()
      for viewer in (A, B, 'spectator'):
        v = self.view(viewer)
        g = v['game']
        self.assertEqual(g['stage'], 'armed')
        self.assertNotIn('go_at', g)
        self.assertNotIn('cutoff', g)
        self.assertIsNone(v['wake_at'])
        self.assertNotIn(go_at, [x for _, x in walk(v, skip=('window',))])
    self.assertTrue(self.at(go_at), 'the DRAW moment is a real change, so the world version moves')
    g = self.view(A)['game']
    self.assertEqual((g['stage'], g['go_at'], g['cutoff']),
                     ('draw', go_at, go_at + party.QD_TIMEOUT_MS + party.QD_GRACE_MS))
    self.assertEqual(self.view(A)['wake_at'], g['cutoff'])

  def test_a_view_from_before_draw_never_shows_it(self):
    go_at = self.go_at()
    self.at(go_at)
    early = party.public_view(self.p, A, go_at - 1)['game']
    self.assertEqual(early['stage'], 'armed')
    self.assertNotIn('go_at', early)

  def test_false_start_loses_and_the_opponent_sees_it(self):
    self.t += 400
    self.act(A, 'draw', falseStart=True)
    self.assertEqual(self.view(A)['game']['mine'], {'outcome': 'false_start', 'ms': None})
    self.assertEqual(self.view(B)['game']['status'][A], 'false_start')
    self.assertEqual(self.p['phase'], 'play', 'Bob still has to not jump the gun')
    self.at(self.go_at())
    self.t += 500
    self.act(B, 'draw', ms=330)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (B, 'false_start'))

  def test_a_press_that_arrives_before_draw_is_a_false_start(self):
    self.t = self.go_at() - 1
    self.act(A, 'draw', ms=250)
    self.assertEqual(self.p['secret']['presses'][A]['outcome'], 'false_start')

  def test_anticipation_threshold(self):
    self.at(self.go_at())
    self.t += 120
    self.act(A, 'draw', ms=party.QD_MIN_MS - 1)
    self.assertEqual(self.view(A)['game']['mine'], {'outcome': 'false_start', 'ms': party.QD_MIN_MS - 1})
    self.act(B, 'draw', ms=party.QD_MIN_MS)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (B, 'false_start'))
    self.assertEqual(result['duels'][0]['presses'][B], {'outcome': 'valid', 'ms': party.QD_MIN_MS})

  def test_a_press_slower_than_five_seconds_is_a_timeout(self):
    self.at(self.go_at())
    self.t += 5_400
    self.act(A, 'draw', ms=party.QD_TIMEOUT_MS + 1)
    self.assertEqual(self.view(B)['game']['status'][A], 'too_slow')
    self.act(B, 'draw', ms=4_900)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (B, 'timeout'))

  def test_both_time_out_replays_once_then_a_coin_decides(self):
    first_go = self.go_at()
    cutoff = first_go + party.QD_TIMEOUT_MS + party.QD_GRACE_MS
    self.at(cutoff - 1)
    self.assertEqual(self.game()['duel'], 1)
    self.at(cutoff)
    g = self.view(A)['game']
    self.assertEqual((g['duel'], g['stage'], self.p['phase']), (2, 'armed', 'play'))
    self.assertEqual(g['history'][0]['reason'], 'replay')
    self.assertEqual(g['history'][0]['presses'], {A: {'outcome': 'timeout', 'ms': None}, B: {'outcome': 'timeout', 'ms': None}})
    lo, hi = party.QD_DELAY_MS
    extra = party.QD_REPLAY_EXTRA_MS
    self.assertEqual(g['window'], [cutoff + extra + lo, cutoff + extra + hi])
    self.assertTrue(cutoff + extra + lo <= self.go_at() <= cutoff + extra + hi)
    self.assertEqual(g['status'], {A: 'waiting', B: 'waiting'})
    self.at(self.go_at() + party.QD_TIMEOUT_MS + party.QD_GRACE_MS)
    result = self.p['results'][-1]
    self.assertEqual(result['reason'], 'coin')
    self.assertIn(result['winner'], (A, B))
    self.assertEqual([d['reason'] for d in result['duels']], ['replay', 'coin'])
    self.assertEqual(self.p['scores'][result['winner']], 1)

  def test_both_false_start_replays_and_the_replay_decides(self):
    self.t += 300
    self.act(A, 'draw', falseStart=True)
    self.act(B, 'draw', falseStart=True)
    g = self.view(B)['game']
    self.assertEqual((g['duel'], g['stage'], g['mine']), (2, 'armed', None), 'presses reset for the replay')
    self.at(self.go_at())
    self.t += 400
    self.act(A, 'draw', ms=250)
    self.act(B, 'draw', ms=241)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (B, 'faster'))

  def test_two_false_starts_in_the_replay_go_to_a_coin(self):
    for _ in range(2):
      self.act(A, 'draw', falseStart=True)
      self.act(B, 'draw', falseStart=True)
    result = self.p['results'][-1]
    self.assertEqual((result['reason'], len(result['duels'])), ('coin', 2))

  def test_a_false_start_loses_to_a_timeout(self):
    self.act(A, 'draw', falseStart=True)
    self.at(self.go_at() + party.QD_TIMEOUT_MS + party.QD_GRACE_MS)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (B, 'false_start'))

  def test_equal_times_go_to_the_earlier_report_then_a_coin(self):
    self.at(self.go_at())
    self.t += 300
    self.act(B, 'draw', ms=250)
    self.t += 40
    self.act(A, 'draw', ms=250)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (B, 'earlier'))

  def test_equal_times_at_the_same_instant_flip_a_coin(self):
    self.at(self.go_at())
    self.t += 300
    self.act(A, 'draw', ms=250)
    self.act(B, 'draw', ms=250)
    self.assertEqual(self.p['results'][-1]['reason'], 'coin')

  def test_one_press_per_player(self):
    self.at(self.go_at())
    self.t += 300
    self.act(A, 'draw', ms=260)
    self.refused(A, 'draw', ms=200)
    self.refused(A, 'draw', falseStart=True)
    self.assertEqual(self.p['secret']['presses'][A]['ms'], 260)

  def test_reports_after_the_cutoff_are_too_late(self):
    go_at = self.go_at()
    self.at(go_at)
    self.t += 600
    self.act(A, 'draw', ms=410)
    self.t = go_at + party.QD_TIMEOUT_MS + party.QD_GRACE_MS
    message = self.refused(B, 'draw', ms=300)
    self.assertIn('Too late', message)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (A, 'timeout'))

  def test_the_opponents_time_stays_hidden_until_the_duel_is_decided(self):
    self.at(self.go_at())
    self.t += 300
    self.act(A, 'draw', ms=233)
    mine, theirs = self.view(A)['game'], self.view(B)['game']
    self.assertEqual(mine['mine'], {'outcome': 'valid', 'ms': 233})
    self.assertIsNone(theirs['mine'])
    self.assertEqual(theirs['status'], {A: 'pressed', B: 'waiting'})
    self.assertNotIn(233, [x for _, x in walk(self.view(B))])
    self.assertNotIn(233, [x for _, x in walk(self.view('spectator'))])

  def test_invalid_presses_are_refused(self):
    self.at(self.go_at())
    for fields in ({}, {'ms': -1}, {'ms': '250'}, {'ms': True}, {'ms': 250.5}, {'ms': party.QD_MAX_MS + 1},
                   {'falseStart': 'yes'}, {'falseStart': 1}, {'falseStart': True, 'ms': 120}, {'falseStart': False}):
      self.refused(A, 'draw', **fields)
    self.assertEqual(self.p['secret']['presses'], {})
    self.act(A, 'draw', ms=300, falseStart=False, client='ignored')
    self.assertEqual(self.p['secret']['presses'][A]['outcome'], 'valid')

  def test_other_games_actions_are_out_of_phase(self):
    self.refused(A, 'rps', choice='rock')
    self.refused(A, 'answer', index=0, value=1)
    self.refused(A, 'close')


class RpsTests(PartyCase):
  def setUp(self):
    super().setUp()
    self.to_rps()

  def test_picks_stay_secret_until_both_have_picked(self):
    self.act(A, 'rps', choice='scissors')
    theirs = self.view(B)
    self.assertEqual((theirs['game']['chosen'], theirs['game']['mine']), ([A], None))
    self.assertNotIn('scissors', json.dumps(theirs))
    self.assertNotIn('scissors', json.dumps(self.view('spectator')))
    self.assertEqual(self.view(A)['game']['mine'], 'scissors')
    self.t += 1200
    self.act(B, 'rps', choice='rock')
    for viewer in (A, B):
      g = self.view(viewer)['game']
      self.assertEqual(g['stage'], 'reveal')
      self.assertEqual(g['rounds'][-1], {'round': 1, 'choices': {A: 'scissors', B: 'rock'}, 'random': [], 'winner': B})
      self.assertEqual(g['wins'], {A: 0, B: 1})

  def test_draws_replay_until_two_wins(self):
    rounds = [('rock', 'rock'), ('paper', 'rock'), ('scissors', 'scissors'), ('rock', 'paper'), ('scissors', 'paper')]
    for i, (a, b) in enumerate(rounds, start=1):
      self.assertEqual((self.game()['round'], self.game()['stage']), (i, 'choose'))
      self.pick(a, b)
      self.wait(party.RPS_REVEAL_MS)
    result = self.p['results'][-1]
    self.assertEqual((result['game'], result['winner'], result['reason'], result['wins']), ('rps', A, 'two_wins', {A: 2, B: 1}))
    self.assertEqual([r['winner'] for r in result['rounds']], [None, A, None, B, A])

  def test_the_reveal_shows_for_a_while_before_the_next_round(self):
    self.pick('rock', 'rock')
    reveal_end = self.t + party.RPS_REVEAL_MS
    self.assertEqual(self.view(A)['wake_at'], reveal_end)
    self.refused(A, 'rps', choice='paper')
    self.assertFalse(self.at(reveal_end - 1))
    self.assertTrue(self.at(reveal_end))
    g = self.view(A)['game']
    self.assertEqual((g['round'], g['stage'], g['chosen'], g['deadline']), (2, 'choose', [], reveal_end + party.RPS_ROUND_MS))

  def test_after_seven_rounds_the_player_ahead_wins(self):
    for _ in range(6):
      self.pick('paper', 'paper')
      self.wait(party.RPS_REVEAL_MS)
    self.pick('paper', 'rock')
    self.assertEqual(self.game()['decided'], {'winner': A, 'reason': 'round_cap'})
    self.wait(party.RPS_REVEAL_MS)
    self.assertEqual((self.p['results'][-1]['winner'], self.p['results'][-1]['reason']), (A, 'round_cap'))
    self.assertEqual(len(self.p['results'][-1]['rounds']), party.RPS_MAX_ROUNDS)

  def test_seven_drawn_rounds_go_to_a_coin(self):
    for _ in range(7):
      self.pick('rock', 'rock')
      self.wait(party.RPS_REVEAL_MS)
    result = self.p['results'][-1]
    self.assertEqual(result['reason'], 'coin')
    self.assertIn(result['winner'], (A, B))

  def test_a_missing_pick_is_made_at_random_when_time_runs_out(self):
    deadline = self.t + party.RPS_ROUND_MS
    self.act(A, 'rps', choice='rock')
    self.assertFalse(self.at(deadline - 1))
    self.assertTrue(self.at(deadline))
    last = self.view(A)['game']['rounds'][-1]
    self.assertEqual((last['choices'][A], last['random']), ('rock', [B]))
    self.assertIn(last['choices'][B], party.RPS_CHOICES)

  def test_nobody_picking_picks_for_both(self):
    self.at(self.t + party.RPS_ROUND_MS)
    self.assertEqual(self.game()['rounds'][-1]['random'], [A, B])

  def test_invalid_picks_are_refused(self):
    for choice in ('lizard', 'ROCK', 1, None, ['rock']):
      self.refused(A, 'rps', choice=choice)
    self.act(A, 'rps', choice='paper')
    self.refused(A, 'rps', choice='rock')
    self.assertEqual(self.p['secret']['picks'], {A: 'paper'})
    self.refused(B, 'draw', ms=200)
    self.refused(B, 'answer', index=0, value=3)


class SprintTests(PartyCase):
  def setUp(self):
    super().setUp()
    self.to_sprint()

  def race(self):
    self.at(self.game()['starts_at'])
    self.assertEqual(self.game()['stage'], 'race')

  def test_problems_are_mixed_whole_and_small(self):
    for seed in range(300):
      problems = party.make_problems(seed)
      self.assertEqual(len(problems), party.SPRINT_COUNT)
      self.assertEqual({p['op'] for p in problems} >= {'+', '-', '*', '/'}, True)
      self.assertEqual(len({(p['a'], p['op'], p['b']) for p in problems}), len(problems))
      for p in problems:
        self.assertEqual(p['answer'], OPS[p['op']](p['a'], p['b']))
        if p['op'] == '/':
          self.assertEqual(p['a'] % p['b'], 0)
        self.assertTrue(0 < p['answer'] <= 108 and 0 < p['a'] <= 108 and 0 < p['b'] <= 99, p)
      self.assertEqual(problems, party.make_problems(seed), 'seeded per party')
    self.assertNotEqual(party.make_problems(1), party.make_problems(2))

  def test_both_players_get_the_same_problems_after_the_countdown(self):
    self.refused(A, 'answer', index=0, value=1)
    self.assertIsNone(self.view(A)['game']['problem'])
    self.race()
    pa, pb = self.view(A)['game']['problem'], self.view(B)['game']['problem']
    self.assertEqual(pa, pb)
    self.assertEqual(pa['index'], 0)
    self.assertIsNone(self.view('spectator')['game']['problem'])

  def test_a_correct_answer_advances_and_a_wrong_one_locks_for_two_seconds(self):
    self.race()
    index, value = self.answer_for(A)
    self.act(A, 'answer', index=index, value=value + 1)
    g = self.view(B)['game']
    self.assertEqual(g['progress'][A], {'solved': 0, 'wrong': 1, 'locked_until': self.t + party.SPRINT_LOCK_MS})
    self.t += party.SPRINT_LOCK_MS - 1
    self.assertIn('Locked', self.refused(A, 'answer', index=index, value=value))
    self.t += 1
    self.act(A, 'answer', index=index, value=value)
    self.assertEqual(self.view(A)['game']['progress'][A]['solved'], 1)
    self.assertEqual(self.view(A)['game']['problem']['index'], 1)

  def test_answers_must_be_for_the_current_problem(self):
    self.race()
    self.refused(A, 'answer', index=1, value=5)
    self.solve(A)
    index, value = 0, OPS[self.p['secret']['problems'][0]['op']](self.p['secret']['problems'][0]['a'], self.p['secret']['problems'][0]['b'])
    self.assertIn('already', self.refused(A, 'answer', index=index, value=value))

  def test_invalid_answers_are_refused(self):
    self.race()
    for fields in ({'index': 0, 'value': '12'}, {'index': 0, 'value': 12.0}, {'index': 0, 'value': True},
                   {'index': 0}, {'index': 0, 'value': party.SPRINT_MAX_ANSWER + 1},
                   {'index': -1, 'value': 3}, {'index': 5, 'value': 3}, {'index': True, 'value': 3}, {'value': 3}):
      self.refused(A, 'answer', **fields)
    self.assertEqual(self.game()['progress'][A], {'solved': 0, 'wrong': 0, 'locked_until': 0, 'last_at': None})

  def test_first_to_finish_wins_even_when_behind_on_time(self):
    self.race()
    for _ in range(4):
      self.t += 500
      self.solve(B)
    for _ in range(5):
      self.t += 1500
      self.solve(A)
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason'], result['solved']), (A, 'finished', {A: 5, B: 4}))
    self.assertEqual(self.p['scores'], {A: 3, B: 0})

  def test_at_time_up_more_correct_answers_win(self):
    self.race()
    for pid in (A, B, B):
      self.t += 1000
      self.solve(pid)
    self.assertFalse(self.at(self.game()['deadline'] - 1))
    self.at(self.game()['deadline'])
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason'], result['solved']), (B, 'more_correct', {A: 1, B: 2}))

  def test_at_time_up_equal_answers_go_to_the_earlier_last_correct(self):
    self.race()
    for pid in (A, B, B, A):
      self.t += 1000
      self.solve(pid)
    self.at(self.game()['deadline'])
    result = self.p['results'][-1]
    self.assertEqual((result['winner'], result['reason']), (B, 'earlier'))
    self.assertEqual(result['times'], {A: 4000, B: 3000})

  def test_at_time_up_with_no_answers_a_coin_decides(self):
    self.race()
    self.at(self.game()['deadline'])
    result = self.p['results'][-1]
    self.assertEqual(result['reason'], 'coin')
    self.assertEqual(result['times'], {A: None, B: None})

  def test_problems_ahead_of_the_viewer_stay_hidden(self):
    self.race()
    self.solve(A)
    problems = self.p['secret']['problems']
    for viewer, at in ((A, 1), (B, 0)):
      v = self.view(viewer)
      self.assertEqual(v['game']['problem']['index'], at)
      self.assertNotIn('answer', [k for k, _ in walk(v)])
      self.assertNotIn('problems', v['game'])
      texts = json.dumps(v)
      for later in problems[at + 1:]:
        shown = v['game']['problem']
        if (later['a'], later['op'], later['b']) != (shown['a'], shown['op'], shown['b']):
          self.assertNotIn(party._problem_text(later), texts)


class ForfeitTests(PartyCase):
  def assert_forfeited(self, leaver):
    winner = A if leaver == B else B
    v = self.view(winner)
    self.assertEqual((v['phase'], v['winner'], v['end'], v['left'], v['closed'], v['game']),
                     ('final', winner, 'forfeit', leaver, [leaver], None))
    self.assertNotIn('go_at', self.p['secret'])
    self.act(winner, 'close')
    self.assertTrue(party.is_finished(self.p))

  def test_forfeit_in_the_intro(self):
    self.act(B, 'forfeit')
    self.assert_forfeited(B)

  def test_forfeit_during_quick_draw(self):
    self.to_quickdraw()
    self.act(A, 'forfeit')
    self.assert_forfeited(A)

  def test_forfeit_while_ahead_still_hands_over_the_party(self):
    self.to_rps()
    self.act(A, 'rps', choice='rock')
    self.act(A, 'forfeit')
    self.assert_forfeited(A)
    self.assertEqual(self.p['scores'], {A: 1, B: 0})

  def test_forfeit_during_the_sprint(self):
    self.to_sprint()
    self.act(B, 'forfeit')
    self.assert_forfeited(B)

  def test_forfeit_on_a_result_screen(self):
    self.win_quickdraw(B)
    self.act(B, 'forfeit')
    self.assert_forfeited(B)

  def test_leaving_after_the_last_game_keeps_the_result(self):
    self.to_sprint()
    self.at(self.game()['starts_at'])
    for _ in range(5):
      self.solve(A)
    self.act(A, 'forfeit')
    v = self.view(B)
    self.assertEqual((v['phase'], v['winner'], v['end'], v['closed']), ('final', A, 'points', [A]))

  def test_leaving_the_final_screen_is_closing(self):
    self.act(A, 'forfeit')
    self.act(B, 'forfeit')
    self.assertTrue(party.is_finished(self.p))

  def test_close_before_the_final_is_refused_and_the_final_times_out(self):
    self.refused(A, 'close')
    self.act(A, 'forfeit')
    self.refused(B, 'ready')
    self.refused(B, 'draw', ms=200)
    end = self.p['deadline']
    self.assertFalse(self.at(end - 1))
    self.assertTrue(self.at(end))
    self.assertTrue(party.is_finished(self.p))
    self.assertIn('over', self.refused(B, 'close'))
    self.assertFalse(self.wait(10_000), 'a finished party never changes again')


class TickTests(PartyCase):
  def test_tick_is_idempotent_through_a_whole_party(self):
    sim = random.Random(99)
    while not party.is_finished(self.p) and self.t < T0 + 600_000:
      self.wait(sim.randint(1, 700))
      before, state = copy.deepcopy(self.p), self.rng.getstate()
      self.assertFalse(party.tick(self.p, self.t, self.rng), 'a second tick at the same time changes nothing')
      self.assertEqual(self.p, before)
      self.assertEqual(self.rng.getstate(), state, 'and draws no randomness')
      if self.p['phase'] == 'final':
        self.act(A, 'close')
        self.act(B, 'close')
    self.assertTrue(party.is_finished(self.p), 'a party plays itself out on timers alone')

  def test_a_long_gap_catches_up_without_skipping_games(self):
    self.at(T0 + party.INTRO_MS + 60_000)
    self.assertEqual((self.p['phase'], self.game()['kind'], self.game()['duel'], self.game()['stage']),
                     ('play', 'quickdraw', 1, 'armed'))
    self.assertEqual(self.game()['armed_at'], self.t, 'a game starts when the server notices, not in the past')
    self.at(self.t + 60_000)
    self.assertEqual((self.game()['duel'], self.game()['stage'], self.game()['history'][0]['reason']),
                     (2, 'armed', 'replay'))
    self.assertEqual(self.game()['armed_at'], self.t)

  def test_nothing_changes_before_a_deadline(self):
    self.to_quickdraw()
    before = copy.deepcopy(self.p)
    self.assertFalse(self.at(self.go_at() - 1))
    self.assertEqual(self.p, before)

  def test_views_do_not_alias_or_mutate_the_party(self):
    self.to_rps()
    self.act(A, 'rps', choice='rock')
    before = copy.deepcopy(self.p)
    v = self.view(A)
    v['scores'][A] = 99
    v['game']['wins'][A] = 99
    v['results'][0]['winner'] = 'x'
    v['names'][A] = 'x'
    self.assertEqual(self.p, before)


class ValidationTests(PartyCase):
  def test_only_the_two_players_can_act(self):
    for pid in ('carol', None, 3, ['alice']):
      with self.assertRaises(PartyError):
        party.apply_action(self.p, pid, {'type': 'ready'}, self.t, self.rng)

  def test_unknown_or_malformed_actions_are_refused(self):
    for action in (None, 'ready', ['ready'], {}, {'type': 'cheat'}, {'type': None}, {'type': ['ready']}, {'type': 'READY'}):
      with self.assertRaises(PartyError):
        party.apply_action(self.p, A, action, self.t, self.rng)
    self.assertEqual(self.p['phase'], 'intro')

  def test_new_party_checks_its_players_and_cleans_names(self):
    with self.assertRaises(PartyError):
      party.new_party('p', A, A, {}, T0, self.rng)
    with self.assertRaises(PartyError):
      party.new_party('', A, B, {}, T0, self.rng)
    with self.assertRaises(PartyError):
      party.new_party('p', A, None, {}, T0, self.rng)
    p = party.new_party('p', A, B, {A: 'A\x00l\nice   the   ' + 'x' * 40}, T0, self.rng)
    self.assertEqual(p['names'][A], 'A l ice the xxxxxxxxxxxx')
    self.assertEqual(p['names'][B], B, 'a missing name falls back to the player id')
    json.dumps(p)

  def test_time_must_be_a_number(self):
    with self.assertRaises(TypeError):
      party.tick(self.p, '1800000000000', self.rng)
    with self.assertRaises(TypeError):
      party.public_view(self.p, A, None)


class SecrecyFuzzTests(unittest.TestCase):
  """Random parties with random (often invalid) actions: views never leak a secret."""

  SECRET_KEYS = {'secret', 'seed', 'presses', 'picks', 'answer', 'go_at', 'problems'}

  def check_view(self, p, viewer, now):
    before = copy.deepcopy(p)
    v = party.public_view(p, viewer, now)
    self.assertEqual(p, before, 'public_view is read-only')
    json.dumps(v)
    secret = p['secret']
    body = {k: x for k, x in v.items() if k != 'results'}   # Finished games are public.
    keys = {k for k, _ in walk(body, skip=('history',))}     # So are decided duels.
    values = [x for _, x in walk(body, skip=('window', 'rounds'))]
    self.assertNotIn(secret['seed'], values)
    g = p.get('game')
    if g and g['kind'] == 'quickdraw':
      if now < secret['go_at']:
        self.assertNotIn(secret['go_at'], values)
        self.assertNotIn('go_at', keys)
        self.assertIsNone(v['wake_at'])
      for pid, press in secret['presses'].items():
        if pid != viewer and press['ms'] is not None:
          self.assertNotIn('ms', [k for k, _ in walk(v['game'], skip=('history', 'mine'))])
          rest = [x for _, x in walk(v['game'], skip=('history', 'window', 'mine', 'duel', 'min_ms', 'timeout_ms'))]
          self.assertNotIn(press['ms'], rest)
    elif g and g['kind'] == 'rps' and g['stage'] == 'choose':
      for pid, choice in secret['picks'].items():
        if pid != viewer:
          self.assertNotIn(choice, values)
    elif g and g['kind'] == 'sprint':
      self.assertFalse(keys & {'answer', 'problems'})
      if v['game']['problem'] is not None:
        self.assertEqual(v['game']['problem']['index'], g['progress'][viewer]['solved'])
    self.assertFalse(keys & (self.SECRET_KEYS - {'go_at'}))

  def test_random_parties_never_leak_and_always_finish(self):
    kinds = ['ready', 'draw', 'rps', 'answer', 'forfeit', 'close', 'nonsense']
    for seed in range(60):
      rng, sim = random.Random(seed), random.Random(1000 + seed)
      now = T0
      p = party.new_party(f'p{seed}', A, B, {A: 'Alice', B: 'Bob'}, now, rng)
      steps = 0
      while not party.is_finished(p):
        steps += 1
        self.assertLess(steps, 5_000, 'the party must end')
        now += sim.choice([1, 40, 120, 400, 900, 2_500])
        p = json.loads(json.dumps(p))
        party.tick(p, now, rng)
        for pid in (A, B):
          if sim.random() < 0.35:
            kind = sim.choice(kinds) if sim.random() < 0.9 else 'forfeit'
            if kind == 'forfeit' and sim.random() < 0.9:
              continue
            action = {'type': kind}
            if kind == 'draw':
              action.update(sim.choice([{'falseStart': True}, {'ms': sim.randint(0, 6_000)}, {'ms': 'x'}]))
            elif kind == 'rps':
              action['choice'] = sim.choice(list(party.RPS_CHOICES) + ['lizard'])
            elif kind == 'answer':
              solved = (p.get('game') or {}).get('progress', {}).get(pid, {}).get('solved', 0)
              problems = p['secret'].get('problems')
              right = problems[solved]['answer'] if problems and solved < len(problems) else 1
              action.update(index=sim.choice([solved, solved + 1]), value=sim.choice([right, right, right + 1]))
            try:
              party.apply_action(p, pid, action, now, rng)
            except PartyError:
              pass
          for viewer in (A, B, 'spectator'):
            self.check_view(p, viewer, now)
      self.assertEqual(sum(p['scores'].values()) <= 3, True)
      if p['end'] == 'points':
        self.assertEqual(sum(p['scores'].values()), 3, 'all three games were played')
        self.assertIsNotNone(p['winner'])


if __name__ == '__main__':
  unittest.main()
