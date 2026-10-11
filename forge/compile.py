"""Compile a builder's spec into a creation the town can draw (and the hub can check).

    body, stored, notes = Compiler(spec, base_dir).run()

`body` is the creation format the hub stores and every town draws: pictures as PNG
data URLs (one ground picture for all painting; one or more pieces per prop, each
with its own sort line), plus tiles, seats, lights, labels, interactions,
triggers and the court game. `stored` is the spec with every file it named
embedded, so the creation can be changed later from any machine. `notes` are
warnings for the builder (things that work but may not be what they meant).
"""
from __future__ import annotations

import base64
import datetime as dt
import io
import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image

FORGE = Path(__file__).resolve().parent
APP = FORGE.parent
for path in (str(FORGE), str(APP)):
  if path not in sys.path:
    sys.path.insert(0, path)

import kit  # noqa: E402
import world as W  # noqa: E402

T = 16
RESERVED = {'kind', 'at', 'solid', 'flip', 'name', 'src', 'foot', 'frames', 'fps', 'layer', 'seat', 'note', 'offset'}
WALL_STYLES = {
  'fence_wood': ('fence', {'style': 'wood'}), 'fence_picket': ('fence', {'style': 'picket'}),
  'fence_iron': ('fence', {'style': 'iron'}), 'fence_rope': ('fence', {'style': 'rope'}),
  'wall_stone': ('wall', {'style': 'stone'}), 'wall_brick': ('wall', {'style': 'brick'}),
  'hedge': ('hedge', {}),
}
BUILTIN_GAMES = APP / 'games' / 'cartridges'


class SpecError(ValueError):
  """The spec can't be built as written; the message says what to change."""


def need(cond, message):
  if not cond:
    raise SpecError(message)


def png_url(img: Image.Image) -> str:
  buf = io.BytesIO()
  img.save(buf, 'PNG', optimize=True)
  return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def file_url(path: Path) -> str:
  return 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode()


def iso_ms(value, what):
  if value is None:
    return None
  if isinstance(value, (int, float)) and not isinstance(value, bool):
    return int(value)
  need(isinstance(value, str), f'{what} must be an ISO time like 2026-10-12T20:00:00+01:00.')
  try:
    t = dt.datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
  except ValueError:
    raise SpecError(f'{what}: "{value}" is not an ISO time like 2026-10-12T20:00:00+01:00.')
  if t.tzinfo is None:
    t = t.replace(tzinfo=dt.timezone.utc)
  return int(t.timestamp() * 1000)


def tile_list(value, what):
  need(isinstance(value, list) and len(value) == 2 and all(isinstance(v, int) for v in value),
       f'{what} must be a tile [x, y] (whole numbers).')
  return value


def rect_of(value, what):
  need(isinstance(value, list) and len(value) == 4 and all(isinstance(v, int) for v in value),
       f'{what} must be [x, y, w, h] in tiles.')
  need(value[2] >= 1 and value[3] >= 1, f'{what} needs a width and height of at least 1.')
  return value


def cartridge_meta(path: Path) -> dict:
  """Run the cartridge harness in --meta mode (the same runtime the towns use)."""
  harness = FORGE / 'cartridge_test.mjs'
  need(harness.exists(), 'The court-game harness is missing from this town version.')
  try:
    out = subprocess.run(['node', str(harness), str(path), '--meta'], capture_output=True, text=True, timeout=60)
  except FileNotFoundError:
    raise SpecError('Node.js is needed to read a court game; it is not installed here.')
  except subprocess.TimeoutExpired:
    raise SpecError('Reading the court game timed out.')
  if out.returncode != 0:
    raise SpecError('The court game did not load: ' + (out.stderr or out.stdout).strip()[-600:])
  try:
    return json.loads(out.stdout)
  except ValueError:
    raise SpecError('The court game printed something unexpected instead of its meta.')


class Compiler:
  def __init__(self, spec: dict, base_dir: Path | str = '.', *, meta_reader=cartridge_meta):
    need(isinstance(spec, dict), 'The spec must be a JSON object.')
    self.spec = spec
    self.base = Path(base_dir)
    self.meta_reader = meta_reader
    self.notes: list[str] = []
    self.files: dict[str, str] = dict(spec.get('_files') or {})  # embedded files of a stored spec
    need(isinstance(spec.get('title'), str) and spec['title'].strip(), 'Give the creation a `title`.')
    mid = spec.get('map')
    need(mid in W.map_ids(), f'`map` must be one of {", ".join(W.map_ids())}.')
    self.map = W.Map(mid)
    self.area = rect_of(spec.get('area'), '`area`')
    ax, ay, aw, ah = self.area
    need(0 <= ax and 0 <= ay and ax + aw <= self.map.w and ay + ah <= self.map.h,
         f'`area` must lie inside the map ({self.map.w} x {self.map.h} tiles).')
    self.props: list[dict] = []
    self.solid: set[tuple[int, int]] = set()
    self.seats: list[dict] = []
    self.glows: list[dict] = []
    self.uses: list[dict] = []
    self.ground: Image.Image | None = None
    self.painted: set[tuple[int, int]] = set()

  # --- helpers ---------------------------------------------------------------------------------------

  def in_area(self, x, y):
    ax, ay, aw, ah = self.area
    return ax <= x < ax + aw and ay <= y < ay + ah

  def load_file(self, src, what) -> tuple[Path | None, str]:
    """A file named by the spec: from the stored spec's embedded files, or next to the spec."""
    need(isinstance(src, str) and src and '..' not in Path(src).parts, f'{what}: give a file name next to the spec.')
    if src in self.files:
      return None, self.files[src]
    path = (self.base / src).resolve()
    need(path.is_file(), f'{what}: {src} was not found next to the spec.')
    return path, ''

  def image_from(self, src, what) -> Image.Image:
    path, embedded = self.load_file(src, what)
    raw = path.read_bytes() if path else base64.b64decode(embedded.split(',', 1)[1])
    try:
      img = Image.open(io.BytesIO(raw))
      need(img.format == 'PNG', f'{what}: {src} must be a PNG.')
      img = img.convert('RGBA')
    except SpecError:
      raise
    except Exception:
      raise SpecError(f'{what}: {src} could not be read as a picture.')
    if path:
      self.files[src] = file_url(path)
    return img

  def canvas(self):
    if self.ground is None:
      ax, ay, aw, ah = self.area
      self.ground = Image.new('RGBA', (aw * T, ah * T), (0, 0, 0, 0))
    return self.ground

  def cells_of(self, entry, what):
    if 'rect' in entry:
      x, y, w, h = rect_of(entry['rect'], f'{what}: rect')
      cells = {(xx, yy) for yy in range(y, y + h) for xx in range(x, x + w)}
    elif 'cells' in entry:
      need(isinstance(entry['cells'], list) and entry['cells'], f'{what}: cells is a list of tiles.')
      cells = {tuple(tile_list(c, f'{what}: cell')) for c in entry['cells']}
    elif 'disc' in entry:
      d = entry['disc']
      need(isinstance(d, list) and len(d) == 3 and all(isinstance(v, (int, float)) for v in d),
           f'{what}: disc is [cx, cy, r] in tiles.')
      cx, cy, r = d
      cells = {(x, y) for y in range(int(cy - r - 1), int(cy + r + 2)) for x in range(int(cx - r - 1), int(cx + r + 2))
               if (x + 0.5 - cx - 0.5) ** 2 + (y + 0.5 - cy - 0.5) ** 2 <= r * r}
    else:
      raise SpecError(f'{what}: say where with rect, cells or disc.')
    outside = [c for c in cells if not self.in_area(*c)]
    if outside:
      raise SpecError(f'{what}: tile {list(outside[0])} is outside `area` {self.area}.')
    return cells

  # --- painting ---------------------------------------------------------------------------------------

  def paint(self):
    entries = self.spec.get('paint') or []
    need(isinstance(entries, list), '`paint` is a list.')
    ax, ay, aw, ah = self.area
    for i, e in enumerate(entries):
      what = f'paint {i + 1}'
      need(isinstance(e, dict), f'{what} must be an object.')
      if 'lines' in e:
        x, y, w, h = rect_of(e.get('rect'), f'{what}: rect')
        need(self.in_area(x, y) and self.in_area(x + w - 1, y + h - 1), f'{what}: rect is outside `area`.')
        try:
          img = kit.paint_lines(e['lines'], w * T, h * T, e.get('colour') or 'white')
        except kit.KitError as err:
          raise SpecError(f'{what}: {err}')
        self.canvas().alpha_composite(img, ((x - ax) * T, (y - ay) * T))
        continue
      material = e.get('material')
      need(isinstance(material, str), f'{what}: name a material (or lines).')
      cells = self.cells_of(e, what)
      xs = [c[0] for c in cells]
      ys = [c[1] for c in cells]
      bx, by = min(xs), min(ys)
      bw, bh = max(xs) - bx + 1, max(ys) - by + 1
      rel = {(x - bx, y - by) for (x, y) in cells}
      edge = e.get('edge', 'soft')
      need(edge in kit.EDGES, f'{what}: edge is one of {", ".join(kit.EDGES)}.')
      seed = e.get('seed', i)
      try:
        if hasattr(kit, 'paint_area'):
          img = kit.paint_area(material, rel, bw, bh, edge=edge, seed=seed, colour=e.get('colour'))
        else:  # an older kit: plain material, no edge
          img = kit.paint_material(material, bw * T, bh * T, seed)
          mask = Image.new('L', img.size, 0)
          for (x, y) in rel:
            mask.paste(255, (x * T, y * T, x * T + T, y * T + T))
          img.putalpha(mask)
      except kit.KitError as err:
        raise SpecError(f'{what}: {err}')
      self.canvas().alpha_composite(img, ((bx - ax) * T, (by - ay) * T))
      self.painted |= cells
    self.keep_decor()

  def keep_decor(self):
    """Windows, pictures and the cinema screen painted on a wall survive a repaint of that wall."""
    mode = self.spec.get('wall_decor', 'keep')
    need(mode in ('keep', 'remove'), '`wall_decor` is "keep" (default) or "remove".')
    if mode == 'remove' and not any(d[0] == 'tv' for d in self.map.decor):
      return
    ax, ay, aw, ah = self.area
    for sid, px, py in self.map.decor:
      if mode == 'remove' and sid != 'tv':
        continue
      img = W.sprite(sid)
      if img is None:
        continue
      tiles = {(x, y) for y in range(py // T, (py + img.height - 1) // T + 1)
               for x in range(px // T, (px + img.width - 1) // T + 1)}
      if tiles & self.painted:
        self.canvas().alpha_composite(img, dest=(max(0, px - ax * T), max(0, py - ay * T)),
                                      source=(max(0, ax * T - px), max(0, ay * T - py)))

  # --- items --------------------------------------------------------------------------------------------

  def place(self, made: kit.Made, at, *, what, flip=False, solid_override=None, layer=None, default_solid=True,
            offset=None):
    x0, y0 = at
    ox, oy = 0, 0
    if offset is not None:
      need(isinstance(offset, list) and len(offset) == 2 and all(isinstance(v, int) and abs(v) <= 32 for v in offset),
           f'{what}: offset is [dx, dy] in pixels, each between -32 and 32.')
      ox, oy = offset
    fw, fh = made.foot
    for dy in range(fh):
      for dx in range(fw):
        need(self.in_area(x0 + dx, y0 + dy),
             f'{what}: its footprint ({fw}x{fh} at {list(at)}) reaches outside `area` {self.area}.')
    for p in made.pieces:
      frames = p.frames
      w, h = frames[0].size
      dx = p.dx
      if flip:
        frames = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in frames]
        dx = fw * T - (p.dx + w)
      z = p.z if p.z is not None else fh * T
      self.props.append({
        'x': x0 * T + dx + ox, 'y': y0 * T + p.dy + oy, 'z': y0 * T + z, 'layer': layer or p.layer,
        'frames': [png_url(f) for f in frames], 'fps': p.fps if len(frames) > 1 else 0,
        'fx': getattr(p, 'fx', None),
      })
    if solid_override is not None:
      if solid_override is False:
        tiles = []
      elif solid_override is True:
        tiles = [(x0 + dx, y0 + dy) for dy in range(fh) for dx in range(fw)]
      else:
        need(isinstance(solid_override, list), f'{what}: solid is true, false or a list of tiles.')
        tiles = [tuple(tile_list(t, f'{what}: solid tile')) for t in solid_override]
    elif made.solid is None:
      tiles = [(x0 + dx, y0 + dy) for dy in range(fh) for dx in range(fw)] if default_solid else []
    else:
      tiles = [((fw - 1 - sx) if flip else sx, sy) for (sx, sy) in made.solid]
      tiles = [(x0 + sx, y0 + sy) for (sx, sy) in tiles]
    for t in tiles:
      need(self.in_area(*t), f'{what}: solid tile {list(t)} is outside `area`.')
      if self.map.is_protected(*t):
        raise SpecError(f'{what}: tile {list(t)} must stay clear (a door, a game table, a seat or something people '
                        f'use is there). Move it.')
      self.solid.add(t)
    for s in made.seats:
      sx, sy = s['dx'], s['dy']
      face = s['face']
      if flip:
        sx = fw - 1 - sx
        face = {'left': 'right', 'right': 'left'}.get(face, face)
      ax = x0 * T + (s['ax'] if 'ax' in s else sx * T + 8)
      ay = y0 * T + (s['ay'] if 'ay' in s else sy * T + 12)
      if flip and 'ax' in s:
        ax = x0 * T + fw * T - s['ax']
      self.seats.append({'x': x0 + sx, 'y': y0 + sy, 'face': face, 'ax': int(ax), 'ay': int(ay)})
    for g in made.glows:
      gx = (fw * T - g['dx']) if flip else g['dx']
      self.glows.append({'x': x0 * T + int(gx), 'y': y0 * T + int(g['dy']), 'radius': g['radius'],
                         'colour': g['colour'], 'flicker': bool(g.get('flicker'))})
    if made.use and made.text:
      tiles = [[x0 + ux, y0 + uy] for (ux, uy) in made.use]
      tiles = [t for t in tiles if self.in_area(*t)] or [[x0, y0 + fh - 1]]
      self.uses.append({'tiles': tiles, 'prompt': 'Read the sign', 'do': [{'say': made.text, 'title': ''}]})

  def item(self, i, it):
    what = f'item {i + 1} ({it.get("kind", "?")})'
    need(isinstance(it, dict), f'item {i + 1} must be an object.')
    kind = it.get('kind')
    at = tile_list(it.get('at'), f'{what}: at')
    flip = bool(it.get('flip'))
    layer = it.get('layer')
    need(layer in (None, 'ground', 'normal', 'over'), f'{what}: layer is ground, normal or over.')
    solid = it.get('solid')
    if kind == 'sprite':
      name = it.get('name')
      img = W.sprite(name) if isinstance(name, str) else None
      need(img is not None, f'{what}: no atlas sprite called "{name}" (see `town.py kit`).')
      foot = it.get('foot') or [max(1, math.ceil(img.width / T)), 1]
      need(isinstance(foot, list) and len(foot) == 2 and all(isinstance(v, int) and v >= 1 for v in foot),
           f'{what}: foot is [w, h] in tiles.')
      made = kit.Made([kit.standing(img, tuple(foot), dy=1)], foot=tuple(foot))
      self.place(made, at, what=what, flip=flip, solid_override=solid, layer=layer, offset=it.get('offset'))
      self.seat_item(it, at, what)
      return
    if kind == 'image':
      img = self.image_from(it.get('src'), what)
      n = it.get('frames', 1)
      need(isinstance(n, int) and 1 <= n <= 8 and img.width % n == 0, f'{what}: frames must split the image evenly.')
      fw = img.width // n
      need(fw <= 256 and img.height <= 384, f'{what}: each frame is at most 256 x 384 pixels.')
      frames = [img.crop((k * fw, 0, (k + 1) * fw, img.height)) for k in range(n)]
      foot = it.get('foot') or [max(1, math.ceil(fw / T)), 1]
      need(isinstance(foot, list) and len(foot) == 2 and all(isinstance(v, int) and v >= 1 for v in foot),
           f'{what}: foot is [w, h] in tiles.')
      fps = it.get('fps', 6 if n > 1 else 0)
      piece = kit.standing(frames if n > 1 else frames[0], tuple(foot), fps=fps)
      made = kit.Made([piece], foot=tuple(foot))
      self.place(made, at, what=what, flip=flip, solid_override=solid, layer=layer,
                 default_solid=(layer != 'ground'), offset=it.get('offset'))
      self.seat_item(it, at, what)
      return
    need(isinstance(kind, str) and kind in kit.ITEMS, f'{what}: unknown kind (see `town.py kit`).')
    params = {k: v for k, v in it.items() if k not in RESERVED}
    try:
      made = kit.make(kind, params)
    except kit.KitError as err:
      raise SpecError(f'{what}: {err}')
    self.place(made, at, what=what, flip=flip, solid_override=solid, layer=layer, offset=it.get('offset'))
    self.seat_item(it, at, what)

  def seat_item(self, it, at, what):
    face = it.get('seat')
    if face is None:
      return
    need(face in ('up', 'down', 'left', 'right'), f'{what}: seat is the way a sitter faces (up/down/left/right).')
    self.seats.append({'x': at[0], 'y': at[1], 'face': face, 'ax': at[0] * T + 8, 'ay': at[1] * T + 12})
    self.solid.discard(tuple(at))

  def walls(self):
    for i, w in enumerate(self.spec.get('walls') or []):
      what = f'wall {i + 1}'
      need(isinstance(w, dict), f'{what} must be an object.')
      a = tile_list(w.get('from'), f'{what}: from')
      b = tile_list(w.get('to'), f'{what}: to')
      need(a[0] == b[0] or a[1] == b[1], f'{what}: walls run straight (same x or same y).')
      style = w.get('style', 'fence_wood')
      need(style in WALL_STYLES, f'{what}: style is one of {", ".join(WALL_STYLES)}.')
      kind, params = WALL_STYLES[style]
      vertical = a[0] == b[0] and a[1] != b[1]
      length = abs(b[1] - a[1]) + 1 if vertical else abs(b[0] - a[0]) + 1
      at = [min(a[0], b[0]), min(a[1], b[1])]
      need(kind in kit.ITEMS, f'{what}: this town version has no {kind}.')
      spec = {'kind': kind, 'at': at, 'length': length, **params}
      if 'vertical' in kit.ITEMS[kind].params:
        spec['vertical'] = vertical
      self.item(len(self.spec.get('items') or []) + i, spec)

  # --- everything else -----------------------------------------------------------------------------------

  def px_centre(self, t):
    return t[0] * T + 8, t[1] * T + 8

  def actions(self, items, what):
    need(isinstance(items, list) and items, f'{what}: `do` is a list of actions.')
    out = []
    for a in items:
      need(isinstance(a, dict), f'{what}: each action is an object.')
      out.append(dict(a))
    return out

  def game(self):
    g = self.spec.get('game')
    if g is None:
      return None
    need(isinstance(g, dict), '`game` is an object.')
    court = rect_of(g.get('court'), 'game.court')
    x, y, w, h = court
    need(self.in_area(x, y) and self.in_area(x + w - 1, y + h - 1), 'game.court must lie inside `area`.')
    name = g.get('cartridge')
    need(isinstance(name, str) and name, 'game.cartridge is "volleyball" or a .js file next to the spec.')
    if name.endswith('.js'):
      path, embedded = self.load_file(name, 'game.cartridge')
      if path:
        code = path.read_text()
        self.files[name] = code
      else:
        code = embedded
        tmp = Path(self.base) / f'.cart-{abs(hash(code)) % 10**8}.js'
        tmp.write_text(code)
        path = tmp
    else:
      path = BUILTIN_GAMES / f'{name}.js'
      need(path.is_file(), f'game.cartridge: there is no ready-made game called "{name}".')
      code = path.read_text()
    meta = self.meta_reader(path)
    minw, minh = (meta.get('court') or {}).get('minW', 4), (meta.get('court') or {}).get('minH', 3)
    need(w >= minw and h >= minh, f'{meta.get("title", name)} needs a court of at least {minw} x {minh} tiles.')
    # The game's fixtures (a net, hoops, goals) go onto the court automatically.
    items = self.spec.get('items') or []
    for fixture in meta.get('props') or []:
      spec = dict(fixture)
      fx, fy = spec.pop('at', [0, 0])

      def resolve(v, size):
        if v == 'mid':
          return size // 2
        if v == 'end':
          return size - 1
        return int(v)
      at = [x + resolve(fx, w), y + resolve(fy, h)]
      for k, v in list(spec.items()):
        if v == 'h':
          spec[k] = h
        elif v == 'w':
          spec[k] = w
      if any(isinstance(it, dict) and it.get('kind') == spec.get('kind') for it in items):
        continue
      if spec.get('kind') in kit.ITEMS:
        self.item(len(items) + 100, {**spec, 'at': at})
      else:
        self.notes.append(f'This kit has no "{spec.get("kind")}" for the court; add one yourself.')
    return {'cartridge': {'id': meta['id'], 'code': code}, 'court': court, 'options': g.get('options') or {},
            'meta': meta}

  def run(self):
    s = self.spec
    self.paint()
    for i, it in enumerate(s.get('items') or []):
      self.item(i, it)
    self.walls()
    game = self.game()
    hide = s.get('hide') or []
    furniture = self.map.furniture()
    for key in hide:
      need(key in furniture, f'hide: "{key}" is not furniture that can be removed here (see `look`).')
    for i, g in enumerate(s.get('glows') or []):
      t = tile_list(g.get('at'), f'glow {i + 1}: at')
      cx, cy = self.px_centre(t)
      self.glows.append({'x': cx, 'y': cy, 'radius': g.get('radius', 2.5), 'colour': g.get('colour', '#ffd78a'),
                         'flicker': bool(g.get('flicker'))})
    labels = []
    for i, lab in enumerate(s.get('labels') or []):
      t = tile_list(lab.get('at'), f'label {i + 1}: at')
      cx, cy = self.px_centre(t)
      labels.append({'x': cx, 'y': cy, 'text': lab.get('text', '')})
    for i, u in enumerate(s.get('interactions') or []):
      what = f'interaction {i + 1}'
      need(isinstance(u, dict), f'{what} must be an object.')
      at = u.get('at')
      tiles = [tile_list(at, f'{what}: at')] if at and isinstance(at[0], int) else \
        [tile_list(t, f'{what}: at') for t in (at or [])]
      self.uses.append({'tiles': tiles, 'prompt': u.get('prompt', ''), 'do': self.actions(u.get('do'), what)})
    triggers = []
    for i, t in enumerate(s.get('triggers') or []):
      what = f'trigger {i + 1}'
      need(isinstance(t, dict), f'{what} must be an object.')
      out = {k: v for k, v in t.items() if k not in ('from', 'until', 'do')}
      for k in ('from', 'until'):
        if t.get(k) is not None:
          out[k] = iso_ms(t[k], f'{what}: {k}')
      out['do'] = self.actions(t.get('do'), what)
      triggers.append(out)
    music = None
    if s.get('music'):
      m = s['music']
      need(isinstance(m, dict), '`music` is an object.')
      t = tile_list(m.get('at') or [self.area[0] + self.area[2] // 2, self.area[1] + self.area[3] // 2], 'music.at')
      cx, cy = self.px_centre(t)
      music = {'song': m.get('song'), 'x': cx, 'y': cy, 'radius': m.get('radius', 6)}
    ground = []
    if self.ground is not None and self.ground.getbbox():
      bbox = self.ground.getbbox()
      ax, ay = self.area[0] * T, self.area[1] * T
      ground.append({'x': ax + bbox[0], 'y': ay + bbox[1], 'img': png_url(self.ground.crop(bbox))})
    body = {
      'v': 1, 'title': s['title'], 'note': s.get('note', ''), 'map': self.map.id, 'area': self.area,
      'ground': ground, 'props': self.props, 'solid': sorted([list(t) for t in self.solid]), 'hide': hide,
      'seats': self.seats, 'glows': self.glows, 'mood': s.get('mood'), 'labels': labels, 'uses': self.uses,
      'triggers': triggers, 'surprise_for': s.get('surprise_for') or [], 'music': music, 'game': game,
      'expires': iso_ms(s.get('expires'), '`expires`'),
    }
    stored = {k: v for k, v in s.items() if k != '_files'}
    stored['_files'] = self.files
    self.check_paths(body)
    return body, stored, self.notes

  def check_paths(self, body):
    """Warn when new solid tiles cut off a door or wall in a place people need to reach."""
    blocked = {tuple(t) for t in body['solid']}
    m = self.map
    hidden = set()
    for key in body['hide']:
      hidden.update(m.furniture().get(key, (None, []))[1])

    def free(x, y):
      if not m.inside(x, y) or (x, y) in blocked:
        return False
      return m.kind(x, y) != 1 or (x, y) in hidden
    doors = [(d['x'], d['y']) for d in m.doors]
    if not doors:
      return
    start = doors[0]
    seen = {start}
    stack = [start]
    while stack:
      x, y = stack.pop()
      for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if (nx, ny) not in seen and free(nx, ny):
          seen.add((nx, ny))
          stack.append((nx, ny))
    cut = [d for d in doors if d not in seen]
    ax, ay, aw, ah = self.area
    trapped = [(x, y) for y in range(ay, ay + ah) for x in range(ax, ax + aw)
               if free(x, y) and (x, y) not in seen and m.kind(x, y) == 0 and (x, y) not in blocked]
    if cut:
      raise SpecError(f'These walls or props cut the way to a door at {list(cut[0])}. Leave a gap.')
    if trapped and len(trapped) > 2:
      self.notes.append(f'{len(trapped)} free tiles inside the area can no longer be reached (e.g. {list(trapped[0])}).'
                        ' Leave a gap if people should walk in.')
