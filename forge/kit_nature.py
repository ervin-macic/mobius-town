"""Kit family: nature items for Möbius Town builders (registered on import by kit.py).

Conventions (see kit.py's docstring for the full contract):
- `@item(name, 'nature', doc, foot=(w, h), variants=[...], **params)`; the function returns `Made`.
- Draw in the town's palette with kit's helpers (tones, outlined, block, post, foliage, pixel_text ...),
  dark plum outline OUT (OUT_SOFT for foliage), light from the upper left, 2-4 flat shades, no
  anti-aliasing, soft SHADOW ellipse under standing things, 3/4 top-down view.
- Deterministic: randomness only from noise_rng(seed).

This family: trees (the town's own round tree and pine, plus blossom, bare-winter, big and snowy
variants), palm, cactus, bushes (the pack's bush; big ones shaded in its style), hedges (the pack's
hedge pieces cut to any length; east-west runs sort after north-south ones so corners join),
flowers and flower beds, rocks, stumps and the pack's log (a seat), mushrooms, tall grass and reeds
(they hide your feet), ponds (kit water + lily pads, reeds, stones), lily pads and a small fountain.
"""
from __future__ import annotations

import math
from functools import lru_cache

from kit import *  # noqa: F401,F403
from kit import (  # noqa: F401
  AUTUMN, BARK, BARK_DARK, BARK_LIGHT, GRASS, GRASS_DARK, GRASS_LIGHT, LEAF, LEAF_DEEP, LEAF_LIGHT,
  LEAF_MID, LEAVES, OUT, OUT_SOFT, SHADOW, STONE, STONE_DARK, STONE_LIGHT, STONE_MID, WHITE, WOOD,
  WOOD_DARK, WOOD_LIGHT, WOOD_MID, Made, Param, Piece, T, disc_mask, drop_shadow, ellipse, fill_mask, hline, item,
  mix, new, noise_rng, outline, pack_sheet, paint_area, paste, props, put, recolor, rect, rows_of, shade, standing,
  to_rgba, tones, tufts, vline,
)

SNOW_LIT, SNOW_SHADE, SNOW_DEEP = (250, 252, 255, 255), (214, 228, 242, 255), (176, 196, 222, 255)
PACK_SHADOW = (32, 23, 41, 102)        # the pack's own drop shadow under shrubs and stumps
BARK_EDGE = (51, 31, 41, 255)          # the pack's darkest bark line (under logs and stumps)
RING_LIGHT, RING_DARK = (224, 208, 120, 255), (200, 176, 96, 255)  # cut wood (pack stump and log ends)
STONE_DEEP = (104, 108, 124, 255)
POND_RING = (90, 174, 228, 255)  # the ripple ring round the pack's lily pads
LILY_RIM, LILY_PAD, LILY_VEIN = (50, 142, 65, 255), (58, 190, 65, 255), (106, 221, 75, 255)


# --- Small private helpers ---------------------------------------------------------------------------

def _disc(cx, cy, rx, ry):
  """Pixels inside an ellipse (like kit's disc_mask, but only scanning its bounding box)."""
  pts = set()
  for y in range(int(math.floor(cy - ry)) - 1, int(math.ceil(cy + ry)) + 1):
    for x in range(int(math.floor(cx - rx)) - 1, int(math.ceil(cx + rx)) + 1):
      dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
      if dx * dx + dy * dy <= 1.0:
        pts.add((x, y))
  return pts


def _scatter_ground(w, h, cx, cy, rx, ry, n, colours, seed, avoid_rx=0.0, size=1):
  """A transparent ground decal with `n` little specks (petals, leaves) in an ellipse around (cx, cy)."""
  rng = noise_rng(seed)
  img = new(w, h)
  for _ in range(n * 4):
    if n <= 0:
      break
    a = rng.uniform(0, 2 * math.pi)
    r = math.sqrt(rng.uniform(0.0, 1.0))
    x, y = int(cx + math.cos(a) * rx * r), int(cy + math.sin(a) * ry * r)
    if abs(x + 0.5 - cx) < avoid_rx and abs(y - cy) < ry * 0.6:
      continue
    if not (0 <= x < w - size and 0 <= y < h):
      continue
    c = colours[rng.randrange(len(colours))]
    put(img, x, y, c)
    if size > 1:
      put(img, x + 1, y, colours[min(len(colours) - 1, colours.index(c) + 1)])
    n -= 1
  return img


# --- Trees ---------------------------------------------------------------------------------------------

def _tree_dims(big):
  return (40, 52) if big else (32, 44)


# The town tree's canopy recoloured for spring: deeper pinks than kit.BLOSSOM keep the leaf mass's volume.
BLOSSOM_CANOPY = ((255, 232, 240, 255), (240, 160, 192, 255), (208, 108, 154, 255), (140, 64, 112, 255))


def _blossom_tree(seed, big):
  """The town's round tree in spring bloom: the same canopy in pink with white flowers."""
  pal = BLOSSOM_CANOPY
  img = props.tree(seed, big=big)
  img = recolor(img, {LEAF_LIGHT[:3]: pal[0], LEAF[:3]: pal[1], LEAF_MID[:3]: pal[2], LEAF_DEEP[:3]: pal[3]})
  rng = noise_rng(seed * 31 + 5)
  w, h = img.size
  px = img.load()
  petals = {c[:3] for c in pal}

  def leafy(x, y):
    return 0 <= x < w and 0 <= y < h and px[x, y][3] == 255 and px[x, y][:3] in petals

  n = 11 if big else 8
  tries = 0
  while n and tries < 400:
    tries += 1
    x, y = rng.randrange(2, w - 2), rng.randrange(2, h - 14)
    if not all(leafy(x + dx, y + dy) for (dx, dy) in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1))):
      continue
    if px[x, y][:3] in (pal[0][:3], pal[1][:3]):
      for (dx, dy) in ((1, 0), (-1, 0), (0, -1), (0, 1)):  # a white five-petal flower on the lit side
        put(img, x + dx, y + dy, WHITE)
      put(img, x, y, (250, 214, 120, 255))
    else:
      put(img, x + 1, y, pal[1])
      put(img, x, y - 1, pal[1])
      put(img, x, y, pal[0])
    n -= 1
  return img


def _thick_seg(store, x0, y0, x1, y1, wdt):
  """Record a straight branch segment `wdt` px wide into store {(x, y): width}."""
  n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
  for i in range(n + 1):
    t = i / n
    x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
    for k in range(wdt):
      p = (int(math.floor(x + k - (wdt - 1) / 2)), int(round(y)))
      store[p] = max(store.get(p, 0), wdt)


def _grow(store, tips, x, y, ang, length, wdt, depth, rng, env):
  """Recursive bare branches (angle 0 = straight up); tips stay inside the crown ellipse `env`."""
  ex, ey, erx, ery = env
  for _ in range(6):
    x1, y1 = x + math.sin(ang) * length, y - math.cos(ang) * length
    if ((x1 - ex) / erx) ** 2 + ((y1 - ey) / ery) ** 2 <= 1.0 or y1 > ey:
      break
    length *= 0.75
  _thick_seg(store, x, y, x1, y1, wdt)
  if depth == 0 or length < 2:
    tips.append((x1, y1))
    return
  spread = math.radians(rng.uniform(22, 36))
  kids = [ang - spread, ang + spread]
  if depth >= 2 and rng.random() < 0.35:
    kids.append(ang + rng.uniform(-0.15, 0.15))
  for a in kids:
    _grow(store, tips, x1, y1, a, length * rng.uniform(0.62, 0.78), max(1, wdt - 1), depth - 1, rng, env)


def _bare_tree(seed, big):
  """Winter tree: the town tree's trunk forking into bare branches, a last leaf or two still hanging on."""
  rng = noise_rng(seed)
  w, h = _tree_dims(big)
  img = new(w, h)
  cx = w / 2
  fill_mask(img, {(x, y + h - 9) for (x, y) in disc_mask(w, 8, cx, 4, w * 0.36, 3.2)}, SHADOW)
  tw = 6 if big else 5
  tx = int(cx - tw / 2)
  ty = h - 18
  fork = ty - 1
  canopy_h = h - 14
  env = (cx, canopy_h * 0.55, w * 0.47, canopy_h * 0.53)
  store, tips = {}, []
  mains = [-0.75, -0.22, 0.3, 0.8] if big else [-0.62, 0.0, 0.62]
  length = (h - 30) * (0.5 if big else 0.52)
  for i, a in enumerate(mains):
    a += rng.uniform(-0.12, 0.12)
    sx = tx + 1 + (i * (tw - 2)) / max(1, len(mains) - 1)
    _grow(store, tips, sx, fork + 1, a, length * (1.1 if abs(a) < 0.3 else 1.0), 3 if big else 2, 3, rng, env)
  wood = new(w, h)
  for (x, y), wd in store.items():
    if wd >= 2:
      put(wood, x, y, BARK)
  rect(wood, tx, fork, tw, h - 5 - fork, BARK)
  wp = wood.load()
  for y in range(h):
    for x in range(w):
      if wp[x, y][3]:
        if x == 0 or wp[x - 1, y][3] == 0:
          wp[x, y] = BARK_LIGHT
        elif x == w - 1 or wp[x + 1, y][3] == 0:
          wp[x, y] = BARK_DARK
  for (x, y), wd in store.items():
    if wd == 1 and 0 <= x < w and 0 <= y < h and wp[x, y][3] == 0:
      wp[x, y] = BARK_DARK
  vline(wood, tx + 2, ty + 2, 8, BARK_LIGHT)
  put(wood, tx - 1, h - 6, BARK_DARK)
  put(wood, tx + tw, h - 6, BARK_DARK)
  img.alpha_composite(wood)
  rng.shuffle(tips)
  for (x, y) in tips[:3 if big else 2]:
    x, y = int(round(x)), int(round(y))
    put(img, x, y + 1, AUTUMN[1])
    put(img, x + 1, y + 1, AUTUMN[2])
    put(img, x, y + 2, AUTUMN[2])
  return img


def _tree_piece(img):
  return standing(img, (1, 1), dy=2)


@item('tree', 'nature', 'Round leafy tree about two tiles wide: summer green, autumn, pink blossom or bare winter '
      'branches. The trunk tile is solid.', (1, 1),
      variants=[{'season': 'blossom', 'seed': 7}, {'season': 'autumn', 'size': 'big', 'seed': 3},
                {'season': 'bare', 'size': 'big', 'seed': 2}],
      seed=Param('int', 1, 0, 9999, doc='varies the crown'),
      size=Param('enum', 'small', choices=('small', 'big'), doc='big: a taller, wider crown'),
      season=Param('enum', 'summer', choices=('summer', 'autumn', 'blossom', 'bare')))
def _tree(seed, size, season):
  big = size == 'big'
  if season == 'blossom':
    img = _blossom_tree(seed, big)
    w = img.width + 12
    fallen = _scatter_ground(w, 12, w / 2, 7, w / 2 - 1, 4.6, 9 if big else 7,
                             [BLOSSOM_CANOPY[1], BLOSSOM_CANOPY[0], WHITE], seed * 13 + 1, avoid_rx=4)
    return Made([Piece(fallen, dx=(T - w) // 2, dy=8, layer='ground'), _tree_piece(img)], foot=(1, 1))
  if season == 'bare':
    img = _bare_tree(seed, big)
    w = img.width + 8
    fallen = _scatter_ground(w, 12, w / 2, 7, w / 2 - 1, 4.6, 5 if big else 4,
                             [AUTUMN[1], AUTUMN[2], AUTUMN[3]], seed * 13 + 2, avoid_rx=4, size=2)
    return Made([Piece(fallen, dx=(T - w) // 2, dy=8, layer='ground'), _tree_piece(img)], foot=(1, 1))
  img = props.tree(seed, big=big, autumn=season == 'autumn')
  return Made([_tree_piece(img)], foot=(1, 1))


def _pine_img(seed, big=False, snow=False):
  """The town's pine (props.pine, pixel for pixel when small without snow), taller when big, snow-capped."""
  rng = noise_rng(seed)
  if big:
    w, h = 36, 62
    layers = [(4, 13, 6), (11, 23, 9), (20, 35, 13), (31, 47, 16)]
    shadow_rx = 12
  else:
    w, h = 28, 46
    layers = [(4, 12, 6), (12, 22, 10), (20, 33, 13)]
    shadow_rx = 10
  img = new(w, h)
  fill_mask(img, {(x, y + h - 8) for (x, y) in disc_mask(w, 7, w / 2, 3.5, shadow_rx, 3)}, SHADOW)
  rect(img, w // 2 - 2, h - 13, 4, 9, BARK)
  vline(img, w // 2 - 2, h - 13, 9, BARK_DARK)
  body = new(w, h)
  tier = {}
  for k, (y0, y1, half) in enumerate(layers):
    for y in range(y0, y1):
      t = (y - y0) / max(1, (y1 - y0 - 1))
      hw = int(2 + t * half)
      for x in range(w // 2 - hw, w // 2 + hw):
        side = (x - (w // 2 - hw)) / max(1, 2 * hw)
        c = LEAF_DEEP if side > 0.7 else (LEAF_MID if side > 0.35 else (46, 160, 70, 255))
        if rng.random() < 0.05:
          c = LEAF
        put(body, x, y, c)
        tier[(x, y)] = k
  if snow:
    # Snow caps: the top third of every tier (wavy lower edge) and a thin line down its upper slopes.
    srng = noise_rng(seed * 17 + 9)
    for k, (y0, y1, half) in enumerate(layers):
      th = y1 - y0
      depth = {x: int(th * 0.32) + (1 if srng.random() < 0.45 else 0) for x in range(-3, w + 3)}
      for (x, y), kk in tier.items():
        if kk != k:
          continue
        rel = y - y0
        open_above = tier.get((x, y - 1)) != k
        if rel < depth[x] or (open_above and rel < th * 0.75):
          side = (x - w / 2) / (w / 2)
          put(body, x, y, SNOW_LIT if side < 0.0 else SNOW_SHADE if side < 0.5 else SNOW_DEEP)
  body = outline(body, OUT_SOFT)
  img.alpha_composite(body)
  return img


@item('pine', 'nature', 'Tall evergreen pine (small or big), optionally snow-capped; the trunk tile is solid.', (1, 1),
      variants=[{'size': 'big', 'seed': 2}, {'snow': True, 'seed': 3}, {'snow': True, 'size': 'big', 'seed': 4}],
      seed=Param('int', 1, 0, 9999, doc='varies the needles'),
      size=Param('enum', 'small', choices=('small', 'big'), doc='big: four tiers, about four tiles tall'),
      snow=Param('bool', False, doc='white snow on every tier'))
def _pine(seed, size, snow):
  return Made([standing(_pine_img(seed, size == 'big', snow), (1, 1), dy=2)], foot=(1, 1))


# --- Palm ----------------------------------------------------------------------------------------------

PALM_TRUNK = ((214, 176, 120, 255), (178, 134, 88, 255), (138, 96, 70, 255), (96, 62, 58, 255))
COCONUT = ((166, 120, 80, 255), (120, 80, 56, 255), (86, 56, 46, 255))


def _frond(canvas, tx, ty, a, length, far, maxw, rise=0.95, droop=1.35):
  """One palm frond from the crown (tx, ty) toward angle `a`: an arched blade, serrated below, lit on top."""
  th = math.radians(a)
  light, base, mid, deep = (LEAF, LEAF_MID, LEAF_MID, LEAF_DEEP) if far else (LEAF_LIGHT, LEAF, LEAF_MID, LEAF_DEEP)
  cols = {}
  steps = int(length * 3)
  for j in range(steps + 1):
    s = length * j / steps
    u = s / length
    fx = tx + math.cos(th) * s
    fy = ty + math.sin(th) * s * 0.5 - rise * s + droop * s * s / length
    width = maxw * (math.sin(math.pi * min(1.0, 0.15 + u * 0.95)) ** 0.9)
    xi, yt = int(round(fx)), int(round(fy))
    wpx = max(1, int(round(width)))
    notch = xi % 3 == 0 and u > 0.2
    for k in range(wpx + (0 if notch else 1)):
      c = light if k == 0 else base if k <= wpx // 2 else mid if k < wpx else deep
      key = (xi, yt + k)
      if key not in cols or k < cols[key][1]:
        cols[key] = (c, k)
  for (x, y), (c, _k) in cols.items():
    put(canvas, x, y, c)


def _palm_img(seed):
  rng = noise_rng(seed)
  w, h = 60, 62
  img = new(w, h)
  cx0, base = w / 2, h - 5
  d = 1 if rng.random() < 0.5 else -1
  lean = rng.uniform(5, 8)
  ht = rng.randint(35, 39)
  fill_mask(img, {(x, y + h - 9) for (x, y) in disc_mask(w, 8, cx0, 4.5, 8, 3)}, SHADOW)
  trunk = new(w, h)
  hi, mid, lo, deep = PALM_TRUNK
  for i in range(ht + 1):
    t = i / ht
    x = cx0 + d * lean * t * t
    tw = 5 if t < 0.35 else 4
    x0 = int(round(x - tw / 2))
    ring = i % 4 == 0
    for k in range(tw):
      c = hi if k == 0 else lo if k == tw - 1 else mid
      if ring:
        c = deep if k == tw - 1 else lo
      put(trunk, x0 + k, base - i, c)
    if ring:
      put(trunk, x0 - 1, base - i, lo)
      put(trunk, x0 + tw, base - i, deep)
  img.alpha_composite(outline(trunk, OUT))
  tx, ty = cx0 + d * lean, base - ht
  back, front = new(w, h), new(w, h)
  plan = [(-150, 0.75, True), (-30, 0.75, True), (-95, 0.6, True),
          (178, 1.0, False), (2, 1.0, False), (140, 0.8, False), (40, 0.8, False), (100, 0.55, False)]
  for (a, lf, far) in plan:
    a += rng.uniform(-10, 10)
    length = rng.uniform(19, 22) * lf
    c = math.cos(math.radians(a))
    if abs(c) > 0.05:  # keep every tip inside the canvas
      length = min(length, (tx - 3) / -c if c < 0 else (w - 4 - tx) / c)
    _frond(back if far else front, tx, ty, a, length, far, 3.2 if far else 4.2)
  nuts = new(w, h)
  for (ox, oy) in ((-3, 1), (0, 2), (2, 1)):
    x, y = int(tx) + ox, int(ty) + oy
    rect(nuts, x, y, 3, 3, COCONUT[1])
    put(nuts, x, y, COCONUT[0])
    put(nuts, x + 2, y + 2, COCONUT[2])
  crown = new(w, h)
  for layer in (back, nuts, front):
    crown.alpha_composite(layer)
  img.alpha_composite(outline(crown, OUT_SOFT))
  return img


@item('palm', 'nature', 'Palm tree with a curved ringed trunk, coconuts and drooping fronds (beaches, oases); the trunk '
      'tile is solid.', (1, 1), variants=[{'seed': 2}, {'seed': 5}],
      seed=Param('int', 1, 0, 9999, doc='varies the lean and the fronds'))
def _palm(seed):
  return Made([standing(_palm_img(seed), (1, 1), dy=2)], foot=(1, 1))


# --- Cactus ----------------------------------------------------------------------------------------------

CACTUS = ((156, 214, 112, 255), (96, 178, 86, 255), (62, 136, 76, 255), (40, 92, 66, 255))
SPINE = (236, 240, 200, 255)


def _cactus_column(body, x0, y0, wd, ht):
  """A rounded, ribbed cactus column `wd` px wide with its top at y0, lit from the left."""
  hi, base, lo, _deep = CACTUS
  for y in range(y0, y0 + ht):
    for x in range(x0, x0 + wd):
      u = (x - x0) / max(1, wd - 1)
      if y - y0 < 2 and x in (x0, x0 + wd - 1):
        continue  # rounded top
      c = hi if u < 0.3 else base if u < 0.7 else lo
      if wd >= 5 and (x - x0) in (1, wd - 2) and y > y0:
        c = lo if u > 0.5 else base  # ribs
      put(body, x, y, c)
  put(body, x0 + 1, y0, hi)


def _saguaro(seed):
  rng = noise_rng(seed)
  w, h = 22, 36
  body = new(w, h)
  base_y = h - 4
  cw, ch = 6, 27 + rng.randint(-2, 2)
  cx0 = w // 2 - cw // 2
  top = base_y - ch
  sides = [-1, 1]
  rng.shuffle(sides)
  arms = [(sides[0], rng.randint(10, 14), rng.randint(7, 10))]
  if rng.random() < 0.7:
    arms.append((sides[1], rng.randint(13, 17), rng.randint(5, 8)))
  for (side, ay, up) in arms:
    y = base_y - ay
    ax0 = cx0 - 4 if side < 0 else cx0 + cw
    for yy in range(y - 1, y + 3):
      for xx in range(4):
        put(body, ax0 + xx, yy, CACTUS[2] if yy >= y + 2 else CACTUS[1])
    _cactus_column(body, cx0 - 5 if side < 0 else cx0 + cw + 1, y - up, 4, up + 2)
  _cactus_column(body, cx0, top, cw, ch)
  bp = body.load()
  for _ in range(14):
    x, y = rng.randint(cx0, cx0 + cw - 1), rng.randint(top + 2, base_y - 2)
    if bp[x, y][3] and (x - cx0) in (0, 2, 4):
      put(body, x, y, SPINE)
  if rng.random() < 0.5:  # in flower
    put(body, cx0 + 2, top - 1, (240, 128, 168, 255))
    put(body, cx0 + 3, top - 1, (226, 92, 120, 255))
    put(body, cx0 + 2, top - 2, (255, 200, 220, 255))
  img = new(w, h)
  drop_shadow(img, w / 2 + 1, base_y + 0.5, 6, 1.8)
  img.alpha_composite(outline(body, OUT_SOFT))
  return img


def _barrel_cactus(seed):
  rng = noise_rng(seed)
  w, h = 16, 16
  body = new(w, h)
  hi, base, lo, deep = CACTUS
  rx = 5.5 + rng.choice((0, 0.5))
  for (x, y) in _disc(8, 9, rx, 5):
    u = (x - 2.5) / 11
    c = hi if u < 0.3 else base if u < 0.68 else lo
    if x in (5, 8, 11) and y > 5:
      c = lo if x == 11 else base if x == 8 else hi
    if y >= 12:
      c = deep if u > 0.5 else lo
    put(body, x, y, c)
  for (x, y) in rng.sample([(6, 6), (9, 5), (7, 9), (10, 8), (4, 10), (11, 11), (6, 11)], 5):
    put(body, x, y, SPINE)
  flower = rng.choice(((252, 214, 92, 255), (240, 128, 168, 255), (240, 138, 58, 255)))
  put(body, 7, 3, flower)
  put(body, 8, 3, shade(flower, 0.85))
  put(body, 8, 2, mix(flower, WHITE, 0.4))
  img = new(w, h)
  drop_shadow(img, 9, 14, 6, 1.6)
  img.alpha_composite(outline(body, OUT_SOFT))
  return img


@item('cactus', 'nature', 'Desert cactus: a tall saguaro with arms, or a round barrel cactus; sometimes in flower. Solid.',
      (1, 1), variants=[{'seed': 3}, {'shape': 'barrel', 'seed': 2}],
      shape=Param('enum', 'saguaro', choices=('saguaro', 'barrel')),
      seed=Param('int', 1, 0, 9999, doc='varies the arms and flowers'))
def _cactus(shape, seed):
  img = _saguaro(seed) if shape == 'saguaro' else _barrel_cactus(seed)
  return Made([standing(img, (1, 1), dy=2 if shape == 'saguaro' else 1)], foot=(1, 1))


# --- Shrubs ------------------------------------------------------------------------------------------------

def _two_tone_outline(img, mask, lit=LEAF_DEEP, dark=OUT_SOFT):
  """Outline round `mask` like the pack's shrubs: `lit` on the upper-left edges, `dark` elsewhere."""
  w, h = img.size
  xs = [p[0] for p in mask]
  ys = [p[1] for p in mask]
  bcx, bcy = (min(xs) + max(xs) + 1) / 2, (min(ys) + max(ys) + 1) / 2
  bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
  out = img.copy()
  op = out.load()
  for y in range(h):
    for x in range(w):
      if (x, y) in mask:
        continue
      if (x + 1, y) in mask or (x - 1, y) in mask or (x, y + 1) in mask or (x, y - 1) in mask:
        ddx, ddy = (x + 0.5 - bcx) / bw, (y + 0.5 - bcy) / bh
        op[x, y] = lit if ddx * 0.7 + ddy < -0.12 else dark
  return out


_CLUMP = ('.LLL.', 'L+LLL', 'LLLLm', '.mmm.')  # one leaf clump; stamped in staggered rows like scales


def _shrub(lobes, w, h, seed, pal=LEAVES):
  """Pack-style shrub from leaf lobes (cx, cy, rx, ry): staggered leaf clumps lit from the upper left,
  a dark underside and a two-tone outline. Returns (image, leaf mask)."""
  hi, base, mid, deep = pal
  rng = noise_rng(seed)
  owner = {}
  for i, (cx, cy, rx, ry) in enumerate(lobes):
    for p in disc_mask(w, h, cx, cy, rx, ry):
      owner[p] = i
  mask = {p for p in owner if 1 <= p[0] < w - 1 and 1 <= p[1] < h - 1}
  img = new(w, h)
  px = img.load()

  def normal(x, y):
    cx, cy, rx, ry = lobes[owner[(x, y)]]
    return (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry

  for (x, y) in mask:
    nx, ny = normal(x, y)
    px[x, y] = mid if (ny > 0.3 or -nx * 0.55 - ny * 0.85 < -0.3) else base
  xs = [p[0] for p in mask]
  ys = [p[1] for p in mask]
  for row, gy in enumerate(range(min(ys) - 1, max(ys), 3)):
    for gx in range(min(xs) - 2 + (row % 2) * 3, max(xs), 6):
      gx += rng.randint(0, 1)
      if (gx + 2, gy + 2) not in mask:
        continue
      nx, ny = normal(gx + 2, gy + 2)
      light = -nx * 0.55 - ny * 0.85
      if ny > 0.75:
        tone = {'L': deep, '+': deep, 'm': OUT_SOFT}
      elif ny > 0.45:
        tone = {'L': mid, '+': mid, 'm': deep}
      elif light > 0.2:
        tone = {'L': base, '+': hi, 'm': mid}
      elif light > -0.35:
        tone = {'L': base, '+': base, 'm': mid}
      else:
        tone = {'L': mid, '+': base, 'm': deep}
      for sy, line in enumerate(_CLUMP):
        for sx, ch in enumerate(line):
          if ch != '.' and (gx + sx, gy + sy) in mask:
            px[gx + sx, gy + sy] = tone[ch]
  return _two_tone_outline(img, mask, deep, OUT_SOFT), mask


def _dot_flowers(img, mask, colour, n, seed, avoid_bottom=0.62):
  """Little 2x2 blossoms (or berries) lit from the upper left, scattered over the upper part of a leaf mask."""
  hi, base, lo, _deep = tones(colour)
  rng = noise_rng(seed)
  ys = [p[1] for p in mask]
  y0, y1 = min(ys), max(ys)
  cut = y0 + (y1 - y0) * avoid_bottom
  placed = []
  tries = 0
  while n > 0 and tries < 500:
    tries += 1
    x, y = rng.randrange(img.width), rng.randrange(img.height)
    if y > cut or not all((x + dx, y + dy) in mask for dx in (-1, 0, 1, 2) for dy in (-1, 0, 1, 2)):
      continue
    if any(abs(x - qx) + abs(y - qy) < 4 for (qx, qy) in placed):
      continue
    placed.append((x, y))
    put(img, x, y, hi)
    put(img, x + 1, y, base)
    put(img, x, y + 1, base)
    put(img, x + 1, y + 1, lo)
    n -= 1


def _colour_bright(c):
  r, g, b = to_rgba(c)[:3]
  return 0.3 * r + 0.59 * g + 0.11 * b > 150


def _bush_img(seed, big, flowers):
  rng = noise_rng(seed)
  if big:
    w, h = 34, 27
    lobes = [(17 + rng.uniform(-2, 2), 9.5, 9.5, 8.5), (9 + rng.uniform(-1, 1), 14, 7.8, 7.5),
             (25 + rng.uniform(-1, 1), 14, 7.8, 7.5), (17 + rng.uniform(-2, 2), 16, 9, 7.6)]
  else:
    # The town's own bush (the pack's), so new bushes match the ones already growing in town.
    img = _pack_bush()
    if flowers:
      a = img.getchannel('A').load()
      px = img.load()
      mask = {(x, y) for y in range(T) for x in range(T) if a[x, y] == 255 and px[x, y][:3] in
              (LEAF[:3], LEAF_LIGHT[:3], LEAF_MID[:3])}
      _dot_flowers(img, mask, flowers, 4, seed * 3 + 1, avoid_bottom=0.7)
    return img
  img = new(w, h)
  leaves, mask = _shrub(lobes, w, h, seed)
  fill_mask(img, {(x + 1, y + 2) for (x, y) in mask}, PACK_SHADOW)
  if flowers:
    _dot_flowers(leaves, mask, flowers, 13, seed * 3 + 1)
  img.alpha_composite(leaves)
  return img


@item('bush', 'nature', 'Round leafy bush: small is the town\'s own one-tile bush, big a two-tile shrub. Give `flowers` '
      'a colour for blossoms or berries. Solid.', (1, 1),
      variants=[{'size': 'big', 'seed': 2}, {'flowers': 'pink', 'seed': 3}, {'size': 'big', 'flowers': 'red', 'seed': 4}],
      seed=Param('int', 1, 0, 9999, doc='varies the shape and where flowers sit'),
      size=Param('enum', 'small', choices=('small', 'big'), doc='big: a 2x1 shrub'),
      flowers=Param('colour', None, doc='blossom or berry colour; omit for a plain bush'))
def _bush(seed, size, flowers):
  if size == 'big':
    return Made([standing(_bush_img(seed, True, flowers), (2, 1), dy=1)], foot=(2, 1))
  return Made([Piece(_bush_img(seed, False, flowers), 0, 0)], foot=(1, 1))


# --- Hedges (the pack's own hedge pieces, cut and repeated to any length) ---------------------------------

@lru_cache(maxsize=None)
def _ow(x0, y0, x1, y1):
  """A crop of the pack's Overworld sheet (cached: copy before drawing on it)."""
  return pack_sheet('Overworld').crop((x0, y0, x1, y1))


def _pack_bush():
  return _ow(32, 224, 48, 240).copy()


def _hedge_h(length):
  """East-west run: the pack's 2-tile hedge, its 8 px middle module repeated."""
  piece = _ow(0, 256, 32, 272)
  img = new(length * T, T)
  img.alpha_composite(piece.crop((0, 0, 12, T)), (0, 0))
  x = 12
  for _ in range(2 * length - 3):
    img.alpha_composite(piece.crop((12, 0, 20, T)), (x, 0))
    x += 8
  img.alpha_composite(piece.crop((20, 0, 32, T)), (x, 0))
  return img


def _hedge_v(length):
  """North-south run: the pack's vertical hedge cap and foot around its ring hedge's tileable column."""
  piece = _ow(0, 224, 16, 256)
  img = new(T, length * T)
  img.alpha_composite(piece.crop((0, 0, T, 7)), (0, 0))
  y = 7
  for _ in range(length - 1):
    img.alpha_composite(_ow(16, 224, 32, 240), (0, y))
    y += T
  img.alpha_composite(piece.crop((0, 23, T, 32)), (0, y))
  return img


@item('hedge', 'nature', 'Clipped green hedge, 1-12 tiles long, east-west or north-south (`vertical`); solid. Runs that '
      'meet at a corner or a T join up.', (3, 1),
      variants=[{'length': 5}, {'length': 4, 'vertical': True}, {'length': 1}],
      length=Param('int', 3, 1, 12, doc='tiles long'), vertical=Param('bool', False, doc='run north-south'))
def _hedge(length, vertical):
  # East-west runs sort 1 px below their row, after a north-south run ending on the same row, so at
  # corners and T-junctions the long side stays whole and the crossing run tucks in under it.
  if length == 1:
    return Made([Piece(_pack_bush(), 0, 0, z=T + 1)], foot=(1, 1))
  if vertical:
    return Made(rows_of(_hedge_v(length), 1, length), foot=(1, length))
  return Made([Piece(_hedge_h(length), 0, 0, z=T + 1)], foot=(length, 1))


# --- Flowers ------------------------------------------------------------------------------------------------

def _flower_patch(seed, palette=None, count=5):
  """The town's flower patch (props.flower_patch, pixel for pixel at count 5), with more flowers if asked."""
  rng = noise_rng(seed)
  img = new(T, T)
  colours = palette or [(248, 112, 128, 255), (255, 214, 92, 255), (180, 140, 255, 255), WHITE]
  for _ in range(count):
    x, y = rng.randint(2, 13), rng.randint(2, 13)
    c = rng.choice(colours)
    put(img, x, y - 1, c)
    put(img, x - 1, y, c)
    put(img, x + 1, y, c)
    put(img, x, y + 1, c)
    put(img, x, y, (255, 240, 160, 255))
    put(img, x, y + 2, LEAF_MID)
  return img


@item('flowers', 'nature', 'A patch of small wild flowers like the ones dotted round town (walk-through).', (1, 1),
      variants=[{'colours': ['yellow', 'white'], 'count': 9, 'seed': 2}],
      seed=Param('int', 1, 0, 9999, doc='where the flowers grow'),
      colours=Param('colours', None, doc='petal colours; default mixed'),
      count=Param('int', 5, 1, 12, doc='how many flowers'))
def _flowers(seed, colours, count):
  palette = [to_rgba(c) for c in colours] if colours else None
  return Made([Piece(_flower_patch(seed, palette, count), layer='ground')], foot=(1, 1), solid=[])


SOIL = ((140, 96, 70, 255), (112, 74, 56, 255), (88, 56, 46, 255), (66, 42, 42, 255))


def _bloom(img, x, y, colour, kind=0):
  """A flower head centred at (x, y), lit from the upper left: kind 0 a five-petal star, 1 a round bud."""
  hi, base, lo, deep = tones(colour)
  if kind == 0:
    put(img, x, y - 1, hi)
    put(img, x - 1, y, hi)
    put(img, x + 1, y, base)
    put(img, x, y + 1, lo)
    put(img, x - 1, y + 1, lo)
    put(img, x + 1, y + 1, deep)
    yellowish = _colour_bright(colour) and to_rgba(colour)[2] < 140
    put(img, x, y, (190, 96, 52, 255) if yellowish else (252, 226, 120, 255))
  else:
    put(img, x, y - 1, hi)
    put(img, x - 1, y, hi)
    put(img, x, y, base)
    put(img, x + 1, y, lo)
    put(img, x, y + 1, lo)


def _planting_row(img, x0, x1, y, colour, phase):
  """One row of bedding plants: a bumpy strip of leaves with flower heads along its top (y = row foot)."""
  for x in range(x0, x1 + 1):
    top = y - 3 - (1 if (x + phase) % 4 in (1, 2) else 0)
    for yy in range(top, y + 1):
      k = yy - top
      c = LEAF if k == 0 else LEAF_MID if yy < y else LEAF_DEEP
      if k == 1 and (x + phase) % 4 == 1:
        c = LEAF_LIGHT
      put(img, x, yy, c)
  for i, x in enumerate(range(x0 + 1 + (phase % 2), x1, 4)):
    _bloom(img, x, y - 4 + (1 if i % 2 else 0), colour, 1 if (i + phase) % 5 == 4 else 0)


@item('flower_bed', 'nature', 'Raised garden bed: neat rows of flowers in your colours inside a low wood or stone edging; '
      'solid.', (2, 2),
      variants=[{'w': 3, 'h': 1, 'colours': ['yellow', 'orange']},
                {'w': 2, 'h': 2, 'colours': ['rose', 'pink', 'white'], 'edging': 'stone'},
                {'w': 4, 'h': 3, 'colours': ['purple', 'lilac', 'white', 'sky']}],
      w=Param('int', 2, 1, 6, doc='width in tiles'), h=Param('int', 2, 1, 4, doc='depth in tiles'),
      colours=Param('colours', None, doc='one colour per row of flowers; default rose, yellow, white'),
      edging=Param('enum', 'wood', choices=('wood', 'stone')), seed=Param('int', 1, 0, 9999, doc='varies the soil'))
def _flower_bed(w, h, colours, edging, seed):
  cols = colours or ['rose', 'yellow', 'white']
  W, H = w * T, h * T
  top = 5  # canvas rows above the footprint: blooms on the back row peek over the edging
  img = new(W, top + H + 2)
  rng = noise_rng(seed)
  x0, x1 = 1, W - 2
  y0, y1 = top + 2, top + H - 2  # the edging box, inclusive
  face = 4
  fy = y1 - face + 1
  if edging == 'stone':
    hi_, base_, lo_, deep_ = STONE_LIGHT, STONE, STONE_MID, STONE_DARK
  else:
    hi_, base_, lo_, deep_ = WOOD_LIGHT, WOOD, WOOD_MID, WOOD_DARK
  # Edging: a 2 px frame seen from above, then its front face.
  rect(img, x0, y0, x1 - x0 + 1, fy - y0, base_)
  hline(img, x0, y0, x1 - x0 + 1, hi_)
  vline(img, x0, y0, fy - y0, hi_)
  vline(img, x1, y0, fy - y0, lo_)
  rect(img, x0, fy, x1 - x0 + 1, face, lo_)
  hline(img, x0, fy, x1 - x0 + 1, hi_ if edging == 'stone' else base_)
  hline(img, x0, y1, x1 - x0 + 1, deep_)
  if edging == 'stone':
    for row in range(face - 1):
      for x in range(x0 + (3 if row % 2 else 0), x1, 6):
        put(img, x, fy + 1 + row, deep_)
    for x in range(x0 + 4, x1 - 1, 7):
      put(img, x, y0, lo_)
  else:
    for x in range(x0 + T - 1, x1, T):
      vline(img, x, fy, face, deep_)
      put(img, x, y0, lo_)
  # Soil inside the frame.
  sx0, sx1, sy0, sy1 = x0 + 2, x1 - 2, y0 + 2, fy - 3
  rect(img, sx0, sy0, sx1 - sx0 + 1, sy1 - sy0 + 1, SOIL[2])
  hline(img, sx0, sy0, sx1 - sx0 + 1, SOIL[3])
  for _ in range((sx1 - sx0 + 1) * (sy1 - sy0 + 1) // 6):
    put(img, rng.randint(sx0, sx1), rng.randint(sy0 + 1, sy1), SOIL[1] if rng.random() < 0.6 else SOIL[3])
  # Rows of plants from the back to the front, each hiding the foot of the one behind.
  first = sy0 + 4  # the back row's flowers stay inside the frame
  n = max(1, (sy1 - first) // 6 + 1)
  feet = [sy1] if n == 1 else [first + round(i * (sy1 - first) / (n - 1)) for i in range(n)]
  for r, fyb in enumerate(feet):
    _planting_row(img, sx0, sx1, fyb, cols[r % len(cols)], r + seed)
  img = outline(img, OUT)
  sh = new(W, img.height)
  fill_mask(sh, {(x, y1 + 1 + k) for x in range(x0 + 1, x1 + 2) for k in range(2)}, SHADOW)
  sh.alpha_composite(img)
  return Made(rows_of(sh, w, h, 0, top), foot=(w, h))


# --- Rocks, stumps and logs ------------------------------------------------------------------------------------

def _boulder(img, lobes, seed, moss):
  """Grey boulder from lobes (cx, cy, rx, ry), back to front; shaded facets, a crack, maybe moss."""
  rng = noise_rng(seed)
  w, h = img.size
  owner = {}
  for i, (cx, cy, rx, ry) in enumerate(lobes):
    for p in disc_mask(w, h, cx, cy, rx, ry):
      if p[1] <= cy + ry * 0.62:  # flat-bottomed stones sit on the ground
        owner[p] = i
  mask = {p for p in owner if 1 <= p[0] < w - 1 and 1 <= p[1] < h - 1}
  px = img.load()
  for (x, y) in mask:
    cx, cy, rx, ry = lobes[owner[(x, y)]]
    nx, ny = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
    # Faceted like the pack's stonework: a lit top plane, a front face, a shaded right flank.
    if ny > 0.42:
      c = STONE_DARK if ny < 0.53 else STONE_DEEP
    elif ny < -0.3 + nx * 0.25:
      c = STONE_LIGHT if nx < 0.25 else STONE
    elif nx > 0.5:
      c = STONE_DARK if nx > 0.75 else STONE_MID
    else:
      c = STONE if nx < -0.2 and ny < 0.1 else STONE_MID
    if (x, y - 1) in owner and owner[(x, y - 1)] < owner[(x, y)] and ny < 0:
      c = STONE_LIGHT  # a lit edge where a front stone rises over a back one
    px[x, y] = c
  # A crack or two.
  for (cx, cy, rx, ry) in lobes:
    if rx < 4:
      continue
    x, y = int(cx + rng.uniform(-rx * 0.3, rx * 0.3)), int(cy + rng.uniform(-ry * 0.1, ry * 0.3))
    for k in range(rng.randint(2, 4)):
      if (x, y) in mask and px[x, y][:3] != STONE_DEEP[:3]:
        put(img, x, y, STONE_DARK)
      x += rng.choice((-1, 0, 1))
      y += 1
  if moss:
    # Moss hugs the top of the main stone: a ragged cap one or two pixels deep, a few drips down the side.
    cx, cy, rx, ry = lobes[0]
    span = rx * rng.uniform(0.5, 0.8)
    mx = cx + rng.uniform(-rx * 0.35, rx * 0.15)
    for x in range(int(mx - span / 2), int(mx + span / 2) + 1):
      col = sorted(y for (xx, y) in mask if xx == x)
      if not col:
        continue
      depth = 2 if abs(x - mx) < span * 0.3 else 1
      depth += 1 if rng.random() < 0.25 else 0
      for k in range(depth):
        y = col[0] + k
        put(img, x, y, GRASS_LIGHT if k == 0 and rng.random() < 0.5 else GRASS if k == 0 else LEAF_MID)
      if rng.random() < 0.2:
        put(img, x, col[0] + depth, LEAF_MID)
  return mask


def _rock_img(seed, big, moss):
  rng = noise_rng(seed)
  if big:
    w, h = 34, 26
    lobes = [(15 + rng.uniform(-1, 1), 13, 11.5, 10), (8, 15, 6, 5.5), (26 + rng.uniform(-1, 1), 18, 6.5, 5.2)]
  else:
    w, h = 18, 16
    j = rng.uniform(-0.5, 0.5)
    lobes = rng.choice((
      [(12 + j, 7, 4.0, 3.6), (9 + j, 9, 7.0, 6.2), (5, 11.5, 3.0, 2.6)],     # low and wide
      [(9 + j, 8, 6.4, 7.0), (6 + j, 10.5, 3.4, 3.2)],                       # a round boulder
      [(8 + j, 8.5, 6.0, 6.4), (13.5, 11.5, 3.2, 2.8)],                      # a stone and a pebble
    ))
  body = new(w, h)
  mask = _boulder(body, lobes, seed, moss)
  img = new(w, h)
  bottom = max(p[1] for p in mask)
  xs = [p[0] for p in mask]
  drop_shadow(img, (min(xs) + max(xs) + 2) / 2, bottom + 1, (max(xs) - min(xs)) / 2 + 1, 2.2)
  img.alpha_composite(outline(body, OUT))
  tufts(img, int(min(xs)) + 1, bottom + 1, 2 if big else 1, seed, spread=2)
  tufts(img, int(max(xs)) - 2, bottom + 1, 1, seed + 1, spread=1)
  return img


@item('rock', 'nature', 'Grey boulder with a touch of moss; small fits a tile, big is a two-tile pile. Solid.', (1, 1),
      variants=[{'size': 'big', 'seed': 2}, {'seed': 5, 'moss': False}],
      seed=Param('int', 1, 0, 9999, doc='varies the stones'),
      size=Param('enum', 'small', choices=('small', 'big'), doc='big: a 2x1 pile'),
      moss=Param('bool', True, doc='a patch of moss on top'))
def _rock(seed, size, moss):
  big = size == 'big'
  foot = (2, 1) if big else (1, 1)
  return Made([standing(_rock_img(seed, big, moss), foot, dy=2)], foot=foot)


def _stump_small(seed):
  """A one-tile stump in the pack stump's colours: ringed cut top, bark side, knobbly roots."""
  rng = noise_rng(seed)
  w, h = 18, 17
  body = new(w, h)
  cx = 9
  for (dx, y, rx, ry) in ((-6, 12.5, 2.4, 1.8), (6, 12.5, 2.4, 1.8), (-3, 13.5, 2.2, 1.6), (3.5, 13.5, 2.2, 1.6)):
    rx += rng.uniform(-0.3, 0.5)
    for (x, yy) in disc_mask(w, h, cx + dx, y, rx, ry):
      put(body, x, yy, BARK)
    put(body, int(cx + dx - rx * 0.4), int(y - ry * 0.5), BARK_LIGHT)
  for y in range(7, 13):
    for x in range(3, 15):
      u = (x - 3) / 11
      put(body, x, y, BARK_LIGHT if u < 0.25 else BARK if u < 0.75 else BARK_DARK)
  for x in rng.sample((5, 7, 9, 11, 12), 3):
    vline(body, x, 9 + rng.randint(0, 1), rng.randint(2, 3), BARK_DARK)
  ellipse(body, cx, 7, 6, 3.4, BARK_LIGHT)
  ellipse(body, cx, 7.2, 5, 2.6, RING_LIGHT)
  for a in range(0, 360, 8):
    t = math.radians(a)
    put(body, int(math.floor(cx + 2.8 * math.cos(t))), int(math.floor(7.2 + 1.4 * math.sin(t))), RING_DARK)
  put(body, cx, 7, RING_DARK)
  if rng.random() < 0.6:  # a drying crack from the heart
    d = rng.choice((-1, 1))
    put(body, cx + 2 * d, 6, RING_DARK)
    put(body, cx + 3 * d, 5, RING_DARK)
  body = outline(body, BARK_DARK)
  bp = body.load()
  for x in range(w):
    for y in range(h - 1, 0, -1):
      if bp[x, y][3]:
        if bp[x, y][:3] == BARK_DARK[:3]:
          bp[x, y] = BARK_EDGE
        break
  img = new(w, h)
  fill_mask(img, {(x + 1, y + 1) for y in range(9, h) for x in range(w) if bp[x, y][3]}, PACK_SHADOW)
  img.alpha_composite(body)
  tufts(img, 4, 15, 1, seed, spread=1)
  tufts(img, 13, 15, 1, seed + 2, spread=1)
  return img


def _stump_big():
  img = _ow(496, 48, 528, 80)
  return img.crop(img.getbbox())


@item('stump', 'nature', 'Tree stump with a ringed cut top and roots; small fits a tile, big (the town\'s own) is two '
      'tiles wide. Solid.', (1, 1),
      variants=[{'size': 'big'}, {'seed': 4}],
      size=Param('enum', 'small', choices=('small', 'big'), doc='big: the town\'s 2x1 stump'),
      seed=Param('int', 1, 0, 9999, doc='varies the small stump'))
def _stump(size, seed):
  if size == 'big':
    return Made([standing(_stump_big(), (2, 1), dy=2)], foot=(2, 1))
  return Made([standing(_stump_small(seed), (1, 1), dy=1)], foot=(1, 1))


def _log_img(length, seed):
  """The pack's fallen log (the town's own), cut at its bark and repeated to 2-4 tiles; moss by seed."""
  piece = _ow(48, 80, 96, 96)
  img = new(length * T, T)
  img.alpha_composite(piece.crop((0, 0, T, T)), (0, 0))
  for i in range(1, length - 1):
    img.alpha_composite(piece.crop((T, 0, 2 * T, T)), (i * T, 0))
  img.alpha_composite(piece.crop((2 * T, 0, 3 * T, T)), ((length - 1) * T, 0))
  rng = noise_rng(seed)
  if rng.random() < 0.7:  # a tuft of moss on the bark
    mx = rng.randint(8, length * T - 14)
    for k in range(rng.randint(3, 5)):
      put(img, mx + k, 1, LEAF_MID)
      if 0 < k < 3:
        put(img, mx + k, 0, LEAF)
      if k == 1:
        put(img, mx + k, 2, LEAF_DEEP)
  return img


@item('log', 'nature', 'Fallen log with bark and a ringed cut end, 2-4 tiles long; you can sit on it (facing down).',
      (2, 1), variants=[{'length': 3, 'seed': 2}],
      length=Param('int', 2, 2, 4, doc='tiles long (one seat per tile)'),
      seed=Param('int', 1, 0, 9999, doc='where the moss grows'))
def _log(length, seed):
  seats = [{'dx': i, 'dy': 0, 'face': 'down'} for i in range(length)]
  return Made([Piece(_log_img(length, seed), 0, 0, z=1)], foot=(length, 1), solid=[], seats=seats)


# --- Small plants -------------------------------------------------------------------------------------------------

STEM = ((250, 244, 228, 255), (230, 218, 192, 255), (188, 168, 146, 255))


def _mushroom(img, x, base, size, colour, spots, rng):
  """One mushroom: stem foot centred at x on row `base`; size 0 (tiny) .. 2 (big)."""
  hi, mid, lo, deep = tones(colour)
  cw, ch, sw, sh = ((3, 2, 1, 2), (5, 3, 2, 2), (7, 4, 3, 3))[size]
  sx = x - sw // 2
  rect(img, sx, base - sh + 1, sw, sh, STEM[1])
  vline(img, sx, base - sh + 1, sh, STEM[0])
  if sw > 1:
    vline(img, sx + sw - 1, base - sh + 1, sh, STEM[2])
  cy = base - sh  # bottom row of the cap
  cx0 = x - cw // 2
  for r in range(ch):
    y = cy - r
    inset = 0 if r < ch - 1 else (1 if cw > 3 else 0)
    if r == ch - 1 and cw >= 7:
      inset = 2
    for xx in range(cx0 + inset, cx0 + cw - inset):
      u = (xx - cx0) / max(1, cw - 1)
      c = mid
      if r == 0:
        c = lo if u > 0.25 else mid
      elif u < 0.4 and r >= ch - 2:
        c = hi
      if r == 0 and u > 0.75:
        c = deep
      put(img, xx, y, c)
  if spots and cw >= 5:
    for (dx, dy) in rng.sample([(1, 1), (cw - 3, 1), (cw // 2, ch - 1), (2, ch - 2), (cw - 2, 2)], 2):
      if dy < ch:
        put(img, cx0 + dx, cy - dy, WHITE)


@item('mushrooms', 'nature', 'A little cluster of toadstools (red with white spots by default); walk-through.', (1, 1),
      variants=[{'colour': 'tan', 'spots': False, 'seed': 2}, {'colour': 'purple', 'seed': 3}],
      colour=Param('colour', 'red', doc='cap colour'), spots=Param('bool', True, doc='white spots on the caps'),
      seed=Param('int', 1, 0, 9999, doc='varies the cluster'))
def _mushrooms(colour, spots, seed):
  rng = noise_rng(seed)
  body = new(T, T)
  big_x = rng.randint(6, 9)
  shrooms = [(big_x + rng.choice((-5, 5)), 11, 1), (big_x, 13, 2), (big_x + rng.choice((-4, 4)), 14, 0)]
  if rng.random() < 0.5:
    shrooms.append((rng.choice((3, 12)), 14, 0))
  for (x, base, size) in sorted(shrooms, key=lambda m: m[1]):
    x = max(3, min(12, x))
    _mushroom(body, x, base, size, colour, spots, rng)
  img = new(T, T)
  drop_shadow(img, 8, 14.5, 6, 1.6)
  img.alpha_composite(outline(body, OUT))
  return Made([Piece(img, 0, 0, z=14)], foot=(1, 1), solid=[])


def _grass_frames(seed, w=18, h=21):
  """Two frames of a tall grass clump: a fan of thin blades (dark ones behind), the tips swaying."""
  rng = noise_rng(seed)
  base = h - 4
  n = 11
  blades = []
  for i in range(n):
    x = 2.5 + i * 1.25 + rng.uniform(-0.5, 0.5)
    mid = abs(i - (n - 1) / 2) / ((n - 1) / 2)
    tall = int(round(13 - 6 * mid + rng.uniform(-1.5, 1.5)))
    lean = (x - w / 2) * 0.45 + rng.uniform(-1.2, 1.2)
    blades.append((x, tall, lean, i % 3 == 1))
  blades.sort(key=lambda b: not b[3])
  frames = []
  for f in range(2):
    body = new(w, h)
    for (x, tall, lean, back) in blades:
      sway = f if tall > 7 else 0
      for k in range(tall + 1):
        t = k / tall
        xx, yy = int(round(x + lean * t * t + sway * t * t * 1.5)), base - k
        if back:
          c = LEAF_DEEP if t < 0.5 else LEAF_MID
        else:
          c = GRASS_DARK if t < 0.3 else LEAF if t < 0.75 else LEAF_LIGHT
        put(body, xx, yy, c)
        if t < 0.5:
          put(body, xx + 1, yy, LEAF_DEEP if back else LEAF_MID)
    edge = outline(body, LEAF_DEEP)  # a soft green edge, plum only along the ground
    ep, bp = edge.load(), body.load()
    for y in range(base, h):
      for x in range(w):
        if ep[x, y][3] and not bp[x, y][3]:
          ep[x, y] = OUT_SOFT
    img = new(w, h)
    drop_shadow(img, w / 2, base + 1.5, 7, 1.6)
    img.alpha_composite(edge)
    frames.append(img)
  return frames


@item('tall_grass', 'nature', 'A clump of tall grass that sways in the breeze; walk-through (it hides your feet).',
      (1, 1), variants=[{'seed': 4}], seed=Param('int', 1, 0, 9999, doc='varies the blades'))
def _tall_grass(seed):
  frames = _grass_frames(seed)
  return Made([standing(frames, (1, 1), dy=1, z=14, fps=3)], foot=(1, 1), solid=[])


@item('reeds', 'nature', 'Reeds and cattails swaying at the water\'s edge (set them on a pond\'s bank); walk-through.',
      (1, 1), variants=[{'seed': 3}], seed=Param('int', 1, 0, 9999, doc='varies the stems'))
def _reeds_item(seed):
  frames = []
  for f in range(2):
    img = new(24, 20)
    drop_shadow(img, 12, 17.5, 6, 1.4)
    img.alpha_composite(_reeds_img(seed, 5, (6, 10), f), (0, 1))
    frames.append(img)
  return Made([standing(frames, (1, 1), dy=1, z=14, fps=3)], foot=(1, 1), solid=[])


# --- Water: pond, lily pads, small fountain ---------------------------------------------------------------------

def _lily_pad(img, cx, cy, r, rng, ring=True):
  """A pack-style lily pad (round, dark rim, light vein to its notch) with a ripple ring."""
  if ring:
    for (x, y) in _disc(cx, cy, r + 1, r + 1):
      put(img, x, y, POND_RING)
  for (x, y) in _disc(cx, cy, r, r):
    put(img, x, y, LILY_RIM)
  for (x, y) in _disc(cx, cy, r - 1, r - 1):
    put(img, x, y, LILY_PAD)
  a = rng.uniform(0, 2 * math.pi)
  for k in range(int(r)):
    put(img, int(cx + math.cos(a) * k), int(cy + math.sin(a) * k), LILY_VEIN)
  put(img, int(cx - 1), int(cy - 1), LILY_VEIN)


def _water_lily(img, x, y, colour):
  """A small water-lily flower centred at (x, y)."""
  hi, base, lo, deep = tones(colour)
  for (dx, dy, c) in ((-2, 0, base), (2, 0, lo), (-1, -1, hi), (1, -1, base), (0, -2, hi), (-1, 1, base),
                      (1, 1, lo), (0, 1, lo), (-1, 0, hi), (1, 0, base)):
    put(img, x + dx, y + dy, c)
  put(img, x, y, (252, 214, 92, 255))
  put(img, x, y - 1, (252, 236, 150, 255))


@item('lily', 'nature', 'Lily pads with an optional water-lily flower: a flat decal to set on a pond (walk-through).',
      (1, 1), variants=[{'flower': 'pink'}, {'flower': 'white', 'seed': 3}],
      seed=Param('int', 1, 0, 9999, doc='varies the pads'),
      flower=Param('colour', None, doc='flower colour; omit for plain pads'))
def _lily(seed, flower):
  rng = noise_rng(seed)
  img = new(T, T)
  big = (8 + rng.uniform(-1, 1), 8 + rng.uniform(-1, 1))
  small = (big[0] + rng.choice((-5, 5)), big[1] + rng.choice((-4, 4)))
  _lily_pad(img, small[0], small[1], 2.5, rng)
  _lily_pad(img, big[0], big[1], 4, rng)
  if flower:
    _water_lily(img, int(big[0]), int(big[1]), flower)
  return Made([Piece(img, layer='ground')], foot=(1, 1), solid=[])


def _reeds_img(seed, n=5, tall=(5, 9), sway=0):
  """A clump of reeds with a couple of cattails on a 24x18 canvas, foot centred at (12, 16)."""
  rng = noise_rng(seed)
  body = new(24, 18)
  heads = []
  for i in range(n):
    bx = 12 + (i - n // 2) * 2 + rng.randint(-1, 0)
    ht = rng.randint(*tall) + (2 if i == n // 2 else 0)
    lean = rng.uniform(-1.5, 1.5) + (i - n // 2) * 0.6
    for k in range(ht):
      t = k / ht
      x = int(round(bx + lean * t * t + sway * (1 if t > 0.55 and i % 2 == 0 else 0)))
      put(body, x, 16 - k, LEAF_MID if t < 0.35 else LEAF if i % 2 else GRASS_LIGHT)
    if i % 2 == 0 and len(heads) < 2:
      heads.append((int(round(bx + lean)) + sway, 16 - ht))
  for (hx, hy) in heads:
    put(body, hx, hy - 1, WOOD)
    put(body, hx, hy, WOOD_MID)
    put(body, hx, hy + 1, WOOD_MID)
    put(body, hx, hy - 2, LEAF_MID)
  return outline(body, LEAF_DEEP)


def _reeds(img, x, base, seed, n=5):
  paste(img, _reeds_img(seed, n), x - 12, base - 16)


def _pebbles(img, x, y, seed):
  """Two or three grey stones lying together, (x, y) = the ground line under the biggest."""
  rng = noise_rng(seed)
  body = new(16, 8)
  ox, oy = x - 8, y - 6
  for (dx, dy, rx, ry) in ((0, 0, 2.6, 2.0), (3.5, 1, 1.8, 1.4), (-3, 1, 1.5, 1.2))[:rng.choice((2, 3))]:
    cx, cy = 8 + dx, 6 + dy - ry
    for (px_, py_) in _disc(cx, cy, rx, ry):
      top = py_ + 0.5 < cy - ry * 0.2
      put(body, px_, py_, STONE_LIGHT if top and px_ + 0.5 < cx + rx * 0.3 else STONE if top else
          STONE_DARK if px_ + 0.5 > cx + rx * 0.4 else STONE_MID)
  paste(img, outline(body, OUT), ox, oy)


def _round_corners(img, r):
  """Clip a rounded rectangle out of a painted area and put the water's foam back along the new edge."""
  w, h = img.size
  px = img.load()
  for (cx, cy) in ((r, r), (w - r, r), (r, h - r), (w - r, h - r)):
    for y in range(max(0, int(cy - r)), min(h, int(cy + r))):
      for x in range(max(0, int(cx - r)), min(w, int(cx + r))):
        inside_x = x < r or x >= w - r
        inside_y = y < r or y >= h - r
        if inside_x and inside_y and (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r:
          px[x, y] = (0, 0, 0, 0)
  edge = []
  for y in range(h):
    for x in range(w):
      if px[x, y][3] and ((x < r + 2 or x >= w - r - 2) and (y < r + 2 or y >= h - r - 2)):
        if any(not (0 <= x + dx < w and 0 <= y + dy < h) or px[x + dx, y + dy][3] == 0
               for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1))):
          edge.append((x, y))
  for (x, y) in edge:
    px[x, y] = (250, 252, 255, 255)


@item('pond', 'nature', 'Garden pond with a foamy edge, lily pads, reeds and stones; 2-8 x 2-6 tiles, not walkable.',
      (3, 2), variants=[{'w': 4, 'h': 3, 'seed': 2}, {'w': 2, 'h': 2, 'seed': 5}],
      w=Param('int', 3, 2, 8, doc='width in tiles'), h=Param('int', 2, 2, 6, doc='depth in tiles'),
      seed=Param('int', 1, 0, 9999, doc='varies pads, reeds and stones'),
      lilies=Param('bool', True, doc='lily pads and reeds'))
def _pond(w, h, seed, lilies):
  rng = noise_rng(seed)
  W, H = w * T, h * T
  cells = {(x, y) for y in range(h) for x in range(w)}
  img = paint_area('water', cells, w, h, 'soft', seed)
  _round_corners(img, 7)
  reeds_left = rng.random() < 0.5
  if lilies:
    pads = []
    n = max(2, min(7, (w * h) // 2))
    tries = 0
    while len(pads) < n and tries < 200:
      tries += 1
      r = rng.choice((2.5, 3.5, 4))
      x, y = rng.uniform(r + 6, W - r - 6), rng.uniform(r + 7, H - r - 5)
      if all((x - px_) ** 2 + (y - py_) ** 2 > (r + pr + 3) ** 2 for (px_, py_, pr) in pads):
        pads.append((x, y, r))
    for (x, y, r) in pads:
      _lily_pad(img, x, y, r, rng)
    big = [p for p in pads if p[2] >= 3.5]
    if big:
      x, y, r = big[0]
      _water_lily(img, int(x), int(y), rng.choice(('pink', 'white', '#f8b8d0')))
    _reeds(img, 10 if reeds_left else W - 10, H - 4, seed, 5)  # in a corner of the shallows
  # A few stones on the bank, on the side away from the reeds.
  _pebbles(img, rng.randint(W // 2, W - 8) if reeds_left else rng.randint(7, W // 2), H - 1, seed + 1)
  if w * h >= 6:
    _pebbles(img, W - 3 if rng.random() < 0.5 else 3, rng.randint(10, H - 8), seed + 2)
  return Made([Piece(img, 0, 0, layer='ground')], foot=(w, h))


# The pack fountain's stone and water colours (the town square's fountain).
F_STONE = ((213, 213, 213, 255), (148, 158, 168, 255), (112, 120, 136, 255), (80, 80, 96, 255))
F_OUT = (48, 44, 52, 255)
F_WATER = ((30, 124, 184, 255), (41, 150, 219, 255), (90, 174, 228, 255), (255, 255, 255, 255))


def _fountain_frames():
  """A one-tile birdbath fountain in the town fountain's stone: plinth, column, a bowl with a bubbling plume."""
  w, h = 20, 29
  lit, mid, dark, _deep = F_STONE
  stone = new(w, h)
  cx = w / 2
  # Plinth (two blocks) and a short column: the bowl sits about waist-high to a passer-by.
  rect(stone, 4, h - 7, 12, 4, mid)
  hline(stone, 4, h - 7, 12, lit)
  hline(stone, 4, h - 4, 12, dark)
  vline(stone, 10, h - 6, 2, dark)
  rect(stone, 8, 16, 4, h - 23, mid)
  vline(stone, 8, 16, h - 23, lit)
  vline(stone, 11, 16, h - 23, dark)
  # The bowl: its outside below the rim, the rim, then the water inside.
  for (x, y) in _disc(cx, 13, 8.5, 5.5):
    if y >= 13:
      put(stone, x, y, dark if x + 0.5 > cx + 3 else mid)
  for x in (6, 14):
    put(stone, x, 14, dark)
    put(stone, x, 15, dark)
  ellipse(stone, cx, 12, 9, 4, mid)
  for (x, y) in _disc(cx, 12, 9, 4):
    if y <= 10 or (x <= 3 and y <= 12):
      put(stone, x, y, lit)
  ellipse(stone, cx, 12, 6.6, 2.5, F_WATER[0])
  hline(stone, int(cx) - 5, 10, 10, (22, 92, 136, 255))  # the rim's shadow on the water
  base = outline(stone, F_OUT)
  plumes = (
    {'core': [(9, 9), (10, 9), (9, 8), (10, 8), (10, 7), (9, 6), (10, 5)], 'spark': [(10, 6), (9, 8)],
     'drops': [(7, 7), (12, 6), (6, 9), (13, 9)]},
    {'core': [(9, 9), (10, 9), (9, 8), (10, 8), (9, 7), (10, 6), (9, 5), (10, 4)], 'spark': [(9, 7), (10, 4)],
     'drops': [(7, 6), (12, 5), (6, 8), (14, 8)]},
    {'core': [(9, 9), (10, 9), (9, 8), (10, 8), (10, 7), (9, 7), (10, 6)], 'spark': [(10, 8), (9, 5)],
     'drops': [(7, 8), (13, 7), (5, 10), (14, 10), (9, 5)]},
  )
  ripples = ([(5, 12), (13, 13)], [(7, 13), (14, 12)], [(6, 12), (12, 13)])
  frames = []
  for plume, rip in zip(plumes, ripples):
    f = new(w, h)
    drop_shadow(f, cx + 1, h - 3, 8, 2.2)
    f.alpha_composite(base)
    water = new(w, h)
    for (x, y) in plume['core']:
      put(water, x, y, F_WATER[2])
    for (x, y) in plume['drops']:
      put(water, x, y, F_WATER[2])
    for (x, y) in plume['spark']:
      put(water, x, y, F_WATER[3])
    f.alpha_composite(outline(water, F_WATER[1]))
    for (x, y) in rip:
      hline(f, x, y, 2, F_WATER[1])
    put(f, 9, 10, F_WATER[3])
    frames.append(f)
  return frames


@item('fountain_small', 'nature', 'Little stone birdbath fountain with a bubbling spout (animated); solid.', (1, 1),
      variants=[])
def _fountain_small():
  return Made([standing(_fountain_frames(), (1, 1), dy=1, fps=6)], foot=(1, 1))
