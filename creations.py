"""Creations: what Möbians build in town, as the hub keeps them.

A creation is compiled by the builder's kit (forge/) into pictures and plain data
and sent here. The hub checks everything (every picture is decoded, every tile
must lie inside the creation's area, nothing may block a door or cover a game
table), stores it, and bumps the creations version `cv` that every town sees on
its next sync. Towns then fetch the small index and the bodies they need.

Who may build: anyone in town, unless the town keeper (the Möbian whose Möbius
hosts the town) switched building to keeper-only. A creation belongs to its
builder; the builder or the keeper may replace or remove it.

Build sites are the visible "construction sites" while a builder agent works;
they live in the world document (world['sites']) so every town sees progress.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import re
import secrets
import time

from world_meta import META

try:  # Pillow is a Möbius platform requirement; the hub decodes every picture it is sent.
  from PIL import Image
except ImportError:  # pragma: no cover - only on a broken install
  Image = None


# Every visitor's Agent Office is the same private map, so a build there would turn up in everyone's.
PRIVATE_BUILD = ('Your Agent Office is yours alone, so nothing is built in there: everyone would get it in their '
                 'office too. Step outside and build anywhere in town.')


class Problem(Exception):
  def __init__(self, message: str, status: int = 400):
    super().__init__(message)
    self.message = message
    self.status = status


def require(condition, message: str, status: int = 400):
  if not condition:
    raise Problem(message, status)


SCHEMA = """
CREATE TABLE IF NOT EXISTS creations (
  id TEXT PRIMARY KEY, rev INTEGER NOT NULL, map TEXT NOT NULL, area TEXT NOT NULL,
  handle TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL,
  created REAL NOT NULL, updated REAL NOT NULL, expires REAL,
  surprise TEXT NOT NULL DEFAULT '[]', game TEXT, bytes INTEGER NOT NULL,
  body TEXT NOT NULL, spec TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (handle TEXT PRIMARY KEY, name TEXT NOT NULL, seen REAL NOT NULL);
CREATE TABLE IF NOT EXISTS fired (
  creation TEXT NOT NULL, trig INTEGER NOT NULL, handle TEXT NOT NULL, at REAL NOT NULL,
  PRIMARY KEY (creation, trig, handle));
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""

VERSION = 1
POLICIES = ('everyone', 'keeper')
SITE_ACTIVE = ('planning', 'building')
SITE_STALE_SECONDS = 20 * 60      # a builder silent this long has stopped
SITE_LINGER_SECONDS = 90          # a finished site stays for the reveal
SITE_TEXT_LIMIT = 600
MAX_SITES_PER_PERSON = 3
MAX_SITES = 40

LIMITS = {
  'area': 40,              # tiles per side (the keeper may use up to 64)
  'area_keeper': 64,
  'per_person': 25,        # live creations per Möbian (the keeper is not limited)
  'per_hour': 12,          # creations started per Möbian per hour
  'art_bytes': 600_000,    # decoded picture bytes per creation
  'code_bytes': 120_000,   # court game cartridge source
  'body_bytes': 1_600_000,
  'spec_bytes': 1_200_000,
  'ground': 12, 'props': 300, 'frames': 8, 'solid': 1600, 'hide': 60, 'seats': 60, 'glows': 40,
  'labels': 8, 'uses': 24, 'triggers': 12, 'actions': 12, 'surprise': 10, 'who': 10,
  'expires_days': 30,
}

EFFECTS = ('confetti', 'fireworks', 'sparkles', 'hearts', 'balloons', 'bubbles', 'snow', 'petals', 'stars')
SOUNDS = ('fanfare', 'chime', 'win', 'sparkle', 'pop', 'coin', 'splash', 'whoosh', 'door', 'click', 'lose')
SONGS = ('disco', 'minstrel', 'flowerbed', 'tropical')
LIGHTS = ('dim', 'on', 'flash', 'party')
EMOTES = ('heart', 'wave', 'excl', 'q')
DIRS = ('up', 'down', 'left', 'right')
LAYERS = ('ground', 'normal', 'over')
FX = (None, 'sway', 'bob', 'twinkle')
HEX = re.compile(r'^#[0-9a-f]{6}$')
HANDLE = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')
ID = re.compile(r'^c[a-f0-9]{10}$')
SITE = re.compile(r'^s[a-f0-9]{8}$')
PNG_PREFIX = 'data:image/png;base64,'


def now_ms(now: float) -> int:
  return int(now * 1000)


def clean_text(value, limit: int) -> str:
  text = re.sub(r'[\x00-\x1f\x7f]', ' ', str(value or '')).strip()
  return re.sub(r'\s+', ' ', text)[:limit]


def setup(db):
  db.executescript(SCHEMA)


# --- Versions, settings, people --------------------------------------------------------------------

def creations_version(db) -> int:
  row = db.execute("SELECT v FROM counters WHERE k='cv'").fetchone()
  return row['v'] if row else 0


def bump(db):
  db.execute("INSERT INTO counters (k, v) VALUES ('cv', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1")


def setting(db, key, default=None):
  row = db.execute('SELECT v FROM settings WHERE k = ?', (key,)).fetchone()
  return json.loads(row['v']) if row else default


def set_setting(db, key, value):
  db.execute('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)', (key, json.dumps(value)))


def policy(db) -> str:
  value = setting(db, 'build_policy', 'everyone')
  return value if value in POLICIES else 'everyone'


def remember_person(db, handle: str, name: str, now: float):
  db.execute('INSERT INTO people (handle, name, seen) VALUES (?, ?, ?) ON CONFLICT(handle) DO UPDATE SET '
             'name = excluded.name, seen = excluded.seen', (handle, name, now))


def people(db, limit: int = 80) -> list[dict]:
  return [{'handle': r['handle'], 'name': r['name'], 'seen': now_ms(r['seen'])}
          for r in db.execute('SELECT * FROM people ORDER BY seen DESC LIMIT ?', (limit,))]


def name_of(db, handle: str) -> str:
  row = db.execute('SELECT name FROM people WHERE handle = ?', (handle,)).fetchone()
  return row['name'] if row else handle


# --- Validation ---------------------------------------------------------------------------------------

class Check:
  """Validates one compiled creation against the map it is built on."""

  def __init__(self, body, *, keeper: bool, now: float):
    self.keeper = keeper
    self.now = now
    self.art_bytes = 0
    require(isinstance(body, dict), 'A creation must be an object.')
    require(body.get('v') == VERSION, f'This town reads creation format {VERSION}; update your Möbius Town.')
    self.b = body
    mid = body.get('map')
    require(mid in META['maps'], 'Unknown place: build in `town` or one of its houses.')
    require(mid not in META.get('private', []), PRIVATE_BUILD)
    self.map = mid
    self.mw, self.mh = META['maps'][mid]['w'], META['maps'][mid]['h']
    self.protected = {tuple(t) for t in META.get('protected', {}).get(mid, [])}
    self.furniture = META.get('furniture', {}).get(mid, {})
    area = body.get('area')
    require(self.ints(area, 4), '`area` must be [x, y, w, h] in tiles.')
    x, y, w, h = area
    side = LIMITS['area_keeper'] if keeper else LIMITS['area']
    require(1 <= w <= side and 1 <= h <= side, f'An area is at most {side} x {side} tiles.')
    require(0 <= x and 0 <= y and x + w <= self.mw and y + h <= self.mh, 'The area must lie inside the map.')
    self.area = (x, y, w, h)

  # Small checks.
  @staticmethod
  def ints(value, n=None):
    return (isinstance(value, list) and (n is None or len(value) == n)
            and all(isinstance(v, int) and not isinstance(v, bool) for v in value))

  @staticmethod
  def num(value, lo, hi):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and lo <= value <= hi

  def in_area(self, tx, ty):
    x, y, w, h = self.area
    return x <= tx < x + w and y <= ty < y + h

  def tile(self, value, what):
    require(self.ints(value, 2), f'{what} must be a tile [x, y].')
    require(self.in_area(*value), f'{what} {value} is outside the creation\'s area {list(self.area)}.')
    return [value[0], value[1]]

  def px(self, x, y, what, up=6, side=2, down=1):
    """A pixel position near the area: tall things may rise `up` tiles above it."""
    ax, ay, aw, ah = self.area
    require(isinstance(x, int) and isinstance(y, int), f'{what} needs whole pixel coordinates.')
    require((ax - side) * 16 <= x <= (ax + aw + side) * 16 and (ay - up) * 16 <= y <= (ay + ah + down) * 16,
            f'{what} is drawn too far outside the creation\'s area.')

  def png(self, value, what, max_w, max_h):
    require(isinstance(value, str) and value.startswith(PNG_PREFIX), f'{what} must be a PNG picture.')
    try:
      raw = base64.b64decode(value[len(PNG_PREFIX):], validate=True)
    except (binascii.Error, ValueError):
      raise Problem(f'{what} is not valid picture data.')
    self.art_bytes += len(raw)
    require(self.art_bytes <= LIMITS['art_bytes'], 'The pictures in this creation are too large in total.')
    if Image is None:
      raise Problem('This town cannot check pictures right now.', 503)
    try:
      with Image.open(io.BytesIO(raw)) as img:
        require(img.format == 'PNG', f'{what} must be a PNG picture.')
        w, h = img.size
        require(1 <= w <= max_w and 1 <= h <= max_h, f'{what} is {w}x{h}; at most {max_w}x{max_h} is allowed.')
        img.load()
    except Problem:
      raise
    except Exception:
      raise Problem(f'{what} could not be read as a picture.')
    return value, (w, h)

  def text(self, value, limit, what, required=False):
    out = clean_text(value, limit)
    require(out or not required, f'{what} is missing.')
    return out

  def colour(self, value, what):
    v = str(value or '').strip().lower()
    require(HEX.match(v), f'{what} must be a colour like #ffd78a.')
    return v

  # Sections.
  def ground(self):
    items = self.b.get('ground') or []
    require(isinstance(items, list) and len(items) <= LIMITS['ground'], 'Too many ground pictures.')
    ax, ay, aw, ah = self.area
    out = []
    for i, g in enumerate(items):
      require(isinstance(g, dict), 'Each ground picture is an object.')
      self.px(g.get('x'), g.get('y'), f'ground picture {i + 1}', up=1, side=1)
      img, (w, h) = self.png(g.get('img'), f'ground picture {i + 1}', (aw + 2) * 16, (ah + 2) * 16)
      require(g['x'] + w <= (ax + aw + 1) * 16 and g['y'] + h <= (ay + ah + 1) * 16,
              f'ground picture {i + 1} reaches outside the creation\'s area.')
      out.append({'x': g['x'], 'y': g['y'], 'img': img})
    return out

  def props(self):
    items = self.b.get('props') or []
    require(isinstance(items, list) and len(items) <= LIMITS['props'], f'At most {LIMITS["props"]} props.')
    ax, ay, aw, ah = self.area
    out = []
    for i, p in enumerate(items):
      what = f'prop {i + 1}'
      require(isinstance(p, dict), f'{what} must be an object.')
      self.px(p.get('x'), p.get('y'), what)
      z = p.get('z')
      require(isinstance(z, int) and (ay - 1) * 16 <= z <= (ay + ah + 2) * 16, f'{what} has a bad sort line.')
      layer = p.get('layer', 'normal')
      require(layer in LAYERS, f'{what}: layer must be one of {", ".join(LAYERS)}.')
      frames = p.get('frames')
      require(isinstance(frames, list) and 1 <= len(frames) <= LIMITS['frames'], f'{what} needs 1-8 frames.')
      size = None
      for f in frames:
        img, s = self.png(f, what, 256, 384)
        require(size is None or s == size, f'{what}: every frame must have the same size.')
        size = s
      fps = p.get('fps', 0)
      require(self.num(fps, 0, 24), f'{what}: fps must be 0-24.')
      fx = p.get('fx')
      require(fx in FX, f'{what}: unknown motion "{fx}".')
      out.append({'x': p['x'], 'y': p['y'], 'z': z, 'layer': layer, 'frames': list(frames),
                  'fps': fps, 'fx': fx, 'w': size[0], 'h': size[1]})
    return out

  def solid(self):
    tiles = self.b.get('solid') or []
    require(isinstance(tiles, list) and len(tiles) <= LIMITS['solid'], 'Too many solid tiles.')
    out = []
    seen = set()
    for t in tiles:
      t = self.tile(t, 'A solid tile')
      require(tuple(t) not in self.protected,
              f'Tile {t} must stay clear (a door, a game table, a seat or something people use is there).')
      if tuple(t) not in seen:
        seen.add(tuple(t))
        out.append(t)
    return out

  def hide(self):
    keys = self.b.get('hide') or []
    require(isinstance(keys, list) and len(keys) <= LIMITS['hide'], 'Too much furniture hidden at once.')
    out = []
    for key in keys:
      require(isinstance(key, str) and key in self.furniture,
              f'"{key}" is not furniture that can be removed here (see `look`).')
      tiles = self.furniture[key]
      # Furniture in the area, or just beside it (a tree whose canopy hangs over it).
      ax, ay, aw, ah = self.area
      near = lambda x, y: ax - 3 <= x < ax + aw + 3 and ay - 3 <= y < ay + ah + 3  # noqa: E731
      require(not tiles or any(near(x, y) for x, y in tiles),
              f'"{key}" is too far outside the creation\'s area to remove.')
      if key not in out:
        out.append(key)
    return out

  def seats(self):
    items = self.b.get('seats') or []
    require(isinstance(items, list) and len(items) <= LIMITS['seats'], 'Too many seats.')
    out = []
    for s in items:
      require(isinstance(s, dict), 'Each seat is an object.')
      t = self.tile([s.get('x'), s.get('y')], 'A seat')
      require(s.get('face') in DIRS, 'A seat faces up, down, left or right.')
      ax, ay = s.get('ax', t[0] * 16 + 8), s.get('ay', t[1] * 16 + 12)
      require(isinstance(ax, int) and isinstance(ay, int) and abs(ax - (t[0] * 16 + 8)) <= 16
              and abs(ay - (t[1] * 16 + 8)) <= 16, 'A seat\'s feet position must be on its tile.')
      out.append({'x': t[0], 'y': t[1], 'face': s['face'], 'ax': ax, 'ay': ay})
    return out

  def glows(self):
    items = self.b.get('glows') or []
    require(isinstance(items, list) and len(items) <= LIMITS['glows'], 'Too many lights.')
    out = []
    for g in items:
      require(isinstance(g, dict), 'Each light is an object.')
      self.px(g.get('x'), g.get('y'), 'A light')
      require(self.num(g.get('radius'), 0.5, 8), 'A light\'s radius is 0.5-8 tiles.')
      out.append({'x': g['x'], 'y': g['y'], 'radius': g['radius'], 'colour': self.colour(g.get('colour'), 'A light'),
                  'flicker': bool(g.get('flicker'))})
    return out

  def mood(self):
    m = self.b.get('mood')
    if m is None:
      return None
    require(isinstance(m, dict), '`mood` is an object.')
    out = {}
    for k in ('brightness', 'warmth'):
      v = m.get(k, 0)
      require(self.num(v, -1, 1), f'mood.{k} is between -1 and 1.')
      out[k] = round(float(v), 3)
    out['tint'] = self.colour(m['tint'], 'mood.tint') if m.get('tint') else None
    return out

  def labels(self):
    items = self.b.get('labels') or []
    require(isinstance(items, list) and len(items) <= LIMITS['labels'], 'Too many labels.')
    out = []
    for lab in items:
      require(isinstance(lab, dict), 'Each label is an object.')
      self.px(lab.get('x'), lab.get('y'), 'A label', up=3)
      out.append({'x': lab['x'], 'y': lab['y'], 'text': self.text(lab.get('text'), 32, 'A label', True)})
    return out

  def actions(self, items, what):
    require(isinstance(items, list) and 1 <= len(items) <= LIMITS['actions'], f'{what}: 1-{LIMITS["actions"]} actions.')
    out = []
    for a in items:
      require(isinstance(a, dict) and len(a) >= 1, f'{what}: each action is an object.')
      if 'say' in a:
        out.append({'say': self.text(a['say'], 400, f'{what}: say', True), 'title': self.text(a.get('title'), 60, 'title')})
      elif 'banner' in a:
        b = {'banner': self.text(a['banner'], 40, f'{what}: banner', True), 'sub': self.text(a.get('sub'), 80, 'sub')}
        if a.get('focus') is not None:
          require(self.ints(a['focus'], 2), f'{what}: banner focus is a tile [x, y].')
          b['focus'] = a['focus']
        secs = a.get('seconds', 6)
        require(self.num(secs, 2, 12), f'{what}: a banner lasts 2-12 seconds.')
        b['seconds'] = secs
        out.append(b)
      elif 'effect' in a:
        require(a['effect'] in EFFECTS, f'{what}: effect is one of {", ".join(EFFECTS)}.')
        e = {'effect': a['effect'], 'seconds': a.get('seconds', 4)}
        require(self.num(e['seconds'], 1, 15), f'{what}: an effect lasts 1-15 seconds.')
        if a.get('at') is not None:
          require(self.ints(a['at'], 2), f'{what}: effect `at` is a tile [x, y].')
          e['at'] = a['at']
        out.append(e)
      elif 'sound' in a:
        require(a['sound'] in SOUNDS, f'{what}: sound is one of {", ".join(SOUNDS)}.')
        out.append({'sound': a['sound']})
      elif 'music' in a:
        require(a['music'] in SONGS, f'{what}: music is one of {", ".join(SONGS)}.')
        secs = a.get('seconds', 60)
        require(self.num(secs, 5, 300), f'{what}: music plays 5-300 seconds.')
        out.append({'music': a['music'], 'seconds': secs})
      elif 'lights' in a:
        require(a['lights'] in LIGHTS, f'{what}: lights is one of {", ".join(LIGHTS)}.')
        secs = a.get('seconds', 6)
        require(self.num(secs, 1, 60), f'{what}: lights last 1-60 seconds.')
        out.append({'lights': a['lights'], 'seconds': secs})
      elif 'reveal' in a:
        out.append({'reveal': True})
      elif 'emote' in a:
        require(a['emote'] in EMOTES, f'{what}: emote is one of {", ".join(EMOTES)}.')
        out.append({'emote': a['emote']})
      elif 'wait' in a:
        require(self.num(a['wait'], 0.1, 10), f'{what}: wait is 0.1-10 seconds.')
        out.append({'wait': a['wait']})
      else:
        raise Problem(f'{what}: unknown action {sorted(a)[0]!r}.')
    return out

  def uses(self):
    items = self.b.get('uses') or []
    require(isinstance(items, list) and len(items) <= LIMITS['uses'], 'Too many interactions.')
    out = []
    for i, u in enumerate(items):
      what = f'interaction {i + 1}'
      require(isinstance(u, dict), f'{what} must be an object.')
      tiles = u.get('tiles')
      require(isinstance(tiles, list) and 1 <= len(tiles) <= 24, f'{what} needs 1-24 tiles.')
      out.append({'tiles': [self.tile(t, f'{what}: tile') for t in tiles],
                  'prompt': self.text(u.get('prompt'), 40, f'{what}: prompt', True),
                  'do': self.actions(u.get('do'), what)})
    return out

  def who(self, value, what):
    if value in (None, 'anyone'):
      return 'anyone'
    require(isinstance(value, list) and 1 <= len(value) <= LIMITS['who'], f'{what}: who is "anyone" or 1-10 Möbians.')
    out = []
    for v in value:
      v = clean_text(v, 64)
      require(v, f'{what}: an empty name in who.')
      out.append(v.lower())
    return out

  def triggers(self):
    items = self.b.get('triggers') or []
    require(isinstance(items, list) and len(items) <= LIMITS['triggers'], 'Too many triggers.')
    out = []
    for i, t in enumerate(items):
      what = f'trigger {i + 1}'
      require(isinstance(t, dict), f'{what} must be an object.')
      when = t.get('when', 'enter')
      require(when in ('enter', 'near'), f'{what}: when is "enter" or "near".')
      trig = {'when': when, 'who': self.who(t.get('who'), what)}
      if when == 'enter':
        where = t.get('where', 'room')
        if where not in ('room', 'map'):
          require(self.ints(where, 4), f'{what}: where is "room", "map" or [x, y, w, h].')
          x, y, w, h = where
          require(w >= 1 and h >= 1 and 0 <= x and 0 <= y and x + w <= self.mw and y + h <= self.mh,
                  f'{what}: where must lie inside the map.')
        trig['where'] = where
      else:
        trig['at'] = self.tile(t.get('at'), f'{what}: at')
        r = t.get('radius', 2)
        require(self.num(r, 1, 10), f'{what}: radius is 1-10 tiles.')
        trig['radius'] = r
      once = t.get('once', 'per_person')
      require(once in ('per_person', 'ever', 'always'), f'{what}: once is per_person, ever or always.')
      trig['once'] = once
      trig['everyone_sees'] = bool(t.get('everyone_sees'))
      for k in ('from', 'until'):
        v = t.get(k)
        if v is not None:
          require(isinstance(v, int) and v > 0, f'{what}: {k} is a time in milliseconds.')
          trig[k] = v
      trig['do'] = self.actions(t.get('do'), what)
      out.append(trig)
    return out

  def surprise(self):
    items = self.b.get('surprise_for') or []
    require(isinstance(items, list) and len(items) <= LIMITS['surprise'], 'surprise_for lists at most 10 Möbians.')
    return [clean_text(v, 64).lower() for v in items if clean_text(v, 64)]

  def music(self):
    m = self.b.get('music')
    if m is None:
      return None
    require(isinstance(m, dict) and m.get('song') in SONGS, f'music.song is one of {", ".join(SONGS)}.')
    self.px(m.get('x'), m.get('y'), 'The music')
    r = m.get('radius', 6)
    require(self.num(r, 2, 12), 'music.radius is 2-12 tiles.')
    return {'song': m['song'], 'x': m['x'], 'y': m['y'], 'radius': r}

  def game(self):
    g = self.b.get('game')
    if g is None:
      return None
    require(isinstance(g, dict), '`game` is an object.')
    cart = g.get('cartridge')
    require(isinstance(cart, dict) and isinstance(cart.get('code'), str), 'The game needs its cartridge code.')
    code = cart['code']
    require(0 < len(code.encode()) <= LIMITS['code_bytes'], 'The game\'s code is too large.')
    cid = clean_text(cart.get('id'), 32)
    require(re.fullmatch(r'[a-z0-9-]{1,32}', cid or ''), 'The game needs an id.')
    court = g.get('court')
    require(self.ints(court, 4), 'game.court is [x, y, w, h].')
    x, y, w, h = court
    require(w >= 4 and h >= 3 and self.in_area(x, y) and self.in_area(x + w - 1, y + h - 1),
            'The court must lie inside the creation\'s area and be at least 4 x 3 tiles.')
    options = g.get('options') or {}
    require(isinstance(options, dict) and len(options) <= 16
            and all(isinstance(k, str) and isinstance(v, (int, float, str, bool)) for k, v in options.items()),
            'game.options holds up to 16 simple values.')
    meta = g.get('meta')
    require(isinstance(meta, dict), 'The game needs its meta.')
    teams = meta.get('teams')
    require(isinstance(teams, list) and len(teams) == 2
            and all(isinstance(t, dict) and re.fullmatch(r'[a-z]{1,8}', str(t.get('id', ''))) for t in teams)
            and teams[0]['id'] != teams[1]['id'], 'A court game has exactly two teams.')
    per = meta.get('perTeam')
    require(isinstance(per, int) and 1 <= per <= 4, 'perTeam is 1-4.')
    dur = meta.get('durationSeconds')
    require(isinstance(dur, (int, float)) and 10 <= dur <= 900, 'durationSeconds is 10-900.')
    lobby = meta.get('lobbySeconds', 6)
    require(isinstance(lobby, (int, float)) and 3 <= lobby <= 20, 'lobbySeconds is 3-20.')
    buttons = meta.get('buttons') or []
    require(isinstance(buttons, list) and len(buttons) <= 2, 'A game has at most two buttons.')
    clean_meta = {
      'id': cid, 'title': self.text(meta.get('title'), 40, 'game title', True),
      'teams': [{'id': t['id'], 'name': self.text(t.get('name') or t['id'], 16, 'team name', True)} for t in teams],
      'perTeam': per, 'durationSeconds': dur, 'lobbySeconds': lobby,
      'buttons': [{'id': b.get('id'), 'label': self.text(b.get('label'), 12, 'button label', True)} for b in buttons
                  if isinstance(b, dict) and b.get('id') in ('a', 'b')],
      'controls': self.text(meta.get('controls'), 120, 'controls'),
    }
    digest = hashlib.sha256(code.encode()).hexdigest()[:16]
    return {'cartridge': {'id': cid, 'code': code, 'hash': digest}, 'court': court, 'options': options,
            'meta': clean_meta}

  def expires(self):
    v = self.b.get('expires')
    if v is None:
      return None
    require(isinstance(v, int) and now_ms(self.now) < v <= now_ms(self.now) + LIMITS['expires_days'] * 86_400_000,
            f'expires must be in the next {LIMITS["expires_days"]} days.')
    return v

  def run(self):
    b = self.b
    out = {
      'v': VERSION, 'map': self.map, 'area': list(self.area),
      'title': self.text(b.get('title'), 60, '`title`', True), 'note': self.text(b.get('note'), 200, 'note'),
      'ground': self.ground(), 'props': self.props(), 'solid': self.solid(), 'hide': self.hide(),
      'seats': self.seats(), 'glows': self.glows(), 'mood': self.mood(), 'labels': self.labels(),
      'uses': self.uses(), 'triggers': self.triggers(), 'surprise_for': self.surprise(), 'music': self.music(),
      'game': self.game(), 'expires': self.expires(),
    }
    require(len(json.dumps(out, separators=(',', ':'))) <= LIMITS['body_bytes'], 'This creation is too large.')
    return out


def validate(body, *, keeper=False, now=None) -> dict:
  """The cleaned creation, or Problem explaining the first thing that is wrong."""
  return Check(body, keeper=keeper, now=now or time.time()).run()


def overlaps(a, b) -> bool:
  ax, ay, aw, ah = a
  bx, by, bw, bh = b
  return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


# --- Storing ------------------------------------------------------------------------------------------

def row_dict(row) -> dict:
  return dict(row) if row is not None else None


def put(db, *, handle: str, name: str, keeper: bool, body: dict, spec, replace: str | None, now: float) -> dict:
  """Store a validated creation (new, or replacing one the builder owns). Returns {id, rev}."""
  require(HANDLE.match(handle or ''), 'Invalid Möbius handle.', 403)
  require(keeper or policy(db) == 'everyone', 'The town keeper has paused building for now.', 403)
  clean = validate(body, keeper=keeper, now=now)
  spec_text = json.dumps(spec if spec is not None else {}, separators=(',', ':'))
  require(len(spec_text) <= LIMITS['spec_bytes'], 'The source spec is too large to keep.')
  old = None
  if replace:
    require(ID.match(replace), 'Unknown creation.')
    old = row_dict(db.execute('SELECT * FROM creations WHERE id = ?', (replace,)).fetchone())
    require(old is not None, 'That creation no longer exists.', 404)
    require(keeper or old['handle'] == handle, 'Only its builder or the town keeper can change that creation.', 403)
  else:
    if not keeper:
      mine = db.execute('SELECT COUNT(*) AS n FROM creations WHERE handle = ?', (handle,)).fetchone()['n']
      require(mine < LIMITS['per_person'], f'You already have {mine} creations in town. Remove one first.', 429)
      recent = db.execute('SELECT COUNT(*) AS n FROM creations WHERE handle = ? AND created > ?',
                          (handle, now - 3600)).fetchone()['n']
      require(recent < LIMITS['per_hour'], 'You have built a lot this hour. Give the town a moment.', 429)
  # Keep clear of other people's creations, unless the keeper says so.
  if not keeper:
    for r in db.execute('SELECT id, area, handle, title FROM creations WHERE map = ?', (clean['map'],)):
      if r['id'] == replace or r['handle'] == handle:
        continue
      require(not overlaps(clean['area'], json.loads(r['area'])),
              f'That spot overlaps "{r["title"]}", which another Möbian built. Pick a free spot nearby.', 409)
  cid = old['id'] if old else 'c' + secrets.token_hex(5)
  rev = (old['rev'] + 1) if old else 1
  owner_handle, owner_name = (old['handle'], old['name']) if old else (handle, name)
  game = clean['game']
  game_info = None
  if game:
    m = game['meta']
    game_info = {'court': game['court'], 'teams': [t['id'] for t in m['teams']], 'perTeam': m['perTeam'],
                 'durationSeconds': m['durationSeconds'], 'lobbySeconds': m['lobbySeconds'], 'title': m['title']}
  created = old['created'] if old else now
  expires = clean['expires'] / 1000 if clean['expires'] else None
  text = json.dumps(clean, separators=(',', ':'))
  db.execute('INSERT OR REPLACE INTO creations (id, rev, map, area, handle, name, title, created, updated, expires, '
             'surprise, game, bytes, body, spec) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
             (cid, rev, clean['map'], json.dumps(clean['area']), owner_handle, owner_name, clean['title'], created, now,
              expires, json.dumps(clean['surprise_for']), json.dumps(game_info) if game_info else None, len(text),
              text, spec_text))
  if old:
    # A changed creation may have changed its triggers: they fire afresh.
    db.execute('DELETE FROM fired WHERE creation = ?', (cid,))
  bump(db)
  return {'id': cid, 'rev': rev, 'title': clean['title'], 'note': clean['note'], 'map': clean['map'],
          'area': clean['area']}


def remove(db, *, handle: str, keeper: bool, cid: str) -> dict:
  require(isinstance(cid, str) and ID.match(cid), 'Unknown creation.')
  row = db.execute('SELECT handle, title FROM creations WHERE id = ?', (cid,)).fetchone()
  require(row is not None, 'That creation no longer exists.', 404)
  require(keeper or row['handle'] == handle, 'Only its builder or the town keeper can remove that.', 403)
  db.execute('DELETE FROM creations WHERE id = ?', (cid,))
  db.execute('DELETE FROM fired WHERE creation = ?', (cid,))
  bump(db)
  return {'removed': cid, 'title': row['title']}


def expire(db, now: float) -> int:
  gone = [r['id'] for r in db.execute('SELECT id FROM creations WHERE expires IS NOT NULL AND expires < ?', (now,))]
  for cid in gone:
    db.execute('DELETE FROM creations WHERE id = ?', (cid,))
    db.execute('DELETE FROM fired WHERE creation = ?', (cid,))
  if gone:
    bump(db)
  return len(gone)


# --- Reading (per viewer) -------------------------------------------------------------------------------

def _targets(surprise_json) -> list[str]:
  return [s.lstrip('@') for s in json.loads(surprise_json or '[]')]


def _is_target(targets, handle, name) -> bool:
  return bool(targets) and ((handle or '').lower() in targets or (name or '').lower() in targets)


def fired_for(db, handle: str) -> dict[str, list[int]]:
  out: dict[str, list[int]] = {}
  for r in db.execute("SELECT creation, trig FROM fired WHERE handle = ? OR handle = '*'", (handle,)):
    out.setdefault(r['creation'], []).append(r['trig'])
  return out


def index(db, handle: str, name: str) -> list[dict]:
  """Every creation in town, as `handle` may see it: surprises for them stay masked until revealed."""
  fired = fired_for(db, handle)
  out = []
  for r in db.execute('SELECT id, rev, map, area, handle, name, title, updated, expires, surprise, game '
                      'FROM creations ORDER BY created'):
    masked = _is_target(_targets(r['surprise']), handle, name) and not fired.get(r['id'])
    game = json.loads(r['game']) if r['game'] else None
    out.append({
      'id': r['id'], 'rev': r['rev'], 'map': r['map'], 'area': json.loads(r['area']),
      'title': 'A surprise' if masked else r['title'],
      'by': {'handle': r['handle'], 'name': r['name']}, 'updated': now_ms(r['updated']),
      'expires': now_ms(r['expires']) if r['expires'] else None, 'masked': masked,
      'game': ({'court': game['court'], 'title': game['title']} if game else None),
      'fired': fired.get(r['id'], []),
    })
  return out


def bodies(db, ids, handle: str, name: str, limit_bytes: int = 3_000_000) -> dict:
  """Creation bodies by id (only those that exist), stopping before `limit_bytes`."""
  require(isinstance(ids, list) and len(ids) <= 80, 'Ask for at most 80 creations at once.')
  out, total, more = {}, 0, []
  for cid in ids:
    if not isinstance(cid, str) or not ID.match(cid):
      continue
    r = db.execute('SELECT rev, body, bytes FROM creations WHERE id = ?', (cid,)).fetchone()
    if r is None:
      continue
    if out and total + r['bytes'] > limit_bytes:
      more.append(cid)
      continue
    total += r['bytes']
    out[cid] = {'rev': r['rev'], 'body': json.loads(r['body'])}
  return {'bodies': out, 'more': more}


def spec_of(db, cid: str, handle: str, keeper: bool) -> dict:
  require(isinstance(cid, str) and ID.match(cid), 'Unknown creation.')
  r = db.execute('SELECT handle, rev, spec, title FROM creations WHERE id = ?', (cid,)).fetchone()
  require(r is not None, 'That creation no longer exists.', 404)
  require(keeper or r['handle'] == handle, 'Only its builder or the town keeper can change that creation.', 403)
  return {'id': cid, 'rev': r['rev'], 'title': r['title'], 'spec': json.loads(r['spec'])}


def fire(db, *, cid: str, trig: int, handle: str, name: str, now: float) -> dict:
  """Record that a trigger fired for `handle`. Returns whether it should run now (first time)."""
  require(isinstance(cid, str) and ID.match(cid) and isinstance(trig, int) and 0 <= trig < 64, 'Unknown trigger.')
  r = db.execute('SELECT body FROM creations WHERE id = ?', (cid,)).fetchone()
  require(r is not None, 'That creation no longer exists.', 404)
  triggers = json.loads(r['body']).get('triggers') or []
  require(trig < len(triggers), 'Unknown trigger.')
  t = triggers[trig]
  who = t['who']
  require(who == 'anyone' or handle.lower() in [w.lstrip('@') for w in who] or name.lower() in who,
          'That surprise is for someone else.', 403)
  if t['once'] == 'always':
    return {'run': True}
  key = '*' if t['once'] == 'ever' else handle
  if db.execute('SELECT 1 FROM fired WHERE creation = ? AND trig = ? AND handle = ?', (cid, trig, key)).fetchone():
    return {'run': False}
  db.execute('INSERT INTO fired (creation, trig, handle, at) VALUES (?,?,?,?)', (cid, trig, key, now))
  bump(db)
  return {'run': True}


def game_courts(db) -> dict:
  """Creation id -> its court game facts, for the hub's court lobbies."""
  return {r['id']: {**json.loads(r['game']), 'map': r['map']}
          for r in db.execute('SELECT id, map, game FROM creations WHERE game IS NOT NULL')}


def list_brief(db) -> list[dict]:
  return [{'id': r['id'], 'title': r['title'], 'map': r['map'], 'area': json.loads(r['area']),
           'by': r['handle'], 'updated': now_ms(r['updated'])}
          for r in db.execute('SELECT id, title, map, area, handle, updated FROM creations ORDER BY updated DESC')]


# --- Build sites ------------------------------------------------------------------------------------------

def new_site_id() -> str:
  return 's' + secrets.token_hex(4)


def site_begin(world, *, handle, name, pid, keeper, map_id, x, y, direction, text, now, pol) -> dict:
  require(keeper or pol == 'everyone', 'The town keeper has paused building for now.', 403)
  text = clean_text(text, SITE_TEXT_LIMIT)
  require(len(text) >= 3, 'Say what you would like to build.')
  require(map_id in META['maps'], 'Unknown place.')
  require(map_id not in META.get('private', []), PRIVATE_BUILD, 403)
  sites = world.setdefault('sites', {})
  mine = [s for s in sites.values() if s['handle'] == handle and s['status'] in SITE_ACTIVE]
  require(len(mine) < MAX_SITES_PER_PERSON, 'You have three builds going already. Let one finish first.', 429)
  require(len(sites) < MAX_SITES, 'The town is very busy building. Try again in a minute.', 429)
  sid = new_site_id()
  sites[sid] = {
    'id': sid, 'handle': handle, 'name': name, 'pid': pid, 'map': map_id, 'x': x, 'y': y, 'dir': direction,
    'area': None, 'text': text[:160], 'label': 'Planning…', 'pct': 0, 'eta': None, 'status': 'planning',
    'started': now_ms(now), 'updated': now_ms(now), 'creation': None, 'chat': None, 'replace': None,
  }
  return sites[sid]


def site_of(world, sid, handle, keeper):
  require(isinstance(sid, str) and SITE.match(sid), 'Unknown build site.')
  site = world.get('sites', {}).get(sid)
  require(site is not None, 'That build site has closed. Start a new build from the town.', 404)
  require(keeper or site['handle'] == handle, 'That build belongs to someone else.', 403)
  return site


def site_update(world, *, sid, handle, keeper, body, now) -> dict:
  site = site_of(world, sid, handle, keeper)
  # A finished site reopens while its builder keeps refining the creation.
  require(site['status'] in SITE_ACTIVE or site['status'] == 'done', 'That build was stopped. Start a new one.')
  label = clean_text(body.get('label'), 80)
  if label:
    site['label'] = label
  pct = body.get('pct')
  if isinstance(pct, (int, float)) and not isinstance(pct, bool):
    site['pct'] = max(0, min(99, int(pct)))
  eta = body.get('eta')
  if isinstance(eta, (int, float)) and not isinstance(eta, bool) and 0 < eta <= 3600:
    site['eta'] = now_ms(now) + int(eta * 1000)
  area = body.get('area')
  if area is not None:
    require(Check.ints(area, 4), 'area is [x, y, w, h].')
    dims = META['maps'][site['map']]
    x, y, w, h = area
    require(1 <= w <= LIMITS['area_keeper'] and 1 <= h <= LIMITS['area_keeper'] and 0 <= x and 0 <= y
            and x + w <= dims['w'] and y + h <= dims['h'], 'The area must lie inside the map.')
    site['area'] = area
  site['status'] = 'building'
  site['updated'] = now_ms(now)
  return site


def site_finish(world, *, sid, status, now, creation=None, message=None, area=None):
  site = world.get('sites', {}).get(sid)
  if site is None:
    return None
  site['status'] = status
  site['updated'] = now_ms(now)
  if creation:
    site['creation'] = creation
    site['pct'] = 100
  if area:
    site['area'] = area
  if message:
    site['label'] = clean_text(message, 120)
  return site


def sites_housekeeping(world, now):
  sites = world.setdefault('sites', {})
  t = now_ms(now)
  for sid in list(sites):
    s = sites[sid]
    if s['status'] in SITE_ACTIVE and t - s['updated'] > SITE_STALE_SECONDS * 1000:
      s.update({'status': 'failed', 'label': 'The builder stopped before finishing.', 'updated': t})
    elif s['status'] not in SITE_ACTIVE and t - s['updated'] > SITE_LINGER_SECONDS * 1000:
      del sites[sid]
