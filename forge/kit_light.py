"""Kit family: light items for Möbius Town builders (registered on import by kit.py).

Conventions (see kit.py's docstring for the full contract):
- `@item(name, 'light', doc, foot=(w, h), variants=[...], **params)`; the function returns `Made`.
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

# The pack's flame colours (objects.png fire frames): gold outline, orange, yellow, white core.
FIRE_OUT = (169, 122, 30, 255)
FIRE = (248, 184, 56, 255)
FIRE_HI = (248, 248, 128, 255)
WARM = '#ffd78a'  # the town's lamp light
IRON = (58, 54, 72, 255)  # the street lamp's post
IRON_HI = (98, 96, 118, 255)


def _flame(w, h, k, n=4, seed=0):
  """Frame k of an n-frame flame (w x h plus its outline) in the pack's fire colours.

  A rounded base with three tongues (a tall middle one and two shorter side ones) that sway and
  stretch from frame to frame; coloured by depth: orange rim, yellow body, a small white core.
  """
  rng = noise_rng(seed * 31 + k)
  ph = 2 * math.pi * k / n
  W, H = w + 4, h + 4
  cx = W / 2
  base_y = H - 3  # the flame's bottom row
  body = set()
  # Rounded base.
  rx, ry = w / 2, max(1.5, w * 0.34)
  for y in range(H):
    for x in range(W):
      u, v = (x + 0.5 - cx) / rx, (y + 0.5 - (base_y + 0.5 - ry)) / ry
      if u * u + v * v <= 1.0 and y <= base_y:
        body.add((x, y))
  sway = math.sin(ph) * w * 0.18
  tongues = [
    (0.0 + sway, h * (1.0 + 0.08 * math.sin(ph + 1.3)), w * 0.56),
    (-w * 0.3 + sway * 0.5, h * (0.62 + 0.12 * math.sin(ph + 2.4)), w * 0.42),
    (w * 0.3 + sway * 0.5, h * (0.55 + 0.12 * math.sin(ph + 4.1)), w * 0.42),
  ]
  for (dx, th, tw) in tongues:
    tip_x, tip_y = cx + dx, base_y + 1 - th
    for y in range(max(0, int(tip_y)), base_y + 1):
      t = (y + 0.5 - tip_y) / th
      if t <= 0:
        continue
      hw = (tw / 2) * min(1.0, t * 1.25) ** 0.75
      mx = tip_x + (cx + dx * 0.4 - tip_x) * t
      for x in range(W):
        if abs(x + 0.5 - mx) <= hw:
          body.add((x, y))
  # Depth from the edge (4-neighbour erosion) picks the colour.
  depth, cur, d = {}, set(body), 0
  while cur:
    d += 1
    edge = {(x, y) for (x, y) in cur
            if any((x + ex, y + ey) not in cur for ex, ey in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    for p in edge:
      depth[p] = d
    cur -= edge
  img = new(W, H)
  top = min((y for _x, y in body), default=0)
  rim = 1 if w < 9 else 2
  for (x, y), dd in depth.items():
    low = (y - top) / max(1, base_y - top)
    c = FIRE if dd <= rim else (WHITE if dd >= rim + 2 and low > 0.62 else FIRE_HI)
    put(img, x, y, c)
  img = outline(img, FIRE_OUT)
  # A spark above the tip now and then.
  if k % 2 == 1 and h >= 9:
    put(img, int(cx + sway + rng.choice((-2, 2))), max(0, top - 3), FIRE_HI)
  return img


def _flames(w, h, n=4, seed=0):
  return [_flame(w, h, k, n, seed) for k in range(n)]


# --- Lamps --------------------------------------------------------------------------------------

_LAMP_GLASS = ((255, 214, 120), (255, 238, 170))


def _garden_lamp(light):
  """A short garden post lamp: a little lantern head on a knee-high post (outlined)."""
  hi, base, lo, deep = tones(light)
  outer, inner = base, mix(hi, WHITE, 0.3)
  if to_hex(light) == WARM:
    outer, inner = _LAMP_GLASS[0] + (255,), _LAMP_GLASS[1] + (255,)  # the street lamp's own glass
  w, h = 12, 26
  img = new(w, h)
  drop_shadow(img, w / 2, h - 3, 4.5, 1.8)
  rect(img, 5, 11, 2, h - 14, IRON)
  vline(img, 5, 11, h - 14, IRON_HI)
  rect(img, 3, h - 5, 6, 2, IRON)
  hline(img, 3, h - 5, 6, IRON_HI)
  # Lantern head: glass between a little roof and a base plate.
  rect(img, 3, 5, 6, 6, outer)
  rect(img, 4, 6, 4, 4, inner)
  frame(img, 3, 5, 6, 6, IRON)
  vline(img, 5, 6, 4, IRON)
  hline(img, 2, 11, 8, IRON)
  hline(img, 2, 4, 8, IRON)
  hline(img, 3, 3, 6, IRON)
  hline(img, 4, 2, 4, IRON_HI)
  put(img, 5, 1, IRON)
  put(img, 6, 1, IRON)
  return outlined(img)


@item('lamp', 'light', 'Lamp with a warm glow: the town\'s street lamp, or a short garden post lamp.', (1, 1),
      variants=[{'style': 'garden'}, {'style': 'garden', 'colour': 'sky'}],
      style=Param('enum', 'street', choices=('street', 'garden'),
                  doc='street: the town\'s tall lamp; garden: a short post lamp'),
      colour=Param('colour', WARM, doc='light colour'))
def _lamp(style, colour):
  light = to_rgba(colour)
  if style == 'street':
    img = props.lamp()
    if colour_name(colour) != WARM:
      hi, base, lo, deep = tones(light)
      img = recolor(img, {_LAMP_GLASS[0]: base, _LAMP_GLASS[1]: mix(hi, WHITE, 0.3)})
    return Made([standing(img, (1, 1), dy=1)], foot=(1, 1),
                glows=[{'dx': 8, 'dy': -30, 'radius': 2.5, 'colour': to_hex(light), 'flicker': False}])
  img = _garden_lamp(light)
  piece = standing(img, (1, 1), dy=1)
  return Made([piece], foot=(1, 1),
              glows=[{'dx': 8, 'dy': piece.dy + 8, 'radius': 1.75, 'colour': to_hex(light), 'flicker': False}])


# --- Lanterns -----------------------------------------------------------------------------------

def _paper_lantern(c):
  """A round paper lantern glowing from inside, with caps, ribs and a tassel; 16 x 22 (outlined)."""
  hi, base, lo, deep = tones(c)
  glow_hi = mix(hi, (255, 240, 200, 255), 0.45)
  img = new(16, 22)
  cx, cy, rx, ry = 8, 10, 6.5, 5.5
  for y in range(3, 17):
    for x in range(1, 15):
      u, v = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
      if u * u + v * v <= 1:
        col = glow_hi if (u < -0.1 and v < 0.25 and u * u + v * v < 0.55) else hi if u < 0.45 else base
        if u > 0.75 or v > 0.8:
          col = lo
        put(img, x, y, col)
  # Ribs: the paper's bamboo hoops.
  for y in (7, 10, 13):
    for x in range(1, 15):
      if img.getpixel((x, y))[3] and (x + 0.5 - cx) ** 2 / rx ** 2 + (y + 0.5 - cy) ** 2 / ry ** 2 < 0.92:
        put(img, x, y, mix(img.getpixel((x, y)), deep, 0.45))
  # Caps, tassel.
  cap = (58, 40, 52, 255)
  gold = (240, 196, 58, 255)
  hline(img, 5, 4, 6, cap)
  hline(img, 6, 3, 4, cap)
  hline(img, 5, 16, 6, cap)
  hline(img, 6, 17, 4, gold)
  vline(img, 7, 18, 3, gold)
  vline(img, 8, 18, 3, (200, 150, 40, 255))
  return outlined(img)


def _iron_lantern(frame_c, flame_k):
  """A standing metal lantern: ring, roof, glass with a candle inside, base (outlined); 12 x 21."""
  hi, base, lo, deep = tones(frame_c)
  img = new(12, 21)
  drop_shadow(img, 6, 18.5, 4.5, 1.6)
  glass = (255, 222, 140, 255)
  glass_hi = (255, 244, 200, 255)
  # Glass box with a stub of candle inside.
  rect(img, 3, 7, 6, 8, glass)
  rect(img, 4, 8, 2, 5, glass_hi)
  rect(img, 5, 12, 2, 3, (238, 226, 196, 255))
  # Frame: corner posts, roof, base.
  vline(img, 2, 6, 10, hi)
  vline(img, 9, 6, 10, base)
  hline(img, 2, 15, 8, base)
  rect(img, 1, 16, 10, 2, lo)
  hline(img, 1, 16, 10, base)
  rect(img, 2, 5, 8, 1, hi)
  hline(img, 3, 4, 6, base)
  hline(img, 4, 3, 4, lo)
  # Ring handle.
  put(img, 4, 1, base)
  put(img, 7, 1, base)
  hline(img, 5, 0, 2, base)
  put(img, 5, 2, lo)
  put(img, 6, 2, lo)
  img = outlined(img)
  # The candle's flame (no outline: it glows behind the glass).
  if flame_k % 2 == 0:
    put(img, 5, 11, FIRE)
    put(img, 6, 11, FIRE)
    put(img, 6, 10, FIRE_HI)
    put(img, 6, 9, WHITE)
  else:
    put(img, 5, 11, FIRE)
    put(img, 6, 11, FIRE_HI)
    put(img, 5, 10, FIRE_HI)
    put(img, 5, 9, WHITE)
  return img


@item('lantern', 'light', 'A glowing lantern: a round paper one hanging overhead (walk-through), or a metal one '
      'standing on the ground.', (1, 1),
      variants=[{'style': 'hanging', 'colour': 'gold'}, {'style': 'standing'},
                {'style': 'standing', 'colour': 'forest'}],
      style=Param('enum', 'hanging', choices=('hanging', 'standing'),
                  doc='hanging: paper, overhead; standing: metal, on the ground'),
      colour=Param('colour', None, doc='paper (hanging) or metal frame (standing); default red paper, iron frame'))
def _lantern(style, colour):
  if style == 'hanging':
    c = to_rgba(colour or 'red')
    lamp = _paper_lantern(c)
    W, H = 16, 34
    img = new(W, H)
    # A short cord with a loop at the top: it hangs from a line, a branch or the ceiling above.
    cord = (74, 60, 84, 255)
    vline(img, 7, 3, H - 22 - 2, cord)
    put(img, 6, 1, cord)
    put(img, 8, 1, cord)
    put(img, 6, 2, cord)
    put(img, 8, 2, cord)
    put(img, 7, 0, cord)
    paste(img, lamp, 0, H - 22)
    dy = -42  # the lantern hangs above people's heads
    light = mix(c, (255, 214, 140, 255), 0.55)
    return Made([Piece(img, dx=0, dy=dy, layer='over')], foot=(1, 1), solid=[],
                glows=[{'dx': 8, 'dy': dy + H - 22 + 10, 'radius': 2.25, 'colour': to_hex(light), 'flicker': False}])
  c = to_rgba(colour or (74, 70, 88))
  frames = [_iron_lantern(c, k) for k in range(2)]
  piece = standing(frames, (1, 1), dy=1, fps=3)
  return Made([piece], foot=(1, 1),
              glows=[{'dx': 8, 'dy': piece.dy + 11, 'radius': 1.75, 'colour': '#ffc864', 'flicker': True}])


# --- Fire ---------------------------------------------------------------------------------------

def _torch_post(style):
  """The torch's post (outlined), 14 wide: returns (image, flame x, row of the bowl's rim)."""
  if style == 'post':
    img = new(14, 32)
    paste(img, props.torch_post(), 1, 2)
    return img, 7, 8
  img = new(14, 34)
  drop_shadow(img, 7, 31, 4.5, 1.8)
  # A bamboo pole with growth rings, a woven cup at the top.
  pole = new(14, 34)
  rect(pole, 6, 10, 3, 22, WOOD_LIGHT)
  vline(pole, 8, 10, 22, WOOD)
  for y in (15, 22, 28):
    hline(pole, 6, y, 3, WOOD_MID)
  rect(pole, 4, 5, 7, 6, BARK)
  hline(pole, 4, 5, 7, BARK_LIGHT)
  for y in (7, 9):
    for x in range(4, 11, 2):
      put(pole, x + (y // 2) % 2, y, BARK_DARK)
  vline(pole, 10, 6, 5, BARK_DARK)
  hline(pole, 5, 11, 5, BARK_DARK)
  img.alpha_composite(outlined(pole))
  return img, 7, 6


@item('torch', 'light', 'A standing torch with a flickering flame: the Town Hall\'s iron post or a bamboo garden '
      'torch.',
      (1, 1), variants=[{'style': 'tiki'}],
      style=Param('enum', 'post', choices=('post', 'tiki'),
                  doc='post: the Town Hall\'s iron torch; tiki: a bamboo torch'))
def _torch(style):
  post_img, fx, fy = _torch_post(style)
  flames = _flames(7, 11, 4, seed=2)
  fw, fh = flames[0].size
  W, H = 14, post_img.height + fh - fy - 2
  frames = []
  for f in flames:
    img = new(W, H)
    paste(img, post_img, 0, H - post_img.height)
    paste(img, f, fx - fw // 2, H - post_img.height + fy + 3 - fh)
    frames.append(img)
  piece = standing(frames, (1, 1), dy=1, fps=8)
  flame_cy = piece.dy + H - post_img.height + fy - fh // 2 + 1
  return Made([piece], foot=(1, 1),
              glows=[{'dx': 8, 'dy': flame_cy, 'radius': 2.5, 'colour': '#ffb050', 'flicker': True}])


# The pack's fire frames on objects.png (row 3), cropped from y=48: the row above holds leaves.
_PACK_FIRE = [(65, 48, 79, 64), (81, 48, 95, 64), (97, 48, 111, 64), (113, 48, 127, 64),
              (128, 48, 143, 64), (145, 48, 159, 64), (161, 48, 175, 64)]


def _pack_fire():
  """The pack's own 7-frame fire (as the town's fireplaces use it), each frame 16 x 17."""
  sheet = pack_sheet('objects')
  frames = []
  for box in _PACK_FIRE:
    img = sheet.crop(box)
    f = new(16, 17)
    f.alpha_composite(img, ((16 - img.width) // 2, 17 - img.height))
    frames.append(f)
  return frames


def _stone(c, w=5, h=4):
  """One ring stone (outlined), lit from the upper left."""
  hi, base, lo, deep = c
  img = new(w + 2, h + 2)
  rect(img, 1, 1, w, h, base)
  put(img, 1, 1, (0, 0, 0, 0))
  put(img, w, 1, (0, 0, 0, 0))
  hline(img, 2, 1, w - 2, hi)
  put(img, 1, 2, hi)
  hline(img, 2, h, w - 2, lo)
  put(img, w, h - 1, lo)
  return outlined(img)


def _log(length):
  """A short log seen from the side with a light cut end (outlined), length x 4."""
  img = new(length + 2, 6)
  rect(img, 1, 1, length, 4, BARK)
  hline(img, 1, 1, length, BARK_LIGHT)
  hline(img, 1, 4, length, BARK_DARK)
  rect(img, length - 2, 1, 3, 4, WOOD_LIGHT)
  put(img, length - 1, 2, WOOD)
  put(img, length - 1, 3, WOOD_MID)
  return outlined(img)


@item('campfire', 'light', 'A campfire: crackling flames on crossed logs in a ring of stones, with a flickering glow.',
      (1, 1), seed=Param('int', 1, 0, 9999))
def _campfire(seed):
  rng = noise_rng(seed)
  W, H = 24, 34
  base = new(W, H)
  front = new(W, H)
  cx, cy = 12, 27  # middle of the ring (canvas)
  drop_shadow(base, cx, cy + 1, 10.5, 3.5)
  # Ashes and embers in the pit.
  ellipse(base, cx, cy, 7.5, 3, (74, 64, 72, 255))
  ellipse(base, cx, cy - 0.5, 5, 2, (110, 70, 52, 255))
  stones = [tones(s) for s in (STONE, STONE_MID, (176, 170, 160, 255))]
  n = 9
  for i in range(n):
    a = 2 * math.pi * (i + 0.5) / n + rng.uniform(-0.12, 0.12)
    x = cx + math.cos(a) * 9.5
    y = cy + math.sin(a) * 4.5
    st = _stone(stones[rng.randrange(len(stones))], rng.choice((4, 5)), rng.choice((3, 4)))
    target = front if math.sin(a) > 0.2 else base
    paste(target, st, int(round(x - st.width / 2)), int(round(y - st.height / 2)))
  # Logs crossed over the pit.
  logs = new(W, H)
  l1 = _log(13)
  paste(logs, l1, cx - 8, cy - 4)
  l2 = flip(_log(12))
  paste(logs, l2, cx - 5, cy - 2)
  frames = []
  fire = _pack_fire()
  for f in (fire[4], fire[5], fire[6], fire[0]):  # the big frames loop smoothly
    img = base.copy()
    img.alpha_composite(logs)
    paste(img, f, cx - 8, cy - 18)
    img.alpha_composite(front)
    frames.append(img)
  piece = standing(frames, (1, 1), dy=3, fps=8)
  return Made([piece], foot=(1, 1),
              glows=[{'dx': 8, 'dy': piece.dy + cy - 9, 'radius': 3.0, 'colour': '#ffa040', 'flicker': True}])


# --- Candles ------------------------------------------------------------------------------------

# Cluster layouts: (x of the candle's left edge, base row, width, height), back first.
_CANDLES = {
  1: [(6, 13, 4, 9)],
  2: [(3, 12, 4, 10), (9, 14, 4, 6)],
  3: [(2, 12, 3, 7), (7, 11, 4, 11), (10, 14, 3, 5)],
  4: [(1, 12, 3, 8), (6, 11, 4, 12), (11, 12, 3, 6), (4, 15, 3, 5)],
  5: [(0, 13, 3, 6), (4, 11, 3, 9), (8, 11, 4, 12), (12, 13, 3, 7), (5, 15, 3, 4)],
}


@item('candles', 'light', 'A little cluster of lit candles of different heights, standing on the floor (walk-through).',
      (1, 1), variants=[{'count': 5}, {'count': 1, 'colour': 'red'}],
      count=Param('int', 3, 1, 5, doc='how many candles'),
      colour=Param('colour', 'cream', doc='wax'))
def _candles(count, colour):
  hi, base, lo, deep = tones(colour)
  W, H = 20, 32
  ox = 2  # footprint x inside the canvas
  oy = H - T - 1
  bodies = new(W, H)
  tips = []
  for (x, by, w, h) in _CANDLES[count]:
    x0, y0 = ox + x, oy + by - h
    rect(bodies, x0, y0, w, h, base)
    vline(bodies, x0, y0, h, hi)
    vline(bodies, x0 + w - 1, y0 + 1, h - 1, lo)
    hline(bodies, x0, y0, w, mix(hi, WHITE, 0.3))
    # A drip of wax down the side, and the wick.
    put(bodies, x0 + 1, y0 + 1, mix(hi, WHITE, 0.3))
    put(bodies, x0 + 1, y0 + 2, hi)
    put(bodies, x0 + w // 2, y0 - 1, (60, 44, 40, 255))
    tips.append((x0 + w // 2, y0 - 1))
  shadow_img = new(W, H)
  drop_shadow(shadow_img, ox + 8, oy + 13.5, 7, 2)
  bodies = outlined(bodies)
  frames = []
  for k in range(2):
    img = shadow_img.copy()
    img.alpha_composite(bodies)
    for i, (tx, ty) in enumerate(tips):
      flick = (k + i) % 2
      put(img, tx, ty, FIRE)
      put(img, tx, ty - 1, FIRE_HI)
      put(img, tx + (1 if flick else 0), ty - 2, WHITE if not flick else FIRE_HI)
      put(img, tx - 1, ty, FIRE_OUT if flick else FIRE)
      if not flick:
        put(img, tx, ty - 3, FIRE_HI)
    frames.append(img)
  gx = sum(t[0] for t in tips) / len(tips) - ox
  gy = min(t[1] for t in tips) - oy
  return Made([Piece(frames, dx=-ox, dy=-oy, fps=3)], foot=(1, 1), solid=[],
              glows=[{'dx': int(round(gx)), 'dy': gy, 'radius': 1.25 + 0.15 * count, 'colour': '#ffc864',
                      'flicker': True}])


# --- Spotlight ----------------------------------------------------------------------------------

@item('spotlight', 'light', 'A pool of light on the ground (flat steps of brightness) with a soft glow: a stage '
      'spot or a sunbeam (walk-through).', (2, 2),
      variants=[{'size': 3, 'colour': 'pink'}, {'size': 1}],
      size=Param('int', 2, 1, 6, doc='tiles across'),
      colour=Param('colour', '#fff4c8', doc='light colour'))
def _spotlight(size, colour):
  c = to_rgba(colour)
  W = H = size * T
  img = new(W, H)
  rx = W / 2 - 0.5
  ry = rx * 0.72
  cx, cy = W / 2, H / 2
  steps = ((1.0, 46), (0.78, 74), (0.5, 104))
  light = mix(c, WHITE, 0.4)
  for y in range(H):
    for x in range(W):
      u, v = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
      d = u * u + v * v
      a = 0
      for (r, al) in steps:
        if d <= r * r:
          a = al
      if a:
        img.putpixel((x, y), (light[0], light[1], light[2], a))
  return Made([Piece(img, layer='ground')], foot=(size, size), solid=[],
              glows=[{'dx': W // 2, 'dy': H // 2, 'radius': max(0.75, size * 0.7), 'colour': to_hex(c),
                      'flicker': False}])
