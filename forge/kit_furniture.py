"""Kit family: furniture items for Möbius Town builders (registered on import by kit.py).

Conventions (see kit.py's docstring for the full contract):
- `@item(name, 'furniture', doc, foot=(w, h), variants=[...], **params)`; the function returns `Made`.
- Draw in the town's palette with kit's helpers (tones, outlined, block, post, foliage, pixel_text ...),
  dark plum outline OUT (OUT_SOFT for foliage), light from the upper left, 2-4 flat shades, no
  anti-aliasing, soft SHADOW ellipse under standing things, 3/4 top-down view.
- Deterministic: randomness only from noise_rng(seed).

Seating follows the town's chair convention (tools/props.chair_parts, build_world.seat): a sitter's
feet are at (ax, ay) (default: tile centre, 12 px down) and they sort at ay. Facing down, the
backrest is drawn first (z=0) and the seat under the sitter (z=1); facing up, the seat is under the
sitter (z=1) and the backrest is a lower piece (dy ~ 9) at z=16 that covers their legs; facing
left/right, back z=0 and seat z=1.
"""
from __future__ import annotations

import math

from kit import *  # noqa: F401,F403
from kit import (  # noqa: F401
  BARK, BARK_LIGHT, CREAM, LEAVES, Made, OUT, OUT_SOFT, Param, Piece, T, WHITE, disc_mask, drop_shadow, ellipse,
  flip, hline, item, line, mix, new, noise_rng, outline, outlined, props, put, recolor, rect, shade, standing,
  to_rgba, tones, tufts, vline,
)

FACING = ('down', 'up', 'left', 'right')
WOOD_HEX = '#a87848'
METAL = (72, 70, 84, 255)
METAL_HI = (126, 124, 142, 255)
METAL_LO = (50, 46, 60, 255)
SOIL = (74, 50, 46, 255)


# --- Private helpers -----------------------------------------------------------------------------

class _ColourOrNone(Param):
  """A colour parameter that may also be left out or given as 'none' (e.g. a table without a cloth)."""

  def check(self, name, value):
    if isinstance(value, str) and value.strip().lower() in ('none', 'no', 'off', ''):
      return None
    return super().check(name, value)


def _ramp(c):
  """(hi, top, base, lo, deep): tones() plus a lit 'top' shade for horizontal surfaces."""
  hi, base, lo, deep = tones(c)
  return hi, mix(base, hi, 0.5), base, lo, deep


def _finish(img, shadow=None):
  """Outline what was drawn (OUT) and lay it over a soft ground shadow (cx, cy, rx, ry)."""
  out = new(img.width, img.height)
  if shadow:
    cx, cy, rx, ry = shadow
    drop_shadow(out, cx, cy, rx, ry)
  out.alpha_composite(outlined(img))
  return out


def _grain(img, x, y, w, h, c, seed, n):
  """A few short wood-grain dashes inside a rectangle."""
  rng = noise_rng(seed)
  for _ in range(n):
    gx = x + rng.randrange(max(1, w - 3))
    gy = y + rng.randrange(max(1, h))
    hline(img, gx, gy, rng.choice((2, 3, 3, 4)), c)


def _spans(L):
  """Post/leg x positions (left px of a 3 px post) for a bench or table L tiles long."""
  W = L * T
  xs = [3, W - 6]
  n = 1 if L <= 3 else 2
  for k in range(1, n):
    xs.append(round(3 + (W - 9) * k / n))
  return sorted(xs)


# --- Bench -----------------------------------------------------------------------------------------

def _bench_down(L, c):
  hi, top, base, lo, deep = _ramp(c)
  W = L * T
  img = new(W, 30)  # row r = footprint y (r - 12)
  xs = _spans(L)
  for x in xs:  # backrest posts, behind the slats
    rect(img, x, 1, 3, 12, lo)
    vline(img, x, 1, 12, base)
  for y in (1, 6):  # two backrest slats
    rect(img, 1, y, W - 2, 3, base)
    hline(img, 1, y, W - 2, hi)
    hline(img, 1, y + 2, W - 2, lo)
  _grain(img, 3, 2, W - 6, 1, lo, L * 7 + 1, L)
  # Seat: three slats seen from above.
  rect(img, 1, 12, W - 2, 7, top)
  hline(img, 1, 12, W - 2, base)
  hline(img, 1, 15, W - 2, base)
  hline(img, 1, 18, W - 2, base)
  _grain(img, 3, 13, W - 6, 5, base, L * 7 + 2, L + 1)
  # Front rail and legs.
  rect(img, 1, 19, W - 2, 3, base)
  hline(img, 1, 19, W - 2, hi)
  hline(img, 1, 21, W - 2, lo)
  for x in xs:
    rect(img, x, 22, 3, 6, deep)
    vline(img, x, 22, 6, lo)
  return _finish(img, (W / 2 + 1.5, 27.5, W / 2 - 1, 2.2))


def _bench_up(L, c):
  """Bench facing up: (seat at dy 0, under the sitters; backrest at dy 8, over their legs)."""
  hi, top, base, lo, deep = _ramp(c)
  W = L * T
  seat = new(W, 12)  # dy 0: the seat, seen past the backrest
  rect(seat, 1, 1, W - 2, 9, top)
  hline(seat, 1, 1, W - 2, hi)
  hline(seat, 1, 4, W - 2, base)
  hline(seat, 1, 7, W - 2, base)
  _grain(seat, 3, 2, W - 6, 4, base, L * 7 + 2, L + 1)
  back = new(W, 13)  # dy 8: the backrest seen from behind, over the sitters' legs
  xs = _spans(L)
  for y in (1, 5):
    rect(back, 1, y, W - 2, 3, base)
    hline(back, 1, y, W - 2, hi)
    hline(back, 1, y + 2, W - 2, lo)
  for x in xs:  # posts in front of the slats (seen from behind), down to the ground
    rect(back, x, 0, 3, 11, lo)
    vline(back, x, 0, 11, base)
    put(back, x + 1, 0, hi)
  return _finish(seat), _finish(back, (W / 2 + 1.5, 10.5, W / 2 - 1, 2))


@item('bench', 'furniture',
      'Wooden park bench, one seat per tile; facing down, or up (backrest in front, like audience rows).',
      (3, 1), variants=[{'length': 2, 'colour': 'forest'}, {'length': 4, 'facing': 'up'}],
      length=Param('int', 3, 2, 6, doc='tiles long'), colour=Param('colour', WOOD_HEX, doc='wood or paint colour'),
      facing=Param('enum', 'down', choices=('down', 'up'), doc='the way sitters face'))
def _bench(length, colour, facing):
  if facing == 'down':
    pieces = [Piece(_bench_down(length, colour), dx=0, dy=-12, z=0)]
  else:
    seat, back = _bench_up(length, colour)
    pieces = [Piece(seat, dx=0, dy=0, z=1), Piece(back, dx=0, dy=8, z=16)]
  seats = [{'dx': i, 'dy': 0, 'face': facing} for i in range(length)]
  return Made(pieces, foot=(length, 1), solid=[], seats=seats)


# --- Chair -------------------------------------------------------------------------------------------

def _chair_parts(c, facing):
  """(seat, back) 16x16 images laid out like props.chair_parts."""
  hi, top, base, lo, deep = _ramp(c)
  seat, back = new(16, 16), new(16, 16)
  if facing == 'down':
    # Back (placed 6 px up): a crest rail, two posts and a splat.
    for x in (2, 12):
      rect(back, x, 3, 2, 9, base)
      vline(back, x, 3, 9, hi if x == 2 else base)
      vline(back, x + 1, 3, 9, lo)
    rect(back, 6, 4, 4, 6, base)
    vline(back, 6, 4, 6, hi)
    vline(back, 9, 4, 6, lo)
    rect(back, 2, 0, 12, 4, base)
    hline(back, 3, 0, 10, hi)
    put(back, 2, 1, hi)
    hline(back, 2, 3, 12, lo)
  seat_top = 5
  if facing in ('down', 'up'):
    rect(seat, 2, seat_top, 12, 5, top)
    hline(seat, 2, seat_top, 12, base if facing == 'down' else hi)
    hline(seat, 3, seat_top + 1, 5, hi)
    rect(seat, 2, seat_top + 5, 12, 2, base)
    hline(seat, 2, seat_top + 6, 12, lo)
    for x in (3, 11):
      rect(seat, x, 12, 2, 3, deep)
  if facing == 'up':
    # Back (placed 9 px down, over the sitter): the crest rail from behind, posts with a gap
    # between them (the seat shows through), and the back legs.
    rect(back, 2, 0, 12, 3, base)
    hline(back, 3, 0, 10, hi)
    put(back, 2, 1, hi)
    hline(back, 2, 2, 12, lo)
    for x in (2, 12):
      rect(back, x, 3, 2, 4, base)
      put(back, x, 3, hi if x == 2 else base)
      vline(back, x + 1, 3, 4, lo)
    rect(back, 7, 3, 2, 2, lo)
    return _finish(seat), _finish(back, (8, 6.5, 6, 1.5))
  if facing in ('left', 'right'):
    # Seen from the side; drawn facing right (backrest on the left), mirrored for left.
    rect(back, 2, 0, 3, 13, base)
    vline(back, 2, 0, 13, hi)
    vline(back, 4, 1, 12, lo)
    hline(back, 2, 0, 3, hi)
    rect(seat, 2, 5, 12, 4, top)
    hline(seat, 2, 5, 12, hi)
    rect(seat, 2, 9, 12, 2, base)
    hline(seat, 2, 10, 12, lo)
    for x in (2, 12):
      rect(seat, x, 11, 2, 3, deep)
    seat, back = _finish(seat, (8, 14, 6, 1.5)), _finish(back)
    if facing == 'left':
      seat, back = flip(seat), flip(back)
    return seat, back
  return _finish(seat, (8, 14.5, 6, 1.5)), _finish(back)


def _chair_pieces(seat, back, facing):
  if facing == 'down':
    return [Piece(back, dx=0, dy=-6, z=0), Piece(seat, dx=0, dy=0, z=1)]
  if facing == 'up':
    return [Piece(seat, dx=0, dy=0, z=1), Piece(back, dx=0, dy=9, z=16)]
  return [Piece(back, dx=0, dy=-2, z=0), Piece(seat, dx=0, dy=1, z=1)]


@item('chair', 'furniture', 'Wooden chair with one seat; facing is the way the sitter looks (put it beside a table).',
      (1, 1), variants=[{'facing': 'up', 'colour': 'navy'}, {'facing': 'right', 'colour': 'forest'}],
      facing=Param('enum', 'down', choices=FACING, doc='the way the sitter faces'),
      colour=Param('colour', WOOD_HEX, doc='wood or paint colour'))
def _chair(facing, colour):
  seat, back = _chair_parts(colour, facing)
  return Made(_chair_pieces(seat, back, facing), foot=(1, 1), solid=[],
              seats=[{'dx': 0, 'dy': 0, 'face': facing}])


# --- Tables ----------------------------------------------------------------------------------------

def _cloth_tones(cloth):
  hi, base, lo, deep = tones(cloth)
  return mix(hi, WHITE, 0.25), mix(base, hi, 0.6), base, lo, deep


def _lit_ellipse(img, cx, cy, rx, ry, top, hi):
  """A flat elliptical top with a highlight along its upper-left rim."""
  m = disc_mask(img.width, img.height, cx, cy, rx, ry)
  for (x, y) in m:
    put(img, x, y, top)
  for (x, y) in m:
    if ((x - 1, y) not in m or (x, y - 1) not in m) and (x + 0.5 - cx) / rx + (y + 0.5 - cy) / ry < 0.2:
      put(img, x, y, hi)
  return m


def _round_table(c, cloth=None, w=22):
  """Pedestal café table about 22 px across (23 px tall image, floor line at row 20)."""
  hi, top, base, lo, deep = _ramp(c)
  h = 23
  img = new(w, h)
  cx = w / 2
  rx, ry, cy = w / 2 - 1, 4.6, 6.0
  # Pedestal and foot.
  rect(img, int(cx) - 1, 9, 2, 10, lo)
  vline(img, int(cx) - 1, 9, 10, base)
  ellipse(img, cx, 19.5, 4.5, 1.6, deep)
  hline(img, int(cx) - 3, 19, 6, lo)
  if cloth is None:
    ellipse(img, cx, cy + 1.6, rx, ry, lo)  # the rim's thickness
    _lit_ellipse(img, cx, cy, rx, ry, top, hi)
    hline(img, int(cx) + 1, int(cy) + 1, 4, base)  # a little wood grain
    hline(img, int(cx) - 5, int(cy) - 1, 3, base)
    return _finish(img, (cx + 1, 20.5, 7, 1.8))
  chi, ctop, cbase, clo, cdeep = _cloth_tones(cloth)
  # The cloth falls from the top's rim to a hem 6 px lower, flaring a little: folds, shaded to the right.
  drop = 6
  for x in range(w):
    u = (x + 0.5 - cx) / (rx + 1)
    if abs(u) >= 1:
      continue
    y_hem = cy + drop + (ry + 0.6) * math.sqrt(1 - u * u) + (1 if x % 3 == 1 else 0)
    for y in range(int(cy), int(y_hem)):
      c = cbase if u < 0.35 else clo
      if x % 3 == 0 and y > cy + ry * math.sqrt(1 - u * u) + 1:
        c = clo if u < 0.35 else cdeep
      put(img, x, y, c)
    put(img, x, int(y_hem), cdeep if u > 0.35 else clo)
  m = _lit_ellipse(img, cx, cy, rx, ry, ctop, chi)
  for (x, y) in m:  # where the cloth bends over the edge
    if (x, y + 1) not in m and (x + 0.5 - cx) / rx > -0.8:
      put(img, x, y, cbase)
  return _finish(img, (cx + 1, 20.5, 7.5, 1.8))


def _rect_table(L, c, cloth=None):
  """A square (L=1, 20 px) or long table (16L + 2 px): lit top, front apron and legs."""
  hi, top, base, lo, deep = _ramp(c)
  W = L * T + (4 if L == 1 else 2)
  h = 23
  img = new(W, h)  # row r = footprint y (r - 7)
  spans = 1 if L <= 2 else L - 1  # middle legs for long tables
  legs = [3, W - 5] + [round(3 + (W - 8) * k / spans) for k in range(1, spans)]
  for x in legs:
    rect(img, x, 11, 2, 9, deep)
    put(img, x, 11, lo)
  if cloth is None:
    rect(img, 1, 1, W - 2, 9, top)
    hline(img, 2, 1, W - 4, hi)
    vline(img, 1, 2, 8, hi)
    vline(img, W - 2, 2, 8, base)
    _grain(img, 3, 3, W - 6, 6, base, L * 13 + 5, L + 1)
    rect(img, 1, 10, W - 2, 3, base)
    hline(img, 1, 10, W - 2, lo)
    hline(img, 1, 12, W - 2, deep)
    return _finish(img, (W / 2 + 1, 20.5, W / 2 - 1, 2))
  chi, ctop, cbase, clo, cdeep = _cloth_tones(cloth)
  rect(img, 1, 1, W - 2, 9, ctop)
  hline(img, 2, 1, W - 4, chi)
  vline(img, 1, 2, 8, chi)
  # The drape over the front edge: folds, corners hanging lower, shaded to the right.
  for x in range(0, W):
    hem = 16 if x < 2 or x >= W - 2 else 15 if x < 4 or x >= W - 4 else 14
    hem += 1 if x % 4 == 2 else 0
    shadowed = x >= W - max(4, W // 4)
    for y in range(10, hem):
      cc = clo if shadowed else cbase
      if x % 4 == 0 and y >= 11:
        cc = cdeep if shadowed else clo
      put(img, x, y, cc)
    put(img, x, hem, cdeep if shadowed else clo)
  vline(img, 0, 2, 8, cbase)
  vline(img, W - 1, 2, 8, clo)
  hline(img, 1, 10, W - 2, chi)
  return _finish(img, (W / 2 + 1, 20.5, W / 2 - 1, 2))


@item('table', 'furniture',
      'Table: round café table, square table, or a long table (1-4 tiles); optional tablecloth. Solid.',
      (1, 1), variants=[{'shape': 'long', 'length': 3, 'cloth': 'white'}, {'shape': 'round', 'cloth': 'red'},
                        {'shape': 'square', 'cloth': 'sky'}],
      shape=Param('enum', 'round', choices=('round', 'square', 'long'), doc='table shape'),
      length=Param('int', 2, 1, 4, doc='tiles long (long tables only)'),
      cloth=_ColourOrNone('colour', None, doc='tablecloth colour, or none'),
      colour=Param('colour', WOOD_HEX, doc='wood colour'))
def _table(shape, length, cloth, colour):
  if shape == 'round':
    img = _round_table(colour, cloth)
    return Made([Piece(img, dx=(T - img.width) // 2, dy=T + 1 - img.height)], foot=(1, 1))
  L = length if shape == 'long' else 1
  img = _rect_table(L, colour, cloth)
  return Made([Piece(img, dx=(L * T - img.width) // 2, dy=-7)], foot=(L, 1))


# --- Picnic table ----------------------------------------------------------------------------------

def _plank_top(img, x, y, w, h, c, seed, boards=3):
  hi, top, base, lo, deep = _ramp(c)
  rect(img, x, y, w, h, top)
  hline(img, x, y, w, hi)
  for k in range(1, boards):
    hline(img, x, y + round(k * h / boards), w, base)
  _grain(img, x + 2, y + 1, w - 4, h - 2, base, seed, max(2, w // 12))


@item('picnic_table', 'furniture',
      'Outdoor picnic table, length x 3 tiles (bench, table, bench); seats on both benches face the table.',
      (2, 3), scene='grass', variants=[{'length': 3, 'colour': '#b88a5a'}],
      length=Param('int', 2, 2, 4, doc='tiles long'), colour=Param('colour', WOOD_HEX, doc='wood colour'))
def _picnic_table(length, colour):
  hi, top, base, lo, deep = _ramp(colour)
  L = length
  W = L * T
  xs = _spans(L)
  # North bench (row 0), under its sitters; its legs show between it and the table.
  nb = new(W, 16)
  _plank_top(nb, 1, 2, W - 2, 4, colour, 3, boards=2)
  rect(nb, 1, 6, W - 2, 2, base)
  hline(nb, 1, 7, W - 2, lo)
  for x in xs:
    rect(nb, x, 8, 3, 4, deep)
    put(nb, x, 8, lo)
  nb = _finish(nb, (W / 2 + 1, 11.5, W / 2 - 1, 1.6))
  # The table (row 1), drawn over the north sitters' laps.
  tb = new(W, 22)  # dy 11
  for x in xs:  # A-frame legs splaying out
    rect(tb, x, 14, 3, 6, deep)
    vline(tb, x, 14, 6, lo)
    put(tb, x - 1 if x < W / 2 else x + 3, 19, deep)
  _plank_top(tb, 1, 1, W - 2, 11, colour, 5, boards=4)
  vline(tb, 1, 1, 11, hi)
  rect(tb, 1, 12, W - 2, 3, base)
  hline(tb, 1, 14, W - 2, lo)
  tb = _finish(tb, (W / 2 + 1, 19.5, W / 2, 2.2))
  tufts(tb, xs[0] + 1, 19, 1, seed=L)
  tufts(tb, xs[-1] + 1, 19, 1, seed=L + 9)
  # South bench (row 2), under its sitters.
  sb = new(W, 16)  # dy 32
  _plank_top(sb, 1, 2, W - 2, 5, colour, 4, boards=2)
  rect(sb, 1, 7, W - 2, 2, base)
  hline(sb, 1, 8, W - 2, lo)
  for x in xs:
    rect(sb, x, 9, 3, 5, deep)
    vline(sb, x, 9, 5, lo)
  sb = _finish(sb, (W / 2 + 1, 13.5, W / 2 - 1, 1.8))
  tufts(sb, xs[0] + 1, 14, 1, seed=L + 3)
  pieces = [Piece(nb, dx=0, dy=0, z=1), Piece(tb, dx=0, dy=11, z=32), Piece(sb, dx=0, dy=32, z=33)]
  seats = [{'dx': i, 'dy': 0, 'face': 'down'} for i in range(L)] + [{'dx': i, 'dy': 2, 'face': 'up'} for i in range(L)]
  return Made(pieces, foot=(L, 3), solid=[(i, 1) for i in range(L)], seats=seats)


# --- Sofa and armchair -----------------------------------------------------------------------------

def _sofa_down(L, c, arm=5, back_h=12):
  """Sofa facing down: backrest, cushions, arms. Image is 16L + 4 wide (dx -2), row r = y (r - 11)."""
  hi, top, base, lo, deep = _ramp(c)
  W = L * T
  CW = W + 4
  img = new(CW, 27)
  # Backrest.
  rect(img, 2, 2, W, back_h, base)
  hline(img, 3, 1, W - 2, hi)
  hline(img, 2, 2, W, hi)
  for k in range(1, L):
    vline(img, 2 + k * T, 3, back_h - 4, lo)
  hline(img, 2, 1 + back_h, W, lo)
  # Seat cushions.
  for k in range(L):
    x0 = 2 + k * T
    rect(img, x0, 12, T, 6, top)
    hline(img, x0, 12, T, hi)
    vline(img, x0, 12, 6, lo if k else top)
    rect(img, x0, 18, T, 2, base)
  # Base and feet.
  rect(img, 2, 20, W, 3, lo)
  hline(img, 2, 22, W, deep)
  wood = tones('#6a4a3a')
  for x in (3, CW - 5):
    rect(img, x, 23, 2, 2, wood[2])
  # Arms.
  for ax in (0, CW - arm):
    rect(img, ax, 6, arm, 17, base)
    hline(img, ax + 1, 6, arm - 2, hi)
    rect(img, ax, 7, arm, 3, top)
    hline(img, ax, 10, arm, lo)
    vline(img, ax, 7, 15, hi if ax == 0 else base)
    vline(img, ax + arm - 1, 7, 15, lo)
    hline(img, ax, 22, arm, deep)
  return _finish(img, (CW / 2, 24.5, W / 2, 2))


def _sofa_up(L, c, arm=5, rise=0):
  """Sofa facing up: (seat image at dy 0, back image at dy 5 - rise drawn over the sitters), 16L + 4 wide.

  `rise` makes the backrest taller (an armchair's high back), with rounded top corners.
  """
  hi, top, base, lo, deep = _ramp(c)
  W = L * T
  CW = W + 4
  seat = new(CW, 14)
  for k in range(L):
    x0 = 2 + k * T
    rect(seat, x0, 2, T, 7, top)
    hline(seat, x0, 2, T, hi)
    vline(seat, x0, 2, 7, lo if k else top)
  for ax in (0, CW - arm):  # arm tops, seen from behind
    rect(seat, ax, 0, arm, 12, top)
    hline(seat, ax + 1, 0, arm - 2, hi)
    vline(seat, ax, 0, 12, hi if ax == 0 else top)
    vline(seat, ax + arm - 1, 0, 12, lo)
  back = new(CW, 14 + rise)
  r = rise
  rect(back, 2, 1, W, 10 + r, base)
  if r:
    for (x, y) in ((2, 1), (3, 1), (2, 2), (W + 1, 1), (W, 1), (W + 1, 2)):
      put(back, x, y, (0, 0, 0, 0))
  hline(back, 4 if r else 2, 1, W - (4 if r else 0), hi)
  vline(back, 2, 3 if r else 1, 6 + r, hi if r else base)
  for k in range(1, L):  # seams between the back cushions
    vline(back, 2 + k * T, 3, 4 + r, lo)
  rect(back, 2, 8 + r, W, 3, lo)
  hline(back, 2, 10 + r, W, deep)
  for ax in (0, CW - arm):
    rect(back, ax, 3 + r, arm, 8, base)
    hline(back, ax, 3 + r, arm, hi)
    vline(back, ax + arm - 1, 3 + r, 8, lo)
    rect(back, ax, 8 + r, arm, 3, lo)
    hline(back, ax, 10 + r, arm, deep)
  wood = tones('#6a4a3a')
  for x in (3, CW - 5):
    rect(back, x, 11 + r, 2, 2, wood[2])
  return _finish(seat), _finish(back, (CW / 2, 12.5 + r, W / 2, 2))


def _sofa_side(L, c, back_rise=10, arm_face=5):
  """Sofa facing right (backrest on the left), L tiles tall.

  Returns (body, body_dy, arm, arm_dy): the body (backrest, north arm, cushions) sorts behind the
  sitters; the south arm sorts in front of the last one. Both are 20 px wide at dx -2.
  """
  hi, top, base, lo, deep = _ramp(c)
  H = L * T
  wood = tones('#6a4a3a')
  top_y = -back_rise  # footprint y of the backrest's north end
  body_dy = top_y - 1
  bh = H - 4 - body_dy + 1
  body = new(20, bh)  # row r = y (r + body_dy); col c = x (c - 2)

  def Y(y):
    return y - body_dy

  # North arm: lit top, then its face toward the seat.
  rect(body, 2, Y(-6), 16, 3, top)
  hline(body, 2, Y(-6), 16, hi)
  rect(body, 2, Y(-3), 16, arm_face, base)
  hline(body, 2, Y(-3) + arm_face - 1, 16, lo)
  vline(body, 17, Y(-6), 3 + arm_face, lo)
  # Cushions, one per row, each with a lit front edge and a seam.
  for k in range(L):
    y0 = max(k * T, -3 + arm_face)
    y1 = (k + 1) * T - (5 if k == L - 1 else 0)
    rect(body, 7, Y(y0), 10, y1 - y0, top)
    hline(body, 7, Y(y0), 10, hi)
    if k < L - 1:
      hline(body, 7, Y(y1 - 1), 10, lo)
    vline(body, 16, Y(y0), y1 - y0, base)
  rect(body, 17, Y(-3 + arm_face), 1, H - 4 - (-3 + arm_face), lo)  # the seat's side
  # Backrest along the west side: a tall slab with a lit top strip.
  rect(body, 2, Y(top_y), 5, H - 4 - top_y, base)
  rect(body, 2, Y(top_y), 3, H - 4 - top_y, top)
  vline(body, 2, Y(top_y), H - 4 - top_y, hi)
  hline(body, 2, Y(top_y), 4, hi)
  vline(body, 6, Y(top_y) + 1, H - 5 - top_y, lo)
  body = _finish(body)
  # South arm, in front of the last sitter.
  arm = new(20, 4 + arm_face + 3)  # row r = y (r + H - 7)
  rect(arm, 2, 1, 16, 3, top)
  hline(arm, 2, 1, 16, hi)
  rect(arm, 2, 4, 16, arm_face, base)
  vline(arm, 2, 4, arm_face, top)
  hline(arm, 2, 3 + arm_face, 16, lo)
  vline(arm, 17, 1, 3 + arm_face, lo)
  rect(arm, 3, 4 + arm_face, 2, 1, wood[2])
  rect(arm, 15, 4 + arm_face, 2, 1, wood[2])
  arm = _finish(arm, (10, 4.5 + arm_face, 8, 1.5))
  return body, body_dy, arm, H - 7


@item('sofa', 'furniture',
      'Upholstered sofa with backrest and arms, one seat per tile; facing is the way sitters look '
      '(left/right sofas run north-south).',
      (2, 1), variants=[{'length': 3, 'facing': 'up', 'colour': 'navy'}, {'facing': 'right', 'colour': 'teal'}],
      facing=Param('enum', 'down', choices=FACING, doc='the way sitters face'),
      colour=Param('colour', '#b04858', doc='upholstery colour'),
      length=Param('int', 2, 2, 4, doc='seats (tiles)'))
def _sofa(facing, colour, length):
  L = length
  if facing == 'down':
    pieces = [Piece(_sofa_down(L, colour), dx=-2, dy=-11, z=1)]
    foot = (L, 1)
  elif facing == 'up':
    seat, back = _sofa_up(L, colour)
    pieces = [Piece(seat, dx=-2, dy=0, z=1), Piece(back, dx=-2, dy=5, z=16)]
    foot = (L, 1)
  else:
    body, body_dy, arm, arm_dy = _sofa_side(L, colour)
    if facing == 'left':
      body, arm = flip(body), flip(arm)
    pieces = [Piece(body, dx=-2, dy=body_dy, z=1), Piece(arm, dx=-2, dy=arm_dy, z=L * T)]
    foot = (1, L)
  seats = [{'dx': i if foot[0] > 1 else 0, 'dy': 0 if foot[0] > 1 else i, 'face': facing} for i in range(L)]
  return Made(pieces, foot=foot, solid=[], seats=seats)


@item('armchair', 'furniture', 'Chunky upholstered armchair with one seat; facing is the way the sitter looks.',
      (1, 1), variants=[{'facing': 'up', 'colour': 'mint'}, {'facing': 'left', 'colour': 'purple'}],
      facing=Param('enum', 'down', choices=FACING, doc='the way the sitter faces'),
      colour=Param('colour', '#5c8c60', doc='upholstery colour'))
def _armchair(facing, colour):
  if facing == 'down':
    img = _sofa_down(1, colour, arm=6, back_h=13)
    pieces = [Piece(img, dx=-2, dy=-11, z=1)]
  elif facing == 'up':
    seat, back = _sofa_up(1, colour, arm=6, rise=4)
    pieces = [Piece(seat, dx=-2, dy=0, z=1), Piece(back, dx=-2, dy=1, z=16)]
  else:
    body, body_dy, arm, arm_dy = _sofa_side(1, colour, back_rise=13, arm_face=6)
    if facing == 'left':
      body, arm = flip(body), flip(arm)
    pieces = [Piece(body, dx=-2, dy=body_dy, z=1), Piece(arm, dx=-2, dy=arm_dy, z=T)]
  return Made(pieces, foot=(1, 1), solid=[], seats=[{'dx': 0, 'dy': 0, 'face': facing}])


# --- Rug ---------------------------------------------------------------------------------------------

def _rug_img(w, h, c, pattern):
  hi, base, lo, deep = tones(c)
  W, H = w * T, h * T
  img = new(W, H)
  accent = mix(CREAM, hi, 0.25)
  long_x = W >= H
  # Body inset to leave room for fringes on the short ends.
  x0, y0, x1, y1 = (3, 1, W - 3, H - 1) if long_x else (1, 3, W - 1, H - 3)
  bw, bh = x1 - x0, y1 - y0
  rect(img, x0, y0, bw, bh, base)
  if pattern == 'plain':
    if bw > 6 and bh > 6:
      for xx in range(x0 + 2, x1 - 2):
        put(img, xx, y0 + 2, lo)
        put(img, xx, y1 - 3, lo)
      for yy in range(y0 + 2, y1 - 2):
        put(img, x0 + 2, yy, lo)
        put(img, x1 - 3, yy, lo)
  elif pattern == 'border':
    rect(img, x0 + 2, y0 + 2, bw - 4, bh - 4, accent)
    rect(img, x0 + 3, y0 + 3, bw - 6, bh - 6, base)
    if bw > 12 and bh > 12:
      rect(img, x0 + 5, y0 + 5, bw - 10, bh - 10, lo)
      rect(img, x0 + 6, y0 + 6, bw - 12, bh - 12, base)
      cx, cy = x0 + bw // 2, y0 + bh // 2
      for d in range(3):
        hline(img, cx - 2 + d, cy - d, 4 - 2 * d + 1, accent)
        hline(img, cx - 2 + d, cy + d, 4 - 2 * d + 1, accent)
  elif pattern == 'stripes':
    period = 8
    for i in range(0, bw if long_x else bh):
      k = i % period
      colr = accent if k in (2, 3) else (lo if k == 6 else None)
      if colr is None:
        continue
      if long_x:
        vline(img, x0 + i, y0, bh, colr)
      else:
        hline(img, x0, y0 + i, bw, colr)
  elif pattern == 'diamond':
    step = 12
    for yy in range(y0 + 1, y1 - 1):
      for xx in range(x0 + 1, x1 - 1):
        u = (xx - x0 - bw / 2) % step - step / 2
        v = (yy - y0 - bh / 2) % step - step / 2
        d = abs(u) + abs(v)
        if 4.5 <= d < 6:
          put(img, xx, yy, accent)
        elif d < 2:
          put(img, xx, yy, hi)
    rect(img, x0 + 1, y0 + 1, bw - 2, 1, accent)
    rect(img, x0 + 1, y1 - 2, bw - 2, 1, accent)
    rect(img, x0 + 1, y0 + 1, 1, bh - 2, accent)
    rect(img, x1 - 2, y0 + 1, 1, bh - 2, accent)
  # Edge binding.
  hline(img, x0, y0, bw, lo)
  hline(img, x0, y1 - 1, bw, deep)
  vline(img, x0, y0, bh, lo)
  vline(img, x1 - 1, y0, bh, deep)
  # Fringes on the short ends.
  if long_x:
    for yy in range(y0 + 1, y1 - 1, 2):
      hline(img, x0 - 2, yy, 2, accent)
      hline(img, x1, yy, 2, accent)
  else:
    for xx in range(x0 + 1, x1 - 1, 2):
      vline(img, xx, y0 - 2, 2, accent)
      vline(img, xx, y1, 2, accent)
  return img


@item('rug', 'furniture',
      'Flat rug (w x h tiles) with fringed ends; pattern plain, border, stripes or diamond. Walk-over.',
      (3, 2), variants=[{'w': 2, 'h': 3, 'pattern': 'stripes', 'colour': 'teal'},
                        {'w': 4, 'h': 3, 'pattern': 'diamond', 'colour': 'navy'}],
      w=Param('int', 3, 1, 6, doc='tiles wide'), h=Param('int', 2, 1, 6, doc='tiles tall'),
      colour=Param('colour', '#a83c48', doc='main colour'),
      pattern=Param('enum', 'border', choices=('plain', 'border', 'stripes', 'diamond'), doc='weave'))
def _rug(w, h, colour, pattern):
  return Made([Piece(_rug_img(w, h, colour, pattern), dx=0, dy=0, z=0, layer='ground')], foot=(w, h), solid=[])


# --- Plants ------------------------------------------------------------------------------------------

POTS = (
  (196, 112, 72, 255),   # terracotta
  (121, 88, 79, 255),    # the pack's clay
  (232, 222, 200, 255),  # cream glaze
  (70, 112, 176, 255),   # blue glaze
  (84, 80, 96, 255),     # charcoal
  (120, 158, 116, 255),  # sage
)
SMALL_PLANTS = ('bush', 'fern', 'snake', 'flower', 'cactus')
TALL_PLANTS = ('palm', 'tree', 'monstera', 'vine')
FLOWER_COLOURS = ((248, 112, 128, 255), (255, 214, 92, 255), (190, 150, 255, 255), (250, 250, 246, 255),
                  (120, 190, 255, 255))


def _draw_pot(img, x, y, w, h, c):
  """A round plant pot (rim with soil at (x, y)), w px wide, h px tall, lit from the left."""
  hi, base, lo, deep = tones(c)
  for r in range(3, h):
    inset = 1 + (1 if r >= h - 2 else 0)
    xx, ww = x + inset, w - 2 * inset
    hline(img, xx, y + r, ww, base)
    put(img, xx, y + r, hi)
    put(img, xx + 1, y + r, mix(hi, base, 0.5))
    hline(img, xx + ww - 2, y + r, 2, lo)
  hline(img, x + 2, y + h - 1, w - 4, deep)
  hline(img, x + 1, y, w - 2, hi)  # rim, seen from above: back lip, soil, front lip
  put(img, x, y + 1, hi)
  hline(img, x + 1, y + 1, w - 2, SOIL)
  put(img, x + w - 1, y + 1, lo)
  hline(img, x, y + 2, w, base)
  put(img, x, y + 2, hi)
  put(img, x + w - 1, y + 2, lo)


def _clumps(w, h, blobs, pal=LEAVES):
  """Overlapping round leaf clumps (drawn back to front), each lit from the upper left; soft outline."""
  light, base, mid, deep = pal
  img = new(w, h)
  for (cx, cy, r) in sorted(blobs, key=lambda b: b[1]):
    m = disc_mask(w, h, cx, cy, r, r * 0.85)
    for (x, y) in m:
      t = ((x + 0.5 - cx) + 1.2 * (y + 0.5 - cy)) / r
      put(img, x, y, light if t < -0.75 else base if t < 0.45 else mid)
    for (x, y) in m:
      if ((x + 1, y) not in m or (x, y + 1) not in m) and (x + 0.5 - cx) + (y + 0.5 - cy) > r * 0.35:
        put(img, x, y, deep)
  return outline(img, OUT_SOFT)


def _flowers(img, spots, colour):
  """Tiny four-petal flowers at (x, y) spots."""
  for (x, y) in spots:
    for (ddx, ddy) in ((0, -1), (-1, 0), (1, 0), (0, 1)):
      put(img, x + ddx, y + ddy, colour)
    put(img, x, y, (255, 236, 150, 255))


def _snake(w, h, cx, base_y, height, rng):
  """Snake plant: upright sword leaves with banded dark green and light margins."""
  img = new(w, h)
  dark, band, edge = (40, 112, 70, 255), (66, 146, 80, 255), (176, 206, 92, 255)
  order = (2, 1, 3, 0, 4)
  for i in order:
    off = (i - 2) * 2.4
    hgt = height * (1.0 if i == 2 else 0.84 if i in (1, 3) else 0.62) * rng.uniform(0.92, 1.0)
    lean = off * 0.45
    for y in range(int(hgt)):
      t = y / hgt
      half = 1.6 if t < 0.6 else 1.1 if t < 0.85 else 0.5
      xc = cx + off + lean * t
      x0, x1 = int(round(xc - half)), int(round(xc + half))
      for x in range(x0, max(x0 + 1, x1)):
        c = band if (y + i) % 4 == 0 else dark
        put(img, x, base_y - y, c)
      put(img, x0, base_y - y, edge)
  return outline(img, OUT_SOFT)


def _cactus(w, h, cx, base_y, rng, flower):
  img = new(w, h)
  light, base, dark = (150, 206, 112, 255), (84, 160, 92, 255), (46, 110, 72, 255)
  bw, bh = 7, 12
  x0, y0 = int(cx - bw / 2), base_y - bh
  rect(img, x0, y0 + 1, bw, bh - 1, base)
  hline(img, x0 + 1, y0, bw - 2, base)
  vline(img, x0 + 1, y0 + 1, bh - 2, light)
  vline(img, x0 + 3, y0 + 1, bh - 1, dark)
  vline(img, x0 + 5, y0 + 1, bh - 1, dark)
  vline(img, x0 + bw - 1, y0 + 1, bh - 1, dark)
  side = 1 if rng.random() < 0.5 else -1
  ax = x0 + (bw if side > 0 else -3)
  rect(img, ax, y0 + 4, 3, 4, base)  # an arm
  vline(img, ax + (2 if side > 0 else 0), y0 + 2, 3, base)
  put(img, ax + 1, y0 + 5, light)
  for (sx, sy) in ((x0 + 2, y0 + 3), (x0 + 4, y0 + 6), (x0 + 2, y0 + 9), (x0 + 6, y0 + 4)):
    put(img, sx, sy, (240, 244, 220, 255))
  img = outline(img, OUT_SOFT)
  if flower:
    _flowers(img, [(int(cx), y0)], (248, 112, 160, 255))
  return img


def _palm(w, h, cx, base_y, rng, height=19):
  """A potted palm: short stems, then arching fronds (tapered ribbons with serrated undersides)."""
  light, base, mid, deep = LEAVES
  stems = new(w, h)
  top_y = base_y - height
  for off in (-3, 0, 3):
    line(stems, cx + off * 0.3, base_y, cx + off, top_y + 1, (60, 128, 68, 255))
  img = outline(stems, OUT_SOFT)
  leaves = new(w, h)
  fronds = [(176, 13), (146, 15), (112, 17), (80, 17), (46, 15), (6, 13)]
  rng.shuffle(fronds)
  fronds.sort(key=lambda f: abs(f[0] - 90), reverse=True)  # drooping side fronds first
  for (deg, length) in fronds:
    a = math.radians(deg + rng.uniform(-5, 5))
    ca, sa = math.cos(a), math.sin(a)
    L = length * rng.uniform(0.9, 1.05)
    droop = 0.3 + 0.55 * abs(ca)
    ox = cx + ca * 2
    steps = int(L * 2.5)
    for s_ in range(steps + 1):
      t = s_ / steps
      x = ox + ca * L * t
      y = top_y - sa * L * t + droop * L * t * t
      ix, iy = int(round(x)), int(round(y))
      th = 3 if t < 0.45 else 2 if t < 0.8 else 1
      for k in range(th):
        c = light if k == 0 and th > 1 and ca < 0.4 else base if k < th - 1 or th == 1 else mid
        put(leaves, ix, iy + k, c)
      if s_ % 3 == 0 and 0.2 < t < 0.9:  # leaflet tips under the frond
        put(leaves, ix, iy + th, mid)
  img.alpha_composite(outline(leaves, OUT_SOFT))
  return img


def _monstera(w, h, cx, base_y, rng):
  """Big split leaves on stems fanning out of the pot."""
  img = new(w, h)
  stems = new(w, h)
  light, base, mid, deep = (98, 210, 84, 255), (52, 160, 72, 255), (38, 120, 64, 255), (36, 82, 58, 255)
  leaves = [(-8, 15, 4.6), (8, 14, 4.6), (-4, 22, 5.2), (5, 23, 5.0), (0, 29, 5.4)]
  rng.shuffle(leaves)
  leaves.sort(key=lambda l: l[1], reverse=True)  # the tallest first: lower leaves overlap them
  for (ox, up, r) in leaves:
    lx, ly = cx + ox, base_y - up
    line(stems, cx + ox * 0.2, base_y, lx, ly + r * 0.6, (70, 140, 60, 255))
    m = disc_mask(w, h, lx, ly, r, r * 0.8)
    for (x, y) in m:
      t = ((x + 0.5 - lx) + (y + 0.5 - ly)) / r
      put(img, x, y, light if t < -0.8 else base if t < 0.4 else mid)
    # Splits: notches from the edge toward the midrib.
    side = 1 if ox >= 0 else -1
    for k in (-1, 1):
      for d in range(2):
        put(img, int(lx + side * (r - 1 - d)), int(ly + k * 1.5), (0, 0, 0, 0))
    line(img, lx - side * r * 0.6, ly - 0.5, lx + side * r * 0.6, ly + 0.5, deep)
  out = outline(stems, OUT_SOFT)
  out.alpha_composite(outline(img, OUT_SOFT))
  return out


def _ficus(w, h, cx, base_y, rng):
  """A little tree: a slender trunk and a round crown of leaf clumps."""
  trunk = new(w, h)
  top = base_y - 26
  for y in range(top + 6, base_y + 1):
    bend = int(round(math.sin((y - top) / 6.0 + rng.uniform(0, 0.4)) * 1.0))
    rect(trunk, int(cx) - 1 + bend, y, 2, 1, BARK)
    put(trunk, int(cx) - 1 + bend, y, BARK_LIGHT)
  line(trunk, cx, base_y - 12, cx - 4, base_y - 17, BARK)
  line(trunk, cx, base_y - 10, cx + 4, base_y - 16, BARK)
  out = outline(trunk, OUT_SOFT)
  blobs = [(cx, top + 6, 6), (cx - 6, top + 9, 4.5), (cx + 6, top + 8, 4.5), (cx - 3, top + 2.5, 4.2),
           (cx + 4, top + 3, 4), (cx - 5, top + 13, 3.6), (cx + 5, top + 12.5, 3.6)]
  blobs = [(x + rng.uniform(-0.7, 0.7), y + rng.uniform(-0.7, 0.7), r) for (x, y, r) in blobs]
  out.alpha_composite(_clumps(w, h, blobs))
  return out


def _vine(w, h, cx, base_y, rng, colour):
  """The pack's tall potted plant: leaf clusters up a stake, with a few flowers."""
  stake = new(w, h)
  vline(stake, int(cx), base_y - 28, 28, (150, 112, 80, 255))
  out = outline(stake, OUT_SOFT)
  blobs = []
  for k in range(6):
    side = -1 if k % 2 == 0 else 1
    blobs.append((cx + side * rng.uniform(2.5, 4.5), base_y - 4 - k * 4.4, rng.uniform(3.0, 3.8)))
  blobs.append((cx, base_y - 30, 3.2))
  leaves = _clumps(w, h, blobs)
  spots = [(int(bx + rng.choice((-1, 0, 1))), int(by - 1)) for (bx, by, _r) in blobs[1::2]]
  _flowers(leaves, spots, colour)
  out.alpha_composite(leaves)
  return out


def _plant_img(seed, size):
  rng = noise_rng(seed * 7919 + (17 if size == 'tall' else 3))
  pot_c = POTS[(seed * 5 + (2 if size == 'tall' else 0)) % len(POTS)]
  flower_c = FLOWER_COLOURS[(seed * 3 + 1) % len(FLOWER_COLOURS)]
  if size == 'small':
    kind = SMALL_PLANTS[seed % len(SMALL_PLANTS)]
    if kind == 'fern':  # the town's own potted fern, in this seed's pot
      img = props.plant_big(seed)
      hi, base, lo, deep = tones(pot_c)
      img = recolor(img, {(196, 112, 72): base, (226, 150, 100): hi, (150, 82, 56): lo})
      out = new(img.width, img.height + 1)
      drop_shadow(out, img.width / 2 + 0.5, img.height - 1.5, 6, 1.6)
      out.alpha_composite(img)
      return out
    w, h = 18, 24
    pot_w, pot_h = 10, 8
    px, py = (w - pot_w) // 2, h - pot_h - 2
    cx = w / 2
    if kind in ('bush', 'flower'):
      blobs = [(cx - 4, py - 1, 3.4), (cx + 4, py - 1, 3.4), (cx, py - 3, 4), (cx - 3, py - 7, 3.4),
               (cx + 3, py - 7, 3.4), (cx, py - 10, 3)]
      blobs = [(x + rng.uniform(-0.6, 0.6), y + rng.uniform(-0.6, 0.6), r) for (x, y, r) in blobs]
      plant = _clumps(w, h, blobs)
      if kind == 'flower':
        _flowers(plant, [(int(cx - 3), py - 8), (int(cx + 3), py - 6), (int(cx), py - 11), (int(cx + 4), py - 1)],
                 flower_c)
    elif kind == 'snake':
      plant = _snake(w, h, cx - 0.5, py + 1, 15, rng)
    else:
      plant = _cactus(w, h, cx, py + 1, rng, flower=seed % 2 == 0)
    sh_r = 5.5
  else:
    kind = TALL_PLANTS[seed % len(TALL_PLANTS)]
    w, h = 28, 44
    pot_w, pot_h = 12, 10
    px, py = (w - pot_w) // 2, h - pot_h - 2
    cx = w / 2
    if kind == 'tree':
      plant = _ficus(w, h, cx, py + 1, rng)
    elif kind == 'palm':
      plant = _palm(w, h, cx, py + 1, rng)
    elif kind == 'monstera':
      plant = _monstera(w, h, cx, py + 1, rng)
    else:
      plant = _vine(w, h, cx, py + 1, rng, flower_c)
    sh_r = 7
  pot = new(w, h)
  _draw_pot(pot, px, py, pot_w, pot_h, pot_c)
  out = new(w, h)
  drop_shadow(out, w / 2 + 0.5, h - 2.5, sh_r, 1.7)
  out.alpha_composite(outlined(pot))
  out.alpha_composite(plant)
  return out


@item('plant', 'furniture',
      'Potted indoor plant: small (fern, bush, snake plant, flowers, cactus) or tall (tree, palm...). Solid.',
      (1, 1), variants=[{'size': 'tall', 'seed': 1}, {'size': 'tall', 'seed': 4}, {'seed': 3}],
      seed=Param('int', 1, 0, 9999, doc='which plant and pot'),
      size=Param('enum', 'small', choices=('small', 'tall'), doc='small pot or tall plant'))
def _plant(seed, size):
  img = _plant_img(seed, size)
  return Made([standing(img, (1, 1), dy=1)], foot=(1, 1))


# --- Bookshelf ---------------------------------------------------------------------------------------

BOOKS = ((196, 64, 64, 255), (60, 110, 190, 255), (70, 160, 90, 255), (230, 190, 70, 255), (140, 90, 180, 255),
         (60, 170, 170, 255), (232, 222, 200, 255), (180, 110, 60, 255), (220, 120, 160, 255), (90, 80, 120, 255))


def _shelf_row(img, x0, x1, y_floor, max_h, rng):
  """Books standing on a shelf between x0..x1 with their bottoms at y_floor."""
  x = x0
  while x < x1:
    r = rng.random()
    if r < 0.08 and x + 4 < x1:  # a gap
      x += rng.randint(2, 3)
      continue
    if r < 0.14 and x + 5 < x1:  # a little vase or box
      c = (rng.choice(((236, 236, 228, 255), (120, 180, 210, 255), (214, 150, 90, 255))))
      vh = rng.randint(3, 4)
      rect(img, x, y_floor - vh, 3, vh, c)
      put(img, x + 2, y_floor - vh, shade(c, 0.8))
      x += 4
      continue
    bw = rng.choice((1, 2, 2, 2, 3))
    bw = min(bw, x1 - x)
    bh = rng.randint(max_h - 2, max_h)
    c = BOOKS[rng.randrange(len(BOOKS))]
    rect(img, x, y_floor - bh, bw, bh, c)
    if bw > 1:
      vline(img, x + bw - 1, y_floor - bh, bh, shade(c, 0.78))
    put(img, x, y_floor - bh, mix(c, WHITE, 0.35))
    if bw >= 2 and bh >= 5:
      put(img, x, y_floor - bh + 2, mix(c, (240, 210, 120, 255), 0.6))
    x += bw
  return img


@item('bookshelf', 'furniture',
      'Tall wooden bookshelf full of colourful books; put it on the floor row just below a wall. Solid.',
      (2, 1), variants=[{'length': 1, 'seed': 3}, {'length': 3, 'colour': '#6a4a3a'}],
      length=Param('int', 2, 1, 3, doc='tiles wide'), colour=Param('colour', WOOD_HEX, doc='wood colour'),
      seed=Param('int', 1, 0, 9999, doc='which books'))
def _bookshelf(length, colour, seed):
  hi, top, base, lo, deep = _ramp(colour)
  W = length * T
  H = 36
  img = new(W, H)  # row r = footprint y (r - 19)
  rect(img, 1, 1, W - 2, H - 3, base)
  rect(img, 1, 1, W - 2, 3, top)
  hline(img, 1, 1, W - 2, hi)
  hline(img, 1, 3, W - 2, lo)
  vline(img, 1, 1, H - 3, hi)
  vline(img, W - 2, 2, H - 4, lo)
  rng = noise_rng(seed * 31 + length)
  shelves = (4, 14, 24)
  inner = new(W, H)
  for y0 in shelves:
    for k in range(length):
      x0 = k * T + 3
      x1 = (k + 1) * T - 3
      rect(img, x0, y0, x1 - x0, 9, deep)
      hline(img, x0, y0, x1 - x0, mix(deep, OUT, 0.4))
      _shelf_row(inner, x0, x1, y0 + 9, 7, rng)
    rect(img, 2, y0 + 9, W - 4, 1, top)
  img.alpha_composite(inner)
  for k in range(1, length):  # dividers between bays
    rect(img, k * T - 1, 4, 2, 29, base)
    vline(img, k * T - 1, 4, 29, hi)
  rect(img, 1, 33, W - 2, 2, lo)
  hline(img, 1, 34, W - 2, deep)
  img = _finish(img)
  return Made([Piece(img, dx=0, dy=T - H + 1)], foot=(length, 1))


# --- Piano -------------------------------------------------------------------------------------------

@item('piano', 'furniture',
      'Upright piano (2x1) with visible keys; bench=true adds a two-seat bench on the row below (foot 2x2). Solid.',
      (2, 1), variants=[{'bench': True}, {'colour': '#f0ece4'}],
      colour=Param('colour', '#4a2c34', doc='case colour'),
      bench=Param('bool', False, doc='add a piano bench (2 seats) on the row in front'))
def _piano(colour, bench):
  hi, top, base, lo, deep = _ramp(colour)
  W, H = 32, 35
  img = new(W, H)  # row r = footprint y (r - 16)
  # Upper case.
  rect(img, 1, 1, W - 2, 16, base)
  rect(img, 1, 1, W - 2, 3, top)
  hline(img, 1, 1, W - 2, hi)
  hline(img, 1, 3, W - 2, lo)
  vline(img, 1, 1, 16, hi)
  vline(img, W - 2, 2, 15, lo)
  rect(img, 5, 6, W - 10, 8, lo)  # front panel
  rect(img, 6, 7, W - 12, 6, base)
  hline(img, 6, 12, W - 12, deep)
  rect(img, 12, 7, 8, 5, (240, 232, 210, 255))  # sheet music
  hline(img, 13, 8, 6, (150, 140, 130, 255))
  hline(img, 13, 10, 5, (150, 140, 130, 255))
  put(img, 15, 9, (60, 50, 60, 255))
  # Keyboard shelf.
  rect(img, 1, 17, W - 2, 1, deep)
  key_w = (240, 236, 226, 255)
  key_line = (186, 180, 176, 255)
  rect(img, 3, 18, W - 6, 4, key_w)
  for x in range(4, W - 3, 2):
    vline(img, x, 18, 4, key_line)
  for i, x in enumerate(range(4, W - 4, 2)):
    if i % 7 in (0, 1, 3, 4, 5):
      vline(img, x, 18, 2, (40, 32, 44, 255))
  for x in (1, W - 3):  # key cheeks
    rect(img, x, 17, 2, 6, top)
  rect(img, 1, 22, W - 2, 2, base)
  hline(img, 1, 23, W - 2, lo)
  # Lower case, legs and pedals.
  rect(img, 3, 24, W - 6, 8, lo)
  rect(img, 5, 25, W - 10, 5, base)
  vline(img, 5, 25, 5, hi)
  for x in (1, W - 4):
    rect(img, x, 22, 3, 10, base)
    vline(img, x, 22, 10, hi if x == 1 else base)
    hline(img, x, 31, 3, deep)
  for x in (13, 15, 17):
    put(img, x, 31, (230, 190, 90, 255))
  hline(img, 3, 32, W - 6, deep)
  img = _finish(img, (W / 2, 32.5, W / 2 - 1, 2))
  pieces = [Piece(img, dx=0, dy=T - H + 3, z=T)]  # sorts on its own row, also when the bench adds one
  if not bench:
    return Made(pieces, foot=(2, 1))
  b = new(W, 16)  # dy 16: a padded bench, sitters face the keys
  bh_, bt, bb, bl, bd = _ramp(colour)
  rect(b, 3, 3, W - 6, 5, bt)
  hline(b, 3, 3, W - 6, bh_)
  rect(b, 3, 8, W - 6, 2, bb)
  hline(b, 3, 9, W - 6, bl)
  for x in (4, W - 7):
    rect(b, x, 10, 3, 4, bd)
  b = _finish(b, (W / 2, 13.5, W / 2 - 3, 1.6))
  pieces.append(Piece(b, dx=0, dy=T, z=T + 1))
  # Pianists sit right at the keys: feet a little higher than a plain seat on that row.
  seats = [{'dx': i, 'dy': 1, 'face': 'up', 'ax': i * T + 8, 'ay': T + 6} for i in (0, 1)]
  return Made(pieces, foot=(2, 2), solid=[(0, 0), (1, 0)], seats=seats)


# --- Floor lamp --------------------------------------------------------------------------------------

@item('floor_lamp', 'furniture', 'Standing lamp with a fabric shade that glows warmly. Solid.',
      (1, 1), variants=[{'colour': 'teal'}, {'colour': 'pink'}],
      colour=Param('colour', 'cream', doc='shade colour'))
def _floor_lamp(colour):
  hi, base, lo, deep = tones(colour)
  w, h = 16, 40
  img = new(w, h)  # row r = footprint y (r - 23)
  # Pole and base.
  rect(img, 7, 11, 2, 26, METAL)
  vline(img, 7, 11, 26, METAL_HI)
  ellipse(img, 8, 37, 4, 1.6, METAL)
  hline(img, 5, 36, 6, METAL_HI)
  # Shade: a truncated cone, lit from the left, glowing at the rim.
  for r in range(10):
    half = 4 + r * 3 / 9
    x0, x1 = int(round(8 - half)), int(round(8 + half))
    for x in range(x0, x1):
      t = (x - x0) / max(1, x1 - x0)
      c = hi if t < 0.3 else base if t < 0.75 else lo
      put(img, x, 1 + r, c)
  hline(img, 4, 1, 8, mix(hi, WHITE, 0.3))
  glow = (255, 236, 168, 255)
  hline(img, 1, 11, 14, mix(base, glow, 0.6))
  img = _finish(img, (8, 37.5, 5, 1.6))
  hline(img, 4, 12, 8, glow)  # light spilling under the shade
  return Made([Piece(img, dx=0, dy=T - h + 1)], foot=(1, 1),
              glows=[{'dx': 8, 'dy': -17, 'radius': 2.5, 'colour': '#ffe2a0', 'flicker': False}])


# --- Deck chair --------------------------------------------------------------------------------------

@item('deck_chair', 'furniture', 'Striped canvas deck chair on a wooden frame; one seat facing down.',
      (1, 1), scene='grass', variants=[{'colour': 'red'}, {'colour': 'gold'}],
      colour=Param('colour', 'blue', doc='stripe colour'))
def _deck_chair(colour):
  hi, base, lo, deep = tones(colour)
  fr = tones('#c89656')
  white, grey = (248, 246, 240, 255), (206, 204, 214, 255)
  w, h = 16, 27
  img = new(w, h)  # row r = footprint y (r - 10)
  # Back uprights and top bar.
  for x in (2, 12):
    rect(img, x, 1, 2, 18, fr[1])
    vline(img, x, 1, 18, fr[0] if x == 2 else fr[1])
    vline(img, x + 1, 1, 18, fr[2])
  rect(img, 2, 0, 12, 2, fr[1])
  hline(img, 2, 0, 12, fr[0])
  # The canvas sling: stripes, lit where it leans back, shaded where it sags into a seat.
  for y in range(2, 18):
    for x in range(4, 12):
      stripe = ((x - 4) // 2) % 2 == 0
      if y < 10:
        c = (hi if x < 6 else base) if stripe else white
      else:
        c = lo if stripe else grey
      put(img, x, y, c)
  for x in range(6, 10):  # the sag
    put(img, x, 18, lo if ((x - 4) // 2) % 2 == 0 else grey)
  # Front bar and splayed front legs.
  rect(img, 1, 17, 14, 2, fr[1])
  hline(img, 1, 17, 14, fr[0])
  for (x, lean) in ((1, -1), (13, 1)):
    for yy in range(19, 26):
      xx = x + (lean if yy >= 23 else 0)
      put(img, xx, yy, fr[1])
      put(img, xx + 1, yy, fr[2])
  img = _finish(img, (8.5, 25.5, 7, 1.6))
  return Made([Piece(img, dx=0, dy=T - h + 1, z=1)], foot=(1, 1), solid=[],
              seats=[{'dx': 0, 'dy': 0, 'face': 'down'}])


# --- Umbrella ----------------------------------------------------------------------------------------

def _canopy(colour, w=46, h=27, panels=12):
  hi, base, lo, deep = tones(colour)
  white = (248, 246, 240, 255)
  wlo = (214, 212, 222, 255)
  img = new(w, h)
  cx = w / 2
  rim_y = h - 8.5  # centre line of the rim ellipse
  rx, ry = w / 2 - 1, 5.5
  apex_y = 2.5
  shape = set()
  for y in range(h):
    for x in range(w):
      u = (x + 0.5 - cx) / rx
      if abs(u) > 1:
        continue
      dome_top = rim_y - (rim_y - apex_y) * math.sqrt(max(0.0, 1 - u * u)) ** 0.8
      rim_bot = rim_y + ry * math.sqrt(max(0.0, 1 - u * u))
      if dome_top <= y + 0.5 <= rim_bot:
        shape.add((x, y))
  # Panels by azimuth around the apex; scallops below the rim.
  for (x, y) in shape:
    u = (x + 0.5 - cx) / rx
    v = (y + 0.5 - apex_y) / (rim_y + ry - apex_y)
    t = max(0.05, math.hypot(u, v))
    phi = math.asin(max(-1.0, min(1.0, u / t)))
    k = int(math.floor(phi / (math.pi / (panels / 2)) + 0.5))
    stripe = k % 2 == 0
    light = u < -0.35 or v < 0.3
    dark = u > 0.45 or v > 0.85
    if stripe:
      c = hi if light and not dark else lo if dark else base
    else:
      c = white if not dark else wlo
    put(img, x, y, c)
  # Valance: scallops hanging from the rim.
  for x in range(1, w - 1):
    u = (x + 0.5 - cx) / rx
    if abs(u) >= 1:
      continue
    yb = rim_y + ry * math.sqrt(1 - u * u)
    v = (yb - apex_y) / (rim_y + ry - apex_y)
    t = max(0.05, math.hypot(u, v))
    phi = math.asin(max(-1.0, min(1.0, u / t)))
    k = int(math.floor(phi / (math.pi / (panels / 2)) + 0.5))
    c = (lo if k % 2 == 0 else wlo)
    sc = 1 + (1 if (x % 5) in (1, 2, 3) else 0)
    for d in range(sc):
      put(img, x, int(yb) + 1 + d, c)
  # Finial.
  rect(img, int(cx) - 1, 0, 2, 3, deep)
  put(img, int(cx) - 1, 0, hi)
  return outlined(img)


@item('umbrella', 'furniture',
      'Beach/patio parasol: a striped canopy overhead that people stand under; only the pole tile is solid; '
      'table=true adds a table.',
      (1, 1), scene='grass', variants=[{'colour': 'teal', 'table': True}, {'colour': 'gold'}],
      colour=Param('colour', 'red', doc='canopy stripe colour'),
      table=Param('bool', False, doc='a small round table around the pole'))
def _umbrella(colour, table):
  pieces = []
  sh = new(48, 14)
  drop_shadow(sh, 24, 7, 20, 5.5)
  pieces.append(Piece(sh, dx=-13, dy=4, z=0, layer='ground'))
  pole = new(6, 44)  # row r = y (r - 28)
  rect(pole, 2, 0, 2, 42, METAL)
  vline(pole, 2, 0, 42, METAL_HI)
  pole = outlined(pole)
  base = new(10, 6)
  ellipse(base, 5, 3, 4, 1.8, METAL_LO)
  hline(base, 3, 2, 4, METAL)
  base = _finish(base, (5, 4, 4.5, 1.5))
  pieces.append(Piece(base, dx=3, dy=11, z=15))
  pieces.append(Piece(pole, dx=5, dy=-28, z=16))
  if table:
    tb = _round_table(WOOD_HEX, None, w=24)
    # The pole rises through the middle of the top.
    rect(tb, 11, 0, 2, 7, METAL)
    vline(tb, 11, 0, 7, METAL_HI)
    pieces.append(Piece(tb, dx=-4, dy=T + 1 - tb.height, z=16))
  canopy = _canopy(colour)
  pieces.append(Piece(canopy, dx=8 - canopy.width // 2, dy=-28 - canopy.height + 9, layer='over'))
  return Made(pieces, foot=(1, 1), solid=[(0, 0)])


# --- Counter -----------------------------------------------------------------------------------------

@item('counter', 'furniture', 'Shop or bar counter (1-6 tiles): a deep wooden top over a panelled front. Solid.',
      (3, 1), variants=[{'length': 2, 'colour': '#5a6e8c'}, {'length': 4, 'colour': '#6a4a3a'}],
      length=Param('int', 3, 1, 6, doc='tiles long'), colour=Param('colour', WOOD_HEX, doc='body colour'))
def _counter(length, colour):
  hi, top, base, lo, deep = _ramp(colour)
  W = length * T
  H = 30
  img = new(W, H)  # row r = footprint y (r - 11)
  wood = _ramp(mix(to_rgba(colour), (190, 140, 88, 255), 0.5))  # the worktop: warm wood whatever the body
  # Body: a beadboard front under a rail, on a dark kick plate.
  rect(img, 2, 10, W - 4, 16, base)
  for x in range(5, W - 3, 4):
    vline(img, x, 13, 11, lo)
    vline(img, x + 1, 13, 11, hi)
  rect(img, 2, 10, W - 4, 3, base)
  hline(img, 2, 10, W - 4, deep)
  hline(img, 2, 12, W - 4, lo)
  vline(img, 2, 10, 16, hi)
  vline(img, W - 3, 10, 16, lo)
  rect(img, 2, 24, W - 4, 3, deep)
  hline(img, 2, 24, W - 4, lo)
  # The worktop, overhanging the body by a pixel.
  rect(img, 1, 1, W - 2, 7, wood[1])
  hline(img, 2, 1, W - 4, wood[0])
  vline(img, 1, 2, 6, wood[0])
  _grain(img, 3, 3, W - 6, 4, wood[2], length * 11 + 3, length + 1)
  rect(img, 1, 8, W - 2, 2, wood[2])
  hline(img, 1, 9, W - 2, wood[3])
  img = _finish(img, (W / 2 + 1, 27, W / 2 - 1, 1.8))
  return Made([Piece(img, dx=0, dy=T - H + 3)], foot=(length, 1))


# --- Stool -------------------------------------------------------------------------------------------

@item('stool', 'furniture', 'Round bar stool with a cushioned seat; one seat (good in front of a counter).',
      (1, 1), variants=[{'colour': 'teal', 'facing': 'up'}],
      colour=Param('colour', 'red', doc='cushion colour'),
      facing=Param('enum', 'down', choices=FACING, doc='the way the sitter faces'))
def _stool(colour, facing):
  hi, base, lo, deep = tones(colour)
  w, h = 14, 22
  img = new(w, h)  # row r = footprint y (r - 6)
  rect(img, 6, 8, 2, 11, METAL)
  vline(img, 6, 8, 11, METAL_HI)
  for x in range(3, 11):  # foot ring
    put(img, x, 15, METAL if x not in (3, 10) else METAL_LO)
  ellipse(img, 7, 19.5, 4, 1.4, METAL)
  hline(img, 5, 19, 4, METAL_HI)
  ellipse(img, 7, 6, 6, 2.6, lo)
  ellipse(img, 7, 4.2, 6, 2.6, base)
  for (x, y) in disc_mask(w, h, 7, 4.2, 6, 2.6):
    if (x - 7) / 6 + (y - 4.2) / 2.6 < -0.7:
      put(img, x, y, hi)
  img = _finish(img, (7, 20, 5, 1.5))
  return Made([Piece(img, dx=1, dy=T - h, z=1)], foot=(1, 1), solid=[],
              seats=[{'dx': 0, 'dy': 0, 'face': facing, 'ax': 8, 'ay': 9}])
