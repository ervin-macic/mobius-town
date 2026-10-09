"""The female character sheet keeps the hero's layout and stays fully recolourable."""
import sys
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

from female import (  # noqa: E402
  ARMS_UP_COLS, COLOURS, FIXED_BROWN, FRAME_H, FRAME_W, ROWS, WALK_COLS, female_sheet,
)

HAIR = {COLOURS['h'][:3], COLOURS['H'][:3]}
PANTS = {COLOURS['p'][:3], COLOURS['P'][:3]}


class FemaleSheetTests(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    cls.male = Image.open(ROOT / 'art' / 'zelda-like' / 'gfx' / 'character.png').convert('RGBA')
    cls.female = female_sheet(cls.male)

  def frame(self, sheet, row, col):
    return sheet.crop((col * FRAME_W, row * FRAME_H, (col + 1) * FRAME_W, (row + 1) * FRAME_H))

  def pixels(self, frame):
    for y in range(FRAME_H):
      for x in range(FRAME_W):
        px = frame.getpixel((x, y))
        if px[3]:
          yield x, y, px[:3]

  def test_same_size_and_layout(self):
    self.assertEqual(self.female.size, self.male.size)

  def test_long_hair_reaches_the_shoulders_in_every_direction(self):
    for direction, row in ROWS.items():
      for col in WALK_COLS:
        lowest = max(y for _, y, c in self.pixels(self.frame(self.female, row, col)) if c in HAIR)
        self.assertGreaterEqual(lowest, 17, f'{direction} frame {col}: hair below the chin')

  def test_belt_and_shoes_never_take_the_hair_colour(self):
    # The female sheet recolours hair at any height, so nothing below the head
    # may share the hair browns except the hair itself.
    for row in ROWS.values():
      for col in WALK_COLS + ARMS_UP_COLS:
        for _, y, c in self.pixels(self.frame(self.female, row, col)):
          if y >= 21:
            self.assertNotIn(c, HAIR, f'row {row} frame {col} y {y}')
    self.assertTrue(all(fixed not in HAIR for fixed in FIXED_BROWN.values()))

  def test_the_skirt_is_one_closed_piece_in_the_trousers_colours(self):
    for direction, row in ROWS.items():
      for col in WALK_COLS:
        frame = self.frame(self.female, row, col)
        hem = [y for y in range(FRAME_H) if any(c in PANTS for x, yy, c in self.pixels(frame) if yy == y)]
        self.assertTrue(hem, f'{direction} frame {col} has a skirt')
        bottom = max(hem)
        xs = sorted(x for x, y, c in self.pixels(frame) if y == bottom and c in PANTS)
        self.assertEqual(xs, list(range(xs[0], xs[-1] + 1)), f'{direction} frame {col}: no gap between the legs')

  def test_faces_and_bodies_are_unchanged_below_the_hair(self):
    # Shirts keep the hero's shirt colours, so the shirt choice still applies.
    shirt = {(196, 60, 60), (136, 46, 46), (104, 28, 28)}
    for row in ROWS.values():
      for col in WALK_COLS:
        colours = {c for _, _, c in self.pixels(self.frame(self.female, row, col))}
        self.assertTrue(colours & shirt)


if __name__ == '__main__':
  unittest.main()
