"""Tests for creations (creations.py) and their hub commands: what Möbians build in town.

Run from the project root:  python3 -m unittest tests.test_creations -v
"""
import base64
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import creations as cr  # noqa: E402
import hub  # noqa: E402
from hub import Problem  # noqa: E402
from world_meta import META  # noqa: E402


def png(w=16, h=16, colour=(200, 80, 80, 255)):
  buf = io.BytesIO()
  Image.new('RGBA', (w, h), colour).save(buf, 'PNG')
  return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def body(area=(44, 44, 6, 5), map_id='town', **extra):
  x, y, w, h = area
  b = {
    'v': 1, 'title': 'Little park', 'note': 'A bench.', 'map': map_id, 'area': list(area),
    'ground': [{'x': x * 16, 'y': y * 16, 'img': png(w * 16, h * 16)}],
    'props': [{'x': x * 16, 'y': y * 16 - 20, 'z': (y + 1) * 16, 'layer': 'normal', 'frames': [png(16, 36)], 'fps': 0,
               'fx': None}],
    'solid': [[x, y]], 'hide': [], 'seats': [{'x': x + 1, 'y': y + 1, 'face': 'down', 'ax': (x + 1) * 16 + 8,
                                             'ay': (y + 1) * 16 + 12}],
    'glows': [], 'mood': None, 'labels': [{'x': x * 16 + 8, 'y': y * 16, 'text': 'Park'}], 'uses': [],
    'triggers': [], 'surprise_for': [], 'music': None, 'game': None, 'expires': None,
  }
  b.update(extra)
  return b


GAME = {
  'cartridge': {'id': 'volleyball', 'code': 'const game = {}'}, 'court': [45, 45, 8, 5], 'options': {'points': 7},
  'meta': {'id': 'volleyball', 'title': 'Beach volleyball', 'teams': [{'id': 'red', 'name': 'Red'},
                                                                       {'id': 'blue', 'name': 'Blue'}],
           'perTeam': 2, 'durationSeconds': 300, 'lobbySeconds': 6, 'buttons': [{'id': 'a', 'label': 'Hit'}],
           'controls': 'Space hits'},
}


def st(map_id='town', room='town', x=31, y=26, **extra):
  return {'map': map_id, 'room': room, 'x': x, 'y': y, 'dir': 'down', **extra}


class Case(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.db = hub.connect(Path(self.tmp.name) / 'hub.sqlite3')
    self.t = 1_800_000_000.0

  def tearDown(self):
    self.db.close()
    self.tmp.cleanup()

  def build(self, handle, op, keeper='keeper', **args):
    return hub.build(self.db, handle, handle.title(), keeper, {'op': op, **args}, now=self.t)

  def put(self, handle='alice', b=None, **args):
    return self.build(handle, 'put', creation=b or body(), spec={'title': 'x'}, **args)

  def join(self, handle, state=None):
    pid = hub.local_pid(self.db, handle, f'{handle}-device', now=self.t)
    hub.sync(self.db, pid, handle, 'host.example', f'{handle}-device',
             {'st': state or st(), 'name': handle.title(), 'look': {}}, now=self.t)
    return pid

  def sync(self, pid, state=None):
    return hub.sync(self.db, pid, pid.split('~')[0], 'host.example', f'{pid.split("~")[0]}-device',
                    {'st': state or st(), 'name': pid.title(), 'look': {}}, now=self.t)

  def act(self, pid, op, keeper='keeper', **args):
    return hub.act(self.db, pid, {'op': op, **args}, now=self.t, keeper=keeper)


class ValidateTests(Case):
  def test_a_good_creation_passes_and_is_cleaned(self):
    clean = cr.validate(body(), now=self.t)
    self.assertEqual(clean['area'], [44, 44, 6, 5])
    self.assertEqual(clean['props'][0]['w'], 16)
    self.assertEqual(clean['props'][0]['h'], 36)

  def test_blocking_a_door_is_refused(self):
    # The Café's door in town and the tile in front of it must stay clear.
    door = next(d for d in [(55, 31)] if list(d) in META['protected']['town'])
    with self.assertRaises(Problem) as err:
      cr.validate(body(area=(53, 30, 5, 4), solid=[list(door)]), now=self.t)
    self.assertIn('must stay clear', err.exception.message)

  def test_tiles_outside_the_area_are_refused(self):
    with self.assertRaises(Problem):
      cr.validate(body(solid=[[10, 10]]), now=self.t)
    with self.assertRaises(Problem):
      cr.validate(body(area=(60, 60, 10, 10)), now=self.t)

  def test_only_pngs_of_sensible_size(self):
    with self.assertRaises(Problem):
      cr.validate(body(ground=[{'x': 704, 'y': 704, 'img': 'data:image/gif;base64,R0lGOD'}]), now=self.t)
    with self.assertRaises(Problem):
      cr.validate(body(props=[{'x': 704, 'y': 690, 'z': 720, 'frames': [png(300, 40)]}]), now=self.t)
    with self.assertRaises(Problem):
      cr.validate(body(ground=[{'x': 704, 'y': 704, 'img': 'data:image/png;base64,bm90IGEgcG5n'}]), now=self.t)

  def test_hide_only_unprotected_furniture_in_the_area(self):
    cafe = body(area=(1, 3, 14, 7), map_id='cafe', ground=[], props=[], solid=[], seats=[], labels=[],
                hide=['cafe_table@141,74'])
    self.assertEqual(cr.validate(cafe, now=self.t)['hide'], ['cafe_table@141,74'])
    with self.assertRaises(Problem):
      cr.validate({**cafe, 'hide': ['counter@16,32-not-a-key']}, now=self.t)

  def test_actions_and_triggers(self):
    trig = {'when': 'enter', 'where': 'room', 'who': ['@Sam'], 'once': 'per_person', 'everyone_sees': True,
            'do': [{'lights': 'dim', 'seconds': 2}, {'wait': 1.5}, {'banner': 'HAPPY BIRTHDAY', 'sub': 'x'},
                   {'effect': 'confetti'}, {'sound': 'fanfare'}, {'music': 'disco', 'seconds': 60}]}
    clean = cr.validate(body(triggers=[trig]), now=self.t)
    self.assertEqual(clean['triggers'][0]['who'], ['@sam'])
    with self.assertRaises(Problem):
      cr.validate(body(triggers=[{**trig, 'do': [{'effect': 'explosion'}]}]), now=self.t)
    with self.assertRaises(Problem):
      cr.validate(body(triggers=[{**trig, 'once': 'twice'}]), now=self.t)

  def test_game_meta_is_checked(self):
    clean = cr.validate(body(area=(44, 44, 10, 7), game=GAME), now=self.t)
    self.assertEqual(clean['game']['meta']['perTeam'], 2)
    self.assertEqual(len(clean['game']['cartridge']['hash']), 16)
    bad = json.loads(json.dumps(GAME))
    bad['meta']['teams'] = [{'id': 'red'}]
    with self.assertRaises(Problem):
      cr.validate(body(area=(44, 44, 10, 7), game=bad), now=self.t)

  def test_expiry_must_be_in_the_next_month(self):
    ok = int(self.t * 1000) + 3_600_000
    self.assertEqual(cr.validate(body(expires=ok), now=self.t)['expires'], ok)
    with self.assertRaises(Problem):
      cr.validate(body(expires=int(self.t * 1000) - 1), now=self.t)


class StoreTests(Case):
  def test_put_index_bodies_and_version(self):
    before = cr.creations_version(self.db)
    r = self.put()
    self.assertEqual(r['rev'], 1)
    self.assertGreater(cr.creations_version(self.db), before)
    idx = hub.read(self.db, 'bob', 'Bob', {'op': 'index'})
    self.assertEqual([c['title'] for c in idx['index']], ['Little park'])
    self.assertEqual(idx['index'][0]['by']['handle'], 'alice')
    got = hub.read(self.db, 'bob', 'Bob', {'op': 'bodies', 'ids': [r['id'], 'cdeadbeef00']})
    self.assertEqual(list(got['bodies']), [r['id']])

  def test_only_builder_or_keeper_change_or_remove(self):
    r = self.put('alice')
    with self.assertRaises(Problem):
      self.put('bob', replace=r['id'])
    with self.assertRaises(Problem):
      self.build('bob', 'remove', id=r['id'])
    self.assertEqual(self.put('alice', replace=r['id'])['rev'], 2)
    self.assertEqual(self.put('keeper', replace=r['id'])['rev'], 3)
    self.build('keeper', 'remove', id=r['id'])
    self.assertEqual(hub.read(self.db, 'bob', 'Bob', {'op': 'index'})['index'], [])

  def test_others_creations_are_not_overlapped(self):
    self.put('alice')
    with self.assertRaises(Problem) as err:
      self.put('bob', b=body(area=(46, 45, 6, 5)))
    self.assertEqual(err.exception.status, 409)
    self.put('bob', b=body(area=(51, 44, 6, 5)))  # next to it is fine
    self.put('alice', b=body(area=(46, 45, 4, 4)))  # your own may overlap your own
    self.put('keeper', b=body(area=(45, 45, 3, 3)))  # the keeper decides

  def test_keeper_can_pause_building(self):
    pid = self.join('keeper')
    alice = self.join('alice', st(x=40, y=40))
    self.act(pid, 'build_policy', policy='keeper')
    with self.assertRaises(Problem):
      self.put('alice')
    with self.assertRaises(Problem):
      self.act(alice, 'site_begin', text='a fountain')
    with self.assertRaises(Problem):
      self.act(alice, 'build_policy', policy='everyone')
    self.put('keeper')

  def test_spec_is_kept_for_its_builder(self):
    r = self.put('alice')
    self.assertEqual(self.build('alice', 'spec', id=r['id'])['spec'], {'title': 'x'})
    with self.assertRaises(Problem):
      self.build('bob', 'spec', id=r['id'])

  def test_expired_creations_disappear_on_sync(self):
    pid = self.join('alice')
    self.put('alice', b=body(expires=int(self.t * 1000) + 60_000))
    self.t += 61
    res = self.sync(pid)
    self.assertEqual(hub.read(self.db, 'alice', 'Alice', {'op': 'index'})['index'], [])
    self.assertIn('cv', res)


class SiteTests(Case):
  def test_site_lifecycle_from_town_to_finished_build(self):
    pid = self.join('alice', st(x=46, y=43))
    site = self.act(pid, 'site_begin', text='a little park in front of me')['result']['site']
    self.assertEqual((site['map'], site['x'], site['y'], site['status']), ('town', 46, 43, 'planning'))
    self.act(pid, 'site_chat', site=site['id'], chat='0f2c5a1e-1111-2222-3333-444455556666')
    look = self.build('alice', 'look', site=site['id'])
    self.assertEqual(look['site']['id'], site['id'])
    self.assertIn('people', look)
    with self.assertRaises(Problem):
      self.build('bob', 'look', site=site['id'])
    prog = self.build('alice', 'progress', site=site['id'], label='Laying sand', pct=40, eta=30, area=[44, 44, 6, 5])
    self.assertEqual(prog['site']['status'], 'building')
    r = self.put('alice', site=site['id'])
    world = hub.load_world(self.db)
    self.assertEqual(world['sites'][site['id']]['status'], 'done')
    self.assertEqual(world['sites'][site['id']]['creation'], r['id'])
    # Refining after it finished replaces the same creation.
    r2 = self.put('alice', site=site['id'])
    self.assertEqual((r2['id'], r2['rev']), (r['id'], 2))
    self.t += cr.SITE_LINGER_SECONDS + 1
    self.sync(pid)
    self.assertNotIn(site['id'], hub.load_world(self.db)['sites'])
    # The site has closed, but replacing still works by id.
    self.assertEqual(self.put('alice', site=site['id'], replace=r['id'])['rev'], 3)

  def test_a_change_puts_its_site_around_the_creation(self):
    r = self.put('alice', b=body(area=(44, 44, 6, 5)))
    pid = self.join('alice')
    site = self.act(pid, 'site_begin', text='make it bigger', replace=r['id'])['result']['site']
    self.assertEqual((site['map'], site['area'], site['replace']), ('town', [44, 44, 6, 5], r['id']))
    bob = self.join('bob')
    with self.assertRaises(Problem):
      self.act(bob, 'site_begin', text='mine now', replace=r['id'])
    self.assertEqual(len(hub.load_world(self.db)['sites']), 1)
    # The builder's put for that site replaces the creation.
    self.assertEqual(self.put('alice', site=site['id'])['rev'], 2)

  def test_silent_builders_time_out_and_sites_are_limited(self):
    pid = self.join('alice')
    ids = [self.act(pid, 'site_begin', text=f'thing {i}')['result']['site']['id'] for i in range(3)]
    with self.assertRaises(Problem):
      self.act(pid, 'site_begin', text='one too many')
    self.t += cr.SITE_STALE_SECONDS + 1
    self.sync(pid)
    sites = hub.load_world(self.db)['sites']
    self.assertTrue(all(sites[i]['status'] == 'failed' for i in ids))


class SurpriseTests(Case):
  def test_surprise_is_masked_until_its_trigger_fires(self):
    trig = {'when': 'enter', 'where': 'room', 'who': ['@sam'], 'once': 'per_person', 'do': [{'effect': 'confetti'}]}
    r = self.put('alice', b=body(surprise_for=['@sam'], triggers=[trig], title="Sam's birthday"))
    sam = self.join('sam')
    seen = hub.read(self.db, 'sam', 'Sam', {'op': 'index'})['index'][0]
    self.assertTrue(seen['masked'])
    self.assertEqual(seen['title'], 'A surprise')
    self.assertFalse(hub.read(self.db, 'bob', 'Bob', {'op': 'index'})['index'][0]['masked'])
    first = self.act(sam, 'trigger_fire', creation=r['id'], trigger=0)['result']
    again = self.act(sam, 'trigger_fire', creation=r['id'], trigger=0)['result']
    self.assertEqual((first['run'], again['run']), (True, False))
    seen = hub.read(self.db, 'sam', 'Sam', {'op': 'index'})['index'][0]
    self.assertFalse(seen['masked'])
    self.assertEqual(seen['fired'], [0])
    bob = self.join('bob')
    with self.assertRaises(Problem):
      self.act(bob, 'trigger_fire', creation=r['id'], trigger=0)


class CourtTests(Case):
  def test_join_lobby_kickoff_host_and_result(self):
    self.put('alice', b=body(area=(44, 44, 10, 7), game=GAME))
    cid = hub.read(self.db, 'x', 'X', {'op': 'index'})['index'][0]['id']
    off = self.join('bob', st(x=30, y=30))
    with self.assertRaises(Problem):
      self.act(off, 'court_join', court=cid)
    a = self.join('alice', st(x=46, y=46))
    slot = self.act(a, 'court_join', court=cid)['result']['slot']
    self.assertEqual(slot, 'red0')
    world = hub.load_world(self.db)
    self.assertEqual(world['courts'][cid]['status'], 'lobby')
    b = self.join('bob', st(x=47, y=47))
    self.assertEqual(self.act(b, 'court_join', court=cid)['result']['slot'], 'blue0')
    self.act(a, 'court_level', court=cid, level='hard')
    self.t += 7
    self.sync(a, st(x=46, y=46))
    court = hub.load_world(self.db)['courts'][cid]
    self.assertEqual(court['status'], 'playing')
    match = court['match']
    self.assertEqual(match['host'], a)
    with self.assertRaises(Problem):
      self.act(b, 'court_score', court=cid, id=match['id'], score={'red': 1, 'blue': 0})
    self.act(a, 'court_score', court=cid, id=match['id'], score={'red': 3, 'blue': 1})
    self.act(a, 'court_result', court=cid, id=match['id'], score={'red': 11, 'blue': 7})
    court = hub.load_world(self.db)['courts'][cid]
    self.assertEqual(court['status'], 'idle')
    self.assertEqual(court['last']['winner'], 'red')

  def test_a_new_device_does_not_inherit_a_place_in_a_match(self):
    self.put('alice', b=body(area=(44, 44, 10, 7), game=GAME))
    cid = hub.read(self.db, 'x', 'X', {'op': 'index'})['index'][0]['id']
    a = self.join('alice', st(x=46, y=46))
    self.act(a, 'court_join', court=cid)
    self.t += 7
    self.sync(a, st(x=46, y=46))
    self.assertEqual(hub.load_world(self.db)['courts'][cid]['status'], 'playing')
    # Alice's device goes away; later a different device of hers comes back and gets the same id.
    self.t += hub.ONLINE_SECONDS + 1
    pid2 = hub.local_pid(self.db, 'alice', 'alice-phone', now=self.t)
    self.assertEqual(pid2, a)
    hub.sync(self.db, pid2, 'alice', 'host.example', 'alice-phone',
             {'st': st(x=46, y=46), 'name': 'Alice', 'look': {}}, now=self.t)
    court = hub.load_world(self.db)['courts'][cid]
    self.assertNotIn(a, court['slots'].values())
    self.assertEqual(court['status'], 'idle')

  def test_courts_of_removed_creations_disappear(self):
    r = self.put('alice', b=body(area=(44, 44, 10, 7), game=GAME))
    a = self.join('alice', st(x=46, y=46))
    self.act(a, 'court_join', court=r['id'])
    self.build('alice', 'remove', id=r['id'])
    self.sync(a, st(x=46, y=46))
    self.assertNotIn(r['id'], hub.load_world(self.db)['courts'])


if __name__ == '__main__':
  unittest.main()


class PrivateOfficeTests(Case):
  def test_nobody_builds_inside_a_private_office(self):
    # Every visitor's Agent Office is the same map, so a build there would appear in all of them.
    self.assertIn('office', META['private'])
    pid = self.join('alice', st('office', 'office', 11, 11))
    with self.assertRaisesRegex(Problem, 'Agent Office'):
      self.act(pid, 'site_begin', text='a plant by my desk')
    with self.assertRaisesRegex(Problem, 'Agent Office'):
      self.put('alice', b=body(area=(5, 5, 2, 2), map_id='office'))

  def test_building_outside_the_office_still_works(self):
    pid = self.join('alice', st(x=46, y=43))
    site = self.act(pid, 'site_begin', text='a little park in front of me')['result']['site']
    self.assertEqual(site['map'], 'town')
