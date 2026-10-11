#!/usr/bin/env python3
"""Contact sheets for the builder's kit: every item, material, edge and line set at a glance.

    python3 forge/kit_preview.py OUT.png                      # everything
    python3 forge/kit_preview.py OUT.png --family party       # one category (or: items, materials, lines)
    python3 forge/kit_preview.py OUT.png --items net,hoop     # just these items (default + variants)
    python3 forge/kit_preview.py OUT.png --family sport --scale 3 --frames --debug

Each item stands on a grass or wood-floor tile grid with its footprint outlined faintly and its name
below (defaults first, then the variants its @item declares). --frames adds every animation frame;
--debug tints solid tiles red, marks seats green (feet point), `use` tiles blue and glows yellow.
Materials show each edge kind over grass (wall materials also as an interior wall band); lines are
drawn over a suitable surface.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
  sys.path.insert(0, str(HERE))

_ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
_ap.add_argument('out')
_ap.add_argument('--family', default='all',
                 help='all | items | materials | lines | edges | a category (nature, furniture, party, ...)')
_ap.add_argument('--items', default='', help='comma-separated item names')
_ap.add_argument('--materials', default='', help='comma-separated material names')
_ap.add_argument('--scale', type=int, default=2)
_ap.add_argument('--width', type=int, default=640, help='sheet width in unscaled pixels')
_ap.add_argument('--frames', action='store_true', help='show every animation frame')
_ap.add_argument('--debug', action='store_true', help='show solids, seats, use tiles and glows')
_ap.add_argument('--no-variants', action='store_true')
_ap.add_argument('--spec', default='', help='render a spec JSON (area, paint, kit items) on grass or a floor')
_ap.add_argument('--floor', default='', help="with --spec: a material under everything, or 'room' (interior)")

if __name__ == '__main__':
  _args = _ap.parse_args()
  # Loading only the family under review keeps a half-finished sibling module from blocking it.
  if _args.family not in ('all', 'items', 'materials', 'lines', 'edges') and not _args.items:
    os.environ.setdefault('KIT_ONLY', _args.family)

import kit  # noqa: E402
import kit_ground  # noqa: E402
from kit import (  # noqa: E402
  ITEMS, LINES, MATERIAL_DEFS, OUT, T, Image, make, new, pack_tile, paint_area, paint_lines, pixel_text, props,
  solid_tiles,
)

BG = (30, 26, 40, 255)
LABEL = (236, 232, 244, 255)
DIM = (150, 140, 170, 255)


def ground(scene, wt, ht, seed=3):
  if scene in ('floor', 'wall'):
    return kit_ground._floor_wood(wt * T, ht * T, seed, 1.05)
  return kit.material_texture('grass', wt * T, ht * T, seed)


def _bounds(made):
  fw, fh = made.foot
  x0, y0, x1, y1 = 0, 0, fw * T, fh * T
  for p in made.pieces:
    w, h = p.frames[0].size
    x0, y0 = min(x0, p.dx), min(y0, p.dy)
    x1, y1 = max(x1, p.dx + w), max(y1, p.dy + h)
  return x0, y0, x1, y1


def render_item(made, scene='grass', frame_i=0, debug=False):
  """Draw a Made on a tile grid; returns (image, origin_x, origin_y) of the footprint's top-left."""
  bx0, by0, bx1, by1 = _bounds(made)
  left = -(-max(0, -bx0) // T) + 1
  top = -(-max(0, -by0) // T) + 1
  right = -(-max(0, bx1 - made.foot[0] * T) // T) + 1
  bottom = -(-max(0, by1 - made.foot[1] * T) // T) + 1
  if scene == 'wall':
    top = max(top, 2)
    bottom = max(bottom, 2)
  wt, ht = left + made.foot[0] + right, top + made.foot[1] + bottom
  img = ground(scene, wt, ht)
  ox, oy = left * T, top * T
  if scene == 'wall':
    # An interior: the footprint's top row is the top of the two-tile wall face, the cap above it.
    img.alpha_composite(props.wall_cap(wt * T, T), (0, oy - T))
    img.alpha_composite(props.wall_face(wt * T), (0, oy))
    img.alpha_composite(props.wall_cap(wt * T, oy - T), (0, 0))
  fw, fh = made.foot
  # Faint footprint outline.
  fp = new(fw * T, fh * T)
  edge = (255, 255, 255, 70)
  for x in range(fw * T):
    fp.putpixel((x, 0), edge)
    fp.putpixel((x, fh * T - 1), edge)
  for y in range(fh * T):
    fp.putpixel((0, y), edge)
    fp.putpixel((fw * T - 1, y), edge)
  if debug:
    for (sx, sy) in solid_tiles(made):
      img.alpha_composite(new(T, T, (255, 40, 40, 60)), (ox + sx * T, oy + sy * T))
    for (ux, uy) in made.use:
      img.alpha_composite(new(T, T, (60, 120, 255, 70)), (ox + ux * T, oy + uy * T))
  order = {'ground': 0, 'normal': 1, 'over': 2}
  pieces = sorted(enumerate(made.pieces), key=lambda ip: (order.get(ip[1].layer, 1),
                                                          ip[1].z if ip[1].z is not None else fh * T, ip[0]))
  for i, (_n, p) in enumerate(pieces):
    if i == 0 or (p.layer != 'ground' and pieces[i - 1][1].layer == 'ground'):
      pass
    frames = p.frames
    f = frames[min(frame_i, len(frames) - 1)] if frame_i < len(frames) else frames[frame_i % len(frames)]
    if p.layer == 'ground':
      img.alpha_composite(f, (ox + p.dx, oy + p.dy))
  img.alpha_composite(fp, (ox, oy))
  for _n, p in pieces:
    if p.layer == 'ground':
      continue
    frames = p.frames
    f = frames[frame_i % len(frames)]
    img.alpha_composite(f, (ox + p.dx, oy + p.dy))
  if debug:
    for s in made.seats:
      ax = s.get('ax', s['dx'] * T + 8)
      ay = s.get('ay', s['dy'] * T + 12)
      for dd in ((0, 0), (1, 0), (0, 1), (1, 1)):
        x, y = ox + ax - 1 + dd[0], oy + ay - 1 + dd[1]
        if 0 <= x < img.width and 0 <= y < img.height:
          img.putpixel((x, y), (60, 255, 90, 255))
      fx, fy = {'down': (0, 3), 'up': (0, -3), 'left': (-3, 0), 'right': (3, 0)}[s['face']]
      x, y = ox + ax + fx, oy + ay + fy
      if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), (200, 255, 200, 255))
    for g in made.glows:
      x, y = ox + g['dx'], oy + g['dy']
      for k in range(-2, 3):
        for (px, py) in ((x + k, y), (x, y + k)):
          if 0 <= px < img.width and 0 <= py < img.height:
            img.putpixel((px, py), (255, 230, 60, 255))
  return img


def card(img, label, sub=''):
  lab = pixel_text(label, LABEL, 'mini')
  subimg = pixel_text(sub, DIM, 'mini') if sub else None
  w = max(img.width, lab.width, subimg.width if subimg else 0)
  h = img.height + 3 + lab.height + ((subimg.height + 2) if subimg else 0)
  out = new(w, h, BG)
  out.alpha_composite(img, ((w - img.width) // 2, 0))
  out.alpha_composite(lab, ((w - lab.width) // 2, img.height + 3))
  if subimg:
    out.alpha_composite(subimg, ((w - subimg.width) // 2, img.height + 5 + lab.height))
  return out


def flow(cards, width, gap=6, title=None):
  rows, row, rw = [], [], 0
  for c in cards:
    if row and rw + gap + c.width > width:
      rows.append(row)
      row, rw = [], 0
    row.append(c)
    rw += (gap if rw else 0) + c.width
  if row:
    rows.append(row)
  head = pixel_text(title, (255, 214, 120, 255), 'big') if title else None
  total_h = (head.height + 6 if head else 0) + sum(max(c.height for c in r) + gap for r in rows) + gap
  out = new(max(width, max((sum(c.width for c in r) + gap * (len(r) + 1)) for r in rows) if rows else width),
            total_h, BG)
  y = gap
  if head:
    out.alpha_composite(head, (gap, y))
    y += head.height + 6
  for r in rows:
    x = gap
    for c in r:
      out.alpha_composite(c, (x, y))
      x += c.width + gap
    y += max(c.height for c in r) + gap
  return out


def _param_summary(params):
  bits = []
  for k, v in params.items():
    if isinstance(v, list):
      v = ','.join(map(str, v))
    v = str(v)
    if len(v) > 14:
      v = v[:13] + '.'
    bits.append(f'{k}={v}')
  return ' '.join(bits)


def item_cards(names, variants=True, frames=False, debug=False):
  cards = []
  for name in names:
    d = ITEMS[name]
    sets = [{}] + (d.variants if variants else [])
    for params in sets:
      try:
        made = make(name, params)
      except Exception as e:  # noqa: BLE001 - show the failure on the sheet
        err = pixel_text(f'ERROR {type(e).__name__}', (255, 90, 90, 255), 'mini')
        cards.append(card(err, name, str(e)[:40]))
        continue
      n_frames = max(len(p.frames) for p in made.pieces) if made.pieces else 1
      shown = range(n_frames) if (frames and n_frames > 1) else [0]
      for fi in shown:
        img = render_item(made, d.scene, fi, debug)
        sub = _param_summary(params)
        if frames and n_frames > 1:
          sub = (sub + f' f{fi + 1}/{n_frames}').strip()
        cards.append(card(img, name, sub))
  return cards


SWATCH = {(x, y) for y in range(4) for x in range(6)} - {(5, 0), (2, 3)}  # a missing corner and a notch


def group(cards, title, gap=3):
  """Cards side by side under a title."""
  head = pixel_text(title, LABEL, 'mini')
  w = sum(c.width for c in cards) + gap * (len(cards) - 1)
  h = head.height + 3 + max(c.height for c in cards)
  out = new(max(w, head.width), h, BG)
  out.alpha_composite(head, (0, 0))
  x = 0
  for c in cards:
    out.alpha_composite(c, (x, head.height + 3))
    x += c.width + gap
  return out


def material_cards(names, edges=('soft', 'curb', 'hedge', 'none')):
  cards = []
  for name in names:
    d = MATERIAL_DEFS[name]
    sw = []
    for edge in edges:
      bg = ground('grass', 6, 4)
      bg.alpha_composite(paint_area(name, SWATCH, 6, 4, edge, seed=1))
      sw.append(card(bg, edge))
    if d.edge == 'wall':
      sw.append(card(wall_band(name), 'wall band'))
    title = name + (f' (colour {d.colour})' if d.colour else '')
    cards.append(group(sw, title))
  return cards


def wall_band(name, colour=None):
  """An interior snippet: wall cap, the two wall-face rows painted with `name`, wood floor."""
  wt, ht = 4, 3
  img = kit_ground._floor_wood(wt * T, ht * T, 4, 1.05)
  img.alpha_composite(props.wall_cap(wt * T, T), (0, 0))
  img.alpha_composite(props.wall_face(wt * T), (0, T))
  band = paint_area(name, {(x, y) for y in range(1, 3) for x in range(wt)}, wt, ht, 'soft', 1, colour)
  img.alpha_composite(band)
  return img


LINE_SCENES = {
  'volleyball': ('sand', 12, 7, None), 'basketball': ('hardcourt', 14, 8, None),
  'tennis': ('clay', 14, 7, None), 'badminton': ('hardcourt', 10, 5, 'green'),
  'football': ('pitch', 16, 9, None), 'border': ('cobbles', 6, 4, None),
  'centre_circle': ('hardcourt', 6, 6, 'red'), 'hopscotch': ('hardcourt', 10, 3, 'charcoal'),
  'running_track': ('tartan', 12, 4, None),
}


def line_cards(names):
  cards = []
  for name in names:
    mat, wt, ht, col = LINE_SCENES.get(name, ('hardcourt', 10, 6, None))
    bg = ground('grass', wt + 2, ht + 2)
    cells = {(x, y) for y in range(1, ht + 1) for x in range(1, wt + 1)}
    bg.alpha_composite(paint_area(mat, cells, wt + 2, ht + 2, 'soft', 2, col))
    bg.alpha_composite(paint_lines(name, wt * T, ht * T), (T, T))
    cards.append(card(bg, name, f'on {mat} {wt}x{ht}'))
  # One tall court to check turning.
  if 'volleyball' in names:
    wt, ht = 6, 10
    bg = ground('grass', wt + 2, ht + 2)
    cells = {(x, y) for y in range(1, ht + 1) for x in range(1, wt + 1)}
    bg.alpha_composite(paint_area('sand', cells, wt + 2, ht + 2, 'soft', 2))
    bg.alpha_composite(paint_lines('volleyball', wt * T, ht * T), (T, T))
    cards.append(card(bg, 'volleyball', 'tall 6x10'))
  return cards


def render_spec(spec, floor=''):
  """Paint + kit items of a builder spec, composed like the town draws them (ground, then by z, then over)."""
  ax, ay, aw, ah = spec['area']
  if floor == 'room':  # an interior like the café: wall cap (row 0), wall face (rows 1-2), wood floor
    img = kit_ground._floor_wood(aw * T, ah * T, 9, 1.12)
    img.alpha_composite(props.wall_face(aw * T, (244, 230, 206, 255), (110, 140, 100, 255)), (0, (1 - ay) * T))
    img.alpha_composite(props.wall_cap(aw * T, T), (0, (0 - ay) * T))
  elif floor:
    img = kit.material_texture(floor, aw * T, ah * T, 5)
  else:
    img = ground('grass', aw, ah, 5)
  for i, e in enumerate(spec.get('paint') or []):
    if 'lines' in e:
      x, y, w, h = e['rect']
      img.alpha_composite(paint_lines(e['lines'], w * T, h * T, e.get('colour')), ((x - ax) * T, (y - ay) * T))
      continue
    if 'rect' in e:
      x, y, w, h = e['rect']
      cells = {(xx, yy) for yy in range(y, y + h) for xx in range(x, x + w)}
    else:
      cells = {tuple(c) for c in e['cells']}
    bx, by = min(c[0] for c in cells), min(c[1] for c in cells)
    bw, bh = max(c[0] for c in cells) - bx + 1, max(c[1] for c in cells) - by + 1
    rel = {(c[0] - bx, c[1] - by) for c in cells}
    layer = paint_area(e['material'], rel, bw, bh, e.get('edge', 'soft'), e.get('seed', i), e.get('colour'))
    img.alpha_composite(layer, ((bx - ax) * T, (by - ay) * T))
  drawn = []
  for it in spec.get('items') or []:
    if it.get('kind') not in ITEMS:
      continue
    params = {k: v for k, v in it.items() if k not in ('kind', 'at', 'solid', 'flip', 'layer', 'note')}
    made = make(it['kind'], params)
    x0, y0 = (it['at'][0] - ax) * T, (it['at'][1] - ay) * T
    for p in made.pieces:
      z = p.z if p.z is not None else made.foot[1] * T
      drawn.append(({'ground': 0, 'normal': 1, 'over': 2}[p.layer], y0 + z, len(drawn), p, x0, y0))
  for _l, _z, _n, p, x0, y0 in sorted(drawn, key=lambda d: d[:3]):
    f = p.frames[0]
    kit.paste(img, f, x0 + p.dx, y0 + p.dy)
  return img


def main(args):
  sections = []
  if args.spec:
    import json
    spec = json.loads(Path(args.spec).read_text())
    out = render_spec(spec, args.floor)
    if args.scale != 1:
      out = out.resize((out.width * args.scale, out.height * args.scale), Image.NEAREST)
    out.convert('RGB').save(args.out, optimize=True)
    print(f'wrote {args.out} {out.width}x{out.height}')
    return
  fam = args.family
  if args.items:
    names = [n.strip() for n in args.items.split(',') if n.strip()]
    missing = [n for n in names if n not in ITEMS]
    if missing:
      sys.exit(f'unknown items: {", ".join(missing)}')
    sections.append(('Items', item_cards(names, not args.no_variants, args.frames, args.debug)))
  elif args.materials:
    names = [n.strip() for n in args.materials.split(',') if n.strip()]
    sections.append(('Materials', material_cards(names)))
  else:
    cats = kit.CATEGORIES if fam in ('all', 'items') else ((fam,) if fam in kit.CATEGORIES else ())
    for cat in cats:
      names = [n for n, d in ITEMS.items() if d.category == cat]
      if names:
        sections.append((cat.capitalize(), item_cards(names, not args.no_variants, args.frames, args.debug)))
    if fam in ('all', 'materials', 'edges'):
      sections.append(('Materials', material_cards(list(MATERIAL_DEFS))))
    if fam in ('all', 'lines'):
      sections.append(('Lines', line_cards(list(LINES))))
    if not sections:
      sys.exit(f'nothing to show for --family {fam}')
  sheets = [flow(cards, args.width, title=title) for title, cards in sections if cards]
  w = max(s.width for s in sheets)
  h = sum(s.height for s in sheets)
  out = new(w, h, BG)
  y = 0
  for s in sheets:
    out.alpha_composite(s, (0, y))
    y += s.height
  if args.scale != 1:
    out = out.resize((out.width * args.scale, out.height * args.scale), Image.NEAREST)
  out.convert('RGB').save(args.out, optimize=True)
  print(f'wrote {args.out} {out.width}x{out.height}')


if __name__ == '__main__':
  main(_args)
