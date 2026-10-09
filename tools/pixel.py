"""Small pixel-art toolkit for Mobius Town's build pipeline.

Everything here draws onto Pillow RGBA images at 1:1 pixel scale. Colours are
taken from the CC0 "Zelda-like tilesets and sprites" pack so procedural props sit
beside the pack's own art: dark plum outlines, three-step shading, no
anti-aliasing.
"""
from __future__ import annotations

import random
from PIL import Image

T = 16  # tile size in pixels

# Palette sampled from the pack.
OUT = (32, 23, 41, 255)          # outline (houses, furniture)
OUT_SOFT = (48, 38, 57, 255)     # outline (foliage)
SHADOW = (24, 18, 40, 90)        # ground shadow
GRASS = (58, 190, 65, 255)
GRASS_LIGHT = (106, 221, 75, 255)
GRASS_DARK = (41, 151, 59, 255)
LEAF = (46, 202, 53, 255)
LEAF_LIGHT = (98, 235, 61, 255)
LEAF_MID = (41, 151, 59, 255)
LEAF_DEEP = (45, 91, 63, 255)
WOOD_LIGHT = (207, 144, 84, 255)
WOOD = (168, 120, 72, 255)
WOOD_MID = (136, 80, 64, 255)
WOOD_DARK = (96, 48, 56, 255)
BARK = (121, 88, 79, 255)
BARK_DARK = (86, 58, 63, 255)
BARK_LIGHT = (148, 120, 92, 255)
STONE_LIGHT = (214, 214, 214, 255)
STONE = (192, 192, 192, 255)
STONE_MID = (163, 170, 177, 255)
STONE_DARK = (132, 138, 150, 255)
WATER = (30, 124, 184, 255)
WHITE = (248, 248, 248, 255)
CREAM = (238, 226, 196, 255)
BLACK = (23, 23, 23, 255)


def rgba(c, a=255):
  return (c[0], c[1], c[2], a)


def mix(a, b, t):
  return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3)) + (255,)


def shade(c, f):
  return tuple(max(0, min(255, int(round(v * f)))) for v in c[:3]) + (c[3] if len(c) > 3 else 255,)


def new(w, h, fill=(0, 0, 0, 0)):
  return Image.new('RGBA', (w, h), fill)


def rect(img, x, y, w, h, c):
  if w <= 0 or h <= 0:
    return
  img.paste(Image.new('RGBA', (w, h), c), (x, y, x + w, y + h))


def put(img, x, y, c):
  if 0 <= x < img.width and 0 <= y < img.height:
    img.putpixel((x, y), c)


def hline(img, x, y, w, c):
  rect(img, x, y, w, 1, c)


def vline(img, x, y, h, c):
  rect(img, x, y, 1, h, c)


def frame(img, x, y, w, h, c):
  hline(img, x, y, w, c)
  hline(img, x, y + h - 1, w, c)
  vline(img, x, y, h, c)
  vline(img, x + w - 1, y, h, c)


def disc_mask(w, h, cx, cy, rx, ry):
  """Set of pixels inside an ellipse."""
  pts = set()
  for y in range(h):
    for x in range(w):
      dx = (x + 0.5 - cx) / rx
      dy = (y + 0.5 - cy) / ry
      if dx * dx + dy * dy <= 1.0:
        pts.add((x, y))
  return pts


def fill_mask(img, mask, c):
  for (x, y) in mask:
    put(img, x, y, c)


def outline(img, color=OUT, diagonal=False):
  """Add a 1px outline outside every opaque pixel (returns a new image)."""
  w, h = img.size
  src = img.load()
  out = img.copy()
  o = out.load()
  steps = [(1, 0), (-1, 0), (0, 1), (0, -1)]
  if diagonal:
    steps += [(1, 1), (-1, -1), (1, -1), (-1, 1)]
  for y in range(h):
    for x in range(w):
      if src[x, y][3] != 0:
        continue
      for dx, dy in steps:
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] > 128:
          o[x, y] = color
          break
  return out


def pad(img, n=1):
  out = new(img.width + 2 * n, img.height + 2 * n)
  out.alpha_composite(img, (n, n))
  return out


def ellipse_shadow(w, h):
  img = new(w, h)
  fill_mask(img, disc_mask(w, h, w / 2, h / 2, w / 2, h / 2), SHADOW)
  return img


def recolor(img, mapping, region=None):
  """Swap exact RGB colours (alpha kept). region = (x0, y0, x1, y1) limits it."""
  out = img.copy()
  px = out.load()
  x0, y0, x1, y1 = region or (0, 0, img.width, img.height)
  for y in range(y0, y1):
    for x in range(x0, x1):
      r, g, b, a = px[x, y]
      if a and (r, g, b) in mapping:
        nr, ng, nb = mapping[(r, g, b)][:3]
        px[x, y] = (nr, ng, nb, a)
  return out


def noise_rng(seed):
  return random.Random(seed)


def draw_text_bitmap(img, x, y, text, glyphs, color):
  """Draw text with a tiny 3x5 bitmap font dictionary {char: ['xxx', ...]}"""
  cx = x
  for ch in text:
    g = glyphs.get(ch.upper())
    if g is None:
      cx += 4
      continue
    for gy, row in enumerate(g):
      for gx, bit in enumerate(row):
        if bit != '.':
          put(img, cx + gx, y + gy, color)
    cx += len(g[0]) + 1
  return cx


GLYPHS = {
  'A': ['.#.', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '##.', '#.#', '##.'],
  'C': ['.##', '#..', '#..', '#..', '.##'], 'D': ['##.', '#.#', '#.#', '#.#', '##.'],
  'E': ['###', '#..', '##.', '#..', '###'], 'F': ['###', '#..', '##.', '#..', '#..'],
  'G': ['.##', '#..', '#.#', '#.#', '.##'], 'H': ['#.#', '#.#', '###', '#.#', '#.#'],
  'I': ['###', '.#.', '.#.', '.#.', '###'], 'J': ['..#', '..#', '..#', '#.#', '.#.'],
  'K': ['#.#', '#.#', '##.', '#.#', '#.#'], 'L': ['#..', '#..', '#..', '#..', '###'],
  'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#'], 'N': ['#..#', '##.#', '#.##', '#..#', '#..#'],
  'O': ['.#.', '#.#', '#.#', '#.#', '.#.'], 'P': ['##.', '#.#', '##.', '#..', '#..'],
  'Q': ['.#.', '#.#', '#.#', '##.', '.##'], 'R': ['##.', '#.#', '##.', '#.#', '#.#'],
  'S': ['.##', '#..', '.#.', '..#', '##.'], 'T': ['###', '.#.', '.#.', '.#.', '.#.'],
  'U': ['#.#', '#.#', '#.#', '#.#', '###'], 'V': ['#.#', '#.#', '#.#', '#.#', '.#.'],
  'W': ['#...#', '#...#', '#.#.#', '##.##', '#...#'], 'X': ['#.#', '#.#', '.#.', '#.#', '#.#'],
  'Y': ['#.#', '#.#', '.#.', '.#.', '.#.'], 'Z': ['###', '..#', '.#.', '#..', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'], "'": ['#', '#', '.', '.', '.'],
  '.': ['.', '.', '.', '.', '#'], '-': ['...', '...', '###', '...', '...'],
}
