#!/usr/bin/env python3
"""Build Mobius Town's world module: maps, sprite atlas and metadata.

    python3 tools/build_world.py              # writes engine/world.gen.js
    python3 tools/build_world.py --preview D  # also writes full-map previews into D

Art: the CC0 "Zelda-like tilesets and sprites" pack by ArMM1998 (art/zelda-like)
plus procedural props in tools/props.py drawn in the same palette.

Coordinates: maps are measured in 16 px tiles; entity positions and sprite
rects are in pixels. Each entity has a sort line (`z`, world px) so avatars and
props are drawn in front-to-back order at runtime. Flat things (terrain, floors,
walls, rugs, wall decorations) are baked into each map's ground image.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import props as P  # noqa: E402
from female import female_sheet  # noqa: E402
from pixel import (  # noqa: E402
  GRASS, OUT, STONE_DARK, T, WOOD_DARK, frame, hline, new, noise_rng, outline, put, rect, recolor,
  shade, vline,
)

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art' / 'zelda-like' / 'gfx'
SHEETS = {
  'ow': Image.open(ART / 'Overworld.png').convert('RGBA'),
  'in': Image.open(ART / 'Inner.png').convert('RGBA'),
  'obj': Image.open(ART / 'objects.png').convert('RGBA'),
}


def crop(sheet, x0, y0, x1, y1, trim=True):
  img = SHEETS[sheet].crop((x0, y0, x1, y1))
  if not trim:
    return img, 0, 0
  bb = img.getbbox()
  if not bb:
    return img, 0, 0
  return img.crop(bb), bb[0], bb[1]


def tile(sheet, tx, ty):
  return SHEETS[sheet].crop((tx * T, ty * T, tx * T + T, ty * T + T))


# --- Sprites -------------------------------------------------------------------------

SPRITES: dict[str, list[Image.Image]] = {}
SPRITE_FPS: dict[str, float] = {}


def reg(sid, img, frames=None, fps=0.0):
  SPRITES[sid] = frames or [img]
  if fps:
    SPRITE_FPS[sid] = fps
  return sid


def pack_sprite(sid, sheet, box):
  img, ox, oy = crop(sheet, *box)
  reg(sid, img)
  return ox, oy


def build_sprites():
  # Pack props (offsets of the trimmed image inside each window are returned for placement).
  offs = {}
  offs['house'] = pack_sprite('house', 'ow', (96, 0, 176, 80))
  base_house = SPRITES['house'][0]
  roof_rows = (0, 0, base_house.width, 44)
  roof_cols = {(86, 58, 63): None, (121, 88, 79): None, (148, 120, 92): None}

  def roof(tints):
    mapping = {k: v for k, v in zip(roof_cols, tints)}
    return recolor(base_house, mapping, roof_rows)
  reg('house_slate', roof([(54, 62, 92), (78, 92, 130), (110, 128, 168)]))
  reg('house_red', roof([(120, 40, 44), (168, 60, 56), (206, 98, 80)]))
  reg('house_plum', roof([(84, 44, 92), (122, 66, 132), (160, 102, 168)]))
  reg('house_green', roof([(40, 92, 66), (58, 128, 84), (96, 168, 104)]))
  reg('fountain', None, frames=[crop('ow', x, 144, x + 48, 192)[0] for x in (352, 400, 448)], fps=6)
  offs['stall'] = pack_sprite('stall', 'ow', (288, 352, 368, 448))
  pack_sprite('bench', 'ow', (448, 64, 496, 96))
  pack_sprite('bench_low', 'ow', (448, 96, 496, 128))
  pack_sprite('crates', 'ow', (480, 0, 512, 32))
  pack_sprite('barrels', 'ow', (528, 0, 560, 32))
  pack_sprite('plant_pot', 'ow', (512, 16, 528, 48))
  pack_sprite('stump', 'ow', (496, 48, 528, 80))
  pack_sprite('rocks', 'ow', (64, 16, 96, 48))
  pack_sprite('log', 'ow', (48, 80, 96, 96))
  offs['gate'] = pack_sprite('gate', 'ow', (64, 496, 128, 560))
  pack_sprite('statue', 'ow', (128, 496, 160, 560))
  pack_sprite('banners', 'ow', (80, 432, 112, 464))
  pack_sprite('flag', 'ow', (48, 464, 80, 520))
  pack_sprite('castle', 'ow', (352, 0, 400, 96))
  pack_sprite('tower_stone', 'ow', (0, 336, 48, 448))
  pack_sprite('tower_cone', 'ow', (48, 352, 96, 448))
  pack_sprite('hedge', 'ow', (0, 256, 32, 272))
  pack_sprite('bush', 'ow', (32, 224, 48, 240))
  pack_sprite('crate_big', 'ow', (560, 128, 592, 160))
  for i, x in enumerate((416, 432, 448)):
    pack_sprite(f'produce{i}', 'ow', (x, 320, x + 16, 352))
  board, _, _ = crop('ow', 128, 96, 176, 136)
  reg('sign_chess', P.sign(board, 'chess', (40, 30, 34, 255)))
  reg('sign_games', P.sign(board, 'games', (54, 104, 214, 255)))
  reg('sign_film', P.sign(board, 'film', (176, 34, 54, 255)))
  reg('sign_coffee', P.sign(board, 'coffee', (110, 64, 40, 255)))
  pack_sprite('signpost', 'ow', (88, 96, 120, 140))
  # Inner furniture from the pack.
  pack_sprite('bookshelf', 'in', (48, 192, 96, 224))
  pack_sprite('plant_tall', 'in', (128, 192, 144, 224))
  pack_sprite('fireplace', 'in', (192, 160, 224, 208))
  pack_sprite('dresser', 'in', (160, 112, 208, 160))
  pack_sprite('wardrobe', 'in', (96, 144, 144, 192))
  pack_sprite('window', 'in', (144, 64, 176, 96))
  pack_sprite('paint_green', 'in', (192, 0, 224, 16))
  pack_sprite('paint_night', 'in', (224, 0, 256, 16))
  pack_sprite('paint_land', 'in', (256, 0, 288, 16))
  pack_sprite('plant_small', 'in', (176, 160, 192, 176))
  pack_sprite('long_table', 'in', (224, 112, 272, 144))
  pack_sprite('rug_green', 'in', (0, 112, 48, 160))
  # Animated fire (7 frames) and spinning heart (4 frames) from the objects sheet.
  fire_boxes = [(65, 47, 79, 64), (81, 47, 95, 64), (97, 47, 111, 64), (113, 47, 127, 64),
                (128, 47, 143, 64), (145, 47, 159, 64), (161, 47, 175, 64)]
  fire_frames = []
  for box in fire_boxes:
    img = SHEETS['obj'].crop(box)
    frame_img = new(16, 17)
    frame_img.alpha_composite(img, ((16 - img.width) // 2, 17 - img.height))
    fire_frames.append(frame_img)
  reg('fire', None, frames=fire_frames, fps=10)
  heart_frames = []
  for box in [(2, 51, 14, 63), (19, 51, 30, 63), (36, 51, 46, 63), (51, 51, 62, 63)]:
    img = SHEETS['obj'].crop(box)
    f = new(12, 12)
    f.alpha_composite(img, ((12 - img.width) // 2, 0))
    heart_frames.append(f)
  reg('heart_spin', None, frames=heart_frames, fps=8)
  reg('heart_big', SHEETS['obj'].crop((64, 2, 79, 16)))
  # Procedural props.
  for i in range(6):
    reg(f'tree{i}', P.tree(100 + i, big=(i % 3 == 0)))
  reg('tree_autumn', P.tree(77, big=True, autumn=True))
  for i in range(3):
    reg(f'pine{i}', P.pine(300 + i))
  for i in range(6):
    reg(f'flowers{i}', P.flower_patch(500 + i))
  reg('lamp', P.lamp())
  reg('notice', P.notice_board())
  reg('chess_table', P.chess_table_wide())
  reg('c4_table', P.connect4_table_wide())
  reg('arcade_a', P.arcade((200, 50, 70, 255), (255, 210, 70, 255)))
  reg('arcade_b', P.arcade((50, 90, 190, 255), (90, 230, 200, 255)))
  reg('arcade_c', P.arcade((60, 150, 80, 255), (240, 120, 200, 255)))
  reg('tv', P.tv())
  reg('counter', P.counter(5))
  reg('menu', P.menu_board())
  reg('cafe_table', P.cafe_table())
  reg('conf_table', P.conference_table(4, 2))
  for colour_name, colour in (('wood', P.WOOD), ('blue', (70, 96, 160, 255)), ('green', (92, 140, 96, 255))):
    for face in ('down', 'up', 'left', 'right'):
      seat_img, back_img = P.chair_parts(colour, face)
      reg(f'chair_{colour_name}_{face}_seat', seat_img)
      reg(f'chair_{colour_name}_{face}_back', back_img)
  for n in (3, 4):
    seat_img, back_img = P.sofa_row((170, 40, 60, 255), n)
    reg(f'sofa{n}_seat', seat_img)
    reg(f'sofa{n}_back', back_img)
  reg('bench3_seat', P.bench_seat(3))
  reg('bench3_back', P.bench_back(3))
  reg('whiteboard', P.whiteboard())
  reg('reception', P.reception_desk(4))
  reg('cooler', P.water_cooler())
  reg('popcorn', P.popcorn_machine())
  reg('podium', P.podium())
  reg('plant_big', P.plant_big(3))
  reg('spot', P.spotlight_floor())
  reg('torch', P.torch_post())
  reg('floodlight', P.floodlight())
  reg('mobius_pedestal', P.mobius_pedestal())
  reg('townhall', town_hall_sprite())
  # Speech/emote icons (objects sheet) for the client.
  for name, box in {
    'bubble_talk': (32, 98, 46, 111), 'bubble_dots': (48, 98, 62, 111),
    'bubble_excl': (32, 130, 46, 143), 'bubble_q': (48, 130, 62, 143),
  }.items():
    reg(name, SHEETS['obj'].crop(box))
  return offs


# --- The Town Hall: one composed sprite ----------------------------------------------------------

TH_TILES_W = 42


def town_hall_sprite():
  """A grand Town Hall: tall central keep with a gate, wings, cone and stone towers.

  Layout in tiles (left to right): stone tower 3, wing 9, cone tower 3, keep 12,
  cone tower 3, wing 9, stone tower 3. Bottoms share one ground line.
  """
  castle = SPRITES['castle'][0]          # 48 x 96: roof cap (top 48) + wall face (bottom 48)
  cap = castle.crop((0, 0, 48, 48))
  face = castle.crop((0, 48, 48, 96))
  stone_tower = SPRITES['tower_stone'][0]
  cone_tower = SPRITES['tower_cone'][0]
  gate = SPRITES['gate'][0]
  banners = SPRITES['banners'][0]
  keep_h = 48 + 48 * 2
  H = max(keep_h, stone_tower.height, cone_tower.height) + 6
  W = TH_TILES_W * T
  img = new(W, H)
  ground = H

  def block_column(x, faces):
    y = ground - 48 * faces - 48
    img.alpha_composite(cap, (x, y))
    for i in range(faces):
      img.alpha_composite(face, (x, ground - 48 * (faces - i)))

  # Wings (one face tall) and keep (two faces tall).
  for i in range(3):
    block_column((3 + i * 3) * T, 1)
    block_column((30 + i * 3) * T, 1)
  for i in range(4):
    block_column((15 + i * 3) * T, 2)
  # Windows: two rows on the keep, one row on the wings.
  win = P.arched_window(True)
  for i in range(4):
    kx = (15 + i * 3) * T + 18
    img.alpha_composite(win, (kx, ground - 96 + 10))
    if i in (0, 3):
      img.alpha_composite(win, (kx, ground - 48 + 14))
  for wx in (3, 6, 9, 30, 33, 36):
    img.alpha_composite(win, (wx * T + 18, ground - 48 + 12))
  # Towers.
  for (sprite, tx) in ((stone_tower, 0), (cone_tower, 12), (cone_tower, 27), (stone_tower, 39)):
    img.alpha_composite(sprite, (tx * T + (3 * T - sprite.width) // 2, ground - sprite.height))
  # Gate in the middle of the keep, banners either side.
  gx = (15 * T) + (12 * T - gate.width) // 2
  img.alpha_composite(gate, (gx, ground - gate.height))
  img.alpha_composite(banners, (gx - 44, ground - 96 + 30))
  img.alpha_composite(banners, (gx + gate.width + 12, ground - 96 + 30))
  return img


# --- Maps ---------------------------------------------------------------------------------

class Map:
  def __init__(self, mid, name, w, h, outdoor, theme):
    self.id, self.name, self.w, self.h = mid, name, w, h
    self.outdoor = outdoor
    self.theme = theme
    self.ground = new(w * T, h * T)
    self.solid = bytearray(w * h)
    self.rooms = []
    self.room = bytearray(w * h)
    self.ents = []
    self.doors = []
    self.objects = []
    self.spawn = (w // 2, h // 2, 'down')
    self.labels = []
    self.seat_count = 0

  def paint(self, img, x, y):
    self.ground.alpha_composite(img, (int(x), int(y)))

  def paint_tile(self, img, tx, ty):
    self.paint(img, tx * T, ty * T)

  def block(self, x, y, w=1, h=1, v=1):
    for yy in range(y, y + h):
      for xx in range(x, x + w):
        if 0 <= xx < self.w and 0 <= yy < self.h:
          self.solid[yy * self.w + xx] = v

  def is_solid(self, x, y):
    return self.solid[y * self.w + x] != 0

  def ent(self, sid, x, y, z=None):
    img = SPRITES[sid][0]
    if z is None:
      z = y + img.height
    self.ents.append([sid, int(x), int(y), int(z)])

  def add_room(self, rid, name, kind, rects, **extra):
    idx = len(self.rooms)
    self.rooms.append({'id': rid, 'name': name, 'kind': kind, **extra})
    for (x, y, w, h) in rects:
      for yy in range(y, y + h):
        for xx in range(x, x + w):
          self.room[yy * self.w + xx] = idx
    return idx

  def door(self, x, y, to, tx, ty, face):
    self.doors.append({'x': x, 'y': y, 'to': to, 'tx': tx, 'ty': ty, 'face': face})
    self.solid[y * self.w + x] = 2

  def seat(self, tx, ty, face, chair=None, ax=None, ay=None, **extra):
    """A tile you sit on by walking onto it. `chair` names a chair colour to draw."""
    self.seat_count += 1
    sid = extra.pop('id', None) or f'seat-{self.id}-{self.seat_count}'
    ax = tx * T + 8 if ax is None else ax
    ay = ty * T + 12 if ay is None else ay
    if chair:
      seat_img = f'chair_{chair}_{face}_seat'
      back_img = f'chair_{chair}_{face}_back'
      top = ty * T
      if face == 'down':
        self.ent(back_img, ax - 8, top - 6, top)
        self.ent(seat_img, ax - 8, top, top + 1)
      elif face == 'up':
        self.ent(seat_img, ax - 8, top, top + 1)
        self.ent(back_img, ax - 8, top + 9, ay + 4)
      else:
        self.ent(back_img, ax - 8, top - 2, top)
        self.ent(seat_img, ax - 8, top + 1, top + 1)
    self.objects.append({'id': sid, 'kind': 'seat', 'x': tx, 'y': ty, 'face': face, 'ax': ax, 'ay': ay, **extra})
    return sid

  def export(self, previews=None):
    data = {
      'id': self.id, 'name': self.name, 'w': self.w, 'h': self.h, 'outdoor': self.outdoor,
      'theme': self.theme,
      'ground': data_url(self.ground),
      'solid': ''.join(str(v) for v in self.solid),
      'rooms': self.rooms,
      'roomGrid': ''.join(chr(97 + v) for v in self.room),
      'ents': self.ents,
      'doors': self.doors,
      'objects': self.objects,
      'spawn': list(self.spawn),
      'labels': self.labels,
    }
    if previews:
      self.preview(previews)
    return data

  def preview(self, out_dir, debug=False):
    img = self.ground.copy()
    for sid, x, y, z in sorted(self.ents, key=lambda e: e[3]):
      img.alpha_composite(SPRITES[sid][0], (x, y))
    if debug:
      tint = new(T, T, (255, 0, 0, 70))
      seat_tint = new(T, T, (0, 255, 0, 90))
      for yy in range(self.h):
        for xx in range(self.w):
          if self.solid[yy * self.w + xx] == 1:
            img.alpha_composite(tint, (xx * T, yy * T))
      for o in self.objects:
        if o['kind'] == 'seat':
          img.alpha_composite(seat_tint, (o['x'] * T, o['y'] * T))
    door_tint = new(T, T, (0, 140, 255, 120))
    for d in self.doors:
      img.alpha_composite(door_tint, (d['x'] * T, d['y'] * T))
    scale = 2 if self.w * T < 900 else 1
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(Path(out_dir) / f'map-{self.id}{"-debug" if debug else ""}.png')


def data_url(img):
  buf = io.BytesIO()
  img.save(buf, format='PNG', optimize=True)
  return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


# --- Ground painters ----------------------------------------------------------------------

GRASS_TILES = [('ow', 0, 0)] * 6 + [('ow', 0, 9), ('ow', 1, 9), ('ow', 1, 10), ('ow', 5, 9)]


def paint_grass(m, rng):
  for y in range(m.h):
    for x in range(m.w):
      s, tx, ty = rng.choice(GRASS_TILES)
      m.paint_tile(tile(s, tx, ty), x, y)


def paving_texture(kind):
  if kind == 'street':
    block = SHEETS['ow'].crop((13 * T, 15 * T, 15 * T, 17 * T))
  else:  # plaza stone
    a = SHEETS['ow'].crop((14 * T, 11 * T, 15 * T, 13 * T))
    block = new(2 * T, 2 * T)
    block.paste(a, (0, 0))
    block.paste(a.transpose(Image.FLIP_TOP_BOTTOM), (T, 0))
  return block


def pave(m, cells, kind):
  """Fill path cells with a paving texture and draw a curb where it meets grass."""
  tex = paving_texture(kind)
  cells = set(cells)
  for (x, y) in cells:
    sub = tex.crop(((x % 2) * T, (y % 2) * T, (x % 2) * T + T, (y % 2) * T + T))
    m.paint_tile(sub, x, y)
  edge = (96, 48, 56, 255) if kind == 'street' else (112, 118, 132, 255)
  lip = shade(edge, 1.35)
  for (x, y) in cells:
    px, py = x * T, y * T
    g = m.ground
    if (x, y - 1) not in cells:
      hline(g, px, py, T, edge)
      hline(g, px, py + 1, T, lip)
    if (x, y + 1) not in cells:
      hline(g, px, py + T - 1, T, edge)
    if (x - 1, y) not in cells:
      vline(g, px, py, T, edge)
    if (x + 1, y) not in cells:
      vline(g, px + T - 1, py, T, edge)


def rect_cells(x, y, w, h):
  return {(xx, yy) for yy in range(y, y + h) for xx in range(x, x + w)}


def disc_cells(cx, cy, r):
  return {(x, y) for y in range(int(cy - r) - 1, int(cy + r) + 2) for x in range(int(cx - r) - 1, int(cx + r) + 2)
          if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r}


def pond(m, x, y, w, h, rng):
  """Rectangular pond from the pack's 3x3 grass-edged pond pieces."""
  for yy in range(y, y + h):
    for xx in range(x, x + w):
      cx = 2 if xx == x else (4 if xx == x + w - 1 else 3)
      cy = 6 if yy == y else (8 if yy == y + h - 1 else 7)
      m.paint_tile(tile('ow', cx, cy), xx, yy)
  m.block(x, y, w, h)
  for _ in range(4):
    lx, ly = rng.randint(x + 1, x + w - 2), rng.randint(y + 1, y + h - 2)
    m.paint(SHEETS['ow'].crop((rng.choice((2, 3)) * T, 0, rng.choice((2, 3)) * T + T, T)), lx * T, ly * T)


def scatter_flowers(m, rng, area, count, avoid):
  x0, y0, x1, y1 = area
  for _ in range(count):
    x, y = rng.randint(x0, x1), rng.randint(y0, y1)
    if (x, y) in avoid or m.is_solid(x, y):
      continue
    m.paint(SPRITES[f'flowers{rng.randrange(6)}'][0], x * T, y * T)


def place(m, sid, tx, ty, block=None, dx=0, dy=0, z=None):
  """Place a sprite centred on tile column tx with its bottom at the bottom of row ty."""
  img = SPRITES[sid][0]
  x = tx * T + T // 2 - img.width // 2 + dx
  y = (ty + 1) * T - img.height + dy
  m.ent(sid, x, y, z)
  if block:
    m.block(*block)
  return x, y


# --- The town ---------------------------------------------------------------------------------

TOWN_W, TOWN_H = 64, 71
# The football ground south of the Möbius garden: the playing field's top-left tile and size in tiles.
PITCH_X, PITCH_Y, PITCH_W, PITCH_H = 21, 54, 22, 12
TH_X, TH_ROW = 11, 12  # Town Hall left tile and its front (bottom) row

HOUSES = [
  # id, sprite, tile x, tile y (top-left of the 5x5 window), sign sprite, name
  ('chess', 'house_slate', 6, 14, 'sign_chess', 'Chess Club'),
  ('den', 'house_red', 53, 14, 'sign_games', 'Game Den'),
  ('cinema', 'house_plum', 6, 27, 'sign_film', 'Cinema'),
  ('cafe', 'house_green', 53, 27, 'sign_coffee', 'Café'),
]

INTERIOR_SIZE = {'chess': (16, 11), 'den': (16, 11), 'cinema': (18, 12), 'cafe': (16, 11), 'hall': (30, 18)}


def interior_entry(mid):
  """Spawn tile just inside an interior's front door (door tiles are cx-1 and cx)."""
  w, h = INTERIOR_SIZE[mid]
  return (w // 2, h - 2)


def tree_at(m, rng, tx, ty, sid=None):
  sid = sid or rng.choice(['tree0', 'tree1', 'tree2', 'tree3', 'tree4', 'tree5', 'pine0', 'pine1', 'pine2'])
  place(m, sid, tx, ty, block=(tx, ty, 1, 1), dx=rng.randint(-3, 3), dy=rng.randint(-2, 2))


def build_town(offs):
  rng = noise_rng(7)
  m = Map('town', 'Mobius Town', TOWN_W, TOWN_H, True, 'grass')
  m.add_room('town', 'Mobius Town', 'outdoor', [(0, 0, TOWN_W, TOWN_H)])
  paint_grass(m, rng)

  # Paths: plaza, streets, the Town Hall stairs, the walk to the Möbius garden.
  plaza = rect_cells(22, 15, 20, 19)
  streets = (rect_cells(4, 19, 18, 2) | rect_cells(42, 19, 18, 2) | rect_cells(4, 32, 18, 2)
             | rect_cells(42, 32, 18, 2) | rect_cells(31, 34, 2, 4))
  pave(m, streets - plaza, 'street')
  pave(m, plaza, 'plaza')
  cob = P.plaza_cobbles(20 * T - 2, 19 * T - 3)
  m.paint(cob, 22 * T + 1, 15 * T + 2)
  fountain_c = (32 * T, 24 * T + 8)
  ring = P.mosaic_ring(4 * T + 4, 7)
  m.paint(ring, fountain_c[0] - ring.width // 2, fountain_c[1] - ring.height // 2)
  # Grand stairs up to the Town Hall gate.
  m.paint(P.grand_stairs(10, 2), 27 * T, 13 * T)
  # The Möbius garden: a round stone court south of the plaza.
  garden_c = (32, 42.5)
  court = disc_cells(garden_c[0], garden_c[1], 4.6)
  pave(m, rect_cells(31, 37, 2, 2), 'street')
  m.paint(P.round_court(int(4.6 * T), seed=29), 32 * T - int(4.6 * T) - 2, int(garden_c[1] * T) - int(4.6 * T) - 2)
  garden_ring = P.mosaic_ring(4 * T + 6, 5, (120, 200, 210, 255), (86, 150, 170, 255))
  m.paint(garden_ring, 32 * T - garden_ring.width // 2, int(garden_c[1] * T) - garden_ring.height // 2)

  # Pond in the south-east park.
  pond(m, 45, 39, 8, 5, rng)

  # Forest border, including the woods beside and behind the Town Hall.
  for x in range(0, TOWN_W, 2):
    for y in (0, 2):
      tree_at(m, rng, min(TOWN_W - 1, x + (y // 2) % 2), y)
    for y in (TOWN_H - 3, TOWN_H - 1):
      tree_at(m, rng, min(TOWN_W - 1, x + (y % 2)), y)
  for y in range(1, TOWN_H - 1, 2):
    for x in (0, 2):
      tree_at(m, rng, x + (y // 2) % 2, y)
    for x in (TOWN_W - 3, TOWN_W - 1):
      tree_at(m, rng, x - (y // 2) % 2, y)
  for y in range(4, 13, 2):
    for x in (4, 6, 8):
      tree_at(m, rng, x + (y // 2) % 2, y)
    for x in (54, 56, 58):
      tree_at(m, rng, x - (y // 2) % 2, y)
  m.block(0, 0, TOWN_W, 2)
  m.block(0, TOWN_H - 2, TOWN_W, 2)
  m.block(0, 0, 3, TOWN_H)
  m.block(TOWN_W - 3, 0, 3, TOWN_H)

  # The Town Hall.
  th = SPRITES['townhall'][0]
  th_bottom = (TH_ROW + 1) * T
  m.ent('townhall', TH_X * T, th_bottom - th.height, th_bottom - 4)
  m.block(TH_X, 3, TH_TILES_W, TH_ROW - 2)
  m.door(31, TH_ROW, 'hall', *interior_entry('hall'), 'up')
  m.door(32, TH_ROW, 'hall', *interior_entry('hall'), 'up')
  m.labels.append({'x': 32 * T, 'y': 3 * T + 4, 'text': 'Town Hall'})
  for tx in (26, 37):
    place(m, 'torch', tx, 13, block=(tx, 13, 1, 1))
    m.objects.append({'id': f'torch-{tx}', 'kind': 'fire', 'px': tx * T + 8, 'py': 14 * T - 25, 'z': 14 * T + 1,
                      'small': True, 'map': 'town', 'x': tx, 'y': 13})
  for tx in (24, 39):
    place(m, 'flag', tx, 13, block=(tx, 13, 1, 1), dx=4)

  # Houses with signs.
  for hid, sid, hx, hy, sign, name in HOUSES:
    hox, hoy = offs['house']
    m.ent(sid, hx * T + hox, hy * T + hoy)
    m.block(hx, hy, 5, 5)
    dx, dy = hx + 2, hy + 4
    m.door(dx, dy, hid, *interior_entry(hid), 'up')
    sx = hx + 5 if hx < 32 else hx - 2
    simg = SPRITES[sign][0]
    m.ent(sign, sx * T + (2 * T - simg.width) // 2, (hy + 5) * T - simg.height)
    m.block(sx, hy + 4, 2, 1)
    m.objects.append({'id': f'sign-{hid}', 'kind': 'sign', 'text': name, 'use': [[sx, hy + 5], [sx + 1, hy + 5]]})
    m.labels.append({'x': (hx * T + 40), 'y': hy * T - 4, 'text': name})

  # Plaza: fountain, benches, lamps, market, notice board.
  f = SPRITES['fountain'][0]
  m.ent('fountain', fountain_c[0] - f.width // 2, fountain_c[1] - f.height // 2)
  m.block(30, 23, 4, 3)
  m.objects.append({'id': 'fountain', 'kind': 'fountain', 'use': [[31, 26], [32, 26], [29, 24], [34, 24], [31, 22], [32, 22]],
                    'focus': [fountain_c[0], fountain_c[1] - 6]})
  for (bx, by) in ((25, 20), (25, 28), (36, 28)):
    img = SPRITES['bench'][0]
    m.ent('bench', bx * T + (3 * T - img.width) // 2, (by + 1) * T - img.height + 2, by * T)
    for i in range(3):
      m.seat(bx + i, by, 'down')
  for (lx, ly) in ((23, 16), (40, 16), (23, 30), (40, 30), (14, 18), (18, 18), (45, 18), (49, 18),
                   (14, 34), (18, 34), (45, 34), (49, 34)):
    place(m, 'lamp', lx, ly, block=(lx, ly, 1, 1))
    m.objects.append({'id': f'lamp-{lx}-{ly}', 'kind': 'lamp', 'x': lx, 'y': ly})
  sox, soy = offs['stall']
  m.ent('stall', 35 * T + sox, 15 * T + soy)
  m.block(35, 17, 5, 4)
  place(m, 'produce0', 34, 20, block=(34, 20, 1, 1))
  place(m, 'crates', 24, 17, block=(24, 17, 2, 1))
  nb = SPRITES['notice']
  place(m, 'notice', 28, 16, block=(27, 16, 2, 1), dx=-8)
  m.objects.append({'id': 'notice', 'kind': 'notice', 'use': [[27, 17], [28, 17]]})

  # West garden between the Chess Club and the Cinema.
  for (tx, ty, sid) in ((13, 22, 'tree1'), (19, 22, 'tree_autumn'), (14, 26, 'tree4'), (19, 27, 'tree2')):
    tree_at(m, rng, tx, ty, sid)
  img = SPRITES['bench_low'][0]
  m.ent('bench_low', 15 * T + (3 * T - img.width) // 2, 25 * T - img.height + 2, 24 * T)
  for i in range(3):
    m.seat(15 + i, 24, 'down')
  for (x, y) in ((5, 22), (7, 23), (9, 22), (6, 25)):
    m.ent('bush', x * T, y * T)
    m.block(x, y)

  # East park: the Founder statue among trees.
  place(m, 'statue', 47, 24, block=(47, 23, 2, 2), dx=8)
  m.objects.append({'id': 'statue', 'kind': 'statue', 'use': [[47, 25], [48, 25], [46, 24], [49, 24]],
                    'focus': [48 * T, 22 * T]})
  for (tx, ty, sid) in ((44, 22, 'tree0'), (51, 23, 'tree3'), (44, 27, 'tree5'), (51, 27, 'tree1')):
    tree_at(m, rng, tx, ty, sid)

  # The Möbius garden monument.
  ped = SPRITES['mobius_pedestal'][0]
  ped_x, ped_y = 32 * T - ped.width // 2, int(garden_c[1] * T) - ped.height // 2 + 6
  m.ent('mobius_pedestal', ped_x, ped_y, ped_y + ped.height - 6)
  m.block(30, 42, 4, 2)
  m.objects.append({
    'id': 'mobius', 'kind': 'mobius', 'cx': 32 * T, 'cy': ped_y - 30, 'size': 96, 'z': ped_y + ped.height - 5,
    'use': [[30, 45], [31, 45], [32, 45], [33, 45], [29, 43], [34, 43]], 'focus': [32 * T, ped_y - 30],
  })
  m.labels.append({'x': 32 * T, 'y': 47 * T + 4, 'text': 'Möbius Garden'})

  # The football ground: a mown pitch with goals, floodlights, benches and a path from the garden.
  pave(m, rect_cells(31, 48, 2, 5), 'street')
  pitch_img = P.football_pitch(PITCH_W * T, PITCH_H * T, T)
  m.paint(pitch_img, (PITCH_X - 1) * T, (PITCH_Y - 1) * T)
  mouth_top = PITCH_Y + (PITCH_H * T // 2 - 28) // T
  mouth_bottom = PITCH_Y + (PITCH_H * T // 2 + 28 - 1) // T
  for gx in (PITCH_X - 1, PITCH_X + PITCH_W):
    m.block(gx, mouth_top, 1, mouth_bottom - mouth_top + 1)
  for (fx, fy) in ((PITCH_X - 2, PITCH_Y - 2), (PITCH_X + PITCH_W + 1, PITCH_Y - 2),
                   (PITCH_X - 2, PITCH_Y + PITCH_H + 1), (PITCH_X + PITCH_W + 1, PITCH_Y + PITCH_H + 1)):
    place(m, 'floodlight', fx, fy, block=(fx, fy, 1, 1))
  for bx in (24, 36):
    img = SPRITES['bench'][0]
    m.ent('bench', bx * T + (3 * T - img.width) // 2, (PITCH_Y - 1) * T - img.height + 2, (PITCH_Y - 2) * T)
    for i in range(3):
      m.seat(bx + i, PITCH_Y - 2, 'down')
  place(m, 'signpost', 34, 50, block=(34, 50, 1, 1))
  m.objects.append({'id': 'pitch-sign', 'kind': 'sign',
                    'text': 'Football Ground: walk onto the pitch to play 2 v 2. Bots fill empty places.',
                    'use': [[33, 50], [33, 51]]})
  pitch_tiles = rect_cells(PITCH_X - 1, PITCH_Y - 1, PITCH_W + 2, PITCH_H + 2)
  m.objects.append({
    'id': 'pitch', 'kind': 'pitch',
    # The playing field in world pixels; the football engine's field origin is its top-left corner.
    'field': [PITCH_X * T, PITCH_Y * T, PITCH_W * T, PITCH_H * T],
    'use': sorted([x, y] for (x, y) in pitch_tiles if not m.is_solid(x, y)),
  })
  # Beside the path rather than on it, so the name never sits over people walking in.
  m.labels.append({'x': 27 * T + 8, 'y': 50 * T, 'text': 'Football Ground'})
  for (tx, ty, sid) in ((8, 52, 'tree3'), (12, 56, 'pine2'), (6, 60, 'tree1'), (14, 63, 'tree0'),
                        (9, 66, 'pine0'), (17, 51, 'tree5'), (48, 51, 'tree2'), (52, 56, 'tree4'),
                        (57, 60, 'pine1'), (50, 64, 'tree0'), (55, 52, 'tree_autumn'), (47, 61, 'tree3')):
    tree_at(m, rng, tx, ty, sid)

  # South meadow: trees, log, stump, rocks, welcome sign, hedges.
  for (tx, ty, sid) in ((8, 37, 'tree2'), (13, 40, 'tree0'), (19, 37, 'tree4'), (6, 44, 'pine1'),
                        (16, 45, 'tree3'), (23, 47, 'tree5'), (41, 46, 'tree1'), (55, 46, 'tree_autumn'),
                        (57, 37, 'pine0'), (40, 36, 'tree3'), (24, 39, 'tree1'), (40, 41, 'tree4')):
    tree_at(m, rng, tx, ty, sid)
  place(m, 'log', 11, 42, block=(10, 42, 3, 1))
  place(m, 'stump', 26, 47, block=(26, 47, 2, 1))
  place(m, 'rocks', 54, 45, block=(54, 45, 2, 1))
  place(m, 'signpost', 34, 36, block=(34, 36, 1, 1))
  m.objects.append({'id': 'welcome', 'kind': 'sign', 'text': 'Welcome to Mobius Town', 'use': [[33, 36], [34, 37]]})
  for (x, y) in ((27, 35), (35, 35)):
    m.ent('hedge', x * T, y * T)
    m.block(x, y, 2, 1)

  # Admire the strip from anywhere close to it, not just a few marked tiles.
  near_strip = disc_cells(garden_c[0], garden_c[1], 5.6)
  mobius = next(o for o in m.objects if o['id'] == 'mobius')
  mobius['use'] = sorted([x, y] for (x, y) in near_strip if not m.is_solid(x, y))

  paved = plaza | streets | court
  avoid = paved | {(x, y) for y in range(m.h) for x in range(m.w) if m.is_solid(x, y)}
  avoid |= {(o['x'], o['y']) for o in m.objects if o['kind'] == 'seat'}
  scatter_flowers(m, rng, (4, 21, 20, 30), 18, avoid)
  scatter_flowers(m, rng, (43, 21, 59, 30), 16, avoid)
  scatter_flowers(m, rng, (4, 35, 59, 47), 50, avoid)
  avoid |= pitch_tiles | rect_cells(31, 48, 2, 5)
  scatter_flowers(m, rng, (4, 49, 59, TOWN_H - 4), 40, avoid)

  m.spawn = (31, 30, 'up')
  return m


# --- Interiors ----------------------------------------------------------------------------------

def interior(mid, name, floor_img, plaster, wainscot):
  w, h = INTERIOR_SIZE[mid]
  m = Map(mid, name, w, h, False, mid)
  m.paint(floor_img(w * T, h * T), 0, 0)
  cap = P.wall_cap(w * T, T)
  m.paint(cap, 0, 0)
  m.paint(P.wall_face(w * T, plaster, wainscot), 0, T)
  side = P.wall_cap(T // 2, h * T)
  m.paint(side, 0, 0)
  m.paint(side, w * T - T // 2, 0)
  m.paint(P.wall_cap(w * T, T // 2), 0, h * T - T // 2)
  m.block(0, 0, w, 3)
  m.block(0, 0, 1, h)
  m.block(w - 1, 0, 1, h)
  m.block(0, h - 1, w, 1)
  cx = w // 2
  for x in (cx - 1, cx):
    m.paint(P.door_mat(), x * T, (h - 2) * T)
    m.paint(P.exit_arrow(), x * T, (h - 1) * T - 8)
  m.spawn = (cx, h - 2, 'up')
  return m


def add_exit(m, town_door):
  w, h = m.w, m.h
  tx, ty = town_door
  for x in (w // 2 - 1, w // 2):
    m.door(x, h - 1, 'town', tx, ty + 1, 'down')
  rect(m.ground, (w // 2 - 1) * T, h * T - T // 2, 2 * T, T // 2, (40, 30, 46, 255))


def furniture(m, sid, tx, ty, solid=None, dy=0, dx=0, z=None):
  """Place a furniture sprite so its bottom edge sits at the bottom of tile row ty."""
  img = SPRITES[sid][0]
  x = tx * T + dx
  y = (ty + 1) * T - img.height + dy
  m.ent(sid, x, y, z)
  if solid:
    m.block(*solid)


def wall_deco(m, sid, px, py):
  m.paint(SPRITES[sid][0], px, py)


def game_table(m, sid, tid, kind, x0, row, sides):
  """A 3-wide table at columns x0..x0+2 (rows row..row+1) with a seat centred above and below."""
  furniture(m, sid, x0, row + 1, (x0, row, 3, 2))
  north = m.seat(x0 + 1, row - 1, 'down', 'wood', table=tid, side=sides[1])
  south = m.seat(x0 + 1, row + 2, 'up', 'wood', table=tid, side=sides[0])
  m.objects.append({'id': tid, 'kind': kind, 'rect': [x0, row, 3, 2],
                    'seats': [{'x': x0 + 1, 'y': row + 2, 'side': sides[0], 'face': 'up', 'seat': south},
                              {'x': x0 + 1, 'y': row - 1, 'side': sides[1], 'face': 'down', 'seat': north}]})


def build_chess():
  m = interior('chess', 'Chess Club', lambda w, h: P.floor_wood(w, h, 3, 1.0), (226, 214, 190, 255),
               (98, 70, 66, 255))
  m.add_room('chess', 'Chess Club', 'house', [(0, 0, m.w, m.h)])
  m.paint(P.rug(5, 6, (60, 84, 70, 255), (196, 170, 96, 255)), int(1.5 * T), 4 * T)
  m.paint(P.rug(5, 6, (90, 56, 70, 255), (196, 170, 96, 255)), int(10.5 * T), 4 * T)
  furniture(m, 'bookshelf', 1, 3, (1, 3, 3, 1), dy=-2)
  furniture(m, 'bookshelf', 12, 3, (12, 3, 3, 1), dy=-2)
  furniture(m, 'fireplace', 7, 3, (7, 3, 2, 1), dx=1)
  m.objects.append({'id': 'fire-chess', 'kind': 'fire', 'px': 7 * T + 17, 'py': 4 * T - 4, 'z': 4 * T + 1,
                    'map': 'chess', 'x': 7, 'y': 3})
  # Two armchairs facing the fire.
  m.seat(6, 5, 'up', 'green')
  m.seat(9, 5, 'up', 'green')
  wall_deco(m, 'window', 4 * T + 8, 1 * T + 2)
  wall_deco(m, 'window', 10 * T - 2, 1 * T + 2)
  wall_deco(m, 'paint_night', 5 * T + 2, 6)
  furniture(m, 'plant_tall', 14, 9, (14, 9, 1, 1))
  furniture(m, 'plant_tall', 1, 9, (1, 9, 1, 1))
  game_table(m, 'chess_table', 'chess-1', 'chess', 2, 6, ('w', 'b'))
  game_table(m, 'chess_table', 'chess-2', 'chess', 11, 6, ('w', 'b'))
  return m


def build_den():
  m = interior('den', 'Game Den', lambda w, h: P.floor_check(w, h, (64, 52, 92, 255), (82, 68, 116, 255), 8),
               (200, 214, 236, 255), (60, 70, 110, 255))
  m.add_room('den', 'Game Den', 'house', [(0, 0, m.w, m.h)])
  for i, x in enumerate((1, 2, 3, 12, 13, 14)):
    furniture(m, ('arcade_a', 'arcade_b', 'arcade_c')[i % 3], x, 3, (x, 3, 1, 1), dy=-2)
  wall_deco(m, 'paint_green', 7 * T, 8)
  m.paint(P.rug(4, 3, (40, 36, 64, 255), (230, 200, 90, 255)), 6 * T, 4 * T)
  game_table(m, 'c4_table', 'c4-1', 'connect4', 2, 6, ('r', 'y'))
  game_table(m, 'c4_table', 'c4-2', 'connect4', 11, 6, ('r', 'y'))
  furniture(m, 'plant_big', 1, 9, (1, 9, 1, 1))
  furniture(m, 'plant_big', 14, 9, (14, 9, 1, 1))
  return m


def build_cinema():
  m = interior('cinema', 'Cinema', lambda w, h: P.floor_carpet(w, h, (92, 30, 44, 255), (150, 110, 60, 255)),
               (60, 40, 60, 255), (40, 26, 40, 255))
  m.add_room('cinema', 'Cinema', 'house', [(0, 0, m.w, m.h)])
  curtain = P.curtain(3)
  m.paint(curtain, 1 * T, T - 6)
  m.paint(curtain, 14 * T - 8, T - 6)
  tvimg = SPRITES['tv'][0]
  tv_x, tv_y = 7 * T, T - 4
  m.paint(tvimg, tv_x, tv_y)
  m.objects.append({'id': 'tv', 'kind': 'tv', 'screen': [tv_x + 5, tv_y + 4, 54, 22],
                    'use': [[x, 3] for x in range(7, 11)] + [[x, 4] for x in range(7, 11)]})
  # Two rows of sofas facing the screen. The middle stays open: it is the walk from the door to the screen.
  rows = ((6, ((2, 4), (12, 4))), (9, ((2, 4), (12, 4))))
  for row_y, blocks in rows:
    for (x0, n) in blocks:
      m.paint(SPRITES[f'sofa{n}_seat'][0], x0 * T, row_y * T)
      m.ent(f'sofa{n}_back', x0 * T - 2, row_y * T + 9, row_y * T + 16)
      for i in range(n):
        m.seat(x0 + i, row_y, 'up')
  furniture(m, 'popcorn', 16, 4, (16, 4, 1, 1))
  furniture(m, 'plant_big', 1, 4, (1, 4, 1, 1))
  return m


def build_cafe():
  m = interior('cafe', 'Café', lambda w, h: P.floor_wood(w, h, 9, 1.12), (244, 230, 206, 255),
               (120, 150, 110, 255))
  m.add_room('cafe', 'Café', 'house', [(0, 0, m.w, m.h)])
  furniture(m, 'counter', 1, 3, (1, 3, 5, 1), dy=-2)
  wall_deco(m, 'menu', 2 * T, 2)
  wall_deco(m, 'window', 8 * T, T + 2)
  wall_deco(m, 'window', 11 * T + 4, T + 2)
  wall_deco(m, 'paint_land', 13 * T + 8, 8)
  for (x, y) in ((9, 5), (13, 5), (4, 8), (9, 8), (13, 8)):
    furniture(m, 'cafe_table', x, y, (x, y, 1, 1), dx=-3)
    m.seat(x - 1, y, 'right', 'wood')
    m.seat(x + 1, y, 'left', 'wood')
  furniture(m, 'plant_big', 14, 3, (14, 3, 1, 1))
  furniture(m, 'plant_tall', 1, 9, (1, 9, 1, 1))
  return m


def inner_wall_h(m, x, y, w, door=None):
  """Horizontal interior wall: cap row plus a face row below it."""
  for xx in range(x, x + w):
    if door and xx in door:
      continue
    m.paint(P.wall_cap(T, T // 2 + 2), xx * T, y * T)
    face = P.wall_face(T, (214, 210, 204, 255), (110, 104, 120, 255)).crop((0, 16, T, 32))
    m.paint(face, xx * T, y * T + T // 2 + 2)
    m.block(xx, y)


def inner_wall_v(m, x, y, h, door=None):
  for yy in range(y, y + h):
    if door and yy in door:
      continue
    m.paint(P.wall_cap(T // 2, T), x * T + T // 4, yy * T)
    m.block(x, yy)


def build_hall():
  m = interior('hall', 'Town Hall', lambda w, h: P.floor_stone(w, h), (222, 216, 206, 255), (110, 104, 120, 255))
  W, H = m.w, m.h
  m.add_room('lobby', 'Town Hall lobby', 'house', [(0, 0, W, H)])
  m.add_room('meet-a', 'Meeting Room A', 'meeting', [(1, 3, 8, 5)], lockable=True, door=[9, 5])
  m.add_room('meet-b', 'Meeting Room B', 'meeting', [(1, 10, 8, 6)], lockable=True, door=[9, 13])
  m.add_room('auditorium', 'Auditorium', 'hall', [(20, 3, 9, 14)])
  m.paint(P.floor_carpet(8 * T, 5 * T, (52, 82, 120, 255), (90, 130, 170, 255)), 1 * T, 3 * T)
  m.paint(P.floor_carpet(8 * T, 6 * T, (60, 104, 80, 255), (100, 150, 110, 255)), 1 * T, 10 * T)
  m.paint(P.floor_wood(9 * T, 14 * T, 21, 0.95), 20 * T, 3 * T)
  # Red carpet runner from the entrance to the reception desk.
  runner = new(2 * T, 11 * T)
  rect(runner, 0, 0, 2 * T, 11 * T, (150, 30, 46, 255))
  rect(runner, 2, 0, 2 * T - 4, 11 * T, (172, 40, 58, 255))
  vline(runner, 2, 0, 11 * T, (224, 180, 70, 255))
  vline(runner, 2 * T - 3, 0, 11 * T, (224, 180, 70, 255))
  m.paint(runner, 14 * T, 6 * T)
  # Walls: meeting rooms closed on every side except their single door.
  inner_wall_v(m, 9, 3, 14, door={5, 13})
  inner_wall_h(m, 1, 8, 8)
  m.paint(P.wall_face(8 * T, (222, 216, 206, 255), (110, 104, 120, 255)).crop((0, 0, 8 * T, T)), 1 * T, 9 * T)
  m.block(1, 9, 8, 1)
  inner_wall_h(m, 1, 16, 8)
  inner_wall_v(m, 19, 3, 14, door={13, 14})
  m.objects.append({'id': 'door-meet-a', 'kind': 'door', 'room': 'meet-a', 'x': 9, 'y': 5, 'orient': 'v'})
  m.objects.append({'id': 'door-meet-b', 'kind': 'door', 'room': 'meet-b', 'x': 9, 'y': 13, 'orient': 'v'})
  # Meeting room tables and chairs.
  for (top, colour) in ((5, 'blue'), (12, 'blue')):
    furniture(m, 'conf_table', 3, top + 1, (3, top, 4, 2), dy=3)
    for x in range(3, 7):
      m.seat(x, top - 1, 'down', colour)
      m.seat(x, top + 2, 'up', colour)
  wall_deco(m, 'whiteboard', 3 * T, T + 4)
  furniture(m, 'plant_tall', 1, 15, (1, 15, 1, 1))
  furniture(m, 'plant_tall', 8, 7, (8, 7, 1, 1))
  # Lobby.
  furniture(m, 'reception', 12, 5, (12, 5, 4, 1))
  furniture(m, 'cooler', 17, 4, (17, 4, 1, 1), dx=2)
  furniture(m, 'plant_big', 10, 3, (10, 3, 1, 1))
  furniture(m, 'plant_big', 18, 3, (18, 3, 1, 1))
  wall_deco(m, 'paint_land', 13 * T, 8)
  for (x0, y) in ((10, 10), (16, 10)):
    m.paint(SPRITES['bench3_seat'][0], x0 * T, y * T)
    m.ent('bench3_back', x0 * T - 1, y * T + 10, y * T + 17)
    for i in range(3):
      m.seat(x0 + i, y, 'up')
  m.objects.append({'id': 'lobby-desk', 'kind': 'sign', 'text': 'Meeting rooms on the left, auditorium on the right',
                    'use': [[13, 6], [14, 6]]})
  # Auditorium: stage with spotlight, curtains, podium, benches, event board.
  m.paint(P.curtain(9), 20 * T, T - 6)
  m.paint(P.stage(9, 3), 20 * T, 3 * T)
  spot_tiles = [[23, 4], [24, 4], [25, 4], [23, 5], [24, 5], [25, 5]]
  m.paint(SPRITES['spot'][0], 24 * T + 8 - 20, 4 * T + 16 - 13)
  furniture(m, 'podium', 24, 3, (24, 3, 1, 1), dx=-1, dy=2)
  m.objects.append({'id': 'stage', 'kind': 'spotlight', 'room': 'auditorium', 'tiles': spot_tiles})
  m.objects.append({'id': 'stage-board', 'kind': 'board', 'px': 24 * T + 8, 'py': T + 4})
  for y in (8, 10, 12, 14):
    for x0 in (21, 25):
      m.paint(SPRITES['bench3_seat'][0], x0 * T, y * T)
      m.ent('bench3_back', x0 * T - 1, y * T + 10, y * T + 17)
      for i in range(3):
        m.seat(x0 + i, y, 'up')
  m.labels += [
    {'x': 5 * T, 'y': 3 * T + 6, 'text': 'Meeting Room A'},
    {'x': 5 * T, 'y': 10 * T + 6, 'text': 'Meeting Room B'},
    {'x': 24 * T + 8, 'y': 7 * T, 'text': 'Auditorium'},
  ]
  return m


# --- Output ----------------------------------------------------------------------------------------

def pack_atlas():
  items = []
  for sid, frames in SPRITES.items():
    for i, img in enumerate(frames):
      items.append((sid, i, img))
  items.sort(key=lambda it: (-it[2].height, -it[2].width))
  width = 1024
  x = y = 0
  row_h = 0
  places = {}
  for sid, i, img in items:
    if x + img.width + 1 > width:
      x = 0
      y += row_h + 1
      row_h = 0
    places[(sid, i)] = (x, y, img.width, img.height)
    x += img.width + 1
    row_h = max(row_h, img.height)
  atlas = new(width, y + row_h + 1)
  for (sid, i), (px, py, w, h) in places.items():
    atlas.alpha_composite(SPRITES[sid][i], (px, py))
  index = {}
  for sid, frames in SPRITES.items():
    entry = {'f': [list(places[(sid, i)]) for i in range(len(frames))]}
    if sid in SPRITE_FPS:
      entry['fps'] = SPRITE_FPS[sid]
    index[sid] = entry
  return atlas, index


def write_meta(maps):
  """world_meta.py: the facts the hub service needs, generated so they never drift."""
  meta = {
    'maps': {m.id: {'w': m.w, 'h': m.h, 'name': m.name} for m in maps},
    'rooms': {m.id: [r['id'] for r in m.rooms] for m in maps},
    'lockable': sorted(f"{m.id}:{r['id']}" for m in maps for r in m.rooms if r.get('lockable')),
    'tables': {o['id']: {'map': m.id, 'kind': o['kind'], 'seats': [s['side'] for s in o['seats']]}
               for m in maps for o in m.objects if o['kind'] in ('chess', 'connect4')},
    'screens': sorted(o['id'] for m in maps for o in m.objects if o['kind'] == 'tv'),
    'stages': {f"{m.id}:{o['room']}": o['tiles'] for m in maps for o in m.objects if o['kind'] == 'spotlight'},
    # The football ground: where players may join a match (field plus its one-tile margin, in tiles).
    'pitch': {'map': 'town', 'rect': [PITCH_X - 1, PITCH_Y - 1, PITCH_W + 2, PITCH_H + 2]},
  }
  text = ('"""Generated by tools/build_world.py: shared world facts for the hub. Do not edit."""\n'
          + 'META = ' + json.dumps(meta, indent=1, sort_keys=True) + '\n')
  (ROOT / 'world_meta.py').write_text(text)


def main():
  ap = argparse.ArgumentParser()
  ap.add_argument('--preview', help='directory for full-map preview PNGs')
  ap.add_argument('--debug', action='store_true', help='also write previews tinting walls red and seats green')
  args = ap.parse_args()
  offs = build_sprites()
  maps = [build_town(offs), build_chess(), build_den(), build_cinema(), build_cafe(), build_hall()]
  town_doors = {d['to']: (d['x'], d['y']) for d in maps[0].doors}
  for m in maps[1:]:
    add_exit(m, town_doors[m.id])
  atlas, index = pack_atlas()
  character = Image.open(ART / 'character.png').convert('RGBA')
  # The two town characters: the source hero, and the female version drawn from it.
  character_f = female_sheet(character)
  if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    atlas.save(Path(args.preview) / 'atlas.png')
    character_f.save(Path(args.preview) / 'character-female.png')
  out = {
    'tile': T,
    'atlas': data_url(atlas),
    'sprites': index,
    'character': data_url(character),
    'characterFemale': data_url(character_f),
    'maps': {m.id: m.export(args.preview) for m in maps},
  }
  if args.preview and args.debug:
    for m in maps:
      m.preview(args.preview, debug=True)
  js = ['// Generated by tools/build_world.py from art/ — do not edit by hand.',
        '// Art: "Zelda-like tilesets and sprites" by ArMM1998 (CC0) plus procedural props.']
  js.append('export const WORLD = ' + json.dumps(out, separators=(',', ':')) + '\n')
  target = ROOT / 'engine' / 'world.gen.js'
  target.write_text('\n'.join(js))
  write_meta(maps)
  fonts_dir = ROOT / 'art' / 'kenney-fonts' / 'Fonts'
  fonts = {name: base64.b64encode((fonts_dir / f'{file}.ttf').read_bytes()).decode()
           for name, file in (('mini', 'Kenney Mini'), ('blocks', 'Kenney Blocks'))}
  (ROOT / 'engine' / 'fonts.gen.js').write_text(
    '// Generated by tools/build_world.py: Kenney Fonts (CC0), base64 TTF loaded via FontFace.\n'
    + 'export const FONTS = ' + json.dumps(fonts) + '\n')
  print(f'wrote {target} ({target.stat().st_size // 1024} KiB), {len(SPRITES)} sprites, '
        f'atlas {atlas.size[0]}x{atlas.size[1]}')


if __name__ == '__main__':
  main()
