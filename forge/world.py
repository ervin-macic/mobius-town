"""The town as the builder's kit sees it: maps, furniture, atlas sprites (from engine/world.gen.js)."""
from __future__ import annotations

import base64
import io
import json
from functools import lru_cache
from pathlib import Path

from PIL import Image

APP = Path(__file__).resolve().parent.parent
T = 16


def _data_image(url: str) -> Image.Image:
  return Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')


@lru_cache(maxsize=1)
def world() -> dict:
  text = (APP / 'engine' / 'world.gen.js').read_text()
  return json.loads(text[text.index('{'):text.rindex('}') + 1])


@lru_cache(maxsize=1)
def atlas() -> Image.Image:
  return _data_image(world()['atlas'])


@lru_cache(maxsize=64)
def sprite(name: str, frame: int = 0) -> Image.Image | None:
  s = world()['sprites'].get(name)
  if not s:
    return None
  x, y, w, h = s['f'][min(frame, len(s['f']) - 1)]
  return atlas().crop((x, y, x + w, y + h))


def sprite_names() -> list[str]:
  hidden = {'bubble_talk', 'bubble_dots', 'bubble_excl', 'bubble_q', 'heart_spin', 'heart_big', 'fire'}
  return sorted(n for n in world()['sprites'] if n not in hidden)


class Map:
  """One map: size, walls, rooms, doors, furniture and what may not be blocked."""

  def __init__(self, mid: str):
    raw = world()['maps'].get(mid)
    if raw is None:
      raise KeyError(mid)
    self.id, self.name, self.w, self.h = mid, raw['name'], raw['w'], raw['h']
    self.outdoor = raw['outdoor']
    self.raw = raw
    self.solid = [ord(c) - 48 for c in raw['solid']]
    self.protected = [c == '1' for c in raw.get('protected', '0' * (self.w * self.h))]
    self.room_of = [ord(c) - 97 for c in raw['roomGrid']]
    self.rooms = raw['rooms']
    self.doors = raw['doors']
    self.objects = raw['objects']
    self.labels = raw.get('labels', [])
    # Entities: [sprite, x, y, z, owned tiles, protected, key].
    self.ents = raw['ents']
    self.seats = {(o['x'], o['y']): o for o in self.objects if o['kind'] == 'seat'}
    self.decor = raw.get('decor', [])

  def ground(self) -> Image.Image:
    if not hasattr(self, '_ground'):
      self._ground = _data_image(self.raw['ground'])
    return self._ground

  def inside(self, x, y):
    return 0 <= x < self.w and 0 <= y < self.h

  def kind(self, x, y):
    """0 floor, 1 wall/prop, 2 door."""
    return self.solid[y * self.w + x] if self.inside(x, y) else 1

  def is_protected(self, x, y):
    return self.inside(x, y) and self.protected[y * self.w + x]

  def room(self, x, y):
    if not self.inside(x, y):
      return self.rooms[0]
    i = self.room_of[y * self.w + x]
    return self.rooms[i] if 0 <= i < len(self.rooms) else self.rooms[0]

  def furniture(self, hidden=()):
    """Entities a builder may hide: key -> (sprite, tiles)."""
    out = {}
    for e in self.ents:
      sid, x, y, z, tiles, prot, key = e
      if not prot and key not in hidden:
        out[key] = (sid, [tuple(t) for t in tiles])
    return out

  def ent_by_key(self):
    return {e[6]: e for e in self.ents}


def map_ids() -> list[str]:
  return list(world()['maps'])
