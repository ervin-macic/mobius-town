"""Draw a window of a map with its creations, so a builder can see the result.

The town's browsers draw the same pictures with the same sort lines; this is a
faithful still (no people, no animation beyond the first frame).
"""
from __future__ import annotations

import base64
import io
import json
import math
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

import world as W

T = 16
APP = Path(__file__).resolve().parent.parent


@lru_cache(maxsize=256)
def _decode(url: str) -> Image.Image:
  return Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')


@lru_cache(maxsize=4)
def _font(size: int):
  try:
    text = (APP / 'engine' / 'fonts.gen.js').read_text()
    fonts = json.loads(text[text.index('{'):text.rindex('}') + 1])
    return ImageFont.truetype(io.BytesIO(base64.b64decode(fonts['mini'])), size)
  except Exception:
    return ImageFont.load_default()


def hidden_keys(bodies) -> set:
  out = set()
  for b in bodies:
    out.update(b.get('hide') or [])
  return out


def render(map_id: str, window, bodies, *, person=None, mark=None, scale=2, grid=True, ruler=True,
           protected=False) -> Image.Image:
  """window = [x, y, w, h] tiles. bodies = creation bodies (drawn in order). person = (x, y, dir)."""
  m = W.Map(map_id)
  wx, wy, ww, wh = window
  wx, wy = max(0, wx), max(0, wy)
  ww, wh = min(ww, m.w - wx), min(wh, m.h - wy)
  ox, oy = wx * T, wy * T
  img = m.ground().crop((ox, oy, ox + ww * T, oy + wh * T)).copy()
  bodies = [b for b in bodies if b and b.get('map') == map_id]
  hide = hidden_keys(bodies)

  def paste(sprite, x, y):
    px, py = int(x - ox), int(y - oy)
    if px >= img.width or py >= img.height or px + sprite.width <= 0 or py + sprite.height <= 0:
      return
    # alpha_composite needs non-negative destinations: crop the sprite instead.
    sx0, sy0 = max(0, -px), max(0, -py)
    piece = sprite.crop((sx0, sy0, min(sprite.width, img.width - px), min(sprite.height, img.height - py)))
    img.alpha_composite(piece, (px + sx0, py + sy0))

  for b in bodies:
    for g in b.get('ground') or []:
      paste(_decode(g['img']), g['x'], g['y'])
    for p in b.get('props') or []:
      if p.get('layer') == 'ground':
        paste(_decode(p['frames'][0]), p['x'], p['y'])
  drawables = []
  for e in m.ents:
    sid, x, y, z, _tiles, _prot, key = e
    if key in hide:
      continue
    s = W.sprite(sid)
    if s is not None:
      drawables.append((z, 0, s, x, y))
  for bi, b in enumerate(bodies):
    for p in b.get('props') or []:
      if p.get('layer', 'normal') == 'normal':
        drawables.append((p['z'], 1, _decode(p['frames'][0]), p['x'], p['y']))
  if person:
    px, py, _d = person
    drawables.append((py * T + 13.5, 2, _person_marker(), px * T, py * T - 14))
  drawables.sort(key=lambda d: (d[0], d[1]))
  for _z, _k, s, x, y in drawables:
    paste(s, x, y)
  for b in bodies:
    for p in b.get('props') or []:
      if p.get('layer') == 'over':
        paste(_decode(p['frames'][0]), p['x'], p['y'])
  # Light: room mood and glows.
  for b in bodies:
    mood = b.get('mood')
    if mood:
      img = _apply_mood(img, mood)
  for b in bodies:
    for g in b.get('glows') or []:
      img = _glow(img, g['x'] - ox, g['y'] - oy, g['radius'] * T, g['colour'], 0.45 if m.outdoor else 1)
  if protected:
    tint = Image.new('RGBA', (T, T), (255, 60, 60, 70))
    for y in range(wy, wy + wh):
      for x in range(wx, wx + ww):
        if m.is_protected(x, y):
          img.alpha_composite(tint, ((x - wx) * T, (y - wy) * T))
  if mark:
    mx, my, mw, mh = mark
    d = ImageDraw.Draw(img)
    for i in range(0, 2):
      d.rectangle(((mx - wx) * T + i, (my - wy) * T + i, (mx - wx + mw) * T - 1 - i, (my - wy + mh) * T - 1 - i),
                  outline=(255, 214, 90, 255) if i == 0 else (60, 40, 10, 255))
  big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
  d = ImageDraw.Draw(big)
  if grid:
    for x in range(ww + 1):
      d.line([(x * T * scale, 0), (x * T * scale, big.height)], fill=(255, 255, 255, 38))
    for y in range(wh + 1):
      d.line([(0, y * T * scale), (big.width, y * T * scale)], fill=(255, 255, 255, 38))
  # Labels like the town draws them.
  font = _font(8 * scale)
  for b in bodies:
    for lab in b.get('labels') or []:
      tx, ty = (lab['x'] - ox) * scale, (lab['y'] - oy) * scale
      tw = d.textlength(lab['text'], font=font)
      d.rounded_rectangle((tx - tw / 2 - 6, ty - 9, tx + tw / 2 + 6, ty + 9), radius=9, fill=(20, 16, 32, 150))
      d.text((tx, ty), lab['text'], font=font, fill=(255, 246, 220, 255), anchor='mm')
  if ruler:
    big = _ruler(big, wx, wy, ww, wh, scale)
  return big


def _person_marker() -> Image.Image:
  """A simple pin where the person stood (they are drawn by the town, not here)."""
  img = Image.new('RGBA', (16, 28), (0, 0, 0, 0))
  d = ImageDraw.Draw(img)
  d.ellipse((2, 0, 13, 11), fill=(46, 118, 255, 255), outline=(20, 30, 70, 255))
  d.polygon([(4, 9), (11, 9), (8, 26)], fill=(46, 118, 255, 255), outline=(20, 30, 70, 255))
  d.ellipse((5, 3, 10, 8), fill=(255, 255, 255, 255))
  return img


def _hex(c):
  c = c.lstrip('#')
  return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _apply_mood(img, mood):
  b = mood.get('brightness') or 0
  w = mood.get('warmth') or 0
  rgb = img.convert('RGB')
  if b > 0:
    rgb = Image.blend(rgb, ImageChops.screen(rgb, Image.new('RGB', rgb.size, (255, 248, 236))), min(0.6, b * 0.55))
  elif b < 0:
    rgb = Image.blend(rgb, ImageChops.multiply(rgb, Image.new('RGB', rgb.size, (60, 56, 110))), min(0.75, -b * 0.7))
  if w:
    tone = (255, 170, 90) if w > 0 else (110, 160, 255)
    rgb = Image.blend(rgb, ImageChops.soft_light(rgb, Image.new('RGB', rgb.size, tone)), min(0.6, abs(w) * 0.5))
  if mood.get('tint'):
    rgb = Image.blend(rgb, ImageChops.soft_light(rgb, Image.new('RGB', rgb.size, _hex(mood['tint']))), 0.35)
  out = rgb.convert('RGBA')
  out.putalpha(img.getchannel('A'))
  return out


def _glow(img, cx, cy, r, colour, strength=1.0):
  r = max(4, int(r))
  layer = Image.new('RGB', img.size, (0, 0, 0))
  col = _hex(colour)
  d = ImageDraw.Draw(layer)
  steps = 6
  for i in range(steps, 0, -1):
    rr = r * i / steps
    k = (1 - i / steps) ** 1.5 * 0.4 * strength
    d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=tuple(int(c * k) for c in col))
  rgb = ImageChops.screen(img.convert('RGB'), layer)
  out = rgb.convert('RGBA')
  out.putalpha(img.getchannel('A'))
  return out


def _ruler(big, wx, wy, ww, wh, scale):
  """Tile numbers along the top and left, so positions can be read off the picture."""
  m = 18
  out = Image.new('RGBA', (big.width + m, big.height + m), (24, 20, 34, 255))
  out.alpha_composite(big, (m, m))
  d = ImageDraw.Draw(out)
  font = _font(8)
  step = 1 if T * scale >= 24 else 2
  for x in range(0, ww, step):
    d.text((m + (x + 0.5) * T * scale, m / 2), str(wx + x), font=font, fill=(255, 230, 160, 255), anchor='mm')
  for y in range(0, wh, step):
    d.text((m / 2, m + (y + 0.5) * T * scale), str(wy + y), font=font, fill=(255, 230, 160, 255), anchor='mm')
  return out


def save_small(img: Image.Image, path: Path) -> Path:
  """Save compactly (pixel art quantizes well), so viewing it costs little."""
  q = img.convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
  q.save(path, 'PNG', optimize=True)
  return path


def window_around(m: W.Map, x, y, w=30, h=20):
  wx = max(0, min(m.w - w, x - w // 2))
  wy = max(0, min(m.h - h, y - h // 2))
  return [wx, wy, min(w, m.w), min(h, m.h)]


def window_for_area(m: W.Map, area, margin=3):
  ax, ay, aw, ah = area
  x0, y0 = max(0, ax - margin), max(0, ay - margin - 2)
  x1, y1 = min(m.w, ax + aw + margin), min(m.h, ay + ah + margin)
  return [x0, y0, x1 - x0, y1 - y0]


def distance(a, b):
  return math.hypot(a[0] - b[0], a[1] - b[1])
