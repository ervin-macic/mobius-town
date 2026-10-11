"""Kit family: sport items for Möbius Town builders (registered on import by kit.py).

Conventions (see kit.py's docstring for the full contract):
- `@item(name, 'sport', doc, foot=(w, h), variants=[...], **params)`; the function returns `Made`.
- Draw in the town's palette with kit's helpers (tones, outlined, block, post, foliage, pixel_text ...),
  dark plum outline OUT (OUT_SOFT for foliage), light from the upper left, 2-4 flat shades, no
  anti-aliasing, soft SHADOW ellipse under standing things, 3/4 top-down view.
- Deterministic: randomness only from noise_rng(seed).

Courts are painted with kit.paint_area + kit.paint_lines; these props stand on them. A court's centre
line lies on a tile boundary (2 px straddling it), so a north-south `net` is centred on the left edge
of its column and an east-west one on the top edge of its row.
"""
from __future__ import annotations

import math

from kit import *  # noqa: F401,F403
from kit import (  # noqa: F401
  Made, Param, Piece, T, item, rows_of, standing, to_rgba, tones,
)

# --- Palette ---------------------------------------------------------------------------------------
STEEL = (70, 70, 86, 255)          # poles and frames (the town's floodlight / lamp grey)
STEEL_HI = (128, 130, 148, 255)
STEEL_LO = (50, 48, 64, 255)
PAINT = (248, 248, 248, 255)        # white paint: tape, goal frame, lines
PAINT_LO = (204, 210, 222, 255)
PAINT_DEEP = (156, 162, 182, 255)
MESH = (52, 46, 66, 255)            # dark net strands
MESH_SOFT = (52, 46, 66, 150)
CORD = (226, 230, 236, 255)         # light net strands (goal, hoop)
CORD_LO = (184, 190, 204, 255)
DAPPLE = (24, 18, 40, 60)           # the see-through shadow of a net
PANEL = (28, 30, 44, 255)           # scoreboard face
METALS = {
  'gold': ((255, 244, 170, 255), (246, 200, 66, 255), (208, 146, 40, 255), (138, 84, 34, 255)),
  'silver': ((252, 252, 255, 255), (206, 210, 222, 255), (152, 158, 178, 255), (96, 98, 122, 255)),
  'bronze': ((246, 192, 132, 255), (210, 132, 70, 255), (164, 92, 48, 255), (108, 58, 40, 255)),
}
NET_H = 16  # the net's top band, in px above the ground


def _flip_piece(p, foot_w):
  """Mirror a piece left-right about its footprint (dx follows)."""
  w = p.frames[0].width
  return Piece(flip(p.img), dx=foot_w * T - (p.dx + w), dy=p.dy, z=p.z, layer=p.layer, fps=p.fps)


def _ground_shadow(w, h, cx, cy, rx, ry):
  img = new(w, h)
  drop_shadow(img, cx, cy, rx, ry)
  return img


# --- Net -------------------------------------------------------------------------------------------

def _pole(img, x, y0, y1, pad=None):
  """A 2 px steel post from y0 (top) to y1 (ground) with a padded sleeve near the bottom."""
  for y in range(y0, y1 + 1):
    put(img, x, y, STEEL_HI)
    put(img, x + 1, y, STEEL)
  put(img, x, y0 - 1, STEEL_HI)
  put(img, x + 1, y0 - 1, STEEL_LO)
  if pad:
    hi, base, lo, _deep = pad
    for y in range(y1 - 9, y1 - 1):
      put(img, x - 1, y, hi)
      put(img, x, y, base)
      put(img, x + 1, y, base)
      put(img, x + 2, y, lo)
    hline(img, x - 1, y1 - 9, 4, hi)


def _net_vertical(length, colour):
  pad = tones(colour)
  top = NET_H + 5          # image rows above the footprint
  c0 = 4                   # image column of footprint x = 0 (the boundary is between c0 - 1 and c0)
  w, h = 12, top + length * T
  img = new(w, h)

  def Y(y):
    return y + top

  g_n, g_s = 1, length * T - 2       # where the posts stand (on the court's end lines)
  t0, t1 = g_n - NET_H, g_s - NET_H   # the tape's ends
  # Seen edge-on, the mesh shows as a knotted fringe either side of the tape.
  for y in range(t0 + 1, g_s - 1):
    for x in (-3, -2, 1, 2):
      if x in (-2, 1):
        if y % 3 != 2:
          put(img, c0 + x, Y(y), MESH_SOFT)
      elif y % 3 == 0:
        put(img, c0 + x, Y(y), MESH)
  # The tape: a white band, lit on its left.
  for y in range(t0, t1 + 2):
    put(img, c0 - 1, Y(y), PAINT)
    put(img, c0, Y(y), PAINT_LO)
  posts = new(w, h)
  for gy in (g_n, g_s):
    _pole(posts, c0 - 1, Y(gy - NET_H - 2), Y(gy), pad)
  img.alpha_composite(outlined(posts))
  # Its lattice shadow on the ground, falling right (light from the upper left): it reads as a net.
  sh = new(8, length * T)
  for y in range(g_n + 2, g_s - 1):
    for x in range(1, 8):
      if (x + y) % 3 == 0 or (x - y) % 3 == 0:
        put(sh, x, y, DAPPLE)
  pieces = [p for p in rows_of(sh, 1, length, layer='ground') if p.img.getbbox()]
  pieces += rows_of(img, 1, length, dx=-c0, top=top)
  return Made(pieces, foot=(1, length))


def _net_horizontal(length, colour):
  pad = tones(colour)
  top = NET_H + 13
  w, h = length * T + 4, top + 5
  ox = 2                   # image column of footprint x = 0
  img = new(w, h)

  def Y(y):
    return y + top

  xl, xr = 1, length * T - 3          # left edges of the two posts (2 px each)
  # Mesh: a diamond lattice with see-through holes, a darker cord along the bottom.
  for y in range(-NET_H + 2, -2):
    for x in range(xl + 2, xr):
      if (x + y) % 3 == 0 or (x - y) % 3 == 0:
        put(img, ox + x, Y(y), MESH_SOFT if (x + y) % 3 else MESH)
  hline(img, ox + xl + 2, Y(-3), xr - xl - 2, MESH)
  # The white tape along the top.
  hline(img, ox + xl + 2, Y(-NET_H), xr - xl - 2, PAINT)
  hline(img, ox + xl + 2, Y(-NET_H + 1), xr - xl - 2, PAINT_LO)
  # Antennas (red and white) at the side lines.
  for ax in (xl + 5, xr - 4):
    for i, y in enumerate(range(-NET_H - 9, -NET_H + 2)):
      put(img, ox + ax, Y(y), (214, 64, 64, 255) if (i // 2) % 2 == 0 else PAINT)
  posts = new(w, h)
  for x in (xl, xr):
    _pole(posts, ox + x, Y(-NET_H - 3), Y(0), pad)
  img.alpha_composite(outlined(posts))
  # Shadow: a dappled band just south of the net.
  sh = new(length * T, 4)
  for y in range(0, 3):
    for x in range(xl + 2, xr):
      if (x + y) % 2 == 0 or y == 0:
        put(sh, x, y, DAPPLE)
  return Made([Piece(sh, dx=0, dy=0, layer='ground'), Piece(img, dx=-ox, dy=-top, z=0)], foot=(length, 1))


@item('net', 'sport',
      'Sports net on padded posts. vertical: runs north-south on the LEFT edge of its column (a court centre line); '
      'else east-west along the top edge of its row.', foot=(1, 7),
      variants=[{'length': 4, 'vertical': False, 'colour': 'red'}],
      length=Param('int', 7, 3, 12, doc='tiles'), vertical=Param('bool', True, doc='north-south'),
      colour=Param('colour', 'blue', doc='post padding'))
def _net(length, vertical, colour):
  return _net_vertical(length, colour) if vertical else _net_horizontal(length, colour)


# --- Basketball hoop ---------------------------------------------------------------------------------

def _rim_and_net(img, cx, cy, rx=5, ry=2):
  """Orange rim (ellipse centred at cx, cy) with a white net hanging below it."""
  hi, base, lo, deep = tones('orange')
  # Net: strands narrowing downward.
  for i in range(7):
    y = int(cy) + 1 + i
    half = rx - 1 - i // 2
    for x in range(int(cx - half), int(cx + half) + 1):
      if (x + y) % 2 == 0 or i == 6:
        put(img, x, y, CORD if x < cx + half - 1 else CORD_LO)
  # Rim ring: back half darker, front half bright.
  pts = set()
  for k in range(48):
    a = 2 * math.pi * k / 48
    pts.add((int(math.floor(cx + rx * math.cos(a))), int(math.floor(cy + ry * math.sin(a))), math.sin(a) > 0))
  for (x, y, front) in pts:
    put(img, x, y, base if front else deep)
  for (x, y, front) in pts:
    if front:
      put(img, x, y, base)
  put(img, int(cx - rx), int(cy), hi)


def _hoop_down():
  """Front view: the board faces south. Image coords: footprint (0, 0) at (OX, OY)."""
  OX, OY = 6, 30
  img = new(30, OY + 16)
  # Pole (behind the board) and its base.
  pole = new(30, OY + 16)
  for y in range(OY - 16, OY + 12):
    put(pole, OX + 7, y, STEEL_HI)
    put(pole, OX + 8, y, STEEL)
    put(pole, OX + 9, y, STEEL_LO)
  block(pole, OX + 3, OY + 7, 11, 3, 3, STEEL)
  img.alpha_composite(_ground_shadow(30, OY + 16, OX + 8.5, OY + 13, 7, 2.5))
  img.alpha_composite(outlined(pole))
  # Backboard: white with a dark frame and an orange target square.
  board = new(30, OY + 16)
  bx, by, bw, bh = OX - 3, OY - 27, 23, 16      # its bottom 28 px above the ground at the court's end line
  rect(board, bx, by, bw, bh, PAINT)
  hline(board, bx, by + bh - 1, bw, PAINT_LO)
  vline(board, bx + bw - 1, by, bh, PAINT_LO)
  frame(board, bx + 7, by + 6, 9, 7, tones('orange')[1])
  board = outlined(board)
  img.alpha_composite(board)
  # Rim sticks out toward us, the net hangs below.
  rim = new(30, OY + 16)
  rect(rim, OX + 7, by + bh, 3, 2, STEEL_LO)
  _rim_and_net(rim, OX + 8.5, by + bh + 3.5, 5.5, 2)
  img.alpha_composite(rim)
  return Piece(img, dx=-OX, dy=-OY)


def _hoop_left():
  """Side view: the board faces left (west); the rim overhangs the court to the left of the pole."""
  OX, OY = 14, 48
  W = 30
  img = new(W, OY + 16)
  img.alpha_composite(_ground_shadow(W, OY + 16, OX + 11, OY + 13, 6, 2.5))
  frame_ = new(W, OY + 16)
  # Pole (right of the tile) with a base block.
  for y in range(OY - 34, OY + 12):
    put(frame_, OX + 10, y, STEEL_HI)
    put(frame_, OX + 11, y, STEEL)
    put(frame_, OX + 12, y, STEEL_LO)
  block(frame_, OX + 6, OY + 7, 10, 3, 3, STEEL)
  # Arm and brace from the pole to the back of the board.
  ay = OY + 8 - 34
  hline(frame_, OX + 2, ay, 8, STEEL_HI)
  hline(frame_, OX + 2, ay + 1, 8, STEEL)
  line(frame_, OX + 3, ay + 2, OX + 9, ay + 8, STEEL)
  img.alpha_composite(outlined(frame_))
  # Backboard seen edge-on: a white slab, lit on the left.
  board = new(W, OY + 16)
  top_y, bot_y = OY + 8 - 9 - 42, OY + 8 + 9 - 28
  rect(board, OX - 1, top_y, 3, bot_y - top_y, PAINT)
  vline(board, OX + 1, top_y, bot_y - top_y, PAINT_LO)
  vline(board, OX - 1, top_y + 8, 9, tones('orange')[1])
  img.alpha_composite(outlined(board))
  rim = new(W, OY + 16)
  rcx, rcy = OX - 5.5, OY + 8 - 28
  rect(rim, OX - 2, int(rcy) - 1, 2, 2, STEEL_LO)
  _rim_and_net(rim, rcx, rcy, 5, 2)
  img.alpha_composite(rim)
  return Piece(img, dx=-OX, dy=-OY)


@item('hoop', 'sport',
      'Basketball hoop: pole, backboard, orange rim and net. Stand it just outside the end line; the rim '
      'overhangs the court on the side it faces.', foot=(1, 1),
      variants=[{'facing': 'left'}, {'facing': 'right'}],
      facing=Param('enum', 'down', choices=('down', 'left', 'right'),
                   doc='the way the board faces: left for the right-hand end of a court'))
def _hoop(facing):
  if facing == 'down':
    return Made([_hoop_down()], foot=(1, 1))
  p = _hoop_left()
  if facing == 'right':
    p = _flip_piece(p, 1)
  return Made([p], foot=(1, 1))


# --- Football goal -------------------------------------------------------------------------------------

def _goal_right(width):
  """A goal whose mouth faces right (east): the net box fills the column behind the goal line."""
  front_h, back_h = 18, 10
  top = front_h + 3
  W, H = 20, top + width * T
  img = new(W, H)

  def Y(y):
    return y + top

  g_n, g_s = 2, width * T - 2      # the posts stand here
  x_back, x_front = 2, 15          # back of the box, front posts (2 px: 15, 16)

  def roof_h(x):
    return back_h + (front_h - back_h) * (x - x_back) / (x_front - x_back)

  # Shadow on the grass inside the box.
  rect(img, x_back, Y(g_n), x_front - x_back + 1, g_s - g_n + 1, SHADOW)
  net = new(W, H)
  for x in range(x_back, x_front):
    hx = int(round(roof_h(x)))
    # The roof (and the far side panel under it): a looser, dimmer lattice.
    for y in range(g_n - hx, g_s - hx):
      if (x + y) % 4 == 0 or (x - y) % 4 == 0:
        put(net, x, Y(y), CORD_LO)
    # The near side panel faces us: a finer, brighter lattice.
    for y in range(g_s - hx, g_s + 1):
      if (x + y) % 3 == 0 or (x - y) % 3 == 0:
        put(net, x, Y(y), CORD)
  # The box's frame bars: the near top edge, the far top edge, the back and the ground bar.
  for x in range(x_back, x_front + 1):
    hx = int(round(roof_h(x)))
    put(net, x, Y(g_s - hx), PAINT)
    put(net, x, Y(g_s - hx + 1), PAINT_DEEP)
    put(net, x, Y(g_n - hx), PAINT_LO)
    put(net, x, Y(g_s), PAINT_DEEP)
  for y in range(g_n - back_h, g_s + 1):
    put(net, x_back, Y(y), PAINT_LO if y < g_s - back_h else PAINT_DEEP)
  img.alpha_composite(outline(net, (48, 38, 57, 120)))
  # The white frame: crossbar running down to the near post.
  fr = new(W, H)
  rect(fr, x_front, Y(g_n - front_h), 2, g_s - g_n + front_h + 1, PAINT)
  vline(fr, x_front + 1, Y(g_n - front_h), g_s - g_n + front_h + 1, PAINT_LO)
  img.alpha_composite(outlined(fr))
  return Piece(img, dx=0, dy=-top)


@item('goal', 'sport',
      'Football goal: white posts and crossbar with a net box behind, in the column behind the goal line. '
      'facing right = mouth opens right (left end of a pitch).', foot=(1, 3),
      variants=[{'facing': 'left', 'width': 2}],
      facing=Param('enum', 'right', choices=('right', 'left'), doc='the way the mouth opens'),
      width=Param('int', 3, 2, 4, doc='mouth, in tiles (north-south)'))
def _goal(facing, width):
  p = _goal_right(width)
  if facing == 'left':
    p = _flip_piece(p, 1)
  return Made([p], foot=(1, width))


# --- Bleachers ---------------------------------------------------------------------------------------

FRAME = (104, 106, 128, 255)       # bleacher steelwork
FRAME_LO = (78, 78, 100, 255)
UNDER = (46, 42, 60, 255)          # the dark space under a seat


def _tread(img, x0, y0, w, colour):
  """One tier's top (12 px): a footboard behind, the seat plank along its front edge."""
  hi, base, lo, deep = tones(colour)
  rect(img, x0, y0, w, 5, lo)
  hline(img, x0, y0, w, base)
  hline(img, x0, y0 + 4, w, deep)
  for x in range(x0 + 7, x0 + w, T):
    vline(img, x, y0 + 1, 3, deep)
  rect(img, x0, y0 + 5, w, 7, base)
  hline(img, x0, y0 + 5, w, hi)
  rect(img, x0, y0 + 10, w, 2, lo)
  for x in range(x0 + T - 1, x0 + w - 1, T):
    vline(img, x, y0 + 6, 4, lo)


def _bleachers(length, rows, facing, colour):
  W = length * T
  step, base = 4, 5                 # each row 4 px higher; the lowest seat 5 px off the ground
  hs = [base + ((rows - 1 - r) if facing == 'down' else r) * step for r in range(rows)]
  ays = [r * T + 12 - hs[r] for r in range(rows)]
  pieces = []
  for r in range(rows):
    t0 = ays[r] - 12                # top of this tier's tread, in footprint px
    last = r == rows - 1
    rail = 7 if (facing == 'down' and r == 0) else 0
    if facing == 'down':
      bottom = (ays[r + 1] - 13) if not last else rows * T - 2
    else:
      bottom = (ays[r] - 1) if not last else rows * T - 2
    h = bottom - t0 + 1
    img = new(W + 2, h + 2 + rail)
    oy = 1 + rail
    if facing == 'down' or last:
      fy, fh = oy + 12, h - 12
      rect(img, 1, fy, W, fh, UNDER)
      if facing == 'down':
        # A steel kick plate under the seat plank, in its shadow at the top.
        rect(img, 1, fy + 2, W, fh - 2, FRAME_LO)
        hline(img, 1, fy + 2, W, FRAME)
        hline(img, 1, fy + fh - 2, W, (66, 64, 86, 255))
      else:
        # Seen from behind: the open frame with zig-zag bracing.
        for i, x in enumerate(range(1, W, T)):
          if i % 2 == 0:
            line(img, x + 1, fy + fh - 2, x + T - 1, fy + 1, FRAME_LO)
          else:
            line(img, x + 1, fy + 1, x + T - 1, fy + fh - 2, FRAME_LO)
      hline(img, 1, fy + fh - 1, W, FRAME)
      for x in sorted({1, W - 1} | set(range(1 + 2 * T, W - 1, 2 * T))):
        vline(img, x, fy, fh, FRAME)
        vline(img, x + 1, fy, fh, FRAME_LO)
    _tread(img, 1, oy, W, colour)
    if rail:
      # A rail along the back of the top row.
      hline(img, 1, 1, W, STEEL_HI)
      hline(img, 1, 2, W, STEEL)
      for x in sorted({1, W - 1} | set(range(1 + 2 * T, W - 1, 2 * T))):
        vline(img, x, 1, rail, STEEL_HI)
        vline(img, x + 1, 1, rail, STEEL)
    pieces.append(Piece(outlined(img), dx=-1, dy=t0 - 1 - rail, z=ays[r] - 1))
  sh = new(W + 4, 5)
  fill_mask(sh, disc_mask(W + 4, 5, W / 2 + 2, 2.5, W / 2 + 2, 2.5), SHADOW)
  pieces.insert(0, Piece(sh, dx=-2, dy=rows * T - 4, layer='ground'))
  seats = [{'dx': i, 'dy': r, 'face': facing, 'ax': i * T + 8, 'ay': ays[r]} for r in range(rows) for i in range(length)]
  return Made(pieces, foot=(length, rows), solid=[], seats=seats)


@item('bleachers', 'sport',
      'Tiered stadium seating: one seat per tile per row, back rows higher. facing down = spectators look south.',
      foot=(4, 2), variants=[{'length': 5, 'rows': 3, 'colour': 'sky'}, {'facing': 'up', 'rows': 3}],
      length=Param('int', 4, 2, 8, doc='tiles'), rows=Param('int', 2, 1, 3),
      facing=Param('enum', 'down', choices=('down', 'up'), doc='the way spectators look'),
      colour=Param('colour', 'wood', doc='seat planks'))
def _bleachers_item(length, rows, facing, colour):
  return _bleachers(length, rows, facing, colour)


# --- Scoreboard ----------------------------------------------------------------------------------------

def _char_spans(text, font):
  """Left x of each character of a line drawn by pixel_text (plus the end)."""
  xs = [0]
  for i in range(1, len(text) + 1):
    xs.append(text_size(text[:i], font)[0] + 1)
  return xs


def _two_tone(text, font, colour, digits):
  """One line of pixel text with its digits in another colour."""
  img = pixel_text(text, colour, font)
  dig = pixel_text(text, digits, font)
  xs = _char_spans(text, font)
  for i, ch in enumerate(text):
    if ch.isdigit():
      x0, x1 = xs[i], min(img.width, xs[i + 1])
      if x1 > x0:
        img.paste(dig.crop((x0, 0, x1, img.height)), (x0, 0))
  return img


@item('scoreboard', 'sport',
      'Stadium scoreboard on two legs: a dark panel with bright text, digits in yellow ("HOME 3 - 2 AWAY" or a '
      'title). Grows to fit; "Read" shows it.', foot=(6, 1),
      variants=[{'text': 'BEACH CUP\n11 : 9'}, {'text': 'GAME ON', 'colour': 'red'}],
      text=Param('text', 'HOME 0 - 0 AWAY', max=32, doc='up to 2 lines'),
      colour=Param('colour', 'navy', doc='frame'))
def _scoreboard(text, colour):
  # Fewest lines first (a score stays on one line), then the biggest font, then the narrowest board.
  fit = None
  for n_lines, fonts in ((1, ('big', 'mini')), (2, ('big', 'mini', 'small'))):
    for font in fonts:
      for fw in range(2, 7):
        lines = wrap_text(text, fw * T - 14, font, n_lines)
        if lines is not None:
          fit = (font, lines)
          break
      if fit:
        break
    if fit:
      break
  if fit is None:
    fit = fit_text(text, 6 * T - 14, None, ('small',), 2)
  font, lines = fit
  imgs = [_two_tone(ln, font, (244, 244, 250, 255), (255, 214, 72, 255)) for ln in lines]
  tw = max(i.width for i in imgs)
  fh = font_height(font)
  gap = 2
  th = len(imgs) * fh + (len(imgs) - 1) * gap
  bw = max(tw + 12, 26)
  fw = max(2, -(-(bw + 2) // T))
  bh = th + 10
  W = fw * T
  legs_h = 12
  H = bh + legs_h + 3
  img = new(W, H)
  bx = (W - bw) // 2
  # Legs and their shadows.
  for lx in (bx + 4, bx + bw - 7):
    drop_shadow(img, lx + 1.5, H - 3, 4, 1.5)
  legs = new(W, H)
  for lx in (bx + 4, bx + bw - 7):
    post(legs, lx, bh, legs_h, 3, STEEL)
  img.alpha_composite(outlined(legs))
  # The board: a coloured frame, a dark panel, a row of lamps on top.
  hi, base, lo, deep = tones(colour)
  board = new(W, H)
  rect(board, bx, 1, bw, bh, base)
  hline(board, bx, 1, bw, hi)
  vline(board, bx, 1, bh, hi)
  hline(board, bx, bh, bw, lo)
  vline(board, bx + bw - 1, 2, bh - 1, lo)
  rect(board, bx + 3, 4, bw - 6, bh - 6, PANEL)
  hline(board, bx + 3, 4, bw - 6, (16, 16, 28, 255))
  for lx in range(bx + 5, bx + bw - 5, 5):
    put(board, lx, 2, (255, 236, 150, 255))
  img.alpha_composite(outlined(board))
  y = 4 + (bh - 6 - th) // 2 + 1
  for im in imgs:
    paste(img, im, bx + (bw - im.width) // 2, y)
    y += fh + gap
  piece = Piece(img, dx=0, dy=T - H + 1)
  return Made([piece], foot=(fw, 1), use=[(x, 1) for x in range(fw)], text=text,
              glows=[{'dx': W // 2, 'dy': T - H + 1 + bh // 2, 'radius': 1.25, 'colour': '#ffe6a0', 'flicker': False}])


# --- Trophy ---------------------------------------------------------------------------------------------

def _trophy(metal, sparkle):
  hi, base, lo, deep = METALS[metal]
  w, h = 22, 33
  img = new(w, h)
  cx = 11                                    # the cup's axis: columns cx - 1 and cx
  gy = h - 3                                 # ground line
  drop_shadow(img, cx, gy, 8, 2)
  body = new(w, h)
  # Plinth: a dark wooden block with a little engraved plate.
  block(body, cx - 7, gy - 9, 14, 3, 6, WOOD_MID)
  rect(body, cx - 3, gy - 4, 6, 2, lo)
  hline(body, cx - 3, gy - 4, 6, base)
  # Foot, stem and knob.
  rect(body, cx - 5, gy - 11, 10, 2, base)
  hline(body, cx - 5, gy - 11, 10, hi)
  hline(body, cx - 5, gy - 10, 10, lo)
  put(body, cx + 4, gy - 11, lo)
  rect(body, cx - 1, gy - 15, 2, 4, base)
  put(body, cx - 1, gy - 14, hi)
  rect(body, cx - 2, gy - 16, 4, 1, lo)
  # Bowl: a deep cup, lit from the upper left.
  top = 4
  halves = [7, 7, 7, 7, 6, 6, 5, 4, 3, 2, 2]
  for i, half in enumerate(halves):
    y = top + i
    for x in range(cx - half, cx + half):
      t = (x - (cx - half) + 0.5) / (2 * half)
      c = hi if t < 0.28 else base if t < 0.68 else lo if t < 0.88 else deep
      put(body, x, y, c)
  for x in range(cx - 7, cx + 7):
    put(body, x, top - 1, hi if x < cx + 3 else base)
  for x in range(cx - 6, cx + 6):
    put(body, x, top, deep if cx - 5 <= x < cx + 5 else lo)
  # Handles: loops either side.
  for side in (-1, 1):
    x_out = cx - 10 if side < 0 else cx + 9
    x_in = cx - 9 if side < 0 else cx + 8
    put(body, x_in, top + 1, base)
    for y in range(top + 2, top + 6):
      put(body, x_out, y, hi if side < 0 else lo)
    put(body, x_in, top + 6, base)
    put(body, x_in + (1 if side < 0 else -1), top + 7, lo)
  img.alpha_composite(outlined(body))
  # A star glint on the bowl.
  if sparkle:
    sx, sy = cx - 4, top + 3
    put(img, sx, sy, (255, 255, 255, 255))
    if sparkle > 1:
      for d in ((1, 2) if sparkle > 2 else (1,)):
        for (ddx, ddy) in ((d, 0), (-d, 0), (0, d), (0, -d)):
          put(img, sx + ddx, sy + ddy, (255, 255, 240, 255) if d == 1 else (255, 248, 196, 255))
  return img


@item('trophy', 'sport', 'A shining trophy cup on a little wooden plinth (it twinkles). Solid.', foot=(1, 1),
      variants=[{'colour': 'silver'}, {'colour': 'bronze'}],
      colour=Param('enum', 'gold', choices=('gold', 'silver', 'bronze')))
def _trophy_item(colour):
  frames = [_trophy(colour, s) for s in (0, 0, 1, 2, 3, 2, 1, 0)]
  return Made([standing(frames, (1, 1), dy=0, fps=6)], foot=(1, 1))


# --- Training cones ----------------------------------------------------------------------------------------

def _cone(colour):
  """A small marker cone (7 x 8 px) on a flat rubber base, a white band round its middle."""
  hi, base, lo, deep = tones(colour)
  w, h = 9, 9
  body = new(w, h)
  hline(body, 1, h - 3, 7, base)
  hline(body, 1, h - 2, 7, deep)
  for y in range(1, h - 3):
    half = (y - 1) // 2
    for x in range(4 - half, 4 + half + 1):
      c = hi if x < 4 else base if x == 4 else lo
      if y == 3:
        c = PAINT if x <= 4 else PAINT_LO
      put(body, x, y, c)
  return outlined(body)


CONE_SPOTS = {
  1: [(8, 12)], 2: [(4, 9), (12, 13)], 3: [(4, 7), (12, 9), (6, 14)], 4: [(4, 6), (12, 6), (4, 14), (12, 14)],
}


@item('cones', 'sport', 'A few small training cones on the ground (walk-through).', foot=(1, 1),
      variants=[{'count': 4}, {'count': 2, 'colour': 'yellow'}],
      count=Param('int', 3, 1, 4), colour=Param('colour', 'orange'), seed=Param('int', 1, 0, 9999))
def _cones(count, colour, seed):
  rng = noise_rng(seed)
  img = _cone(colour)
  pieces = []
  for (x, y) in CONE_SPOTS[count]:
    x += rng.randint(-1, 1)
    y += rng.randint(-1, 1)
    sh = new(9, 3)
    fill_mask(sh, disc_mask(9, 3, 4.5, 1.5, 4.5, 1.5), SHADOW)
    pieces.append(Piece(sh, dx=x - 4, dy=y - 1, layer='ground'))
    pieces.append(Piece(img, dx=x - 4, dy=y - img.height + 2, z=y))
  return Made(pieces, foot=(1, 1), solid=[])


# --- Flag ------------------------------------------------------------------------------------------------

def _flag_frames(colour, shape, size):
  hi, base, lo, deep = tones(colour)
  pole_h = 30 if size == 'tall' else 17
  cw, ch = (13, 9) if size == 'tall' else (9, 6)
  w, h = 4 + cw + 4, pole_h + 7
  frames = []
  for k in range(3):
    img = new(w, h)
    drop_shadow(img, 4.5, h - 3, 3.5, 1.5)
    pole = new(w, h)
    px = 3
    gy = h - 3
    for y in range(3, gy + 1):
      striped = size != 'tall' and (y // 3) % 2 == 1
      put(pole, px, y, (226, 64, 64, 255) if striped else PAINT)
      put(pole, px + 1, y, (176, 40, 48, 255) if striped else PAINT_LO)
    rect(pole, px, 1, 2, 2, (250, 214, 90, 255))
    put(pole, px + 1, 2, (200, 150, 50, 255))
    cloth = new(w, h)
    phase = k * 2 * math.pi / 3
    for i in range(cw):
      amp = min(1.0, i / 4)
      off = int(round(math.sin(phase - i * 0.7) * 1.2 * amp))
      slope = math.cos(phase - i * 0.7)
      col_h = ch if shape != 'pennant' else max(1, int(round(ch * (1 - i / cw))))
      y0 = 3 + off + (ch - col_h) // 2
      for j in range(col_h):
        if shape == 'chequered':
          c = (40, 36, 48, 255) if ((i // 2) + (j // 2)) % 2 else PAINT
          if slope < -0.3:
            c = shade(c, 0.85)
        else:
          c = hi if j == 0 else (base if slope > -0.3 else lo)
          if j == col_h - 1 and col_h > 2:
            c = lo if slope > -0.3 else deep
        put(cloth, px + 2 + i, y0 + j, c)
    img.alpha_composite(outlined(pole))
    img.alpha_composite(outlined(cloth))
    frames.append(img)
  return frames


@item('flag', 'sport', 'A flag on a pole, gently waving (tall, or a small striped corner flag).', foot=(1, 1),
      variants=[{'size': 'small', 'colour': 'yellow'}, {'shape': 'pennant', 'colour': 'sky'},
                {'shape': 'chequered'}],
      colour=Param('colour', 'red'), shape=Param('enum', 'square', choices=('square', 'pennant', 'chequered')),
      size=Param('enum', 'tall', choices=('tall', 'small')))
def _flag(colour, shape, size):
  frames = _flag_frames(colour, shape, size)
  w, h = frames[0].size
  return Made([Piece(frames, dx=8 - 4, dy=T - h + 1, fps=4)], foot=(1, 1))


# --- Umpire chair ------------------------------------------------------------------------------------------

def _umpire(colour, side):
  """A tall chair facing down (side=False) or left (side=True). Returns (pieces, seat)."""
  hi, base, lo, deep = tones(colour)
  W, OX, TOP = 18, 1, 13               # image width, image column of footprint x 0, rows above footprint
  H = TOP + 2 * T

  def Y(y):
    return y + TOP

  back, arms, front = new(W, H), new(W, H), new(W, H)
  ay = 8                               # the sitter's feet: the platform's front edge
  # Back legs, seen through the open frame.
  for lx in (3, 11):
    rect(back, OX + lx, Y(8), 2, 12, deep)
  hline(back, OX + 3, Y(15), 10, deep)
  # The platform the chair stands on.
  block(back, OX + 1, Y(3), 14, 4, 2, colour)
  if not side:
    # Backrest behind the sitter: a framed panel.
    rect(back, OX + 2, Y(-10), 12, 13, base)
    hline(back, OX + 2, Y(-10), 12, hi)
    vline(back, OX + 2, Y(-10), 13, hi)
    rect(back, OX + 4, Y(-8), 8, 9, lo)
    hline(back, OX + 4, Y(-8), 8, deep)
    # Armrests either side of the sitter (drawn over them).
    for ax_ in (1, 13):
      rect(arms, OX + ax_, Y(-2), 2, 5, base)
      hline(arms, OX + ax_, Y(-2), 2, hi)
  else:
    # Facing left: the backrest stands along the right edge; armrests behind and in front.
    rect(back, OX + 11, Y(-10), 4, 14, base)
    vline(back, OX + 11, Y(-10), 14, hi)
    hline(back, OX + 11, Y(-10), 4, hi)
    rect(back, OX + 12, Y(-8), 2, 10, lo)
    hline(back, OX + 2, Y(-3), 9, base)
    hline(back, OX + 2, Y(-4), 9, hi)
    vline(back, OX + 2, Y(-3), 6, base)
    hline(arms, OX + 2, Y(1), 9, hi)
    hline(arms, OX + 2, Y(2), 9, base)
    vline(arms, OX + 2, Y(2), 3, base)
  # Front legs with the ladder between them.
  for lx in (1, 13):
    post(front, OX + lx, Y(9), 21, 2, colour)
    rect(front, OX + lx - 1, Y(29), 4, 1, deep)
  for ry in range(12, 28, 4):
    hline(front, OX + 3, Y(ry), 10, hi)
    hline(front, OX + 3, Y(ry + 1), 10, lo)
  sh = new(W, H)
  drop_shadow(sh, OX + 8, Y(28), 9, 3)
  pieces = [Piece(sh, dx=-OX, dy=-TOP, layer='ground'),
            Piece(outlined(back), dx=-OX, dy=-TOP, z=0),
            Piece(outlined(arms), dx=-OX, dy=-TOP, z=ay + 1),
            Piece(outlined(front), dx=-OX, dy=-TOP, z=2 * T)]
  seat = {'dx': 0, 'dy': 0, 'face': 'left' if side else 'down', 'ax': 7 if side else 8, 'ay': ay}
  return pieces, seat


@item('umpire_chair', 'sport',
      'Tall tennis umpire chair with a ladder; walk onto its top tile to sit high up. Footprint 1x2, the base is solid.',
      foot=(1, 2), variants=[{'facing': 'left'}, {'facing': 'right', 'colour': 'white'}],
      facing=Param('enum', 'down', choices=('down', 'left', 'right'), doc='the way the umpire looks'),
      colour=Param('colour', 'forest'))
def _umpire_chair(facing, colour):
  pieces, seat = _umpire(colour, facing != 'down')
  if facing == 'right':
    pieces = [_flip_piece(p, 1) for p in pieces]
    seat = dict(seat, face='right', ax=T - seat['ax'])
  return Made(pieces, foot=(1, 2), solid=[(0, 1)], seats=[seat])
