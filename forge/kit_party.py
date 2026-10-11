"""Kit family: party items for Möbius Town builders (registered on import by kit.py).

Conventions (see kit.py's docstring for the full contract):
- `@item(name, 'party', doc, foot=(w, h), variants=[...], **params)`; the function returns `Made`.
- Draw in the town's palette with kit's helpers (tones, outlined, block, post, foliage, pixel_text ...),
  dark plum outline OUT (OUT_SOFT for foliage), light from the upper left, 2-4 flat shades, no
  anti-aliasing, soft SHADOW ellipse under standing things, 3/4 top-down view.
- Deterministic: randomness only from noise_rng(seed).
"""
from __future__ import annotations

import math

from kit import *  # noqa: F401,F403
from kit import (  # noqa: F401
  Made, Param, Piece, T, item, rows_of, standing, to_rgba, tones,
)

PARTY = ('pink', 'gold', 'sky', 'mint', 'lilac', 'coral')
STRING = (232, 226, 236, 255)  # balloon strings: pale curling ribbon
CORD = (74, 60, 84, 255)  # bunting and light cords: a soft dark plum


def _cols(colours, default=PARTY):
  return [to_rgba(c) for c in (colours or default)]


def _lum(c):
  return (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255


def _rows(img, length, up, fps=0.0):
  """A north-south overhead run cut into one 'over' piece per tile row (empty rows dropped)."""
  pieces = rows_of(img, 1, length, dx=0, top=up, layer='over', fps=fps)
  return [p for p in pieces if any(f.getbbox() for f in p.frames)]


# --- Balloons ------------------------------------------------------------------------------------

# One balloon: 9 x 11 body rows (x0, x1 inclusive), egg-shaped, narrowing to the knot.
_BALLOON = [(2, 6), (1, 7), (0, 8), (0, 8), (0, 8), (0, 8), (1, 7), (1, 7), (2, 6), (3, 5), (4, 4)]

# Bunch layouts: balloon centres (x, y) around the bunch's middle, back (top) first.
_BUNCH = {
  1: [(0, 0)],
  2: [(-5, -1), (5, 1)],
  3: [(-8, 0), (8, -1), (0, -5)],
  4: [(-9, -2), (0, -7), (9, -3), (0, 3)],
  5: [(-10, -3), (0, -8), (10, -4), (-5, 3), (5, 2)],
  6: [(-10, -6), (0, -10), (10, -6), (-11, 3), (11, 2), (0, 1)],
  7: [(-5, -11), (6, -10), (-12, -3), (12, -2), (0, -2), (-6, 5), (6, 5)],
}


def _balloon(c):
  """One shiny balloon (outlined), 11 x 16 px; its knot's bottom pixel is at (5, 14)."""
  hi, base, lo, deep = tones(c)
  img = new(11, 16)
  for y, (a, b) in enumerate(_BALLOON):
    for x in range(a, b + 1):
      col = base
      if x + y * 0.55 >= 9.2 or y >= 9:
        col = lo
      put(img, x + 1, y + 1, col)
  # Shine: a little crescent highlight in the upper left.
  put(img, 3, 3, WHITE)
  put(img, 2, 4, hi)
  put(img, 2, 5, hi)
  put(img, 4, 2, hi)
  # Knot.
  put(img, 5, 12, lo)
  hline(img, 4, 13, 3, deep)
  return outlined(img)


def _weight(c):
  """A little foil-wrapped balloon weight, 9 x 8 px with its outline."""
  hi, base, lo, deep = tones(c)
  img = new(9, 8)
  rect(img, 1, 3, 7, 4, base)
  hline(img, 2, 2, 5, hi)
  vline(img, 1, 3, 2, hi)
  vline(img, 7, 3, 4, lo)
  hline(img, 1, 6, 7, lo)
  put(img, 3, 3, WHITE)
  # The gathered neck where the cord is tied.
  hline(img, 3, 1, 3, lo)
  put(img, 4, 0, lo)
  return outlined(img)


@item('balloons', 'party', 'A bunch of shiny balloons on strings tied to a little weight; sways gently. Walk-through.',
      (1, 1), variants=[{'colours': ['pink', 'gold', 'sky'], 'count': 5}, {'colours': ['red'], 'count': 1},
                        {'colours': ['mint', 'pink', 'lilac'], 'count': 7}],
      colours=Param('colours', None, doc='balloon colours, repeated in turn; default party mix'),
      count=Param('int', 5, 1, 7, doc='how many balloons'),
      seed=Param('int', 1, 0, 9999))
def _balloons(colours, count, seed):
  cols = _cols(colours)
  rng = noise_rng(seed)
  order = list(range(len(cols)))
  if not colours:
    rng.shuffle(order)
  layout = _BUNCH[count]
  W, H = 48, 66  # canvas: footprint tile centred, bottom at the tile's bottom + 1
  ox, oy = (W - T) // 2, H - T - 1  # footprint top-left inside the canvas
  ax, ay = ox + 8, oy + 8  # the weight's neck, where the cord is tied
  kx, ky = ax, ay - 9  # where the balloons' strings are gathered
  mid_x, mid_y = ox + 8, oy - 28  # middle of the bunch
  imgs = [_balloon(cols[order[i % len(order)]]) for i in range(count)]
  wimg = _weight(to_rgba('silver'))
  phases = [rng.uniform(0, 2 * math.pi) for _ in range(count)]
  frames = []
  for k in range(4):
    f = new(W, H)
    drop_shadow(f, ax + 0.5, ay + 7, 5, 1.8)
    pos = []
    for i, (bx, by) in enumerate(layout):
      sway = round(math.sin(k * math.pi / 2 + phases[i]) * (1.2 if by < 0 else 0.7))
      pos.append((mid_x + bx + sway - 5, mid_y + by - 7))
    # Strings first (behind every balloon): each from its knot to the gathering point, one cord below.
    for (x, y) in pos:
      line(f, x + 5, y + 15, kx, ky, STRING)
    line(f, kx, ky, ax, ay, STRING)
    for i, (x, y) in enumerate(pos):
      paste(f, imgs[i], x, y)
    paste(f, wimg, ax - 4, ay)
    frames.append(f)
  return Made([Piece(frames, dx=-ox, dy=-oy, fps=3)], foot=(1, 1), solid=[])


# --- Banner --------------------------------------------------------------------------------------

def _balanced_lines(text, max_w, font):
  """Split `text` into 1-2 lines that fit max_w, as balanced as possible (None if impossible)."""
  if '\n' in text:
    lines = [ln.strip() for ln in text.split('\n') if ln.strip()]
    return lines if all(text_size(ln, font)[0] <= max_w for ln in lines) else None
  if text_size(text, font)[0] <= max_w:
    return [text]
  words = text.split()
  best = None
  for i in range(1, len(words)):
    a, b = ' '.join(words[:i]), ' '.join(words[i:])
    wa, wb = text_size(a, font)[0], text_size(b, font)[0]
    if wa <= max_w and wb <= max_w:
      score = max(wa, wb)
      if best is None or score < best[0]:
        best = (score, [a, b])
  return best[1] if best else None


def _banner_text(text, max_w, max_h, colour, outline_c):
  """Render banner text as large as fits (big, mini, small; 1-2 lines; shortened if it must)."""
  pad = 2 if outline_c else 0
  for font in ('big', 'mini', 'small'):
    lines = _balanced_lines(text, max_w - pad, font)
    if not lines:
      continue
    gap = 0 if font == 'big' else (-1 if outline_c else 1)
    h = len(lines) * (font_height(font) + pad) + (len(lines) - 1) * gap
    if font != 'big' and all(ch.isupper() or not ch.isalpha() for ch in text):
      h -= len(lines)  # capitals leave the descender row empty
    if h <= max_h:
      return text_block(lines, colour, font, gap=gap, outline=outline_c)
  # Too long even for the smallest font: drop whole words from the end until it fits.
  words = text.replace('\n', ' ').split()
  while len(words) > 1:
    lines = wrap_text(' '.join(words), max_w - pad, 'small', 3)
    if lines and len(lines) * (5 + pad) + (len(lines) - 1) * (-1 if outline_c else 1) <= max_h:
      break
    words = words[:-1]
  font, lines = fit_text(' '.join(words), max_w - pad, max_h - pad, fonts=('small',), max_lines=3)
  return text_block(lines, colour, font, gap=-1 if outline_c else 1, outline=outline_c)


@item('banner', 'party', 'Cloth banner with your text between two poles; the poles block, you can walk under it. '
      'Readable (press X).', (4, 1),
      variants=[{'text': 'HAPPY BIRTHDAY SAM', 'colour': 'pink'}, {'text': 'Welcome home!', 'colour': 'sky',
                                                                    'length': 6},
                {'text': 'PARTY ★', 'colour': 'cream', 'length': 2}],
      length=Param('int', 4, 2, 8, doc='width in tiles; the end tiles hold the poles'),
      text=Param('text', 'HAPPY BIRTHDAY', max=40, doc='the font shrinks and wraps to fit; \\n breaks a line'),
      colour=Param('colour', 'pink', doc='cloth colour'))
def _banner(length, text, colour):
  c = to_rgba(colour)
  hi, base, lo, deep = tones(c)
  W = length * T
  top = 44  # canvas rows above the footprint's top
  H = top + T
  img = new(W, H)
  gy = top + 13  # ground line (feet) in canvas rows
  pole_x = (1, W - 4)  # left x of each 3 px pole (outline added later)
  pole_top = 2
  # Shadows at the poles' feet.
  for px in pole_x:
    drop_shadow(img, px + 1.5, gy + 1, 4, 1.6)
  # Cloth: from pole to pole (its ends wrapped round them), hanging above people's heads.
  cx0, cx1 = pole_x[0] + 1, pole_x[1] + 1
  cy0, cy1 = pole_top + 5, pole_top + 29
  cloth = new(W, H)
  cw = cx1 - cx0 + 1
  rect(cloth, cx0, cy0, cw, cy1 - cy0 + 1, base)
  hline(cloth, cx0, cy0, cw, hi)
  hline(cloth, cx0, cy0 + 1, cw, hi)
  hline(cloth, cx0, cy1 - 1, cw, lo)
  hline(cloth, cx0, cy1, cw, deep)
  for x in (cx0, cx1):  # the wrapped ends
    vline(cloth, x, cy0, cy1 - cy0 + 1, lo)
  vline(cloth, cx1 - 1, cy0 + 2, cy1 - cy0 - 2, lo)
  # A zigzag fringe under the cloth in a contrasting trim colour.
  trim = to_rgba('gold') if _lum(c) < 0.62 or c[2] > c[1] else to_rgba('white')
  _thi, tbase, tlo, _tdeep = tones(trim)
  for x in range(cx0 + 1, cx1):
    k = (x - cx0) % 4
    put(cloth, x, cy1 + 1, tbase if k < 3 else tlo)
    if k in (1, 2):
      put(cloth, x, cy1 + 2, tlo)
  cloth = outlined(cloth)
  # Poles.
  poles = new(W, H)
  for px in pole_x:
    post(poles, px, pole_top + 2, gy - pole_top - 1, 3, WOOD)
    rect(poles, px - 1, gy - 1, 5, 2, WOOD_MID)
    # Gold finial.
    rect(poles, px, pole_top, 3, 2, (240, 196, 58, 255))
    put(poles, px, pole_top, (255, 236, 150, 255))
  poles = outlined(poles)
  img.alpha_composite(poles)
  img.alpha_composite(cloth)
  # Cords tying the cloth's corners round the poles.
  for x in (cx0, cx1):
    for y in (cy0 + 2, cy1 - 2):
      put(img, x, y, CREAM)
      put(img, x, y + 1, shade(CREAM, 0.8))
  # Text.
  label = text.strip() or ' '
  dark = _lum(c) > 0.72
  tcol = mix(deep, OUT, 0.45) if dark else WHITE
  tout = None if dark else mix(deep, OUT, 0.5)
  tw, th = cw - 4, cy1 - cy0 - 3
  timg = _banner_text(label, tw, th, tcol, tout)
  if timg.getbbox():
    timg = timg.crop(timg.getbbox())
  tx = cx0 + (cw - timg.width + 1) // 2
  ty = cy0 + 2 + (cy1 - cy0 - 2 - timg.height + 1) // 2
  paste(img, timg, tx, ty)
  use = [(x, 1) for x in range(length)]
  return Made([Piece(img, dx=0, dy=-top)], foot=(length, 1), solid=[(0, 0), (length - 1, 0)], use=use,
              text=text.strip())


# --- Presents --------------------------------------------------------------------------------------

# Bows by ribbon width: '#' ribbon, 'h' its highlight, 'o' the loop's hollow, 'k' the knot, 't' tails.
# The row marked by _BOW_ROW sits on the ribbon crossing in the middle of the box's top face.
_BOWS = {
  1: ['.hh.hh.', 'ho#k#oh', '.##.##.'],
  2: ['.hh....hh.', 'ho##kk##oh', '.###kk###.', '...t..t...'],
}
_BOW_ROW = 2


def _present(w, top_h, front_h, colour, ribbon, pattern=None, bow=True):
  """A wrapped present in 3/4 view (outlined): lit top, darker front, ribbon cross and a bow.

  The bow rises above the top face; the image's last row is the outline under the front face.
  """
  hi, base, lo, deep = tones(colour)
  rhi, rbase, rlo, rdeep = tones(ribbon)
  rw = 2 if w % 2 == 0 else 1
  bow_rows = _BOWS[rw]
  # Room above the top face for the bow, its outline and the present's outline.
  y0 = max(1, _BOW_ROW + 2 - top_h // 2) if bow else 1
  img = new(w + 2, y0 + top_h + front_h + 1)
  x0 = 1
  # Top face and front face.
  rect(img, x0, y0, w, top_h, hi)
  hline(img, x0, y0, w, mix(hi, WHITE, 0.35))
  rect(img, x0, y0 + top_h, w, front_h, base)
  vline(img, x0 + w - 1, y0 + top_h, front_h, lo)
  hline(img, x0, y0 + top_h + front_h - 1, w, lo)
  if pattern == 'dots':
    for i, yy in enumerate(range(y0 + top_h + 1, y0 + top_h + front_h - 1, 3)):
      for xx in range(x0 + 1 + (i % 2) * 2, x0 + w - 1, 4):
        put(img, xx, yy, hi)
  elif pattern == 'stripes':
    for xx in range(x0 + 1, x0 + w - 1, 3):
      vline(img, xx, y0 + top_h, front_h - 1, lo)
  # Ribbon: a band down the middle of the front, a cross on the top face.
  rx = x0 + (w - rw) // 2
  ry = y0 + top_h // 2
  rect(img, rx, y0, rw, top_h + front_h, rbase)
  if rw > 1:
    vline(img, rx + rw - 1, y0 + top_h, front_h, rlo)
  hline(img, x0, ry, w, rhi)
  vline(img, rx, y0, top_h, rhi)
  put(img, rx, y0 + top_h + front_h - 1, rlo)
  if bow:
    bw = len(bow_rows[0])
    bx = rx + rw // 2 - bw // 2 if rw == 1 else rx + 1 - bw // 2
    by = ry - _BOW_ROW + (1 if rw == 1 else 0)
    cmap = {'#': rbase, 'h': rhi, 'o': rdeep, 'k': rlo, 't': rlo}
    layer = new(img.width, img.height)
    for yy, row in enumerate(bow_rows):
      for xx, ch in enumerate(row):
        if ch != '.':
          put(layer, bx + xx, by + yy, cmap[ch])
    img.alpha_composite(outline(layer, mix(rdeep, OUT, 0.5)))
  return outlined(img)


def _ribbon_for(c):
  """A ribbon colour that stands out on box colour c."""
  if _lum(c) > 0.7:
    return to_rgba('red') if c[0] < 200 or c[2] > 150 else to_rgba('sky')
  return to_rgba('white') if c[0] > 180 or c[2] > 180 else to_rgba('gold')


@item('gift', 'party', 'One wrapped present with a ribbon and bow. small is walk-through, big blocks.', (1, 1),
      variants=[{'colour': 'sky', 'ribbon': 'white', 'size': 'big'}, {'colour': 'gold', 'ribbon': 'red'}],
      colour=Param('colour', 'red', doc='wrapping paper'),
      ribbon=Param('colour', 'gold', doc='ribbon and bow'),
      size=Param('enum', 'small', choices=('small', 'big')))
def _gift(colour, ribbon, size):
  big = size == 'big'
  img = _present(14 if big else 9, 5 if big else 3, 10 if big else 6, to_rgba(colour), to_rgba(ribbon))
  out = new(img.width + 2, img.height + 3)
  drop_shadow(out, out.width / 2, out.height - 3.5, img.width / 2 + 0.5, 2)
  paste(out, img, 1, 0)
  return Made([standing(out, (1, 1), dy=-1)], foot=(1, 1), solid=None if big else [])


# Piles in a 2-tile footprint, back first: (x, bottom y of the front face (13 = the ground line),
# width, top face rows, front face rows, pattern). A box whose bottom is above the ground sits on one.
_PILE = {
  3: [(2, 10, 14, 5, 11, None), (17, 11, 13, 5, 8, 'dots'), (9, 15, 11, 4, 7, None)],
  4: [(1, 10, 14, 5, 12, 'stripes'), (16, 10, 14, 5, 9, None), (19, 1, 9, 3, 5, None),
      (8, 15, 12, 4, 7, 'dots')],
  5: [(0, 10, 13, 5, 11, None), (14, 9, 14, 5, 10, 'stripes'), (2, 0, 9, 3, 5, 'dots'),
      (6, 15, 11, 4, 7, None), (18, 15, 12, 4, 6, 'dots')],
}


@item('gifts', 'party', 'A pile of 3-5 wrapped presents in mixed colours (blocks walking).', (2, 1),
      variants=[{'count': 5, 'seed': 3}, {'colours': ['sky', 'white'], 'count': 3}],
      count=Param('int', 4, 3, 5, doc='how many presents'),
      colours=Param('colours', None, doc='paper colours; default party mix'),
      seed=Param('int', 1, 0, 9999))
def _gifts(count, colours, seed):
  rng = noise_rng(seed)
  cols = _cols(colours, ('red', 'sky', 'pink', 'mint', 'gold', 'lilac', 'teal'))
  if not colours:
    rng.shuffle(cols)
  W, H = 2 * T + 4, 44
  top = H - T - 2  # canvas rows above the footprint top
  img = new(W, H)
  drop_shadow(img, W / 2, top + 14, 15, 2.5)
  boxes = new(W, H)
  for i, (x, y, w, th, fh, pat) in enumerate(_PILE[count]):
    c = cols[i % len(cols)]
    rib = _ribbon_for(c)
    if colours and len(cols) > 1:
      rib = cols[(i + 1) % len(cols)]
    box = _present(w, th, fh, c, rib, pattern=pat)
    paste(boxes, box, x + 1, top + y - (box.height - 1) + 1)
  # Centre the pile on the footprint.
  bb = boxes.getbbox()
  shift = (W - (bb[0] + bb[2])) // 2 if bb else 0
  paste(img, boxes, shift, 0)
  return Made([Piece(img, dx=-2, dy=-top)], foot=(2, 1))


# --- Bunting ---------------------------------------------------------------------------------------

def _flag(c):
  """A 5 x 6 pennant pointing down (outlined later with the whole string of flags)."""
  hi, base, lo, deep = tones(c)
  img = new(5, 6)
  rows = [(0, 4), (0, 4), (1, 3), (1, 3), (2, 2), (2, 2)]
  for y, (a, b) in enumerate(rows):
    for x in range(a, b + 1):
      put(img, x, y, hi if (x < 2 and y < 3) else base if x < 3 else lo)
  return img


def _pin(img, x, y):
  """A little brass pin where a cord is fastened."""
  rect(img, x, y, 2, 2, (176, 132, 64, 255))
  put(img, x, y, (240, 206, 120, 255))


@item('bunting', 'party', 'Little triangular flags on a sagging cord hung overhead along the footprint: along a '
      'wall, or between posts or trees (walk-through).',
      (6, 1), variants=[{'length': 12, 'colours': ['pink', 'gold', 'sky', 'mint']}, {'length': 4, 'vertical': True}],
      length=Param('int', 6, 2, 16, doc='tiles'),
      colours=Param('colours', None, doc='flag colours in turn; default party mix'),
      vertical=Param('bool', False, doc='run north-south'))
def _bunting(length, colours, vertical):
  cols = _cols(colours, ('pink', 'gold', 'sky', 'mint', 'lilac'))
  up = 24  # the cord hangs about head-and-a-half high: its ends are this far above the footprint's top
  if not vertical:
    W = length * T
    sag = min(7, 2 + length // 2)
    H = up + sag
    img = new(W, H)
    ys = [2 + int(round(sag * 4 * ((x + 0.5) / W) * (1 - (x + 0.5) / W))) for x in range(W)]
    flags = new(W, H)
    i = 0
    for x in range(3, W - 5, 7):
      paste(flags, _flag(cols[i % len(cols)]), x, ys[x + 2] + 1)
      i += 1
    flags = outlined(flags)
    for x in range(W):
      put(img, x, ys[x], CORD)
      if x > 0 and ys[x] != ys[x - 1]:
        put(img, x, min(ys[x], ys[x - 1]), CORD)
    img.alpha_composite(flags)
    _pin(img, 0, ys[0] - 1)
    _pin(img, W - 2, ys[-1] - 1)
    return Made([Piece(img, dx=0, dy=-up, layer='over')], foot=(length, 1), solid=[])
  # North-south: the cord runs down the screen from the first tile to the last; the pennants hang off
  # it in a column, turned a little to alternate sides.
  H = up + length * T
  W = 16
  y0, y1 = up - 21, up + (length - 1) * T - 19  # the cord's ends (canvas rows)
  img = new(W, H)
  flags = new(W, H)
  i = 0
  for y in range(y0 + 2, y1 - 3, 9):
    paste(flags, _flag(cols[i % len(cols)]), 6 + (1 if i % 2 else -1) - 1, y)
    i += 1
  flags = outlined(flags)
  vline(img, 7, y0, y1 - y0 + 1, CORD)
  img.alpha_composite(flags)
  _pin(img, 7, y0 - 1)
  _pin(img, 7, y1)
  return Made(_rows(img, length, up), foot=(1, length), solid=[])


# --- Cakes, cupcakes and the party table ------------------------------------------------------------

FIRE_OUT = (169, 122, 30, 255)  # the pack's flame colours (objects.png)
FIRE = (248, 184, 56, 255)
FIRE_HI = (248, 248, 128, 255)


def _candle_flame(img, x, y, k):
  """A tiny 1-2 px candle flame whose bottom is at (x, y); k = animation frame (0/1)."""
  if k % 2 == 0:
    put(img, x, y, FIRE)
    put(img, x, y - 1, FIRE_HI)
    put(img, x, y - 2, WHITE)
  else:
    put(img, x, y, FIRE)
    put(img, x, y - 1, FIRE_HI)
    put(img, x + 1, y - 2, FIRE_HI)


def _cylinder(img, cx, yt, w, h, ry, side, top, edge=None):
  """A 3/4-view cylinder (cake tier, plate, table top): top ellipse centred (cx, yt), `h` rows of side.

  `side`/`top` are tone ramps (hi, base, lo, deep); light from the upper left. cx may be a half pixel.
  """
  a = w / 2
  shi, sbase, slo, sdeep = side
  thi, tbase, tlo, tdeep = top
  for x in range(int(math.floor(cx - a)), int(math.ceil(cx + a))):
    u = (x + 0.5 - cx) / a
    if abs(u) > 1:
      continue
    arc = ry * math.sqrt(max(0.0, 1 - u * u))
    yb = int(round(yt + h + arc - 0.5))
    col = shi if u < -0.75 else sbase if u < 0.35 else slo
    for y in range(int(round(yt)), yb + 1):
      put(img, x, y, col)
    if h > 1:
      put(img, x, yb, sdeep if u > 0.35 else slo)
  for y in range(int(math.floor(yt - ry)), int(math.ceil(yt + ry)) + 1):
    for x in range(int(math.floor(cx - a)), int(math.ceil(cx + a))):
      u, v = (x + 0.5 - cx) / a, (y + 0.5 - yt) / max(0.5, ry)
      if u * u + v * v <= 1.0:
        put(img, x, y, thi if (u < -0.2 and v < 0.2) else tbase)
  if edge:
    # A piped rim along the top's front edge.
    for x in range(int(math.floor(cx - a)) + 1, int(math.ceil(cx + a)) - 1, 2):
      u = (x + 0.5 - cx) / a
      put(img, x, int(round(yt + ry * math.sqrt(max(0.0, 1 - u * u)) - 0.5)) + 1, edge)


def _round_table(w=22):
  """A little round café table (outlined), w x 22 px; its top's centre row is 6, its feet at row 19."""
  img = new(w, 22)
  drop_shadow(img, w / 2, 19.5, w * 0.42, 2.2)
  rect(img, w // 2 - 1, 9, 2, 10, WOOD_DARK)
  vline(img, w // 2 - 1, 9, 9, WOOD_MID)
  rect(img, w // 2 - 4, 18, 8, 2, WOOD_DARK)
  hline(img, w // 2 - 4, 18, 8, WOOD_MID)
  _cylinder(img, w / 2, 5.5, w - 2, 2, 4.5, tones(WOOD_MID), (WOOD_LIGHT, WOOD, WOOD_MID, WOOD_DARK))
  return outlined(img)


def _tier_img(w, h, ry, c, trim):
  """One frosted cake tier (outlined): returns (image, yt) with yt the top ellipse's centre row."""
  hi, base, lo, deep = tones(c)
  side = (mix(hi, base, 0.4), base, lo, deep)
  top = (mix(hi, WHITE, 0.3), hi, base, lo)
  r = int(math.ceil(ry))
  img = new(w + 2, h + 2 * r + 3)
  yt = r + 1
  _cylinder(img, (w + 2) / 2, yt, w, h, ry, side, top, edge=trim)
  # Icing drips over the side, and a bead border along the bottom.
  for x in range(2, w, 3):
    u = (x + 0.5 - (w + 2) / 2) / (w / 2)
    yy = int(round(yt + ry * math.sqrt(max(0.0, 1 - u * u)))) + 1
    put(img, x, yy, side[0] if u < 0.35 else base)
    if x % 2:
      put(img, x, yy + 1, side[0] if u < 0.35 else base)
  for x in range(2, w, 2):
    u = (x + 0.5 - (w + 2) / 2) / (w / 2)
    yb = int(round(yt + h + ry * math.sqrt(max(0.0, 1 - u * u)) - 0.5)) - 1
    put(img, x, yb, trim if u < 0.35 else mix(trim, lo, 0.4))
  return outlined(img), yt


def _cake_img(tiers, colour, candles, big, k):
  """A frosted layer cake (tiers outlined one by one, stacked); bottom tier's base on the last row.

  Returns (image, candle x list, row of the flames' tips).
  """
  c = to_rgba(colour)
  trim = WHITE if _lum(c) < 0.8 else to_rgba('pink')
  sizes = ([(20, 7, 3.5), (14, 6, 2.5), (9, 5, 2)] if big else [(14, 5, 2.5), (10, 4, 2), (6, 3, 1.5)])[:tiers]
  W, H = sizes[0][0] + 4, 44
  img = new(W, H)
  y_base = H - 1  # the bottom tier's image bottom
  yt = None
  for i, (w, h, ry) in enumerate(sizes):
    t, tyt = _tier_img(w, h, ry, c, trim)
    if i == 0:
      ty = y_base - t.height + 1
    else:
      ty = yt - 1 - h - tyt  # sits a row behind the middle of the tier below
    paste(img, t, (W - t.width) // 2, ty)
    yt = ty + tyt
  top_w = sizes[-1][0]
  cx = W // 2
  xs = [cx - 2, cx, cx + 1 + (1 if top_w >= 9 else 0)] if top_w < 12 else [cx - 4, cx - 2, cx, cx + 2, cx + 4]
  xs = sorted(set(xs))
  if candles:
    colours = (to_rgba('sky'), to_rgba('gold'), to_rgba('mint'), to_rgba('pink'), to_rgba('lilac'))
    for i, x in enumerate(xs):
      by = yt + (1 if i % 2 else 0)
      vline(img, x, by - 4, 4, colours[i % len(colours)])
      put(img, x, by - 4, mix(colours[i % len(colours)], WHITE, 0.5))
      _candle_flame(img, x, by - 5, k + i)
    tip = yt - 7
  else:
    berry = to_rgba('red')
    for i, x in enumerate(xs):
      by = yt - (i % 2)
      rect(img, x, by - 1, 2, 2, berry)
      put(img, x, by - 1, mix(berry, WHITE, 0.6))
    tip = yt - 2
  bb = img.getbbox()
  img = img.crop((0, bb[1], W, H))
  return img, xs, tip - bb[1]


@item('cake', 'party', 'A frosted birthday cake with lit candles, on a little round table (or a big cake on '
      'the floor).',
      (1, 1), variants=[{'tiers': 3, 'colour': 'pink'}, {'tiers': 2, 'colour': 'white', 'table': False},
                        {'tiers': 1, 'colour': 'brown', 'candles': False}],
      tiers=Param('int', 2, 1, 3, doc='cake layers'),
      colour=Param('colour', 'pink', doc='icing'),
      candles=Param('bool', True, doc='lit candles on top'),
      table=Param('bool', True, doc='on a small round table; false: a big cake standing on the floor'))
def _cake(tiers, colour, candles, table):
  frames = []
  for k in range(2 if candles else 1):
    cake, _xs, flame_y = _cake_img(tiers, colour, candles, not table, k)
    if table:
      t = _round_table(24)
      W, H = 26, t.height + cake.height - 10
      f = new(W, H)
      paste(f, t, 1, H - t.height)
      top_off = H - t.height + 7 - cake.height
      paste(f, cake, (W - cake.width) // 2, top_off)
    else:
      W, H = cake.width + 4, cake.height + 3
      f = new(W, H)
      drop_shadow(f, W / 2, H - 3.5, W / 2 - 1, 2.6)
      # A gold cake board under the cake.
      board = new(W, 6)
      _cylinder(board, W / 2, 2, W - 2, 1, 2, tones('gold'), tones('gold'))
      paste(f, outlined(board), 0, H - 7)
      top_off = H - 2 - cake.height
      paste(f, cake, 2, top_off)
    frames.append(f)
  piece = standing(frames if len(frames) > 1 else frames[0], (1, 1), dy=1 if table else 2, fps=4 if candles else 0)
  glows = []
  if candles:
    glows = [{'dx': 8, 'dy': piece.dy + top_off + flame_y + 2, 'radius': 1.5 if table else 2.0,
              'colour': '#ffcf6e', 'flicker': True}]
  return Made([piece], foot=(1, 1), glows=glows)


_CUPCAKE = ['..h..', '.hbs.', 'hbbbl', 'pPpPq', '.pPq.']


def _cupcake(frost, paper=None):
  """A cupcake with a swirl of frosting in a pleated paper case: 7 x 7 px with its outline."""
  fhi, fbase, flo, fdeep = tones(frost)
  if paper is None:
    phi, pbase, plo, pdeep = fbase, flo, fdeep, mix(fdeep, OUT, 0.3)
  else:
    phi, pbase, plo, pdeep = tones(paper)
  sprinkle = WHITE if _lum(frost) < 0.75 else to_rgba('red')
  cmap = {'h': mix(fhi, WHITE, 0.3), 'b': fhi, 'l': fbase, 's': sprinkle, 'p': pbase, 'P': plo, 'q': pdeep}
  img = new(7, 7)
  for y, row in enumerate(_CUPCAKE):
    for x, ch in enumerate(row):
      if ch != '.':
        put(img, x + 1, y + 1, cmap[ch])
  return outlined(img)


def _plate(w, ry=1.5, c=None):
  """A thin round serving plate seen in 3/4 view (outlined), w + 2 px wide."""
  c = c or (214, 218, 230, 255)
  hi, base, lo, deep = tones(c)
  img = new(w + 2, int(math.ceil(2 * ry)) + 4)
  _cylinder(img, (w + 2) / 2, ry + 1, w, 1, ry, (base, lo, lo, deep), (WHITE, hi, base, lo))
  return outlined(img)


def _cupcake_stand(cols, tiers):
  """A tiered stand of cupcakes; its foot's bottom on the image's last row."""
  widths = (20, 15, 10) if tiers == 3 else (18, 11)
  gap = 9
  stem = 8 if tiers == 3 else 0
  H = stem + gap * (tiers - 1) + 16
  W = widths[0] + 4
  img = new(W, H)
  cx = W // 2
  gold = to_rgba('gold')
  ghi, gbase, glo, gdeep = tones(gold)
  base_y = H - 3  # the lowest plate's centre row
  if stem:
    stem_img = new(W, H)
    rect(stem_img, cx - 1, H - stem - 3, 2, stem + 1, gbase)
    vline(stem_img, cx - 1, H - stem - 3, stem + 1, ghi)
    rect(stem_img, cx - 3, H - 3, 6, 2, glo)
    hline(stem_img, cx - 3, H - 3, 6, gbase)
    img.alpha_composite(outlined(stem_img))
    base_y = H - stem - 3
  rod = new(W, H)
  top_y = base_y - gap * (tiers - 1)
  rect(rod, cx - 1, top_y - 6, 2, base_y - top_y + 6, gbase)
  vline(rod, cx - 1, top_y - 6, base_y - top_y + 6, ghi)
  rect(rod, cx - 1, top_y - 8, 2, 2, ghi)
  rod = outlined(rod)
  k = 0
  for t in range(tiers):
    py = base_y - gap * t
    w = widths[t]
    plate = _plate(w)
    paste(img, plate, cx - plate.width // 2, py - 3)
    # Cupcakes on this plate: a back row, then the rod, then the front row.
    if w >= 18:
      xs = [cx - 9, cx - 4, cx + 1, cx + 5]
    elif w >= 15:
      xs = [cx - 8, cx - 3, cx + 2]
    else:
      xs = [cx - 6, cx]
    back = xs[::2]
    front = xs[1::2]
    for x in back:
      paste(img, _cupcake(cols[k % len(cols)]), x, py - 8)
      k += 1
    if t == 0:
      img.alpha_composite(rod)
    for x in front:
      paste(img, _cupcake(cols[k % len(cols)]), x, py - 7)
      k += 1
  return img


@item('cupcakes', 'party', 'A tiered stand of cupcakes with coloured frosting, on a little round table (or a '
      'tall stand).',
      (1, 1), variants=[{'colours': ['pink', 'mint', 'lilac']}, {'table': False}],
      colours=Param('colours', None, doc='frosting colours; default party mix'),
      table=Param('bool', True, doc='on a small round table; false: a tall stand on the floor'))
def _cupcakes(colours, table):
  cols = _cols(colours, ('pink', 'mint', 'gold', 'lilac', 'sky'))
  if table:
    stand = _cupcake_stand(cols, 2)
    t = _round_table(24)
    W, H = 26, t.height + stand.height - 9
    f = new(W, H)
    paste(f, t, 1, H - t.height)
    paste(f, stand, (W - stand.width) // 2, H - t.height + 8 - stand.height)
    return Made([standing(f, (1, 1), dy=1)], foot=(1, 1))
  stand = _cupcake_stand(cols, 3)
  f = new(stand.width, stand.height + 2)
  drop_shadow(f, f.width / 2, f.height - 3, 6, 1.8)
  paste(f, stand, 0, 0)
  return Made([standing(f, (1, 1), dy=0)], foot=(1, 1))


# --- The party table ---------------------------------------------------------------------------------

def _cup(c):
  """A paper party cup, 5 x 6 px with outline."""
  hi, base, lo, deep = tones(c)
  img = new(5, 6)
  hline(img, 1, 1, 3, WHITE)
  rect(img, 1, 2, 3, 3, base)
  put(img, 1, 2, hi)
  put(img, 3, 3, lo)
  put(img, 3, 4, lo)
  return outlined(img)


def _jug(c):
  """A glass jug of juice, 9 x 11 px with outline."""
  hi, base, lo, deep = tones(c)
  img = new(9, 11)
  glass = (214, 236, 244, 255)
  rect(img, 1, 1, 5, 9, glass)
  rect(img, 1, 4, 5, 6, base)
  vline(img, 1, 4, 6, hi)
  vline(img, 5, 4, 6, lo)
  hline(img, 1, 4, 5, hi)
  put(img, 2, 2, WHITE)
  put(img, 0, 1, glass)  # the spout
  # Handle.
  vline(img, 7, 3, 4, glass)
  put(img, 6, 3, glass)
  put(img, 6, 6, glass)
  return outlined(img)


def _small_plate():
  img = new(8, 5)
  ellipse(img, 4, 2.5, 3.5, 1.6, (232, 230, 238, 255))
  ellipse(img, 4, 2.2, 2.2, 0.9, WHITE)
  return outlined(img)


@item('party_table', 'party', 'A long party table with a tablecloth, a cake, cups, plates, cupcakes and a jug of '
      'juice.',
      (3, 1), variants=[{'length': 2, 'colour': 'pink'}, {'length': 4, 'colour': 'sky', 'cake': False}],
      length=Param('int', 3, 2, 4, doc='tiles'),
      colour=Param('colour', 'white', doc='tablecloth'),
      cake=Param('bool', True, doc='a cake with candles in the middle'))
def _party_table(length, colour, cake):
  c = to_rgba(colour)
  hi, base, lo, deep = tones(c)
  trim = to_rgba('pink') if _lum(c) > 0.85 else mix(hi, WHITE, 0.5)
  W = length * T
  top = 30  # canvas rows above the footprint's top
  H = top + T
  frames = []
  for k in range(2 if cake else 1):
    img = new(W, H)
    drop_shadow(img, W / 2, top + 13.5, W / 2 - 1, 2.6)
    table = new(W, H)
    x0, x1 = 1, W - 2
    ty0, ty1 = top - 8, top - 1  # the top face's rows
    # Legs peeking out under the cloth.
    for lx in (x0 + 1, x1 - 2):
      rect(table, lx, top + 10, 2, 3, WOOD_DARK)
    # Top face (cloth), front drop of the cloth with a scalloped hem.
    rect(table, x0, ty0, x1 - x0 + 1, ty1 - ty0 + 1, hi)
    hline(table, x0, ty0, x1 - x0 + 1, mix(hi, WHITE, 0.4))
    rect(table, x0, top, x1 - x0 + 1, 10, base)
    hline(table, x0, top, x1 - x0 + 1, lo)
    for x in range(x0, x1 + 1):
      if (x - x0) % 6 in (2, 3):
        put(table, x, top + 10, base)
      if (x - x0) % 6 == 5:
        vline(table, x, top + 2, 7, mix(base, lo, 0.5))
    vline(table, x1, top + 1, 9, lo)
    # A ribbon of trim along the cloth's edge.
    hline(table, x0, top + 1, x1 - x0 + 1, trim)
    for x in range(x0 + 1, x1, 3):
      put(table, x, top + 2, trim)
    img.alpha_composite(outlined(table))
    # Things on the table, back to front.
    things = []
    party = [to_rgba(n) for n in ('sky', 'pink', 'gold', 'mint', 'lilac')]
    cxm = W // 2
    if cake:
      ck, _xs, _tip = _cake_img(2, 'pink' if _lum(c) > 0.85 or c[2] > c[0] else 'white', True, False, k)
      things.append((cxm - ck.width // 2, ty0 + 5 - ck.height, ck))
    else:
      st = _cupcake_stand(party, 2)
      things.append((cxm - st.width // 2, ty0 + 5 - st.height, st))
    jug = _jug(to_rgba('orange'))
    things.append((x0 + 2, ty0 - 4, jug))
    cups = [x1 - 9, x1 - 5] if length >= 3 else [x1 - 6]
    for i, x in enumerate(cups):
      things.append((x, ty0 - 1 + (i % 2), _cup(party[i % len(party)])))
    plates = [x0 + 9, x1 - 13] if length >= 3 else []
    if length == 4:
      plates = [x0 + 9, x0 + 17, x1 - 24, x1 - 16]
    for x in plates:
      things.append((x, ty1 - 3, _small_plate()))
    if length >= 3:
      for i, x in enumerate((x0 + 11, x1 - 15)[:2]):
        things.append((x, ty1 - 8, _cupcake(party[(i + 2) % len(party)])))
    things.sort(key=lambda t: t[1] + t[2].height)
    for x, y, im in things:
      paste(img, im, x, y)
    frames.append(img)
  glows = []
  if cake:
    glows = [{'dx': W // 2, 'dy': -top + ty0 - 12, 'radius': 1.5, 'colour': '#ffcf6e', 'flicker': True}]
  return Made([Piece(frames if len(frames) > 1 else frames[0], dx=0, dy=-top, fps=4 if cake else 0)],
              foot=(length, 1), glows=glows)


# --- Confetti, disco ball, string lights -------------------------------------------------------------

@item('confetti', 'party', 'Confetti scattered on the ground: colourful bits and curls (walk-through).', (2, 2),
      variants=[{'w': 4, 'h': 3, 'seed': 5}, {'w': 1, 'h': 1, 'colours': ['gold', 'white']}],
      w=Param('int', 2, 1, 6, doc='tiles across'), h=Param('int', 2, 1, 6, doc='tiles down'),
      colours=Param('colours', None, doc='default party mix'),
      seed=Param('int', 1, 0, 9999))
def _confetti(w, h, colours, seed):
  rng = noise_rng(seed)
  cols = [tones(c) for c in _cols(colours, ('pink', 'gold', 'sky', 'mint', 'lilac', 'coral', 'white'))]
  W, H = w * T, h * T
  img = new(W, H)
  n = int(W * H / 11)
  for _ in range(n):
    x, y = rng.uniform(1, W - 3), rng.uniform(1, H - 3)
    # Thinner towards the edges, so the patch fades out naturally.
    d = max(abs(x / W - 0.5), abs(y / H - 0.5)) * 2
    if rng.random() < d ** 2.2:
      continue
    x, y = int(x), int(y)
    hi, base, lo, _deep = rng.choice(cols)
    kind = rng.random()
    if kind < 0.3:
      put(img, x, y, base)
    elif kind < 0.6:
      if rng.random() < 0.5:
        put(img, x, y, hi)
        put(img, x + 1, y, base)
      else:
        put(img, x, y, hi)
        put(img, x, y + 1, lo)
    elif kind < 0.82:
      # A little curl of streamer.
      pts = rng.choice([[(0, 1), (1, 0), (2, 1)], [(0, 0), (1, 1), (2, 0)], [(0, 0), (1, 1), (1, 2)],
                        [(1, 0), (0, 1), (1, 2), (2, 2)]])
      for i, (px, py) in enumerate(pts):
        put(img, x + px, y + py, hi if i == 0 else base)
    else:
      put(img, x, y, hi)
      put(img, x + 1, y, base)
      put(img, x, y + 1, base)
      put(img, x + 1, y + 1, lo)
  return Made([Piece(img, layer='ground')], foot=(w, h), solid=[])


def _disco_frames(c, n=4):
  """A mirror ball on a chain, n frames of glinting facets and sparkles; ball centre at (12, 30)."""
  tint = tones(c)
  W, H = 24, 44
  cx, cy, r = 12, 30, 7.5
  shades = ((70, 72, 100, 255), (112, 118, 146, 255), (160, 168, 190, 255), (208, 214, 228, 255))
  frames = []
  for k in range(n):
    img = new(W, H)
    ball = new(W, H)
    for y in range(int(cy - r) - 1, int(cy + r) + 1):
      for x in range(int(cx - r) - 1, int(cx + r) + 1):
        dx, dy = (x + 0.5 - cx) / r, (y + 0.5 - cy) / r
        if dx * dx + dy * dy > 1:
          continue
        nz = math.sqrt(max(0.0, 1 - dx * dx - dy * dy))
        lon = math.atan2(dx, nz) + k * math.pi / 14
        lat = math.asin(max(-1.0, min(1.0, dy)))
        fi, fj = int(math.floor(lon / (math.pi / 7))), int(math.floor(lat / (math.pi / 8)))
        gu = (lon / (math.pi / 7)) % 1
        gv = (lat / (math.pi / 8)) % 1
        light = -0.6 * dx - 0.65 * dy + 0.45 * nz  # lit from the upper left
        level = 0 if light < -0.25 else 1 if light < 0.15 else 2 if light < 0.5 else 3
        if gu < 0.2 or gv < 0.22:
          col = shades[max(0, level - 1)]  # the grout between mirror tiles
        else:
          h = (fi * 5 + fj * 3 + k * 2) % 11
          if h == 0 and level >= 1:
            col = WHITE
          elif h in (3, 8):
            col = tint[1] if level >= 2 else tint[2]
          else:
            col = shades[level]
        put(ball, x, y, col)
    # Cap and chain.
    rect(ball, cx - 1, int(cy - r) - 1, 2, 2, (150, 156, 172, 255))
    for y in range(0, int(cy - r) - 1):
      put(ball, cx - (1 if y % 4 < 2 else 0), y, (176, 180, 196, 255) if y % 2 else (120, 124, 140, 255))
    img.alpha_composite(outlined(ball))
    # Sparkles: a big four-point glint and a small one, moving round the ball.
    for (ang, size) in ((k * 1.7 + 0.6, 2), (k * 1.7 + 3.4, 1)):
      sx = int(round(cx + math.cos(ang) * (r + 1)))
      sy = int(round(cy + math.sin(ang) * (r + 1) * 0.9))
      put(img, sx, sy, WHITE)
      for d in range(1, size + 1):
        for (ddx, ddy) in ((d, 0), (-d, 0), (0, d), (0, -d)):
          put(img, sx + ddx, sy + ddy, WHITE if d < size else tint[0])
    frames.append(img)
  return frames, (cx, cy)


@item('disco_ball', 'party', 'A glittering mirror ball hanging overhead on a chain, with a coloured glow '
      '(walk-through).',
      (1, 1), variants=[{'colour': 'pink'}, {'colour': 'sky'}],
      colour=Param('colour', 'lilac', doc='colour of its reflections and glow'))
def _disco_ball(colour):
  frames, (_cx, cy) = _disco_frames(to_rgba(colour))
  dy = -60
  return Made([Piece(frames, dx=-4, dy=dy, layer='over', fps=6)], foot=(1, 1), solid=[],
              glows=[{'dx': 8, 'dy': dy + cy, 'radius': 3.0, 'colour': to_hex(mix(to_rgba(colour), WHITE, 0.2)),
                      'flicker': False}])


def _bulb(img, x, y, c, lit):
  """A little light bulb hanging from the cord at (x, y): a dark socket and a 3 x 3 glass."""
  hi, base, lo, deep = tones(c)
  put(img, x, y, (58, 54, 72, 255))
  if lit:
    hline(img, x - 1, y + 1, 3, base)
    put(img, x - 1, y + 1, hi)
    put(img, x, y + 1, WHITE)
    hline(img, x - 1, y + 2, 3, base)
    put(img, x + 1, y + 2, lo)
    put(img, x, y + 3, base)
  else:
    hline(img, x - 1, y + 1, 3, lo)
    put(img, x, y + 1, base)
    hline(img, x - 1, y + 2, 3, lo)
    put(img, x + 1, y + 2, deep)
    put(img, x, y + 3, lo)


@item('string_lights', 'party', 'Fairy lights: little bulbs on a sagging wire hung overhead (along a wall, or between '
      'posts or trees); they twinkle and glow (walk-through).', (6, 1),
      variants=[{'length': 8}, {'length': 6, 'colour': 'pink'}, {'length': 4, 'vertical': True}],
      length=Param('int', 6, 2, 16, doc='tiles'),
      colour=Param('colour', '#ffd36e', doc='bulb colour; default warm white'),
      vertical=Param('bool', False, doc='run north-south'))
def _string_lights(length, colour, vertical):
  c = to_rgba(colour)
  up = 24
  frames, spots = [], []
  if not vertical:
    W = length * T
    sag = min(8, 2 + length // 2)
    H = up + sag + 4
    ys = [2 + int(round(sag * 4 * ((x + 0.5) / W) * (1 - (x + 0.5) / W))) for x in range(W)]
    bx = list(range(4, W - 3, 6))
    for k in range(2):
      img = new(W, H)
      for x in range(W):
        put(img, x, ys[x], CORD)
        if x > 0 and ys[x] != ys[x - 1]:
          put(img, x, min(ys[x], ys[x - 1]), CORD)
      for i, x in enumerate(bx):
        _bulb(img, x, ys[x] + 1, c, (i + k) % 2 == 0 or (i % 3 == 1))
      frames.append(img)
    spots = [(x, ys[x] + 3) for x in bx]
    pieces = [Piece(frames, dx=0, dy=-up, layer='over', fps=2)]
    foot = (length, 1)
    gdy = -up
  else:
    H = up + length * T
    W = 16
    y0, y1 = up - 21, up + (length - 1) * T - 19
    by = list(range(y0 + 3, y1 - 2, 6))
    for k in range(2):
      img = new(W, H)
      vline(img, 8, y0, y1 - y0 + 1, CORD)
      for i, y in enumerate(by):
        xx = 8 + (1 if i % 2 else -1)
        put(img, xx, y, CORD)
        _bulb(img, xx + (1 if i % 2 else -1), y, c, (i + k) % 2 == 0 or (i % 3 == 1))
      frames.append(img)
    spots = [(8 + (2 if i % 2 else -2), y + 2) for i, y in enumerate(by)]
    pieces = _rows(frames, length, up, fps=2)
    foot = (1, length)
    gdy = -up
  # A few soft glows along the string (at most eight).
  n = min(8, max(1, len(spots) // 3))
  pick = [spots[int((i + 0.5) * len(spots) / n)] for i in range(n)]
  glows = [{'dx': x, 'dy': gdy + y, 'radius': 1.25, 'colour': to_hex(mix(c, WHITE, 0.15)), 'flicker': False}
           for (x, y) in pick]
  return Made(pieces, foot=foot, solid=[], glows=glows)


# --- Piñata and balloon arch ---------------------------------------------------------------------------

# The donkey's silhouette, facing right: (row, x0, x1) spans in a 24 x 20 canvas.
_DONKEY = [
  (1, 15, 15), (1, 18, 18), (2, 15, 15), (2, 18, 18),   # ears
  (3, 14, 19), (4, 14, 20), (5, 14, 21), (6, 14, 21),   # head and snout
  (7, 13, 18), (8, 2, 17), (9, 1, 17), (10, 1, 16), (11, 1, 16), (12, 1, 16), (13, 2, 15),  # neck, body
  (14, 3, 4), (14, 7, 8), (14, 10, 11), (14, 13, 14),   # legs
  (15, 3, 4), (15, 7, 8), (15, 10, 11), (15, 13, 14),
  (16, 3, 4), (16, 7, 8), (16, 10, 11), (16, 13, 14),
]


def _pinata_img(cols):
  """A donkey piñata in frilly paper stripes, facing right (outlined), 24 x 19; its rope is tied at (9, 7)."""
  img = new(24, 19)
  tn = [tones(c) for c in cols]
  for (y, xa, xb) in _DONKEY:
    for x in range(xa, xb + 1):
      band = (y + 1) // 2  # two-row stripes of crêpe paper: a light frill over a darker one
      hi, base, lo, deep = tn[band % len(tn)]
      c = hi if y % 2 == 1 else base
      if (x >= 14 and 9 <= y <= 13) or y == 13 or (x == xb and 8 <= y <= 12):
        c = lo if y % 2 == 1 else deep  # the shaded far side and belly
      put(img, x, y, c)
  # A tail tassel and the face.
  for (x, y, k) in ((0, 9, 0), (0, 10, 1), (0, 11, 2), (1, 12, 3)):
    put(img, x, y, tn[k % len(tn)][1])
  img = outlined(img)
  put(img, 18, 4, OUT)
  put(img, 17, 4, WHITE)
  put(img, 21, 5, OUT)
  return img


@item('pinata', 'party', 'A striped donkey piñata hanging overhead on a rope; it swings gently (walk-through).',
      (1, 1),
      variants=[{'colours': ['pink', 'gold', 'sky', 'mint', 'lilac']}],
      colours=Param('colours', None, doc='fringe stripes; default rainbow'))
def _pinata(colours):
  cols = _cols(colours, ('pink', 'gold', 'sky', 'mint', 'lilac', 'coral'))
  body = _pinata_img(cols)
  W, H = 32, body.height + 16
  rope = (176, 140, 92, 255)
  frames = []
  for sway in (0, 1, 0, -1):
    f = new(W, H)
    bx, by = 5 + sway, H - body.height
    # A short rope with a loop at the top: it hangs from a branch, a beam or a line above.
    line(f, 14, 3, bx + 9, by + 7, rope)
    for (x, y) in ((13, 1), (15, 1), (13, 2), (15, 2), (14, 0)):
      put(f, x, y, rope)
    paste(f, body, bx, by)
    frames.append(f)
  # Its feet hang just above people's heads.
  return Made([Piece(frames, dx=-8, dy=-8 - H, layer='over', fps=2.5)], foot=(1, 1), solid=[])


def _arch_balloon(c):
  """A small round garland balloon (outlined), 9 x 9."""
  hi, base, lo, deep = tones(c)
  img = new(9, 9)
  ellipse(img, 4.5, 4.5, 3.6, 3.6, base)
  for (x, y) in ((5, 6), (6, 5), (6, 6), (4, 7), (5, 7), (7, 4), (6, 7), (7, 5)):
    if img.getpixel((x, y))[3]:
      put(img, x, y, lo)
  put(img, 3, 2, WHITE)
  put(img, 2, 3, hi)
  put(img, 4, 2, hi)
  return outlined(img)


@item('balloon_arch', 'party', 'An arch of balloons to walk under (a party entrance); the two end tiles are solid.',
      (3, 1),
      variants=[{'length': 4, 'colours': ['pink', 'white', 'gold']}, {'length': 6, 'colours': ['sky', 'white']}],
      length=Param('int', 3, 3, 8, doc='tiles; people walk through the middle'),
      colours=Param('colours', None, doc='balloon colours in turn; default party mix'))
def _balloon_arch(length, colours):
  cols = _cols(colours, ('pink', 'gold', 'sky', 'mint', 'lilac'))
  W = length * T
  top = 44
  H = top + T + 2
  img = new(W, H)
  gy = top + 13  # the ground line
  # The arch's centre line: two upright legs over the end tiles joined by a round top about
  # twice a person's height above the ground.
  x0, x1 = 7, W - 8
  r = (x1 - x0) / 2
  cx = (x0 + x1) / 2
  apex = top - 30
  spring = apex + min(r, 14)  # where the round top meets the legs
  leg = list(range(gy - 4, int(spring), -6))  # rows of the clusters up each leg
  arc_n = max(3, int(round(math.pi * r / 6)))
  arc = [(cx + r * math.cos(math.pi - math.pi * i / arc_n), spring - (spring - apex) * math.sin(math.pi * i / arc_n))
         for i in range(arc_n + 1)]
  pts = [(x0, y) for y in leg] + arc + [(x1, y) for y in leg[::-1]]
  for x in (x0, x1):
    drop_shadow(img, x + 0.5, gy + 1, 7, 2)
  imgs = [_arch_balloon(c) for c in cols]
  # Clusters of three balloons along the line, colours turning round it like a garland.
  for i, (x, y) in enumerate(pts):
    for j, (ox, oy) in enumerate(((-3, -2), (3, -1), (0, 2))):
      b = imgs[(i + j) % len(imgs)]
      paste(img, b, int(round(x + ox - 4.5)), int(round(y + oy - 4.5)))
  return Made([Piece(img, dx=0, dy=-top)], foot=(length, 1), solid=[(0, 0), (length - 1, 0)])
