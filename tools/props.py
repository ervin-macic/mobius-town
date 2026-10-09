"""Procedural props drawn in the pack's style (outlined, three-step shading).

Each function returns an RGBA Pillow image at 1:1 scale. Placement and sorting
live in build_world.py; these functions only paint.
"""
from __future__ import annotations

import math

from pixel import (
  BARK, BARK_DARK, BARK_LIGHT, BLACK, CREAM, GLYPHS, LEAF, LEAF_DEEP, LEAF_LIGHT, LEAF_MID, OUT,
  OUT_SOFT, SHADOW, STONE, STONE_DARK, STONE_LIGHT, STONE_MID, T, WHITE, WOOD, WOOD_DARK,
  WOOD_LIGHT, WOOD_MID, disc_mask, draw_text_bitmap, fill_mask, frame, hline, mix, new, noise_rng,
  outline, put, rect, shade, vline,
)


# --- Nature -----------------------------------------------------------------------

def tree(seed: int, big: bool = False, autumn: bool = False):
  """Round-canopy tree: about 2 tiles wide, trunk centred, soft shadow."""
  rng = noise_rng(seed)
  w, h = (40, 52) if big else (32, 44)
  img = new(w, h)
  cx = w / 2
  # Shadow under the trunk.
  fill_mask(img, {(x, y + h - 9) for (x, y) in disc_mask(w, 8, cx, 4, w * 0.36, 3.2)}, SHADOW)
  # Trunk.
  tw = 6 if big else 5
  tx = int(cx - tw / 2)
  ty = h - 18
  rect(img, tx, ty, tw, 13, BARK)
  vline(img, tx, ty, 13, BARK_DARK)
  vline(img, tx + tw - 1, ty, 13, BARK_DARK)
  vline(img, tx + 2, ty + 2, 8, BARK_LIGHT)
  put(img, tx - 1, ty + 12, BARK_DARK)
  put(img, tx + tw, ty + 12, BARK_DARK)
  # Canopy: union of blobs.
  canopy_h = h - 14
  blobs = [(cx, canopy_h * 0.55, w * 0.46, canopy_h * 0.44)]
  for _ in range(5 if big else 4):
    bx = cx + rng.uniform(-w * 0.22, w * 0.22)
    by = canopy_h * rng.uniform(0.32, 0.62)
    r = rng.uniform(w * 0.2, w * 0.3)
    blobs.append((bx, by, r, r * 0.9))
  mask = set()
  for (bx, by, rx, ry) in blobs:
    mask |= disc_mask(w, canopy_h, bx, by, rx, ry)
  if autumn:
    base, light, mid, deep = (226, 140, 54, 255), (250, 196, 84, 255), (190, 98, 44, 255), (130, 62, 40, 255)
  else:
    base, light, mid, deep = LEAF, LEAF_LIGHT, LEAF_MID, LEAF_DEEP
  canopy = new(w, h)
  for (x, y) in mask:
    # Light from the upper left.
    t = (x - cx) / w + (y / canopy_h) * 0.9
    jitter = rng.uniform(-0.12, 0.12)
    v = t + jitter
    if v < 0.18:
      c = light
    elif v < 0.55:
      c = base
    elif v < 0.85:
      c = mid
    else:
      c = deep
    put(canopy, x, y, c)
  # Leaf clusters: small highlight arcs.
  for _ in range(14 if big else 10):
    lx = int(cx + rng.uniform(-w * 0.35, w * 0.3))
    ly = int(rng.uniform(canopy_h * 0.15, canopy_h * 0.8))
    if (lx, ly) in mask and (lx + 2, ly) in mask:
      c = light if ly < canopy_h * 0.5 else base
      put(canopy, lx, ly, c)
      put(canopy, lx + 1, ly - 1, c)
      put(canopy, lx + 2, ly, c)
      put(canopy, lx + 1, ly + 1, mid)
  canopy = outline(canopy, OUT_SOFT)
  img.alpha_composite(canopy)
  return img


def pine(seed: int):
  rng = noise_rng(seed)
  w, h = 28, 46
  img = new(w, h)
  fill_mask(img, {(x, y + h - 8) for (x, y) in disc_mask(w, 7, w / 2, 3.5, 10, 3)}, SHADOW)
  rect(img, w // 2 - 2, h - 13, 4, 9, BARK)
  vline(img, w // 2 - 2, h - 13, 9, BARK_DARK)
  body = new(w, h)
  layers = [(4, 12, 6), (12, 22, 10), (20, 33, 13)]
  for (y0, y1, half) in layers:
    for y in range(y0, y1):
      t = (y - y0) / max(1, (y1 - y0 - 1))
      hw = int(2 + t * half)
      for x in range(w // 2 - hw, w // 2 + hw):
        side = (x - (w // 2 - hw)) / max(1, 2 * hw)
        c = LEAF_DEEP if side > 0.7 else (LEAF_MID if side > 0.35 else (46, 160, 70, 255))
        if rng.random() < 0.05:
          c = LEAF
        put(body, x, y, c)
  body = outline(body, OUT_SOFT)
  img.alpha_composite(body)
  return img


def flower_patch(seed: int, palette=None):
  rng = noise_rng(seed)
  img = new(16, 16)
  colours = palette or [(248, 112, 128, 255), (255, 214, 92, 255), (180, 140, 255, 255), WHITE]
  for _ in range(5):
    x, y = rng.randint(2, 13), rng.randint(2, 13)
    c = rng.choice(colours)
    put(img, x, y - 1, c)
    put(img, x - 1, y, c)
    put(img, x + 1, y, c)
    put(img, x, y + 1, c)
    put(img, x, y, (255, 240, 160, 255))
    put(img, x, y + 2, LEAF_MID)
  return img


# --- Street furniture -------------------------------------------------------------------

def lamp():
  w, h = 12, 40
  img = new(w, h)
  fill_mask(img, {(x, y + h - 5) for (x, y) in disc_mask(w, 5, w / 2, 2.5, 5, 2)}, SHADOW)
  post = (58, 54, 72, 255)
  post_hi = (98, 96, 118, 255)
  rect(img, 5, 12, 2, h - 15, post)
  vline(img, 5, 12, h - 15, post_hi)
  rect(img, 3, h - 6, 6, 2, post)
  # Lantern.
  rect(img, 2, 3, 8, 9, (255, 214, 120, 255))
  rect(img, 3, 4, 6, 7, (255, 238, 170, 255))
  frame(img, 2, 3, 8, 9, post)
  hline(img, 1, 2, 10, post)
  hline(img, 3, 1, 6, post)
  put(img, 5, 0, post)
  put(img, 6, 0, post)
  vline(img, 5, 4, 7, post)
  return outline(img, OUT)


def lamp_glow():
  """Additive-looking warm glow drawn under the lantern at night-ish ambience."""
  w = h = 48
  img = new(w, h)
  for y in range(h):
    for x in range(w):
      d = math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / (w / 2)
      if d < 1:
        a = int(70 * (1 - d) ** 2)
        if a:
          img.putpixel((x, y), (255, 214, 120, a))
  return img


ICON_BITMAPS = {
  # 10x9 one-colour icons painted onto house signs.
  'chess': [
    '...###....', '..#####...', '.##.####..', '.########.', '....#####.', '...####...', '..######..',
    '.########.', '.########.'],
  'games': [
    '..........', '.########.', '##.####.##', '#.#.##.#.#', '###.##.###', '#.#.##.#.#', '##.####.##',
    '.########.', '..........'],
  'film': [
    '##########', '#.#.##.#.#', '##########', '#........#', '#..####..#', '#........#', '##########',
    '#.#.##.#.#', '##########'],
  'coffee': [
    '..#..#....', '...#..#...', '..#..#....', '#######...', '#######.#.', '#######..#', '#######.#.',
    '.#####....', '########..'],
}


def sign(board, icon: str, colour):
  """Pack signboard (32x26) with a painted icon on its face."""
  img = board.copy()
  rows = ICON_BITMAPS[icon]
  ox = (img.width - len(rows[0])) // 2
  oy = 4
  for y, row in enumerate(rows):
    for x, bit in enumerate(row):
      if bit == '#':
        put(img, ox + x, oy + y, colour)
  return img


def notice_board():
  w, h = 32, 30
  img = new(w, h)
  rect(img, 4, 18, 3, 11, WOOD_MID)
  rect(img, w - 7, 18, 3, 11, WOOD_MID)
  rect(img, 1, 2, w - 2, 18, WOOD)
  frame(img, 1, 2, w - 2, 18, WOOD_DARK)
  rect(img, 3, 4, w - 6, 14, (226, 196, 150, 255))
  # Pinned notes.
  for (x, y, c) in [(5, 5, WHITE), (13, 6, (255, 236, 140, 255)), (21, 5, (180, 220, 255, 255)),
                    (8, 11, (255, 200, 210, 255)), (18, 11, WHITE)]:
    rect(img, x, y, 6, 5, c)
    put(img, x + 2, y, (220, 60, 60, 255))
  return outline(img, OUT)


# --- Game furniture ----------------------------------------------------------------------

def chess_table():
  """2x2-tile table with an 8x8 board on top (seen from the 3/4 view)."""
  w, h = 32, 30
  img = new(w, h)
  fill_mask(img, {(x, y + h - 6) for (x, y) in disc_mask(w, 6, w / 2, 3, 14, 3)}, SHADOW)
  # Legs.
  rect(img, 4, 18, 3, 9, WOOD_DARK)
  rect(img, w - 7, 18, 3, 9, WOOD_DARK)
  # Top.
  rect(img, 1, 1, w - 2, 18, WOOD)
  hline(img, 1, 1, w - 2, WOOD_LIGHT)
  rect(img, 1, 17, w - 2, 3, WOOD_MID)
  # Board 8x8 of 3px squares.
  bx, by = 4, 2
  for r in range(8):
    for c in range(8):
      col = (238, 226, 196, 255) if (r + c) % 2 == 0 else (110, 74, 58, 255)
      rect(img, bx + c * 3, by + r * 2, 3, 2, col)
  frame(img, bx - 1, by - 1, 26, 18, WOOD_DARK)
  # A few pieces as dots.
  for (c, r, col) in [(1, 1, BLACK), (4, 0, BLACK), (6, 2, BLACK), (2, 6, WHITE), (4, 7, WHITE), (5, 5, WHITE)]:
    put(img, bx + c * 3 + 1, by + r * 2, col)
    put(img, bx + c * 3 + 1, by + r * 2 + 1, col)
  return outline(img, OUT)


def connect4_table():
  w, h = 32, 40
  img = new(w, h)
  fill_mask(img, {(x, y + h - 6) for (x, y) in disc_mask(w, 6, w / 2, 3, 14, 3)}, SHADOW)
  rect(img, 4, 30, 3, 8, WOOD_DARK)
  rect(img, w - 7, 30, 3, 8, WOOD_DARK)
  rect(img, 1, 22, w - 2, 9, WOOD)
  hline(img, 1, 22, w - 2, WOOD_LIGHT)
  rect(img, 1, 29, w - 2, 2, WOOD_MID)
  # Upright blue grid 7x6.
  blue, blue_dark = (54, 104, 214, 255), (32, 64, 150, 255)
  rect(img, 3, 1, w - 6, 23, blue)
  frame(img, 3, 1, w - 6, 23, blue_dark)
  rect(img, 2, 23, 3, 3, blue_dark)
  rect(img, w - 5, 23, 3, 3, blue_dark)
  pattern = ['.......', '.......', '...y...', '..ry...', '.ryry..', 'yrryrr.']
  for r in range(6):
    for c in range(7):
      x, y = 5 + c * 3 + (c // 3), 3 + r * 3 + (r // 3)
      ch = pattern[r][c]
      colr = {'r': (226, 62, 62, 255), 'y': (250, 210, 60, 255)}.get(ch, (20, 34, 80, 255))
      rect(img, x, y, 2, 2, colr)
  return outline(img, OUT)


def arcade(body, accent):
  w, h = 16, 34
  img = new(w, h)
  fill_mask(img, {(x, y + h - 5) for (x, y) in disc_mask(w, 5, w / 2, 2.5, 7, 2)}, SHADOW)
  rect(img, 1, 2, w - 2, h - 5, body)
  vline(img, 1, 2, h - 5, shade(body, 0.7))
  rect(img, 2, 0, w - 4, 4, accent)
  # Screen.
  rect(img, 3, 6, w - 6, 9, (20, 24, 40, 255))
  rect(img, 4, 7, w - 8, 7, (60, 220, 200, 255))
  put(img, 6, 9, WHITE)
  put(img, 9, 11, (255, 240, 120, 255))
  # Control deck.
  rect(img, 1, 16, w - 2, 4, shade(body, 1.2))
  put(img, 5, 17, (230, 60, 60, 255))
  put(img, 9, 17, (250, 220, 70, 255))
  put(img, 11, 17, (70, 200, 250, 255))
  rect(img, 4, 21, w - 8, 8, shade(body, 0.85))
  return outline(img, OUT)


def tv():
  """4x2-tile wall TV; the screen rect is (5, 4, 54, 22) for runtime painting."""
  w, h = 64, 34
  img = new(w, h)
  bezel, bezel_hi = (40, 40, 52, 255), (74, 74, 92, 255)
  rect(img, 1, 1, w - 2, h - 6, bezel)
  hline(img, 1, 1, w - 2, bezel_hi)
  rect(img, 5, 4, 54, 22, (16, 20, 34, 255))
  # Idle screen sheen.
  for i in range(10):
    put(img, 8 + i, 6 + i // 3, (42, 52, 84, 255))
  rect(img, 26, h - 5, 12, 2, bezel)
  put(img, w - 6, h - 9, (90, 230, 120, 255))
  return outline(img, OUT)


TV_SCREEN = (5 + 1, 4 + 1, 54, 22)  # +1 for the outline padding added above? (outline keeps size)


def sofa_back(colour, tiles=3):
  """Back of a sofa facing north (drawn over seated avatars' legs)."""
  w, h = tiles * T, 14
  img = new(w, h)
  rect(img, 1, 2, w - 2, 10, colour)
  hline(img, 1, 2, w - 2, shade(colour, 1.25))
  rect(img, 1, 9, w - 2, 3, shade(colour, 0.75))
  for i in range(1, tiles):
    vline(img, i * T, 3, 6, shade(colour, 0.8))
  rect(img, 0, 3, 3, 10, shade(colour, 0.85))
  rect(img, w - 3, 3, 3, 10, shade(colour, 0.85))
  return outline(img, OUT)


def sofa_seat(colour, tiles=3):
  w, h = tiles * T, T
  img = new(w, h)
  rect(img, 1, 3, w - 2, 12, shade(colour, 0.92))
  for i in range(tiles):
    rect(img, i * T + 2, 4, T - 4, 8, colour)
    hline(img, i * T + 2, 4, T - 4, shade(colour, 1.2))
  return outline(img, OUT)


# --- Café, hall and office furniture -------------------------------------------------------

def counter(tiles=5):
  w, h = tiles * T, 30
  img = new(w, h)
  rect(img, 0, 6, w, 22, WOOD_MID)
  rect(img, 0, 2, w, 8, WOOD)
  hline(img, 0, 2, w, WOOD_LIGHT)
  for i in range(tiles):
    rect(img, i * T + 3, 13, T - 6, 12, shade(WOOD_MID, 0.85))
  # Espresso machine.
  rect(img, 6, -0 + 0, 14, 10, (180, 188, 200, 255))
  rect(img, 8, 2, 10, 4, (90, 96, 110, 255))
  put(img, 12, 8, (60, 40, 30, 255))
  # Cups and a cake stand.
  for x in (30, 36):
    rect(img, x, 3, 4, 4, WHITE)
  rect(img, w - 22, 1, 12, 3, (238, 160, 190, 255))
  rect(img, w - 20, 0, 8, 2, (255, 220, 230, 255))
  return outline(img, OUT)


def menu_board():
  w, h = 32, 22
  img = new(w, h)
  rect(img, 1, 1, w - 2, h - 2, (44, 58, 52, 255))
  frame(img, 1, 1, w - 2, h - 2, WOOD)
  draw_text_bitmap(img, 4, 4, 'MENU', GLYPHS, (240, 236, 220, 255))
  for i, y in enumerate((11, 15)):
    hline(img, 4, y, 14 - i * 3, (200, 200, 190, 255))
    hline(img, 22, y, 5, (250, 210, 120, 255))
  return outline(img, OUT)


def cafe_table():
  w, h = 22, 22
  img = new(w, h)
  fill_mask(img, {(x, y + h - 6) for (x, y) in disc_mask(w, 6, w / 2, 3, 9, 3)}, SHADOW)
  rect(img, 10, 10, 2, 9, WOOD_DARK)
  rect(img, 7, 17, 8, 2, WOOD_DARK)
  top = disc_mask(w, 12, w / 2, 6, 10, 5.5)
  fill_mask(img, top, WOOD)
  fill_mask(img, {(x, y) for (x, y) in top if y < 5}, WOOD_LIGHT)
  rect(img, 7, 3, 3, 3, WHITE)
  put(img, 8, 4, (120, 72, 50, 255))
  return outline(img, OUT)


def conference_table(tw=4, th=2):
  w, h = tw * T, th * T + 6
  img = new(w, h)
  fill_mask(img, {(x, y + h - 6) for (x, y) in disc_mask(w, 6, w / 2, 3, w * 0.45, 3)}, SHADOW)
  rect(img, 1, 1, w - 2, th * T - 2, WOOD)
  hline(img, 1, 1, w - 2, WOOD_LIGHT)
  rect(img, 1, th * T - 3, w - 2, 4, WOOD_MID)
  rect(img, 4, th * T, 3, 4, WOOD_DARK)
  rect(img, w - 7, th * T, 3, 4, WOOD_DARK)
  # Laptops and papers.
  for x in range(6, w - 10, 16):
    rect(img, x, 6, 9, 6, (60, 64, 80, 255))
    rect(img, x + 1, 7, 7, 4, (120, 200, 255, 255))
    rect(img, x + 1, 16, 8, 6, WHITE)
    hline(img, x + 2, 18, 5, (170, 170, 190, 255))
  return outline(img, OUT)


def chair(colour=WOOD, facing='down'):
  w, h = 14, 18
  img = new(w, h)
  if facing == 'down':
    rect(img, 2, 0, w - 4, 8, shade(colour, 0.9))
    hline(img, 2, 0, w - 4, shade(colour, 1.2))
    rect(img, 1, 8, w - 2, 5, colour)
  else:
    rect(img, 1, 3, w - 2, 5, colour)
    rect(img, 2, 8, w - 4, 7, shade(colour, 0.9))
  rect(img, 2, 13, 2, 4, WOOD_DARK)
  rect(img, w - 4, 13, 2, 4, WOOD_DARK)
  return outline(img, OUT)


def whiteboard():
  w, h = 48, 26
  img = new(w, h)
  rect(img, 1, 1, w - 2, h - 6, (246, 248, 250, 255))
  frame(img, 1, 1, w - 2, h - 6, STONE_DARK)
  # Doodles.
  for i in range(16):
    put(img, 6 + i, 8 + int(3 * math.sin(i / 2.5)), (60, 120, 220, 255))
  rect(img, 28, 6, 12, 2, (230, 80, 80, 255))
  rect(img, 28, 10, 9, 2, (60, 170, 90, 255))
  rect(img, 6, h - 5, w - 12, 2, STONE_DARK)
  return outline(img, OUT)


def reception_desk(tiles=4):
  w, h = tiles * T, 26
  img = new(w, h)
  rect(img, 0, 4, w, 20, (110, 82, 140, 255))
  rect(img, 0, 2, w, 5, (150, 120, 178, 255))
  hline(img, 0, 2, w, (190, 166, 214, 255))
  for i in range(tiles):
    rect(img, i * T + 3, 10, T - 6, 11, (96, 70, 124, 255))
  rect(img, w - 18, 0, 10, 4, (230, 230, 240, 255))  # a bell / papers
  put(img, 10, 1, (255, 210, 80, 255))
  return outline(img, OUT)


def water_cooler():
  w, h = 12, 28
  img = new(w, h)
  rect(img, 2, 10, 8, 16, (210, 214, 224, 255))
  rect(img, 3, 1, 6, 10, (140, 200, 250, 255))
  hline(img, 3, 1, 6, (200, 236, 255, 255))
  put(img, 4, 14, (230, 60, 60, 255))
  put(img, 7, 14, (60, 120, 230, 255))
  return outline(img, OUT)


def popcorn_machine():
  w, h = 16, 32
  img = new(w, h)
  rect(img, 2, 18, 12, 12, (200, 40, 40, 255))
  rect(img, 1, 3, 14, 16, (210, 230, 240, 255))
  frame(img, 1, 3, 14, 16, (200, 40, 40, 255))
  for (x, y) in [(3, 13), (5, 12), (8, 14), (10, 12), (12, 13), (4, 15), (7, 16), (11, 15), (6, 14), (9, 16)]:
    put(img, x, y, (255, 246, 200, 255))
    put(img, x, y + 1, (250, 220, 120, 255))
  rect(img, 3, 0, 10, 3, (200, 40, 40, 255))
  draw_text_bitmap(img, 4, 21, 'POP', {k: GLYPHS[k] for k in 'OP'}, (255, 240, 200, 255))
  return outline(img, OUT)


def curtain(tiles=10):
  w, h = tiles * T, 32
  img = new(w, h)
  red, red_dark, red_light = (176, 34, 54, 255), (118, 20, 40, 255), (214, 62, 80, 255)
  for x in range(w):
    phase = (x % 8)
    c = red_light if phase in (1, 2) else (red_dark if phase in (6, 7) else red)
    vline(img, x, 0, h, c)
  hline(img, 0, 0, w, (224, 180, 70, 255))
  hline(img, 0, 1, w, (180, 130, 40, 255))
  for x in range(0, w, 4):
    put(img, x, h - 1, (224, 180, 70, 255))
  return img


def stage(tw, th):
  """Raised wooden stage floor; front lip drawn as part of the floor."""
  w, h = tw * T, th * T
  img = new(w, h)
  for y in range(h):
    for x in range(w):
      plank = (y // 4) % 2
      c = (192, 140, 86, 255) if plank else (176, 126, 78, 255)
      if (x + (y // 4) * 7) % 23 == 0:
        c = (150, 104, 66, 255)
      img.putpixel((x, y), c)
  # Front edge (lip) on the last 5 rows.
  rect(img, 0, h - 5, w, 5, (120, 80, 56, 255))
  hline(img, 0, h - 5, w, (226, 176, 112, 255))
  return img


def spotlight_floor():
  """Round pool of light on the stage (alpha blended)."""
  w, h = 40, 26
  img = new(w, h)
  for y in range(h):
    for x in range(w):
      d = math.hypot((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - h / 2) / (h / 2))
      if d < 1:
        a = int(150 * (1 - d) ** 0.6)
        img.putpixel((x, y), (255, 244, 190, a))
  # Rim.
  for (x, y) in disc_mask(w, h, w / 2, h / 2, w / 2, h / 2):
    if (x - 1, y) not in disc_mask(w, h, w / 2, h / 2, w / 2, h / 2):
      pass
  return img


def podium():
  w, h = 18, 24
  img = new(w, h)
  rect(img, 2, 6, 14, 16, WOOD_MID)
  rect(img, 1, 2, 16, 6, WOOD)
  hline(img, 1, 2, 16, WOOD_LIGHT)
  rect(img, 6, 11, 6, 6, (224, 180, 70, 255))
  put(img, 8, 0, (70, 70, 80, 255))
  put(img, 8, 1, (70, 70, 80, 255))
  rect(img, 7, -1 + 1, 3, 1, (40, 40, 48, 255))
  return outline(img, OUT)


def bench(tiles=3, colour=WOOD):
  """Audience bench seen from behind (backrest at the bottom)."""
  return sofa_back(colour, tiles)


def plant_big(seed=1):
  rng = noise_rng(seed)
  w, h = 18, 30
  img = new(w, h)
  rect(img, 4, 20, 10, 8, (196, 112, 72, 255))
  hline(img, 4, 20, 10, (226, 150, 100, 255))
  rect(img, 5, 27, 8, 2, (150, 82, 56, 255))
  leaves = new(w, h)
  for _ in range(9):
    x = rng.randint(3, 13)
    y = rng.randint(2, 17)
    L = rng.randint(4, 7)
    for i in range(L):
      put(leaves, x + (i if rng.random() < 0.5 else -i) // 2, y + i, LEAF if i % 3 else LEAF_LIGHT)
      put(leaves, x + 1 + i // 2, y + i, LEAF_MID)
  img.alpha_composite(outline(leaves, OUT_SOFT))
  return outline(img, OUT)


def rug(tw, th, base, border, pattern=None):
  w, h = tw * T, th * T
  img = new(w, h)
  rect(img, 2, 2, w - 4, h - 4, base)
  frame(img, 2, 2, w - 4, h - 4, border)
  frame(img, 4, 4, w - 8, h - 8, shade(border, 1.15))
  for y in range(6, h - 6, 6):
    for x in range(6 + (y // 6 % 2) * 3, w - 6, 6):
      put(img, x, y, pattern or shade(base, 1.18))
  return img


# --- Floors and walls -----------------------------------------------------------------------

def floor_wood(w, h, seed=0, tone=1.0):
  rng = noise_rng(seed)
  img = new(w, h)
  light, mid, dark = shade(WOOD, tone), shade(WOOD_MID, tone * 1.06), shade(WOOD_DARK, tone)
  board_h = 5
  for y in range(h):
    row = y // board_h
    offset = (row * 11) % 32
    for x in range(w):
      c = light
      if (x + offset) % 32 == 0:
        c = mid
      if y % board_h == board_h - 1:
        c = mid
      img.putpixel((x, y), c)
  # Knots.
  for _ in range((w * h) // 400):
    put(img, rng.randrange(w), rng.randrange(h), dark)
  return img


def floor_check(w, h, a, b, size=8):
  img = new(w, h)
  for y in range(h):
    for x in range(w):
      img.putpixel((x, y), a if ((x // size) + (y // size)) % 2 == 0 else b)
  return img


def floor_carpet(w, h, base, accent):
  img = new(w, h)
  for y in range(h):
    for x in range(w):
      c = base
      if (x % 16 in (7, 8)) and (y % 16 in (7, 8)):
        c = accent
      elif (x + y) % 16 == 0 and (x // 16 + y // 16) % 2 == 0:
        c = shade(base, 1.12)
      img.putpixel((x, y), c)
  return img


def floor_stone(w, h):
  img = new(w, h)
  for y in range(h):
    for x in range(w):
      bx, by = x % 16, y % 16
      c = STONE if (x // 16 + y // 16) % 2 == 0 else STONE_MID
      if bx == 0 or by == 0:
        c = STONE_DARK
      elif bx == 1 or by == 1:
        c = STONE_LIGHT
      img.putpixel((x, y), c)
  return img


WALL_PLASTER = (236, 222, 196, 255)


def wall_face(w, plaster=WALL_PLASTER, wainscot=WOOD_MID):
  """North wall face, two tiles tall: plaster above wainscot and a baseboard."""
  h = 2 * T
  img = new(w, h)
  rect(img, 0, 0, w, h, plaster)
  for x in range(0, w, 4):
    put(img, x + (2 if (x // 4) % 2 else 0), 5, shade(plaster, 0.95))
    put(img, x + 1, 13, shade(plaster, 0.95))
  rect(img, 0, 18, w, 12, wainscot)
  hline(img, 0, 18, w, shade(wainscot, 1.25))
  for x in range(0, w, 8):
    vline(img, x, 19, 11, shade(wainscot, 0.8))
  rect(img, 0, h - 2, w, 2, shade(wainscot, 0.6))
  return img


def wall_cap(w, h, colour=(62, 46, 70, 255)):
  """Top of a wall seen from above (dark band with a lighter lip)."""
  img = new(w, h)
  rect(img, 0, 0, w, h, colour)
  hline(img, 0, h - 1, w, shade(colour, 1.35))
  return img


def door_mat():
  img = new(T, T)
  rect(img, 2, 3, 12, 10, (150, 70, 60, 255))
  frame(img, 2, 3, 12, 10, (110, 50, 44, 255))
  for x in range(4, 12, 2):
    vline(img, x, 5, 6, (176, 90, 74, 255))
  return img


def exit_arrow():
  img = new(T, T)
  c = (255, 255, 255, 150)
  for i in range(4):
    hline(img, 8 - i, 6 + i, 1 + i * 2, c)
  rect(img, 7, 10, 2, 3, c)
  return img


def plaza_cobbles(w, h, seed=11):
  """Calm light-grey cobbles in a running bond, with gentle variation and mortar."""
  rng = noise_rng(seed)
  img = new(w, h)
  mortar = (150, 152, 160, 255)
  base = [(206, 204, 198, 255), (198, 197, 193, 255), (212, 210, 203, 255), (192, 192, 190, 255)]
  rect(img, 0, 0, w, h, mortar)
  sh, sw = 6, 10
  for row in range(0, h // sh + 1):
    offset = (row % 2) * (sw // 2)
    for col in range(-1, w // sw + 2):
      x0, y0 = col * sw + offset, row * sh
      c = rng.choice(base)
      if rng.random() < 0.05:
        c = (184, 196, 176, 255)  # a touch of moss
      rect(img, x0 + 1, y0 + 1, sw - 1, sh - 1, c)
      hline(img, x0 + 1, y0 + 1, sw - 2, shade(c, 1.06))
      hline(img, x0 + 1, y0 + sh - 1, sw - 1, shade(c, 0.9))
  return img


def mosaic_ring(radius_px, width_px, colour=(196, 160, 112, 255), accent=(170, 130, 88, 255)):
  """A warm stone ring (alpha) centred in its image, for the fountain square."""
  size = 2 * radius_px + 2
  img = new(size, size)
  c = size / 2
  for y in range(size):
    for x in range(size):
      d = math.hypot(x + 0.5 - c, y + 0.5 - c)
      if radius_px - width_px <= d <= radius_px:
        ang = math.atan2(y + 0.5 - c, x + 0.5 - c)
        tile = int((ang + math.pi) / (2 * math.pi) * 48)
        col = colour if tile % 2 == 0 else accent
        if abs(d - radius_px) < 1 or abs(d - (radius_px - width_px)) < 1:
          col = shade(accent, 0.8)
        img.putpixel((x, y), col)
  return img


# --- Round 2: seating, grand Town Hall, monuments --------------------------------------------

def chess_table_wide():
  """3-tile table with the 8x8 board centred, so chairs sit square to the board."""
  w, h = 48, 30
  img = new(w, h)
  fill_mask(img, {(x, y + h - 6) for (x, y) in disc_mask(w, 6, w / 2, 3, 20, 3)}, SHADOW)
  rect(img, 6, 18, 3, 9, WOOD_DARK)
  rect(img, w - 9, 18, 3, 9, WOOD_DARK)
  rect(img, 1, 1, w - 2, 18, WOOD)
  hline(img, 1, 1, w - 2, WOOD_LIGHT)
  rect(img, 1, 17, w - 2, 3, WOOD_MID)
  bx, by = (w - 24) // 2, 2
  for r in range(8):
    for c in range(8):
      col = (238, 226, 196, 255) if (r + c) % 2 == 0 else (110, 74, 58, 255)
      rect(img, bx + c * 3, by + r * 2, 3, 2, col)
  frame(img, bx - 1, by - 1, 26, 18, WOOD_DARK)
  for (c, r, col) in [(1, 1, BLACK), (4, 0, BLACK), (6, 2, BLACK), (2, 6, WHITE), (4, 7, WHITE), (5, 5, WHITE)]:
    put(img, bx + c * 3 + 1, by + r * 2, col)
    put(img, bx + c * 3 + 1, by + r * 2 + 1, col)
  return outline(img, OUT)


def connect4_table_wide():
  w, h = 48, 40
  img = new(w, h)
  fill_mask(img, {(x, y + h - 6) for (x, y) in disc_mask(w, 6, w / 2, 3, 20, 3)}, SHADOW)
  rect(img, 6, 30, 3, 8, WOOD_DARK)
  rect(img, w - 9, 30, 3, 8, WOOD_DARK)
  rect(img, 1, 22, w - 2, 9, WOOD)
  hline(img, 1, 22, w - 2, WOOD_LIGHT)
  rect(img, 1, 29, w - 2, 2, WOOD_MID)
  blue, blue_dark = (54, 104, 214, 255), (32, 64, 150, 255)
  gx = (w - 26) // 2
  rect(img, gx, 1, 26, 23, blue)
  frame(img, gx, 1, 26, 23, blue_dark)
  rect(img, gx - 1, 23, 3, 3, blue_dark)
  rect(img, gx + 24, 23, 3, 3, blue_dark)
  pattern = ['.......', '.......', '...y...', '..ry...', '.ryry..', 'yrryrr.']
  for r in range(6):
    for c in range(7):
      x, y = gx + 2 + c * 3 + (c // 3), 3 + r * 3 + (r // 3)
      ch = pattern[r][c]
      colr = {'r': (226, 62, 62, 255), 'y': (250, 210, 60, 255)}.get(ch, (20, 34, 80, 255))
      rect(img, x, y, 2, 2, colr)
  return outline(img, OUT)


def chair_parts(colour=WOOD, facing='down'):
  """A chair split into a seat (drawn under a sitter) and a backrest.

  For 'down' the backrest is behind the sitter (north) and is drawn first; for
  'up' it is in front of the sitter (south) and is drawn over their legs; for
  'left'/'right' it stands on the far side.
  """
  seat = new(16, 16)
  back = new(16, 16)
  dark = shade(colour, 0.78)
  if facing in ('down', 'up'):
    rect(seat, 2, 6, 12, 7, colour)
    hline(seat, 2, 6, 12, shade(colour, 1.18))
    rect(seat, 3, 12, 2, 4, WOOD_DARK)
    rect(seat, 11, 12, 2, 4, WOOD_DARK)
    rect(back, 2, 0, 12, 7, dark)
    hline(back, 2, 0, 12, shade(colour, 1.1))
    vline(back, 4, 1, 5, shade(colour, 0.7))
    vline(back, 11, 1, 5, shade(colour, 0.7))
  else:
    rect(seat, 2, 6, 12, 7, colour)
    hline(seat, 2, 6, 12, shade(colour, 1.18))
    rect(seat, 3, 12, 2, 4, WOOD_DARK)
    rect(seat, 11, 12, 2, 4, WOOD_DARK)
    bx = 1 if facing == 'right' else 11
    rect(back, bx, 0, 4, 13, dark)
    vline(back, bx, 0, 13, shade(colour, 1.1))
  return outline(seat, OUT), outline(back, OUT)


def sofa_row(colour, seats=3):
  """Cinema sofa facing north: seat cushions (ground) and a backrest strip drawn over sitters."""
  w = seats * T
  seat = new(w, T)
  rect(seat, 1, 2, w - 2, 13, shade(colour, 0.9))
  for i in range(seats):
    rect(seat, i * T + 2, 3, T - 4, 9, colour)
    hline(seat, i * T + 2, 3, T - 4, shade(colour, 1.22))
  back = new(w + 4, 12)
  rect(back, 2, 1, w, 9, colour)
  hline(back, 2, 1, w, shade(colour, 1.25))
  rect(back, 2, 7, w, 3, shade(colour, 0.72))
  rect(back, 0, 2, 4, 9, shade(colour, 0.82))
  rect(back, w, 2, 4, 9, shade(colour, 0.82))
  for i in range(1, seats):
    vline(back, 2 + i * T, 2, 5, shade(colour, 0.8))
  return outline(seat, OUT), outline(back, OUT)


def bench_back(tiles=3, colour=(120, 84, 60, 255)):
  """Backrest of an audience bench that faces north (drawn over seated legs)."""
  w = tiles * T
  img = new(w + 2, 10)
  rect(img, 1, 1, w, 6, colour)
  hline(img, 1, 1, w, shade(colour, 1.25))
  rect(img, 1, 6, w, 2, shade(colour, 0.7))
  return outline(img, OUT)


def bench_seat(tiles=3, colour=(120, 84, 60, 255)):
  w = tiles * T
  img = new(w, T)
  rect(img, 1, 4, w - 2, 7, shade(colour, 1.08))
  for x in range(4, w, 6):
    vline(img, x, 5, 5, shade(colour, 0.85))
  rect(img, 3, 11, 2, 4, WOOD_DARK)
  rect(img, w - 5, 11, 2, 4, WOOD_DARK)
  return outline(img, OUT)


def torch_post():
  w, h = 12, 30
  img = new(w, h)
  fill_mask(img, {(x, y + h - 5) for (x, y) in disc_mask(w, 5, w / 2, 2.5, 5, 2)}, SHADOW)
  post = (74, 66, 84, 255)
  rect(img, 4, 8, 4, h - 11, post)
  vline(img, 4, 8, h - 11, (110, 100, 124, 255))
  rect(img, 2, 5, 8, 4, (92, 82, 100, 255))
  rect(img, 3, h - 5, 6, 2, post)
  return outline(img, OUT)


def grand_stairs(tiles_w, tiles_h=2):
  w, h = tiles_w * T, tiles_h * T
  img = new(w, h)
  steps = 4
  sh = h // steps
  for i in range(steps):
    y = i * sh
    c = shade(STONE, 1.05 - i * 0.05)
    rect(img, 0, y, w, sh, c)
    hline(img, 0, y, w, STONE_LIGHT)
    hline(img, 0, y + sh - 1, w, STONE_DARK)
  vline(img, 0, 0, h, STONE_DARK)
  vline(img, w - 1, 0, h, STONE_DARK)
  # A red runner up the middle.
  rw = min(4 * T, w - 2 * T)
  rx = (w - rw) // 2
  rect(img, rx, 0, rw, h, (168, 36, 52, 255))
  vline(img, rx, 0, h, (224, 180, 70, 255))
  vline(img, rx + rw - 1, 0, h, (224, 180, 70, 255))
  for i in range(steps):
    hline(img, rx, i * sh + sh - 1, rw, (120, 22, 36, 255))
  return img


def arched_window(lit=True):
  w, h = 12, 18
  img = new(w, h)
  glass = (255, 212, 120, 255) if lit else (70, 90, 130, 255)
  mask = {(x, y) for y in range(3, h - 1) for x in range(1, w - 1)}
  mask |= {(x, y) for (x, y) in disc_mask(w, 8, w / 2, 6, 5, 5)}
  fill_mask(img, mask, glass)
  for y in range(2, h - 1):
    put(img, w // 2, y, (90, 70, 60, 255))
  hline(img, 1, 9, w - 2, (90, 70, 60, 255))
  for (x, y) in list(mask):
    if y < 8 and x < w // 2:
      put(img, x, y, shade(glass, 1.08))
  return outline(img, (52, 48, 64, 255))


def mobius_pedestal():
  """Round stone pedestal for the Möbius strip monument (about 5x3 tiles)."""
  w, h = 80, 44
  img = new(w, h)
  fill_mask(img, {(x, y + h - 12) for (x, y) in disc_mask(w, 12, w / 2, 6, w * 0.48, 6)}, SHADOW)
  top = disc_mask(w, 20, w / 2, 10, w * 0.42, 9)
  side = {(x, y + 8) for (x, y) in disc_mask(w, 20, w / 2, 10, w * 0.42, 9)}
  fill_mask(img, side, STONE_DARK)
  for (x, y) in side:
    if (x // 6) % 2 == 0:
      put(img, x, y, shade(STONE_DARK, 0.9))
  fill_mask(img, top, STONE)
  inner = disc_mask(w, 20, w / 2, 10, w * 0.32, 6.5)
  fill_mask(img, inner, STONE_LIGHT)
  ring = disc_mask(w, 20, w / 2, 10, w * 0.22, 4.5)
  fill_mask(img, ring, (120, 200, 210, 255))
  return outline(img, OUT)


def round_court(radius, seed=29):
  """A pixel-round cobbled court with a two-step stone curb."""
  size = 2 * radius + 4
  img = new(size, size)
  cob = plaza_cobbles(size, size, seed)
  c = size / 2
  src = cob.load()
  dst = img.load()
  for y in range(size):
    for x in range(size):
      d = math.hypot(x + 0.5 - c, y + 0.5 - c)
      if d <= radius - 2:
        dst[x, y] = src[x, y]
      elif d <= radius:
        dst[x, y] = STONE_LIGHT if d <= radius - 1 else STONE_DARK
  return img


# --- Football ground ----------------------------------------------------------------

PITCH_LINE = (240, 248, 236, 255)
PITCH_A = (70, 170, 70, 255)
PITCH_B = (82, 186, 78, 255)
PITCH_EDGE = (52, 132, 60, 255)


def football_pitch(field_w=352, field_h=192, margin=16, goal_mouth=56, goal_depth=14):
  """A mown pitch (stripes, white markings) with a grass margin and both goals painted in.

  The image is (field_w + 2 * margin) x (field_h + 2 * margin); the field's top-left corner sits at
  (margin, margin). Goals hang outside the end lines inside the margin.
  """
  w, h = field_w + 2 * margin, field_h + 2 * margin
  img = new(w, h)
  rect(img, 0, 0, w, h, PITCH_EDGE)
  rng = noise_rng(41)
  px = img.load()
  for y in range(h):
    for x in range(w):
      fx, fy = x - margin, y - margin
      if 0 <= fx < field_w and 0 <= fy < field_h:
        base = PITCH_A if (fx // 32) % 2 == 0 else PITCH_B
      else:
        base = PITCH_EDGE
      jitter = rng.random()
      px[x, y] = shade(base, 0.96) if jitter < 0.08 else shade(base, 1.04) if jitter > 0.94 else base

  def line_h(x0, x1, y):
    for x in range(int(x0), int(x1) + 1):
      if 0 <= x < w and 0 <= int(y) < h:
        px[x, int(y)] = PITCH_LINE

  def line_v(x, y0, y1):
    for y in range(int(y0), int(y1) + 1):
      if 0 <= int(x) < w and 0 <= y < h:
        px[int(x), y] = PITCH_LINE

  def box(x0, y0, x1, y1):
    line_h(x0, x1, y0)
    line_h(x0, x1, y1)
    line_v(x0, y0, y1)
    line_v(x1, y0, y1)

  m, cx, cy = margin, margin + field_w / 2, margin + field_h / 2
  box(m, m, m + field_w - 1, m + field_h - 1)
  line_v(cx, m, m + field_h - 1)
  for a in range(360):
    t = math.radians(a)
    x, y = cx + 28 * math.cos(t), cy + 28 * math.sin(t)
    px[int(round(x)), int(round(y))] = PITCH_LINE
  for (dx, dy) in ((0, 0), (-1, 0), (0, -1), (-1, -1)):
    px[int(cx) + dx, int(cy) + dy] = PITCH_LINE
  for side in (0, 1):
    x_line = m if side == 0 else m + field_w - 1
    direction = 1 if side == 0 else -1
    # Penalty box (48 deep, 112 tall), goal box (16 deep, 72 tall), penalty spot.
    for depth, half in ((48, 56), (16, 36)):
      xa, xb = sorted((x_line, x_line + direction * depth))
      box(xa, cy - half, xb, cy + half)
    sx = int(x_line + direction * 36)
    px[sx, int(cy)] = PITCH_LINE
    px[sx, int(cy) - 1] = PITCH_LINE
    # Penalty arc outside the box.
    for a in range(-50, 51):
      t = math.radians(a)
      x = x_line + direction * 36 + direction * 20 * math.cos(t)
      y = cy + 20 * math.sin(t)
      if (x - x_line) * direction > 48:
        px[int(round(x)), int(round(y))] = PITCH_LINE
    # The goal: a net box outside the end line with white posts and frame.
    top, bottom = int(cy - goal_mouth / 2), int(cy + goal_mouth / 2)
    gx0 = x_line - goal_depth if side == 0 else x_line + 1
    gx1 = x_line - 1 if side == 0 else x_line + goal_depth
    for y in range(top, bottom + 1):
      for x in range(gx0, gx1 + 1):
        net = (x + y) % 3 == 0 or (x - y) % 3 == 0
        px[x, y] = (214, 222, 214, 255) if net else shade(PITCH_EDGE, 0.82)
    for x in range(gx0, gx1 + 1):
      px[x, top] = WHITE
      px[x, bottom] = WHITE
    back = gx0 if side == 0 else gx1
    for y in range(top, bottom + 1):
      px[back, y] = (196, 204, 196, 255)
    for (py,) in ((top,), (bottom,)):
      for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
          px[x_line + dx, py + dy] = WHITE
  # Corner arcs.
  for (ccx, ccy, a0) in ((m, m, 0), (m + field_w - 1, m, 90), (m + field_w - 1, m + field_h - 1, 180),
                         (m, m + field_h - 1, 270)):
    for a in range(a0, a0 + 91, 6):
      t = math.radians(a)
      px[int(round(ccx + 4 * math.cos(t))), int(round(ccy + 4 * math.sin(t)))] = PITCH_LINE
  return img


def floodlight():
  """A tall floodlight mast with a bank of lamps."""
  w, h = 16, 64
  img = new(w, h)
  fill_mask(img, {(x, y + h - 5) for (x, y) in disc_mask(w, 5, w / 2, 3, 6, 2)}, SHADOW)
  pole = (70, 70, 86, 255)
  pole_hi = (120, 122, 140, 255)
  rect(img, 7, 10, 2, h - 13, pole)
  vline(img, 7, 10, h - 13, pole_hi)
  rect(img, 5, h - 5, 6, 2, pole)
  rect(img, 1, 2, 14, 8, pole)
  for by in (3, 6):
    for bx in (2, 6, 10):
      rect(img, bx, by, 3, 2, (255, 246, 200, 255))
      put(img, bx, by, (255, 255, 236, 255))
  return outline(img, OUT)
