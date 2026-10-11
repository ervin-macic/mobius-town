"""Furniture drawn as several pieces (tools/build_world.py): a bench's or a sofa's seat sits under
its backrest as a piece of its own, but answers to the backrest's key, so a builder hiding the
furniture takes all of it (the seat used to be painted into the floor and stayed behind).

    cd ROOT && python3 -m unittest tests.test_furniture -v
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / 'forge'), str(ROOT)]

import world as W  # noqa: E402
from world_meta import META  # noqa: E402

PIECES = ('bench3_back', 'sofa2_back', 'sofa3_back', 'sofa4_back')


class FurniturePartsTests(unittest.TestCase):
  def test_benches_and_sofas_keep_their_seats_under_one_key(self):
    for mid in ('hall', 'cinema', 'office'):
      m = W.Map(mid)
      backs = [e for e in m.ents if e[0] in PIECES]
      self.assertTrue(backs, f'{mid} has benches or sofas')
      for back in backs:
        parts = sorted(e[0] for e in m.ents if e[6] == back[6])
        self.assertEqual(parts, sorted([back[0], back[0].replace('_back', '_seat')]), back[6])

  def test_the_kit_and_the_hub_see_one_whole_bench(self):
    key = 'bench3_back@335,138'
    sid, tiles = W.Map('hall').furniture()[key]
    self.assertEqual(sid, 'bench3_back')
    self.assertEqual(sorted(tiles), [(21, 8), (22, 8), (23, 8)])
    self.assertEqual(META['furniture']['hall'][key], [[21, 8], [22, 8], [23, 8]])

  def test_keys_stay_unique_names_for_furniture(self):
    # Parts add no names of their own: every other key is still one sprite at one place.
    for mid in W.map_ids():
      m = W.Map(mid)
      seats = {e[6] for e in m.ents if e[0].replace('_seat', '_back') in PIECES and e[0].endswith('_seat')}
      for e in m.ents:
        if e[6] not in seats:
          self.assertTrue(e[6].startswith(f'{e[0]}@'), e[6])


if __name__ == '__main__':
  unittest.main()
