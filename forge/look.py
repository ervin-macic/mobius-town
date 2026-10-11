"""What a builder needs to know about a build request: where, what is around, what is free."""
from __future__ import annotations

import json
import time

import world as W

T = 16
DIRV = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}
SIZES = [(3, 3), (5, 4), (8, 5), (12, 7), (14, 9)]


class Area:
  """The map as it is now: base walls and furniture plus every creation on it."""

  def __init__(self, map_id, bodies, index):
    self.m = W.Map(map_id)
    self.bodies = [b for b in bodies if b.get('map') == map_id]
    self.index = [c for c in index if c['map'] == map_id]
    hidden = set()
    for b in self.bodies:
      hidden.update(b.get('hide') or [])
    furniture_all = {e[6]: [tuple(t) for t in e[4]] for e in self.m.ents}
    self.opened = set()
    for key in hidden:
      self.opened.update(furniture_all.get(key, []))
    self.solid = set()
    self.seats = {(x, y) for (x, y) in self.m.seats}
    for b in self.bodies:
      self.solid.update(tuple(t) for t in b.get('solid') or [])
      self.seats.update((s['x'], s['y']) for s in b.get('seats') or [])
    # Tiles that tall base scenery covers in the picture (canopies, masts, roofs): building there
    # would hide under them or poke through them, so free spots avoid them.
    self.overhang = set()
    self.overhang_by: dict[tuple, set] = {}
    for e in self.m.ents:
      sid, x, y, z, tiles, _prot, key = e
      if key in hidden:
        continue
      img = W.sprite(sid)
      if img is None or img.height <= T + 4:
        continue
      base = {tuple(t) for t in tiles}
      for ty in range(max(0, y // T), min(self.m.h, (y + img.height - 1) // T + 1)):
        for tx in range(max(0, x // T), min(self.m.w, (x + img.width - 1) // T + 1)):
          if (tx, ty) not in base and self.m.kind(tx, ty) == 0:
            # Only count tiles the picture covers substantially (more than a corner).
            ox0, oy0 = max(x, tx * T), max(y, ty * T)
            ox1, oy1 = min(x + img.width, (tx + 1) * T), min(y + img.height, (ty + 1) * T)
            if (ox1 - ox0) * (oy1 - oy0) >= 96:
              self.overhang.add((tx, ty))
              self.overhang_by.setdefault((tx, ty), set()).add(key)
    # Furniture a builder may hide, by the tiles it stands on.
    self.hideable_at: dict[tuple, str] = {}
    for key, (sid, tiles) in self.m.furniture(hidden).items():
      for t in tiles:
        self.hideable_at[t] = key
    self.claimed = {}
    for c in self.index:
      x, y, w, h = c['area']
      for yy in range(y, y + h):
        for xx in range(x, x + w):
          self.claimed[(xx, yy)] = c['id']

  def blocked(self, x, y):
    if not self.m.inside(x, y):
      return True
    if (x, y) in self.solid:
      return True
    return self.m.kind(x, y) == 1 and (x, y) not in self.opened

  def free(self, x, y, own=None):
    """Free to build on: walkable now, not kept clear, not someone else's creation."""
    return (not self.blocked(x, y) and self.m.kind(x, y) != 2 and not self.m.is_protected(x, y)
            and (x, y) not in self.overhang and self.claimed.get((x, y), own) == own)

  def char(self, x, y, person):
    if person and (x, y) == (person[0], person[1]):
      return '@'
    if not self.m.inside(x, y):
      return ' '
    if self.m.kind(x, y) == 2:
      return 'D'
    if (x, y) in self.solid:
      return 'X'
    if self.blocked(x, y):
      return '#'
    if (x, y) in self.seats:
      return 's'
    if (x, y) in self.claimed:
      return '='
    if self.m.is_protected(x, y):
      return ':'
    if (x, y) in self.overhang:
      return '^'
    return '.'

  def ascii(self, window, person=None):
    wx, wy, ww, wh = window
    tens = '     ' + ''.join(str((x // 10) % 10) for x in range(wx, wx + ww))
    ones = '     ' + ''.join(str(x % 10) for x in range(wx, wx + ww))
    rows = [tens, ones]
    for y in range(wy, wy + wh):
      rows.append(f'{y:>4} ' + ''.join(self.char(x, y, person) for x in range(wx, wx + ww)))
    return '\n'.join(rows)

  def rect_free(self, x, y, w, h, own=None):
    return all(self.free(xx, yy, own) for yy in range(y, y + h) for xx in range(x, x + w))

  def clear_with_hides(self, x, y, w, h, own=None):
    """The furniture to hide so the rectangle becomes free, or None if something else is in the way."""
    hides = set()
    for yy in range(y, y + h):
      for xx in range(x, x + w):
        if not self.m.inside(xx, yy) or self.m.kind(xx, yy) == 2 or self.m.is_protected(xx, yy):
          return None
        if self.claimed.get((xx, yy), own) != own or (xx, yy) in self.solid:
          return None
        if self.blocked(xx, yy):
          key = self.hideable_at.get((xx, yy))
          if key is None:
            return None
          hides.add(key)
    # Canopies over the rectangle must belong to things being hidden (or to nothing).
    for yy in range(y, y + h):
      for xx in range(x, x + w):
        over = self.overhang_by.get((xx, yy))
        if over and not over <= hides:
          extra = {k for k in over if k not in hides}
          if all(k in self.m.furniture() for k in extra):
            hides |= extra
          else:
            return None
    return hides

  def spot_with_hides(self, px, py, direction, w, h, own=None):
    """The nearest rectangle in front that hiding a few trees, rocks or benches would free."""
    dx, dy = DIRV.get(direction, (0, 1))
    best = None
    for gap in range(1, 9):
      for shift in range(0, 12):
        for sign in ((0,) if shift == 0 else (-1, 1)):
          sft = shift * sign
          if dy:
            x = px - w // 2 + sft
            y = py + gap if dy > 0 else py - gap - h + 1
          else:
            y = py - h // 2 + sft
            x = px + gap if dx > 0 else px - gap - w + 1
          hides = self.clear_with_hides(x, y, w, h, own)
          if hides is not None and len(hides) <= 8:
            score = (len(hides), gap + abs(sft))
            if best is None or score < best[0]:
              best = (score, x, y, sorted(hides))
    return best

  def free_spots(self, px, py, direction, own=None):
    """For a few sizes, the nearest free rectangle in front of (px, py), else anywhere near."""
    dx, dy = DIRV.get(direction, (0, 1))
    out = []
    for (w, h) in SIZES:
      ww, hh = w, h
      best = None
      for gap in range(1, 9):
        for shift in range(0, 12):
          for sign in ((0,) if shift == 0 else (-1, 1)):
            s = shift * sign
            if dy:
              x = px - ww // 2 + s
              y = py + gap if dy > 0 else py - gap - hh + 1
            else:
              y = py - hh // 2 + s
              x = px + gap if dx > 0 else px - gap - ww + 1
            if self.rect_free(x, y, ww, hh, own):
              best = (x, y, ww, hh, gap, abs(s))
              break
          if best:
            break
        if best:
          break
      if best is None:
        # Anywhere close, nearest first.
        cand = []
        for y in range(max(0, py - 14), min(self.m.h - hh, py + 14)):
          for x in range(max(0, px - 18), min(self.m.w - ww, px + 18)):
            d = abs(x + ww / 2 - px) + abs(y + hh / 2 - py)
            cand.append((d, x, y))
        cand.sort()
        for d, x, y in cand[:4000]:
          if self.rect_free(x, y, ww, hh, own):
            best = (x, y, ww, hh, None, None)
            break
      out.append(best)
    return out


def ago(ms):
  s = max(0, time.time() - ms / 1000)
  if s < 90:
    return 'just now'
  if s < 5400:
    return f'{int(s // 60)} min ago'
  if s < 172800:
    return f'{int(s // 3600)} h ago'
  return f'{int(s // 86400)} days ago'


def context_text(ctx, area: Area, window, picture=None):
  site = ctx['site']
  m = area.m
  person = (site['x'], site['y'], site['dir'])
  room = m.room(site['x'], site['y'])
  who = f"{site['name']} (@{site['handle']})"
  lines = [
    f'Build request {site["id"]} from {who}: "{site["text"]}"',
    f'Where: {m.name} (map "{m.id}", {m.w}x{m.h} tiles), standing at [{site["x"]}, {site["y"]}] facing {site["dir"]}'
    + (f', in the room "{room["name"]}" ({room["id"]})' if not m.outdoor else '') + '.',
  ]
  if not m.outdoor:
    lines.append('Inside: rows 0-2 are the wall (row 0 its top, rows 1-2 the wall face you see). Repainting the wall '
                 'face keeps its windows and pictures unless you set "wall_decor": "remove".')
  if site.get('replace'):
    lines.append(f'This is a change to creation {site["replace"]}: run `town.py spec {site["replace"]}`, edit, '
                 f'then build with --replace {site["replace"]}.')
  pol = 'open to everyone' if ctx['policy'] == 'everyone' else 'keeper only'
  lines.append(f'Building is {pol}' + (' (you are the town keeper).' if ctx.get('keeper') else '.'))
  wx, wy, ww, wh = window
  lines += ['', f'Map around (x {wx}..{wx + ww - 1}, y {wy}..{wy + wh - 1}). # wall or prop, X built prop, '
            '. free, : free but keep clear (doors, tables, stage, things people use), ^ walkable but under a tall '
            'tree, mast or roof (avoid), D door, s seat, = inside another creation, @ the person:',
            area.ascii(window, person)]
  spots = area.free_spots(site['x'], site['y'], site['dir'], own=site.get('replace'))
  desc = []
  clear = []
  for spot, (w, h) in zip(spots, SIZES):
    if spot and spot[4] is not None:
      x, y, sw, sh, gap, _s = spot
      desc.append(f'{sw}x{sh} at [{x}, {y}] (in front)')
      continue
    if spot:
      x, y, sw, sh, _g, _s = spot
      desc.append(f'{sw}x{sh} at [{x}, {y}] (nearby)')
    else:
      desc.append(f'{w}x{h}: none close')
    if w * h >= 24 and m.outdoor:
      found = area.spot_with_hides(site['x'], site['y'], site['dir'], w, h, own=site.get('replace'))
      if found:
        _score, x, y, hides = found
        clear.append(f'{w}x{h} at [{x}, {y}] in front if you hide {json.dumps(hides)}')
  lines += ['', 'Free rectangles (nearest first): ' + '; '.join(desc) + '.']
  if clear:
    lines.append('Room in front made by hiding a few trees, rocks or benches (put the keys in "hide"; the '
                 'tiles become yours): ' + '; '.join(clear) + '.')
  near = []
  for c in area.index:
    x, y, w, h = c['area']
    if x < wx + ww and wx < x + w and y < wy + wh and wy < y + h:
      near.append(f'{c["id"]} "{c["title"]}" by @{c["by"]["handle"]} at {c["area"]}')
  if near:
    lines.append('Creations here: ' + '; '.join(near) + '.')
  furn = []
  for key, (sid, tiles) in sorted(m.furniture().items(), key=lambda kv: kv[1][1][:1] or [(0, 0)]):
    if not tiles:
      continue
    if any(wx <= x < wx + ww and wy <= y < wy + wh for (x, y) in tiles):
      furn.append(f'{key} {[list(t) for t in tiles][:4]}')
  if furn and (not m.outdoor or len(furn) <= 40):
    lines.append('Furniture you may hide (key, tiles): ' + '; '.join(furn[:60]) + '.')
  online = {p['handle'] for p in ctx.get('online') or []}
  ppl = []
  for p in (ctx.get('people') or [])[:30]:
    status = 'in town now' if p['handle'] in online else f'seen {ago(p["seen"])}'
    ppl.append(f'{p["name"]} (@{p["handle"]}, {status})')
  if ppl:
    lines.append('Möbians the town knows: ' + '; '.join(ppl) + '.')
  if picture:
    lines.append(f'Picture of this window (tile numbers on the edges, red = keep clear): {picture}')
  lim = ctx.get('limits') or {}
  lines.append(f'Limits: area up to {lim.get("area", 40)}x{lim.get("area", 40)} tiles, {lim.get("props", 300)} pieces, '
               f'{lim.get("art_bytes", 600000) // 1000} KB of pictures.')
  return '\n'.join(lines)
