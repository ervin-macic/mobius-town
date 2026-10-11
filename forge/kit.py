"""The builder's art kit: parametric props, ground materials and court lines.

Everything is drawn here, in Python, in the town's palette (tools/pixel.py,
tools/props.py, the CC0 Zelda-like pack), so a creation looks like it always
belonged in Möbius Town. The compiler (forge/compile.py) turns a builder's spec
into images with this module; the town's browsers only draw the finished
pictures.

Contract
--------
An **item** is registered with `@item(name, category, doc, foot=(w, h), **params)`
and returns a `Made`:

- `foot`: footprint in tiles (w, h). A spec places an item with `at: [x, y]`,
  the footprint's top-left tile. Items whose size depends on a parameter return
  their real footprint in `Made.foot`.
- `pieces`: one or more `Piece`s. A piece is an image (or animation frames of
  one size) drawn with its top-left at (`dx`, `dy`) pixels from the footprint's
  top-left corner (negative `dy` lets tall things rise above the footprint).
  `z` is the piece's sort line in pixels from the footprint's top (default: the
  footprint's bottom edge): people whose feet are below that line are drawn in
  front of it. Long things that run north-south (a net, a fence) are cut into
  one piece per tile row (`rows_of`) so each row sorts at its own line.
  `layer`: 'ground' (flat, under everyone: rugs, decals), 'normal', or 'over'
  (always above people: string lights overhead, an arch's top).
- `solid`: footprint-relative tiles that block walking (default: every
  footprint tile). Return [] for walk-through things.
- `seats`: footprint-relative seats `{dx, dy, face, ax?, ay?}`: walking onto the
  tile sits you down facing `face`; (ax, ay) is where the feet go, in pixels
  from the footprint's top-left (default: tile centre, 12 px down).
- `glows`: soft lights `{dx, dy, radius, colour, flicker}` (dx/dy pixels from
  the footprint's top-left, radius in tiles).
- `use`: footprint-relative tiles where "press X" reaches the item (signs).
- `text`: what "Read" shows for signs.

Parameters are declared with `Param` so the catalogue (`town.py kit`) and the
validator know them; `make()` checks and fills defaults before calling the
item function. Colours are '#rrggbb' strings or palette names (see COLOURS);
`to_rgba()` converts them and `tones()` gives a four-step shading ramp.

Ground art: `paint_area(material, cells, w_tiles, h_tiles, edge, seed, colour)`
paints a material over a set of tiles with a soft/curb/hedge/no edge and
`paint_lines(name, w_px, h_px, colour)` draws court markings (see kit_ground.py
for the materials and line sets). `pixel_text()` renders crisp pixel-font text.

Item families live in kit_<category>.py modules imported at the end of this
file; they import their tools from here (`from kit import ...`).
"""
from __future__ import annotations

import importlib
import math
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Callable

# Family modules do `from kit import ...`: make that resolve to this module however it was loaded.
sys.modules.setdefault('kit', sys.modules[__name__])

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from art import (  # noqa: E402,F401
  BARK, BARK_DARK, BARK_LIGHT, BLACK, CREAM, GLYPHS, GRASS, GRASS_DARK, GRASS_LIGHT, LEAF, LEAF_DEEP, LEAF_LIGHT,
  LEAF_MID, OUT, OUT_SOFT, SHADOW, STONE, STONE_DARK, STONE_LIGHT, STONE_MID, T, WATER, WHITE, WOOD, WOOD_DARK,
  WOOD_LIGHT, WOOD_MID, disc_mask, fill_mask, frame, hline, mix, new, noise_rng, outline, pad, props, put, recolor,
  rect, shade, vline,
)

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / 'art' / 'zelda-like' / 'gfx'
FONTS_DIR = ROOT / 'art' / 'kenney-fonts' / 'Fonts'

# --- Colours -----------------------------------------------------------------------------------

COLOURS = {
  # Named colours in the town's palette; a spec may also give '#rrggbb'.
  'red': (214, 64, 64), 'crimson': (176, 34, 54), 'pink': (240, 128, 168), 'rose': (226, 92, 120),
  'coral': (244, 116, 96), 'orange': (240, 138, 58), 'peach': (248, 184, 140), 'gold': (240, 196, 58),
  'yellow': (252, 222, 92), 'cream': (238, 226, 196), 'white': (248, 248, 248), 'lime': (150, 220, 70),
  'green': (63, 174, 90), 'forest': (40, 120, 70), 'mint': (120, 214, 168), 'teal': (47, 181, 176),
  'turquoise': (64, 208, 208), 'sky': (110, 180, 240), 'blue': (60, 122, 214), 'navy': (40, 60, 120),
  'purple': (142, 90, 214), 'lilac': (190, 160, 240), 'lavender': (200, 184, 236), 'magenta': (214, 72, 180),
  'brown': (136, 80, 64), 'wood': (168, 120, 72), 'tan': (210, 170, 120), 'grey': (160, 162, 172),
  'silver': (200, 204, 214), 'charcoal': (72, 70, 84), 'black': (40, 36, 48),
}
COLOUR_ALIASES = {'gray': 'grey', 'violet': 'purple', 'aqua': 'turquoise', 'beige': 'cream', 'maroon': 'crimson',
                  'golden': 'gold', 'light blue': 'sky', 'dark blue': 'navy', 'dark green': 'forest'}


def colour_name(value):
  """Normalise a colour spec ('Red', 'gray', '#AABBCC') to a COLOURS key or '#rrggbb' (None if unknown)."""
  if not isinstance(value, str):
    return None
  v = value.strip().lower()
  v = COLOUR_ALIASES.get(v, v)
  if v in COLOURS or re.fullmatch(r'#[0-9a-f]{6}', v):
    return v
  if re.fullmatch(r'#[0-9a-f]{3}', v):
    return '#' + ''.join(ch * 2 for ch in v[1:])
  return None


def to_rgba(value, default=(214, 64, 64)):
  """'#rrggbb', a palette name or an (r, g, b[, a]) tuple -> opaque RGBA tuple."""
  if isinstance(value, (tuple, list)) and len(value) >= 3:
    return (int(value[0]), int(value[1]), int(value[2]), 255)
  v = colour_name(value)
  if v in COLOURS:
    r, g, b = COLOURS[v]
    return (r, g, b, 255)
  if v:
    return (int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16), 255)
  r, g, b = default[:3]
  return (r, g, b, 255)


def to_hex(c):
  """RGBA/RGB tuple -> '#rrggbb'."""
  return '#%02x%02x%02x' % tuple(int(v) for v in c[:3])


def tones(c):
  """Four-step shading ramp for any colour, hue-shifted like the pack: (hi, base, lo, deep).

  Highlights lean warm, shadows lean toward the plum outline, so a user's colour
  sits beside the pack's wood, leaves and stone.
  """
  c = to_rgba(c)
  lum = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255
  hi = mix(c, (255, 248, 222, 255), 0.30 if lum < 0.75 else 0.5)
  lo = mix(shade(c, 0.82), (88, 40, 86, 255), 0.16)
  deep = mix(shade(c, 0.62), (50, 26, 60, 255), 0.30)
  return hi, c, lo, deep


def lerp_colour(a, b, t):
  return mix(a, b, max(0.0, min(1.0, t)))


# --- Contract types -------------------------------------------------------------------------------

class KitError(ValueError):
  """A spec asked for something the kit can't make (bad name or parameter)."""


@dataclass
class Param:
  type: str  # 'int' | 'float' | 'bool' | 'str' | 'text' | 'colour' | 'colours' | 'enum'
  default: object = None
  min: float | None = None
  max: float | None = None
  choices: tuple = ()
  doc: str = ''

  def check(self, name, value):
    if value is None:
      return self.default
    t = self.type
    if t == 'int':
      if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise KitError(f'`{name}` must be a whole number')
      value = int(value)
    elif t == 'float':
      if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise KitError(f'`{name}` must be a number')
      value = float(value)
    elif t == 'bool':
      if not isinstance(value, bool):
        raise KitError(f'`{name}` must be true or false')
    elif t == 'str':
      if not isinstance(value, str):
        raise KitError(f'`{name}` must be text')
      value = re.sub(r'\s+', ' ', value).strip()[:int(self.max or 32)]
    elif t == 'text':
      # Free text for signs and banners: spaces collapse, line breaks ('\n') are kept (at most 3 lines).
      if not isinstance(value, str):
        raise KitError(f'`{name}` must be text')
      lines = [re.sub(r'[ \t\r\f\v]+', ' ', ln).strip() for ln in value.replace('\r\n', '\n').split('\n')]
      lines = [ln for ln in lines if ln][:3]
      value = '\n'.join(lines)[:int(self.max or 40)].strip()
    elif t == 'colour':
      v = colour_name(value)
      if v is None:
        raise KitError(f'`{name}`: unknown colour "{value}" (use #rrggbb or one of {", ".join(COLOURS)})')
      value = v
    elif t == 'colours':
      if isinstance(value, str):
        value = [value]
      if not isinstance(value, list) or not value or len(value) > 8:
        raise KitError(f'`{name}` must be a list of 1-8 colours')
      value = [Param('colour').check(name, v) for v in value]
    elif t == 'enum':
      if isinstance(value, str):
        value = value.strip().lower()
      if value not in self.choices:
        raise KitError(f'`{name}` must be one of {", ".join(map(str, self.choices))}')
    else:
      raise KitError(f'`{name}`: unknown parameter type {t}')
    if t in ('int', 'float'):
      if self.min is not None and value < self.min:
        raise KitError(f'`{name}` must be at least {self.min:g}')
      if self.max is not None and value > self.max:
        raise KitError(f'`{name}` must be at most {self.max:g}')
    return value

  def describe(self):
    if self.type == 'enum':
      kind = '|'.join(map(str, self.choices))
    elif self.type in ('int', 'float') and (self.min is not None or self.max is not None):
      kind = f'{self.type} {self.min:g}..{self.max:g}'
    elif self.type in ('str', 'text'):
      kind = f'{self.type}<={int(self.max or (40 if self.type == "text" else 32))}'
    else:
      kind = self.type
    return f'{kind}={self.default!r}' + (f' ({self.doc})' if self.doc else '')


@dataclass
class Piece:
  img: object  # PIL.Image.Image, or a list of same-size frames
  dx: int = 0
  dy: int = 0
  z: int | None = None
  layer: str = 'normal'  # 'ground' | 'normal' | 'over'
  fps: float = 0.0

  @property
  def frames(self):
    return self.img if isinstance(self.img, list) else [self.img]


@dataclass
class Made:
  pieces: list
  foot: tuple = (1, 1)
  solid: list | None = None  # None: every footprint tile
  seats: list = field(default_factory=list)
  glows: list = field(default_factory=list)
  use: list = field(default_factory=list)
  text: str | None = None


@dataclass
class ItemDef:
  name: str
  fn: Callable
  category: str
  doc: str
  foot: tuple
  params: dict
  variants: list = field(default_factory=list)  # extra parameter sets shown by kit_preview.py
  scene: str = 'grass'  # what kit_preview.py stands it on: 'grass' | 'floor' | 'wall'


ITEMS: dict[str, ItemDef] = {}
CATEGORIES = ('nature', 'furniture', 'party', 'sport', 'structure', 'light', 'sign', 'decor')
LAYERS = ('ground', 'normal', 'over')
FACES = ('down', 'up', 'left', 'right')
INDOOR = ('furniture', 'decor')


def item(name, category, doc, foot=(1, 1), variants=None, scene=None, **params):
  """Register a kit item. The function receives the checked parameters as keywords.

  `variants`: a few interesting parameter sets for the contact sheet (kit_preview.py).
  `scene`: 'grass', 'floor' or 'wall' (footprint on an interior wall face) for the contact sheet
  (default: floor for furniture/decor, grass for the rest).
  """
  assert category in CATEGORIES, category
  assert name not in ITEMS, f'duplicate kit item {name}'
  for k, p in params.items():
    assert isinstance(p, Param), f'{name}.{k} must be a Param'

  def wrap(fn):
    ITEMS[name] = ItemDef(name, fn, category, doc, tuple(foot), params, list(variants or []),
                          scene or ('floor' if category in INDOOR else 'grass'))
    return fn
  return wrap


def make(kind: str, params: dict | None = None) -> Made:
  """Build one kit item from spec parameters (unknown parameters are an error)."""
  d = ITEMS.get(kind)
  if d is None:
    raise KitError(f'unknown item kind "{kind}" (see `town.py kit`)')
  params = dict(params or {})
  unknown = sorted(set(params) - set(d.params))
  if unknown:
    raise KitError(f'`{kind}` has no parameter {", ".join(unknown)}; it takes {", ".join(d.params) or "none"}')
  checked = {k: p.check(k, params.get(k)) for k, p in d.params.items()}
  made = d.fn(**checked)
  if not isinstance(made, Made):
    raise TypeError(f'kit item {kind} returned {type(made).__name__}, not Made')
  made.foot = (int(made.foot[0]), int(made.foot[1]))
  return made


def foot_tiles(made):
  """Every footprint-relative tile of a Made."""
  fw, fh = made.foot
  return [(x, y) for y in range(fh) for x in range(fw)]


def solid_tiles(made):
  return foot_tiles(made) if made.solid is None else [tuple(t) for t in made.solid]


# --- Helpers for item authors: placement -------------------------------------------------------

def standing(img, foot=(1, 1), dy=0, dx=None, z=None, layer='normal', fps=0.0):
  """A piece standing on its footprint: horizontally centred, bottom edge on the footprint's bottom.

  `img` may be a list of frames. `dy` nudges it down (positive) or up.
  """
  frames = img if isinstance(img, list) else [img]
  w, h = frames[0].size
  fw, fh = foot
  if dx is None:
    dx = (fw * T - w) // 2
  return Piece(img, dx=dx, dy=fh * T - h + dy, z=z, layer=layer, fps=fps)


def rows_of(img, foot_w, foot_h, dx=0, top=0, layer='normal', fps=0.0):
  """Cut a tall north-south image into one piece per tile row (each sorts at its own row).

  `top` is how many pixels of the image rise above the footprint's first row; the image's
  row `top + r * 16` is the top of footprint row r. Every piece is a frame list if `img` is.
  """
  frames = img if isinstance(img, list) else [img]
  w, h = frames[0].size
  pieces = []
  for row in range(foot_h):
    y0 = 0 if row == 0 else top + row * T
    y1 = top + (row + 1) * T if row < foot_h - 1 else h
    if y1 <= y0:
      continue
    crop = [f.crop((0, y0, w, y1)) for f in frames]
    pieces.append(Piece(crop if len(crop) > 1 else crop[0], dx=dx, dy=y0 - top, z=(row + 1) * T, layer=layer,
                        fps=fps))
  return pieces


def with_shadow(img, w=None, h=4):
  """Return `img` on a canvas with a soft ground shadow under its bottom centre."""
  w = w or img.width
  out = new(max(w, img.width), img.height + 2)
  sh = new(out.width, h)
  fill_mask(sh, disc_mask(out.width, h, out.width / 2, h / 2, w / 2.2, h / 2), SHADOW)
  out.alpha_composite(sh, (0, out.height - h))
  out.alpha_composite(img, ((out.width - img.width) // 2, 0))
  return out


# --- Helpers for item authors: drawing -----------------------------------------------------------

def outlined(img, soft=False, colour=None):
  """Outline every opaque pixel with the town's dark plum (OUT_SOFT for foliage). Size grows by 0:
  leave a 1 px transparent margin around what you draw."""
  return outline(img, colour or (OUT_SOFT if soft else OUT))


def paste(dst, src, x, y):
  """alpha_composite that accepts negative / out-of-bounds offsets (clips)."""
  x, y = int(x), int(y)
  sx0, sy0 = max(0, -x), max(0, -y)
  sx1, sy1 = min(src.width, dst.width - x), min(src.height, dst.height - y)
  if sx1 <= sx0 or sy1 <= sy0:
    return dst
  part = src if (sx0, sy0, sx1, sy1) == (0, 0, src.width, src.height) else src.crop((sx0, sy0, sx1, sy1))
  dst.alpha_composite(part, (x + sx0, y + sy0))
  return dst


def flip(img):
  """Mirror left-right (works on a frame list too)."""
  if isinstance(img, list):
    return [flip(f) for f in img]
  return img.transpose(Image.FLIP_LEFT_RIGHT)


def line(img, x0, y0, x1, y1, c):
  """1 px Bresenham line (no anti-aliasing)."""
  x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
  dx, dy = abs(x1 - x0), -abs(y1 - y0)
  sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
  err = dx + dy
  while True:
    put(img, x0, y0, c)
    if x0 == x1 and y0 == y1:
      break
    e2 = 2 * err
    if e2 >= dy:
      err += dy
      x0 += sx
    if e2 <= dx:
      err += dx
      y0 += sy


def polygon(img, pts, c):
  """Fill a polygon (list of (x, y) pixel corners) with a flat colour, pixel centres inside."""
  if len(pts) < 3:
    return
  ys = [p[1] for p in pts]
  for y in range(max(0, int(min(ys))), min(img.height, int(math.ceil(max(ys))) + 1)):
    yc = y + 0.5
    xs = []
    for i in range(len(pts)):
      (xa, ya), (xb, yb) = pts[i], pts[(i + 1) % len(pts)]
      if (ya <= yc < yb) or (yb <= yc < ya):
        xs.append(xa + (yc - ya) * (xb - xa) / (yb - ya))
    xs.sort()
    for i in range(0, len(xs) - 1, 2):
      xa, xb = int(math.ceil(xs[i] - 0.5)), int(math.floor(xs[i + 1] - 0.5))
      if xb >= xa:
        hline(img, xa, y, xb - xa + 1, c)


def ellipse(img, cx, cy, rx, ry, c):
  """Filled ellipse centred at (cx, cy) (pixel-centre test, crisp)."""
  if rx <= 0 or ry <= 0:
    return
  for y in range(max(0, int(cy - ry) - 1), min(img.height, int(cy + ry) + 2)):
    for x in range(max(0, int(cx - rx) - 1), min(img.width, int(cx + rx) + 2)):
      ddx, ddy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
      if ddx * ddx + ddy * ddy <= 1.0:
        img.putpixel((x, y), c)


def ellipse_mask(w, h, cx, cy, rx, ry):
  return disc_mask(w, h, cx, cy, rx, ry)


def ring(img, cx, cy, r, c, ry=None):
  """1 px circle/ellipse outline, 8-connected, no gaps."""
  ry = r if ry is None else ry
  pts = set()
  steps = max(16, int(8 * max(r, ry)))
  for i in range(steps):
    a = 2 * math.pi * i / steps
    pts.add((int(math.floor(cx + r * math.cos(a))), int(math.floor(cy + ry * math.sin(a)))))
  for (x, y) in pts:
    put(img, x, y, c)


def shadow(w, h):
  """A soft ground-shadow ellipse image (w x h)."""
  img = new(w, h)
  fill_mask(img, disc_mask(w, h, w / 2, h / 2, w / 2, h / 2), SHADOW)
  return img


def drop_shadow(img, cx, by, rx, ry=2.5):
  """Paint a ground shadow ellipse onto `img` centred at (cx, by) (draw it first, under everything)."""
  fill_mask(img, disc_mask(img.width, img.height, cx, by, rx, ry), SHADOW)


def bevel(img, x, y, w, h, c, light=True):
  """A flat block with a light top/left edge and darker bottom/right edge (3/4 view panels, boards)."""
  hi, base, lo, deep = tones(c)
  rect(img, x, y, w, h, base)
  if light:
    hline(img, x, y, w, hi)
    vline(img, x, y, h, hi)
  hline(img, x, y + h - 1, w, lo)
  vline(img, x + w - 1, y + 1, h - 1, lo)


def block(img, x, y, w, top_h, front_h, c, top=None):
  """A 3/4-view box: a lit top face (`top_h` tall) over a darker front face (`front_h` tall).

  Tables, crates, counters, plinths, stages. No outline: call outlined() on the whole image.
  """
  hi, base, lo, deep = tones(c)
  if top_h > 0:
    rect(img, x, y, w, top_h, top or base)
    hline(img, x, y, w, hi)
  if front_h > 0:
    rect(img, x, y + top_h, w, front_h, lo)
    hline(img, x, y + top_h, w, deep if top_h else lo)
    hline(img, x, y + top_h + front_h - 1, w, deep)


def post(img, x, y, h, w=2, c=WOOD_MID):
  """A vertical post (light left column, dark right column)."""
  hi, base, lo, deep = tones(c)
  rect(img, x, y, w, h, base)
  vline(img, x, y, h, hi)
  if w > 1:
    vline(img, x + w - 1, y, h, lo)


def planks(img, x, y, w, h, c, plank=4, vertical=False, seed=0):
  """Wooden planks (horizontal boards by default) with seams and a few knots."""
  rng = noise_rng(seed)
  hi, base, lo, deep = tones(c)
  rect(img, x, y, w, h, base)
  if vertical:
    for i in range(0, w, plank):
      vline(img, x + i, y, h, hi)
      if i + plank - 1 < w:
        vline(img, x + i + plank - 1, y, h, lo)
  else:
    for i in range(0, h, plank):
      hline(img, x, y + i, w, hi)
      if i + plank - 1 < h:
        hline(img, x, y + i + plank - 1, w, lo)
  for _ in range(max(1, (w * h) // 90)):
    put(img, x + rng.randrange(max(1, w)), y + rng.randrange(max(1, h)), lo)


LEAVES = (LEAF_LIGHT, LEAF, LEAF_MID, LEAF_DEEP)
AUTUMN = ((250, 196, 84, 255), (226, 140, 54, 255), (190, 98, 44, 255), (130, 62, 40, 255))
BLOSSOM = ((255, 236, 242, 255), (250, 192, 214, 255), (226, 140, 176, 255), (168, 92, 134, 255))


def foliage(mask, w, h, pal=LEAVES, seed=0, clusters=None, soft=True):
  """Shade a set of leaf pixels like the town's trees (light from the upper left) and outline it.

  `mask` is a set of (x, y) inside a w x h canvas; returns an outlined RGBA image (OUT_SOFT).
  """
  rng = noise_rng(seed)
  img = new(w, h)
  if not mask:
    return img
  xs = [p[0] for p in mask]
  ys = [p[1] for p in mask]
  x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
  bw, bh = max(1, x1 - x0), max(1, y1 - y0)
  cx = (x0 + x1) / 2
  light, base, mid, deep = pal
  for (x, y) in mask:
    t = (x - cx) / bw + ((y - y0) / bh) * 0.9 + rng.uniform(-0.12, 0.12)
    c = light if t < 0.18 else base if t < 0.55 else mid if t < 0.85 else deep
    put(img, x, y, c)
  n = clusters if clusters is not None else max(2, len(mask) // 45)
  for _ in range(n):
    lx = int(rng.uniform(x0 + bw * 0.1, x1 - bw * 0.2))
    ly = int(rng.uniform(y0 + bh * 0.12, y0 + bh * 0.8))
    if (lx, ly) in mask and (lx + 2, ly) in mask and (lx + 1, ly + 1) in mask:
      c = light if ly < y0 + bh * 0.5 else base
      put(img, lx, ly, c)
      put(img, lx + 1, ly - 1, c)
      put(img, lx + 2, ly, c)
      put(img, lx + 1, ly + 1, mid)
  return outline(img, OUT_SOFT) if soft else img


def tufts(img, x, y, n=2, seed=0, spread=None):
  """Little grass tufts at the foot of a prop, like the pack's objects (x, y = ground line)."""
  rng = noise_rng(seed)
  spread = spread if spread is not None else 6
  for _ in range(n):
    tx = x + rng.randint(-spread, spread)
    put(img, tx, y, GRASS_DARK)
    put(img, tx + 1, y - 1, LEAF_LIGHT)
    put(img, tx + 1, y, LEAF)
    put(img, tx + 2, y, GRASS_DARK)


# --- Text ---------------------------------------------------------------------------------------

# 3x5 pixel font ('small'): the town's GLYPHS plus digits and punctuation. Lowercase folds to upper.
SMALL_GLYPHS = dict(GLYPHS)
SMALL_GLYPHS.update({
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
  '5': ['###', '#..', '##.', '..#', '##.'], '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'], '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  ':': ['.', '#', '.', '#', '.'], ';': ['.', '#', '.', '#', '#'], ',': ['.', '.', '.', '#', '#'],
  '&': ['.#..', '#.#.', '.#..', '#.#.', '.#.#'], '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'], '#': ['#.#', '###', '#.#', '###', '#.#'],
  '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'], '"': ['#.#', '#.#', '...', '...', '...'],
  '=': ['...', '###', '...', '###', '...'], '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '*': ['...', '#.#', '.#.', '#.#', '...'], '_': ['...', '...', '...', '...', '###'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '$': ['.##', '##.', '.#.', '.##', '##.'], '@': ['.##.', '#..#', '#.##', '#...', '.##.'],
})

# Symbols the TTF fonts lack, as small bitmaps (5 rows for mini/small, 7 rows for big/blocks).
ICON_GLYPHS = {
  5: {
    '♥': ['.#.#.', '#####', '#####', '.###.', '..#..'], '★': ['..#..', '.###.', '#####', '.###.', '.#.#.'],
    '♪': ['..##', '..#.', '..#.', '###.', '##..'], '&': ['.#..', '#.#.', '.#..', '#.#.', '.#.#'],
    '☺': ['.###.', '#.#.#', '#####', '#...#', '.###.'], '✓': ['....#', '...#.', '#.#..', '.#...', '.....'],
  },
  7: {
    '♥': ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
    '★': ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
    '♪': ['...###', '...#.#', '...#..', '...#..', '####..', '####..', '.##...'],
    '☺': ['.#####.', '#.#.#.#', '#######', '#######', '#.###.#', '##...##', '.#####.'],
    '✓': ['......#', '.....#.', '....#..', '#..#...', '.##....', '.#.....', '.......'],
  },
}
ICON_ALIASES = {'❤': '♥', '♡': '♥', '☆': '★', '♫': '♪', '☻': '☺', '✔': '✓'}

# name: (TTF file, pixel-exact size, band top row, band height, cap height). The band is the rows
# from the top of a capital to the bottom of a descender; every glyph lands on the pixel grid.
TTF_FONTS = {
  'mini': ('Kenney Mini', 8, 3, 6, 5),     # the town's UI font: 5 px capitals with lowercase
  'big': ('Kenney Pixel', 16, 3, 8, 7),    # 7 px capitals with lowercase: banners, titles
  'blocks': ('Kenney Blocks', 8, 3, 7, 7),  # chunky outlined capitals: scoreboards, signs
}
FONT_NAMES = ('big', 'mini', 'small', 'blocks')


@lru_cache(maxsize=None)
def _ttf(name):
  file, size, _top, _band, _cap = TTF_FONTS[name]
  path = FONTS_DIR / f'{file}.ttf'
  try:
    if path.exists():
      return ImageFont.truetype(str(path), size)
    # Fallback: the copy embedded for the browser (engine/fonts.gen.js).
    import base64
    import io
    import json
    gen = (ROOT / 'engine' / 'fonts.gen.js').read_text()
    data = json.loads(gen[gen.index('{'):gen.rindex('}') + 1])
    key = {'mini': 'mini', 'blocks': 'blocks'}.get(name)
    if key and key in data:
      return ImageFont.truetype(io.BytesIO(base64.b64decode(data[key])), size)
  except (OSError, ValueError):
    pass
  return None


@lru_cache(maxsize=None)
def _notdef_mask(name):
  font = _ttf(name)
  return bytes(font.getmask('￿', mode='1')) if font else b''


@lru_cache(maxsize=4096)
def _has_glyph(name, ch):
  font = _ttf(name)
  if font is None:
    return False
  if ch == ' ':
    return True
  try:
    m = font.getmask(ch, mode='1')
  except Exception:  # noqa: BLE001 - FreeType quirks
    return False
  return m.size[0] > 0 and bytes(m) != _notdef_mask(name)


def _fold(ch):
  """Accented letters fold to their base letter ('é' -> 'e'); other unknowns -> ''."""
  base = unicodedata.normalize('NFKD', ch)
  base = ''.join(c for c in base if not unicodedata.combining(c))
  return base if base and base.isascii() else ''


def _icon(ch, rows):
  ch = ICON_ALIASES.get(ch, ch)
  table = ICON_GLYPHS[5 if rows <= 6 else 7]
  return table.get(ch)


def _tokens(text, font):
  """Split text into ('ttf'|'bits', str|rows) runs for a font."""
  text = text.replace('<3', '♥')
  out = []
  rows = TTF_FONTS[font][4] if font in TTF_FONTS else 5
  for ch in text:
    if font != 'small' and _ttf(font) is not None:
      if ch == '&' and font == 'mini':
        out.append(('bits', ICON_GLYPHS[5]['&']))
        continue
      if ch.isascii() and _has_glyph(font, ch):
        out.append(('ttf', ch))
        continue
      icon = _icon(ch, rows)
      if icon:
        out.append(('bits', icon))
        continue
      f = _fold(ch)
      if f and all(_has_glyph(font, c) for c in f):
        out.extend(('ttf', c) for c in f)
      else:
        out.append(('ttf', ' '))  # unknown symbol: leave a gap rather than a box
    else:
      icon = _icon(ch, 5)
      if icon and ch not in SMALL_GLYPHS:
        out.append(('bits', icon))
        continue
      up = ch.upper()
      if up not in SMALL_GLYPHS and not ch.isspace():
        up = _fold(ch).upper()
      out.append(('small', up or ' '))
  return out


def _resolve_font(font):
  if font not in FONT_NAMES:
    raise KitError(f'unknown font "{font}" (use one of {", ".join(FONT_NAMES)})')
  if font in TTF_FONTS and _ttf(font) is None:
    return 'small'
  return font


def font_height(font='mini'):
  """Height of a line of text (capital top to descender bottom) in pixels."""
  font = _resolve_font(font)
  return 5 if font == 'small' else TTF_FONTS[font][3]


def cap_height(font='mini'):
  font = _resolve_font(font)
  return 5 if font == 'small' else TTF_FONTS[font][4]


def _layout(text, font):
  """[(x, kind, value)] and total width for one line of text."""
  font = _resolve_font(font)
  items, x = [], 0
  if font == 'small':
    for kind, v in _tokens(text, font):
      if kind == 'bits':
        items.append((x, kind, v))
        x += len(v[0]) + 1
      else:
        g = SMALL_GLYPHS.get(v)
        if g is None:
          x += 4 if v == ' ' else 0
          continue
        items.append((x, 'bits', g))
        x += len(g[0]) + 1
    return items, max(0, x - 1), font
  ttf = _ttf(font)
  run = ''
  for kind, v in _tokens(text, font) + [('end', None)]:
    if kind == 'ttf':
      run += v
      continue
    if run:
      items.append((x, 'ttf', run))
      x += int(round(ttf.getlength(run)))
      run = ''
    if kind == 'bits':
      items.append((x, kind, v))
      x += len(v[0]) + 1
  # TTF advances include one column of spacing after the last glyph: trim it.
  return items, max(0, x - 1), font


def text_size(text, font='mini'):
  """(width, height) of one line of `text` drawn by pixel_text."""
  _items, w, f = _layout(text, font)
  return w, font_height(f)


def pixel_text(text, colour='#202028', font='mini', outline=None, shadow=None):
  """Render one line of crisp pixel text to a tight RGBA image (no anti-aliasing).

  font: 'big' (Kenney Pixel, 7 px capitals), 'mini' (Kenney Mini, the town's UI font, 5 px capitals),
  'small' (3x5 capitals) or 'blocks' (Kenney Blocks). ♥ ★ ♪ are drawn as tiny icons.
  `outline`: colour of a 1 px outline around the letters; `shadow`: colour of a 1 px drop shadow
  (down-right). Both grow the image by their margin. The image height is font_height(font) (+ margins).
  """
  c = to_rgba(colour)
  items, w, font = _layout(text, font)
  h = font_height(font)
  mask = Image.new('L', (max(1, w + 2), h + 2), 0)  # 1 px slack: some glyphs overhang their advance
  if font == 'small':
    top = 0
  else:
    top = TTF_FONTS[font][2]
    cap = TTF_FONTS[font][4]
  d = ImageDraw.Draw(mask)
  d.fontmode = '1'
  for x, kind, v in items:
    if kind == 'ttf':
      d.text((x, -top), v, font=_ttf(font), fill=255)
    else:
      gy = 0 if font == 'small' else cap - len(v)
      for yy, row in enumerate(v):
        for xx, bit in enumerate(row):
          if bit != '.':
            mask.putpixel((x + xx, gy + yy), 255)
  mask = mask.crop((0, 0, max(1, w), h))
  glyphs = Image.new('RGBA', mask.size, c[:3] + (0,))
  glyphs.putalpha(mask.point(lambda v: 255 if v >= 128 else 0))
  if not outline and not shadow:
    return glyphs
  m = 1
  out = new(glyphs.width + 2 * m, glyphs.height + 2 * m)
  if outline:
    oc = to_rgba(outline)
    solid = new(glyphs.width, glyphs.height, oc)
    solid.putalpha(glyphs.getchannel('A'))
    for ddx in (-1, 0, 1):
      for ddy in (-1, 0, 1):
        if ddx or ddy:
          out.alpha_composite(solid, (m + ddx, m + ddy))
  elif shadow:
    sc = to_rgba(shadow)
    solid = new(glyphs.width, glyphs.height, sc)
    solid.putalpha(glyphs.getchannel('A'))
    out.alpha_composite(solid, (m + 1, m + 1))
  out.alpha_composite(glyphs, (m, m))
  if shadow and not outline:
    out = out.crop((1, 1, out.width, out.height))
  return out


def draw_text(img, x, y, text, colour='#202028', font='mini', outline=None, shadow=None):
  """Draw one line of pixel text onto `img` with its top-left at (x, y); returns the width."""
  t = pixel_text(text, colour, font, outline, shadow)
  paste(img, t, x, y)
  return t.width


def wrap_text(text, max_w, font='mini', max_lines=3):
  """Greedy word wrap: list of lines that fit `max_w` px, or None if it can't fit in max_lines."""
  lines = []
  for para in text.split('\n'):
    words = para.split()
    cur = ''
    for wd in words:
      trial = wd if not cur else cur + ' ' + wd
      if text_size(trial, font)[0] <= max_w:
        cur = trial
      else:
        if cur:
          lines.append(cur)
        if text_size(wd, font)[0] > max_w:
          return None
        cur = wd
    if cur:
      lines.append(cur)
  if len(lines) > max_lines:
    return None
  return lines or ['']


def fit_text(text, max_w, max_h=None, fonts=('big', 'mini', 'small'), max_lines=2, gap=2):
  """Pick the largest font (in order) that fits `text` into max_w x max_h px, wrapping words.

  Returns (font, lines). If nothing fits, the text is shortened to fit in the smallest font.
  """
  for f in fonts:
    lines = wrap_text(text, max_w, f, max_lines)
    if lines is None:
      continue
    h = len(lines) * font_height(f) + (len(lines) - 1) * gap
    if max_h is None or h <= max_h:
      return f, lines
  f = fonts[-1]
  lines_avail = max_lines if max_h is None else max(1, (max_h + gap) // (font_height(f) + gap))
  lines = wrap_text(text, max_w, f, 99) or [text]
  lines = lines[:max(1, lines_avail)]
  last = lines[-1]
  while last and text_size(last, f)[0] > max_w:
    last = last[:-1]
  lines[-1] = last.rstrip()
  return f, lines


def text_block(lines, colour='#202028', font='mini', gap=2, align='center', outline=None, shadow=None):
  """Render several lines as one RGBA image (centred by default)."""
  imgs = [pixel_text(ln, colour, font, outline, shadow) for ln in lines]
  w = max(i.width for i in imgs)
  h = sum(i.height for i in imgs) + gap * (len(imgs) - 1)
  out = new(max(1, w), max(1, h))
  y = 0
  for im in imgs:
    x = 0 if align == 'left' else (w - im.width) // 2
    out.alpha_composite(im, (x, y))
    y += im.height + gap
  return out


# --- Pack sheets ------------------------------------------------------------------------------------

@lru_cache(maxsize=None)
def pack_sheet(name):
  """The Zelda-like pack's sheets: 'Overworld', 'Inner', 'objects' (RGBA)."""
  return Image.open(PACK / f'{name}.png').convert('RGBA')


def pack_tile(sheet, tx, ty, w=1, h=1):
  """A (w x h)-tile crop of a pack sheet."""
  return pack_sheet(sheet).crop((tx * T, ty * T, (tx + w) * T, (ty + h) * T))


# --- Ground: materials, edges and lines -------------------------------------------------------------

@dataclass
class MaterialDef:
  name: str
  fn: Callable  # fn(w_px, h_px, seed, colour) -> RGBA image of exactly that size
  doc: str
  colour: str | None  # default colour when the material takes `colour`, else None
  edge: str  # soft-edge style: 'organic' | 'water' | 'built' | 'band' | 'wall'
  rim: tuple | None  # rim colour for the soft edge (None: a darker shade of the material)


class _MaterialRegistry(dict):
  """name -> (fn, doc, takes_colour); the full MaterialDef is in MATERIAL_DEFS."""


MATERIALS: dict[str, tuple] = _MaterialRegistry()
MATERIAL_DEFS: dict[str, MaterialDef] = {}
LINES: dict[str, tuple[Callable, str]] = {}
EDGES = ('soft', 'curb', 'hedge', 'none')
LINE_COLOUR = (246, 248, 240, 255)


def material(name, doc, colour=None, edge='organic', rim=None):
  """Register a ground material: fn(w_px, h_px, seed, colour) -> seamless RGBA image of that size.

  `colour`: default colour if the material takes one (fn then gets an RGBA tuple, else None).
  `edge`: how a soft edge looks: 'organic' (wobbly, darker rim), 'water' (foam line), 'built'
  (straight dark rim), 'band' (carpet border) or 'wall' (light top trim, baseboard at the bottom).
  """
  def wrap(fn):
    MATERIALS[name] = (fn, doc, colour is not None)
    MATERIAL_DEFS[name] = MaterialDef(name, fn, doc, colour, edge, rim)
    return fn
  return wrap


def lines(name, doc):
  """Register a court-marking set: fn(w_px, h_px, colour_rgba) -> transparent RGBA image."""
  def wrap(fn):
    LINES[name] = (fn, doc)
    return fn
  return wrap


def material_texture(name, w, h, seed=0, colour=None):
  """The bare material (no edge) as a w x h RGBA image."""
  d = MATERIAL_DEFS.get(name)
  if d is None:
    raise KitError(f'unknown material "{name}" (see `town.py kit`)')
  c = None
  if d.colour is not None:
    if colour is not None and colour_name(colour) is None:
      raise KitError(f'{name}: unknown colour "{colour}" (use #rrggbb or one of {", ".join(COLOURS)})')
    c = to_rgba(colour if colour is not None else d.colour)
  img = d.fn(int(w), int(h), _seed(seed), c)
  if img.size != (w, h):
    raise TypeError(f'material {name} returned {img.size}, not {(w, h)}')
  return img


def _seed(seed):
  if isinstance(seed, bool) or not isinstance(seed, (int, float, str)):
    raise KitError('seed must be a whole number')
  try:
    return int(seed) % 100000
  except ValueError:
    raise KitError('seed must be a whole number') from None


def paint_material(name, w, h, seed=0, colour=None):
  """Compatibility: a full rectangle of material (no edge)."""
  return material_texture(name, w, h, seed, colour)


def paint_area(material, cells, w_tiles, h_tiles, edge='soft', seed=0, colour=None):
  """Paint `material` over the tiles in `cells` -> RGBA image of w_tiles*16 x h_tiles*16.

  `cells`: (x, y) tiles relative to the image's top-left tile. The material is seamless across
  cells; `edge` is drawn where covered cells meet uncovered ones: 'soft' (a natural 1-2 px
  border suited to the material), 'curb' (light stone kerb), 'hedge' (border tiles become a low
  clipped hedge) or 'none'. Uncovered pixels stay transparent (a soft edge may wander up to
  2 px across the cell boundary).
  """
  from kit_ground import apply_edge  # noqa: PLC0415 - kit_ground imports this module
  if material not in MATERIAL_DEFS:
    raise KitError(f'unknown material "{material}" (see `town.py kit`)')
  if edge not in EDGES:
    raise KitError(f'unknown edge "{edge}" (use one of {", ".join(EDGES)})')
  w_tiles, h_tiles = int(w_tiles), int(h_tiles)
  if not (1 <= w_tiles <= 64 and 1 <= h_tiles <= 64):
    raise KitError('paint area must be 1..64 tiles on each side')
  cells = {(int(x), int(y)) for (x, y) in cells if 0 <= x < w_tiles and 0 <= y < h_tiles}
  seed = _seed(seed)
  tex = material_texture(material, w_tiles * T, h_tiles * T, seed, colour)
  return apply_edge(tex, MATERIAL_DEFS[material], cells, w_tiles, h_tiles, edge, seed)


def paint_lines(name, w, h, colour=None):
  """Court markings for a w x h px rectangle -> transparent RGBA overlay (lines 1 px inside the edges)."""
  entry = LINES.get(name)
  if entry is None:
    raise KitError(f'unknown lines "{name}" (see `town.py kit`)')
  if w < 16 or h < 16:
    raise KitError('lines need a rectangle of at least one tile')
  if colour is not None and colour_name(colour) is None:
    raise KitError(f'lines: unknown colour "{colour}" (use #rrggbb or one of {", ".join(COLOURS)})')
  c = to_rgba(colour) if colour is not None else LINE_COLOUR
  img = entry[0](int(w), int(h), c)
  if img.size != (w, h):
    raise TypeError(f'lines {name} returned {img.size}, not {(w, h)}')
  # Markings stay 1 px inside the rectangle, whatever the set drew.
  clear = new(w, 1)
  img.paste(clear, (0, 0))
  img.paste(clear, (0, h - 1))
  side = new(1, h)
  img.paste(side, (0, 0))
  img.paste(side, (w - 1, 0))
  return img


# --- Catalogue ---------------------------------------------------------------------------------------

def catalogue():
  """The kit as plain data, for `town.py kit` and the docs."""
  mats = {}
  for n, d in sorted(MATERIAL_DEFS.items()):
    mats[n] = d.doc + (f' Takes `colour` (default {d.colour}).' if d.colour else '')
  return {
    'items': {
      n: {'category': d.category, 'doc': d.doc, 'foot': list(d.foot),
          'params': {k: p.describe() for k, p in d.params.items()}}
      for n, d in sorted(ITEMS.items())
    },
    'materials': mats,
    'lines': {n: doc for n, (_fn, doc) in sorted(LINES.items())},
    'edges': list(EDGES),
    'colours': sorted(COLOURS),
    'fonts': list(FONT_NAMES),
  }


# --- Families ------------------------------------------------------------------------------------------
# Each family registers its items on import. KIT_ONLY=nature,party (dev only) loads just those.

FAMILIES = ('ground',) + CATEGORIES
_only = {f.strip() for f in os.environ.get('KIT_ONLY', '').split(',') if f.strip()}
for _fam in FAMILIES:
  if _fam == 'ground' or not _only or _fam in _only:
    importlib.import_module(f'kit_{_fam}')
del _fam
