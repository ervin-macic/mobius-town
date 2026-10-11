"""Kit ground art: paint materials, their edges (soft / curb / hedge / none) and court lines.

Materials are seamless textures fn(w_px, h_px, seed, colour) -> opaque RGBA image; kit.paint_area()
masks one to a set of tiles and draws the edge here. Lines are transparent overlays for a court
rectangle, drawn 1 px inside its edges; courts are drawn with their long side horizontal and turned
when the rectangle is taller than wide.
"""
from __future__ import annotations

import math

from PIL import Image

from kit import (
  GRASS, GRASS_DARK, GRASS_LIGHT, LEAF, LEAF_DEEP, LEAF_LIGHT, LEAF_MID, OUT, OUT_SOFT, STONE, STONE_DARK,
  STONE_LIGHT, STONE_MID, T, WATER, WHITE, WOOD, WOOD_DARK, WOOD_LIGHT, WOOD_MID, hline, lines, material, mix,
  new, noise_rng, pack_tile, pixel_text, props, put, rect, shade, to_rgba, tones, vline,
)

# --- Texture helpers ---------------------------------------------------------------------------------


def _blotches(w, h, seed, scale=8, cover=0.4):
  """An 'L' mask of smooth organic blobs (crisp edges) covering about `cover` of the area."""
  rng = noise_rng(seed * 7919 + 17)
  gw, gh = w // scale + 3, h // scale + 3
  small = Image.new('L', (gw, gh))
  small.putdata([rng.randrange(256) for _ in range(gw * gh)])
  big = small.resize((gw * scale, gh * scale), Image.BILINEAR).crop((scale, scale, scale + w, scale + h))
  # Bilinear noise clusters around mid-grey: map `cover` to a threshold on its spread.
  t = int(128 + (0.5 - cover) * 150)
  return big.point(lambda v: 255 if v > t else 0)


def _overlay(img, mask, colour):
  """Paint `colour` where `mask` (L) is set."""
  layer = Image.new('RGBA', img.size, colour)
  img.paste(layer, (0, 0), mask)
  return img


def _speckle(img, rng, density, colours, size=1):
  w, h = img.size
  n = int(w * h * density)
  for _ in range(n):
    x, y = rng.randrange(w), rng.randrange(h)
    c = colours[rng.randrange(len(colours))]
    if size == 1:
      img.putpixel((x, y), c)
    else:
      rect(img, x, y, size, 1, c)
  return img


def _tile_pattern(w, h, tile):
  """Repeat a pattern image over w x h."""
  out = new(w, h)
  for y in range(0, h, tile.height):
    for x in range(0, w, tile.width):
      out.paste(tile, (x, y))
  return out


def _pebble(img, x, y, c, size=2):
  hi, base, lo, deep = tones(c)
  if size == 1:
    put(img, x, y, base)
    return
  rect(img, x, y, size, size - 1, base)
  put(img, x, y, hi)
  hline(img, x, y + size - 1, size, lo)


# Fast, byte-identical versions of the town's floor painters (props.floor_*), which go pixel by pixel.

def _floor_wood(w, h, seed=0, tone=1.0):
  rng = noise_rng(seed)
  light, mid, dark = shade(WOOD, tone), shade(WOOD_MID, tone * 1.06), shade(WOOD_DARK, tone)
  img = new(w, h, light)
  for y0 in range(0, h, 5):
    offset = ((y0 // 5) * 11) % 32
    rows = min(4, h - y0)
    for x in range((-offset) % 32, w, 32):
      vline(img, x, y0, rows, mid)
    if y0 + 4 < h:
      hline(img, 0, y0 + 4, w, mid)
  for _ in range((w * h) // 400):
    put(img, rng.randrange(w), rng.randrange(h), dark)
  return img


def _floor_stone(w, h):
  img = new(w, h)
  for ty in range(0, h, T):
    for tx in range(0, w, T):
      rect(img, tx, ty, T, T, STONE if ((tx // T) + (ty // T)) % 2 == 0 else STONE_MID)
      hline(img, tx, ty + 1, T, STONE_LIGHT)
      vline(img, tx + 1, ty, T, STONE_LIGHT)
      hline(img, tx, ty, T, STONE_DARK)
      vline(img, tx, ty, T, STONE_DARK)
  return img


def _floor_check(w, h, a, b, size=8):
  img = new(w, h)
  for y in range(0, h, size):
    for x in range(0, w, size):
      rect(img, x, y, size, size, a if ((x // size) + (y // size)) % 2 == 0 else b)
  return img


# --- Natural ground -------------------------------------------------------------------------------------

GRASS_TILES = [(0, 0)] * 6 + [(0, 9), (1, 9), (1, 10), (5, 9)]  # same mix as the town's lawn


def _grass_base(w, h, seed):
  rng = noise_rng(seed * 31 + 5)
  out = new(w, h)
  tiles = [pack_tile('Overworld', tx, ty) for (tx, ty) in GRASS_TILES]
  for y in range(0, h, T):
    for x in range(0, w, T):
      out.paste(tiles[rng.randrange(len(tiles))], (x, y))
  return out


@material('grass', 'The town lawn (the same tiles as the town).', edge='organic', rim=(50, 142, 65, 255))
def _m_grass(w, h, seed=0, colour=None):
  return _grass_base(w, h, seed)


@material('meadow', 'Lawn sprinkled with tiny wild flowers.', edge='organic', rim=(50, 142, 65, 255))
def _m_meadow(w, h, seed=0, colour=None):
  img = _grass_base(w, h, seed)
  rng = noise_rng(seed * 13 + 3)
  petals = [(255, 255, 255, 255), (255, 226, 92, 255), (248, 140, 170, 255), (190, 160, 255, 255),
            (130, 190, 255, 255)]
  for _ in range(max(1, (w * h) // 110)):
    x, y = rng.randrange(1, max(2, w - 1)), rng.randrange(1, max(2, h - 1))
    c = petals[rng.randrange(len(petals))]
    if rng.random() < 0.55:
      put(img, x, y, c)
      put(img, x, y + 1, GRASS_DARK)
    else:
      put(img, x - 1, y, c)
      put(img, x + 1, y, c)
      put(img, x, y - 1, c)
      put(img, x, y + 1, c)
      put(img, x, y, (255, 240, 160, 255))
  return img


SAND = ((250, 232, 184, 255), (236, 210, 150, 255), (216, 184, 124, 255), (190, 156, 104, 255))


@material('sand', 'Warm beach sand (volleyball courts, beaches, sandpits).', edge='organic', rim=SAND[2])
def _m_sand(w, h, seed=0, colour=None):
  hi, base, lo, deep = SAND
  img = new(w, h, base)
  _overlay(img, _blotches(w, h, seed, 12, 0.32), mix(base, hi, 0.45))
  rng = noise_rng(seed * 3 + 1)
  # Wind ripples: short soft arcs.
  for _ in range(max(1, (w * h) // 300)):
    x, y, L = rng.randrange(w), rng.randrange(h), rng.randint(3, 6)
    hline(img, x, y, L, mix(base, lo, 0.45))
    hline(img, x + 1, y - 1, max(1, L - 2), mix(base, hi, 0.7))
  _speckle(img, rng, 0.018, [hi, mix(base, lo, 0.7)])
  for _ in range(max(1, (w * h) // 2400)):
    _pebble(img, rng.randrange(w - 1), rng.randrange(h - 1), (222, 214, 200, 255))
  return img


DIRT = ((176, 128, 88, 255), (148, 102, 70, 255), (120, 80, 58, 255), (92, 60, 52, 255))


@material('dirt', 'Bare garden soil (beds, digs, farm plots).', edge='organic', rim=DIRT[3])
def _m_dirt(w, h, seed=0, colour=None):
  hi, base, lo, deep = DIRT
  img = new(w, h, base)
  _overlay(img, _blotches(w, h, seed, 8, 0.3), mix(base, lo, 0.55))
  rng = noise_rng(seed * 5 + 2)
  for _ in range(max(1, (w * h) // 40)):  # clods
    x, y = rng.randrange(w), rng.randrange(h)
    put(img, x, y, hi)
    put(img, x, y + 1, deep)
  _speckle(img, rng, 0.03, [lo, deep])
  for _ in range(max(1, (w * h) // 700)):
    _pebble(img, rng.randrange(w - 1), rng.randrange(h - 1), (170, 160, 150, 255))
  return img


PATH = ((222, 186, 132, 255), (204, 164, 112, 255), (176, 136, 92, 255), (146, 108, 76, 255))


@material('path', 'Packed earth path with pebbles.', edge='organic', rim=PATH[2])
def _m_path(w, h, seed=0, colour=None):
  hi, base, lo, deep = PATH
  img = new(w, h, base)
  _overlay(img, _blotches(w, h, seed, 9, 0.28), mix(base, hi, 0.4))
  _overlay(img, _blotches(w, h, seed + 101, 6, 0.16), mix(base, lo, 0.4))
  rng = noise_rng(seed * 11 + 4)
  _speckle(img, rng, 0.04, [hi, lo])
  stones = [(196, 192, 184, 255), (176, 170, 164, 255), (214, 204, 186, 255)]
  for _ in range(max(1, (w * h) // 150)):
    _pebble(img, rng.randrange(w - 1), rng.randrange(h - 1), stones[rng.randrange(3)], rng.choice((1, 2, 2)))
  return img


GRAVEL = [(196, 190, 178, 255), (172, 166, 158, 255), (150, 146, 142, 255), (214, 208, 196, 255),
          (128, 124, 126, 255)]


@material('gravel', 'Fine grey-beige gravel.', edge='organic', rim=(122, 118, 120, 255))
def _m_gravel(w, h, seed=0, colour=None):
  img = new(w, h, GRAVEL[1])
  rng = noise_rng(seed * 17 + 9)
  for _ in range((w * h) // 5):
    x, y = rng.randrange(w), rng.randrange(h)
    c = GRAVEL[rng.randrange(len(GRAVEL))]
    put(img, x, y, c)
    if rng.random() < 0.35:
      put(img, x + 1, y, c)
  for _ in range((w * h) // 30):
    x, y = rng.randrange(w), rng.randrange(h)
    put(img, x, y, GRAVEL[3])
    put(img, x, y + 1, GRAVEL[4])
  return img


SNOW = ((255, 255, 255, 255), (236, 242, 250, 255), (214, 226, 244, 255), (186, 202, 232, 255))


@material('snow', 'Fresh snow.', edge='organic', rim=SNOW[3])
def _m_snow(w, h, seed=0, colour=None):
  hi, base, lo, deep = SNOW
  img = new(w, h, base)
  _overlay(img, _blotches(w, h, seed, 6, 0.18), mix(base, lo, 0.6))
  rng = noise_rng(seed * 19 + 3)
  _speckle(img, rng, 0.012, [hi])
  for _ in range(max(1, (w * h) // 300)):
    x, y = rng.randrange(w), rng.randrange(h)
    hline(img, x, y, 3, lo)
    hline(img, x + 1, y - 1, 2, hi)
  return img


@material('water', 'Still water with a few glints (ponds, pools); it is not walkable.', edge='water')
def _m_water(w, h, seed=0, colour=None):
  img = new(w, h, WATER)
  rng = noise_rng(seed * 23 + 11)
  ripples = [pack_tile('Overworld', tx, ty) for (tx, ty) in ((3, 3), (4, 3), (3, 4), (4, 4), (5, 3))]
  for y in range(0, h, T):
    for x in range(0, w, T):
      if rng.random() < 0.12:
        tile = ripples[rng.randrange(len(ripples))]
        # Keep only the ripple pixels, so blotches stay seamless.
        px = tile.load()
        for yy in range(T):
          for xx in range(T):
            if px[xx, yy][:3] != WATER[:3] and x + xx < w and y + yy < h:
              img.putpixel((x + xx, y + yy), px[xx, yy])
  glint, glint2 = (120, 190, 236, 255), (210, 240, 255, 255)
  for _ in range(max(1, (w * h) // 220)):
    x, y = rng.randrange(w), rng.randrange(h)
    L = rng.randint(2, 4)
    hline(img, x, y, L, glint)
    if rng.random() < 0.4:
      put(img, x + L // 2, y, glint2)
  return img


@material('ice', 'Smooth skating ice.', edge='built', rim=(236, 246, 252, 255))
def _m_ice(w, h, seed=0, colour=None):
  base, light, dark = (184, 226, 244, 255), (214, 242, 252, 255), (150, 200, 228, 255)
  img = new(w, h, base)
  _overlay(img, _blotches(w, h, seed, 7, 0.22), mix(base, light, 0.6))
  rng = noise_rng(seed * 29 + 7)
  for _ in range(max(1, (w * h) // 260)):  # skate scratches: shallow diagonals
    x, y, L = rng.randrange(w), rng.randrange(h), rng.randint(4, 9)
    for i in range(L):
      put(img, x + i, y - i // 3, WHITE if i % 4 else light)
  for _ in range(max(1, (w * h) // 1500)):  # a hairline crack
    x, y = rng.randrange(w), rng.randrange(h)
    for _i in range(rng.randint(4, 8)):
      put(img, x, y, dark)
      x += rng.choice((1, 1, 0))
      y += rng.choice((1, 0, -1))
  return img


# --- Sports surfaces ------------------------------------------------------------------------------------

@material('clay', 'Terracotta tennis clay.', edge='built', rim=(150, 70, 44, 255))
def _m_clay(w, h, seed=0, colour=None):
  base, light, dark = (206, 108, 66, 255), (222, 130, 86, 255), (186, 92, 56, 255)
  img = new(w, h, base)
  _overlay(img, _blotches(w, h, seed, 14, 0.3), mix(base, light, 0.5))
  rng = noise_rng(seed * 37 + 2)
  for _ in range(max(1, (w * h) // 90)):  # brushed streaks
    x, y = rng.randrange(w), rng.randrange(h)
    hline(img, x, y, rng.randint(2, 5), dark if rng.random() < 0.5 else light)
  _speckle(img, rng, 0.02, [light, dark])
  return img


@material('hardcourt', 'Smooth painted court (basketball, tennis, multi-sport).', colour='blue', edge='built')
def _m_hardcourt(w, h, seed=0, colour=None):
  hi, base, lo, deep = tones(colour)
  img = new(w, h, base)
  rng = noise_rng(seed * 41 + 6)
  _speckle(img, rng, 0.03, [mix(base, hi, 0.25), mix(base, lo, 0.35)])
  return img


@material('tartan', 'Red rubber running track.', edge='built', rim=(120, 48, 44, 255))
def _m_tartan(w, h, seed=0, colour=None):
  base = (190, 82, 64, 255)
  img = new(w, h, base)
  rng = noise_rng(seed * 43 + 1)
  _speckle(img, rng, 0.08, [(204, 98, 76, 255), (172, 70, 58, 255)])
  return img


PITCH_A, PITCH_B = (70, 170, 70, 255), (82, 186, 78, 255)


@material('pitch', 'Mown sports grass in light and dark stripes (football, cricket, croquet).', edge='built',
          rim=(52, 132, 60, 255))
def _m_pitch(w, h, seed=0, colour=None):
  img = new(w, h)
  stripe = 32 if w >= 96 else 16
  for x in range(0, w, stripe):
    rect(img, x, 0, stripe, h, PITCH_A if (x // stripe) % 2 == 0 else PITCH_B)
  rng = noise_rng(seed * 47 + 8)
  px = img.load()
  for _ in range((w * h) // 12):
    x, y = rng.randrange(w), rng.randrange(h)
    px[x, y] = shade(px[x, y], 0.95 if rng.random() < 0.6 else 1.05)
  return img


# --- Paving -----------------------------------------------------------------------------------------------

@material('cobbles', 'Calm grey cobbles like the town square.', edge='built', rim=(112, 118, 132, 255))
def _m_cobbles(w, h, seed=0, colour=None):
  return props.plaza_cobbles(w, h, 11 + seed)


@material('flagstones', 'Big irregular stone slabs (garden paths, terraces).', edge='built',
          rim=(104, 104, 112, 255))
def _m_flagstones(w, h, seed=0, colour=None):
  rng = noise_rng(seed * 53 + 4)
  mortar = (126, 124, 122, 255)
  stones = [(204, 198, 186, 255), (190, 186, 178, 255), (214, 208, 194, 255), (180, 178, 174, 255),
            (198, 190, 170, 255)]
  img = new(w, h, mortar)
  y = -rng.randint(0, 6)
  while y < h:
    rh = rng.randint(9, 13)
    x = -rng.randint(0, 12)
    while x < w:
      sw = rng.randint(11, 21)
      c = stones[rng.randrange(len(stones))]
      x0, y0, ww, hh = x + 1, y + 1, sw - 1, rh - 1
      rect(img, x0, y0, ww, hh, c)
      hline(img, x0, y0, ww, shade(c, 1.07))
      vline(img, x0, y0, hh, shade(c, 1.04))
      hline(img, x0, y0 + hh - 1, ww, shade(c, 0.88))
      # Chipped corners make the slabs read as stone.
      put(img, x0, y0, mortar)
      put(img, x0 + ww - 1, y0 + hh - 1, mortar)
      if rng.random() < 0.5:
        put(img, x0 + rng.randrange(max(1, ww)), y0 + rng.randrange(max(1, hh)), shade(c, 0.92))
      x += sw
    y += rh
  # A little moss and grass in the joints.
  px = img.load()
  for _ in range(max(1, (w * h) // 120)):
    x, y = rng.randrange(w), rng.randrange(h)
    if px[x, y] == mortar:
      px[x, y] = (98, 150, 70, 255) if rng.random() < 0.6 else (74, 120, 62, 255)
  return img


@material('stone_tiles', 'Light square stone tiles (halls, kitchens, terraces).', edge='built',
          rim=(112, 118, 132, 255))
def _m_stone_tiles(w, h, seed=0, colour=None):
  return _floor_stone(w, h)


@material('marble', 'Polished white and grey marble tiles with fine veins.', edge='built', rim=(150, 152, 166, 255))
def _m_marble(w, h, seed=0, colour=None):
  rng = noise_rng(seed * 59 + 3)
  a, b = (240, 240, 244, 255), (218, 220, 228, 255)
  seam = (190, 192, 204, 255)
  img = new(w, h)
  for ty in range(0, h, T):
    for tx in range(0, w, T):
      c = a if ((tx // T) + (ty // T)) % 2 == 0 else b
      rect(img, tx, ty, T, T, c)
      hline(img, tx, ty, T, seam)
      vline(img, tx, ty, T, seam)
      hline(img, tx + 1, ty + 1, T - 1, WHITE)
      # A vein wandering across the tile.
      vx, vy = tx + rng.randrange(T), ty + rng.randrange(2, T)
      vc = shade(c, 0.88)
      for _ in range(rng.randint(5, 12)):
        put(img, vx, vy, vc)
        vx += 1
        vy += rng.choice((-1, 0, 0, 1))
        if not (tx < vx < tx + T and ty < vy < ty + T):
          break
  return img


# --- Wood and soft floors ----------------------------------------------------------------------------

@material('wood', 'Honey wooden floorboards (the café floor).', edge='built', rim=WOOD_DARK)
def _m_wood(w, h, seed=0, colour=None):
  return _floor_wood(w, h, seed, 1.0)


@material('wood_light', 'Pale wooden floorboards.', edge='built', rim=WOOD_MID)
def _m_wood_light(w, h, seed=0, colour=None):
  return _floor_wood(w, h, seed, 1.18)


@material('wood_dark', 'Dark walnut floorboards.', edge='built', rim=(52, 30, 38, 255))
def _m_wood_dark(w, h, seed=0, colour=None):
  rng = noise_rng(seed)
  light, mid, dark = (120, 72, 58, 255), (98, 56, 52, 255), (76, 42, 44, 255)
  img = new(w, h, light)
  for y in range(0, h, 5):
    hline(img, 0, y + 4, w, mid)
    off = ((y // 5) * 11) % 32
    for x in range(-off, w, 32):
      vline(img, x + 31, y, 4, mid)
  for _ in range(max(1, (w * h) // 400)):
    put(img, rng.randrange(w), rng.randrange(h), dark)
  for _ in range(max(1, (w * h) // 160)):
    x, y = rng.randrange(w), rng.randrange(h)
    if (y % 5) != 4:
      hline(img, x, y, 3, (130, 82, 64, 255))
  return img


@material('parquet', 'Basket-weave parquet in two wood tones.', edge='built', rim=WOOD_DARK)
def _m_parquet(w, h, seed=0, colour=None):
  a, b = (198, 140, 84, 255), (176, 120, 72, 255)
  seam = (128, 80, 60, 255)
  tile = new(16, 16)
  for by in range(2):
    for bx in range(2):
      x0, y0 = bx * 8, by * 8
      horiz = (bx + by) % 2 == 0
      for i in range(2):
        c = a if (i + bx) % 2 == 0 else b
        if horiz:
          rect(tile, x0, y0 + i * 4, 8, 4, c)
          hline(tile, x0, y0 + i * 4, 8, shade(c, 1.08))
          hline(tile, x0, y0 + i * 4 + 3, 8, seam)
        else:
          rect(tile, x0 + i * 4, y0, 4, 8, c)
          vline(tile, x0 + i * 4, y0, 8, shade(c, 1.08))
          vline(tile, x0 + i * 4 + 3, y0, 8, seam)
  img = _tile_pattern(w, h, tile)
  rng = noise_rng(seed)
  for _ in range(max(1, (w * h) // 300)):
    put(img, rng.randrange(w), rng.randrange(h), shade(b, 0.86))
  return img


@material('carpet', 'Soft wall-to-wall carpet with a fine woven texture.', colour='#a83850', edge='band')
def _m_carpet(w, h, seed=0, colour=None):
  hi, base, lo, deep = tones(colour)
  img = new(w, h, base)
  dot = mix(base, hi, 0.28)
  dark = mix(base, lo, 0.4)
  for y in range(0, h, 4):
    for x in range((y // 4) % 2 * 2, w, 4):
      put(img, x, y, dot)
      put(img, x + 1, y + 2, dark)
  return img


@material('checker', 'Checkerboard tiles: `colour` and white (diners, kitchens, dance halls).', colour='black',
          edge='built')
def _m_checker(w, h, seed=0, colour=None):
  hi, base, lo, deep = tones(colour)
  white = (240, 238, 232, 255)
  img = _floor_check(w, h, base, white, 8)
  for y in range(0, h, 8):
    for x in range(0, w, 8):
      dark = ((x // 8) + (y // 8)) % 2 == 0
      hline(img, x, y, 8, mix(base, hi, 0.25) if dark else WHITE)
  return img


DANCE = [(240, 96, 160, 255), (80, 200, 230, 255), (250, 214, 80, 255), (150, 100, 230, 255),
         (120, 220, 110, 255), (250, 140, 70, 255)]


@material('dancefloor', 'Light-up disco floor of coloured glass tiles.', edge='built', rim=(36, 28, 52, 255))
def _m_dancefloor(w, h, seed=0, colour=None):
  rng = noise_rng(seed * 61 + 5)
  gap = (44, 34, 62, 255)
  img = new(w, h, gap)
  for ty in range(0, h, T):
    for tx in range(0, w, T):
      c = DANCE[rng.randrange(len(DANCE))]
      if rng.random() < 0.22:
        c = (78, 60, 112, 255)  # some tiles are dark this beat
      hi, base, lo, deep = tones(c)
      rect(img, tx + 1, ty + 1, T - 2, T - 2, base)
      hline(img, tx + 1, ty + 1, T - 2, hi)
      vline(img, tx + 1, ty + 1, T - 2, hi)
      hline(img, tx + 1, ty + T - 2, T - 2, lo)
      vline(img, tx + T - 2, ty + 1, T - 2, lo)
      rect(img, tx + 3, ty + 3, 2, 2, mix(hi, WHITE, 0.6))
  return img


# --- Wall faces (rows 1-2 of an interior; also outdoor garden walls) --------------------------------

WALL_PLASTER = (236, 222, 196, 255)


@material('plaster', 'Painted wall plaster (for an interior wall band).', colour='#ecdec4', edge='wall')
def _m_plaster(w, h, seed=0, colour=None):
  hi, base, lo, deep = tones(colour)
  img = new(w, h, base)
  dim = mix(base, lo, 0.25)
  for y in range(1, h, 8):
    for x in range((y // 8) % 2 * 2, w, 4):
      put(img, x, y + 4, dim)
  return img


@material('wallpaper', 'Striped wallpaper with a small motif (for an interior wall band).', colour='#9cb4a0',
          edge='wall')
def _m_wallpaper(w, h, seed=0, colour=None):
  hi, base, lo, deep = tones(colour)
  pale = mix(base, (250, 246, 236, 255), 0.55)
  img = new(w, h, pale)
  for x in range(0, w, 8):
    rect(img, x, 0, 3, h, base)
    vline(img, x + 3, 0, h, mix(base, pale, 0.5))
  for y in range(0, h, 8):
    for x in range(0, w, 8):
      cx, cy = x + 5 + 1, y + 4
      put(img, cx, cy - 1, lo)
      put(img, cx - 1, cy, lo)
      put(img, cx + 1, cy, lo)
      put(img, cx, cy + 1, lo)
  return img


@material('brick', 'Red brick in a running bond (walls, chimneys, terraces).', edge='wall')
def _m_brick(w, h, seed=0, colour=None):
  rng = noise_rng(seed * 67 + 1)
  mortar = (206, 190, 170, 255)
  bricks = [(178, 84, 62, 255), (164, 74, 58, 255), (190, 98, 72, 255), (152, 70, 60, 255)]
  img = new(w, h, mortar)
  for row, y in enumerate(range(0, h, 4)):
    off = 4 if row % 2 else 0
    for x in range(-off, w, 8):
      c = bricks[rng.randrange(len(bricks))]
      rect(img, x, y, 7, 3, c)
      hline(img, x, y, 7, shade(c, 1.12))
      put(img, x + 6, y + 2, shade(c, 0.82))
  return img


@material('wood_panel', 'Vertical wooden wall panelling (for an interior wall band).', edge='wall')
def _m_wood_panel(w, h, seed=0, colour=None):
  rng = noise_rng(seed)
  base, light, dark = (150, 96, 66, 255), (176, 118, 80, 255), (112, 68, 54, 255)
  img = new(w, h, base)
  for x in range(0, w, 8):
    vline(img, x, 0, h, dark)
    vline(img, x + 1, 0, h, light)
  for _ in range(max(1, (w * h) // 120)):
    x, y = rng.randrange(w), rng.randrange(h)
    if x % 8 > 1:
      vline(img, x, y, 3, mix(base, dark, 0.5))
  return img


# --- Edges ----------------------------------------------------------------------------------------------

class _Noise:
  """Smooth 2D value noise in [0, 1] with features about `period` px apart (deterministic)."""

  def __init__(self, seed, period=5.0):
    self.seed, self.p = seed, period
    self.cache = {}

  def _v(self, i, j):
    k = (i, j)
    v = self.cache.get(k)
    if v is None:
      h = (i * 374761393 + j * 668265263 + self.seed * 2147483647) & 0xFFFFFFFF
      h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
      v = self.cache[k] = ((h ^ (h >> 16)) & 0xFFFF) / 65535.0
    return v

  def __call__(self, x, y):
    fx, fy = x / self.p, y / self.p
    i, j = math.floor(fx), math.floor(fy)
    tx, ty = fx - i, fy - j
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = self._v(i, j) + (self._v(i + 1, j) - self._v(i, j)) * tx
    b = self._v(i, j + 1) + (self._v(i + 1, j + 1) - self._v(i, j + 1)) * tx
    return a + (b - a) * ty


_NB8 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]


def _inside_sides(cells, maxd):
  """Covered pixels near the boundary: {(x, y): {side: d}} with d = pixels to an uncovered tile on that
  side (0 = touching it), for sides 'n', 's', 'w', 'e' (an inner corner counts for both its sides)."""
  info = {}
  for (cx, cy) in cells:
    open_ = {(dx, dy) for (dx, dy) in _NB8 if (cx + dx, cy + dy) not in cells}
    if not open_:
      continue
    # A diagonal gap only matters at an inner corner (both sides beside it covered).
    open_ = {(dx, dy) for (dx, dy) in open_ if not (dx and dy) or ((dx, 0) not in open_ and (0, dy) not in open_)}
    if not open_:
      continue
    x0, y0 = cx * T, cy * T
    for ly in range(T):
      for lx in range(T):
        sides = {}
        for (dx, dy) in open_:
          ex = lx if dx < 0 else (T - 1 - lx if dx > 0 else None)
          ey = ly if dy < 0 else (T - 1 - ly if dy > 0 else None)
          d = ey if ex is None else ex if ey is None else max(ex, ey)
          if d >= maxd:
            continue
          for side in (('n' if dy < 0 else 's' if dy > 0 else None), ('w' if dx < 0 else 'e' if dx > 0 else None)):
            if side and d < sides.get(side, maxd):
              sides[side] = d
        if sides:
          info[(x0 + lx, y0 + ly)] = sides
  return info


def _inside_border(cells, maxd):
  """Covered pixels near the boundary: {(x, y): (d, side)} with the nearest side."""
  return {p: min((d, side) for side, d in sides.items()) for p, sides in _inside_sides(cells, maxd).items()}


def _outside_border(cells, wt, ht, maxd):
  """Uncovered pixels (inside the image) near covered tiles: {(x, y): d}."""
  info = {}
  near = set()
  for (cx, cy) in cells:
    for (dx, dy) in _NB8:
      n = (cx + dx, cy + dy)
      if n not in cells and 0 <= n[0] < wt and 0 <= n[1] < ht:
        near.add(n)
  for (cx, cy) in near:
    covered = [(dx, dy) for (dx, dy) in _NB8 if (cx + dx, cy + dy) in cells]
    x0, y0 = cx * T, cy * T
    for ly in range(T):
      for lx in range(T):
        best = None
        for (dx, dy) in covered:
          ex = lx if dx < 0 else (T - 1 - lx if dx > 0 else None)
          ey = ly if dy < 0 else (T - 1 - ly if dy > 0 else None)
          d = ey if ex is None else ex if ey is None else max(ex, ey)
          if best is None or d < best:
            best = d
        if best is not None and best < maxd:
          info[(x0 + lx, y0 + ly)] = best
  return info


def _cell_mask(cells, w, h):
  m = Image.new('L', (w, h), 0)
  for (cx, cy) in cells:
    m.paste(255, (cx * T, cy * T, cx * T + T, cy * T + T))
  return m


def _masked(tex, mask):
  out = new(*tex.size)
  out.paste(tex, (0, 0), mask)
  return out


def apply_edge(tex, mdef, cells, wt, ht, edge, seed):
  w, h = tex.size
  if not cells:
    return new(w, h)
  if edge == 'none':
    return _masked(tex, _cell_mask(cells, w, h))
  if edge == 'curb':
    return _edge_curb(tex, cells, w, h)
  if edge == 'hedge':
    return _edge_hedge(tex, cells, wt, ht, seed)
  style = mdef.edge
  if style in ('organic', 'water'):
    return _edge_organic(tex, mdef, cells, wt, ht, seed, water=style == 'water')
  if style == 'band':
    return _edge_band(tex, cells, w, h)
  if style == 'wall':
    return _edge_wall(tex, cells, w, h)
  return _edge_built(tex, mdef, cells, w, h)


def _edge_organic(tex, mdef, cells, wt, ht, seed, water=False):
  w, h = tex.size
  mask = _cell_mask(cells, w, h)
  inside = _inside_border(cells, 3)
  outside = _outside_border(cells, wt, ht, 2)
  noise = _Noise(seed * 101 + 7, 4.5)
  mp = mask.load()
  for (x, y), (d, _s) in inside.items():
    n = noise(x, y)
    if (d == 0 and n < 0.34) or (d == 1 and n < 0.14):
      mp[x, y] = 0
  for (x, y), d in outside.items():
    n = noise(x, y)
    if (d == 0 and n > 0.66) or (d == 1 and n > 0.86):
      mp[x, y] = 255
  out = _masked(tex, mask)
  op = out.load()
  cand = [p for p, (d, _s) in inside.items() if d <= 2] + list(outside)

  def inm(x, y):
    return 0 <= x < w and 0 <= y < h and mp[x, y]

  rim = mdef.rim
  if water:
    foam, light, dark = (250, 252, 255, 255), (90, 174, 228, 255), (22, 92, 136, 255)
    for (x, y) in cand:
      if not mp[x, y]:
        continue
      edge = not (inm(x - 1, y) and inm(x + 1, y) and inm(x, y - 1) and inm(x, y + 1))
      if edge:
        op[x, y] = foam
      elif not inm(x, y - 2) or not inm(x, y - 3):
        op[x, y] = dark  # the bank's shadow on the water under a north edge
      elif not (inm(x - 2, y) and inm(x + 2, y)) and (x + y) % 3 == 0:
        op[x, y] = light
    return out
  for (x, y) in cand:
    if not mp[x, y]:
      continue
    if not (inm(x - 1, y) and inm(x + 1, y) and inm(x, y - 1) and inm(x, y + 1)):
      op[x, y] = rim if rim else shade(op[x, y], 0.8)
  return out


def _edge_built(tex, mdef, cells, w, h):
  out = _masked(tex, _cell_mask(cells, w, h))
  op = out.load()
  for (x, y), (d, side) in _inside_border(cells, 2).items():
    if d == 0:
      op[x, y] = mdef.rim if mdef.rim else shade(op[x, y], 0.7)
    elif d == 1 and side in ('n', 'w', 'nw'):
      op[x, y] = shade(op[x, y], 1.08)
  return out


def _edge_band(tex, cells, w, h):
  """Carpet: a woven border band (dark rim, darker band, light inner line)."""
  out = _masked(tex, _cell_mask(cells, w, h))
  op = out.load()
  for (x, y), (d, _side) in _inside_border(cells, 4).items():
    c = op[x, y]
    if d == 0:
      op[x, y] = shade(c, 0.55)
    elif d in (1, 2):
      op[x, y] = shade(c, 0.78)
    else:
      op[x, y] = mix(c, (255, 244, 214, 255), 0.35)
  return out


def _edge_wall(tex, cells, w, h):
  """Wall faces: a dark baseboard where the wall meets the floor (south), a crisp trim under the top."""
  out = _masked(tex, _cell_mask(cells, w, h))
  op = out.load()
  board, board_hi = (96, 62, 56, 255), (136, 92, 74, 255)
  for (x, y), sides in _inside_sides(cells, 4).items():
    c = op[x, y]
    ds = sides.get('s')
    if ds is not None:
      if ds == 0:
        op[x, y] = shade(board, 0.75)
      elif ds <= 2:
        op[x, y] = shade(board, 0.88) if (x % 16 == 0 and ds == 1) else board
      else:
        op[x, y] = board_hi
    elif sides.get('n', 9) == 0:
      op[x, y] = shade(c, 0.72)
    elif sides.get('n', 9) == 1:
      op[x, y] = shade(c, 1.1)
    elif sides.get('w') == 0 or sides.get('e') == 0:
      op[x, y] = shade(c, 0.8)
  return out


CURB_TOP, CURB_LIP, CURB_FACE, CURB_EDGE = STONE, STONE_LIGHT, STONE_DARK, (104, 108, 124, 255)


def _edge_curb(tex, cells, w, h):
  """A light stone kerb inside the border: 3 px on top/sides, with a front face on the south side."""
  out = _masked(tex, _cell_mask(cells, w, h))
  op = out.load()
  for (x, y), sides in _inside_sides(cells, 5).items():
    ds = sides.get('s')
    side_d = min((sides[k] for k in ('n', 'w', 'e') if k in sides), default=9)
    if ds is not None and ds <= 4 and not (side_d == 0 and ds >= 3):
      joint = x % 8 == 0
      if ds == 0 or side_d == 0:
        op[x, y] = OUT if ds <= 2 else CURB_EDGE
      elif ds in (1, 2):
        op[x, y] = shade(CURB_FACE, 0.92) if joint else CURB_FACE
      elif ds == 3:
        op[x, y] = CURB_LIP
      else:
        op[x, y] = STONE_MID if joint else CURB_TOP
      continue
    if side_d > 3:
      continue
    k = min(sides, key=lambda kk: (sides[kk], kk != 'n'))
    along = x if k == 'n' else y
    joint = along % 8 == 0
    if side_d == 0:
      op[x, y] = CURB_EDGE
    elif side_d == 1:
      op[x, y] = CURB_LIP
    elif side_d == 2:
      op[x, y] = STONE_MID if joint else CURB_TOP
    elif side_d == 3 and ds is None:
      op[x, y] = shade(op[x, y], 0.8)  # the kerb's shadow on the material
  return out


HEDGE_TOP, HEDGE_LIGHT, HEDGE_FACE, HEDGE_DEEP = LEAF, LEAF_LIGHT, LEAF_MID, LEAF_DEEP
HEDGE_SHADOW = (32, 23, 41, 102)


def hedge_pixels(hcells, seed=0, face_h=4):
  """Draw a clipped hedge covering the tiles `hcells` (like the pack's hedge pieces).

  Returns (pixels {(x, y): colour}, shadow {(x, y)}): a scalloped OUT_SOFT outline, a lit leafy top
  with leaf clumps, a darker front face on every south-facing side and the ground shadow under it.
  """
  mask = set()
  for (cx, cy) in hcells:
    open_n = (cx, cy - 1) not in hcells
    open_s = (cx, cy + 1) not in hcells
    open_w = (cx - 1, cy) not in hcells
    open_e = (cx + 1, cy) not in hcells
    cut = set()
    for (cxo, cyo, ow, on) in ((0, 0, open_w, open_n), (T - 1, 0, open_e, open_n), (0, T - 1, open_w, open_s),
                               (T - 1, T - 1, open_e, open_s)):
      if ow and on:  # round a free corner
        sx = 1 if cxo == 0 else -1
        sy = 1 if cyo == 0 else -1
        cut |= {(cxo, cyo), (cxo + sx, cyo), (cxo, cyo + sy)}
    for ly in range(T):
      for lx in range(T):
        if (lx, ly) not in cut:
          mask.add((cx * T + lx, cy * T + ly))

  def boundary(m):
    return {(x, y) for (x, y) in m
            if (x + 1, y) not in m or (x - 1, y) not in m or (x, y + 1) not in m or (x, y - 1) not in m}

  # Scallops: dip the silhouette 1 px in a regular rhythm so it reads as clipped leaf bumps.
  dips = set()
  for (x, y) in boundary(mask):
    open_n, open_s = (x, y - 1) not in mask, (x, y + 1) not in mask
    open_w, open_e = (x - 1, y) not in mask, (x + 1, y) not in mask
    if (open_n or open_s) and not (open_w or open_e) and x % 5 in (0, 4):
      dips.add((x, y))
    elif (open_w or open_e) and not (open_n or open_s) and y % 5 in (0, 4):
      dips.add((x, y))
  mask -= dips
  edge = boundary(mask)
  rng = noise_rng(seed * 71 + 13)
  px = {}
  for (x, y) in mask:
    if (x, y) in edge:
      px[(x, y)] = OUT_SOFT
      continue
    k = 0  # leaf pixels below before the silhouette ends
    while k <= face_h and (x, y + k + 1) in mask and (x, y + k + 1) not in edge:
      k += 1
    if k < face_h:
      px[(x, y)] = HEDGE_DEEP if k == 0 else HEDGE_FACE
      if k == face_h - 1 and x % 5 in (1, 2):
        px[(x, y)] = HEDGE_TOP  # leaves hanging over the face
    else:
      px[(x, y)] = HEDGE_TOP
  # Leaf clumps on the lit top: rounded leaves on a jittered lattice, lit top-left, shaded bottom-right.
  clump = ((1, 0, HEDGE_LIGHT), (2, 0, HEDGE_LIGHT), (0, 1, HEDGE_LIGHT), (3, 1, HEDGE_FACE), (1, 2, HEDGE_FACE),
           (2, 2, HEDGE_FACE))
  ys = [q[1] for q in mask] or [0]
  xs = [q[0] for q in mask] or [0]
  for gy in range(min(ys) - 2, max(ys) + 2, 4):
    for gx in range(min(xs) - 2 + (gy // 4) % 2 * 2, max(xs) + 2, 5):
      if rng.random() < 0.2:
        continue
      ox, oy = gx + rng.randint(0, 1), gy + rng.randint(0, 1)
      pts = [(ox + dx, oy + dy, c) for (dx, dy, c) in clump]
      if all(px.get((x, y)) == HEDGE_TOP for (x, y, _c) in pts):
        for (x, y, c) in pts:
          px[(x, y)] = c
  shadow = set()
  for (x, y) in mask:
    if (x, y + 1) not in mask:
      for k in (1, 2):
        if (x, y + k) not in mask:
          shadow.add((x, y + k))
  return px, shadow


def _edge_hedge(tex, cells, wt, ht, seed):
  """Border tiles become a low clipped hedge (lit top + front face), the rest is the material."""
  w, h = tex.size
  border = {c for c in cells if any((c[0] + dx, c[1] + dy) not in cells for (dx, dy) in _NB8)}
  inner = cells - border
  out = _masked(tex, _cell_mask(inner, w, h))
  op = out.load()
  px, shadow = hedge_pixels(border, seed)
  for (x, y) in shadow:
    if 0 <= x < w and 0 <= y < h and (x // T, y // T) in inner:
      r, g, b, a = op[x, y]
      if a:
        sr, sg, sb, sa = HEDGE_SHADOW
        t = sa / 255
        op[x, y] = (int(r * (1 - t) + sr * t), int(g * (1 - t) + sg * t), int(b * (1 - t) + sb * t), 255)
  for (x, y), c in px.items():
    if 0 <= x < w and 0 <= y < h:
      op[x, y] = c
  # Gaps in the hedge silhouette (rounded corners, scallops) show the material on the inner side
  # and stay transparent on the outer side.
  tp = tex.load()
  for (cx, cy) in border:
    for ly in range(T):
      for lx in range(T):
        x, y = cx * T + lx, cy * T + ly
        if (x, y) in px:
          continue
        outer = ((lx < 3 and (cx - 1, cy) not in cells) or (lx > T - 4 and (cx + 1, cy) not in cells)
                 or (ly < 3 and (cx, cy - 1) not in cells) or (ly > T - 4 and (cx, cy + 1) not in cells)
                 or (lx < 3 and ly < 3 and (cx - 1, cy - 1) not in cells)
                 or (lx > T - 4 and ly < 3 and (cx + 1, cy - 1) not in cells)
                 or (lx < 3 and ly > T - 4 and (cx - 1, cy + 1) not in cells)
                 or (lx > T - 4 and ly > T - 4 and (cx + 1, cy + 1) not in cells))
        if not outer:
          op[x, y] = tp[x, y]
  return out


# --- Lines ---------------------------------------------------------------------------------------------


class _Pen:
  """Line drawing on a court canvas (long side horizontal); turned when the real court is tall."""

  def __init__(self, w, h, c):
    self.img = new(w, h)
    self.c = c
    self.w, self.h = w, h

  def h_(self, x0, x1, y):
    x0, x1 = sorted((int(round(x0)), int(round(x1))))
    hline(self.img, x0, int(round(y)), x1 - x0 + 1, self.c)

  def v_(self, x, y0, y1):
    y0, y1 = sorted((int(round(y0)), int(round(y1))))
    vline(self.img, int(round(x)), y0, y1 - y0 + 1, self.c)

  def box(self, x0, y0, x1, y1):
    self.h_(x0, x1, y0)
    self.h_(x0, x1, y1)
    self.v_(x0, y0, y1)
    self.v_(x1, y0, y1)

  def dot(self, x, y, size=2):
    rect(self.img, int(round(x - size / 2)), int(round(y - size / 2)), size, size, self.c)

  def arc(self, cx, cy, r, a0=0, a1=360, ry=None, step=None, dashed=False):
    """Pixel arc, 8-connected; angles in degrees, 0 = east, 90 = south."""
    ry = r if ry is None else ry
    pts = []
    n = max(24, int(abs(a1 - a0) / 360 * 2 * math.pi * max(r, ry) * 2))
    for i in range(n + 1):
      a = math.radians(a0 + (a1 - a0) * i / n)
      p = (int(math.floor(cx + r * math.cos(a))), int(math.floor(cy + ry * math.sin(a))))
      if not pts or pts[-1] != p:
        pts.append(p)
    for i, (x, y) in enumerate(pts):
      if dashed and (i // 2) % 2:
        continue
      if 0 <= x < self.w and 0 <= y < self.h:
        put(self.img, x, y, self.c)

  def dashed_v(self, x, y0, y1, on=2, off=2):
    for y in range(int(y0), int(y1) + 1):
      if (y - int(y0)) % (on + off) < on:
        put(self.img, int(x), y, self.c)

  def dashed_h(self, x0, x1, y, on=2, off=2):
    for x in range(int(x0), int(x1) + 1):
      if (x - int(x0)) % (on + off) < on:
        put(self.img, x, int(y), self.c)


def _court(w, h, c, draw):
  """Run `draw(pen, W, H)` on a canvas whose long side is horizontal; turn it back if needed."""
  if h > w:
    pen = _Pen(h, w, c)
    draw(pen, h, w)
    return pen.img.transpose(Image.ROTATE_90)
  pen = _Pen(w, h, c)
  draw(pen, w, h)
  return pen.img


def _centre_line(pen, W, H):
  """The halfway line: 2 px wide straddling the centre on even widths (sits under a net on a tile edge)."""
  cx = W // 2
  pen.v_(cx, 1, H - 2)
  if W % 2 == 0:
    pen.v_(cx - 1, 1, H - 2)


@lines('volleyball', 'Volleyball: boundary, centre line under the net, dashed attack lines (court split left/right).')
def _l_volleyball(w, h, c):
  def draw(p, W, H):
    p.box(1, 1, W - 2, H - 2)
    _centre_line(p, W, H)
    half = (W - 2) / 2
    for x in (W / 2 - half / 3, W / 2 + half / 3):
      p.dashed_v(int(round(x)), 2, H - 3, 3, 2)
  return _court(w, h, c, draw)


@lines('basketball', 'Basketball: boundary, centre line and circle, keys with free-throw circles, 3-point arcs.')
def _l_basketball(w, h, c):
  def draw(p, W, H):
    p.box(1, 1, W - 2, H - 2)
    cx, cy = W // 2, H / 2
    p.v_(cx, 1, H - 2)
    if W % 2 == 0:
      p.v_(cx - 1, 1, H - 2)
    fr = max(3, H * 0.12)  # free-throw and centre circles
    p.arc(W / 2, cy, fr)
    kd = max(8, int(round(W * 0.2)))  # key depth
    kh = max(6, int(round(H * 0.33)))  # key width (across the court)
    hx = max(3, int(round(W * 0.056)))  # hoop distance from the end line
    rx3, ry3 = max(kd + fr + 3, W * 0.25), min(H * 0.45, H / 2 - 3)
    for side in (0, 1):
      x_end = 1 if side == 0 else W - 2
      sgn = 1 if side == 0 else -1
      kx = x_end + sgn * kd
      p.box(min(x_end, kx), cy - kh / 2, max(x_end, kx), cy + kh / 2)
      a = (-90, 90) if side == 0 else (90, 270)
      b = (90, 270) if side == 0 else (-90, 90)
      p.arc(kx + 0.5, cy, fr, *a)
      p.arc(kx + 0.5, cy, fr, *b, dashed=True)
      hoop = x_end + sgn * hx
      p.arc(hoop + 0.5, cy, rx3 - hx, *a, ry=ry3)
      p.h_(x_end, hoop, int(math.floor(cy - ry3)))
      p.h_(x_end, hoop, int(math.floor(cy + ry3)) - 1)
  return _court(w, h, c, draw)


@lines('tennis', 'Tennis: doubles and singles sidelines, service boxes, centre marks (net runs north-south).')
def _l_tennis(w, h, c):
  def draw(p, W, H):
    p.box(1, 1, W - 2, H - 2)
    inset = max(2, int(round(H * 0.125)))
    p.h_(1, W - 2, 1 + inset)
    p.h_(1, W - 2, H - 2 - inset)
    cx = W // 2
    svc = max(6, int(round((W - 2) * 0.27)))
    for x in (cx - svc, cx + svc):
      p.v_(x, 1 + inset, H - 2 - inset)
    p.h_(cx - svc, cx + svc, H // 2)
    p.h_(1, 3, H // 2)
    p.h_(W - 4, W - 2, H // 2)
  return _court(w, h, c, draw)


@lines('badminton', 'Badminton: doubles/singles sidelines, long service lines, short service lines, centre lines.')
def _l_badminton(w, h, c):
  def draw(p, W, H):
    p.box(1, 1, W - 2, H - 2)
    inset = max(2, int(round(H * 0.075)))
    p.h_(1, W - 2, 1 + inset)
    p.h_(1, W - 2, H - 2 - inset)
    cx = W // 2
    short = max(5, int(round((W - 2) * 0.15)))
    long_ = max(2, int(round((W - 2) * 0.057)))
    for x in (cx - short, cx + short, 1 + long_, W - 2 - long_):
      p.v_(x, 1, H - 2)
    p.h_(1, cx - short, H // 2)
    p.h_(cx + short, W - 2, H // 2)
    _centre_line(p, W, H)
  return _court(w, h, c, draw)


@lines('football', 'Five-a-side football: boundary, halfway line, centre circle and spot, penalty areas.')
def _l_football(w, h, c):
  def draw(p, W, H):
    p.box(1, 1, W - 2, H - 2)
    cx, cy = W // 2, H / 2
    p.v_(cx, 1, H - 2)
    if W % 2 == 0:
      p.v_(cx - 1, 1, H - 2)
    r = max(5, min(H * 0.18, W * 0.12))
    p.arc(cx, cy, r)
    p.dot(cx, cy, 2)
    depth = max(8, int(W * 0.13))
    half = max(8, int(H * 0.3))
    for side in (0, 1):
      x_end = 1 if side == 0 else W - 2
      sgn = 1 if side == 0 else -1
      bx = x_end + sgn * depth
      # A D-shaped area: straight front, rounded corners.
      p.v_(bx, cy - half + 3, cy + half - 3)
      p.h_(x_end, bx - sgn * 3, cy - half)
      p.h_(x_end, bx - sgn * 3, cy + half)
      if side == 0:
        p.arc(bx - 3 + 0.5, cy - half + 3, 3, -90, 0)
        p.arc(bx - 3 + 0.5, cy + half - 3, 3, 0, 90)
      else:
        p.arc(bx + 3 + 0.5, cy - half + 3, 3, 180, 270)
        p.arc(bx + 3 + 0.5, cy + half - 3, 3, 90, 180)
      p.dot(x_end + sgn * int(depth * 0.7), cy, 2)
  return _court(w, h, c, draw)


@lines('border', 'A plain rectangle border.')
def _l_border(w, h, c):
  img = new(w, h)
  hline(img, 1, 1, w - 2, c)
  hline(img, 1, h - 2, w - 2, c)
  vline(img, 1, 1, h - 2, c)
  vline(img, w - 2, 1, h - 2, c)
  return img


@lines('centre_circle', 'A circle in the middle with a centre spot.')
def _l_centre_circle(w, h, c):
  p = _Pen(w, h, c)
  r = max(3, min(w, h) / 2 - 3)
  p.arc(w / 2, h / 2, r)
  p.dot(w / 2, h / 2, 2)
  return p.img


@lines('hopscotch', 'Chalk hopscotch squares numbered 1-10 along the long side.')
def _l_hopscotch(w, h, c):
  def draw(p, W, H):
    # Pattern of rows: 1, 2, 3-4, 5, 6-7, 8, 9-10 (single or double boxes), then a half circle.
    rows = [[1], [2], [3, 4], [5], [6, 7], [8], [9, 10]]
    s = max(7, min(int((W - 6) / (len(rows) + 0.8)), int((H - 4) / 2)))
    total = s * len(rows)
    x0 = max(1, (W - total - s // 2) // 2)
    cy = H // 2
    for i, row in enumerate(rows):
      x = x0 + i * s
      if len(row) == 1:
        p.box(x, cy - s // 2, x + s, cy + s // 2)
        boxes = [(row[0], cy)]
      else:
        p.box(x, cy - s, x + s, cy)
        p.box(x, cy, x + s, cy + s)
        boxes = [(row[0], cy - s // 2), (row[1], cy + s // 2)]
      for n, yy in boxes:
        t = pixel_text(str(n), p.c, 'small')
        p.img.alpha_composite(t, (x + (s - t.width) // 2 + 1, int(yy - t.height // 2)))
    xe = x0 + total
    p.arc(xe, cy, s * 0.6, -90, 90)
  return _court(w, h, c, draw)


@lines('running_track', 'Running lanes along the long side with start and finish lines and lane numbers.')
def _l_running_track(w, h, c):
  def draw(p, W, H):
    lanes = max(1, min(8, (H - 2) // 8))
    lane_h = (H - 2) // lanes
    top = 1 + ((H - 2) - lanes * lane_h) // 2
    for i in range(lanes + 1):
      p.h_(1, W - 2, top + i * lane_h)
    p.v_(4, top, top + lanes * lane_h)
    # Finish line: a chequered band.
    fx = W - 8
    for i in range(lanes):
      y0 = top + i * lane_h + 1
      for yy in range(y0, y0 + lane_h - 1):
        for xx in (fx, fx + 1):
          if ((xx // 1) + yy) % 2 == 0:
            put(p.img, xx, yy, p.c)
      t = pixel_text(str(i + 1), p.c, 'small')
      if lane_h >= 7:
        p.img.alpha_composite(t, (7, y0 + (lane_h - 1 - t.height) // 2))
  return _court(w, h, c, draw)
