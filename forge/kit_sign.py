"""Kit family: sign items for Möbius Town builders (registered on import by kit.py).

Conventions (see kit.py's docstring for the full contract):
- `@item(name, 'sign', doc, foot=(w, h), variants=[...], **params)`; the function returns `Made`.
- Draw in the town's palette with kit's helpers (tones, outlined, block, post, foliage, pixel_text ...),
  dark plum outline OUT (OUT_SOFT for foliage), light from the upper left, 2-4 flat shades, no
  anti-aliasing, soft SHADOW ellipse under standing things, 3/4 top-down view.
- Deterministic: randomness only from noise_rng(seed).

Every sign is readable: `use` is the row of tiles in front of it (south; for wall-mounted things the floor
row below the two-tile wall face) and `text` is the full text, so the compiler adds a "Read" prompt. The
text drawn on the sign is fitted (wrapped, the board grows, the font shrinks) and never overflows.
"""
from __future__ import annotations

from kit import *  # noqa: F401,F403
from kit import (  # noqa: F401
  Made, Param, Piece, T, item, rows_of, standing, to_rgba, tones,
)

INK = (64, 36, 44, 255)             # dark paint / engraving on light boards
INK_LIGHT = (246, 238, 214, 255)    # light paint on dark boards
CORK = ((236, 202, 152, 255), (214, 172, 120, 255), (186, 140, 96, 255))
SLATE = ((60, 76, 70, 255), (44, 58, 52, 255), (34, 44, 42, 255))
NOTE_COLOURS = [(250, 250, 244, 255), (255, 236, 140, 255), (186, 222, 255, 255), (255, 204, 214, 255),
                (196, 240, 200, 255)]
PIN_COLOURS = [(220, 60, 60, 255), (60, 120, 220, 255), (240, 190, 50, 255)]


def _lum(c):
  c = to_rgba(c)
  return (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255


def _choose(text, inner, fws, fonts, max_lines, last_fonts=None):
  """Fit text on a board that grows by whole tiles: (fw, font, lines), or None.

  The builder's own line breaks are kept if anything fits that way; only then are lines wrapped (up to
  `max_lines`). For each line count the narrowest board wins, then the biggest font. `last_fonts` are
  extra (smaller) fonts allowed on the widest board only.
  """
  n = len(text.split('\n'))
  for limit in range(min(n, max_lines), max_lines + 1):
    for fw in fws:
      for font in fonts + (tuple(last_fonts or ()) if fw == fws[-1] else ()):
        lines = wrap_text(text, inner(fw), font, limit)
        if lines is not None:
          return fw, font, lines
  return None


def _text_img(lines, colour, font, gap=None, shadow=None):
  gap = (2 if font in ('big', 'blocks') else 1) if gap is None else gap
  return text_block(lines, colour, font, gap=gap, shadow=shadow)


def _planks(img, x, y, w, h, colour, seed=0):
  """A board of horizontal planks lit from the upper left (no outline)."""
  hi, base, lo, deep = tones(colour)
  rng = noise_rng(seed)
  rect(img, x, y, w, h, base)
  py = y
  while py < y + h:
    ph = min(5, y + h - py)
    hline(img, x, py, w, hi if py == y else mix(base, hi, 0.45))
    if ph == 5 and py + 4 < y + h:
      hline(img, x, py + 4, w, lo)
    # A knot or two and a grain streak.
    for _ in range(max(1, w // 18)):
      gx = x + 2 + rng.randrange(max(1, w - 6))
      hline(img, gx, py + 2, rng.randint(2, 4), lo if ph > 3 else base)
    py += 5
  vline(img, x, y, h, hi)
  vline(img, x + w - 1, y, h, lo)
  hline(img, x, y + h - 1, w, deep)


# --- Sign -----------------------------------------------------------------------------------------------

@item('sign', 'sign',
      'Wooden signboard on a post (two posts when the text needs a wider board, up to 4 tiles). '
      'Walk up and press X to read it.', foot=(1, 1),
      variants=[{'text': 'Beach Volleyball'}, {'text': 'Welcome to\nMöbius Town', 'colour': 'forest'}],
      text=Param('text', 'Hello!', max=48, doc='up to 3 short lines (\\n)'),
      colour=Param('colour', 'wood', doc='board'), seed=Param('int', 1, 0, 9999))
def _sign(text, colour, seed):
  light = _lum(colour) > 0.42
  ink = INK if light else INK_LIGHT

  def board_w(fw):
    return fw * T + (12 if fw == 1 else 4)   # a one-post sign's board overhangs its tile

  def inner(fw):
    return board_w(fw) - 6

  pick = _choose(text, inner, (1, 2, 3, 4), ('big', 'mini'), 3, last_fonts=('small',))
  if pick is None:
    font, lines = fit_text(text, inner(4), None, ('small',), 3, gap=1)
    fw = 4
  else:
    fw, font, lines = pick
  label = _text_img(lines, ink, font)
  bw = board_w(fw)
  bh = label.height + 9
  post_h = 10
  W = bw + 2
  H = 4 + bh + post_h + 1
  ox = (W - bw) // 2                  # board left in the image
  img = new(W, H)
  by = 3                              # board top in the image
  gy = H - 2                          # ground line
  posts = [W // 2 - 1] if fw == 1 else [ox + 4, ox + bw - 7]
  for px in posts:
    drop_shadow(img, px + 1.5, gy, 4, 1.6)
  body = new(W, H)
  for px in posts:
    top = by + 2 if fw == 1 else by - 2
    post(body, px, top, gy - top + 1, 3, WOOD_MID)
    if fw > 1:
      # Rounded post tops above the board, like the pack's signboards.
      rect(body, px - 1, top, 5, 3, WOOD_MID)
      hline(body, px, top, 3, WOOD_LIGHT)
      put(body, px - 1, top, (0, 0, 0, 0))
      put(body, px + 3, top, (0, 0, 0, 0))
  _planks(body, ox, by, bw, bh, colour, seed)
  img.alpha_composite(outlined(body))
  paste(img, label, ox + (bw - label.width) // 2, by + (bh - label.height) // 2)
  for px in posts:
    tufts(img, px + 1, gy, 2, seed + px, spread=4)
  # Centre the image on the footprint; the posts stand on its feet line.
  dx = (fw * T - W) // 2
  piece = Piece(img, dx=dx, dy=T - H + 1)
  return Made([piece], foot=(fw, 1), use=[(x, 1) for x in range(fw)], text=text)


# --- Notice board ------------------------------------------------------------------------------------------

def _notes(img, x0, y0, w, h, seed):
  """Pin a few paper notes on a cork area (no overlaps), each with a pin and scribbles."""
  rng = noise_rng(seed)
  placed = []
  tries = 0
  target = max(2, (w * h) // 70)
  if w < 8 or h < 6:
    return
  while len(placed) < target and tries < 80:
    tries += 1
    nw, nh = min(rng.randint(6, 9), w - 2), min(rng.randint(5, 7), h - 2)
    nx, ny = x0 + rng.randint(1, w - nw - 1), y0 + rng.randint(1, h - nh - 1)
    if any(nx < px + pw + 1 and px < nx + nw + 1 and ny < py + ph + 1 and py < ny + nh + 1
           for (px, py, pw, ph) in placed):
      continue
    placed.append((nx, ny, nw, nh))
    c = rng.choice(NOTE_COLOURS)
    rect(img, nx + 1, ny + 1, nw, nh, CORK[2])
    rect(img, nx, ny, nw, nh, c)
    hline(img, nx, ny + nh - 1, nw, shade(c, 0.9))
    for ly in range(ny + 2, ny + nh - 1, 2):
      hline(img, nx + 1, ly, rng.randint(2, nw - 2), shade(c, 0.72))
    put(img, nx + nw // 2, ny, rng.choice(PIN_COLOURS))


@item('board', 'sign',
      'Notice board: cork with pinned notes under a title strip. mount=wall hangs it on a wall face (foot 2 tall); '
      'legs stands it outdoors.', foot=(3, 2), scene='wall',
      variants=[{'text': 'Lost & Found', 'length': 4, 'colour': 'brown', 'seed': 4},
                {'mount': 'legs', 'text': 'TOWN NEWS', 'colour': 'forest'}],
      text=Param('text', 'NOTICES', max=32, doc='title'), colour=Param('colour', 'wood', doc='frame'),
      length=Param('int', 3, 2, 4, doc='tiles wide (grows to fit the title)'),
      mount=Param('enum', 'wall', choices=('wall', 'legs')), seed=Param('int', 1, 0, 9999))
def _board(text, colour, length, mount, seed):
  hi, base, lo, deep = tones(colour)

  def inner(fw):
    return fw * T - 14             # the title strip's text width

  # The title stays on one line in the label font; the board grows (up to 4 tiles) if it must.
  pick = _choose(text.replace('\n', ' '), inner, tuple(range(length, 5)), ('mini', 'small'), 1)
  if pick:
    length, font, lines = pick
  else:
    length = 4
    font, lines = fit_text(text.replace('\n', ' '), inner(4), None, ('small',), 1)
  title = _text_img(lines, INK, font)
  W = length * T
  bw = W - 2
  bh = 23
  legs = 0 if mount == 'wall' else 9
  H = bh + legs + 2
  img = new(W, H)
  body = new(W, H)
  bx, by = 1, 1
  if legs:
    for lx in (bx + 4, bx + bw - 7):
      drop_shadow(img, lx + 1.5, H - 2, 4, 1.5)
      post(body, lx, by + bh - 2, legs + 1, 3, WOOD_MID)
  # Frame and cork.
  rect(body, bx, by, bw, bh, base)
  hline(body, bx, by, bw, hi)
  vline(body, bx, by, bh, hi)
  hline(body, bx, by + bh - 1, bw, deep)
  vline(body, bx + bw - 1, by, bh, lo)
  cx0, cy0, cw, ch = bx + 2, by + 2, bw - 4, bh - 4
  rect(body, cx0, cy0, cw, ch, CORK[1])
  hline(body, cx0, cy0, cw, CORK[2])
  vline(body, cx0, cy0, ch, CORK[2])
  rng = noise_rng(seed + 7)
  for _ in range(cw * ch // 14):
    put(body, cx0 + rng.randrange(cw), cy0 + rng.randrange(ch), rng.choice((CORK[0], CORK[2])))
  # Title strip: a paper banner pinned across the top.
  sw = min(cw - 2, title.width + 8)
  sh = title.height + 3
  sx = cx0 + (cw - sw) // 2
  rect(body, sx + 1, cy0 + 2, sw, sh, CORK[2])
  rect(body, sx, cy0 + 1, sw, sh, (250, 248, 238, 255))
  hline(body, sx, cy0 + sh, sw, (222, 216, 200, 255))
  put(body, sx + 1, cy0 + 2, PIN_COLOURS[0])
  put(body, sx + sw - 2, cy0 + 2, PIN_COLOURS[0])
  _notes(body, cx0, cy0 + sh + 2, cw, ch - sh - 2, seed)
  img.alpha_composite(outlined(body))
  paste(img, title, sx + (sw - title.width) // 2, cy0 + 3)
  if mount == 'wall':
    piece = Piece(img, dx=0, dy=1, z=2 * T)
    return Made([piece], foot=(length, 2), solid=[], use=[(x, 2) for x in range(length)], text=text)
  piece = Piece(img, dx=0, dy=T - H + 1)
  return Made([piece], foot=(length, 1), use=[(x, 1) for x in range(length)], text=text)


# --- Chalkboard -----------------------------------------------------------------------------------------------

@item('chalkboard', 'sign',
      'A-frame café chalkboard with chalk writing (2-4 short lines, the first in `colour`). Grows to 3 tiles '
      'for longer lines; press X to read.', foot=(2, 1),
      variants=[{'text': 'Open!', 'colour': 'pink'}, {'text': 'TODAY\nHot cocoa 2\nWaffles 3', 'colour': 'yellow'}],
      text=Param('text', 'MENU\nCoffee 2\nCake 3', max=48, doc='lines split by \\n'),
      colour=Param('colour', 'white', doc='chalk of the first line'))
def _chalkboard(text, colour):
  def inner(fw):
    return {1: 20, 2: 34, 3: 50}[fw]   # the board overhangs its footprint a little

  pick = _choose(text, inner, (1, 2, 3), ('mini', 'small'), 4)
  if pick is None:
    font, lines = fit_text(text, inner(3), None, ('small',), 4, gap=1)
    fw = 3
  else:
    fw, font, lines = pick
  chalk = (238, 240, 232, 255)
  accent = to_rgba(colour)
  imgs = [pixel_text(ln, accent if i == 0 else chalk, font) for i, ln in enumerate(lines)]
  gap = 2 if font == 'mini' else 1
  th = sum(i.height for i in imgs) + gap * (len(imgs) - 1)
  bw = inner(fw) + 6
  bh = th + 10
  legs = 7
  W, H = bw + 4, bh + legs + 5
  img = new(W, H)
  gy = H - 2                       # ground line
  bx, by = 2, 3                    # the front panel's top-left
  for lx in (bx + 1, bx + bw - 2):
    drop_shadow(img, lx, gy, 4, 1.4)
  hi, base, lo, deep = tones('wood')
  rear = new(W, H)
  # The rear panel: its top edge shows above the hinge, its legs behind the front ones.
  rect(rear, bx + 2, by - 2, bw - 4, 3, lo)
  hline(rear, bx + 2, by - 2, bw - 4, base)
  for lx in (bx + 3, bx + bw - 5):
    rect(rear, lx, by + bh - 2, 2, legs - 1, deep)
  img.alpha_composite(outlined(rear))
  body = new(W, H)
  # Front panel: a wooden frame round the slate; its side rails run down as splayed legs.
  rect(body, bx, by, bw, bh, base)
  hline(body, bx, by, bw, hi)
  vline(body, bx, by, bh, hi)
  vline(body, bx + bw - 1, by, bh, lo)
  hline(body, bx, by + bh - 1, bw, lo)
  hline(body, bx + bw // 2 - 2, by + 1, 4, deep)          # the carrying slot
  for side, lx in ((-1, bx), (1, bx + bw - 3)):
    for i in range(legs + 1):
      x = lx + (side if i >= legs - 2 else 0)
      put(body, x, by + bh - 1 + i, hi)
      put(body, x + 1, by + bh - 1 + i, base)
      put(body, x + 2, by + bh - 1 + i, lo)
  rect(body, bx + 2, by + 3, bw - 4, bh - 5, SLATE[1])
  hline(body, bx + 2, by + 3, bw - 4, SLATE[2])
  # Chalk dust smudges.
  for (sx, sy) in ((bx + 4, by + bh - 4), (bx + bw - 7, by + 5)):
    hline(body, sx, sy, 3, SLATE[0])
  img.alpha_composite(outlined(body))
  y = by + 3 + (bh - 5 - th) // 2
  for im in imgs:
    paste(img, im, bx + (bw - im.width) // 2, y)
    y += im.height + gap
  piece = Piece(img, dx=(fw * T - W) // 2, dy=T - H + 1)
  return Made([piece], foot=(fw, 1), use=[(x, 1) for x in range(fw)], text=text)


# --- Plaque ---------------------------------------------------------------------------------------------------

PLAQUES = {
  'brass': (((255, 236, 160, 255), (226, 184, 88, 255), (176, 128, 56, 255), (112, 74, 42, 255)), (96, 58, 34, 255)),
  'stone': (((226, 226, 230, 255), (188, 190, 198, 255), (148, 152, 166, 255), (102, 104, 122, 255)), (78, 78, 96, 255)),
  'wood': (((207, 144, 84, 255), (168, 120, 72, 255), (136, 80, 64, 255), (96, 48, 56, 255)), (70, 34, 40, 255)),
}


def _engraved(lines, font, ink, hi):
  """Text cut into a plate: dark letters with a lit lower edge."""
  dark = text_block(lines, ink, font, gap=1)
  lit = text_block(lines, hi, font, gap=1)
  out = new(dark.width + 1, dark.height + 1)
  out.alpha_composite(lit, (0, 1))
  out.alpha_composite(dark, (0, 0))
  return out


@item('plaque', 'sign',
      'Engraved plaque (brass, stone or wood) set in a little memorial stone, or flat on a wall face. Long text '
      'shows as engraving; X reads it all.', foot=(2, 1),
      variants=[{'text': 'In memory of Rex,\nthe best dog in town', 'material': 'stone'},
                {'mount': 'wall', 'text': 'Founded 2026', 'material': 'wood'}],
      text=Param('text', 'Est. 2026', max=80),
      material=Param('enum', 'brass', choices=('brass', 'stone', 'wood')),
      mount=Param('enum', 'stone', choices=('stone', 'wall'), doc='a memorial stone or a wall face'))
def _plaque(text, material, mount):
  (hi, base, lo, deep), ink = PLAQUES[material]

  def inner(fw):
    return 18 if fw == 1 else 38      # the plate overhangs its footprint a little

  pick = _choose(text, inner, (1, 2), ('mini', 'small'), 3)
  if pick:
    fw, font, lines = pick
    engraving = _engraved(lines, font, ink, hi)
  else:
    # Too long to show legibly: its first line if that fits, then engraved lines (X reads it all).
    fw = 2
    iw = inner(2)
    head = text.split('\n')[0]
    font = next((f for f in ('mini', 'small') if text_size(head, f)[0] <= iw), None)
    rows = [_engraved([head], font, ink, hi)] if font else []
    lines_y = (rows[0].height + 2) if rows else 1
    engraving = new(iw + 1, lines_y + 7)
    if rows:
      engraving.alpha_composite(rows[0], ((iw - rows[0].width) // 2, 0))
    for i in range(3 if not rows else 2):
      ln = iw - 2 - 8 * (i % 2) - (6 if i == 2 else 0)
      x0 = (iw - ln) // 2
      y = lines_y + 3 * i
      for x in range(x0, x0 + ln):
        if (x - x0) % 5 != 4:
          put(engraving, x, y, ink)
          put(engraving, x, y + 1, hi)
  pw, ph = inner(fw) + 6, engraving.height + 6

  def plate(img, px, py):
    rect(img, px, py, pw, ph, base)
    hline(img, px, py, pw, hi)
    vline(img, px, py, ph, hi)
    hline(img, px, py + ph - 1, pw, deep)
    vline(img, px + pw - 1, py, ph, lo)
    if material != 'stone':
      for (sx, sy) in ((px + 1, py + 1), (px + pw - 2, py + 1), (px + 1, py + ph - 2), (px + pw - 2, py + ph - 2)):
        put(img, sx, sy, lo)

  if mount == 'wall':
    W, H = pw + 3, ph + 3
    img = new(W, H)
    body = new(W, H)
    rect(body, 2, 2, pw, ph, (24, 18, 40, 70))
    plate(body, 1, 1)
    img.alpha_composite(outlined(body))
    paste(img, engraving, 1 + (pw - engraving.width) // 2 + 1, 4)
    # At eye level on the two-tile wall face, never below it.
    piece = Piece(img, dx=(fw * T - W) // 2, dy=max(1, min(9, 2 * T - 2 - H)), z=2 * T)
    return Made([piece], foot=(fw, 2), solid=[], use=[(x, 2) for x in range(fw)], text=text)
  # A standing memorial stone: a lit top band, the plate set into its front face.
  rim, top = 3, 4
  sw, sh = pw + 2 * rim, ph + 2 * rim
  W, H = sw + 2, top + sh + 4
  img = new(W, H)
  gy = H - 2
  drop_shadow(img, W / 2, gy, sw / 2 + 1, 2.5)
  body = new(W, H)
  x0, y0 = 1, gy - sh - top + 1
  rect(body, x0 + 1, y0, sw - 2, top, STONE_LIGHT)          # the top, its corners rounded off
  hline(body, x0 + 1, y0, sw - 2, (236, 236, 240, 255))
  rect(body, x0, y0 + 1, sw, top - 1, STONE_LIGHT)
  rect(body, x0, y0 + top, sw, sh, STONE)
  hline(body, x0, y0 + top, sw, STONE_DARK)
  vline(body, x0, y0 + top, sh, STONE_LIGHT)
  vline(body, x0 + sw - 1, y0 + top, sh, STONE_MID)
  hline(body, x0, y0 + top + sh - 1, sw, STONE_DARK)
  for (cx, cy) in ((x0 + 2, y0 + top + sh - 3), (x0 + sw - 4, y0 + top + 2)):
    put(body, cx, cy, STONE_MID)                             # a couple of chips
  rect(body, x0 + rim, y0 + top + rim, pw, ph, STONE_DARK)
  plate(body, x0 + rim, y0 + top + rim - 1)
  img.alpha_composite(outlined(body))
  paste(img, engraving, x0 + rim + (pw - engraving.width) // 2 + 1, y0 + top + rim + 2)
  tufts(img, x0 + 3, gy, 2, 3, spread=2)
  tufts(img, x0 + sw - 5, gy, 2, 5, spread=2)
  piece = Piece(img, dx=(fw * T - W) // 2, dy=T - H + 1)
  return Made([piece], foot=(fw, 1), use=[(x, 1) for x in range(fw)], text=text)
