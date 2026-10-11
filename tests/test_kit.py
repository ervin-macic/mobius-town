"""The builder's art kit (forge/kit.py and its kit_*.py families).

    cd ROOT && python3 -m unittest tests.test_kit -v
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'forge'))

import kit  # noqa: E402
from kit import T, KitError  # noqa: E402

MAX_W_EXTRA_TILES = 3
MAX_H_TILES = 6


def _frames_bytes(made):
  out = []
  for p in made.pieces:
    for f in p.frames:
      out.append((f.size, f.tobytes()))
    out.append((p.dx, p.dy, p.z, p.layer, p.fps))
  out.append((tuple(made.foot), json.dumps(made.solid), json.dumps(made.seats, sort_keys=True),
              json.dumps(made.glows, sort_keys=True), json.dumps(made.use), made.text))
  return out


def _param_sets(d):
  """Default, every declared variant, and every enum choice / bool flip / extreme of each parameter."""
  sets = [{}] + list(d.variants)
  for k, p in d.params.items():
    if p.type == 'enum':
      sets += [{k: c} for c in p.choices if c != p.default]
    elif p.type == 'bool':
      sets.append({k: not p.default})
    elif p.type in ('int', 'float') and p.min is not None and p.max is not None and k != 'seed':
      sets += [{k: p.min}, {k: p.max}]
    elif p.type == 'text':
      sets.append({k: 'Happy birthday, dear Samantha! 2026'[:int(p.max or 40)]})
  return sets


class Checks:
  def check_made(self, name, made, params):
    where = f'{name} {params}'
    self.assertIsInstance(made, kit.Made, where)
    fw, fh = made.foot
    self.assertIsInstance(fw, int, where)
    self.assertIsInstance(fh, int, where)
    self.assertTrue(1 <= fw <= 16 and 1 <= fh <= 16, f'{where}: foot {made.foot}')
    self.assertTrue(made.pieces, f'{where}: no pieces')
    for p in made.pieces:
      self.assertIsInstance(p, kit.Piece, where)
      frames = p.frames
      self.assertTrue(frames, f'{where}: empty frame list')
      size = frames[0].size
      for f in frames:
        self.assertEqual(f.mode, 'RGBA', f'{where}: frame mode {f.mode}')
        self.assertEqual(f.size, size, f'{where}: frames differ in size')
      w, h = size
      self.assertTrue(w >= 1 and h >= 1, where)
      self.assertLessEqual(w, (fw + MAX_W_EXTRA_TILES) * T, f'{where}: piece {w}px wide for foot {fw}')
      self.assertLessEqual(h, MAX_H_TILES * T, f'{where}: piece {h}px tall')
      for v in (p.dx, p.dy):
        self.assertIsInstance(v, int, f'{where}: dx/dy must be int, got {type(v).__name__}')
      if p.z is not None:
        self.assertIsInstance(p.z, int, f'{where}: z must be int')
      self.assertIn(p.layer, kit.LAYERS, where)
      self.assertIsInstance(p.fps, (int, float), where)
      if len(frames) > 1:
        self.assertGreater(p.fps, 0, f'{where}: animated piece needs fps')
      # Placement sanity: pieces stay near their footprint.
      self.assertGreaterEqual(p.dx, -2 * T, f'{where}: dx {p.dx}')
      self.assertLessEqual(p.dx + w, (fw + 2) * T, f'{where}: piece runs {p.dx + w - fw * T}px past the foot')
      self.assertGreaterEqual(p.dy, -MAX_H_TILES * T, f'{where}: dy {p.dy}')
      self.assertLessEqual(p.dy + h, (fh + 1) * T, f'{where}: piece hangs below the foot')
      self.assertTrue(any(f.getbbox() for f in frames), f'{where}: piece is fully transparent')
    tiles = {(x, y) for y in range(fh) for x in range(fw)}
    if made.solid is not None:
      self.assertIsInstance(made.solid, list, where)
      for t in made.solid:
        self.assertIn(tuple(t), tiles, f'{where}: solid {t} outside the footprint')
    for s in made.seats:
      self.assertIn((s['dx'], s['dy']), tiles, f'{where}: seat outside the footprint')
      self.assertIn(s['face'], kit.FACES, where)
      for k in ('ax', 'ay'):
        if k in s:
          self.assertIsInstance(s[k], int, where)
      if 'ax' in s:
        self.assertTrue(-4 <= s['ax'] <= fw * T + 4 and -4 <= s['ay'] <= fh * T + 4, f'{where}: seat feet {s}')
    for t in made.use:
      # Where a reader stands: the footprint or the ring of tiles right around it (usually just south).
      ux, uy = t
      self.assertTrue(-1 <= ux <= fw and -1 <= uy <= fh, f'{where}: use tile {t} is not next to the item')
      if made.solid is None:
        self.assertNotIn(tuple(t), tiles, f'{where}: use tile {t} is solid')
      else:
        self.assertNotIn(tuple(t), {tuple(s) for s in made.solid}, f'{where}: use tile {t} is solid')
    for g in made.glows:
      self.assertEqual(set(g) - {'dx', 'dy', 'radius', 'colour', 'flicker'}, set(), where)
      self.assertIsInstance(g['dx'], (int, float), where)
      self.assertIsInstance(g['dy'], (int, float), where)
      self.assertTrue(0.25 <= g['radius'] <= 8, f'{where}: glow radius {g["radius"]}')
      self.assertRegex(g['colour'], r'^#[0-9a-f]{6}$', where)
      self.assertIsInstance(g.get('flicker', False), bool, where)
    if made.text is not None:
      self.assertIsInstance(made.text, str, where)


class ItemTests(unittest.TestCase, Checks):
  def test_registry(self):
    self.assertGreaterEqual(len(kit.ITEMS), 6)
    for name, d in kit.ITEMS.items():
      self.assertIn(d.category, kit.CATEGORIES, name)
      self.assertTrue(d.doc and len(d.doc) <= 160, f'{name}: doc must be 1-160 characters')
      for k, p in d.params.items():
        self.assertIsInstance(p, kit.Param, f'{name}.{k}')
        self.assertEqual(p.check(k, None), p.default, f'{name}.{k}')
        if p.default is not None:
          p.check(k, p.default)  # the default itself must be valid

  def test_every_item_and_choice_builds(self):
    for name, d in sorted(kit.ITEMS.items()):
      for params in _param_sets(d):
        with self.subTest(item=name, params=params):
          made = kit.make(name, params)
          self.check_made(name, made, params)

  def test_deterministic(self):
    for name, d in sorted(kit.ITEMS.items()):
      params = d.variants[0] if d.variants else {}
      with self.subTest(item=name):
        self.assertEqual(_frames_bytes(kit.make(name, params)), _frames_bytes(kit.make(name, params)))

  def test_unknown_kind_and_params(self):
    with self.assertRaises(KitError):
      kit.make('no_such_item')
    for name in kit.ITEMS:
      with self.subTest(item=name):
        with self.assertRaises(KitError):
          kit.make(name, {'definitely_not_a_param': 1})

  def test_bad_values(self):
    bad = {'int': 'x', 'float': 'x', 'bool': 'yes', 'str': 5, 'text': 5, 'colour': 'not-a-colour',
           'colours': 'nope-colour', 'enum': 'no_such_choice'}
    for name, d in sorted(kit.ITEMS.items()):
      for k, p in d.params.items():
        with self.subTest(item=name, param=k):
          with self.assertRaises(KitError):
            kit.make(name, {k: bad[p.type]})
        if p.type in ('int', 'float') and p.max is not None:
          with self.assertRaises(KitError):
            kit.make(name, {k: p.max + 1})

  def test_catalogue(self):
    cat = kit.catalogue()
    json.dumps(cat)
    self.assertEqual(set(cat['items']), set(kit.ITEMS))
    self.assertEqual(set(cat['materials']), set(kit.MATERIALS))
    self.assertEqual(set(cat['lines']), set(kit.LINES))
    for name, info in cat['items'].items():
      self.assertTrue(info['doc'], name)


def _dist_cells(cells, w, h):
  """Per pixel: signed distance in px to the covered region's boundary (approximate: >0 inside)."""
  inside = [[False] * w for _ in range(h)]
  for (cx, cy) in cells:
    for y in range(cy * T, cy * T + T):
      for x in range(cx * T, cx * T + T):
        inside[y][x] = True
  return inside


class GroundTests(unittest.TestCase):
  SHAPES = {
    'rect': ({(x, y) for y in range(3) for x in range(4)}, 5, 4),
    'L': ({(0, 0), (0, 1), (1, 1), (2, 1), (2, 2)}, 3, 3),
    'one': ({(1, 1)}, 3, 3),
    'ring': ({(x, y) for y in range(5) for x in range(5)} - {(2, 2)}, 5, 5),
  }

  def _check_area(self, img, cells, wt, ht, where):
    self.assertEqual(img.size, (wt * T, ht * T), where)
    self.assertEqual(img.mode, 'RGBA', where)
    a = img.getchannel('A')
    px = a.load()
    inside = _dist_cells(cells, wt * T, ht * T)
    W, H = wt * T, ht * T
    for y in range(0, H):
      for x in range(0, W):
        # Distance (Chebyshev) to a pixel of the other kind, capped at 3.
        me = inside[y][x]
        near = False
        for dy in range(-2, 3):
          for dx in range(-2, 3):
            xx, yy = x + dx, y + dy
            other = inside[yy][xx] if (0 <= xx < W and 0 <= yy < H) else False
            if other != me:
              near = True
              break
          if near:
            break
        if near:
          continue
        if me:
          self.assertEqual(px[x, y], 255, f'{where}: hole at {(x, y)}')
        else:
          self.assertEqual(px[x, y], 0, f'{where}: paint outside the cells at {(x, y)}')

  def test_materials_and_edges(self):
    for name in sorted(kit.MATERIALS):
      for shape, (cells, wt, ht) in self.SHAPES.items():
        for edge in kit.EDGES:
          if shape != 'rect' and edge in ('curb', 'none'):
            continue
          with self.subTest(material=name, shape=shape, edge=edge):
            img = kit.paint_area(name, cells, wt, ht, edge, seed=2)
            self._check_area(img, cells, wt, ht, f'{name}/{shape}/{edge}')

  def test_material_textures(self):
    for name, (fn, doc, takes_colour) in sorted(kit.MATERIALS.items()):
      self.assertTrue(doc, name)
      for (w, h) in ((16, 16), (48, 32), (40, 24)):
        with self.subTest(material=name, size=(w, h)):
          img = kit.material_texture(name, w, h, 3, 'pink' if takes_colour else None)
          self.assertEqual(img.size, (w, h))
          self.assertEqual(img.getchannel('A').getextrema(), (255, 255), f'{name}: texture must be opaque')

  def test_colour_and_determinism(self):
    for name, (fn, doc, takes_colour) in sorted(kit.MATERIALS.items()):
      cells = {(0, 0), (1, 0), (1, 1)}
      a = kit.paint_area(name, cells, 2, 2, 'soft', 5, 'teal')
      b = kit.paint_area(name, cells, 2, 2, 'soft', 5, 'teal')
      self.assertEqual(a.tobytes(), b.tobytes(), name)
      if takes_colour:
        c = kit.paint_area(name, cells, 2, 2, 'soft', 5, 'yellow')
        self.assertNotEqual(a.tobytes(), c.tobytes(), f'{name}: colour has no effect')

  def test_bad_ground_requests(self):
    with self.assertRaises(KitError):
      kit.paint_area('no_such_material', {(0, 0)}, 1, 1)
    with self.assertRaises(KitError):
      kit.paint_area('sand', {(0, 0)}, 1, 1, edge='wobbly')
    with self.assertRaises(KitError):
      kit.paint_lines('no_such_lines', 64, 64)
    self.assertEqual(kit.paint_area('sand', set(), 2, 2).getbbox(), None)
    with self.assertRaises(KitError):
      kit.paint_area('carpet', {(0, 0)}, 1, 1, colour='not-a-colour')
    with self.assertRaises(KitError):
      kit.paint_area('sand', {(0, 0)}, 1, 1, seed='abc')
    with self.assertRaises(KitError):
      kit.paint_lines('border', 64, 64, 'not-a-colour')
    kit.paint_area('sand', {(0, 0)}, 1, 1, colour='red')  # colour is ignored by materials without one

  def test_lines(self):
    for name in sorted(kit.LINES):
      for (w, h) in ((32, 32), (192, 112), (112, 192), (160, 48)):
        with self.subTest(lines=name, size=(w, h)):
          img = kit.paint_lines(name, w, h)
          self.assertEqual(img.size, (w, h))
          self.assertIsNotNone(img.getbbox(), f'{name}: no lines drawn')
          a = img.getchannel('A')
          border = [a.getpixel((x, 0)) for x in range(w)] + [a.getpixel((x, h - 1)) for x in range(w)]
          border += [a.getpixel((0, y)) for y in range(h)] + [a.getpixel((w - 1, y)) for y in range(h)]
          self.assertEqual(max(border), 0, f'{name}: lines must stay 1 px inside the rectangle')
          self.assertEqual(sum(a.histogram()[1:255]), 0, f'{name}: no partial alpha')
      red = kit.paint_lines(name, 96, 64, 'red')
      self.assertIn((214, 64, 64, 255), {c for _n, c in red.getcolors(1 << 16)}, name)


class TextTests(unittest.TestCase):
  def test_fonts(self):
    for font in kit.FONT_NAMES:
      with self.subTest(font=font):
        img = kit.pixel_text('Happy Birthday Sam! 0123 ♥ é&?', 'white', font)
        self.assertEqual(img.height, kit.font_height(font))
        self.assertGreater(img.width, 20)
        self.assertEqual(sum(img.getchannel('A').histogram()[1:255]), 0, f'{font}: anti-aliased')
        self.assertEqual(img.tobytes(), kit.pixel_text('Happy Birthday Sam! 0123 ♥ é&?', 'white', font).tobytes())
    out = kit.pixel_text('Hi', 'white', 'mini', outline='black')
    self.assertEqual(out.height, kit.font_height('mini') + 2)

  def test_fit(self):
    font, lines = kit.fit_text('HAPPY BIRTHDAY SAM', 64, 20)
    self.assertTrue(all(kit.text_size(ln, font)[0] <= 64 for ln in lines))
    font, lines = kit.fit_text('An extraordinarily long sentence that cannot possibly fit', 30, 8)
    self.assertTrue(all(kit.text_size(ln, font)[0] <= 30 for ln in lines))


if __name__ == '__main__':
  unittest.main()
