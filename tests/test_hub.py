"""Tests for the Mobius Town hub (hub.py) and the service's identity exchange.

Run from the project root:  python3 -m unittest discover -s tests -p 'test_*.py'
"""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import hub  # noqa: E402
from hub import Problem  # noqa: E402


def st(map_id='town', room='town', x=31, y=26, **extra):
  return {'map': map_id, 'room': room, 'x': x, 'y': y, 'dir': 'down', **extra}


class HubCase(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.db = hub.connect(Path(self.tmp.name) / 'hub.sqlite3')
    self.t = 1_800_000_000.0

  def tearDown(self):
    self.db.close()
    self.tmp.cleanup()

  def tick(self, seconds=1.0):
    self.t += seconds
    return self.t

  def join(self, handle, cid=None, state=None, name=None):
    pid = hub.local_pid(self.db, handle, cid or f'{handle}-device', now=self.t)
    hub.sync(self.db, pid, handle, 'host.example', cid or f'{handle}-device',
             {'st': state or st(), 'name': name or handle.title(), 'look': {}}, now=self.t)
    return pid

  def sync(self, pid, state=None, **body):
    handle = pid.split('~')[0]
    row = self.db.execute('SELECT cid FROM presence WHERE pid=?', (pid,)).fetchone()
    return hub.sync(self.db, pid, handle, 'host.example', row['cid'],
                    {'st': state or st(), 'name': handle.title(), 'look': {}, **body}, now=self.t)

  def act(self, actor, op, **args):
    return hub.act(self.db, actor, {'op': op, **args}, now=self.t)


class PresenceTests(HubCase):
  def test_peers_see_each_other_and_not_themselves(self):
    a = self.join('alice')
    b = self.join('bob', state=st(x=10, y=12))
    res = self.sync(a)
    self.assertEqual([p['pid'] for p in res['peers']], [b])
    self.assertEqual((res['peers'][0]['x'], res['peers'][0]['y']), (10, 12))

  def test_offline_players_drop_out_of_the_peer_list(self):
    a = self.join('alice')
    self.join('bob')
    self.tick(hub.ONLINE_SECONDS + 1)
    self.assertEqual(self.sync(a)['peers'], [])

  def test_second_device_gets_its_own_avatar_and_reload_keeps_it(self):
    first = self.join('alice', cid='device-one')
    second = self.join('alice', cid='device-two')
    self.assertEqual((first, second), ('alice', 'alice~2'))
    self.assertEqual(hub.local_pid(self.db, 'alice', 'device-two', now=self.t), 'alice~2')

  def test_stale_slot_is_reused_by_a_new_device(self):
    self.join('alice', cid='device-one')
    self.tick(hub.ONLINE_SECONDS + 1)
    self.assertEqual(hub.local_pid(self.db, 'alice', 'device-new', now=self.t), 'alice')

  def test_rejects_positions_off_the_map_and_unknown_rooms(self):
    a = self.join('alice')
    with self.assertRaises(Problem):
      self.sync(a, state=st(x=999))
    with self.assertRaises(Problem):
      self.sync(a, state=st(map_id='hall', room='kitchen', x=3, y=3))

  def test_names_and_looks_are_sanitised(self):
    a = self.join('alice')
    hub.sync(self.db, a, 'alice', 'h', 'alice-device',
             {'st': st(), 'name': 'x\u0000' * 40, 'look': {'skin': 99, 'hair': 'red', 'shirt': 3}}, now=self.t)
    b = self.join('bob')
    peer = next(p for p in self.sync(b)['peers'] if p['pid'] == a)
    self.assertLessEqual(len(peer['name']), 24)
    # A look from before the character choice (no `body`) is the male character.
    self.assertEqual(peer['look'], {'body': 0, 'skin': 0, 'hair': 0, 'shirt': 3, 'pants': 0})

  def test_the_character_choice_travels_with_the_look(self):
    a = self.join('alice')
    hub.sync(self.db, a, 'alice', 'h', 'alice-device',
             {'st': st(), 'name': 'Alice', 'look': {'body': 1, 'skin': 2, 'hair': 5, 'shirt': 1, 'pants': 3}}, now=self.t)
    b = self.join('bob')
    hub.sync(self.db, b, 'bob', 'h', 'bob-device',
             {'st': st(), 'name': 'Bob', 'look': {'body': 7, 'skin': 1}}, now=self.t)
    peers = {p['pid']: p for p in self.sync(self.join('cleo'))['peers']}
    self.assertEqual(peers[a]['look'], {'body': 1, 'skin': 2, 'hair': 5, 'shirt': 1, 'pants': 3})
    self.assertEqual(peers[b]['look']['body'], 0, 'an unknown character falls back to the first')


class MailTests(HubCase):
  def test_messages_are_delivered_until_acknowledged(self):
    a = self.join('alice')
    b = self.join('bob')
    self.sync(a, out=[{'to': b, 'k': 'rtc', 'v': {'type': 'offer', 'sdp': 'x'}}])
    first = self.sync(b)['inbox']
    self.assertEqual([m['k'] for m in first], ['rtc'])
    self.assertEqual(first[0]['from'], a)
    again = self.sync(b)['inbox']
    self.assertEqual(len(again), 1, 'unacknowledged mail is redelivered')
    self.assertEqual(self.sync(b, ack=first[0]['id'])['inbox'], [])

  def test_mail_to_offline_or_unknown_kinds_is_dropped(self):
    a = self.join('alice')
    b = self.join('bob')
    self.sync(a, out=[{'to': 'nobody', 'k': 'rtc', 'v': {}}, {'to': b, 'k': 'shell', 'v': {}},
                      {'to': b, 'k': 'chat', 'v': {'text': 'x' * (hub.MAX_MAIL_BYTES + 10)}}])
    self.assertEqual(self.sync(b)['inbox'], [])

  def test_world_is_sent_only_when_it_changed(self):
    a = self.join('alice')
    res = self.sync(a, since=-1)
    self.assertIsNotNone(res['world'])
    self.assertIsNone(self.sync(a, since=res['wv'])['world'])
    self.act(a, 'chat', text='hello town')
    later = self.sync(a, since=res['wv'])
    self.assertEqual(later['world']['feed'][-1]['text'], 'hello town')


class LockTests(HubCase):
  def hall(self, room, x, y):
    return st(map_id='hall', room=room, x=x, y=y)

  def test_only_meeting_rooms_lock_and_insiders_are_allowed(self):
    a = self.join('alice', state=self.hall('meet-a', 3, 4))
    b = self.join('bob', state=self.hall('meet-a', 4, 4))
    c = self.join('carol', state=self.hall('lobby', 14, 10))
    with self.assertRaises(Problem):
      self.act(c, 'lock')
    world = self.act(a, 'lock')['world']
    lock = world['locks']['hall:meet-a']
    self.assertEqual(sorted(lock['allow']), sorted([a, b]))
    with self.assertRaises(Problem):
      self.act(c, 'unlock', room='meet-a')
    self.act(b, 'unlock', room='meet-a')
    self.assertNotIn('hall:meet-a', self.sync(a, state=self.hall('meet-a', 3, 4))['world']['locks'])

  def test_people_the_locker_sees_inside_count_as_inside(self):
    a = self.join('alice', state=self.hall('meet-a', 3, 4))
    # Bob has just walked in: the hub still has him in the lobby, Alice's town sees him inside.
    b = self.join('bob', state=self.hall('lobby', 10, 5))
    c = self.join('carol', state=self.hall('lobby', 14, 10))
    world = self.act(a, 'lock', inside=[a, b, 'nobody', 7])['world']
    self.assertEqual(world['locks']['hall:meet-a']['allow'], sorted([a, b]))
    self.assertNotIn(c, world['locks']['hall:meet-a']['allow'])

  def test_knock_reaches_insiders_and_admit_lets_the_guest_in(self):
    a = self.join('alice', state=self.hall('meet-b', 3, 12))
    c = self.join('carol', state=self.hall('lobby', 10, 13))
    self.act(a, 'lock')
    self.act(c, 'knock', room='meet-b')
    knock = [m for m in self.sync(a, state=self.hall('meet-b', 3, 12))['inbox'] if m['k'] == 'knock']
    self.assertEqual(knock[0]['from'], c)
    world = self.act(a, 'admit', pid=c, room='meet-b')['world']
    self.assertIn(c, world['locks']['hall:meet-b']['allow'])
    self.assertTrue(any(m['k'] == 'admit' for m in self.sync(c, state=self.hall('lobby', 10, 13))['inbox']))

  def test_empty_rooms_unlock_themselves(self):
    a = self.join('alice', state=self.hall('meet-a', 3, 4))
    self.act(a, 'lock')
    self.sync(a, state=self.hall('lobby', 14, 10))
    self.tick(hub.LOCK_EMPTY_SECONDS + 2)
    world = self.sync(a, state=self.hall('lobby', 14, 10), since=-1)['world']
    self.assertNotIn('hall:meet-a', world['locks'])


class BubbleTests(HubCase):
  def test_bubble_forms_joins_and_pops(self):
    a = self.join('alice')
    b = self.join('bob')
    c = self.join('carol')
    world = self.act(a, 'bubble', **{'with': [b]})['world']
    bid = next(iter(world['bubbles']))
    self.assertEqual(sorted(world['bubbles'][bid]['members']), sorted([a, b]))
    world = self.act(c, 'bubble_join', bubble=bid)['world']
    self.assertIn(c, world['bubbles'][bid]['members'])
    self.act(c, 'bubble_leave')
    world = self.act(b, 'bubble_leave')['world']
    self.assertEqual(world['bubbles'], {}, 'one member is no longer a bubble')

  def test_walking_into_another_map_leaves_the_bubble(self):
    a = self.join('alice')
    b = self.join('bob')
    self.act(a, 'bubble', **{'with': [b]})
    world = self.sync(b, state=st(map_id='cafe', room='cafe', x=8, y=8), since=-1)['world']
    self.assertEqual(world['bubbles'], {})


class TvAndChatTests(HubCase):
  def test_tv_accepts_youtube_ids_only(self):
    a = self.join('alice', state=st(map_id='cinema', room='cinema', x=9, y=4))
    with self.assertRaises(Problem):
      self.act(a, 'tv', screen='tv', video='not a video')
    world = self.act(a, 'tv', screen='tv', video='dQw4w9WgXcQ', title='Song')['world']
    self.assertEqual(world['tv']['tv']['video'], 'dQw4w9WgXcQ')
    self.assertEqual(self.act(a, 'tv', screen='tv', video=None)['world']['tv'], {})

  def test_tv_keeps_a_plausible_video_length(self):
    a = self.join('alice', state=st('cinema', 'cinema', 9, 4))
    world = self.act(a, 'tv', screen='tv', video='dQw4w9WgXcQ', length=212)['world']
    self.assertEqual(world['tv']['tv']['length'], 212)
    for bad in (0, -5, 100_000, '212', True, 1.5):
      world = self.act(a, 'tv', screen='tv', video='dQw4w9WgXcQ', length=bad)['world']
      self.assertNotIn('length', world['tv']['tv'])

  def test_town_chat_is_rate_limited_and_bounded(self):
    a = self.join('alice')
    self.act(a, 'chat', text='one')
    with self.assertRaises(Problem):
      self.act(a, 'chat', text='two')
    for i in range(hub.FEED_KEEP + 5):
      self.tick(1)
      self.sync(a)
      self.act(a, 'chat', text=f'msg {i}')
    feed = self.sync(a, since=-1)['world']['feed']
    self.assertEqual(len(feed), hub.FEED_KEEP)


class GameTests(HubCase):
  def chess_state(self, x):
    return st(map_id='chess', room='chess', x=x, y=8)

  def start_chess(self):
    a = self.join('alice', state=self.chess_state(7))
    self.tick(0.5)
    b = self.join('bob', state=self.chess_state(8))
    world = self.sync(a, state=self.chess_state(7), since=-1)['world']
    game = world['games']['chess-1']
    return a, b, game

  def test_two_players_entering_the_chess_club_start_a_game(self):
    a, b, game = self.start_chess()
    self.assertEqual(sorted(game['players'].values()), sorted([a, b]))
    self.assertEqual(game['state']['fen'].split()[0], 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')
    self.assertNotIn('chess-2', self.sync(a, state=self.chess_state(7), since=-1)['world']['games'])

  def test_moves_are_validated_and_turns_enforced(self):
    a, b, game = self.start_chess()
    white, black = game['players']['w'], game['players']['b']
    with self.assertRaises(Problem):
      self.act(black, 'move', table='chess-1', move='e7e5')
    with self.assertRaises(Problem):
      self.act(white, 'move', table='chess-1', move='e2e5')
    g = self.act(white, 'move', table='chess-1', move='e2e4')['result']['game']
    self.assertEqual(g['state']['san'], ['e4'])
    self.assertEqual(g['turn'], 'b')

  def test_fools_mate_ends_the_game_and_rematch_swaps_colours(self):
    a, b, game = self.start_chess()
    white, black = game['players']['w'], game['players']['b']
    for pid, move in ((white, 'f2f3'), (black, 'e7e5'), (white, 'g2g4'), (black, 'd8h4')):
      g = self.act(pid, 'move', table='chess-1', move=move)['result']['game']
    self.assertTrue(g['status']['over'])
    self.assertEqual((g['status']['reason'], g['status']['winner']), ('checkmate', black))
    self.act(white, 'rematch', table='chess-1')
    g = self.act(black, 'rematch', table='chess-1')['result']['game']
    self.assertFalse(g['status']['over'])
    self.assertEqual((g['players']['w'], g['players']['b']), (black, white))

  def test_resign_and_leaving_forfeit(self):
    a, b, game = self.start_chess()
    white, black = game['players']['w'], game['players']['b']
    g = self.act(black, 'resign', table='chess-1')['result']['game']
    self.assertEqual(g['status']['winner'], white)
    # A finished pair is not auto-paired again until they re-enter or ask for a rematch.
    world = self.sync(a, state=self.chess_state(7), since=-1)['world']
    self.assertTrue(world['games']['chess-1']['status']['over'])

  def test_walking_away_mid_game_forfeits_after_a_while(self):
    a, b, game = self.start_chess()
    white = game['players']['w']
    leaver = game['players']['b']
    stayer_state = self.chess_state(7 if white == a else 8)
    self.sync(leaver, state=st())
    self.tick(hub.ABANDON_SECONDS + 1)
    self.sync(leaver, state=st())
    world = self.sync(white, state=stayer_state, since=-1)['world']
    status = world['games']['chess-1']['status']
    self.assertEqual((status['over'], status['reason'], status['winner']), (True, 'abandoned', white))

  def test_connect_four_in_the_den(self):
    a = self.join('alice', state=st(map_id='den', room='den', x=7, y=8))
    self.tick(0.5)
    b = self.join('bob', state=st(map_id='den', room='den', x=8, y=8))
    game = self.sync(a, state=st(map_id='den', room='den', x=7, y=8), since=-1)['world']['games']['c4-1']
    red, yellow = game['players']['r'], game['players']['y']
    self.assertEqual(game['players']['r'], a, 'the first to arrive plays red')
    for pid, col in ((red, 0), (yellow, 1), (red, 0), (yellow, 1), (red, 0), (yellow, 1)):
      self.act(pid, 'move', table='c4-1', move=col)
    g = self.act(red, 'move', table='c4-1', move=0)['result']['game']
    self.assertEqual((g['status']['over'], g['status']['winner'], g['status']['reason']), (True, red, 'four'))
    self.assertEqual(len(g['line']), 4)


class BotGameTests(HubCase):
  def test_sitting_alone_can_start_a_bot_game_and_the_human_moves_for_the_bot(self):
    a = self.join('alice', state=st(map_id='chess', room='chess', x=3, y=8))
    g = self.act(a, 'sit', table='chess-1', bot='medium')['result']['game']
    bot = next(p for p in g['players'].values() if p.startswith('bot:'))
    self.assertEqual(bot, 'bot:medium')
    self.assertEqual(g['names'][bot], 'Bot (Medium)')
    human_side = next(side for side, p in g['players'].items() if p == a)
    if human_side == 'b':
      g = self.act(a, 'move', table='chess-1', move='e2e4', bot=True)['result']['game']
    with self.assertRaises(Problem):
      self.act(a, 'move', table='chess-1', move='a7a6' if human_side == 'b' else 'a2a3', bot=True)
    move = 'e7e5' if human_side == 'b' else 'e2e4'
    g = self.act(a, 'move', table='chess-1', move=move)['result']['game']
    self.assertTrue(g['players'][g['turn']].startswith('bot:'))

  def test_bad_bot_level_is_refused(self):
    a = self.join('alice', state=st(map_id='chess', room='chess', x=3, y=8))
    with self.assertRaises(Problem):
      self.act(a, 'sit', table='chess-1', bot='grandmaster')

  def test_bots_never_forfeit_for_being_away_and_rematch_at_once(self):
    a = self.join('alice', state=st(map_id='den', room='den', x=3, y=8))
    g = self.act(a, 'sit', table='c4-1', bot='easy')['result']['game']
    self.tick(hub.ABANDON_SECONDS + 5)
    world = self.sync(a, state=st(map_id='den', room='den', x=3, y=8), since=-1)['world']
    self.assertFalse(world['games']['c4-1']['status']['over'])
    self.act(a, 'resign', table='c4-1')
    g = self.act(a, 'rematch', table='c4-1')['result']['game']
    self.assertFalse(g['status']['over'], 'the bot accepts a rematch immediately')


class EventTests(HubCase):
  def soon(self, minutes=30):
    return hub.ms(self.t) + minutes * 60_000

  def test_create_rsvp_and_cancel(self):
    a = self.join('alice')
    b = self.join('bob')
    ev = self.act(a, 'event_create', title='Lightning talks', kind='talks', place='stage', starts=self.soon(),
                  minutes=60)['result']['event']
    self.assertEqual(ev['going'], [a])
    ev = self.act(b, 'event_rsvp', id=ev['id'], going=True)['result']['event']
    self.assertIn(b, ev['going'])
    with self.assertRaises(Problem):
      self.act(b, 'event_cancel', id=ev['id'])
    world = self.act(a, 'event_cancel', id=ev['id'])['world']
    self.assertEqual(world['events'], [])

  def test_validation(self):
    a = self.join('alice')
    for bad in (dict(title='', kind='talks', place='stage', starts=self.soon()),
                dict(title='x', kind='rave', place='stage', starts=self.soon()),
                dict(title='x', kind='talks', place='moon', starts=self.soon()),
                dict(title='x', kind='talks', place='stage', starts=self.soon(-60)),
                dict(title='x', kind='talks', place='stage', starts=self.soon(), minutes=5)):
      with self.assertRaises(Problem):
        self.act(a, 'event_create', **bad)

  def test_lightning_talk_slots_and_timer(self):
    a = self.join('alice')
    b = self.join('bob')
    c = self.join('carol')
    ev = self.act(a, 'event_create', title='Talks', kind='talks', place='stage', starts=self.soon(1),
                  minutes=60)['result']['event']
    self.act(b, 'event_slot', id=ev['id'], title='Pixel art in 5 minutes')
    ev = self.act(c, 'event_slot', id=ev['id'], title='Möbius tricks')['result']['event']
    self.assertEqual([sl['pid'] for sl in ev['slots']], [b, c])
    with self.assertRaises(Problem):
      self.act(c, 'talk_start', id=ev['id'], slot=0)  # only the host or that speaker
    ev = self.act(b, 'talk_start', id=ev['id'], slot=0)['result']['event']
    self.assertEqual((ev['current']['slot'], ev['current']['seconds']), (0, hub.TALK_SECONDS))
    ev = self.act(a, 'talk_stop', id=ev['id'])['result']['event']
    self.assertIsNone(ev['current'])

  def test_a_talk_nobody_stops_clears_itself_after_overtime(self):
    a = self.join('alice')
    ev = self.act(a, 'event_create', title='Talks', kind='talks', place='stage', starts=self.soon(1),
                  minutes=60)['result']['event']
    self.act(a, 'event_slot', id=ev['id'], title='My talk')
    self.act(a, 'talk_start', id=ev['id'], slot=0)
    self.tick(hub.TALK_SECONDS + 30)
    running = self.sync(a)['world']['events'][0]['current']
    self.assertIsNotNone(running)  # a little overtime is fine
    self.tick(hub.TALK_OVERTIME_SECONDS)
    self.assertIsNone(self.sync(a)['world']['events'][0]['current'])

  def test_old_events_are_cleared(self):
    a = self.join('alice')
    self.act(a, 'event_create', title='Meetup', kind='meetup', place='plaza', starts=self.soon(0), minutes=30)
    self.tick(3 * 3600)
    self.assertEqual(self.sync(a, since=-1)['world']['events'], [])


class PartyTests(HubCase):
  """Party challenges: invites, the per-viewer world and leaving."""

  def setUp(self):
    super().setUp()
    self.a = self.join('alice')
    self.b = self.join('bob')

  def challenge(self):
    inv = self.act(self.a, 'party_challenge', to=self.b)['result']['invite']
    return inv['id']

  def test_challenge_accept_starts_a_party_both_see(self):
    iid = self.challenge()
    world_b = self.sync(self.b)['world']
    self.assertEqual(world_b['invites'][iid]['from'], self.a)
    self.assertIsNone(world_b['party'])
    res = self.act(self.b, 'party_answer', id=iid, accept=True)
    party_id = res['result']['party']
    self.assertEqual(res['world']['party']['id'], party_id)
    self.assertEqual(res['world']['invites'], {})
    view_a = self.sync(self.a)['world']['party']
    self.assertEqual(view_a['me'], self.a)
    self.assertEqual(view_a['opponent'], self.b)
    self.assertEqual(view_a['phase'], 'intro')
    self.assertEqual(self.sync(self.a)['world']['partying'], sorted([self.a, self.b]))

  def test_no_client_ever_receives_the_stored_party(self):
    iid = self.challenge()
    self.act(self.b, 'party_answer', id=iid, accept=True)
    carol = self.join('carol')
    for pid in (self.a, self.b, carol):
      world = self.act(pid, 'chat', text='hello')['world']
      self.assertNotIn('parties', world)
      self.assertNotIn('secret', json.dumps(world))
    self.assertIsNone(self.sync(carol, since=-1)['world']['party'])

  def test_declining_tells_the_challenger_and_then_clears(self):
    iid = self.challenge()
    self.act(self.b, 'party_answer', id=iid, accept=False)
    self.assertEqual(self.sync(self.a, since=-1)['world']['invites'][iid]['status'], 'declined')
    self.tick(hub.DECLINED_SECONDS + 1)
    self.sync(self.b)
    self.assertEqual(self.sync(self.a, since=-1)['world']['invites'], {})

  def test_invites_expire_and_cannot_be_answered_late(self):
    iid = self.challenge()
    self.tick(hub.INVITE_SECONDS + 1)
    self.sync(self.a)
    self.sync(self.b)
    with self.assertRaises(Problem):
      self.act(self.b, 'party_answer', id=iid, accept=True)

  def test_crossed_challenges_start_the_party(self):
    self.challenge()
    res = self.act(self.b, 'party_challenge', to=self.a)
    self.assertIn('party', res['result'])

  def test_busy_players_and_self_challenges_are_refused(self):
    with self.assertRaises(Problem):
      self.act(self.a, 'party_challenge', to=self.a)
    iid = self.challenge()
    self.act(self.b, 'party_answer', id=iid, accept=True)
    carol = self.join('carol')
    with self.assertRaises(Problem):
      self.act(carol, 'party_challenge', to=self.a)
    with self.assertRaises(Problem):
      self.act(self.a, 'party_challenge', to=carol)

  def test_only_players_act_and_errors_are_friendly(self):
    iid = self.challenge()
    party_id = self.act(self.b, 'party_answer', id=iid, accept=True)['result']['party']
    carol = self.join('carol')
    with self.assertRaises(Problem):
      self.act(carol, 'party_act', id=party_id, action={'type': 'ready'})
    with self.assertRaises(Problem) as err:
      self.act(self.a, 'party_act', id=party_id, action={'type': 'rps', 'choice': 'rock'})
    self.assertNotIn('Traceback', str(err.exception))
    self.act(self.a, 'party_act', id=party_id, action={'type': 'ready'})
    self.act(self.b, 'party_act', id=party_id, action={'type': 'ready'})
    view = self.sync(self.a, since=-1)['world']['party']
    self.assertEqual((view['phase'], view['game']['kind']), ('play', 'quickdraw'))

  def test_leaving_town_forfeits_after_a_while(self):
    iid = self.challenge()
    self.act(self.b, 'party_answer', id=iid, accept=True)
    for _ in range(int(hub.PARTY_AWAY_SECONDS + hub.ONLINE_SECONDS) // 5 + 3):
      self.tick(5)
      self.sync(self.a)
    view = self.sync(self.a, since=-1)['world']['party']
    self.assertEqual((view['phase'], view['end'], view['winner']), ('final', 'forfeit', self.a))
    self.act(self.a, 'party_act', id=view['id'], action={'type': 'close'})
    self.assertIsNone(self.sync(self.a, since=-1)['world']['party'])
    self.assertEqual(self.sync(self.a, since=-1)['world']['partying'], [])

  def test_forfeit_by_leave_button_and_both_closing_removes_the_party(self):
    iid = self.challenge()
    party_id = self.act(self.b, 'party_answer', id=iid, accept=True)['result']['party']
    self.act(self.b, 'party_act', id=party_id, action={'type': 'forfeit'})
    self.assertIsNone(self.sync(self.b, since=-1)['world']['party'])
    self.assertEqual(self.sync(self.a, since=-1)['world']['party']['winner'], self.a)
    self.act(self.a, 'party_act', id=party_id, action={'type': 'close'})
    world = hub.load_world(self.db)
    self.assertEqual(world['parties'], {})


class PitchTests(HubCase):
  """Football: the hub keeps the line-up and the result; a player's browser runs the match."""

  def on_pitch(self, x=30, y=60):
    return st('town', 'town', x, y)

  def test_joining_needs_the_pitch_and_opens_a_lobby(self):
    a = self.join('alice')
    with self.assertRaises(Problem):
      self.act(a, 'pitch_join')
    self.sync(a, self.on_pitch())
    res = self.act(a, 'pitch_join')
    pitch = res['world']['pitch']
    self.assertEqual(res['result']['slot'], 'red0')
    self.assertEqual(pitch['status'], 'lobby')
    self.assertGreater(pitch['kickoff_at'], hub.ms(self.t))

  def test_teams_balance_and_switching_works(self):
    a = self.join('alice', state=self.on_pitch())
    b = self.join('bob', state=self.on_pitch(31, 60))
    self.act(a, 'pitch_join')
    self.assertEqual(self.act(b, 'pitch_join')['result']['slot'], 'blue0')
    self.assertEqual(self.act(b, 'pitch_join', team='red')['result']['slot'], 'red1')
    slots = hub.load_world(self.db)['pitch']['slots']
    self.assertEqual((slots['red0'], slots['red1'], slots['blue0']), (a, b, None))

  def test_the_lobby_kicks_off_with_the_first_player_hosting(self):
    a = self.join('alice', state=self.on_pitch())
    b = self.join('bob', state=self.on_pitch(31, 60))
    self.act(a, 'pitch_join')
    self.act(b, 'pitch_join')
    self.tick(hub.PITCH_LOBBY_SECONDS + 1)
    self.sync(b, self.on_pitch(31, 60))
    pitch = self.sync(a, self.on_pitch())['world']['pitch']
    self.assertEqual(pitch['status'], 'playing')
    self.assertEqual(pitch['match']['host'], a)
    self.assertIsInstance(pitch['match']['seed'], int)

  def test_only_the_host_reports_and_the_result_is_kept(self):
    a = self.join('alice', state=self.on_pitch())
    b = self.join('bob', state=self.on_pitch(31, 60))
    self.act(a, 'pitch_join')
    self.act(b, 'pitch_join')
    self.tick(hub.PITCH_LOBBY_SECONDS + 1)
    self.sync(b, self.on_pitch(31, 60))
    match = self.sync(a, self.on_pitch())['world']['pitch']['match']
    with self.assertRaises(Problem):
      self.act(b, 'pitch_result', id=match['id'], red=1, blue=0)
    self.act(a, 'pitch_score', id=match['id'], red=1, blue=0)
    pitch = self.act(a, 'pitch_result', id=match['id'], red=2, blue=1)['world']['pitch']
    self.assertEqual(pitch['status'], 'idle')
    self.assertEqual((pitch['last']['red'], pitch['last']['blue'], pitch['last']['winner']), (2, 1, 'red'))
    self.assertEqual(pitch['slots'], {s: None for s in hub.PITCH_SLOTS})

  def test_the_host_leaving_hands_over_and_the_last_player_leaving_ends_it(self):
    a = self.join('alice', state=self.on_pitch())
    b = self.join('bob', state=self.on_pitch(31, 60))
    self.act(a, 'pitch_join')
    self.act(b, 'pitch_join')
    self.tick(hub.PITCH_LOBBY_SECONDS + 1)
    self.sync(b, self.on_pitch(31, 60))
    self.sync(a, self.on_pitch())
    pitch = self.act(a, 'pitch_leave')['world']['pitch']
    self.assertEqual((pitch['status'], pitch['match']['host']), ('playing', b))
    pitch = self.act(b, 'pitch_leave')['world']['pitch']
    self.assertEqual(pitch['status'], 'idle')

  def test_walking_away_before_kickoff_or_going_offline_frees_the_place(self):
    a = self.join('alice', state=self.on_pitch())
    b = self.join('bob', state=self.on_pitch(31, 60))
    self.act(a, 'pitch_join')
    self.act(b, 'pitch_join')
    pitch = self.sync(a, st('town', 'town', 31, 30))['world']['pitch']
    self.assertNotIn(a, pitch['slots'].values())
    self.tick(hub.ONLINE_SECONDS + 1)
    pitch = self.sync(a, st('town', 'town', 31, 30))['world']['pitch']
    self.assertEqual(pitch['status'], 'idle')

  def test_a_full_match_refuses_a_fifth_player_and_bot_level_is_settable(self):
    pids = [self.join(n, state=self.on_pitch(25 + i, 60)) for i, n in enumerate(('ann', 'ben', 'cat', 'dan', 'eve'))]
    for pid in pids[:4]:
      self.act(pid, 'pitch_join')
    with self.assertRaises(Problem):
      self.act(pids[4], 'pitch_join')
    self.act(pids[0], 'pitch_level', level='hard')
    self.assertEqual(hub.load_world(self.db)['pitch']['level'], 'hard')
    with self.assertRaises(Problem):
      self.act(pids[4], 'pitch_level', level='easy')


class ExchangeTests(unittest.TestCase):
  """The hub side of the identity proof, with the network stubbed out."""

  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    os.environ.update({
      'APP_STORAGE_DIR': self.tmp.name, 'API_BASE_URL': 'http://localhost:1', 'APP_TOKEN': 'x',
      'INSTANCE_ORIGIN': 'https://mobius-production-8969.up.railway.app',
    })
    import service
    self.service = service
    self.calls = []

  def tearDown(self):
    self.tmp.cleanup()

  def run_exchange(self, hosts, proof):
    service = self.service

    async def hosts_of(ctx, handle):
      return hosts

    async def peer(host, path, body=None):
      self.calls.append((host, path))
      return proof

    service.hosts_of, service.peer = hosts_of, peer
    command = {'action': 'session', 'actor': 'bob', 'body': {'cid': 'bob-device-1'}, 'request_id': 'r1'}
    req = {'schema': 1, 'public': True, 'method': 'POST', 'path': 'exchange',
           'body': {'sender': 'bob.example.org', 'proof': 'a' * 64, 'request': command}}
    return asyncio.run(service.main(req)), command

  def test_valid_proof_opens_a_session(self):
    import time
    command = {'action': 'session', 'actor': 'bob', 'body': {'cid': 'bob-device-1'}, 'request_id': 'r1'}
    proof = {'digest': self.service.digest(command), 'actor': 'bob', 'target': self.service.HUB_HOST,
             'expires': time.time() + 60}
    result, _ = self.run_exchange(['bob.example.org'], proof)
    self.assertEqual(result['pid'], 'bob')
    self.assertEqual(self.calls, [('bob.example.org', 'proof/' + 'a' * 64)])
    # The token then authenticates hub requests.
    req = {'schema': 1, 'public': True, 'method': 'POST', 'path': 's/sync',
           'body': {'session': result['token'], 'st': st(), 'name': 'Bob', 'look': {}}}
    self.assertEqual(asyncio.run(self.service.main(req))['pid'], 'bob')

  def test_wrong_installation_is_refused_before_any_callback(self):
    with self.assertRaises(Problem) as err:
      self.run_exchange(['elsewhere.example.org'], {})
    self.assertEqual(err.exception.status, 403)
    self.assertEqual(self.calls, [])

  def test_mismatched_proof_is_refused(self):
    import time
    proof = {'digest': 'wrong', 'actor': 'bob', 'target': self.service.HUB_HOST, 'expires': time.time() + 60}
    with self.assertRaises(Problem):
      self.run_exchange(['bob.example.org'], proof)

  def test_bad_session_token_is_unauthorised(self):
    req = {'schema': 1, 'public': True, 'method': 'POST', 'path': 's/sync',
           'body': {'session': 'x' * 40, 'st': st(), 'name': 'Bob', 'look': {}}}
    with self.assertRaises(Problem) as err:
      asyncio.run(self.service.main(req))
    self.assertEqual(err.exception.status, 401)


if __name__ == '__main__':
  unittest.main()
