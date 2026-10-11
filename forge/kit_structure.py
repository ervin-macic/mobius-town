"""Kit family: structure items for Möbius Town builders (registered on import by kit.py).

Conventions (see kit.py's docstring for the full contract):
- `@item(name, 'structure', doc, foot=(w, h), variants=[...], **params)`; the function returns `Made`.
- Draw in the town's palette with kit's helpers (tones, outlined, block, post, foliage, pixel_text ...),
  dark plum outline OUT (OUT_SOFT for foliage), light from the upper left, 2-4 flat shades, no
  anti-aliasing, soft SHADOW ellipse under standing things, 3/4 top-down view.
- Deterministic: randomness only from noise_rng(seed).

Runs (fence, wall) and how they join
------------------------------------
The compiler turns a spec's `walls` lines into fence/wall runs. Each run draws itself alone, so the
joins are designed into the pieces:
- Posts (fence) and piers (wall) stand at tile centres, like the pack's own fence, so an L whose two
  runs share the corner tile meets at one post/pier.
- A run's end posts/piers are taller than its inner ones; a vertical run's first one rises a full
  tile pitch, so a vertical run that starts just below a horizontal run (abutting) still touches it.
- A vertical run's end rows sort a pixel after their row (z + 1) and its inner rows a pixel before
  (z - 1): at a corner the vertical run is drawn over the horizontal one (its coping covers the
  horizontal wall's face, as it should), while a horizontal run that ends against a vertical run's
  side draws its end post/pier over it.
"""
from __future__ import annotations

import math

from kit import *  # noqa: F401,F403
from kit import (  # noqa: F401
  Made, Param, Piece, T, item, rows_of, standing, to_rgba, tones,
)

# The pack's ground shadow (its fence and stall use this exact plum at 40% alpha).
PACK_SHADOW = (32, 23, 41, 102)


# --- Small private helpers -------------------------------------------------------------------------

def _sprite(rows, pal):
  """A tiny sprite from a character grid ('.' = transparent) and a {char: colour} palette."""
  h = len(rows)
  w = max(len(r) for r in rows)
  img = new(w, h)
  px = img.load()
  for y, row in enumerate(rows):
    for x, ch in enumerate(row):
      if ch in pal:
        px[x, y] = pal[ch]
  return img


def _ramp(colour, default):
  """(hi, base, lo, deep) for a user colour, or the given default ramp."""
  return tones(colour) if colour else default


def _put_shadow(img, pts):
  """Paint ground-shadow pixels (a set of (x, y)) without darkening twice."""
  px = img.load()
  w, h = img.size
  for (x, y) in pts:
    if 0 <= x < w and 0 <= y < h and px[x, y][3] == 0:
      px[x, y] = PACK_SHADOW


def _split_word(word, max_w, font):
  """Break one too-long word into balanced pieces that fit max_w, hyphenated where it breaks."""
  for n in range(2, len(word) + 1):
    size = -(-len(word) // n)
    parts = [word[i:i + size] for i in range(0, len(word), size)]
    parts = [p + '-' for p in parts[:-1]] + parts[-1:]
    if all(text_size(p, font)[0] <= max_w for p in parts):
      return parts
  return [word]


def _fit(text, max_w, max_h, fonts=('big', 'mini', 'small'), max_lines=2, gap=1):
  """Like kit.fit_text, but before cutting text off it breaks a too-long word over two lines.

  Returns (font, lines). Prefers clean word wrapping in any font, then hyphenated words, and only
  then shortens the text (kit.fit_text's fallback).
  """
  def fits(lines, f):
    return lines is not None and len(lines) <= max_lines and \
      len(lines) * font_height(f) + (len(lines) - 1) * gap <= max_h

  for f in fonts:
    lines = wrap_text(text, max_w, f, max_lines)
    if fits(lines, f):
      return f, lines
  def split_lines(f):
    words = []
    for wd in text.split():
      words += _split_word(wd, max_w, f) if text_size(wd, f)[0] > max_w else [wd]
    lines, cur = [], ''
    for wd in words:
      trial = wd if not cur else cur + ' ' + wd
      if cur and (text_size(trial, f)[0] > max_w or cur.endswith('-')):
        lines.append(cur)
        cur = wd
      else:
        cur = trial
    if cur:
      lines.append(cur)
    return lines

  for f in fonts:
    lines = split_lines(f)
    if fits(lines, f):
      return f, lines
  # Too long for the space: keep the lines that fit in the smallest font and mark the cut.
  f = fonts[-1]
  n = max(1, min(max_lines, (max_h + gap) // (font_height(f) + gap)))
  lines = split_lines(f)[:n] or ['']
  last = lines[-1].rstrip('-') + '..'
  while len(last) > 2 and text_size(last, f)[0] > max_w:
    last = last[:-3].rstrip() + '..'
  lines[-1] = last
  return f, lines


def _trim(img, dx, dy):
  """Crop an image's fully transparent margins; returns (image, dx, dy) placed where it was."""
  box = img.getbbox()
  if not box:
    return img, dx, dy
  return img.crop(box), dx + box[0], dy + box[1]


def _bands(img, dx, dy, layer='over', max_h=6 * T):
  """Pieces for an overhead image taller than a piece may be: horizontal bands of at most max_h."""
  img, dx, dy = _trim(img, dx, dy)
  out = []
  for y in range(0, img.height, max_h):
    band = img.crop((0, y, img.width, min(img.height, y + max_h)))
    if band.getbbox():
      out.append(Piece(band, dx=dx, dy=dy + y, layer=layer))
  return out


def _vrun(img, length, top):
  """rows_of for a north-south run, nudging each row's sort line by a pixel (see the module doc).

  The end rows sort just after their line (+1) and the inner rows just before it (-1), so where a
  horizontal run meets this one the end post/pier on top is the right one: a vertical run's own end
  at a corner, a horizontal run's end where it butts into this run's side.
  """
  pieces = rows_of(img, 1, length, dx=0, top=top)
  for i, p in enumerate(pieces):
    p.z += 1 if i in (0, len(pieces) - 1) else -1
  return pieces


# --- Fence ---------------------------------------------------------------------------------------------

# The pack's fence post (Overworld.png tile 0,19): 6 x 12, base on row 13 of its tile.
# a = dark wood (left/top edge and grain), b = light, d = mid, c = outline.
_POST = ['..aa..', '.abba.', 'abbbbc', 'abddbc', 'addddc', 'addddc', 'adddac', 'adadac', 'adaaac', 'adaaac',
         'aacaac', 'accccc']
# End/corner post: four rows taller, so a vertical run's first post reaches the row above it.
_POST_TALL = ['..aa..', '.abba.', 'abbbbc', 'abddbc', 'addddc', 'addddc', 'adddac', 'addddc', 'addddc', 'adddac',
              'adadac', 'adaaac', 'adaaac', 'adaaac', 'aacaac', 'accccc']

WOOD_FENCE = ((148, 120, 92, 255), (121, 88, 79, 255), (86, 58, 63, 255), OUT)  # hi, base, dark, outline


def _fence_pal(colour):
  if colour:
    hi, base, lo, deep = tones(colour)
    return {'b': hi, 'd': base, 'a': lo, 'c': OUT}
  hi, base, dark, out = WOOD_FENCE
  return {'b': hi, 'd': base, 'a': dark, 'c': out}


def _wood_post(pal, tall):
  return _sprite(_POST_TALL if tall else _POST, pal)


def _post_top(tall):
  """Row (relative to the tile top) of a fence post's first pixel; bases are on row 13."""
  return -2 if tall else 2


def _fence_h_wood(length, pal):
  """Horizontal wooden fence: image spans the footprint; its top is 3 px above it."""
  W, H, oy = length * T, 19, 3
  img = new(W, H)
  shadow = set()
  xs = [k * T + 5 for k in range(length)]  # post left columns (6 px wide)
  # Rails between posts (and half rails to the edges for a lone post).
  spans = [(xs[i] + 6, xs[i + 1] - 1) for i in range(length - 1)]
  if length == 1:
    spans = [(0, xs[0] - 1), (xs[0] + 6, W - 1)]
  for (a, b) in spans:
    for x in range(a, b + 1):
      for dy, ch in ((7, 'a'), (8, 'd'), (9, 'a'), (10, 'c')):
        img.putpixel((x, oy + dy), pal[ch])
      shadow.add((x, oy + 13))
      shadow.add((x, oy + 14))
  for k, x0 in enumerate(xs):
    tall = k in (0, length - 1)
    post = _wood_post(pal, tall)
    paste(img, post, x0, oy + _post_top(tall))
    shadow |= {(x0 + 6, oy + 13)} | {(x0 + i, oy + 14) for i in range(2, 7)} | {(x0 + i, oy + 15) for i in range(4, 9)}
  _put_shadow(img, shadow)
  return Piece(img, dx=0, dy=-oy)


def _fence_v_wood(length, pal):
  """North-south wooden fence: one post per row joined by short end-on rails (the pack's enclosure)."""
  top = 3
  W, H = T, length * T + top
  img = new(W, H)
  shadow = set()
  for r in range(length - 1):
    # Connector from this post's base (row 13) to the next post's top.
    y0 = top + r * T + 12
    y1 = top + (r + 1) * T + _post_top(r + 1 == length - 1) + 1
    for y in range(y0, y1 + 1):
      for dx, ch in ((6, 'a'), (7, 'd'), (8, 'a'), (9, 'c')):
        img.putpixel((dx, y), pal[ch])
      shadow.add((10, y + 1))
      shadow.add((11, y + 1))
  for r in range(length):
    tall = r in (0, length - 1)
    y_top = top + r * T + _post_top(tall)
    paste(img, _wood_post(pal, tall), 5, y_top)
    b = top + r * T + 13
    shadow |= {(11, b)} | {(i, b + 1) for i in range(7, 12)} | {(i, b + 2) for i in range(9, 13)}
    shadow |= {(11, y) for y in range(y_top + 5, b)}
  _put_shadow(img, shadow)
  return _vrun(img, length, top)


# Picket fence: square posts with a cap, two rails, pointed pickets between.
PICKET_WHITE = ((252, 252, 248, 255), (226, 226, 230, 255), (178, 176, 196, 255), (120, 112, 140, 255))


def _picket_board(img, x, y_tip, y_base, ramp):
  """One 3 px picket with a pointed top (no outline)."""
  hi, base, lo, deep = ramp
  put(img, x + 1, y_tip, hi)
  rect(img, x, y_tip + 1, 3, y_base - y_tip, base)
  vline(img, x, y_tip + 1, y_base - y_tip, hi)
  vline(img, x + 2, y_tip + 2, y_base - y_tip - 1, lo)
  put(img, x + 1, y_base, lo)


def _picket_post(img, x, t, b, ramp):
  """A 4 px square fence post from row t (cap) to row b (base), with a dark seam each side."""
  hi, base, lo, deep = ramp
  rect(img, x, t, 4, b - t + 1, base)
  vline(img, x, t + 1, b - t, hi)
  vline(img, x + 3, t + 1, b - t, lo)
  hline(img, x, t, 4, hi)
  hline(img, x, t + 2, 4, lo)
  put(img, x, t + 2, base)


def _fence_h_picket(length, ramp):
  W, H, oy = length * T, 19, 3
  body = new(W, H)
  posts = [k * T + 6 for k in range(length)]  # 4 px posts (6..9)
  # Three pointed boards between posts (1 px gaps, which the outline fills).
  pick_x = [1, 12] if length == 1 else []
  for k in range(length - 1):
    pick_x += [posts[k] + 5, posts[k] + 9, posts[k] + 13]
  for x in pick_x:
    _picket_board(body, x, oy + 4, oy + 12, ramp)
  for k, x in enumerate(posts):
    tall = k in (0, length - 1)
    _picket_post(body, x, oy + (-1 if tall else 2), oy + 12, ramp)
  img = outlined(body)
  a = 0 if length == 1 else posts[0] + 2
  b = W if length == 1 else posts[-1] + 6
  shadow = {(x, oy + 14) for x in range(a + 1, b)} | {(x, oy + 15) for x in range(a + 3, b + 1, 2)}
  _put_shadow(img, shadow)
  return Piece(img, dx=0, dy=-oy)


def _fence_v_picket(length, ramp):
  hi, base, lo, deep = ramp
  top = 3
  W, H = T, length * T + top
  body = new(W, H)
  for r in range(length):
    tall = r in (0, length - 1)
    yb = top + r * T + 12
    if r < length - 1:
      # Pickets seen end-on: a narrow strip with a notch where each board's point is.
      ya, yz = yb - 3, top + (r + 1) * T + 12
      rect(body, 7, ya, 2, yz - ya, hi)
      vline(body, 8, ya, yz - ya, lo)
      for y in range(ya + 3, yz - 1, 4):
        put(body, 8, y, deep)
    _picket_post(body, 6, top + r * T + (-1 if tall else 2), yb, ramp)
  img = outlined(body)
  shadow = {(11, y) for y in range(top + 2, H - 1)} | {(12, y) for y in range(top + 5, H)}
  _put_shadow(img, shadow)
  return _vrun(img, length, top)


IRON = ((122, 120, 142, 255), (66, 62, 82, 255), (44, 38, 56, 255), (28, 22, 36, 255))


def _fence_h_iron(length, ramp):
  hi, base, lo, deep = ramp
  W, H, oy = length * T, 21, 5
  img = new(W, H)
  posts = [k * T + 6 for k in range(length)]
  a, b = (0, W - 1) if length == 1 else (posts[0] + 4, posts[-1] - 1)
  # Rails.
  hline(img, a, oy + 3, b - a + 1, base)
  hline(img, a, oy + 4, b - a + 1, deep)
  hline(img, a, oy + 11, b - a + 1, base)
  hline(img, a, oy + 12, b - a + 1, deep)
  # Bars with spear tips every 3 px.
  for x in range(a + 1, b, 3):
    if any(p - 1 <= x <= p + 4 for p in posts):
      continue
    vline(img, x, oy + 1, 12, lo)
    put(img, x, oy + 0, hi)
    put(img, x - 1, oy + 1, deep)
    put(img, x + 1, oy + 1, deep)
  # Posts: 4 px square bars with a ball finial; the end ones taller.
  for k, x in enumerate(posts):
    tall = k in (0, length - 1)
    t = oy + (-3 if tall else 1)
    rect(img, x, t + 3, 4, oy + 14 - t - 3, base)
    vline(img, x, t + 3, oy + 14 - t - 3, hi)
    vline(img, x + 3, t + 3, oy + 14 - t - 3, deep)
    hline(img, x, oy + 13, 4, deep)
    rect(img, x + 1, t, 2, 3, base)
    put(img, x + 1, t, hi)
    hline(img, x, t + 2, 4, deep)
  shadow = {(x, oy + 14) for x in range(a + 1, min(W, b + 3))} | {(x, oy + 15) for x in range(a + 2, min(W, b + 3), 2)}
  _put_shadow(img, shadow)
  return Piece(img, dx=0, dy=-oy)


def _fence_v_iron(length, ramp):
  hi, base, lo, deep = ramp
  top = 5
  W, H = T, length * T + top
  img = new(W, H)
  for r in range(length):
    tall = r in (0, length - 1)
    yb = top + r * T + 13
    t = top + r * T + (-3 if tall else 1)
    if r < length - 1:
      ya, yz = yb - 10, top + (r + 1) * T + 13
      rect(img, 7, ya, 2, yz - ya, lo)
      vline(img, 7, ya, yz - ya, base)
      for y in range(ya + 1, yz, 3):
        put(img, 7, y, hi)
    rect(img, 6, t + 3, 4, yb - t - 3 + 1, base)
    vline(img, 6, t + 3, yb - t - 3 + 1, hi)
    vline(img, 9, t + 3, yb - t - 3 + 1, deep)
    rect(img, 7, t, 2, 3, base)
    put(img, 7, t, hi)
    hline(img, 6, t + 2, 4, deep)
  shadow = {(10, y) for y in range(top + 2, H - 1)} | {(11, y) for y in range(top + 5, H)}
  _put_shadow(img, shadow)
  return _vrun(img, length, top)


ROPE = ((236, 216, 166, 255), (206, 172, 112, 255), (150, 112, 74, 255), (104, 72, 56, 255))


def _bollard(pal, tall):
  """A short round wooden post for rope fences (5 x 10, 5 x 13 when tall)."""
  h = 13 if tall else 10
  rows = ['.aba.', 'abbbc', 'adbdc', 'addcc'] + ['adddc'] * (h - 6) + ['addac', 'acccc']
  return _sprite(rows, pal)


def _fence_h_rope(length, rope_ramp, pal):
  hi, base, lo, deep = rope_ramp
  W, H, oy = length * T, 19, 3
  img = new(W, H)
  posts = [k * T + 6 for k in range(length)]
  spans = [(posts[i] + 4, posts[i + 1] + 0) for i in range(length - 1)]
  if length == 1:
    spans = [(-2, posts[0]), (posts[0] + 4, W + 2)]
  shadow = set()
  for (a, b) in spans:
    n = b - a
    for i in range(n + 1):
      x = a + i
      t = i / max(1, n)
      sag = 3.2 * 4 * t * (1 - t)
      y = oy + 6 + int(round(sag))
      if 0 <= x < W:
        put(img, x, y, hi if (x % 3) else base)
        put(img, x, y + 1, lo if (x % 3) else deep)
        if img.getpixel((x, y - 1))[3] == 0:
          put(img, x, y - 1, OUT)
        put(img, x, y + 2, OUT)
        shadow.add((x + 1, oy + 13 + int(round(sag / 2))))
  for k, x in enumerate(posts):
    tall = k in (0, length - 1)
    b = _bollard(pal, tall)
    paste(img, b, x, oy + 14 - b.height)
    shadow |= {(x + 4, oy + 13), (x + 5, oy + 13)} | {(x + i, oy + 14) for i in range(1, 7)}
  _put_shadow(img, shadow)
  return Piece(img, dx=0, dy=-oy)


def _fence_v_rope(length, rope_ramp, pal):
  hi, base, lo, deep = rope_ramp
  top = 3
  W, H = T, length * T + top
  img = new(W, H)
  shadow = set()
  for r in range(length - 1):
    ya = top + r * T + 9
    yz = top + (r + 1) * T + 14 - (13 if r + 1 == length - 1 else 10)
    for y in range(ya, yz + 1):
      put(img, 7, y, hi if y % 3 else base)
      put(img, 8, y, lo if y % 3 else deep)
      put(img, 6, y, OUT)
      put(img, 9, y, OUT)
      shadow.add((10, y + 2))
  for r in range(length):
    tall = r in (0, length - 1)
    b = _bollard(pal, tall)
    yb = top + r * T + 14
    paste(img, b, 6, yb - b.height)
    shadow |= {(11, yb - 1), (12, yb - 1)} | {(i, yb) for i in range(7, 13)}
  _put_shadow(img, shadow)
  return _vrun(img, length, top)


@item('fence', 'structure',
      'Fence run: wood, white picket, iron railing or rope; 1-16 tiles west-east or north-south. Runs that meet '
      'should share the corner tile. Solid.',
      (4, 1),
      variants=[{'style': 'picket', 'length': 3}, {'style': 'iron', 'length': 3, 'vertical': True},
                {'style': 'rope', 'length': 3, 'colour': 'crimson'}],
      length=Param('int', 4, 1, 16, doc='tiles along the run'),
      vertical=Param('bool', False, doc='run north-south instead of west-east'),
      style=Param('enum', 'wood', choices=('wood', 'picket', 'iron', 'rope')),
      colour=Param('colour', None, doc='paint (picket white, iron black, wood natural, rope hemp)'))
def _fence(length, vertical, style, colour):
  foot = (1, length) if vertical else (length, 1)
  if style == 'wood':
    pal = _fence_pal(colour)
    pieces = _fence_v_wood(length, pal) if vertical else [_fence_h_wood(length, pal)]
  elif style == 'picket':
    ramp = _ramp(colour, PICKET_WHITE)
    pieces = _fence_v_picket(length, ramp) if vertical else [_fence_h_picket(length, ramp)]
  elif style == 'iron':
    ramp = _ramp(colour, IRON)
    pieces = _fence_v_iron(length, ramp) if vertical else [_fence_h_iron(length, ramp)]
  else:
    rope = _ramp(colour, ROPE)
    pal = _fence_pal(None)
    pieces = _fence_v_rope(length, rope, pal) if vertical else [_fence_h_rope(length, rope, pal)]
  return Made(pieces, foot=foot)


# --- Wall ------------------------------------------------------------------------------------------------

# A low garden wall, 8 px thick and 12 px tall, centred in its row/column; piers (10 px square, 15 px
# tall) at both ends. Screen rows below are relative to the tile row the wall stands in.
WALL_H = 12
STONE_WALL = {
  'cap': ((236, 236, 232, 255), (212, 212, 210, 255), (182, 184, 190, 255), (150, 154, 166, 255)),
  'face': ((196, 198, 202, 255), (166, 170, 180, 255), (138, 142, 156, 255), (104, 106, 124, 255)),
}
BRICK_WALL = {
  'cap': ((236, 230, 220, 255), (214, 208, 198, 255), (184, 178, 176, 255), (150, 142, 150, 255)),
  'face': ((222, 128, 96, 255), (190, 92, 70, 255), (150, 66, 60, 255), (104, 48, 56, 255)),
}


def _wall_face(img, x, y, w, h, style, seed, ramp):
  """The darker front face: rubble stones or brick courses (no outline)."""
  hi, base, lo, deep = ramp
  rect(img, x, y, w, h, lo)
  rng = noise_rng(seed)
  if style == 'brick':
    mortar = (176, 160, 150, 255)
    rect(img, x, y, w, h, mortar)
    row = 0
    for yy in range(y, y + h, 3):
      off = 0 if row % 2 == 0 else 3
      for xx in range(x - off, x + w, 6):
        bx0, bx1 = max(x, xx), min(x + w, xx + 5)
        c = base if rng.random() < 0.7 else (lo if rng.random() < 0.5 else hi)
        hh = min(2, y + h - yy)
        if bx1 > bx0 and hh > 0:
          rect(img, bx0, yy, bx1 - bx0, hh, c)
          if hh == 2:
            hline(img, bx0, yy + 1, bx1 - bx0, lo if c != lo else deep)
      row += 1
  else:
    # Rubble: courses of irregular stones with dark joints.
    rect(img, x, y, w, h, deep)
    yy, row = y, 0
    heights = [4, 4, 3]
    while yy < y + h:
      sh = min(heights[row % 3], y + h - yy)
      xx = x - rng.randint(0, 4)
      while xx < x + w:
        sw = rng.randint(4, 7)
        bx0, bx1 = max(x, xx), min(x + w, xx + sw - 1)
        if bx1 > bx0 and sh > 1:
          c = rng.choice((base, base, hi, lo))
          rect(img, bx0, yy, bx1 - bx0, sh - 1, c)
          hline(img, bx0, yy, bx1 - bx0, hi if c != hi else base)
        xx += sw
      yy += sh
      row += 1


def _wall_cap(img, x, y, w, h, ramp, along_y=False, seed=0):
  """The lit top (coping): flat slabs with fine joints, a bright north edge."""
  hi, base, lo, deep = ramp
  rect(img, x, y, w, h, base)
  if along_y:
    vline(img, x, y, h, hi)
    vline(img, x + w - 1, y, h, lo)
    for yy in range(y + 5, y + h, 7):
      hline(img, x, yy, w, lo)
      hline(img, x, yy + 1, w, hi)
  else:
    hline(img, x, y, w, hi)
    hline(img, x, y + h - 1, w, lo)
    rng = noise_rng(seed + 7)
    xx = x + rng.randint(4, 9)
    while xx < x + w - 2:
      vline(img, xx, y + 1, h - 2, lo)
      vline(img, xx + 1, y + 1, h - 2, hi)
      xx += rng.randint(9, 13)


def _pier(style, pal):
  """A wall pier: 10 x 10 top, 15 px tall front; returned outlined with its own full outline (12 x 27)."""
  cap, face = pal['cap'], pal['face']
  img = new(12, 27)
  # Top (rows 1..10), slightly overhanging cap stone.
  rect(img, 1, 1, 10, 10, cap[1])
  hline(img, 1, 1, 10, cap[0])
  vline(img, 1, 1, 10, cap[0])
  vline(img, 10, 2, 9, cap[2])
  hline(img, 2, 10, 9, cap[2])
  rect(img, 3, 3, 6, 6, cap[1])
  put(img, 3, 3, cap[0])
  # Cap's front edge, then the face (rows 11..25).
  hline(img, 1, 11, 10, cap[3])
  _wall_face(img, 1, 12, 10, 14, style, 3, face)
  vline(img, 1, 12, 14, face[0])
  vline(img, 10, 12, 14, face[3])
  return outlined(img)


def _wall_h(length, style, pal, seed):
  """Horizontal wall: piers at the end tiles, an 8 px thick wall between. Image top = 13 px above the row."""
  oy = 13
  W, H = length * T, oy + 16
  segs = new(W, H)
  if length > 1:
    x0, x1 = 8, length * T - 8  # from the first pier's middle to the last's
    body = new(W, H)
    _wall_cap(body, x0, oy - 8, x1 - x0, 8, pal['cap'], seed=seed)
    hline(body, x0, oy, x1 - x0, pal['cap'][3])  # shadow line under the coping
    _wall_face(body, x0, oy + 1, x1 - x0, WALL_H - 1, style, seed, pal['face'])
    segs = outlined(body)
  img = new(W, H)
  sh = new(W, H)
  drop = {(x, oy + 12) for x in range(9, W - 6)} | {(x, oy + 13) for x in range(10, W - 5)}
  _put_shadow(sh, drop)
  paste(img, sh, 0, 0)
  paste(img, segs, 0, 0)
  pier = _pier(style, pal)
  for k in (0, length - 1):
    paste(img, pier, k * T + 2, oy - 13)
    _put_shadow(img, {(k * T + 13, oy + y) for y in range(-1, 13)} | {(k * T + 14, oy + y) for y in range(2, 14)})
  return Piece(img, dx=0, dy=-oy)


def _wall_v(length, style, pal, seed):
  """North-south wall: the coping strip runs down the column between the end piers (the end faces show)."""
  top = 13
  W, H = T, top + length * T
  img = new(W, H)
  shadow = {(12, y) for y in range(top - 6, H - 3)} | {(13, y) for y in range(top - 4, H - 2)}
  _put_shadow(img, shadow)
  pier = _pier(style, pal)
  paste(img, pier, 2, top - 13)
  if length > 1:
    body = new(W, H)
    # The strip's top runs from the first pier's south face to the last pier (which covers its end).
    y0 = top + 13 - WALL_H + 0
    y1 = top + (length - 1) * T + 4 - WALL_H + 2
    _wall_cap(body, 4, y0, 8, y1 - y0, pal['cap'], along_y=True, seed=seed)
    paste(img, outlined(body), 0, 0)
    paste(img, pier, 2, top + (length - 1) * T - 13)
  return _vrun(img, length, top)


@item('wall', 'structure',
      'Low garden wall in stone or brick with piers at its ends; 1-16 tiles west-east or north-south. Runs that '
      'meet should share the corner tile. Solid.',
      (4, 1),
      variants=[{'style': 'brick', 'length': 3}, {'style': 'stone', 'length': 3, 'vertical': True}],
      length=Param('int', 4, 1, 16, doc='tiles along the run'),
      vertical=Param('bool', False, doc='run north-south instead of west-east'),
      style=Param('enum', 'stone', choices=('stone', 'brick')),
      seed=Param('int', 1, 0, 9999))
def _wall(length, vertical, style, seed):
  pal = BRICK_WALL if style == 'brick' else STONE_WALL
  if vertical:
    return Made(_wall_v(length, style, pal, seed), foot=(1, length))
  return Made([_wall_h(length, style, pal, seed)], foot=(length, 1))


# --- Garden structures: arch, pergola, gazebo -------------------------------------------------------------

PAINT_WHITE = ((252, 252, 248, 255), (230, 230, 234, 255), (186, 184, 204, 255), (128, 120, 148, 255))
TIMBER = ((207, 160, 104, 255), (168, 120, 72, 255), (136, 86, 64, 255), (96, 52, 56, 255))


def _blossoms(img, mask, n, colour, seed, size=3):
  """Scatter little flowers over foliage pixels (a set of (x, y)); returns the flower centres."""
  rng = noise_rng(seed)
  hi, base, lo, deep = tones(colour)
  pts = sorted(mask)
  out = []
  for _ in range(n * 4):
    if len(out) >= n or not pts:
      break
    x, y = pts[rng.randrange(len(pts))]
    if any(abs(x - a) < 4 and abs(y - b) < 4 for (a, b) in out):
      continue
    out.append((x, y))
    if size >= 3:
      for (ddx, ddy) in ((0, -1), (-1, 0), (1, 0), (0, 1)):
        put(img, x + ddx, y + ddy, base)
      put(img, x - 1, y - 1, hi)
      put(img, x, y, deep if size > 3 else lo)
      put(img, x + 1, y + 1, lo)
    else:
      put(img, x, y, base)
      put(img, x + 1, y, lo)
      put(img, x, y - 1, hi)
  return out


def _arch_band(w, h, cx, cy, rx_o, ry_o, rx_i, ry_i):
  """Pixels between two upper half-ellipses (an arch band) on a w x h canvas."""
  pts = set()
  for y in range(max(0, int(cy - ry_o) - 1), min(h, int(cy) + 1)):
    for x in range(max(0, int(cx - rx_o) - 1), min(w, int(cx + rx_o) + 2)):
      ddx, ddy = x + 0.5 - cx, y + 0.5 - cy
      if ddy > 0.5:
        continue
      o = (ddx / rx_o) ** 2 + (ddy / ry_o) ** 2
      i = (ddx / rx_i) ** 2 + (ddy / ry_i) ** 2 if rx_i > 0 and ry_i > 0 else 2
      if o <= 1.0 and i > 1.0:
        pts.add((x, y))
  return pts


def _leafy(clumps, w, h, pal=LEAVES, seed=0):
  """Leaf clusters like the town's bushes: each clump (cx, cy, r) lit at its own upper left.

  Clumps are drawn in order (later ones in front); the union gets the soft foliage outline.
  Returns (image, mask).
  """
  rng = noise_rng(seed)
  light, base, mid, deep = pal
  img = new(w, h)
  px = img.load()
  mask = set()
  for (cx, cy, r) in clumps:
    ry = r * 0.92
    for y in range(max(1, int(cy - ry) - 1), min(h - 1, int(cy + ry) + 2)):
      for x in range(max(1, int(cx - r) - 1), min(w - 1, int(cx + r) + 2)):
        ddx, ddy = (x + 0.5 - cx) / r, (y + 0.5 - cy) / ry
        d = ddx * ddx + ddy * ddy
        if d > 1.0:
          continue
        t = 0.55 * ddx + 0.75 * ddy + rng.uniform(-0.12, 0.12)
        c = light if t < -0.45 else base if t < 0.15 else mid if t < 0.62 else deep
        if d > 0.7 and c == light:
          c = base
        px[x, y] = c
        mask.add((x, y))
  # A few leaf glints.
  pts = sorted(mask)
  for _ in range(len(clumps) if pts else 0):
    x, y = pts[rng.randrange(len(pts))]
    if (x + 1, y) in mask and (x, y + 1) in mask and px[x, y] in (base, mid):
      put(img, x, y, light if px[x, y] == base else base)
  return outline(img, OUT_SOFT), mask


def _arch_trellis(width, style, colour, seed):
  W = width * T
  pad, top = 6, 46  # canvas: 6 px each side of the footprint, top 46 px above it
  CW, CH = W + 2 * pad, top + 16
  xl, xr = (pad + 3, pad + W - 4) if width == 2 else (pad + 8, pad + W - 8)
  base_y = top + 13           # post bases
  spring = top - 14           # where the arch starts curving
  cx = (xl + xr) / 2 + 0.5
  rx_o = (xr - xl) / 2 + 2.5
  ry_o = min(rx_o, 15)
  hi, base, lo, deep = PAINT_WHITE if style == 'roses' else TIMBER
  frame_l = new(CW, CH)
  # Lattice posts: two uprights with rungs.
  for xc in (xl, xr):
    vline(frame_l, xc - 2, spring, base_y - spring + 1, hi)
    vline(frame_l, xc + 1, spring, base_y - spring + 1, lo)
    for y in range(spring + 2, base_y - 1, 4):
      hline(frame_l, xc - 1, y, 2, base)
  # Arch: outer and inner rims with ties.
  band = _arch_band(CW, CH, cx, spring + 0.5, rx_o, ry_o, rx_o - 4, ry_o - 4)
  rim = {(x, y) for (x, y) in band if any((x + a, y + b) not in band for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
  for (x, y) in rim:
    put(frame_l, x, y, hi if x < cx else lo)
  for i in range(1, 10):
    a = math.pi * i / 10
    for t in (1.6, 2.4):
      x = cx + (rx_o - t) * math.cos(a)
      y = spring + 0.5 - (ry_o - t) * math.sin(a)
      put(frame_l, int(x), int(y), base)
  frame_l = outlined(frame_l)
  rng = noise_rng(seed)
  vines = style == 'vines'
  # Clumps: a vine winding up each post, then a thick garland along the arch.
  clumps = []
  for xc in (xl, xr):
    clumps.append((xc + rng.uniform(-1, 1), base_y - 3, 4.2))
    start = base_y - (9 if vines else 13)
    side = -1 if xc == xl else 1
    for y in range(start, spring + 2, -6):
      side = -side
      clumps.append((xc + side * rng.uniform(1.5, 2.8) - 0.5, y, rng.uniform(2.2, 2.9)))
  n = 12 + 2 * width
  for i in range(n + 1):
    a = math.pi * i / n
    rr = rng.uniform(-1.2, 1.0)
    x = cx + (rx_o - 2 + rr) * math.cos(a)
    y = spring + 0.5 - (ry_o - 2 + rr) * math.sin(a)
    clumps.append((x, y, rng.uniform(2.6, 3.6) + (0.3 if vines else 0)))
  if vines:  # trailing strands hanging from the arch
    for i in range(2, n - 1, 3):
      a = math.pi * i / n
      x = cx + (rx_o - 4) * math.cos(a)
      y = spring + 0.5 - (ry_o - 4) * math.sin(a)
      for k in range(rng.randint(1, 3)):
        clumps.append((x + rng.uniform(-1, 1), y + 3 + 3 * k, 1.8))
  clumps.sort(key=lambda c: c[1])
  leaves, mask = _leafy(clumps, CW, CH, LEAVES, seed)
  img = new(CW, CH)
  drop_shadow(img, xl + 1, base_y + 1, 5, 2)
  drop_shadow(img, xr + 1, base_y + 1, 5, 2)
  paste(img, frame_l, 0, 0)
  paste(img, leaves, 0, 0)
  if style == 'roses':
    _blossoms(img, mask, 7 + 3 * width, colour or 'rose', seed + 3)
  elif colour:
    _blossoms(img, mask, 5 + 2 * width, colour, seed + 3, size=2)
  tufts(img, xl, base_y + 1, 1, seed)
  tufts(img, xr, base_y + 1, 1, seed + 1)
  return img, pad, top, spring


def _arch_stone(width, seed):
  W = width * T
  pad, top = 6, 46
  CW, CH = W + 2 * pad, top + 16
  pw = 8  # pillar width
  xl, xr = (pad + 1, pad + W - 1 - pw) if width == 2 else (pad + 4, pad + W - 4 - pw)
  base_y = top + 13
  spring = top - 13
  inner_l, inner_r = xl + pw, xr  # the opening
  cx = (inner_l + inner_r) / 2
  rx_i = (inner_r - inner_l) / 2
  ry_i = min(rx_i, 12)
  rx_o, ry_o = rx_i + 7, ry_i + 7
  s_hi, s_base, s_lo, s_deep = (226, 226, 222, 255), (198, 198, 196, 255), (160, 164, 174, 255), (120, 124, 140, 255)
  body = new(CW, CH)
  # Pillars: stone courses, lit left edge, dark right edge; impost and plinth a little wider.
  for x0 in (xl, xr):
    rect(body, x0, spring, pw, base_y - spring + 1, s_base)
    for k, y in enumerate(range(spring + 3, base_y, 4)):
      hline(body, x0, y, pw, s_lo)
      vline(body, x0 + (3 if k % 2 else 5), y - 3, 3, s_lo)
    vline(body, x0, spring, base_y - spring + 1, s_hi)
    vline(body, x0 + pw - 1, spring, base_y - spring + 1, s_deep)
    rect(body, x0 - 1, spring - 1, pw + 2, 3, s_hi)
    hline(body, x0 - 1, spring + 1, pw + 2, s_lo)
    rect(body, x0 - 1, base_y - 2, pw + 2, 3, s_lo)
    hline(body, x0 - 1, base_y - 2, pw + 2, s_base)
  # Arch: voussoirs between two half ellipses, keystone at the top.
  band = _arch_band(CW, CH, cx, spring + 0.5, rx_o, ry_o, rx_i, ry_i)
  for (x, y) in band:
    a = math.atan2(spring + 0.5 - (y + 0.5), (x + 0.5) - cx)
    k = int(a / (math.pi / 9))
    c = s_base if k % 2 else s_hi
    if x > cx + 2:
      c = s_base if k % 2 else s_lo
    put(body, x, y, c)
  for i in range(1, 9):
    a = math.pi * i / 9
    for t in range(0, 8):
      x = cx + (rx_i + t) * math.cos(a)
      y = spring + 0.5 - (ry_i + t) * math.sin(a)
      if (int(x), int(y)) in band:
        put(body, int(x), int(y), s_deep if x > cx else s_lo)
  # Keystone.
  kx, ky = int(cx) - 2, int(spring - ry_o) - 1
  rect(body, kx, ky, 5, 8, s_hi)
  vline(body, kx + 4, ky + 1, 7, s_lo)
  hline(body, kx, ky + 7, 5, s_lo)
  # A few dark moss specks for age.
  rng = noise_rng(seed)
  for _ in range(5):
    x, y = rng.choice(sorted(band))
    put(body, x, y, (150, 170, 130, 255))
  img = new(CW, CH)
  drop_shadow(img, xl + pw / 2 + 1, base_y + 1, 6, 2)
  drop_shadow(img, xr + pw / 2 + 1, base_y + 1, 6, 2)
  paste(img, outlined(body), 0, 0)
  tufts(img, xl + 2, base_y + 1, 1, seed)
  tufts(img, xr + 4, base_y + 1, 1, seed + 1)
  return img, pad, top, spring


@item('arch', 'structure',
      'Garden arch to walk under: rose or vine trellis, or a stone archway. Its end tiles hold the posts (solid; '
      'width 2 is all open).',
      (3, 1),
      variants=[{'style': 'vines', 'width': 2}, {'style': 'stone', 'width': 4}, {'style': 'roses', 'colour': 'gold'}],
      width=Param('int', 3, 2, 4, doc='tiles wide; the end tiles hold the posts'),
      style=Param('enum', 'roses', choices=('roses', 'vines', 'stone')),
      colour=Param('colour', None, doc='flower colour (roses default rose pink)'),
      seed=Param('int', 1, 0, 9999))
def _arch(width, style, colour, seed):
  if style == 'stone':
    img, pad, top, spring = _arch_stone(width, seed)
  else:
    img, pad, top, spring = _arch_trellis(width, style, colour, seed)
  split = spring + 2  # everything above the people's heads goes overhead
  upper = img.crop((0, 0, img.width, split))
  lower = img.crop((0, split, img.width, img.height))
  pieces = [Piece(lower, dx=-pad, dy=split - top), Piece(upper, dx=-pad, dy=-top, layer='over')]
  solid = [] if width == 2 else [(0, 0), (width - 1, 0)]
  return Made(pieces, foot=(width, 1), solid=solid)


def _post_img(h, ramp, w=4):
  """A plain square timber post (outlined), w x h body."""
  hi, base, lo, deep = ramp
  img = new(w + 2, h + 2)
  rect(img, 1, 1, w, h, base)
  vline(img, 1, 1, h, hi)
  vline(img, w, 1, h, lo)
  hline(img, 1, h, w, lo)
  return outlined(img)


@item('pergola', 'structure',
      'Pergola: timber posts and a slatted roof overhead, optionally overgrown with vines and hanging flowers. '
      'Only the post tiles block; walk under it.',
      (4, 3),
      variants=[{'w': 3, 'h': 2, 'vines': False, 'colour': 'white'}, {'w': 5, 'h': 3, 'flowers': 'lilac'}],
      w=Param('int', 4, 2, 6, doc='tiles wide'),
      h=Param('int', 3, 2, 6, doc='tiles deep'),
      colour=Param('colour', 'wood', doc='timber colour'),
      vines=Param('bool', True, doc='leafy vines over the roof'),
      flowers=Param('colour', None, doc='hanging flowers among the vines, e.g. lilac wisteria'),
      seed=Param('int', 1, 0, 9999))
def _pergola(w, h, colour, vines, flowers, seed):
  ramp = tones(colour)
  hi, base, lo, deep = ramp
  W = w * T
  PH = 38
  yn, ys = 13, (h - 1) * T + 13  # ground rows of the north and south posts
  xs = [8, W - 8] + ([W // 2] if w >= 5 else [])
  posts = [(x, yn) for x in xs] + [(x, ys) for x in xs]
  if h >= 5:
    posts += [(8, (h // 2) * T + 13), (W - 8, (h // 2) * T + 13)]
  pieces = []
  pad = 6
  top = PH + 12 - yn  # roof canvas rows above the footprint
  oy = top
  s0, s1 = oy + yn - PH - 7, oy + ys - PH + 2  # first and last slat rows (screen)
  slats = list(range(s0, s1 + 1, 6))
  # Ground: the slatted roof's shade, straight below it.
  shade = new(W, h * T)
  for sy in slats:
    rect(shade, 3, sy - oy + PH - 1, W - 6, 3, (24, 18, 40, 40))
  for x in xs:
    rect(shade, x - 2, yn - 4, 4, ys - yn + 6, (24, 18, 40, 48))
  pieces.append(Piece(shade, layer='ground'))
  # Posts (each sorts at its own row).
  pimg = _post_img(PH, ramp, w=4)
  for (x, y) in posts:
    p = new(pimg.width + 4, pimg.height + 2)
    drop_shadow(p, 4.5, pimg.height - 1, 4, 1.6)
    paste(p, pimg, 0, 0)
    pieces.append(Piece(p, dx=x - 3, dy=y - PH - 1, z=y + 3))
  # Roof: beams along the post columns (north-south), slats across them, vines on top.
  CW, CH = W + 2 * pad, top + ys - PH + 14
  beams = new(CW, CH)
  for x in xs:
    bx = pad + x - 2
    rect(beams, bx, oy + yn - PH - 9, 5, ys - yn + 10, base)
    vline(beams, bx, oy + yn - PH - 9, ys - yn + 10, hi)
    vline(beams, bx + 4, oy + yn - PH - 9, ys - yn + 10, lo)
    rect(beams, bx, oy + ys - PH, 5, 3, lo)  # the beam's front end
    hline(beams, bx, oy + ys - PH, 5, base)
  slat_l = new(CW, CH)
  for sy in slats:
    rect(slat_l, pad + 1, sy, W - 2, 2, base)
    hline(slat_l, pad + 1, sy, W - 2, hi)
    put(slat_l, pad + 1, sy + 1, lo)
    put(slat_l, pad + W - 2, sy + 1, deep)
  roof = new(CW, CH)
  paste(roof, outlined(beams), 0, 0)
  paste(roof, outlined(slat_l), 0, 0)
  ry0, ry1 = s0, s1
  if vines:
    rng = noise_rng(seed)
    clumps = []
    for _ in range(int(w * h * 1.6) + 2):
      clumps.append((rng.uniform(pad + 4, pad + W - 4), rng.uniform(ry0 + 2, ry1 - 2), rng.uniform(2.6, 4.2)))
    for x in xs:
      for y in range(ry0 + 2, ry1, 5):
        if rng.random() < 0.6:
          clumps.append((pad + x + rng.uniform(-2, 2), y + rng.uniform(-1, 1), rng.uniform(2.6, 3.8)))
    # Trailing strands below the front beam.
    for x in range(pad + 6, pad + W - 5, 9):
      if rng.random() < 0.65:
        for k in range(rng.randint(1, 3)):
          clumps.append((x + rng.uniform(-1, 1), oy + ys - PH + 2 + 3 * k, 1.9))
    clumps.sort(key=lambda c: c[1])
    leaves, mask = _leafy(clumps, CW, CH, LEAVES, seed)
    paste(roof, leaves, 0, 0)
    if flowers:
      hi2, base2, lo2, deep2 = tones(flowers)
      pts = sorted(mask)
      done = []
      for _ in range(w * h * 4):
        if len(done) >= w * h + 4:
          break
        x, y = pts[rng.randrange(len(pts))]
        if any(abs(x - a) < 4 and abs(y - b) < 4 for (a, b) in done):
          continue
        done.append((x, y))
        # Hanging racemes (wisteria): a short tapering bunch.
        for k, cw in enumerate((3, 3, 2, 1)):
          for i in range(cw):
            put(roof, x - 1 + i + (k // 2), y + k, (hi2, base2, lo2, deep2)[min(3, k + i)] if i else (hi2, hi2, base2, lo2)[k])
  pieces += _bands(roof, -pad, -top)
  solid = sorted({(x // T, y // T) for (x, y) in posts})
  return Made(pieces, foot=(w, h), solid=solid)


def _octagon(cx, cy, r, squash=1.0, rot=math.pi / 8):
  return [(cx + r * math.cos(rot + k * math.pi / 4), cy + squash * r * math.sin(rot + k * math.pi / 4))
          for k in range(8)]


GAZEBO_SQUASH = 0.72  # round things on the ground are seen a little flattened, like the pack's fountains


@item('gazebo', 'structure',
      'Octagonal garden gazebo on a wooden deck with a pointed roof; step in from the south. Its posts block; '
      'the middle and the entrance are open.',
      (3, 3),
      variants=[{'colour': 'red'}, {'colour': 'navy'}],
      colour=Param('colour', '#3f8f6f', doc='roof colour'))
def _gazebo(colour):
  W = H = 3 * T
  cx, cy = 24, 25
  sq = GAZEBO_SQUASH
  pieces = []
  # Deck (ground): an octagon of boards with a dark front edge and two steps at the entrance.
  oct_d = _octagon(cx, cy, 23.5, sq)
  base_layer = new(W, H + 6)
  polygon(base_layer, [(x, y + 3) for (x, y) in oct_d], WOOD_DARK)
  polygon(base_layer, oct_d, WOOD)
  for y in range(0, H + 6):
    for x in range(W):
      c = base_layer.getpixel((x, y))
      if c == WOOD and y % 4 == 3:
        put(base_layer, x, y, WOOD_MID)
      elif c == WOOD and y % 4 == 0:
        put(base_layer, x, y, WOOD_LIGHT if (x + y * 3) % 11 else WOOD)
  sy = int(cy + 23.5 * sq * math.sin(3 * math.pi / 8)) + 1
  rect(base_layer, cx - 7, sy, 14, 3, WOOD)
  hline(base_layer, cx - 7, sy, 14, WOOD_LIGHT)
  rect(base_layer, cx - 7, sy + 3, 14, 2, WOOD_MID)
  pieces.append(Piece(outlined(base_layer), dx=0, dy=0, layer='ground'))
  # Posts and low rails (normal pieces sorted where they stand).
  white = PAINT_WHITE
  verts = _octagon(cx, cy, 20, sq)
  # Vertex order: ESE, SSE, SSW, WSW, WNW, NNW, NNE, ENE (screen y grows south); SSE-SSW is the entrance.
  PH = 36
  for k in range(8):
    if k == 1:
      continue
    a, b = verts[k], verts[(k + 1) % 8]
    x0, x1 = sorted((a[0], b[0]))
    y0, y1 = min(a[1], b[1]), max(a[1], b[1])
    rimg = new(int(x1 - x0) + 6, int(y1 - y0) + 14)
    ox, oy2 = int(x0) - 2, int(y0) - 11
    for t in range(0, 25):
      f = t / 24
      x = a[0] + (b[0] - a[0]) * f - ox
      y = a[1] + (b[1] - a[1]) * f - oy2
      put(rimg, int(x), int(y - 8), white[0])
      put(rimg, int(x), int(y - 7), white[2])
      if t % 4 == 2:
        vline(rimg, int(x), int(y - 6), 6, white[1])
    pieces.append(Piece(outlined(rimg), dx=ox, dy=oy2, z=int(y1) + 1))
  for k, (x, y) in enumerate(verts):
    p = new(10, PH + 6)
    drop_shadow(p, 5.5, PH + 3, 4, 1.5)
    paste(p, _post_img(PH, white, w=3), 2, 1)
    pieces.append(Piece(p, dx=int(x) - 4, dy=int(y) - PH - 2, z=int(y) + 2))
  # Roof (overhead): an octagonal pyramid with shingle courses, a white fascia and a gold finial.
  EH, RH = PH + 1, 24
  pad, top = 4, EH + RH + 10 - cy + 2
  CW, CH = W + 2 * pad, top + 16
  roof = new(CW, CH)
  hi, base, lo, deep = tones(colour)
  peak = (cx + pad, cy - EH - RH + top)
  eave = [(x + pad, y - EH + top) for (x, y) in _octagon(cx, cy, 24.5, sq)]
  faces = []
  for k in range(8):
    a, b = eave[k], eave[(k + 1) % 8]
    mid_ang = math.pi / 8 + (k + 0.5) * math.pi / 4  # outward direction of this face
    faces.append(((a[1] + b[1]) / 2, a, b, math.cos(mid_ang), math.sin(mid_ang)))
  faces.sort(key=lambda f: f[0])
  for (depth, a, b, nx, ny) in faces:
    light = -0.8 * nx - 0.35 * ny
    c = hi if light > 0.45 else base if light > -0.15 else lo if light > -0.6 else deep
    polygon(roof, [peak, a, b], c)
    for f in (0.34, 0.58, 0.8):
      p0 = (peak[0] + (a[0] - peak[0]) * f, peak[1] + (a[1] - peak[1]) * f)
      p1 = (peak[0] + (b[0] - peak[0]) * f, peak[1] + (b[1] - peak[1]) * f)
      line(roof, p0[0], p0[1], p1[0], p1[1], lo if c in (hi, base) else deep)
  for k in range(8):  # hips between faces
    a = eave[k]
    if a[1] > peak[1] + 2:
      line(roof, peak[0], peak[1], a[0], a[1], deep if a[0] > peak[0] else lo)
  for k in range(8):  # white fascia along the eaves we see
    a, b = eave[k], eave[(k + 1) % 8]
    if (a[1] + b[1]) / 2 > peak[1] + 10:
      line(roof, a[0], a[1] + 1, b[0], b[1] + 1, PAINT_WHITE[1])
      line(roof, a[0], a[1] + 2, b[0], b[1] + 2, PAINT_WHITE[2])
  fx, fy = int(peak[0]), int(peak[1])
  rect(roof, fx - 1, fy - 5, 2, 5, (230, 196, 90, 255))
  put(roof, fx - 1, fy - 5, (255, 240, 170, 255))
  rect(roof, fx - 2, fy - 8, 3, 3, (214, 170, 60, 255))
  put(roof, fx - 2, fy - 8, (255, 230, 140, 255))
  roof, rdx, rdy = _trim(outlined(roof), -pad, -top)
  pieces.append(Piece(roof, dx=rdx, dy=rdy, layer='over'))
  solid = sorted({(int(x) // T, int(y) // T) for (x, y) in verts} - {(1, 2), (1, 1)})
  return Made(pieces, foot=(3, 3), solid=solid)


# --- Tents ---------------------------------------------------------------------------------------------------

GUY = (226, 218, 196, 255)  # guy rope


def _tent_camping(colour):
  hi, base, lo, deep = tones(colour)
  pad, top = 4, 10
  CW, CH = 32 + 2 * pad, top + 32 + 4
  ox, oy = pad, top  # footprint origin in the canvas
  F, B, R = 29, 14, 19  # front and back ground rows, ridge height

  def P(x, y):
    return (ox + x, oy + y)

  img = new(CW, CH)
  sh = new(CW, CH)  # ground shadow to the lower right
  polygon(sh, [P(6, F + 2), P(31, F + 2), P(33, F - 2), P(33, B + 1), P(28, B)], SHADOW)
  paste(img, sh, 0, 0)
  body = new(CW, CH)
  # Roof slopes running back (left lit, right shaded), then the front gable with its door.
  polygon(body, [P(3, F), P(16, F - R), P(16, B - R), P(3, B)], hi)
  polygon(body, [P(29, F), P(16, F - R), P(16, B - R), P(29, B)], lo)
  for f in (0.5,):  # a seam down each slope
    line(body, *P(3 + 13 * f, F - R * f), *P(3 + 13 * f, B - R * f), base)
    line(body, *P(29 - 13 * f, F - R * f), *P(29 - 13 * f, B - R * f), deep)
  polygon(body, [P(3, F), P(16, F - R), P(29, F)], base)
  line(body, *P(16, F - R), *P(16, B - R), hi)  # ridge
  # Door: a dark opening with the flaps tied back.
  polygon(body, [P(11, F), P(16, F - 13), P(21, F)], (44, 30, 52, 255))
  polygon(body, [P(8, F), P(11, F), P(15, F - 11)], hi)
  polygon(body, [P(24, F), P(21, F), P(17, F - 11)], lo)
  put(body, *P(16, F - 13), deep)
  hline(body, ox + 3, oy + F, 27, deep)
  body = outlined(body)
  paste(img, body, 0, 0)
  # Guy ropes to pegs beside the front corners; a little ridge pole tip.
  for (a, b) in ((P(7, F - 6), P(0, F + 2)), (P(25, F - 6), P(32, F + 2))):
    line(img, a[0], a[1], b[0], b[1], GUY)
    vline(img, b[0], b[1], 2, WOOD_DARK)
  vline(img, ox + 16, oy + F - R - 3, 2, WOOD_DARK)
  tufts(img, ox + 4, oy + F + 2, 1, 2)
  tufts(img, ox + 27, oy + F + 2, 1, 5)
  return Made([Piece(img, dx=-pad, dy=-top)], foot=(2, 2))


def _tent_party(colour):
  """A white two-peak marquee: open sides, corner poles, scalloped valance; walk in under it."""
  W, H = 4 * T, 3 * T
  white = ((252, 252, 248, 255), (232, 232, 236, 255), (196, 194, 212, 255), (150, 144, 170, 255))
  accent = tones(colour) if colour and colour_name(colour) != 'white' else white
  EH, PKH = 30, 61
  pad, top = 4, PKH - 25 + 10
  CW, CH = W + 2 * pad, top + H + 4
  pieces = []
  # Ground: the shade under the roof.
  shade = new(W, H)
  rect(shade, 3, 5, W - 6, H - 7, (24, 18, 40, 52))
  pieces.append(Piece(shade, layer='ground'))
  # Corner poles (normal pieces at their rows).
  poles = [(5, 6), (W - 5, 6), (5, H - 4), (W - 5, H - 4)]
  pole = _post_img(EH + 2, ((236, 236, 240, 255), (206, 206, 214, 255), (160, 158, 178, 255), OUT), w=2)
  for (x, y) in poles:
    p = new(pole.width + 4, pole.height + 2)
    drop_shadow(p, 3, pole.height - 1, 3, 1.4)
    paste(p, pole, 0, 0)
    pieces.append(Piece(p, dx=x - 2, dy=y - EH - 3, z=y + 2))
  # Roof (overhead): two peaks over a rectangular eave, panels converging on each peak.
  roof = new(CW, CH)
  ox, oy = pad, top

  def S(x, gy, hgt):
    return (ox + x, oy + gy - hgt)

  front, back = H - 2, 4
  for bay in (0, 1):
    x0, x1 = bay * 32 + 1, bay * 32 + 31
    if bay == 1:
      x0 -= 1
    apex = S(bay * 32 + 16, 25, PKH)
    fl, fr, bl, br = S(x0, front, EH), S(x1, front, EH), S(x0, back, EH), S(x1, back, EH)
    polygon(roof, [apex, bl, br], white[1])               # back face: a sliver
    polygon(roof, [apex, fl, bl], white[0])               # west face, lit
    polygon(roof, [apex, br, fr], white[2])               # east face, shaded
    polygon(roof, [apex, fl, fr], white[1])               # front face
    # Coloured panels on the front face: every other wedge between seams.
    n = 4
    for i in range(n):
      a = (fl[0] + (fr[0] - fl[0]) * i / n, fl[1])
      b = (fl[0] + (fr[0] - fl[0]) * (i + 1) / n, fl[1])
      if i % 2 == 1:
        polygon(roof, [apex, a, b], accent[1] if accent is not white else white[1])
      line(roof, apex[0], apex[1], a[0], a[1], white[2] if accent is white else accent[2])
    line(roof, apex[0], apex[1], fl[0], fl[1], white[3])
    line(roof, apex[0], apex[1], fr[0], fr[1], white[3])
  # Valance: a scalloped band along the front eave.
  vy = oy + front - EH
  for x in range(ox + 1, ox + W - 1):
    k = (x - ox - 1) // 6
    c = (accent[1] if k % 2 else white[1]) if accent is not white else white[1]
    d = (accent[2] if k % 2 else white[2]) if accent is not white else white[2]
    vline(roof, x, vy, 4, c)
    put(roof, x, vy, white[0] if not (accent is not white and k % 2) else accent[0])
    xx = (x - ox - 1) % 6
    if xx in (1, 2, 3, 4):
      put(roof, x, vy + 4, d)
    if xx in (2, 3):
      put(roof, x, vy + 5, d)
  roof = outlined(roof)
  # Pennants on the peaks.
  for bay in (0, 1):
    ax, ay = S(bay * 32 + 16, 25, PKH)
    vline(roof, ax, ay - 6, 6, WOOD_DARK)
    fl_c = accent if accent is not white else tones('red')
    polygon(roof, [(ax + 1, ay - 6), (ax + 6, ay - 4.5), (ax + 1, ay - 3)], fl_c[1])
    put(roof, ax + 1, ay - 6, fl_c[0])
  roof, rdx, rdy = _trim(roof, -pad, -top)
  pieces.append(Piece(roof, dx=rdx, dy=rdy, layer='over'))
  solid = [(0, 0), (3, 0), (0, 2), (3, 2)]
  return Made(pieces, foot=(4, 3), solid=solid)


@item('tent', 'structure',
      'Tent: a small A-frame camping tent (2x2, solid) or a white party marquee (4x3) to stand under; only its '
      'four poles block.',
      (2, 2),
      variants=[{'colour': 'forest'}, {'style': 'party'}, {'style': 'party', 'colour': 'pink'}],
      style=Param('enum', 'camping', choices=('camping', 'party')),
      colour=Param('colour', None, doc='camping: fabric (default orange); party: stripe colour (default plain white)'))
def _tent(style, colour):
  if style == 'party':
    return _tent_party(colour)
  return _tent_camping(colour or 'orange')


# --- Market stall ---------------------------------------------------------------------------------------------

STALL_WHITE = ((236, 236, 240, 255), (213, 213, 213, 255), (197, 197, 197, 255), (148, 158, 168, 255))


def _goods(img, kind, x0, x1, y_top, seed):
  """Goods on a counter top whose front edge is at row y_top + 9 (draws into img, outlined pieces)."""
  rng = noise_rng(seed)
  layer = new(img.width, img.height)
  spots = list(range(x0 + 1, x1 - 8, 10))
  for i, x in enumerate(spots):
    y = y_top + 2 + (i % 2)
    if kind == 'flowers':
      # A tin bucket with a bunch of flowers.
      rect(layer, x + 1, y + 1, 7, 6, (176, 182, 196, 255))
      vline(layer, x + 1, y + 1, 6, (214, 218, 228, 255))
      vline(layer, x + 7, y + 1, 6, (132, 138, 156, 255))
      cols = [tones(c) for c in ('rose', 'gold', 'lilac', 'white', 'coral', 'sky')]
      for k in range(6):
        fx, fy = x + 1 + rng.randint(0, 6), y - 4 + rng.randint(0, 4)
        vline(layer, fx, fy + 1, y + 1 - fy, LEAF_MID)
      for k in range(5):
        hi, base, lo, deep = cols[(i * 2 + k) % len(cols)]
        fx, fy = x + 1 + rng.randint(0, 5), y - 5 + rng.randint(0, 3)
        rect(layer, fx, fy, 2, 2, base)
        put(layer, fx, fy, hi)
    elif kind == 'crates':
      # Closed wooden crates (lit lid, slatted front), every other one with a small crate on top.
      boxes = [(x + 1, y + 1, 8, 6)] + ([(x + 2, y - 5, 6, 6)] if i % 2 == 0 else [])
      for (bx, by, bw, bh) in boxes:
        rect(layer, bx, by, bw, bh, WOOD)
        rect(layer, bx, by, bw, 2, WOOD_LIGHT)
        hline(layer, bx, by + 2, bw, WOOD_MID)
        hline(layer, bx, by + bh - 2, bw, WOOD_MID)
        vline(layer, bx + bw - 1, by + 2, bh - 2, WOOD_MID)
        put(layer, bx + 1, by + 3, WOOD_LIGHT)
    else:
      # An open crate heaped with fruit or vegetables.
      rect(layer, x + 1, y + 2, 8, 5, WOOD)
      hline(layer, x + 1, y + 2, 8, WOOD_LIGHT)
      hline(layer, x + 1, y + 4, 8, WOOD_MID)
      if kind == 'fruit':
        pal = [((236, 80, 64, 255), (176, 40, 44, 255)), ((250, 160, 50, 255), (204, 104, 30, 255)),
               ((250, 224, 80, 255), (200, 170, 40, 255)), ((150, 206, 70, 255), (90, 150, 50, 255))]
      else:
        pal = [((110, 200, 80, 255), (50, 140, 60, 255)), ((236, 80, 64, 255), (176, 40, 44, 255)),
               ((246, 140, 50, 255), (196, 96, 36, 255)), ((170, 110, 190, 255), (110, 70, 140, 255))]
      a, b = pal[(i + seed) % len(pal)]
      for (fx, fy) in ((1, 1), (3, 1), (5, 1), (7, 1), (2, 0), (4, -1), (6, 0)):
        rect(layer, x + fx, y + fy, 2, 2, a)
        put(layer, x + fx + 1, y + fy + 1, b)
      put(layer, x + 4, y - 1, (255, 255, 255, 255) if kind == 'fruit' else a)
  paste(img, outlined(layer), 0, 0)


@item('stall', 'structure',
      'Market stall: striped awning over a wooden counter heaped with goods; optional name painted on the '
      'counter (Read shows it). The counter blocks.',
      (3, 1),
      variants=[{'goods': 'flowers', 'colour': 'rose', 'length': 2},
                {'goods': 'veg', 'colour': 'green', 'length': 4, 'text': 'FRESH VEG'},
                {'goods': 'crates', 'colour': 'orange', 'text': 'Lemonade'}],
      length=Param('int', 3, 2, 4, doc='tiles wide'),
      colour=Param('colour', '#2996db', doc='awning stripe colour (white between)'),
      goods=Param('enum', 'fruit', choices=('fruit', 'veg', 'flowers', 'crates')),
      text=Param('str', '', max=16, doc='name painted on the counter front (Read shows it)'),
      seed=Param('int', 1, 0, 9999))
def _stall(length, colour, goods, text, seed):
  W = length * T
  pad, top = 3, 48
  CW, CH = W + 2 * pad, top + 18
  ox, oy = pad, top
  img = new(CW, CH)
  hi, base, lo, deep = tones(colour)
  # Ground shadow.
  drop_shadow(img, ox + W / 2 + 2, oy + 16, W / 2, 2.2)
  # Shade under the awning (behind the goods).
  rect(img, ox + 3, oy - 22, W - 6, 16, (51, 37, 65, 102))
  # Counter: lit top with planks, light front edge, plank front face.
  body = new(CW, CH)
  rect(body, ox + 1, oy - 7, W - 2, 10, (148, 120, 92, 255))
  for y in (oy - 4, oy - 1):
    hline(body, ox + 1, y, W - 2, (121, 88, 79, 255))
  hline(body, ox + 1, oy - 7, W - 2, (188, 154, 120, 255))
  hline(body, ox + 1, oy + 3, W - 2, (188, 154, 120, 255))
  rect(body, ox + 1, oy + 4, W - 2, 11, (121, 88, 79, 255))
  for x in range(ox + 1, ox + W - 1, 8):
    vline(body, x, oy + 4, 11, (86, 58, 63, 255))
  hline(body, ox + 1, oy + 14, W - 2, (86, 58, 63, 255))
  # Front poles from the counter up to the awning.
  for x in (ox + 2, ox + W - 4):
    rect(body, x, oy - 24, 2, 18, (121, 88, 79, 255))
    vline(body, x, oy - 24, 18, (148, 120, 92, 255))
  paste(img, outlined(body), 0, 0)
  # Goods on the counter.
  _goods(img, goods, ox + 2, ox + W - 1, oy - 12, seed)
  # Name painted on the counter front.
  if text:
    font, lines = _fit(text, W - 6, 10, fonts=('big', 'mini', 'small'), max_lines=2, gap=0)
    t = text_block(lines, (248, 236, 210, 255), font, gap=0, shadow=(70, 44, 48, 255))
    paste(img, t, ox + (W - t.width) // 2 + 1, oy + 4 + (11 - t.height) // 2)
  # Awning: stripes on the sloping top, a scalloped valance in front.
  aw = new(CW, CH)
  ax0, ax1 = ox - 1, ox + W + 1
  at, ab = oy - 46, oy - 27  # top surface rows
  sw = 8 if length > 2 else 6
  for x in range(ax0, ax1):
    k = (x - ax0) // sw
    xx = (x - ax0) % sw
    if k % 2 == 0:
      c0, c1, c2, c3 = hi, base, lo, deep
    else:
      c0, c1, c2, c3 = STALL_WHITE
    col = c1 if 1 <= xx < sw - 2 else (c0 if xx == 0 else c2)
    vline(aw, x, at + 2, ab - at - 2, col)
    vline(aw, x, ab - 3, 3, c2 if col != c2 else c3)
    put(aw, x, at + 1, c0)
    put(aw, x, at + 2, c0 if xx < sw - 2 else c1)
    # Valance (vertical, darker) with a rounded scallop per stripe.
    vline(aw, x, ab, 5, c2)
    put(aw, x, ab, c1)
    if 0 < xx < sw - 1:
      put(aw, x, ab + 5, c3)
    if 1 < xx < sw - 2:
      put(aw, x, ab + 6, c3)
  hline(aw, ax0 + 1, at, ax1 - ax0 - 2, STALL_WHITE[0])  # the rolled top edge
  paste(img, outlined(aw), 0, 0)
  use, read = [], None
  if text:
    use = [(i, 1) for i in range(length)]
    read = text
  return Made([Piece(img, dx=-pad, dy=-top)], foot=(length, 1), use=use, text=read)


# --- Stage ---------------------------------------------------------------------------------------------------------

STAGE_BOARDS = ((210, 158, 100, 255), (192, 140, 86, 255), (176, 126, 78, 255), (150, 104, 66, 255))
STAGE_LIP = ((226, 176, 112, 255), (120, 80, 56, 255), (96, 60, 48, 255))


@item('stage', 'structure',
      'Low wooden stage to walk and perform on: boards with a front edge and steps, optional footlights. '
      'Walkable.',
      (4, 2),
      variants=[{'w': 6, 'h': 3, 'lights': True}, {'w': 2, 'h': 2}],
      w=Param('int', 4, 2, 8, doc='tiles wide'),
      h=Param('int', 2, 2, 5, doc='tiles deep'),
      lights=Param('bool', False, doc='warm footlights along the front edge'),
      seed=Param('int', 1, 0, 9999))
def _stage(w, h, lights, seed):
  W, Hh = w * T, h * T
  rng = noise_rng(seed)
  img = new(W + 1, Hh + 8)
  light, a, b, seam = STAGE_BOARDS
  for y in range(1, Hh):
    row = (y - 1) // 4
    c = a if row % 2 else b
    hline(img, 1, y, W - 2, c)
    if (y - 1) % 4 == 3:
      hline(img, 1, y, W - 2, seam)
  for row in range(0, Hh // 4 + 1):  # board ends, staggered
    for x in range(1 + (row * 13) % 23, W - 1, 23):
      vline(img, x, 1 + row * 4, 3, seam)
  for _ in range(w * h * 2):  # knots
    put(img, rng.randrange(2, W - 2), rng.randrange(2, Hh - 2), seam)
  hline(img, 1, 0, W - 2, light)
  # Front lip below the footprint, the stage's front face.
  lhi, lbase, ldeep = STAGE_LIP
  rect(img, 1, Hh, W - 2, 6, lbase)
  hline(img, 1, Hh, W - 2, lhi)
  hline(img, 1, Hh + 5, W - 2, ldeep)
  for x in range(8, W - 4, 16):
    vline(img, x, Hh + 1, 4, ldeep)
  # Steps down at the front middle.
  if w >= 3:
    sx, sw = W // 2 - 8, 16
    rect(img, sx, Hh, sw, 3, light)
    hline(img, sx, Hh + 2, sw, lbase)
    rect(img, sx - 1, Hh + 3, sw + 2, 3, light)
    hline(img, sx - 1, Hh + 5, sw + 2, lbase)
    rect(img, sx - 1, Hh + 6, sw + 2, 1, ldeep)
  img = outlined(img)
  # The stage casts a soft shadow on the ground in front of its lip.
  _put_shadow(img, {(x, Hh + 7) for x in range(3, W)} | {(W, y) for y in range(3, Hh + 7)})
  glows = []
  if lights:
    for x in range(10, W - 6, 16):
      rect(img, x - 1, Hh - 3, 3, 2, (255, 226, 140, 255))
      put(img, x - 1, Hh - 3, (255, 250, 220, 255))
      hline(img, x - 1, Hh - 1, 3, (90, 70, 60, 255))
      glows.append({'dx': x, 'dy': Hh - 3, 'radius': 1.5, 'colour': '#ffd78a', 'flicker': False})
  return Made([Piece(img, dx=0, dy=0, layer='ground')], foot=(w, h), solid=[], glows=glows)


# --- Well ------------------------------------------------------------------------------------------------------------

WELL_STONE = ((222, 222, 218, 255), (192, 192, 192, 255), (163, 170, 177, 255), (120, 124, 140, 255))


@item('well', 'structure',
      'Old stone well with a little shingled roof, a windlass, rope and bucket. Solid.',
      (2, 1),
      variants=[{'colour': 'red'}],
      colour=Param('colour', None, doc='roof colour (default wooden shingles)'))
def _well(colour):
  W = 2 * T
  pad, top = 3, 46
  CW, CH = W + 2 * pad, top + 18
  ox, oy = pad, top
  img = new(CW, CH)
  drop_shadow(img, ox + 17, oy + 13, 15, 3)
  s_hi, s_base, s_lo, s_deep = WELL_STONE
  cx, rx, ry, ring_h = ox + 16, 13.5, 6.0, 10
  cy_base, cy_top = oy + 8, oy + 8 - ring_h
  body = new(CW, CH)
  # The ring's front face: courses of stones following the curve, lit left, dark right.
  for x in range(int(cx - rx), int(cx + rx) + 1):
    t = (x + 0.5 - cx) / rx
    if abs(t) > 1:
      continue
    dyc = ry * math.sqrt(max(0.0, 1 - t * t))
    y0, y1 = int(round(cy_top + dyc)), int(round(cy_base + dyc))
    c = s_base if t < 0.35 else s_lo
    if t < -0.6:
      c = s_hi
    vline(body, x, y0, y1 - y0 + 1, c)
    for k in range(1, ring_h // 3 + 1):
      put(body, x, y0 + 3 * k, s_deep if t > 0.2 else s_lo)
    col = int((x - cx + 40) // 4)
    for k in range(ring_h // 3 + 1):
      if (col + k) % 2 == 0 and (x - int(cx - rx)) % 4 == 0:
        vline(body, x, y0 + 3 * k + 1, 2, s_deep if t > 0.2 else s_lo)
  # Rim and the dark hole.
  ellipse(body, cx, cy_top, rx, ry, s_hi)
  ellipse(body, cx + 0.5, cy_top + 0.5, rx - 1, ry - 1, s_base)
  ellipse(body, cx, cy_top + 0.5, rx - 3.5, ry - 2.6, (40, 52, 76, 255))
  ellipse(body, cx + 1, cy_top + 1.2, rx - 5, ry - 3.6, (28, 36, 58, 255))
  put(body, int(cx) - 3, int(cy_top), (120, 170, 210, 255))
  put(body, int(cx) - 2, int(cy_top), (90, 140, 190, 255))
  # Posts.
  for x in (ox + 3, ox + W - 6):
    rect(body, x, oy - 30, 3, 30, WOOD)
    vline(body, x, oy - 30, 30, WOOD_LIGHT)
    vline(body, x + 2, oy - 30, 30, WOOD_MID)
  body = outlined(body)
  paste(img, body, 0, 0)
  # Windlass with rope, crank and the bucket hanging above the hole.
  top_l = new(CW, CH)
  rect(top_l, ox + 5, oy - 21, W - 10, 3, WOOD)
  hline(top_l, ox + 5, oy - 21, W - 10, WOOD_LIGHT)
  hline(top_l, ox + 5, oy - 19, W - 10, WOOD_MID)
  rect(top_l, cx - 4, oy - 22, 8, 5, GUY)
  for x in range(int(cx) - 4, int(cx) + 4, 2):
    vline(top_l, x, oy - 22, 5, (190, 170, 130, 255))
  vline(top_l, ox + W - 2, oy - 22, 5, (110, 110, 124, 255))
  hline(top_l, ox + W - 2, oy - 18, 3, (110, 110, 124, 255))
  vline(top_l, int(cx), oy - 17, 8, (190, 170, 130, 255))
  bx, by = int(cx) - 3, oy - 10
  rect(top_l, bx, by, 7, 5, (150, 104, 66, 255))
  vline(top_l, bx, by, 5, (190, 140, 90, 255))
  hline(top_l, bx, by + 1, 7, (110, 110, 124, 255))
  hline(top_l, bx, by + 3, 7, (110, 110, 124, 255))
  paste(img, outlined(top_l), 0, 0)
  # Roof: a little gable with shingle courses and a ridge board.
  rf = new(CW, CH)
  r_hi, r_base, r_lo, r_deep = tones(colour) if colour else TIMBER
  polygon(rf, [(ox - 2, oy - 27), (ox + W + 2, oy - 27), (ox + W - 1, oy - 41), (ox + 1, oy - 41)], r_base)
  for y in range(oy - 39, oy - 27, 3):
    hline(rf, ox - 1, y, W + 2, r_lo)
    for x in range(ox + (y % 2) * 2, ox + W + 1, 5):
      put(rf, x, y + 1, r_lo)
      put(rf, x, y + 2, r_hi)
  rect(rf, ox, oy - 43, W, 3, r_hi)
  hline(rf, ox, oy - 41, W, r_lo)
  hline(rf, ox - 2, oy - 27, W + 4, r_deep)
  hline(rf, ox - 1, oy - 26, W + 2, (86, 58, 63, 255))
  paste(img, outlined(rf), 0, 0)
  tufts(img, ox + 4, oy + 14, 2, 3)
  tufts(img, ox + 27, oy + 14, 1, 4)
  return Made([Piece(img, dx=-pad, dy=-top)], foot=(2, 1))


# --- Signpost ----------------------------------------------------------------------------------------------------

BOARD = ((232, 196, 140, 255), (214, 170, 112, 255), (176, 128, 80, 255), (120, 80, 60, 255))
INK = (66, 38, 44, 255)


def _sign_font(texts, max_w, max_h):
  """The largest font that fits every board's text (so the arms match), and each text's lines."""
  for f in ('big', 'mini', 'small'):
    out = []
    for t in texts:
      lines = wrap_text(t, max_w, f, 3)
      if lines is None or len(lines) * font_height(f) + (len(lines) - 1) > max_h:
        break
      out.append(lines)
    else:
      return f, out
  return 'small', [_fit(t, max_w, max_h, fonts=('small',), max_lines=3, gap=1)[1] for t in texts]


def _arrow_board(lines, font, direction):
  """An arrow-shaped board with the text lines centred on its flat part (flat end at the post)."""
  hi, base, lo, deep = BOARD
  tb = text_block(lines, INK, font, gap=1) if lines and lines[0] else new(10, 5)
  bw = max(14, tb.width + 5)
  bh = max(9, tb.height + 4)
  tip = min(5, (bh + 1) // 2)
  W, H = bw + tip + 2, bh + 2
  img = new(W, H)
  half = bh / 2
  if direction == 'right':
    x0 = 1  # flat part from x0 to x0 + bw - 1, tip to the right
    pts = [(x0, 1), (x0 + bw, 1), (x0 + bw + tip, 1 + half), (x0 + bw, 1 + bh), (x0, 1 + bh)]
  else:
    x0 = 1 + tip
    pts = [(x0, 1), (x0 + bw, 1), (x0 + bw, 1 + bh), (x0, 1 + bh), (1, 1 + half)]
  polygon(img, pts, base)
  for x in range(W):  # lit top edge, shaded bottom edge
    col = [y for y in range(H) if img.getpixel((x, y))[3]]
    if col:
      put(img, x, col[0], hi)
      put(img, x, col[-1], lo)
  if direction == 'right':
    vline(img, x0, 2, bh - 2, hi)
  else:
    vline(img, x0 + bw - 1, 2, bh - 2, lo)
  img = outlined(img)
  tx = x0 + (bw - tb.width) // 2
  ty = 1 + (bh - tb.height + 1) // 2
  paste(img, tb, tx, ty)
  return img


@item('signpost', 'structure',
      'Wooden signpost with one or two arrow boards (up to 16 letters each, pointing left or right). The post '
      'blocks; press X in front to read it.',
      (1, 1),
      variants=[{'text1': 'Beach', 'dir1': 'right', 'text2': ''}, {'text1': 'Party this way!', 'dir1': 'right',
                                                                   'text2': 'Quiet garden', 'dir2': 'left'}],
      text1=Param('str', 'Plaza', max=16, doc='top board'),
      dir1=Param('enum', 'left', choices=('left', 'right')),
      text2=Param('str', 'Beach', max=16, doc='second board (empty: none)'),
      dir2=Param('enum', 'right', choices=('left', 'right')))
def _signpost(text1, dir1, text2, dir2):
  pieces = []
  # Post with a pointed cap.
  post = new(10, 48)
  rect(post, 3, 4, 4, 41, WOOD_FENCE[1])
  vline(post, 3, 4, 41, WOOD_FENCE[0])
  vline(post, 6, 4, 41, WOOD_FENCE[2])
  put(post, 4, 3, WOOD_FENCE[0])
  put(post, 5, 3, WOOD_FENCE[1])
  put(post, 4, 2, WOOD_FENCE[0])
  post = outlined(post)
  pimg = new(14, 50)
  drop_shadow(pimg, 8, 46, 5, 1.8)
  paste(pimg, post, 2, 0)
  tufts(pimg, 6, 46, 2, 5)
  pieces.append(Piece(pimg, dx=1, dy=-33))
  arms = [(t, d) for (t, d) in ((text1, dir1), (text2, dir2)) if t] or [('', dir1)]
  font, lines = _sign_font([t for (t, _d) in arms], 31, 17)
  y = -31
  for (t, d), ln in zip(arms[:2], lines):
    board = _arrow_board(ln if t else [''], font, d)
    dx = min(6, 3 * T - board.width) if d == 'right' else max(10 - board.width, -2 * T)
    pieces.append(Piece(board, dx=dx, dy=y, z=T + 1))
    y += board.height - 1
  read = '\n'.join(('< ' + t) if d == 'left' else (t + ' >') for (t, d) in arms if t) or None
  return Made(pieces, foot=(1, 1), use=[(0, 1)] if read else [], text=read)


# --- Mailbox ----------------------------------------------------------------------------------------------------------

@item('mailbox', 'structure',
      'Mailbox on a wooden post; its little flag is up when there is post inside. Solid.',
      (1, 1),
      variants=[{'colour': 'red', 'flag': True}, {'colour': 'charcoal'}],
      colour=Param('colour', 'blue', doc='box colour'),
      flag=Param('bool', False, doc='flag raised'))
def _mailbox(colour, flag):
  hi, base, lo, deep = tones(colour)
  c = to_rgba(colour)
  reddish = c[0] > 150 and c[1] < 120 and c[2] < 120
  f_hi, f_base, f_lo, f_deep = tones('gold' if reddish else 'red')
  pad, top = 2, 22
  CW, CH = T + 2 * pad, top + 16
  ox, oy = pad, top
  img = new(CW, CH)
  drop_shadow(img, ox + 9, oy + 13, 4, 1.6)
  body = new(CW, CH)
  # Post.
  rect(body, ox + 7, oy - 6, 3, 19, WOOD)
  vline(body, ox + 7, oy - 6, 19, WOOD_LIGHT)
  vline(body, ox + 9, oy - 6, 19, WOOD_MID)
  # Box: the rounded top running back, then the door facing south.
  x0, x1 = ox + 4, ox + 12  # 8 px wide
  rect(body, x0, oy - 18, 8, 8, base)
  vline(body, x0, oy - 17, 7, hi)
  vline(body, x0 + 1, oy - 18, 8, hi)
  vline(body, x1 - 1, oy - 17, 7, lo)
  put(body, x0, oy - 18, (0, 0, 0, 0))
  put(body, x1 - 1, oy - 18, (0, 0, 0, 0))
  # Door (front face): darker, rounded top edge, a little latch.
  rect(body, x0, oy - 11, 8, 8, lo)
  hline(body, x0 + 1, oy - 11, 6, base)
  vline(body, x0, oy - 10, 7, base)
  vline(body, x1 - 1, oy - 10, 7, deep)
  hline(body, x0, oy - 4, 8, deep)
  rect(body, x0 + 3, oy - 9, 2, 2, (236, 230, 210, 255))
  # Flag on the right side.
  if flag:
    vline(body, x1, oy - 19, 9, (70, 64, 80, 255))
    rect(body, x1 + 1, oy - 19, 3, 3, f_base)
    put(body, x1 + 1, oy - 19, f_hi)
    put(body, x1 + 3, oy - 17, f_lo)
  else:
    rect(body, x1, oy - 13, 1, 4, (70, 64, 80, 255))
    rect(body, x1, oy - 9, 2, 3, f_base)
    put(body, x1, oy - 9, f_hi)
  paste(img, outlined(body), 0, 0)
  tufts(img, ox + 8, oy + 13, 2, 9)
  return Made([Piece(img, dx=-pad, dy=-top)], foot=(1, 1))


# --- Statue -------------------------------------------------------------------------------------------------------------

STATUE_STONE = ((232, 232, 228, 255), (206, 206, 204, 255), (166, 170, 180, 255), (120, 124, 142, 255))


def _shade_parts(img, parts, ramp):
  """Fill body-part masks lit from the upper left: each row of a part is light, mid, then dark."""
  hi, base, lo, deep = ramp
  for mask, bias in parts:
    rows = {}
    for (x, y) in mask:
      rows.setdefault(y, []).append(x)
    ys = sorted(rows)
    for y in ys:
      xa, xb = min(rows[y]), max(rows[y])
      for x in rows[y]:
        t = (x - xa + 0.5) / max(1, xb - xa + 1) + bias
        put(img, x, y, hi if t < 0.3 else base if t < 0.72 else lo)


def _figure(kind, ramp, w, h, cx, base_y):
  """A stone figure standing on (cx, base_y): 'person' (raising a torch), 'bust' or 'orb'."""
  hi, base, lo, deep = ramp
  img = new(w, h)
  c = int(cx)

  def box(x0, y0, x1, y1):
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}

  def trap(y0, y1, w0, w1, off=0.0):
    pts = set()
    for y in range(y0, y1 + 1):
      t = (y - y0) / max(1, y1 - y0)
      half = (w0 + (w1 - w0) * t) / 2
      for x in range(int(round(cx + off - half)), int(round(cx + off + half))):
        pts.add((x, y))
    return pts

  if kind == 'person':
    t = base_y - 25  # top of the head
    head = disc_mask(w, h, cx + 0.5, t + 3.5, 3.2, 3.5)
    neck = box(c - 1, t + 7, c + 1, t + 7)
    torso = trap(t + 8, t + 15, 10, 8)
    robe = trap(t + 16, t + 24, 8, 11)
    arm_l = box(c - 6, t + 9, c - 5, t + 17) | {(c - 6, t + 18)}
    arm_r = set()
    for k in range(8):  # raised arm from the shoulder up to the hand
      arm_r |= {(c + 4 + k // 4, t + 9 - k), (c + 5 + k // 4, t + 9 - k)}
    _shade_parts(img, [(robe, 0.0), (torso, 0.0), (arm_l, -0.2), (neck, 0.1), (head, 0.0), (arm_r, 0.25)], ramp)
    for y in range(t + 17, t + 24, 3):  # folds in the robe
      put(img, c + 1, y, lo)
      put(img, c - 2, y + 1, base)
    hline(img, c - 2, t + 15, 5, lo)  # belt
    put(img, c - 1, t + 3, deep)  # eyes, faintly
    put(img, c + 1, t + 3, deep)
    # Torch: handle and a stone flame.
    vline(img, c + 6, t - 2, 2, lo)
    rect(img, c + 5, t - 5, 3, 3, hi)
    put(img, c + 6, t - 6, hi)
    put(img, c + 7, t - 4, base)
  elif kind == 'bust':
    t = base_y - 21
    head = disc_mask(w, h, cx + 0.5, t + 4.5, 3.6, 4.4)
    neck = box(c - 1, t + 8, c + 1, t + 9)
    chest = set()
    for y in range(t + 10, t + 16):
      k = y - (t + 10)
      half = [6.5, 7, 7, 6, 4.5, 3][k]
      for x in range(int(round(cx - half)), int(round(cx + half))):
        chest.add((x, y))
    stem = box(c - 1, t + 16, c + 1, t + 18)
    foot = box(c - 4, t + 19, c + 4, t + 20)
    _shade_parts(img, [(foot, 0.0), (stem, 0.0), (chest, 0.0), (neck, 0.1), (head, 0.0)], ramp)
    put(img, c - 1, t + 4, deep)
    put(img, c + 1, t + 4, deep)
    put(img, c + 2, t + 6, lo)
    hline(img, c - 4, t + 12, 3, lo)  # drapery
    put(img, c + 2, t + 11, lo)
  else:
    # An orb on a short stem, with a highlight and a band around it.
    rect(img, c - 2, base_y - 4, 5, 5, base)
    vline(img, c - 2, base_y - 4, 5, hi)
    vline(img, c + 2, base_y - 4, 5, lo)
    rect(img, c - 4, base_y - 1, 9, 2, lo)
    hline(img, c - 4, base_y - 1, 9, base)
    r = 7.5
    ocx, ocy = cx + 0.5, base_y - 4 - r
    for y in range(int(ocy - r) - 1, int(ocy + r) + 2):
      for x in range(int(ocx - r) - 1, int(ocx + r) + 2):
        ddx, ddy = (x + 0.5 - ocx) / r, (y + 0.5 - ocy) / r
        d = ddx * ddx + ddy * ddy
        if d <= 1:
          tt = ddx * 0.6 + ddy * 0.8
          put(img, x, y, hi if tt < -0.45 else base if tt < 0.15 else lo if tt < 0.6 else deep)
    rect(img, int(ocx) - 4, int(ocy) - 4, 2, 2, (255, 255, 250, 255))
    for x in range(int(ocx - r), int(ocx + r) + 1):  # a band around it
      tt = (x + 0.5 - ocx) / r
      if abs(tt) <= 1:
        put(img, x, int(round(ocy + 2.2 * math.sqrt(1 - tt * tt))), deep if tt > 0.2 else lo)
  return outlined(img)


@item('statue', 'structure',
      'Statue on a stone pedestal: a figure raising a torch, a bust or an orb; optional plaque text (press X in '
      'front to read). Solid.',
      (2, 1),
      variants=[{'style': 'bust', 'text': 'Our founder'}, {'style': 'orb', 'colour': 'gold'},
                {'style': 'person', 'colour': 'teal', 'text': 'Sam'}],
      style=Param('enum', 'person', choices=('person', 'bust', 'orb')),
      colour=Param('colour', None, doc='figure material (default pale stone; gold, teal for bronze)'),
      text=Param('text', '', max=40, doc='plaque on the pedestal (Read shows all of it)'))
def _statue(style, colour, text):
  W = 2 * T
  s_hi, s_base, s_lo, s_deep = STATUE_STONE
  lines, font = [], 'small'
  if text:
    font, lines = _fit(text.replace('\n', ' '), 28, 17, fonts=('mini', 'small'), max_lines=3, gap=1)
  th = (len(lines) * font_height(font) + len(lines) - 1) if lines else 7
  die = max(12, th + 4)  # the pedestal's front face grows with the plaque
  pad, top = 2, 46 + die
  CW, CH = W + 2 * pad, top + 18
  ox, oy = pad, top
  img = new(CW, CH)
  drop_shadow(img, ox + 17, oy + 14, 16, 2.8)
  ped = new(CW, CH)
  # Base moulding across the footprint.
  rect(ped, ox, oy + 9, 32, 5, s_lo)
  rect(ped, ox, oy + 9, 32, 2, s_base)
  hline(ped, ox, oy + 9, 32, s_hi)
  hline(ped, ox, oy + 13, 32, s_deep)
  # Die (front face), cornice and the lit top the figure stands on.
  fy = oy + 9 - die
  rect(ped, ox + 1, fy, 30, die, s_base)
  vline(ped, ox + 1, fy, die, s_hi)
  vline(ped, ox + 29, fy, die, s_lo)
  vline(ped, ox + 30, fy, die, s_deep)
  rect(ped, ox, fy - 3, 32, 3, s_hi)
  hline(ped, ox, fy - 1, 32, s_lo)
  rect(ped, ox + 2, fy - 9, 28, 6, s_base)
  hline(ped, ox + 2, fy - 9, 28, s_hi)
  vline(ped, ox + 29, fy - 8, 5, s_lo)
  paste(img, outlined(ped), 0, 0)
  if lines:
    # A bronze plaque with the text.
    pw, ph = 30, th + 2
    plaque = new(pw, ph)
    rect(plaque, 0, 0, pw, ph, (176, 132, 70, 255))
    hline(plaque, 0, 0, pw, (226, 186, 110, 255))
    hline(plaque, 0, ph - 1, pw, (120, 84, 50, 255))
    tb = text_block(lines, (66, 40, 30, 255), font, gap=1)
    paste(plaque, tb, (pw - tb.width) // 2, 1)
    paste(img, plaque, ox + 1, fy + (die - ph + 1) // 2)
  else:
    rect(img, ox + 8, fy + die // 2 - 2, 16, 4, s_lo)  # a carved panel
    hline(img, ox + 8, fy + die // 2 + 2, 16, s_hi)
  ramp = tones(colour) if colour else STATUE_STONE
  fig = _figure(style, ramp, CW, fy - 5, ox + 15.5, fy - 7)
  paste(img, fig, 0, 0)
  tufts(img, ox + 2, oy + 14, 1, 7)
  tufts(img, ox + 29, oy + 14, 1, 8)
  use, read = ([(0, 1), (1, 1)], text) if text else ([], None)
  return Made([Piece(img, dx=-pad, dy=-top)], foot=(2, 1), use=use, text=read)


# --- Bridge ---------------------------------------------------------------------------------------------------------------

def _bridge_deck(W, Hh, vertical, seed):
  """Deck boards (ground layer) with dark stringers along the sides and a front edge."""
  rng = noise_rng(seed)
  hi, base, lo, deep = TIMBER
  img = new(W, Hh + 7)
  if vertical:
    for y in range(0, Hh):
      k = y // 4
      c = base if k % 2 else (184, 134, 82, 255)
      hline(img, 2, y, W - 4, c)
      if y % 4 == 3:
        hline(img, 2, y, W - 4, lo)
      if y % 4 == 0:
        hline(img, 2, y, W - 4, hi if k % 3 else c)
    for x in (0, 1):
      vline(img, x, 0, Hh, deep)
      vline(img, W - 1 - x, 0, Hh, deep)
    for y in range(4, Hh, 8):
      put(img, 3, y + 1, deep)
      put(img, W - 4, y + 1, deep)
    rect(img, 0, Hh, W, 3, lo)
    hline(img, 0, Hh + 2, W, deep)
  else:
    for x in range(0, W):
      k = x // 4
      c = base if k % 2 else (184, 134, 82, 255)
      vline(img, x, 2, Hh - 4, c)
      if x % 4 == 3:
        vline(img, x, 2, Hh - 4, lo)
      if x % 4 == 0:
        vline(img, x, 2, Hh - 4, hi if k % 3 else c)
    for y in (0, 1):
      hline(img, 0, y, W, deep)
    rect(img, 0, Hh - 2, W, 2, lo)
    rect(img, 0, Hh, W, 3, deep)  # the deck's front face
    for x in range(6, W - 4, 16):  # piles under the front edge
      rect(img, x, Hh + 3, 3, 4, (96, 64, 56, 255))
      vline(img, x, Hh + 3, 4, (126, 90, 72, 255))
    for x in range(3, W - 3, 8):
      put(img, x, 2, deep)
      put(img, x, Hh - 4, deep)
  for _ in range(W * Hh // 160):
    put(img, rng.randrange(3, W - 3), rng.randrange(3, Hh - 3), lo)
  return img


def _rail_h(W, ramp):
  """A low railing west-east: posts every tile and a top rail; returns (image, top_offset)."""
  hi, base, lo, deep = ramp
  h = 10
  img = new(W, h + 3)
  for x in [1] + list(range(T - 2, W - 2, T)) + [W - 4]:
    rect(img, x, 2, 3, h - 1, base)
    vline(img, x, 2, h - 1, hi)
    vline(img, x + 2, 2, h - 1, lo)
  rect(img, 1, 2, W - 2, 2, base)
  hline(img, 1, 2, W - 2, hi)
  rect(img, 1, 6, W - 2, 1, lo)
  return outlined(img), h + 1


@item('bridge', 'structure',
      'Wooden footbridge two tiles wide with low rails on both sides; lay it across water or a ditch. '
      'Walk-through.',
      (4, 2),
      variants=[{'length': 3, 'vertical': True}],
      length=Param('int', 4, 2, 8, doc='tiles along the crossing'),
      vertical=Param('bool', False, doc='cross north-south instead of west-east'),
      seed=Param('int', 1, 0, 9999))
def _bridge(length, vertical, seed):
  ramp = TIMBER
  hi, base, lo, deep = ramp
  pieces = []
  if not vertical:
    W, Hh = length * T, 2 * T
    deck = _bridge_deck(W, Hh, False, seed)
    pieces.append(Piece(outlined(deck), dx=0, dy=0, layer='ground'))
    rail, rh = _rail_h(W, ramp)
    north = new(W, rail.height + 2)
    paste(north, rail, 0, 0)
    pieces.append(Piece(north, dx=0, dy=3 - rh, z=4))
    south = new(W, rail.height + 3)
    _put_shadow(south, {(x, rail.height + 1) for x in range(2, W - 1)})
    paste(south, rail, 0, 0)
    pieces.append(Piece(south, dx=0, dy=Hh - 1 - rh, z=Hh + 1))
    return Made(pieces, foot=(length, 2), solid=[])
  W, Hh = 2 * T, length * T
  deck = _bridge_deck(W, Hh, True, seed)
  pieces.append(Piece(outlined(deck), dx=0, dy=0, layer='ground'))
  # Rails along both sides, seen end-on: posts in each row joined by the top rail.
  top = 11
  rails = new(W, Hh + top)
  body = new(W, Hh + top)
  for x0 in (1, W - 5):
    rect(body, x0 + 1, top + 2 - 10, 2, Hh - 2 + 0, base)
    vline(body, x0 + 1, top - 8, Hh - 2, hi)
    for r in range(length + 1):
      yb = top + min(r * T, Hh - 2) + 1
      rect(body, x0, yb - 10, 4, 10, base)
      vline(body, x0, yb - 10, 10, hi)
      vline(body, x0 + 3, yb - 10, 10, lo)
      hline(body, x0, yb - 1, 4, lo)
  paste(rails, outlined(body), 0, 0)
  pieces += _vrun(rails, length, top)
  return Made(pieces, foot=(2, length), solid=[])
