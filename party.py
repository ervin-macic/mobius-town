"""Party challenge: two players, three quick mini-games, one scoreboard.

A party is three short games played in a fixed order (all three are always
played; each win is a point):

  1. Quick Draw   - wait for DRAW!, then press. The fastest clean reaction wins.
  2. Rock-Paper-Scissors - first to two round wins; draws replay.
  3. Speed Sprint - the same five mental-arithmetic problems for both players;
                    the first to solve all five wins.

Phases: 'intro' (4 s) -> for each game 'play' -> 'result' (4 s) -> 'final'
(until both players close it, or 60 s; then is_finished() is true).

The hub keeps one party dict inside its world document and calls these pure
functions inside its own transaction. They take the time (`now_ms`) and the
random source (`rng`) from the caller, mutate plain JSON-able dicts in place
and do no I/O.

Secrets - the Quick Draw moment before it passes, Rock-Paper-Scissors picks
before the reveal, Speed Sprint problems a player has not reached, and the
sprint seed - live only in party['secret']. Never send a raw party dict to a
client; send public_view(party, viewer, now) instead.

Quick Draw reactions are measured by each client from the frame it painted
DRAW to the press, so network latency does not decide the duel. That number is
trusted the way any client-measured time is; the server only refuses what it
can prove is wrong (a press that arrives before DRAW counts as a false start).
"""
from __future__ import annotations

import copy
import random
import re

__all__ = [
  'GAMES', 'TITLES', 'PartyError', 'new_party', 'apply_action', 'tick', 'public_view', 'is_finished',
  'make_problems',
]

GAMES = ('quickdraw', 'rps', 'sprint')
TITLES = {'quickdraw': 'Quick Draw', 'rps': 'Rock–Paper–Scissors', 'sprint': 'Speed Sprint'}

INTRO_MS = 4_000
RESULT_MS = 4_000
FINAL_MS = 60_000

# Quick Draw.
QD_DELAY_MS = (1_500, 4_500)   # "Wait for it…" lasts a uniform random time in this range.
QD_REPLAY_EXTRA_MS = 1_000     # A replay adds a beat so people can read the banner.
QD_MIN_MS = 90                 # Quicker than this is anticipation: a false start.
QD_TIMEOUT_MS = 5_000          # No press within this long after DRAW is a timeout.
QD_GRACE_MS = 2_500            # Reports still accepted this long after the timeout (polling + network).
QD_MAX_MS = 600_000            # Sanity bound for a reported reaction time.

# Rock-Paper-Scissors.
RPS_CHOICES = ('rock', 'paper', 'scissors')
RPS_BEATS = {'rock': 'scissors', 'paper': 'rock', 'scissors': 'paper'}
RPS_TO_WIN = 2
RPS_MAX_ROUNDS = 7
RPS_ROUND_MS = 10_000
RPS_REVEAL_MS = 2_500

# Speed Sprint.
SPRINT_COUNT = 5
SPRINT_LEAD_MS = 3_000         # "3, 2, 1" before the first problem appears.
SPRINT_MS = 40_000
SPRINT_LOCK_MS = 2_000
SPRINT_MAX_ANSWER = 100_000

NAME_LIMIT = 24
MAX_STEPS = 64                 # Bound on the transitions one tick() may make.
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')
_SPACE = re.compile(r'\s+')


class PartyError(Exception):
  """A refusal the player may see: str(error) is a short, friendly message."""


# --- Small helpers ----------------------------------------------------------------------------------

def _is_int(value) -> bool:
  return isinstance(value, int) and not isinstance(value, bool)


def _now(now_ms) -> int:
  if isinstance(now_ms, bool) or not isinstance(now_ms, (int, float)):
    raise TypeError('now_ms must be a number of milliseconds')
  return int(now_ms)


def _clean_name(value, fallback: str) -> str:
  text = _SPACE.sub(' ', _CONTROL.sub(' ', str(value or ''))).strip()[:NAME_LIMIT]
  return text or fallback[:NAME_LIMIT]


def _other(party: dict, pid: str) -> str:
  a, b = party['players']
  return b if pid == a else a


def _reset_secret(party: dict) -> None:
  """Drop the finished game's secrets; the seed stays for the sprint."""
  party['secret'] = {'seed': party['secret']['seed']}


# --- Creating a party -------------------------------------------------------------------------------

def new_party(party_id: str, a: str, b: str, names: dict, now_ms: int, rng: random.Random) -> dict:
  """A new party between players `a` and `b`, starting with the intro."""
  now = _now(now_ms)
  if not isinstance(party_id, str) or not 0 < len(party_id) <= 64:
    raise PartyError('That party is not valid.')
  if not all(isinstance(p, str) and 0 < len(p) <= 128 for p in (a, b)):
    raise PartyError('A party needs two players.')
  if a == b:
    raise PartyError("You can't challenge yourself.")
  names = names if isinstance(names, dict) else {}
  return {
    'id': party_id,
    'players': [a, b],
    'names': {p: _clean_name(names.get(p), p) for p in (a, b)},
    'games': list(GAMES),
    'phase': 'intro',
    'index': 0,
    'phase_at': now,
    'deadline': now + INTRO_MS,
    'ready': [],
    'closed': [],
    'scores': {a: 0, b: 0},
    'results': [],
    'game': None,
    'winner': None,
    'draw': False,
    'end': None,
    'left': None,
    'finished': False,
    'created': now,
    'updated': now,
    'secret': {'seed': rng.randrange(1 << 31)},
  }


def is_finished(party: dict) -> bool:
  """True once the party can be removed: both closed the final screen, or it timed out."""
  return bool(party.get('finished'))


# --- Phases -------------------------------------------------------------------------------------------

def _start_game(party: dict, index: int, now: int, rng: random.Random) -> None:
  party.update({'phase': 'play', 'index': index, 'phase_at': now, 'deadline': None})
  _reset_secret(party)
  _STARTS[party['games'][index]](party, now, rng)


def _finish_game(party: dict, winner: str, reason: str, detail: dict, now: int) -> None:
  party['scores'][winner] += 1
  party['results'].append({'game': party['game']['kind'], 'winner': winner, 'reason': reason, **detail})
  party.update({'phase': 'result', 'phase_at': now, 'deadline': now + RESULT_MS, 'game': None})
  _reset_secret(party)


def _final(party: dict, now: int, *, winner=None, end: str = 'points', left=None) -> None:
  if end == 'points':
    a, b = party['players']
    sa, sb = party['scores'][a], party['scores'][b]
    winner = a if sa > sb else b if sb > sa else None
  party.update({
    'phase': 'final', 'phase_at': now, 'deadline': now + FINAL_MS, 'game': None,
    'winner': winner, 'draw': winner is None, 'end': end, 'left': left,
  })
  _reset_secret(party)


def _advance(party: dict, now: int, rng: random.Random) -> bool:
  """Make at most one timed transition; True if one was made."""
  if party['finished']:
    return False
  phase = party['phase']
  if phase == 'play':
    return _TICKS[party['game']['kind']](party, now, rng)
  if now < party['deadline']:
    return False
  if phase == 'intro':
    _start_game(party, 0, now, rng)
  elif phase == 'result':
    if party['index'] + 1 < len(party['games']):
      _start_game(party, party['index'] + 1, now, rng)
    else:
      _final(party, now)
  else:
    party['finished'] = True
  return True


def tick(party: dict, now_ms: int, rng: random.Random) -> bool:
  """Apply every timer that has run out by `now_ms`. Idempotent; True if anything changed.

  New phases and rounds start at `now_ms` (when the server notices), so after a
  long gap the party catches up without skipping a game nobody could play.
  """
  now = _now(now_ms)
  changed = False
  for _ in range(MAX_STEPS):
    if not _advance(party, now, rng):
      break
    changed = True
  if changed:
    party['updated'] = now
  return changed


# --- Quick Draw -------------------------------------------------------------------------------------

def _qd_start(party: dict, now: int, rng: random.Random) -> None:
  party['game'] = {'kind': 'quickdraw', 'duel': 0, 'history': []}
  _qd_arm(party, now, rng)


def _qd_arm(party: dict, now: int, rng: random.Random) -> None:
  game = party['game']
  game['duel'] += 1
  lo, hi = QD_DELAY_MS
  extra = QD_REPLAY_EXTRA_MS if game['duel'] > 1 else 0
  party['secret']['go_at'] = now + extra + rng.randint(lo, hi)
  party['secret']['presses'] = {}
  game.update({
    'stage': 'armed', 'armed_at': now, 'window': [now + extra + lo, now + extra + hi],
    'status': {pid: 'waiting' for pid in party['players']},
  })
  game.pop('go_at', None)
  game.pop('cutoff', None)


def _act_draw(party: dict, pid: str, action: dict, now: int, rng: random.Random) -> bool:
  game = _playing(party, 'quickdraw')
  false_start = action.get('falseStart')
  false_start = False if false_start is None else false_start
  ms = action.get('ms')
  if false_start is True:
    if ms is not None:
      raise PartyError('That press is not valid.')
  elif false_start is False:
    if not _is_int(ms) or not 0 <= ms <= QD_MAX_MS:
      raise PartyError('That reaction time is not valid.')
  else:
    raise PartyError('That press is not valid.')
  presses = party['secret']['presses']
  if pid in presses:
    raise PartyError('You already pressed in this duel.')
  if false_start or now < party['secret']['go_at']:
    # Reaching the server before DRAW means the press came before DRAW was shown.
    press = {'outcome': 'false_start', 'ms': None}
  elif ms < QD_MIN_MS:
    press = {'outcome': 'false_start', 'ms': ms}
  elif ms > QD_TIMEOUT_MS:
    press = {'outcome': 'timeout', 'ms': ms}
  else:
    press = {'outcome': 'valid', 'ms': ms}
  presses[pid] = {**press, 'at': now}
  game['status'][pid] = {'valid': 'pressed', 'timeout': 'too_slow'}.get(press['outcome'], 'false_start')
  if len(presses) == 2:
    _qd_resolve(party, now, rng)
  return True


_QD_RANK = {'valid': 2, 'timeout': 1, 'false_start': 0}


def _qd_resolve(party: dict, now: int, rng: random.Random) -> None:
  """Decide the duel; whoever has not reported by now has timed out.

  A clean press beats a timeout, which beats a false start; between clean
  presses the lower time wins, then the report that reached the server first,
  then a coin. Two false starts or two timeouts replay the duel once; if the
  replay ends the same way a coin decides.
  """
  game = party['game']
  presses = party['secret'].get('presses', {})
  a, b = party['players']
  record = {pid: ({'outcome': presses[pid]['outcome'], 'ms': presses[pid]['ms']} if pid in presses
                  else {'outcome': 'timeout', 'ms': None}) for pid in (a, b)}
  oa, ob = record[a]['outcome'], record[b]['outcome']
  if oa == ob == 'valid':
    if record[a]['ms'] != record[b]['ms']:
      winner, reason = (a if record[a]['ms'] < record[b]['ms'] else b), 'faster'
    elif presses[a]['at'] != presses[b]['at']:
      winner, reason = (a if presses[a]['at'] < presses[b]['at'] else b), 'earlier'
    else:
      winner, reason = rng.choice([a, b]), 'coin'
  elif oa == ob:
    winner, reason = (None, 'replay') if game['duel'] < 2 else (rng.choice([a, b]), 'coin')
  else:
    winner = a if _QD_RANK[oa] > _QD_RANK[ob] else b
    reason = record[_other(party, winner)]['outcome']   # 'false_start' or 'timeout'
  game['history'].append({'duel': game['duel'], 'presses': record, 'winner': winner, 'reason': reason})
  if winner is None:
    _qd_arm(party, now, rng)
  else:
    _finish_game(party, winner, reason, {'duels': game['history']}, now)


def _qd_tick(party: dict, now: int, rng: random.Random) -> bool:
  game = party['game']
  go_at = party['secret']['go_at']
  if game['stage'] == 'armed' and now >= go_at:
    # A real change, so the world version moves and clients fetch the DRAW.
    game.update({'stage': 'draw', 'go_at': go_at, 'cutoff': go_at + QD_TIMEOUT_MS + QD_GRACE_MS})
    return True
  if game['stage'] == 'draw' and now >= game['cutoff']:
    _qd_resolve(party, now, rng)
    return True
  return False


def _qd_view(party: dict, me, now: int) -> dict:
  game = party['game']
  view = {
    'kind': 'quickdraw', 'duel': game['duel'], 'stage': 'armed', 'armed_at': game['armed_at'],
    'window': list(game['window']), 'status': dict(game['status']), 'history': copy.deepcopy(game['history']),
    'min_ms': QD_MIN_MS, 'timeout_ms': QD_TIMEOUT_MS, 'mine': None,
  }
  go_at = game.get('go_at')
  if game['stage'] == 'draw' and go_at is not None and now >= go_at:
    view.update({'stage': 'draw', 'go_at': go_at, 'cutoff': game['cutoff']})
  press = party['secret'].get('presses', {}).get(me) if me else None
  if press:
    view['mine'] = {'outcome': press['outcome'], 'ms': press['ms']}
  return view


# --- Rock-Paper-Scissors -------------------------------------------------------------------------------

def _rps_start(party: dict, now: int, rng: random.Random) -> None:
  party['game'] = {
    'kind': 'rps', 'round': 0, 'wins': {pid: 0 for pid in party['players']}, 'rounds': [], 'decided': None,
  }
  _rps_round(party, now)


def _rps_round(party: dict, now: int) -> None:
  game = party['game']
  game['round'] += 1
  game.update({'stage': 'choose', 'deadline': now + RPS_ROUND_MS, 'chosen': []})
  party['secret']['picks'] = {}


def _act_rps(party: dict, pid: str, action: dict, now: int, rng: random.Random) -> bool:
  game = _playing(party, 'rps')
  choice = action.get('choice')
  if not isinstance(choice, str) or choice not in RPS_CHOICES:
    raise PartyError('Pick rock, paper or scissors.')
  if game['stage'] != 'choose':
    raise PartyError('Wait for the next round.')
  if pid in game['chosen']:
    raise PartyError('You already picked this round.')
  party['secret']['picks'][pid] = choice
  game['chosen'].append(pid)
  if len(game['chosen']) == 2:
    _rps_reveal(party, now, rng)
  return True


def _rps_reveal(party: dict, now: int, rng: random.Random) -> None:
  game = party['game']
  picks = party['secret'].pop('picks', {})
  a, b = party['players']
  choices, random_for = {}, []
  for pid in (a, b):
    choice = picks.get(pid)
    if choice not in RPS_CHOICES:
      choice = rng.choice(RPS_CHOICES)
      random_for.append(pid)
    choices[pid] = choice
  if choices[a] == choices[b]:
    winner = None
  else:
    winner = a if RPS_BEATS[choices[a]] == choices[b] else b
    game['wins'][winner] += 1
  game['rounds'].append({'round': game['round'], 'choices': choices, 'random': random_for, 'winner': winner})
  game.update({'stage': 'reveal', 'deadline': now + RPS_REVEAL_MS, 'chosen': [a, b]})
  wins = game['wins']
  if max(wins[a], wins[b]) >= RPS_TO_WIN:
    game['decided'] = {'winner': a if wins[a] >= RPS_TO_WIN else b, 'reason': 'two_wins'}
  elif game['round'] >= RPS_MAX_ROUNDS:
    if wins[a] != wins[b]:
      game['decided'] = {'winner': a if wins[a] > wins[b] else b, 'reason': 'round_cap'}
    else:
      game['decided'] = {'winner': rng.choice([a, b]), 'reason': 'coin'}


def _rps_tick(party: dict, now: int, rng: random.Random) -> bool:
  game = party['game']
  if now < game['deadline']:
    return False
  if game['stage'] == 'choose':
    _rps_reveal(party, now, rng)   # Missing picks are made at random.
  elif game['decided']:
    decided = game['decided']
    _finish_game(party, decided['winner'], decided['reason'], {'wins': game['wins'], 'rounds': game['rounds']}, now)
  else:
    _rps_round(party, now)
  return True


def _rps_view(party: dict, me, now: int) -> dict:
  game = party['game']
  view = {
    'kind': 'rps', 'round': game['round'], 'stage': game['stage'], 'deadline': game['deadline'],
    'wins': dict(game['wins']), 'rounds': copy.deepcopy(game['rounds']), 'chosen': list(game['chosen']),
    'decided': copy.deepcopy(game['decided']), 'to_win': RPS_TO_WIN, 'max_rounds': RPS_MAX_ROUNDS, 'mine': None,
  }
  if me and game['stage'] == 'choose':
    view['mine'] = party['secret'].get('picks', {}).get(me)
  return view


# --- Speed Sprint -------------------------------------------------------------------------------------

def make_problems(seed: int, count: int = SPRINT_COUNT) -> list:
  """Mixed + - x / problems with whole-number answers, small enough to do in your head.

  Deterministic for a seed; every operation appears at least once when count >= 4.
  """
  r = random.Random(seed)
  ops = ['+', '-', '*', '/']
  while len(ops) < count:
    ops.append(r.choice('+-*/'))
  r.shuffle(ops)
  problems, seen = [], set()
  for op in ops[:count]:
    while True:
      a, b, answer = _problem(r, op)
      if (a, op, b) not in seen:
        break
    seen.add((a, op, b))
    problems.append({'a': a, 'op': op, 'b': b, 'answer': answer})
  return problems


def _problem(r: random.Random, op: str) -> tuple:
  if op == '+':
    a, b = r.randint(12, 68), r.randint(7, 39)
    return a, b, a + b
  if op == '-':
    b, answer = r.randint(6, 39), r.randint(4, 59)
    return answer + b, b, answer
  if op == '*':
    a, b = r.randint(3, 12), r.randint(3, 9)
    return a, b, a * b
  b, answer = r.randint(2, 9), r.randint(3, 12)
  return b * answer, b, answer


_OP_TEXT = {'+': '+', '-': '-', '*': '×', '/': '÷'}   # The town's pixel fonts have these glyphs (no U+2212).


def _sprint_start(party: dict, now: int, rng: random.Random) -> None:
  problems = make_problems(party['secret']['seed'])
  party['secret']['problems'] = problems
  starts = now + SPRINT_LEAD_MS
  party['game'] = {
    'kind': 'sprint', 'stage': 'countdown', 'starts_at': starts, 'deadline': starts + SPRINT_MS,
    'total': len(problems),
    'progress': {pid: {'solved': 0, 'wrong': 0, 'locked_until': 0, 'last_at': None} for pid in party['players']},
  }


def _act_answer(party: dict, pid: str, action: dict, now: int, rng: random.Random) -> bool:
  game = _playing(party, 'sprint')
  index, value = action.get('index'), action.get('value')
  if not _is_int(index) or not 0 <= index < game['total']:
    raise PartyError('That problem does not exist.')
  if not _is_int(value) or abs(value) > SPRINT_MAX_ANSWER:
    raise PartyError('Answer with a whole number.')
  if game['stage'] != 'race':
    raise PartyError('Wait for GO!')
  mine = game['progress'][pid]
  if index != mine['solved']:
    raise PartyError('You already solved that one.' if index < mine['solved'] else 'Solve the current problem first.')
  if now < mine['locked_until']:
    raise PartyError('Locked out for a moment — try again shortly.')
  if value == party['secret']['problems'][index]['answer']:
    mine['solved'] += 1
    mine['last_at'] = now
    if mine['solved'] >= game['total']:
      _sprint_finish(party, pid, 'finished', now)
  else:
    mine['wrong'] += 1
    mine['locked_until'] = now + SPRINT_LOCK_MS
  return True


def _sprint_tick(party: dict, now: int, rng: random.Random) -> bool:
  game = party['game']
  if game['stage'] == 'countdown' and now >= game['starts_at']:
    game['stage'] = 'race'   # A real change, so clients fetch their first problem.
    return True
  if game['stage'] == 'race' and now >= game['deadline']:
    a, b = party['players']
    pa, pb = game['progress'][a], game['progress'][b]
    if pa['solved'] != pb['solved']:
      winner, reason = (a if pa['solved'] > pb['solved'] else b), 'more_correct'
    elif pa['last_at'] is not None and pb['last_at'] is not None and pa['last_at'] != pb['last_at']:
      winner, reason = (a if pa['last_at'] < pb['last_at'] else b), 'earlier'
    else:
      winner, reason = rng.choice([a, b]), 'coin'
    _sprint_finish(party, winner, reason, now)
    return True
  return False


def _sprint_finish(party: dict, winner: str, reason: str, now: int) -> None:
  game = party['game']
  start = game['starts_at']
  progress = game['progress']
  detail = {
    'total': game['total'],
    'solved': {pid: p['solved'] for pid, p in progress.items()},
    'wrong': {pid: p['wrong'] for pid, p in progress.items()},
    'times': {pid: (p['last_at'] - start if p['last_at'] is not None else None) for pid, p in progress.items()},
    'problems': [{**p, 'text': _problem_text(p)} for p in party['secret']['problems']],
  }
  _finish_game(party, winner, reason, detail, now)


def _problem_text(problem: dict) -> str:
  return f"{problem['a']} {_OP_TEXT[problem['op']]} {problem['b']}"


def _sprint_view(party: dict, me, now: int) -> dict:
  game = party['game']
  view = {
    'kind': 'sprint', 'stage': game['stage'], 'starts_at': game['starts_at'], 'deadline': game['deadline'],
    'total': game['total'], 'lock_ms': SPRINT_LOCK_MS,
    'progress': {pid: {'solved': p['solved'], 'wrong': p['wrong'], 'locked_until': p['locked_until']}
                 for pid, p in game['progress'].items()},
    'problem': None,
  }
  if me and game['stage'] == 'race':
    solved = game['progress'][me]['solved']
    if solved < game['total']:
      p = party['secret']['problems'][solved]
      view['problem'] = {'index': solved, 'a': p['a'], 'op': p['op'], 'b': p['b'], 'text': _problem_text(p)}
  return view


# --- Actions --------------------------------------------------------------------------------------------

_OUT_OF_PHASE = {
  'quickdraw': 'There is no duel to press in right now.',
  'rps': "It's not time for Rock–Paper–Scissors.",
  'sprint': "Speed Sprint isn't running right now.",
}


def _playing(party: dict, kind: str) -> dict:
  game = party.get('game')
  if party['phase'] != 'play' or not game or game['kind'] != kind:
    if party['phase'] == 'result' and party['results'] and party['results'][-1]['game'] == kind:
      raise PartyError(f'Too late — {TITLES[kind]} is over.')
    raise PartyError(_OUT_OF_PHASE[kind])
  return game


def _act_ready(party: dict, pid: str, action: dict, now: int, rng: random.Random) -> bool:
  if party['phase'] != 'intro':
    raise PartyError('The party has already started.')
  if pid in party['ready']:
    return False
  party['ready'].append(pid)
  if len(party['ready']) == 2:
    _start_game(party, 0, now, rng)
  return True


def _act_forfeit(party: dict, pid: str, action: dict, now: int, rng: random.Random) -> bool:
  if party['phase'] == 'final':
    return _act_close(party, pid, action, now, rng)   # Leaving the final screen.
  if party['phase'] == 'result' and party['index'] == len(party['games']) - 1:
    _final(party, now)   # Every game is decided: leaving now cannot change the result.
  else:
    _final(party, now, winner=_other(party, pid), end='forfeit', left=pid)
  party['closed'] = [pid]
  return True


def _act_close(party: dict, pid: str, action: dict, now: int, rng: random.Random) -> bool:
  if party['phase'] != 'final':
    raise PartyError('The party is still on. Leave to forfeit it.')
  if pid in party['closed']:
    return False
  party['closed'].append(pid)
  if len(party['closed']) == len(party['players']):
    party['finished'] = True
  return True


_ACTIONS = {
  'ready': _act_ready, 'draw': _act_draw, 'rps': _act_rps, 'answer': _act_answer,
  'forfeit': _act_forfeit, 'close': _act_close,
}
_STARTS = {'quickdraw': _qd_start, 'rps': _rps_start, 'sprint': _sprint_start}
_TICKS = {'quickdraw': _qd_tick, 'rps': _rps_tick, 'sprint': _sprint_tick}
_VIEWS = {'quickdraw': _qd_view, 'rps': _rps_view, 'sprint': _sprint_view}


def apply_action(party: dict, pid: str, action: dict, now_ms: int, rng: random.Random) -> None:
  """Apply one player's action, after first running any timers that are due.

  Raises PartyError (a message for the player) for anything invalid, out of
  phase or unknown. Unknown extra keys in `action` are ignored; every key that
  is used is type- and range-checked.
  """
  now = _now(now_ms)
  if not isinstance(pid, str) or pid not in party['players']:
    raise PartyError("You're not playing in this party.")
  if not isinstance(action, dict):
    raise PartyError('That party action is not valid.')
  kind = action.get('type')
  handler = _ACTIONS.get(kind) if isinstance(kind, str) else None
  if handler is None:
    raise PartyError('Unknown party action.')
  tick(party, now, rng)
  if party['finished'] or (party['phase'] == 'final' and kind not in ('close', 'forfeit')):
    raise PartyError('This party is over.')
  if handler(party, pid, action, now, rng):
    party['updated'] = now


# --- What a client may see ---------------------------------------------------------------------------

def public_view(party: dict, viewer_pid, now_ms: int) -> dict:
  """Everything `viewer_pid` may see, as a fresh JSON-able dict (never aliases the party).

  Leaves out the Quick Draw moment until it has passed, Rock-Paper-Scissors
  picks until the reveal (a player sees their own), Speed Sprint problems the
  viewer has not reached, and the seed. A viewer who is not playing gets the
  same view without any 'mine' details.
  """
  now = _now(now_ms)
  players = list(party['players'])
  me = viewer_pid if viewer_pid in players else None
  game = None
  if party['phase'] == 'play' and party.get('game'):
    game = _VIEWS[party['game']['kind']](party, me, now)
  return {
    'id': party['id'],
    'players': players,
    'names': dict(party['names']),
    'me': me,
    'opponent': _other(party, me) if me else None,
    'games': list(party['games']),
    'titles': {kind: TITLES[kind] for kind in party['games']},
    'phase': party['phase'],
    'index': party['index'],
    'phase_at': party['phase_at'],
    'deadline': party['deadline'],
    'ready': list(party['ready']),
    'closed': list(party['closed']),
    'scores': dict(party['scores']),
    'results': copy.deepcopy(party['results']),
    'winner': party['winner'],
    'draw': party['draw'],
    'end': party['end'],
    'left': party['left'],
    'finished': party['finished'],
    'game': game,
    'now': now,
    'wake_at': _wake_at(party, game),
  }


def _wake_at(party: dict, game) -> int | None:
  """The next server time a timer will change this view (None if unknown or secret).

  During Quick Draw's 'armed' stage this is None on purpose: the DRAW moment
  is secret, so clients poll quickly between game['window'][0] and [1].
  """
  if party['finished']:
    return None
  if game is None:
    return party['deadline']
  if game['kind'] == 'quickdraw':
    return game.get('cutoff')
  if game['kind'] == 'sprint' and game['stage'] == 'countdown':
    return game['starts_at']
  return game['deadline']
