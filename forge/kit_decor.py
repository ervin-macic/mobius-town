"""Kit family: decor items for Möbius Town builders (registered on import by kit.py).

Decor dresses up rooms. Interiors: row 0 is the dark wall cap, rows 1-2 the wall face (plaster above a
wainscot), the floor starts at row 3.

- Wall-hung things (painting, window, clock, mirror, shelves, sconce, garland, curtains) are placed with
  `at` on wall row 1: they are drawn flat on the wall face, on the 'ground' layer (the town bakes wall
  decorations into the ground) and are never solid (the wall already is).
- Floor-standing things (vase, crates, barrels, books, fireplace, grandfather clock) stand on the floor
  with a soft shadow and are solid. Against the wall they go on the first floor row (row 3) and rise
  over the wall face, like the town's own bookshelves and fireplace.

Conventions (see kit.py's docstring for the full contract): dark plum outline OUT, light from the upper
left, 2-4 flat shades per material, no anti-aliasing, 3/4 top-down view, randomness only from
noise_rng(seed).
"""
from __future__ import annotations

import math

from kit import *  # noqa: F401,F403
from kit import (  # noqa: F401
  BARK, BARK_DARK, BARK_LIGHT, LEAF, LEAF_DEEP, LEAF_LIGHT, LEAF_MID, OUT, OUT_SOFT, SHADOW, STONE, STONE_DARK,
  STONE_LIGHT, STONE_MID, WOOD, WOOD_DARK, WOOD_LIGHT, WOOD_MID, KitError, Made, Param, Piece, T, colour_name,
  disc_mask, drop_shadow, fill_mask, flip, frame, hline, item, line, mix, new, noise_rng, outlined, paste, put,
  rect, shade, standing, to_hex, to_rgba, tones, vline,
)

# --- Palette -------------------------------------------------------------------------------------------

WARM_WHITE = (255, 248, 222, 255)
INK = (52, 40, 58, 255)                 # clock hands, picture details
CREAM_FACE = (246, 238, 214, 255)       # clock dials
PACK_FRAME = (BARK_LIGHT, BARK, BARK_DARK)  # the pack's window/picture frame woods (hi, base, deep)
FRAME_DEFAULT = '#79584f'               # = BARK: window frames like the pack's
# The pack's crate/barrel wood (Overworld.png): hi, base, lo, deep, and the lit rim between top and front.
PACK_CRATE = ((160, 131, 102, 255), (136, 99, 90, 255), (104, 70, 77, 255), (73, 45, 59, 255))
PACK_CRATE_RIM = (188, 154, 120, 255)
CRATE_DEFAULT = '#88635a'
IRON = ((132, 128, 146, 255), (92, 88, 106, 255), (64, 60, 78, 255), (44, 40, 56, 255))
WARM_STONE = ((210, 194, 178, 255), (176, 156, 140, 255), (136, 118, 110, 255), (98, 82, 84, 255))
FIRE = ((255, 252, 220, 255), (252, 224, 104, 255), (248, 156, 56, 255), (218, 88, 44, 255))
GLASS_DAY = ((132, 194, 242, 255), (210, 236, 252, 255))    # base, sheen
GLASS_LIT = ((255, 200, 100, 255), (255, 238, 172, 255))
MIRROR_GLASS = ((196, 218, 232, 255), (236, 246, 252, 255), (160, 186, 206, 255))
METALS = {'gold': (240, 196, 58, 255), 'silver': (200, 204, 214, 255), 'bronze': (205, 127, 62, 255)}


def _ramp(colour, default=None, pack=None):
  """(hi, base, lo, deep) for a user colour; the pack's exact woods when it is the default."""
  if pack is not None and colour == default:
    return pack
  return tones(colour)


def _opt_colour(name, value):
  """A colour that may also be 'none' -> palette name / '#rrggbb', or None."""
  v = (value or '').strip().lower()
  if v in ('', 'none', 'no', 'off', 'false'):
    return None
  c = colour_name(v)
  if c is None:
    raise KitError(f'`{name}`: unknown colour "{value}" (use none, #rrggbb or a colour name)')
  return c


def _erode(mask):
  return {(x, y) for (x, y) in mask
          if (x - 1, y) in mask and (x + 1, y) in mask and (x, y - 1) in mask and (x, y + 1) in mask}


def _lit(mask, x, y):
  """True if a border pixel of `mask` faces up or left (towards the light)."""
  return (x - 1, y) not in mask or (x, y - 1) not in mask


def _bitmap(img, x, y, rows, pal):
  """Paint a small bitmap: rows of characters; '.' (or any char missing from pal) is left alone."""
  for j, row in enumerate(rows):
    for i, ch in enumerate(row):
      c = pal.get(ch)
      if c is not None:
        put(img, x + i, y + j, c)


def _pad(img, n=1):
  out = new(img.width + 2 * n, img.height + 2 * n)
  out.alpha_composite(img, (n, n))
  return out


def _trim_top(img):
  """Drop fully transparent rows above the drawing (keeps the bottom, so standing() still lines up)."""
  box = img.getbbox()
  if not box or box[1] == 0:
    return img
  return img.crop((0, box[1], img.width, img.height))


def _hook(img, cx, y, c=BARK_DARK):
  """The pack's little picture wire: a 4x2 loop above a frame (cx = the left pixel of the top pair)."""
  put(img, cx, y, c)
  put(img, cx + 1, y, c)
  put(img, cx - 1, y + 1, c)
  put(img, cx + 2, y + 1, c)


def _wall(img, dx=0, dy=0, fps=0.0):
  """A wall-hung piece: flat on the wall face, baked into the ground (frames allowed)."""
  return Piece(img, dx=int(dx), dy=int(dy), layer='ground', fps=fps)


def _shade_rows(img, x0, x1, y, ramp, cuts=(0.25, 0.68, 0.9)):
  """One row of a round body lit from the left: hi | base | lo | deep across x0..x1-1."""
  hi, base, lo, deep = ramp
  n = max(1, x1 - x0 - 1)
  for x in range(x0, x1):
    t = (x - x0) / n
    put(img, x, y, hi if t < cuts[0] else base if t < cuts[1] else lo if t < cuts[2] else deep)


def _stone_wall(img, x, y, w, h, ramp, rng, course=4, mortar=None):
  """Rough stone blocks in staggered courses (lit top-left of each block, mortar lines in lo)."""
  hi, base, lo, deep = ramp
  mortar = mortar or lo
  rect(img, x, y, w, h, base)
  row = 0
  yy = y
  while yy < y + h:
    ch = min(course, y + h - yy)
    hline(img, x, yy + ch - 1, w, mortar)
    xx = x - (row % 2) * 3 - rng.randint(0, 2)
    while xx < x + w:
      bw = rng.randint(5, 8)
      x0 = max(x, xx)
      x1 = min(x + w, xx + bw)
      if x1 - x0 >= 1:
        if rng.random() < 0.3:
          rect(img, x0, yy, x1 - x0, ch - 1, mix(base, hi, 0.45))
        hline(img, x0, yy, x1 - x0, hi)
        if xx + bw < x + w:
          vline(img, xx + bw - 1, yy, ch - 1, mortar)
      xx += bw
    yy += ch
    row += 1


def _bricks(img, x, y, w, h, ramp, mortar):
  hi, base, lo, deep = ramp
  rect(img, x, y, w, h, mortar)
  for r, yy in enumerate(range(y, y + h, 3)):
    off = 0 if r % 2 == 0 else 3
    for xx in range(x - off, x + w, 6):
      x0, x1 = max(x, xx), min(x + w, xx + 5)
      if x1 > x0:
        rect(img, x0, yy, x1 - x0, min(2, y + h - yy), base)
        hline(img, x0, yy, x1 - x0, hi if (r + xx) % 3 else base)
        if x1 - x0 > 2:
          put(img, x1 - 1, yy + 1, lo)


# --- Paintings --------------------------------------------------------------------------------------------

SKINS = ((250, 214, 178, 255), (238, 186, 142, 255), (206, 146, 102, 255), (156, 102, 70, 255),
         (112, 72, 54, 255))
HAIRS = ((70, 44, 44, 255), (126, 78, 48, 255), (230, 190, 100, 255), (196, 92, 48, 255), (46, 40, 56, 255),
         (210, 210, 218, 255))
CLOTHS = ((184, 40, 58, 255), (62, 96, 178, 255), (44, 128, 76, 255), (142, 92, 210, 255),
          (226, 152, 62, 255), (70, 68, 84, 255), (46, 160, 156, 255))
BACKDROPS = ((58, 76, 70, 255), (86, 60, 74, 255), (58, 66, 100, 255), (118, 90, 62, 255), (44, 48, 62, 255))
BLOOMS = ((236, 72, 86, 255), (252, 214, 80, 255), (250, 250, 246, 255), (244, 132, 176, 255),
          (164, 120, 236, 255), (250, 150, 64, 255))


def _figure(img, cx, top, rng):
  """A head-and-shoulders bust: 5 px head whose top-left is (cx - 2, top), shoulders below."""
  skin = rng.choice(SKINS)
  hair = rng.choice(HAIRS)
  cloth = rng.choice(CLOTHS)
  long_hair = rng.random() < 0.5
  pal = {'H': hair, 'h': shade(hair, 0.78), 'S': skin, 's': shade(skin, 0.84), 'e': INK, 'C': cloth,
         'c': shade(cloth, 0.72), 'L': mix(cloth, WARM_WHITE, 0.3)}
  body = ['..LCCCc..', '.LCCCCCc.', 'LCCCCCCcc', 'LCCCCCCcc', 'LCCCCCCcc', 'LCCCCCCcc']
  _bitmap(img, cx - 4, top + 6, body, pal)
  if long_hair:
    head = ['.HHH.', 'HHHHh', 'HSSSh', 'HeSeh', 'HSSsh', 'HSsSh', 'H...h', 'h...h']
  else:
    head = ['.HHH.', 'HHHHh', 'HSSSs', 'SeSes', 'SSSSs', '.SSs.', '..s..']
  _bitmap(img, cx - 2, top, head, pal)


def _canvas_portrait(w, h, rng, v=0):
  bg = rng.choice(BACKDROPS)
  img = new(w, h, bg)
  people = 1 if w < 16 else rng.choice((2, 3))
  xs = [w // 2] if people == 1 else ([w // 2 - 5, w // 2 + 5] if people == 2 else [w // 2 - 8, w // 2, w // 2 + 8])
  glow = mix(bg, WARM_WHITE, 0.14)
  for cx in xs:
    fill_mask(img, disc_mask(w, h, cx + 0.5, h * 0.45, 4.4, 4.6), glow)
  for i, cx in enumerate(xs):
    top = max(1, h - 11) + (2 if (people == 3 and i == 1) else 0) + rng.choice((0, 0, 1))
    _figure(img, cx, top, rng)
  return img


def _canvas_landscape(w, h, rng, v=0):
  img = new(w, h)
  mood = ('day', 'sunset', 'day', 'night')[v % 4]
  sky_hi, sky_lo, far, near, near_hi = {
    'day': ((108, 176, 238, 255), (176, 218, 248, 255), (104, 156, 150, 255), (63, 160, 84, 255),
            (106, 210, 92, 255)),
    'sunset': ((226, 116, 110, 255), (252, 196, 122, 255), (150, 92, 118, 255), (82, 112, 70, 255),
               (124, 150, 78, 255)),
    'night': ((30, 34, 72, 255), (58, 66, 120, 255), (44, 64, 92, 255), (34, 82, 66, 255), (50, 110, 80, 255)),
  }[mood]
  horizon = max(3, round(h * 0.52))
  split = max(1, horizon // 2)
  for y in range(h):
    hline(img, 0, y, w, sky_hi if y < split else sky_lo)
  for x in range(0, w, 2):  # a dithered seam between the two sky bands
    put(img, x + (split % 2), split, sky_hi)
  if mood == 'day':
    sx, sy = rng.randint(1, max(1, w - 4)), rng.randint(0, max(0, horizon - 5))
    _bitmap(img, sx, sy, ['.y.', 'yYy', '.y.'], {'y': (255, 236, 150, 255), 'Y': (255, 252, 220, 255)})
    for _ in range(1 if w < 16 else 2):
      cx, cy = rng.randint(0, w - 5), rng.randint(1, max(1, horizon - 3))
      _bitmap(img, cx, cy, ['.ww.', 'wwww'], {'w': (250, 250, 250, 255)})
  elif mood == 'sunset':
    sx = rng.randint(2, w - 3)
    fill_mask(img, disc_mask(w, h, sx + 0.5, horizon - 0.5, 2.6, 2.6), (255, 226, 140, 255))
  else:
    mx = rng.randint(1, max(1, w - 4))
    _bitmap(img, mx, 1, ['mm.', 'm..', 'mm.'], {'m': (246, 242, 214, 255)})
    for _ in range(max(3, w // 4)):
      put(img, rng.randrange(w), rng.randrange(max(1, horizon - 1)), (220, 226, 255, 255))
  ph1, ph2 = rng.uniform(0, 6.3), rng.uniform(0, 6.3)
  amp = 1.6 if w < 16 else 2.2
  near_line = []
  for x in range(w):
    yf = horizon - round(1 + amp * (0.5 + 0.5 * math.sin(x * 0.55 + ph1)))
    yn = horizon + max(1, round(h * 0.16)) + round(1.1 * math.sin(x * 0.32 + ph2))
    vline(img, x, yf, h - yf, far)
    vline(img, x, yn, h - yn, near)
    put(img, x, yn, near_hi)
    near_line.append(yn)
  if w >= 16 and rng.random() < 0.5:
    lx = rng.randint(1, w - 9)
    ly = min(h - 2, max(near_line[lx:lx + 8]) + 1)
    _bitmap(img, lx, ly, ['.wwwwww.', 'wwwWwwww'], {'w': (60, 122, 214, 255), 'W': (200, 230, 255, 255)})
  elif w >= 16:
    hx = rng.randint(2, w - 6)
    hy = near_line[hx + 1] - 3
    _bitmap(img, hx, hy, ['.rrr.', 'rrrrr', '.wdw.', '.www.'],
            {'r': (196, 66, 58, 255), 'w': (240, 230, 206, 255), 'd': (90, 60, 50, 255)})
  for _ in range(1 if w < 16 else 2):
    tx = rng.randint(0, w - 3)
    ty = near_line[min(w - 1, tx + 1)] - 4
    _bitmap(img, tx, ty, ['.g.', 'gGG', 'GGG', '.t.', '.t.'],
            {'g': mix(near_hi, (255, 255, 255, 255), 0.1), 'G': shade(near, 0.72), 't': (100, 66, 50, 255)})
  return img


def _canvas_abstract(w, h, rng, v=0):
  style = ('grid', 'circles', 'stripes', 'fields')[v % 4]
  primaries = [(214, 58, 58, 255), (60, 92, 196, 255), (250, 210, 64, 255)]
  if style == 'grid':
    img = new(w, h, (242, 236, 222, 255))
    ink = (40, 36, 48, 255)
    xs = sorted(rng.sample(range(2, w - 2), 2 if w < 16 else 3))
    ys = sorted(rng.sample(range(2, h - 2), 1 if h < 12 else 2))
    bx, by = [-1] + xs + [w], [-1] + ys + [h]
    cells = [(bx[i] + 1, by[j] + 1, bx[i + 1] - bx[i] - 1, by[j + 1] - by[j] - 1)
             for i in range(len(bx) - 1) for j in range(len(by) - 1)]
    for k, c in enumerate(rng.sample(cells, min(len(cells), 3))):
      rect(img, c[0], c[1], c[2], c[3], primaries[k % 3])
    for x in xs:
      vline(img, x, 0, h, ink)
    for y in ys:
      hline(img, 0, y, w, ink)
    return img
  if style == 'circles':
    img = new(w, h, rng.choice(((34, 44, 78, 255), (244, 234, 212, 255), (30, 30, 40, 255))))
    cols = [(236, 92, 74, 255), (252, 210, 80, 255), (70, 180, 200, 255), (150, 110, 220, 255),
            (250, 250, 246, 255)]
    rng.shuffle(cols)
    for k in range(3 if w < 16 else 5):
      r = rng.uniform(1.6, 3.6 if w < 16 else 4.4)
      fill_mask(img, disc_mask(w, h, rng.uniform(1, w - 1), rng.uniform(1, h - 1), r, r), cols[k % len(cols)])
    return img
  if style == 'fields':
    pal = rng.choice((
      [(120, 40, 50, 255), (226, 120, 60, 255), (250, 200, 110, 255)],
      [(36, 60, 96, 255), (70, 130, 170, 255), (200, 220, 230, 255)],
      [(60, 40, 70, 255), (180, 70, 110, 255), (240, 170, 120, 255)],
    ))
    img = new(w, h, pal[0])
    n = 2 if h < 12 else 3
    band = (h - 1 - n) // n
    for k in range(n):
      rect(img, 1, 1 + k * (band + 1), w - 2, band, pal[1 + (k % 2)] if n == 2 else pal[(k + 1) % 3])
    return img
  img = new(w, h)
  cols = rng.sample([(236, 92, 74, 255), (252, 210, 80, 255), (70, 180, 200, 255), (60, 70, 120, 255),
                     (244, 236, 220, 255), (90, 170, 110, 255)], 4)
  for y in range(h):
    for x in range(w):
      img.putpixel((x, y), cols[((x + y) // 3) % 4])
  return img


def _canvas_flowers(w, h, rng, v=0):
  """A still life: a vase of flowers on a table (and a bowl of fruit on wide canvases)."""
  wall = rng.choice(((56, 80, 92, 255), (92, 68, 98, 255), (70, 60, 52, 255), (52, 74, 60, 255)))
  img = new(w, h, wall)
  table, table_hi = (140, 92, 62, 255), (186, 132, 86, 255)
  rect(img, 0, h - 2, w, 2, table)
  hline(img, 0, h - 2, w, table_hi)
  vase = rng.choice(((62, 110, 196, 255), (236, 232, 222, 255), (204, 106, 72, 255), (46, 150, 140, 255)))
  vp = {'v': vase, 'V': mix(vase, (255, 255, 255, 255), 0.4), 'd': shade(vase, 0.7)}
  wide = w >= 16
  cx = w // 2 if not wide else w // 2 - 3
  vtop = h - 5  # the vase stands on the table top (row h - 2)
  _bitmap(img, cx - 2, vtop, ['.vv.', 'Vvvd', '.vd.'], vp)
  stem = (60, 150, 70, 255)
  # Blossoms on a little dome over the vase mouth (offsets from the mouth), stems first.
  dome = [(-3, -3), (0, -5), (3, -3), (-1, -2), (2, -6)] if not wide else \
         [(-5, -2), (-3, -4), (0, -5), (3, -4), (5, -2), (1, -2), (-2, -1)]
  blooms = list(BLOOMS)
  rng.shuffle(blooms)
  spots = [(cx - 1 + ox + rng.choice((0, 0, 1)), vtop + oy) for (ox, oy) in dome]
  spots = [(bx, max(1, by)) for (bx, by) in spots]
  for (bx, by) in spots:
    line(img, cx - 1 if bx < cx else cx, vtop, bx, by + 1, stem)
  for k, (bx, by) in enumerate(spots):
    c = blooms[k % len(blooms)]
    _bitmap(img, bx - 1, by - 1, ['.p.', 'pcq', '.q.'], {'p': c, 'q': shade(c, 0.8), 'c': (255, 236, 140, 255)})
  if wide:
    bx = cx + 8
    _bitmap(img, bx, h - 6, ['..ra..', '.rroo.', 'yrrooy', 'wwwwww', '.wwww.'],
            {'r': (214, 58, 58, 255), 'a': (90, 160, 70, 255), 'o': (246, 150, 50, 255), 'y': (250, 214, 80, 255),
             'w': (236, 232, 222, 255)})
  return img


PAINTERS = {'landscape': _canvas_landscape, 'portrait': _canvas_portrait, 'abstract': _canvas_abstract,
            'flowers': _canvas_flowers}


def _picture_frame(canvas, colour, band=2, hook=True):
  """Frame a canvas: dark plum outline, a moulding lit from the upper left, the pack's wire hook above."""
  hi, base, lo, deep = tones(colour)
  cw, ch = canvas.size
  m = band + 1
  w, h = cw + 2 * m, ch + 2 * m
  top = 2 if hook else 0
  img = new(w, h + top)
  y0 = top
  rect(img, 0, y0, w, h, OUT)
  rect(img, 1, y0 + 1, w - 2, h - 2, base)
  hline(img, 1, y0 + 1, w - 2, hi)
  vline(img, 1, y0 + 1, h - 2, hi)
  hline(img, 1, y0 + h - 2, w - 2, lo)
  vline(img, w - 2, y0 + 2, h - 3, lo)
  if band >= 2:
    # Inner lip: shaded where the outer moulding overhangs it, lit at the bottom/right.
    hline(img, 2, y0 + 2, w - 4, base)
    vline(img, 2, y0 + 2, h - 4, base)
    hline(img, 2, y0 + h - 3, w - 4, hi)
    vline(img, w - 3, y0 + 2, h - 4, hi)
  paste(img, canvas, m, y0 + m)
  if band == 1:
    # A thin shadow of the frame across the canvas' top edge gives it depth.
    for x in range(m, m + cw):
      c = img.getpixel((x, y0 + m))
      put(img, x, y0 + m, shade(c, 0.78))
  if hook:
    _hook(img, w // 2 - 1, 0, deep)
  return img


@item('painting', 'decor',
      'Framed painting for a room wall (put `at` on wall row 1): landscape, portrait, abstract or flowers; '
      'small (1x1) or wide (2x1).',
      foot=(1, 1), scene='wall',
      variants=[{'theme': 'portrait', 'colour': 'wood', 'seed': 3},
                {'theme': 'landscape', 'size': 'wide', 'seed': 2},
                {'theme': 'flowers', 'size': 'wide', 'colour': 'black', 'seed': 5}],
      theme=Param('enum', 'landscape', choices=('landscape', 'portrait', 'abstract', 'flowers'),
                  doc='what the picture shows'),
      size=Param('enum', 'small', choices=('small', 'wide'), doc='small 1x1 or wide 2x1'),
      colour=Param('colour', 'gold', doc='frame colour'),
      seed=Param('int', 1, 0, 9999, doc='varies the picture'))
def _painting(theme, size, colour, seed):
  rng = noise_rng(seed * 131 + len(theme))
  wide = size == 'wide'
  v = (seed - 1) % 4  # consecutive seeds cycle through the main looks (day, sunset, night...)
  canvas = PAINTERS[theme](24, 10, rng, v) if wide else PAINTERS[theme](10, 12, rng, v)
  img = _picture_frame(canvas, colour, band=2 if wide else 1)
  fw = 2 if wide else 1
  return Made([_wall(img, (fw * T - img.width) // 2, 0)], foot=(fw, 1), solid=[])


# --- Windows and curtains ----------------------------------------------------------------------------------

def _window_mask(style, w, h):
  # Radii a little over half the size give the classic round pixel profile (4-2-1-1 steps), not an octagon.
  if style == 'round':
    return disc_mask(w, h, w / 2, h / 2, w / 2 + 0.3, h / 2 + 0.3)
  if style == 'arched':
    ry = min(w / 2, 7.5)
    mask = {(x, y) for y in range(int(ry), h) for x in range(w)}
    mask |= {(x, y) for (x, y) in disc_mask(w, int(2 * ry) + 1, w / 2, ry, w / 2 + 0.3, ry + 0.3) if y <= ry}
    return mask
  return {(x, y) for y in range(h) for x in range(w)}


def _window_img(style, width, lit, colour):
  """A pack-style window: two-tone frame, 2 px mullions, panes with a top/left shadow and diagonal sheen."""
  if colour == FRAME_DEFAULT:
    hi, base, deep = PACK_FRAME
  else:
    hi, base, _lo, deep = tones(colour)
  glass_c, sheen = GLASS_LIT if lit else GLASS_DAY
  if style == 'round':
    w = h = 14 if width == 1 else 20
  else:
    w = 14 if width == 1 else 28
    h = 18 if style == 'square' else 20
  img = new(w, h)
  mask = _window_mask(style, w, h)
  ring1 = _erode(mask)
  glass = _erode(ring1)
  for (x, y) in mask:
    if (x, y) not in ring1:
      put(img, x, y, base if _lit(mask, x, y) else deep)
    elif (x, y) not in glass:
      put(img, x, y, hi if _lit(ring1, x, y) else base)
  # Mullions: a 2 px cross (light + mid), like the pack's windows.
  bars = set()
  bx = w // 2 - 1
  for y in range(h):
    bars |= {(bx, y), (bx + 1, y)}
  by = {'square': h // 2 - 1, 'arched': int(min(w / 2, 7.5)) + 1, 'round': h // 2 - 1}[style]
  for x in range(w):
    bars |= {(x, by), (x, by + 1)}
  panes = {p for p in glass if p not in bars}
  for (x, y) in panes:
    s = (x + y) % 10
    put(img, x, y, sheen if s in (4, 5) or (s == 6 and y % 2 == 0) else glass_c)
  for (x, y) in panes:
    if (x, y - 1) not in panes or (x - 1, y) not in panes:
      put(img, x, y, deep)
  for (x, y) in glass & bars:
    first = (x - 1, y) not in bars or (x, y - 1) not in bars
    put(img, x, y, hi if first else base)
  if style != 'round':
    # A sill: a lit ledge sticking out a pixel on each side.
    out = new(w + 2, h + 2)
    paste(out, img, 1, 0)
    hline(out, 0, h - 1, w + 2, hi)
    hline(out, 0, h, w + 2, base)
    hline(out, 1, h + 1, w, deep)
    img = out
  return outlined(_pad(img))


def _drape(h, w_top, w_tie, tie_y, colour, folds=2, tie=None, w_bottom=None):
  """A left-hand curtain panel h px tall: w_top wide at the rod, gathered to w_tie at the tieback.

  Returns an outlined image (w_top + 2) x (h + 2); the panel's top-left is at (1, 1).
  """
  hi, base, lo, deep = tones(colour)
  w_bottom = w_top if w_bottom is None else w_bottom
  img = new(w_top + 2, h + 2)
  for y in range(h):
    if y <= tie_y:
      e = w_top - (w_top - w_tie) * (y / max(1, tie_y)) ** 1.5
    else:
      e = w_tie + (w_bottom - w_tie) * ((y - tie_y) / max(1, h - 1 - tie_y)) ** 0.7
    e = max(2, int(round(e)))
    for x in range(e):
      f = (x * folds / e) % 1.0
      c = hi if f < 0.3 else base if f < 0.7 else lo
      if x == e - 1:
        c = lo if c != lo else deep
      put(img, x + 1, y + 1, c)
  if tie is not None:
    th, tb, tl, td = tones(tie)
    for x in range(w_tie + 1):
      put(img, x + 1, tie_y + 1, tb)
      put(img, x + 1, tie_y + 2, tl)
  return outlined(img)


def _rod(img, x0, x1, y, colour='#5a4a5a'):
  """A curtain rod from x0 to x1 (inclusive) with round finials, its bar on row y."""
  hi, base, lo, deep = tones(colour)
  hline(img, x0 + 1, y, x1 - x0 - 1, base)
  for fx in (x0 - 1, x1):
    rect(img, fx, y - 1, 2, 2, base)
    put(img, fx, y - 1, hi)


def _curtained(win, colour):
  """Hang a rod and two tied-back drapes over a window image (returns a wider, taller image).

  The window lands 2 px lower in the result; the rod's bar is on the result's row 1.
  """
  w, h = win.size
  dw = 6 if w < 22 else 7
  out = new(w + 8, h + 3)
  paste(out, win, 4, 2)
  left = _drape(h, dw, 3, int(h * 0.55), colour, folds=2, tie='gold', w_bottom=dw - 1)
  paste(out, left, 1, 1)
  paste(out, flip(left), out.width - left.width - 1, 1)
  r = new(out.width, 3)
  _rod(r, 1, out.width - 2, 1)
  out.alpha_composite(outlined(r))
  return out


@item('window', 'decor',
      'Window for a room wall (put `at` on wall row 1): square, arched or round panes; daylight sky or warm '
      'lit glass; optional curtains.',
      foot=(1, 1), scene='wall',
      variants=[{'style': 'arched', 'curtains': 'crimson'},
                {'width': 2, 'lit': True, 'curtains': 'teal'},
                {'style': 'round', 'colour': 'white'}],
      style=Param('enum', 'square', choices=('square', 'arched', 'round')),
      width=Param('int', 1, 1, 2, doc='tiles wide'),
      lit=Param('bool', False, doc='warm lit glass instead of daytime sky'),
      curtains=Param('str', 'none', doc='curtain colour, or none'),
      colour=Param('colour', FRAME_DEFAULT, doc='frame colour (default: the town windows\' dark wood)'))
def _window(style, width, lit, curtains, colour):
  drapes = _opt_colour('curtains', curtains)
  img = _window_img(style, width, lit, colour)
  dy = 1 if style == 'square' else 0
  if drapes:
    img = _curtained(img, drapes)
    dy -= 1 if style == 'square' else 0
  glows = []
  if lit:
    glows.append({'dx': width * 8, 'dy': 11, 'radius': 1.5 + 0.5 * width, 'colour': '#ffd890', 'flicker': False})
  return Made([_wall(img, (width * T - img.width) // 2, dy)], foot=(width, 1), solid=[], glows=glows)


# --- Clocks --------------------------------------------------------------------------------------------------

def _dial(img, cx, cy, r, hour=10, minute=0, face=CREAM_FACE):
  """A cream dial (centre pixel cx, cy; radius r px) with four ticks and two hands."""
  fill_mask(img, disc_mask(img.width, img.height, cx + 0.5, cy + 0.5, r + 0.45, r + 0.45), face)
  tick = (128, 112, 112, 255)
  for (tx, ty) in ((cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)):
    put(img, tx, ty, tick)
  am = math.radians(minute * 6 - 90)
  ah = math.radians((hour % 12) * 30 + minute * 0.5 - 90)
  line(img, cx, cy, cx + round(math.cos(am) * (r - 1)), cy + round(math.sin(am) * (r - 1)), INK)
  line(img, cx, cy, cx + round(math.cos(ah) * (r - 2)), cy + round(math.sin(ah) * (r - 2)), INK)
  put(img, cx, cy, INK)


def _wall_clock(colour):
  hi, base, lo, deep = tones(colour)
  w = h = 15
  img = new(w, h)
  c = 7.5
  for (x, y) in disc_mask(w, h, c, c, 7.3, 7.3):
    d = (x + 0.5 - c) + (y + 0.5 - c)
    put(img, x, y, hi if d < -3.5 else lo if d > 3.5 else base)
  # A thin dark groove between rim and dial.
  fill_mask(img, disc_mask(w, h, c, c, 5.6, 5.6), deep)
  _dial(img, 7, 7, 4, hour=10, minute=0)
  put(img, 5, 4, (255, 255, 255, 255))  # a glint on the glass
  return outlined(_pad(img))


def _grandfather(colour, k):
  """Long-case clock (18 x 40): crested hood with a dial, a trunk whose glass door shows the pendulum."""
  hi, base, lo, deep = tones(colour)
  brass = tones('gold')
  w, h = 18, 40
  img = new(w, h)
  drop_shadow(img, 9, h - 4, 7.5, 2.4)
  b = new(w, h)
  # Plinth with little bracket feet.
  rect(b, 2, 29, 14, 7, base)
  hline(b, 2, 29, 14, hi)
  vline(b, 2, 29, 7, hi)
  vline(b, 15, 30, 6, lo)
  rect(b, 4, 31, 10, 3, lo)
  hline(b, 4, 31, 10, deep)
  rect(b, 2, 36, 3, 1, deep)
  rect(b, 13, 36, 3, 1, deep)
  # Trunk.
  rect(b, 3, 16, 12, 13, base)
  vline(b, 3, 16, 13, hi)
  vline(b, 14, 16, 13, lo)
  vline(b, 13, 16, 13, mix(base, lo, 0.5))
  # Glass door over the pendulum.
  rect(b, 5, 17, 7, 11, (52, 36, 48, 255))
  frame(b, 5, 17, 7, 11, deep)
  swing = (-1, 0, 1, 0)[k]
  rod_top, bob_y = 18, 24
  line(b, 8, rod_top, 8 + swing, bob_y - 1, brass[2])
  rect(b, 7 + swing, bob_y, 3, 2, brass[1])
  put(b, 7 + swing, bob_y, brass[0])
  for wx in (6, 10):  # weights on their chains
    vline(b, wx, 18, 2, brass[2])
    rect(b, wx, 20, 1, 3, brass[1])
  put(b, 11, 19, (255, 255, 255, 140))
  put(b, 11, 20, (255, 255, 255, 90))
  # Hood: a wider box with the dial plate and a broken-arch crest with finials.
  rect(b, 1, 4, 16, 12, base)
  hline(b, 1, 4, 16, hi)
  vline(b, 1, 4, 12, hi)
  vline(b, 16, 5, 11, lo)
  hline(b, 1, 15, 16, deep)
  rect(b, 3, 5, 12, 10, brass[2])
  rect(b, 3, 5, 12, 1, brass[1])
  _dial(b, 9, 10, 4, hour=4, minute=0)
  put(b, 5, 6, brass[0])
  put(b, 13, 6, brass[0])
  rect(b, 4, 2, 10, 2, base)
  hline(b, 4, 2, 10, hi)
  rect(b, 6, 0, 6, 2, base)
  hline(b, 6, 0, 6, hi)
  put(b, 2, 3, brass[1])
  put(b, 15, 3, brass[1])
  put(b, 9, 0, brass[0])
  img.alpha_composite(outlined(_pad(b).crop((1, 1, w + 1, h + 1))))
  return img


@item('clock', 'decor',
      'Clock: style wall = round wall clock (`at` on wall row 1); grandfather = tall floor clock with a swinging '
      'pendulum (stands on the floor, solid).',
      foot=(1, 1), scene='wall',
      variants=[{'colour': 'gold'}, {'colour': 'charcoal'}],
      style=Param('enum', 'wall', choices=('wall', 'grandfather')),
      colour=Param('colour', 'brown', doc='rim or case colour'))
def _clock(style, colour):
  if style == 'grandfather':
    frames = [_grandfather(colour, k) for k in range(4)]
    return Made([standing(frames, (1, 1), dy=2, fps=3)], foot=(1, 1))
  img = _wall_clock(colour)
  return Made([_wall(img, (T - img.width) // 2, 0)], foot=(1, 1), solid=[])


# --- Vase ----------------------------------------------------------------------------------------------------

def _vase_img(colour, flowers, seed):
  rng = noise_rng(seed)
  ramp = tones(colour)
  hi, base, lo, deep = ramp
  w, h = 18, 28
  top = 13  # the vase's lip row
  img = new(w, h)
  drop_shadow(img, 9, h - 3, 6.5, 2.4)
  # The bouquet: a few leaves at the mouth, stems fanning out, big blossoms at different heights.
  plant = new(w, h)
  cols = [to_rgba(c) for c in flowers]
  tips = [(3, 7), (6, 3), (9, 1), (12, 3), (15, 7), (8, 6), (11, 7)]
  rng.shuffle(tips)
  tips = tips[:rng.randint(5, 7)]
  tips = [(x + rng.choice((-1, 0, 0, 1)), y + rng.choice((0, 0, 1))) for (x, y) in tips]
  for (bx, by) in tips:
    line(plant, 8 if bx < 9 else 9, top - 1, bx, by + 2, LEAF_MID)
  for (lx, ly, d) in ((6, top - 2, -1), (12, top - 2, 1)):
    _bitmap(plant, lx - (2 if d < 0 else 0), ly - 1, ['.ll', 'LL.'] if d < 0 else ['ll.', '.LL'],
            {'l': LEAF_LIGHT, 'L': LEAF})
  for k, (bx, by) in enumerate(sorted(tips, key=lambda t: t[1])):
    c = cols[k % len(cols)]
    ch, cb, cl, cd = tones(c)
    heart = (150, 92, 44, 255) if (c[0] > 200 and c[1] > 160 and c[2] < 150) else (255, 226, 112, 255)
    _bitmap(plant, bx - 1, by - 1, ['hbb.', 'bccl', 'bccl', '.ll.'], {'h': ch, 'b': cb, 'l': cl, 'c': heart})
  img.alpha_composite(outlined(plant, soft=True))
  # The vase: a round-bellied urn lit from the left with a contrasting band.
  vase = new(w, h)
  rows = [(6, 12), (7, 11), (6, 12), (5, 13), (4, 14), (4, 14), (4, 14), (4, 14), (5, 13), (5, 13), (6, 12),
          (7, 11)]
  for i, (x0, x1) in enumerate(rows):
    _shade_rows(vase, x0, x1, top + i, ramp)
  hline(vase, 6, top, 6, hi)
  hline(vase, 7, top, 4, deep)  # the dark mouth
  band = tones(rng.choice(('cream', 'gold', 'white')) if colour not in ('white', 'cream') else 'navy')
  for x in range(4, 14):
    put(vase, x, top + 5, band[1] if x < 11 else band[2])
  put(vase, 5, top + 3, mix(hi, (255, 255, 255, 255), 0.5))
  put(vase, 5, top + 4, mix(hi, (255, 255, 255, 255), 0.3))
  hline(vase, 7, top + len(rows) - 1, 4, deep)
  img.alpha_composite(outlined(vase))
  return img


@item('vase', 'decor', 'A big floor vase with a bunch of flowers (solid). Nice in corners, by doors and beside '
      'sofas.', foot=(1, 1),
      variants=[{'colour': 'white', 'flowers': ['blue', 'lilac', 'white'], 'seed': 2},
                {'colour': 'coral', 'flowers': ['yellow', 'orange', 'white'], 'seed': 4}],
      colour=Param('colour', 'blue', doc='vase colour'),
      flowers=Param('colours', ['red', 'yellow', 'pink'], doc='flower colours'),
      seed=Param('int', 1, 0, 9999))
def _vase(colour, flowers, seed):
  return Made([standing(_vase_img(colour, flowers, seed), (1, 1), dy=2)], foot=(1, 1))


# --- Crates and barrels -------------------------------------------------------------------------------------

def _crate_img(ramp, rim, rng, w=15, top=11, front=9):
  """One 3/4-view crate (unoutlined): an X-braced lit top over a darker braced front, like the pack's."""
  hi, base, lo, deep = ramp
  img = new(w, top + front)
  # Top face: a board frame round a lighter panel, crossed by an X brace shaded on its lower edge.
  rect(img, 0, 0, w, top, base)
  rect(img, 1, 1, w - 2, top - 2, hi)
  for (x0, y0, x1, y1) in ((1, 1, w - 2, top - 3), (w - 2, 1, 1, top - 3)):
    line(img, x0, y0 + 1, x1, y1 + 1, lo)
    line(img, x0, y0, x1, y1, base)
  hline(img, 1, top - 2, w - 2, base)
  hline(img, 0, top - 1, w, rim)
  # Front face: dark frame boards, a mid panel with a brace (or planks) in the darkest wood.
  rect(img, 0, top, w, front, lo)
  rect(img, 1, top + 1, w - 2, front - 2, base)
  if rng.random() < 0.6:
    line(img, 2, top + 2, w - 3, top + front - 3, deep)
    line(img, w - 3, top + 2, 2, top + front - 3, deep)
  else:
    for yy in range(top + 3, top + front - 1, 3):
      hline(img, 1, yy, w - 2, lo)
    vline(img, w // 2, top + 1, front - 2, lo)
  hline(img, 1, top + 1, w - 2, mix(base, hi, 0.5))
  hline(img, 0, top + front - 1, w, deep)
  return img


def _box_shadow(img, x0, x1, y):
  """The pack's shadow under a box: a two-row band just below its front edge, a little to the right."""
  for x in range(x0 + 1, x1 + 1):
    put(img, x, y, SHADOW)
  for x in range(x0 + 3, x1 - 1):
    put(img, x, y + 1, SHADOW)


def _barrel_img(ramp, rng):
  """One upright barrel (unoutlined), 14 x 19: a lit lid ellipse, bulging staves, two iron hoops."""
  hi, base, lo, deep = ramp
  w = 14
  img = new(w, 19)
  half = [5, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 5]
  for i, hw in enumerate(half):
    y = 3 + i
    for x in range(7 - hw, 7 + hw):
      t = (x - (7 - hw)) / max(1, 2 * hw - 1)
      c = hi if t < 0.22 else base if t < 0.62 else lo if t < 0.88 else deep
      if (x - (7 - hw)) % 3 == 2 and 0.15 < t < 0.85:
        c = shade(c, 0.9)
      put(img, x, y, c)
  for hy in (5, 13):
    hw = half[hy - 3]
    for x in range(7 - hw, 7 + hw):
      t = (x - (7 - hw)) / max(1, 2 * hw - 1)
      put(img, x, hy, IRON[0] if t < 0.3 else IRON[1] if t < 0.75 else IRON[2])
      put(img, x, hy + 1, IRON[2] if t < 0.75 else IRON[3])
  lid = disc_mask(w, 6, 7, 3, 5.2, 2.6)
  fill_mask(img, lid, base)
  fill_mask(img, disc_mask(w, 6, 7, 3, 4.2, 1.7), hi)
  hline(img, 4, 3, 6, base)
  if rng.random() < 0.35:
    put(img, 9, 2, lo)  # a bung on the lid
  return img


def _tap(img, x, y):
  """A little brass tap on a barrel's front (x, y = its top-left)."""
  g = tones('gold')
  _bitmap(img, x, y, ['hb', 'bl', '.l'], {'h': g[0], 'b': g[1], 'l': g[2]})


@item('crates', 'decor', 'Wooden crates like the market\'s: 1-3, piled up or in a row (solid). Foot 1x1, 2x1 for a '
      'pile of three; a row is count x 1.', foot=(1, 1),
      variants=[{'count': 3}, {'count': 2, 'stacked': False, 'seed': 2}, {'count': 2, 'colour': 'tan'}],
      count=Param('int', 1, 1, 3),
      stacked=Param('bool', True, doc='pile them up (else side by side)'),
      colour=Param('colour', CRATE_DEFAULT, doc='wood colour (default: the market crates\' wood)'),
      seed=Param('int', 1, 0, 9999))
def _crates(count, stacked, colour, seed):
  rng = noise_rng(seed)
  ramp = _ramp(colour, CRATE_DEFAULT, PACK_CRATE)
  rim = PACK_CRATE_RIM if colour == CRATE_DEFAULT else mix(ramp[0], WARM_WHITE, 0.3)
  fw = (2 if count == 3 else 1) if stacked else count
  W, H = fw * T, 44
  img = new(W, H)
  ground = H - 4
  cw, top, front = 15, 11, 9
  if not stacked or count == 1:
    boxes = [(i * T + 1, ground) for i in range(count)]
  elif count == 2:
    boxes = [(1, ground), (1 + rng.choice((-1, 0, 0, 1)), ground - front)]
  else:
    boxes = [(0, ground), (17, ground), (8 + rng.choice((-1, 0, 1)), ground - front)]
  for (x, by) in boxes:
    if by == ground:
      _box_shadow(img, x - 1, x + cw, ground + 2)
  for (x, by) in boxes:
    c = _crate_img(ramp, rim, rng, cw, top, front)
    paste(img, outlined(_pad(c)), x - 1, by - top - front)
  return Made([standing(_trim_top(img), (fw, 1), dy=2)], foot=(fw, 1))


@item('barrels', 'decor', 'Wooden barrels with iron hoops: 1-3, stacked or in a row (solid). Foot 1x1, 2x1 for '
      'three stacked; a row is count x 1.', foot=(1, 1),
      variants=[{'count': 3}, {'count': 2, 'stacked': False}],
      count=Param('int', 1, 1, 3),
      stacked=Param('bool', True, doc='stand one on another (else side by side)'),
      colour=Param('colour', CRATE_DEFAULT, doc='wood colour (default: the market barrels\' wood)'),
      seed=Param('int', 1, 0, 9999))
def _barrels(count, stacked, colour, seed):
  rng = noise_rng(seed)
  ramp = _ramp(colour, CRATE_DEFAULT, PACK_CRATE)
  fw = (2 if count == 3 else 1) if stacked else count
  W, H = fw * T, 44
  img = new(W, H)
  ground = H - 4
  if not stacked or count == 1:
    spots = [(i * T + 1, ground) for i in range(count)]
  elif count == 2:
    spots = [(1, ground), (1, ground - 16)]
  else:
    spots = [(1, ground), (1, ground - 16), (17, ground)]
  for (x, by) in spots:
    if by == ground:
      drop_shadow(img, x + 7, ground + 1, 8, 2.6)
  tap = rng.randrange(len(spots)) if rng.random() < 0.4 else -1
  # Bottom barrels first: an upper barrel rests on (and hides) the lid below it.
  for i, (x, by) in sorted(enumerate(spots), key=lambda e: -e[1][1]):
    f = rng.uniform(0.94, 1.06)
    b = _barrel_img(tuple(shade(c, f) for c in ramp), rng)
    if i == tap and by == ground:
      _tap(b, 6, 9)
    b = outlined(_pad(b))
    paste(img, b, x - 1, by - b.height + 1)
  return Made([standing(_trim_top(img), (fw, 1), dy=2)], foot=(fw, 1))


# --- Books ---------------------------------------------------------------------------------------------------

PAGES = ((244, 236, 214, 255), (214, 202, 180, 255))


def _book(colour, w, pages_out):
  """A book lying flat (unoutlined), w x 5: a 2 px foreshortened cover over a 3 px edge.

  The edge is the spine (rounded: lit top, a gilt title band, shaded bottom) or the fore-edge (cream pages
  between the two boards).
  """
  hi, base, lo, deep = tones(colour)
  img = new(w, 5)
  hline(img, 0, 0, w, hi)
  hline(img, 0, 1, w, base)
  if pages_out:
    hline(img, 0, 2, w, lo)
    hline(img, 1, 3, w - 2, PAGES[0])
    put(img, 0, 3, lo)
    put(img, w - 1, 3, PAGES[1])
    hline(img, 0, 4, w, deep)
  else:
    hline(img, 0, 2, w, base)
    hline(img, 0, 3, w, lo)
    if w >= 6:
      hline(img, 2, 3, 2, mix(base, (255, 228, 140, 255), 0.7))
      put(img, w - 3, 3, mix(base, (255, 228, 140, 255), 0.7))
    hline(img, 0, 4, w, deep)
  return img


def _book_pile(books, ribbon=None):
  """books: [(colour, width, x offset, pages_out)] bottom-up -> a pile (feet on its last row).

  Every book is outlined on its own, so each one reads as a 3 px spine (or fore-edge) over a dark seam.
  """
  wmax = max(b[1] + b[2] for b in books)
  h = 4 * len(books) + 3
  img = new(wmax + 2, h)
  y = h - 7
  for i, (c, bw, off, pages) in enumerate(books):
    b = outlined(_pad(_book(c, bw, pages)))
    paste(img, b, off, y)
    if ribbon is not None and i == ribbon:
      vline(img, off + bw - 2, y + 6, 2, (214, 58, 58, 255))
    y -= 4
  return img


@item('books', 'decor', 'A pile of books on the floor: one or two stacks of colourful books (solid).',
      foot=(1, 1),
      variants=[{'count': 10, 'seed': 3}, {'count': 3, 'colours': ['navy', 'gold', 'crimson']}],
      count=Param('int', 6, 1, 10, doc='how many books'),
      colours=Param('colours', ['crimson', 'navy', 'forest', 'tan', 'purple'], doc='cover colours'),
      seed=Param('int', 1, 0, 9999))
def _books(count, colours, seed):
  rng = noise_rng(seed)
  W, H = 18, 40
  img = new(W, H)
  ground = H - 4
  cols = [to_rgba(c) for c in colours]
  # At most four books a stack: one stack, two (back left, front right) or three (two behind, one in front).
  if count <= 4:
    per, places = [count], [(2, 12, ground - 1)]
  elif count <= 8:
    per, places = [count - count // 2, count // 2], [(0, 10, ground - 2), (7, 9, ground)]
  else:
    per, places = [4, count - 6, 2], [(0, 9, ground - 4), (7, 9, ground - 3), (3, 10, ground)]
  for (x, bw, fy) in places:
    drop_shadow(img, x + bw / 2 + 1, fy + 1, bw / 2 + 1.5, 2.0)
  order = list(range(len(cols)))
  rng.shuffle(order)
  i = 0
  for (x, bw, fy), k in zip(places, per):
    books = []
    for _ in range(k):
      c = cols[order[i % len(order)]]
      i += 1
      wb = bw - rng.choice((0, 0, 1, 2))
      books.append((c, wb, rng.randint(0, bw - wb), rng.random() < 0.4))
    pile = _book_pile(books, ribbon=rng.randrange(k) if rng.random() < 0.5 else None)
    paste(img, pile, x, fy - pile.height + 2)
  return Made([standing(_trim_top(img), (1, 1), dy=3)], foot=(1, 1))


# --- Trophy shelf --------------------------------------------------------------------------------------------

def _trophy(kind, metal):
  """A small trophy (outlined) whose bottom row is its base: cup, big cup, star or figure."""
  hi, base, lo, deep = tones(METALS.get(metal, metal))
  pal = {'h': hi, 'b': base, 'l': lo, 'd': deep, 'w': (126, 82, 60, 255), 'W': (92, 58, 52, 255),
         'v': (166, 116, 80, 255), 'g': METALS['gold'], 'G': (255, 236, 150, 255)}
  rows = {
    'cup_big': ['.hhbbbbbll.', 'h.hbbbbbl.l', 'h.hbbbbbl.l', '.hhbbbbbll.', '...hbbbl...', '....hbl....',
                '.....b.....', '....hbl....', '...hbbbl...', '..vvvvvvv..', '..wwwwwwW..'],
    'cup': ['.hbbbl.', 'hhbbbll', '.hbbbl.', '..hbl..', '...b...', '..hbl..', '.vvvvv.', '.wwwwW.'],
    'star': ['...h...', '..hhb..', 'hhhhbbl', '.hhbbl.', '.hb.bl.', '.h...l.', '...b...', '...b...', '..hbl..',
             '.vvvvv.', '.wwwwW.'],
    'ball': ['..hhb..', '.hhbbl.', '.hbbbl.', '..bll..', '...b...', '..hbl..', '.vvvvv.', '.wwwwW.'],
    'shield': ['vvvvvvw', 'vwgggww', 'vwgGgwW', 'vwwgwwW', '.wwwwW.', '..wwW..', '...W...'],
  }[kind]
  img = new(len(rows[0]) + 2, len(rows) + 2)
  _bitmap(img, 1, 1, rows, pal)
  return outlined(img)


def _medal(ribbon, metal):
  rh, rb, rl, rd = tones(ribbon)
  mh, mb, ml, md = tones(METALS.get(metal, metal))
  img = new(7, 11)
  _bitmap(img, 1, 1, ['rR.rR', 'rR.rR', '.rRr.', '..R..', '.hbb.', 'hbbbl', '.bll.'],
          {'r': rb, 'R': rl, 'h': mh, 'b': mb, 'l': ml})
  return outlined(img)


def _shelf(length_px, colour, brackets=True):
  """A wall shelf plank seen from the 3/4 view: lit top, front edge, little brackets (outlined, 2 px pad)."""
  hi, base, lo, deep = tones(colour)
  W = length_px
  img = new(W + 2, 9)
  rect(img, 1, 1, W, 4, base)
  hline(img, 1, 1, W, hi)
  hline(img, 1, 3, W, lo)
  hline(img, 1, 4, W, deep)
  if brackets:
    for bx in (3, W - 3):
      rect(img, bx, 5, 2, 2, lo)
      put(img, bx, 7, lo)
      put(img, bx, 5, base)
  return outlined(img)


@item('trophy_shelf', 'decor',
      'A wall shelf of gold, silver and bronze trophies with medals hanging below (put `at` on wall row 1); '
      '1-3 tiles long.',
      foot=(2, 1), scene='wall',
      variants=[{'length': 3, 'seed': 2}, {'length': 1, 'colour': 'charcoal'}],
      length=Param('int', 2, 1, 3, doc='tiles long'),
      colour=Param('colour', 'brown', doc='shelf colour'),
      seed=Param('int', 1, 0, 9999))
def _trophy_shelf(length, colour, seed):
  rng = noise_rng(seed)
  W = length * T
  img = new(W, 32)
  sy = 16  # the shelf's top surface row
  pool = ['cup', 'star', 'ball', 'shield', 'cup', 'star']
  rng.shuffle(pool)
  kinds = {1: ['cup_big'], 2: [pool[0], 'cup_big', pool[1]],
           3: [pool[0], pool[1], 'cup_big', pool[2], pool[3]]}[length]
  metals = ['gold', 'silver', 'bronze']
  items = []
  for i, k in enumerate(kinds):
    m = 'gold' if k == 'cup_big' else metals[(i + rng.randrange(3)) % 3]
    items.append(_trophy(k, m))
  # Spread them evenly: `gap` px of wall between neighbouring outlines (they may share an outline if tight).
  total = sum(t.width for t in items)
  gap = max(-1, min(3, (W - 2 - total) // max(1, len(items) - 1)))
  x = (W - (total + (len(items) - 1) * gap)) // 2
  for t in items:
    paste(img, t, x, sy - t.height + 2)
    x += t.width + gap
  paste(img, _shelf(W - 2, colour), 0, sy - 1)
  for i in range(length):
    m = _medal(rng.choice(('crimson', 'blue', 'teal', 'purple')), rng.choice(metals))
    paste(img, m, i * T + 5 + rng.choice((-1, 0, 1)), sy + 4)
  return Made([_wall(img, 0, 0)], foot=(length, 1), solid=[])


# --- Fireplace -----------------------------------------------------------------------------------------------

def _flames(w, h, k, n=4, seed=5):
  """One frame of a small log fire: tongues whose heights breathe from frame to frame."""
  rng = noise_rng(seed)
  img = new(w, h)
  m = max(2, w // 4)
  phases = [rng.uniform(0, 6.3) for _ in range(m)]
  centres = [(i + 0.5) * w / m + rng.uniform(-0.5, 0.5) for i in range(m)]
  for x in range(w):
    hcol = 0.0
    for i in range(m):
      d = abs(x + 0.5 - centres[i]) / (w / m * 0.95)
      if d < 1:
        th = h * (0.55 + 0.45 * abs(math.sin(phases[i] + k * 2 * math.pi / n)))
        if i in (0, m - 1):
          th *= 0.72
        hcol = max(hcol, th * (1 - d * d))
    for y in range(h):
      up = h - y
      if up <= hcol:
        t = up / max(1.0, hcol)
        centre = 0.2 < x / w < 0.8
        c = FIRE[0] if (t < 0.32 and centre) else FIRE[1] if t < 0.58 else FIRE[2] if t < 0.86 else FIRE[3]
        put(img, x, y, c)
  if k % 2 == 0:
    put(img, int(centres[k % m]), max(0, h - int(h * 1.05) - 1), FIRE[2])
  return img


def _fireplace_frames(style, lit, colour, seed):
  rng = noise_rng(seed)
  W, H = 36, 50
  frames = []
  if style == 'brick':
    ramp = tones(colour if colour else (176, 84, 64, 255))
    mortar = (206, 190, 176, 255)
  else:
    ramp = tones(colour) if colour else WARM_STONE
    mortar = None
  slab = WARM_STONE
  wood = tones((130, 82, 58, 255))
  base = new(W, H)
  b = new(W, H)
  # Chimney breast up the wall.
  if style == 'brick':
    _bricks(b, 5, 0, 26, 22, ramp, mortar)
  else:
    _stone_wall(b, 5, 0, 26, 22, ramp, noise_rng(seed + 1))
  vline(b, 5, 0, 22, ramp[0])
  vline(b, 30, 0, 22, ramp[2])
  # Surround below the mantel.
  if style == 'brick':
    _bricks(b, 3, 26, 30, 17, ramp, mortar)
  else:
    _stone_wall(b, 3, 26, 30, 17, ramp, noise_rng(seed + 2))
  vline(b, 3, 26, 17, ramp[0])
  vline(b, 32, 26, 17, ramp[2])
  # Firebox: a dark arched opening with a sooty brick back.
  box = {(x, y) for y in range(31, 43) for x in range(10, 26)}
  box |= {(x, y) for (x, y) in disc_mask(W, 40, 18, 31.5, 8, 4) if y < 32}
  fill_mask(b, box, (36, 26, 38, 255))
  for (x, y) in box:
    if (x, y - 1) not in box:
      put(b, x, y, ramp[3])
    elif y % 3 == 0 and (x + y) % 5 != 0:
      put(b, x, y, (54, 38, 50, 255))
  # Keystone over the arch.
  rect(b, 16, 25, 4, 3, ramp[0])
  hline(b, 16, 27, 4, ramp[2])
  # Mantel shelf (wood), with its lit top surface.
  rect(b, 1, 21, 34, 5, wood[1])
  hline(b, 1, 21, 34, wood[0])
  hline(b, 1, 22, 34, wood[0])
  hline(b, 1, 24, 34, wood[2])
  hline(b, 1, 25, 34, wood[3])
  # Hearth slab on the floor.
  rect(b, 1, 43, 34, 5, slab[1])
  hline(b, 1, 43, 34, slab[0])
  hline(b, 1, 44, 34, slab[0])
  hline(b, 1, 46, 34, slab[2])
  hline(b, 1, 47, 34, slab[3])
  # Logs (and embers) in the firebox.
  logs = new(W, H)
  rect(logs, 12, 40, 12, 2, wood[2])
  hline(logs, 12, 40, 12, wood[1])
  put(logs, 12, 40, (207, 144, 84, 255))
  put(logs, 23, 41, (207, 144, 84, 255))
  line(logs, 13, 38, 22, 41, wood[1])
  line(logs, 14, 38, 23, 41, wood[2])
  base.alpha_composite(outlined(b))
  base.alpha_composite(logs)
  # Mantel ornaments: two candlesticks and something in the middle.
  orn = new(W, H)
  for cx in (4, 30):
    rect(orn, cx, 16, 2, 4, (244, 238, 222, 255))
    vline(orn, cx + 1, 16, 4, (214, 204, 186, 255))
    hline(orn, cx - 1, 20, 4, tones('gold')[1])
  mid = rng.choice(('clock', 'vase', 'frame'))
  if mid == 'clock':
    _bitmap(orn, 15, 13, ['.bbbb.', 'bccccb', 'bckccb', 'bcckcb', 'bccccb', 'bbbbbb', 'b....b'],
            {'b': wood[1], 'c': CREAM_FACE, 'k': INK})
  elif mid == 'vase':
    _bitmap(orn, 15, 11, ['.r.y..', 'rgrgy.', '.gggr.', '..vv..', '.vvvd.', '.vvvd.', '..vd..', '..vd..'],
            {'r': (236, 72, 86, 255), 'y': (252, 214, 80, 255), 'g': LEAF, 'v': (62, 110, 196, 255),
             'd': (44, 76, 150, 255)})
  else:
    _bitmap(orn, 14, 12, ['gggggggg', 'gsssssgg', 'gsslssgg', 'gslllsgg', 'gggggggg', 'g......g'],
            {'g': tones('gold')[1], 's': (120, 180, 230, 255), 'l': (63, 160, 84, 255)})
  base.alpha_composite(outlined(orn))
  for k in range(4):
    f = base.copy()
    if lit:
      fl = _flames(12, 9, k, seed=seed + 3)
      f.alpha_composite(fl, (12, 31))
      for (ex, ey) in ((13, 42), (16, 42), (19, 41), (22, 42)):
        put(f, ex, ey, FIRE[3] if (ex + k) % 2 else FIRE[2])
      for cx in (4, 30):
        tip = (0, -1, 0, 1)[(k + cx) % 4]
        put(f, cx + (1 if tip > 0 else 0), 14, FIRE[1])
        put(f, cx, 15, FIRE[2])
        put(f, cx + 1, 15, FIRE[1])
    frames.append(f)
  return frames if lit else frames[:1]


@item('fireplace', 'decor',
      'Stone or brick fireplace with a crackling fire and a mantel; 2x1 on the first floor row against a wall, '
      'rising up the wall face. Solid; flickering glow.',
      foot=(2, 1),
      variants=[{'style': 'brick'}, {'lit': False, 'seed': 4}],
      style=Param('enum', 'stone', choices=('stone', 'brick')),
      lit=Param('bool', True, doc='a fire burning'),
      seed=Param('int', 1, 0, 9999, doc='mantel ornaments'))
def _fireplace(style, lit, seed):
  frames = _fireplace_frames(style, lit, None, seed)
  piece = standing(frames if lit else frames[0], (2, 1), dy=2, fps=6 if lit else 0)
  glows = [{'dx': 16, 'dy': 4, 'radius': 3.0, 'colour': '#ffa040', 'flicker': True}] if lit else []
  return Made([piece], foot=(2, 1), glows=glows)


# --- Mirror --------------------------------------------------------------------------------------------------

def _mirror_img(shape, colour):
  hi, base, lo, deep = tones(colour)
  g, sheen, dim = MIRROR_GLASS
  if shape == 'round':
    w, h = 15, 15
    mask = disc_mask(w, h, w / 2, h / 2, 7.3, 7.3)
  elif shape == 'oval':
    w, h = 12, 17
    mask = disc_mask(w, h, w / 2, h / 2, w / 2, h / 2)
  else:
    w, h = 12, 18
    mask = {(x, y) for y in range(h) for x in range(w)}
  img = new(w, h)
  ring1 = _erode(mask)
  glass = _erode(ring1)
  for (x, y) in mask:
    if (x, y) not in ring1:
      put(img, x, y, hi if _lit(mask, x, y) else lo)
    elif (x, y) not in glass:
      put(img, x, y, base if _lit(ring1, x, y) else hi)
  gy0 = min(y for (_x, y) in glass)
  for (x, y) in glass:
    s = x + (y - gy0)
    c = sheen if s in (4, 5, 8) else dim if (y - gy0) > (h - gy0) * 0.6 and s > 9 else g
    put(img, x, y, c)
  for (x, y) in glass:
    if (x, y - 1) not in glass or (x - 1, y) not in glass:
      put(img, x, y, dim)
  hook = shape != 'round'
  out = new(w + 2, h + (4 if hook else 2))
  paste(out, img, 1, 3 if hook else 1)
  if hook:
    _hook(out, (w + 2) // 2 - 1, 0, deep)
  return outlined(out)


@item('mirror', 'decor', 'A framed wall mirror with a glassy sheen (put `at` on wall row 1): oval, round or tall '
      'rectangle.', foot=(1, 1), scene='wall',
      variants=[{'shape': 'round', 'colour': 'silver'}, {'shape': 'rect', 'colour': 'wood'}],
      shape=Param('enum', 'oval', choices=('oval', 'round', 'rect')),
      colour=Param('colour', 'gold', doc='frame colour'))
def _mirror(shape, colour):
  img = _mirror_img(shape, colour)
  return Made([_wall(img, (T - img.width) // 2, 0 if shape != 'round' else 1)], foot=(1, 1), solid=[])


# --- Wall shelf ----------------------------------------------------------------------------------------------

def _jar(colour):
  hi, base, lo, deep = tones(colour)
  img = new(7, 9)
  _bitmap(img, 1, 1, ['.kkk.', '.ggg.', 'gcccg', 'gcCcg', 'gcccg', 'gCccg', '.ggg.'],
          {'k': (150, 110, 80, 255), 'g': (214, 232, 236, 255), 'c': base, 'C': lo})
  put(img, 2, 3, (255, 255, 255, 255))
  return outlined(img)


def _potted_plant(rng, trailing=True):
  """A little terracotta pot with a fan of leaves; trailing ivy hangs down over the shelf edge.

  12 x 20; the pot's base is on row 9 (the shelf top), the ivy hangs below it.
  """
  img = new(12, 20)
  pot = tones((200, 104, 70, 255))
  leaves = new(12, 20)
  # A fan of blades from the pot's centre: each blade a light edge over a mid body.
  for (tx, ty) in ((2, 2), (5, 0), (8, 1), (10, 3), (1, 5), (10, 6)):
    line(leaves, 6, 6, tx, ty, LEAF)
    line(leaves, 6 if tx < 6 else 5, 6, tx + (1 if tx < 6 else -1), ty + 1, LEAF_MID)
    put(leaves, tx, ty, LEAF_LIGHT)
  if trailing:
    side = rng.choice((-1, 1))
    x = 6 + 4 * side
    for y in range(6, 6 + rng.randint(10, 13)):
      if y > 10 and y % 3 == 0:
        x += rng.choice((0, side))
      put(leaves, x, y, LEAF_MID)
      if y % 3 == 0:
        put(leaves, x - side, y, LEAF_LIGHT)
      elif y % 3 == 1 and y > 9:
        put(leaves, x + side, y, LEAF)
  img.alpha_composite(outlined(leaves, soft=True))
  potimg = new(12, 20)
  _bitmap(potimg, 3, 5, ['hhbbbl', 'hbbbbl', '.hbbl.', '.hbll.'], {'h': pot[0], 'b': pot[1], 'l': pot[2]})
  img.alpha_composite(outlined(potimg))
  return img


def _upright_books(colours, rng, n):
  img = new(3 * n + 6, 12)
  x = 1
  for k in range(n):
    c = to_rgba(colours[k % len(colours)])
    hi, base, lo, deep = tones(c)
    bh = rng.randint(6, 8)
    bw = rng.choice((2, 2, 3))
    rect(img, x, 11 - bh, bw, bh, base)
    vline(img, x, 11 - bh, bh, hi)
    put(img, x + bw - 1, 11 - bh + 2, mix(base, (255, 228, 140, 255), 0.6))
    x += bw
  # The last book leans on the others.
  c = tones(to_rgba(colours[n % len(colours)]))
  for i in range(7):
    put(img, x + i // 3, 10 - i, c[1])
    put(img, x + 1 + i // 3, 10 - i, c[2])
  return outlined(img)


@item('wall_shelf', 'decor', 'A wooden wall shelf with potted plants, jars and books (put `at` on wall row 1); '
      '1-3 tiles long.', foot=(2, 1), scene='wall',
      variants=[{'length': 3, 'seed': 4}, {'length': 1, 'colour': 'white', 'seed': 2}],
      length=Param('int', 2, 1, 3, doc='tiles long'),
      colour=Param('colour', 'wood', doc='shelf colour'),
      seed=Param('int', 1, 0, 9999))
def _wall_shelf(length, colour, seed):
  rng = noise_rng(seed)
  W = length * T
  img = new(W, 32)
  sy = 15
  things = []
  pool = ['plant', 'jars', 'books', 'plant', 'jar', 'books', 'candle']
  rng.shuffle(pool)
  want = {1: 2, 2: 3, 3: 5}[length]
  pool = (['plant'] + [p for p in pool if p != 'plant'])[:want]
  rng.shuffle(pool)
  for p in pool:
    if p == 'plant':
      things.append(_potted_plant(rng, trailing=True))
    elif p in ('jars', 'jar'):
      j = _jar(rng.choice(('orange', 'red', 'teal', 'yellow', 'lime', 'purple')))
      if p == 'jars':
        k = _jar(rng.choice(('orange', 'red', 'teal', 'yellow', 'lime')))
        both = new(j.width + k.width - 2, 11)
        paste(both, k, 0, 11 - k.height)
        paste(both, j, k.width - 2, 11 - j.height)
        j = both
      things.append(j)
    elif p == 'books':
      things.append(_upright_books(['crimson', 'navy', 'forest', 'tan', 'purple'], rng, rng.randint(2, 3)))
    else:
      c = new(5, 10)
      _bitmap(c, 1, 1, ['.f.', '.y.', 'www', 'wWw', 'wWw', 'wWw', 'ggg'],
              {'f': FIRE[1], 'y': FIRE[2], 'w': (244, 238, 222, 255), 'W': (214, 204, 186, 255),
               'g': tones('gold')[1]})
      things.append(outlined(c))
  # Spread them along the shelf (the shelf is drawn over their feet... they stand on it).
  widths = [t.width - 2 for t in things]
  free = W - 2 - sum(widths)
  gap = max(0, free // (len(things) + 1))
  x = 1 + max(0, (free - gap * (len(things) - 1)) // 2)
  placed = []
  for t, tw in zip(things, widths):
    placed.append((t, x))
    x += tw + gap
  shelf = _shelf(W - 2, colour)
  for (t, tx) in placed:
    if t.height >= 18:  # the plant: its trailing vine hangs over the shelf front
      continue
    paste(img, t, tx - 1, sy - t.height + 2)
  paste(img, shelf, 0, sy - 1)
  for (t, tx) in placed:
    if t.height >= 18:
      paste(img, t, tx - 1, sy - 10 + 1)
  return Made([_wall(img, 0, 0)], foot=(length, 1), solid=[])


# --- Sconce --------------------------------------------------------------------------------------------------

CANDLE = ((248, 244, 230, 255), (218, 208, 190, 255))


def _candle_flame(img, x, y, k):
  """A 2 x 4 candle flame whose tip sways with frame k (x, y = top-left of the flame box)."""
  rows = (['.y', 'yY', 'yY', 'oy'], ['y.', 'yY', 'Yy', 'yo'], ['.y', 'Yy', 'yY', 'oy'])[k % 3]
  _bitmap(img, x, y, rows, {'y': FIRE[1], 'Y': FIRE[0], 'o': FIRE[2]})


@item('sconce', 'decor', 'A wall light (put `at` on wall row 1): a two-candle brass sconce with flickering flames, '
      'or a little lantern on a bracket. Soft glow.', foot=(1, 1), scene='wall',
      variants=[{'style': 'lantern'}, {'style': 'lantern', 'colour': 'charcoal', 'lit': False}],
      style=Param('enum', 'candle', choices=('candle', 'lantern')),
      colour=Param('colour', 'gold', doc='metal colour'),
      lit=Param('bool', True, doc='candles or lantern alight'))
def _sconce(style, colour, lit):
  hi, base, lo, deep = tones(colour)
  metal = {'h': hi, 'b': base, 'l': lo, 'd': deep}
  frames = []
  for k in range(3 if lit else 1):
    img = new(16, 24)
    m = new(16, 24)
    if style == 'candle':
      _bitmap(m, 0, 7, ['.wW..........wW.', '.wW..........wW.', '.wW....hb....wW.', '.wW...hbbl...wW.',
                        'hbbl..hbbl..hbbl', '.bl...hbbl...bl.', '..bbbbbbbbbbbl..', '......hbbl......',
                        '.......bl.......'],
              {**metal, 'w': CANDLE[0], 'W': CANDLE[1]})
      img.alpha_composite(outlined(m))
      if lit:
        _candle_flame(img, 1, 3, k)
        _candle_flame(img, 13, 3, k + 1)
    else:
      glass = (255, 236, 160, 255) if lit else (132, 150, 176, 255)
      glass_hi = (255, 252, 228, 255) if lit else (178, 196, 216, 255)
      # A wall plate, a slim bracket with a brace, and a lantern hanging from its end.
      _bitmap(m, 1, 2, ['hb...........', 'hbbbbbbbbbbb.', 'hb.......l...', 'hb......l..d.', 'hb.....l...d.',
                        'hb....l...hbbl', 'hb...l...hbbbbl', 'hb..l.....hgbgl', 'hb.l......hGbgl',
                        'bl........hgbgl', '..........hgbgl', '..........hbbbl', '...........hbl.',
                        '............l..'],
              {**metal, 'g': glass, 'G': glass_hi})
      img.alpha_composite(outlined(m))
    frames.append(img)
  if style == 'candle':
    glows = [{'dx': 8, 'dy': 4, 'radius': 2.2, 'colour': '#ffd27a', 'flicker': True}] if lit else []
    piece = _wall(frames if len(frames) > 1 else frames[0], 0, -1, fps=5 if len(frames) > 1 else 0)
  else:
    glows = [{'dx': 10, 'dy': 9, 'radius': 2.2, 'colour': '#ffdc96', 'flicker': False}] if lit else []
    piece = _wall(frames[0], 0, -1)
  return Made([piece], foot=(1, 1), solid=[], glows=glows)


# --- Garland -------------------------------------------------------------------------------------------------

@item('garland', 'decor', 'A swag of greenery with flowers looped along a wall (put `at` on wall row 1); 1-6 tiles '
      'long.', foot=(3, 1), scene='wall',
      variants=[{'length': 4, 'colours': ['white', 'pink'], 'ribbon': 'gold'},
                {'length': 2, 'colours': ['red', 'gold'], 'seed': 3}],
      length=Param('int', 3, 1, 6, doc='tiles long'),
      colours=Param('colours', ['red', 'yellow', 'white'], doc='flower colours'),
      ribbon=Param('colour', 'crimson', doc='bow colour'),
      seed=Param('int', 1, 0, 9999))
def _garland(length, colours, ribbon, seed):
  rng = noise_rng(seed)
  W = length * T
  H = 20
  img = new(W, H)
  # Swags of greenery (about two tiles each) pinned at the ends, sagging in the middle.
  n = max(1, round(length / 2))
  span = (W - 4) / n
  depth = max(3.0, span / 5.5)
  centre = {}
  for x in range(2, W - 2):
    u = ((x - 2) % span) / span
    centre[x] = 3.5 + depth * math.sin(math.pi * u)
  mask = set()
  for x, cy in centre.items():
    for y in range(int(cy) - 2, int(cy) + 3):
      if abs(y + 0.5 - cy) <= 1.6 + (0.6 if (x * 7 + y * 3) % 5 == 0 else 0):
        mask.add((x, y))
  green = new(W, H)
  for (x, y) in mask:
    d = y + 0.5 - centre[x]
    j = rng.random()
    c = LEAF_LIGHT if d < -0.8 and j < 0.7 else LEAF if d < 0.2 else LEAF_MID if d < 1.0 or j < 0.3 else LEAF_DEEP
    put(green, x, y, c)
  for x in range(3, W - 3, 3):  # little leaf tips poking out of the rope
    cy = centre[x]
    if rng.random() < 0.7:
      put(green, x + rng.choice((0, 1)), int(cy) - 2, LEAF_LIGHT)
    if rng.random() < 0.5:
      put(green, x + 1, int(cy) + 2, LEAF_MID)
  img.alpha_composite(outlined(green, soft=True))
  cols = [to_rgba(c) for c in colours]
  for k, x in enumerate(range(6, W - 4, 6)):
    c = cols[k % len(cols)]
    ch, cb, cl, cd = tones(c)
    y = int(round(centre[x]))
    _bitmap(img, x - 1, y - 1, ['.b.', 'bcl', '.l.'], {'b': cb, 'l': cl, 'c': (255, 230, 120, 255) if k % 2 == 0
                                                     else ch})
  # Ribbon bows where the swags are pinned.
  rh, rb, rl, rd = tones(ribbon)
  bows = new(W, H)
  pins = [2 + round(i * span) for i in range(n + 1)]
  for px in pins:
    bx = min(max(3, px), W - 4)
    _bitmap(bows, bx - 2, 1, ['hb.bl', '.bkb.', 'b.l.l', 'l...l'], {'b': rb, 'h': rh, 'l': rl, 'k': rd})
  img.alpha_composite(outlined(bows))
  return Made([_wall(img, 0, 0)], foot=(length, 1), solid=[])


# --- Curtains ------------------------------------------------------------------------------------------------

@item('curtains', 'decor', 'Floor-length drapes on a rod for a wall (put `at` on wall row 1), tied back or closed, '
      'with a scalloped valance; 1-4 tiles wide. Frame a window or a stage.', foot=(2, 1), scene='wall',
      variants=[{'width': 3, 'colour': 'navy'}, {'width': 2, 'closed': True, 'colour': 'forest'}],
      width=Param('int', 2, 1, 4, doc='tiles wide'),
      colour=Param('colour', 'crimson'),
      closed=Param('bool', False, doc='drawn shut'),
      tie=Param('colour', 'gold', doc='tieback and trim colour'))
def _curtains(width, colour, closed, tie):
  W = width * T
  img = new(W + 4, 32)
  h = 28
  if closed:
    half = (W + 2) // 2
    left = _drape(h, half, half, h - 1, colour, folds=max(2, half // 4), w_bottom=half)
    paste(img, left, 1, 1)
    paste(img, flip(left), img.width - left.width - 1, 1)
  else:
    dw = min(9, max(5, W // 3))
    left = _drape(h, dw, max(3, dw // 2), int(h * 0.55), colour, folds=2, tie=tie, w_bottom=dw)
    paste(img, left, 1, 1)
    paste(img, flip(left), img.width - left.width - 1, 1)
  # Valance: a scalloped pelmet across the top, trimmed in the tie colour.
  hi, base, lo, deep = tones(colour)
  th, tb, tl, td = tones(tie)
  val = new(W + 4, 9)
  rect(val, 1, 1, W + 2, 3, base)
  hline(val, 1, 1, W + 2, hi)
  for x in range(1, W + 3):
    u = ((x - 1) % 8) / 8
    drop = int(round(2.5 * math.sin(math.pi * u)))
    vline(val, x, 4, drop, base if drop < 2 else lo)
    put(val, x, 4 + drop, tb)
  img.alpha_composite(outlined(val), (0, 0))
  return Made([_wall(img, -2, 0)], foot=(width, 1), solid=[])
