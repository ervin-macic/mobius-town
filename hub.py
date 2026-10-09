"""Möbius Town hub: the shared world's state, kept by one installation.

Pure state logic over SQLite so it can be tested without HTTP. The service
(service.py) authenticates callers and passes a player id (`pid`) in.

- Sessions: other installations exchange an identity proof for a session token.
- Presence: who is online, where they stand and how they look.
- Mailbox: small directed messages (WebRTC signalling, knocks, chat fallback).
- World: one versioned document with room locks, conversation bubbles, the
  cinema TV, table games, the town chat, scheduled events and party
  challenges. Clients refetch it only when the version changes. Parties hold
  secrets (the Quick Draw moment, hidden picks), so a client never receives
  the stored world: world_for() swaps them for that viewer's own party view.

Movement is client-authoritative (it is a social space); anything shared and
contested (locks, games) is decided here.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import secrets
import sqlite3
import time

import chess_rules
import connect4_rules
import party as party_rules
from world_meta import META

ONLINE_SECONDS = 15
PURGE_SECONDS = 120
MAIL_TTL = 90
MAX_OUT = 40
MAX_MAIL_BYTES = 64 * 1024
LOCK_EMPTY_SECONDS = 15
ABANDON_SECONDS = 30
FEED_KEEP = 60
SESSION_SECONDS = 12 * 3600
MAIL_KINDS = {'rtc', 'call', 'chat', 'knock', 'emote', 'nudge', 'admit'}
DIRS = {'up', 'down', 'left', 'right'}
# `body` picks the character (0 male, 1 female); the rest index colour palettes.
LOOK_RANGES = {'body': 2, 'skin': 5, 'hair': 8, 'shirt': 10, 'pants': 6}
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
HANDLE = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')


class Problem(Exception):
  def __init__(self, message: str, status: int = 400):
    super().__init__(message)
    self.message = message
    self.status = status


def require(condition, message: str, status: int = 400):
  if not condition:
    raise Problem(message, status)


def now_s() -> float:
  return time.time()


def ms(t: float) -> int:
  return int(t * 1000)


# --- Storage -------------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, pid TEXT NOT NULL, handle TEXT NOT NULL, host TEXT NOT NULL,
  cid TEXT NOT NULL, created REAL NOT NULL, seen REAL NOT NULL);
CREATE TABLE IF NOT EXISTS presence (
  pid TEXT PRIMARY KEY, handle TEXT NOT NULL, host TEXT NOT NULL, cid TEXT NOT NULL,
  name TEXT NOT NULL, look TEXT NOT NULL, map TEXT NOT NULL, room TEXT NOT NULL,
  x INTEGER NOT NULL, y INTEGER NOT NULL, dir TEXT NOT NULL, status TEXT NOT NULL,
  muted INTEGER NOT NULL, video INTEGER NOT NULL, av INTEGER NOT NULL DEFAULT 0, joined REAL NOT NULL, seen REAL NOT NULL,
  map_since REAL NOT NULL, last_game REAL NOT NULL DEFAULT 0, chat_at REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT, to_pid TEXT NOT NULL, from_pid TEXT NOT NULL,
  k TEXT NOT NULL, v TEXT NOT NULL, created REAL NOT NULL);
CREATE INDEX IF NOT EXISTS mail_to ON mail(to_pid, id);
CREATE TABLE IF NOT EXISTS world (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
"""

WORLD_KEYS = ('locks', 'bubbles', 'tv', 'games', 'feed', 'events', 'invites', 'parties', 'pitch')
BOT_LEVELS = ('easy', 'medium', 'hard')
EVENT_KINDS = ('talks', 'meetup', 'games')
EVENT_PLACES = ('stage', 'plaza', 'cafe', 'cinema', 'garden', 'meet-a', 'meet-b')
TALK_SECONDS = 5 * 60
TALK_OVERTIME_SECONDS = 120
MAX_EVENTS = 30
MAX_SLOTS = 12
INVITE_SECONDS = 30
DECLINED_SECONDS = 8
PARTY_AWAY_SECONDS = 30
PITCH_SLOTS = ('red0', 'red1', 'blue0', 'blue1')
PITCH_LOBBY_SECONDS = 6
PITCH_MATCH_SECONDS = 180
PITCH_STALE_SECONDS = 180 + 300  # a match its host never finishes is cleared after this long


def connect(path) -> sqlite3.Connection:
  db = sqlite3.connect(str(path), timeout=10, isolation_level=None)
  db.row_factory = sqlite3.Row
  db.execute('PRAGMA journal_mode=WAL')
  db.execute('PRAGMA synchronous=NORMAL')
  db.execute('PRAGMA busy_timeout=10000')
  db.executescript(SCHEMA)
  return db


class Tx:
  """BEGIN IMMEDIATE ... COMMIT, so read-modify-write of the world is atomic."""

  def __init__(self, db):
    self.db = db

  def __enter__(self):
    self.db.execute('BEGIN IMMEDIATE')
    return self.db

  def __exit__(self, exc_type, exc, tb):
    self.db.execute('ROLLBACK' if exc_type else 'COMMIT')
    return False


def world_version(db) -> int:
  row = db.execute("SELECT v FROM counters WHERE k='wv'").fetchone()
  return row['v'] if row else 0


def load_world(db) -> dict:
  world = {k: ([] if k in ('feed', 'events') else {}) for k in WORLD_KEYS}
  world['pitch'] = new_pitch()
  for row in db.execute('SELECT k, v FROM world'):
    if row['k'] in world:
      world[row['k']] = json.loads(row['v'])
  return world


def save_world(db, before: dict, after: dict) -> bool:
  changed = False
  for k in WORLD_KEYS:
    if before.get(k) != after.get(k):
      db.execute('INSERT OR REPLACE INTO world (k, v) VALUES (?, ?)', (k, json.dumps(after[k], separators=(',', ':'))))
      changed = True
  if changed:
    db.execute("INSERT INTO counters (k, v) VALUES ('wv', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1")
  return changed


def copy(doc):
  return json.loads(json.dumps(doc))


# --- Validation --------------------------------------------------------------------------------

def clean_text(value, limit: int) -> str:
  text = re.sub(r'[\x00-\x1f\x7f]', ' ', str(value or '')).strip()
  return re.sub(r'\s+', ' ', text)[:limit]


def clean_name(value, fallback: str) -> str:
  return clean_text(value, 24) or fallback


def clean_look(value) -> dict:
  look = {}
  for key, size in LOOK_RANGES.items():
    v = value.get(key) if isinstance(value, dict) else None
    look[key] = v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < size else 0
  return look


def clean_state(value) -> dict:
  require(isinstance(value, dict), 'Missing player state.')
  map_id = value.get('map')
  require(map_id in META['maps'], 'Unknown place.')
  dims = META['maps'][map_id]
  x, y = value.get('x'), value.get('y')
  require(isinstance(x, int) and isinstance(y, int) and 0 <= x < dims['w'] and 0 <= y < dims['h'],
          'Position is outside the map.')
  room = value.get('room')
  require(room in META['rooms'][map_id], 'Unknown room.')
  direction = value.get('dir') if value.get('dir') in DIRS else 'down'
  return {
    'map': map_id, 'room': room, 'x': x, 'y': y, 'dir': direction,
    'status': clean_text(value.get('status'), 40),
    'muted': 1 if value.get('muted') else 0,
    'video': 1 if value.get('video') else 0,
    'av': 1 if value.get('av') else 0,
  }


# --- Sessions and identity ------------------------------------------------------------------------

def token_hash(token: str) -> str:
  return hashlib.sha256(token.encode()).hexdigest()


def assign_pid(db, handle: str, cid: str, now: float) -> str:
  """One avatar per device: a reload keeps its pid, a second device gets handle~2."""
  require(HANDLE.match(handle), 'Invalid Möbius handle.', 403)
  rows = {r['pid']: r for r in db.execute(
    "SELECT pid, cid, seen FROM presence WHERE handle = ?", (handle,))}
  for pid, row in rows.items():
    if row['cid'] == cid:
      return pid
  for n in range(1, 10):
    pid = handle if n == 1 else f'{handle}~{n}'
    row = rows.get(pid)
    if row is None or now - row['seen'] > ONLINE_SECONDS:
      return pid
  raise Problem('Too many windows are open in Möbius Town for this account.', 429)


def open_session(db, handle: str, host: str, cid: str, now: float | None = None) -> tuple[str, str]:
  now = now or now_s()
  require(isinstance(cid, str) and re.fullmatch(r'[A-Za-z0-9_-]{8,64}', cid), 'Invalid client id.')
  with Tx(db):
    db.execute('DELETE FROM sessions WHERE seen < ?', (now - SESSION_SECONDS,))
    pid = assign_pid(db, handle, cid, now)
    token = secrets.token_urlsafe(32)
    db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)', (token_hash(token), pid, handle, host, cid, now, now))
  return token, pid


def session_for(db, token: str, now: float | None = None) -> dict:
  now = now or now_s()
  require(isinstance(token, str) and 20 <= len(token) <= 100, 'Your town session has expired. Rejoin.', 401)
  row = db.execute('SELECT * FROM sessions WHERE token_hash = ?', (token_hash(token),)).fetchone()
  require(row is not None and now - row['seen'] < SESSION_SECONDS, 'Your town session has expired. Rejoin.', 401)
  if now - row['seen'] > 60:
    db.execute('UPDATE sessions SET seen = ? WHERE token_hash = ?', (now, row['token_hash']))
  return dict(row)


def local_pid(db, handle: str, cid: str, now: float | None = None) -> str:
  """The hub's own owner joins without a token (their own service vouches)."""
  require(isinstance(cid, str) and re.fullmatch(r'[A-Za-z0-9_-]{8,64}', cid), 'Invalid client id.')
  now = now or now_s()
  with Tx(db):
    return assign_pid(db, handle, cid, now)


# --- Presence ---------------------------------------------------------------------------------------

def upsert_presence(db, pid, handle, host, cid, name, look, st, now):
  row = db.execute('SELECT map, map_since, joined FROM presence WHERE pid = ?', (pid,)).fetchone()
  if row is None:
    db.execute(
      'INSERT INTO presence (pid, handle, host, cid, name, look, map, room, x, y, dir, status, muted, video, av, '
      'joined, seen, map_since) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      (pid, handle, host, cid, name, json.dumps(look), st['map'], st['room'], st['x'], st['y'], st['dir'],
       st['status'], st['muted'], st['video'], st['av'], now, now, now))
    return
  map_since = row['map_since'] if row['map'] == st['map'] else now
  db.execute(
    'UPDATE presence SET cid=?, name=?, look=?, map=?, room=?, x=?, y=?, dir=?, status=?, muted=?, video=?, '
    'av=?, seen=?, map_since=? WHERE pid=?',
    (cid, name, json.dumps(look), st['map'], st['room'], st['x'], st['y'], st['dir'], st['status'], st['muted'],
     st['video'], st['av'], now, map_since, pid))


def online(db, now) -> list[dict]:
  return [dict(r) for r in db.execute('SELECT * FROM presence WHERE seen >= ?', (now - ONLINE_SECONDS,))]


def peer_view(row, now) -> dict:
  return {
    'pid': row['pid'], 'handle': row['handle'], 'name': row['name'], 'look': json.loads(row['look']),
    'map': row['map'], 'room': row['room'], 'x': row['x'], 'y': row['y'], 'dir': row['dir'],
    'status': row['status'], 'muted': bool(row['muted']), 'video': bool(row['video']), 'av': bool(row['av']),
    'age': ms(now - row['seen']),
  }


# --- Housekeeping (runs inside each sync transaction) -------------------------------------------------

def housekeeping(db, world, players, now):
  db.execute('DELETE FROM presence WHERE seen < ?', (now - PURGE_SECONDS,))
  db.execute('DELETE FROM mail WHERE created < ?', (now - MAIL_TTL,))
  by_pid = {p['pid']: p for p in players}
  # Locks open themselves once a room has been empty for a while.
  for key in list(world['locks']):
    lock = world['locks'][key]
    map_id, room = key.split(':', 1)
    inside = [p for p in players if p['map'] == map_id and p['room'] == room]
    if inside:
      lock.pop('empty_since', None)
    else:
      lock.setdefault('empty_since', ms(now))
      if ms(now) - lock['empty_since'] > LOCK_EMPTY_SECONDS * 1000:
        del world['locks'][key]
  # Bubbles keep only online members on the bubble's map; one member is no bubble.
  for bid in list(world['bubbles']):
    b = world['bubbles'][bid]
    b['members'] = [m for m in b['members'] if m in by_pid and by_pid[m]['map'] == b['map']]
    if len(b['members']) < 2:
      del world['bubbles'][bid]
  # Games: forfeit when a player has been away too long; clear finished tables.
  for table_id in list(world['games']):
    game = world['games'][table_id]
    seated = list(game['players'].values())
    if not game['status'].get('over'):
      for side, pid in game['players'].items():
        if is_bot(pid):
          continue
        p = by_pid.get(pid)
        present = p is not None and p['map'] == game['map']
        away = game.setdefault('away', {})
        if present:
          away.pop(pid, None)
        else:
          away.setdefault(pid, ms(now))
          if ms(now) - away[pid] > ABANDON_SECONDS * 1000:
            finish_game(game, winner_side=other_side(game, side), reason='abandoned', now=now)
            mark_played(db, seated, now)
            break
    else:
      gone = all(not (by_pid.get(pid) and by_pid[pid]['map'] == game['map']) for pid in seated if not is_bot(pid))
      if gone and ms(now) - game.get('over_at', ms(now)) > 20_000:
        del world['games'][table_id]
  # Start games for players who just walked into a games house.
  auto_pair(db, world, players, now)
  # Events end a while after they finish.
  world['events'] = [e for e in world['events'] if e['starts'] + e['minutes'] * 60_000 + 2 * 3600_000 > ms(now)]
  # A talk nobody stopped clears itself a couple of minutes after its time is up.
  for ev in world['events']:
    cur = ev.get('current')
    if cur and ms(now) - cur['started'] > (cur['seconds'] + TALK_OVERTIME_SECONDS) * 1000:
      ev['current'] = None
  party_housekeeping(world, by_pid, now)
  pitch_housekeeping(world, by_pid, now)


# --- Games ---------------------------------------------------------------------------------------------

def is_bot(pid) -> bool:
  return isinstance(pid, str) and pid.startswith('bot:')


def other_side(game, side):
  sides = list(game['players'])
  return sides[1] if sides[0] == side else sides[0]


def new_game_state(kind):
  if kind == 'chess':
    key = chess_rules.position_key(chess_rules.parse_fen(chess_rules.START_FEN))
    return {'fen': chess_rules.START_FEN, 'moves': [], 'san': [], 'positions': [key]}
  return {'cells': connect4_rules.new_game()['cells'], 'moves': []}


def start_game(world, table_id, pids, names, now, swap=False):
  table = META['tables'][table_id]
  sides = table['seats']
  order = list(pids)
  if table['kind'] == 'chess' and not swap:
    random.shuffle(order)
  elif swap:
    order = order[::-1]
  game = {
    'table': table_id, 'kind': table['kind'], 'map': table['map'],
    'players': {sides[0]: order[0], sides[1]: order[1]},
    'names': {pid: names.get(pid, pid) for pid in order},
    'state': new_game_state(table['kind']),
    'turn': sides[0], 'status': {'over': False}, 'started': ms(now), 'updated': ms(now), 'rematch': [],
  }
  world['games'][table_id] = game
  return game


def active_pids(world):
  return {pid for g in world['games'].values() if not g['status'].get('over') for pid in g['players'].values()}


def auto_pair(db, world, players, now):
  busy = active_pids(world)
  for table_id, table in sorted(META['tables'].items()):
    game = world['games'].get(table_id)
    if game and (not game['status'].get('over') or any(
        p['pid'] in game['players'].values() and p['map'] == table['map'] for p in players)):
      continue
    waiting = sorted(
      (p for p in players
       if p['map'] == table['map'] and p['pid'] not in busy and p['last_game'] < p['map_since']),
      key=lambda p: p['map_since'])
    if len(waiting) < 2:
      continue
    pair = [waiting[0]['pid'], waiting[1]['pid']]
    start_game(world, table_id, pair, {p['pid']: p['name'] for p in waiting[:2]}, now)
    busy.update(pair)


def mark_played(db, pids, now):
  for pid in pids:
    if not is_bot(pid):
      db.execute('UPDATE presence SET last_game = ? WHERE pid = ?', (now, pid))


def finish_game(game, *, winner_side=None, reason, now, draw=False):
  game['status'] = {
    'over': True, 'reason': reason,
    'winner': None if draw or winner_side is None else game['players'][winner_side],
    'draw': bool(draw),
  }
  game['over_at'] = ms(now)
  game['updated'] = ms(now)


def apply_game_move(game, pid, move, now, as_bot=False):
  require(not game['status'].get('over'), 'This game is over.')
  to_move = game['players'].get(game['turn'])
  if as_bot:
    # The human's browser plays the bot; it may only move for the bot it is playing against.
    require(is_bot(to_move) and pid in game['players'].values(), "It isn't the bot's turn.")
  else:
    require(to_move == pid, "It isn't your turn.")
  st = game['state']
  if game['kind'] == 'chess':
    require(isinstance(move, str) and re.fullmatch(r'[a-h][1-8][a-h][1-8][qrbn]?', move), 'Invalid move.')
    board = chess_rules.parse_fen(st['fen'])
    san = chess_rules.move_to_san(board, move) if move in chess_rules.legal_moves(board) else None
    require(san is not None, 'That move is not legal.')
    after = chess_rules.apply_move(board, move)
    st['fen'] = chess_rules.to_fen(after)
    st['moves'].append(move)
    st['san'].append(san)
    st['positions'].append(chess_rules.position_key(after))
    status = chess_rules.game_status(after, st['positions'])
    game['turn'] = status['turn']
    if status['over']:
      if status['result'] == '1/2-1/2':
        finish_game(game, reason=status['reason'], now=now, draw=True)
      else:
        finish_game(game, winner_side='w' if status['result'] == '1-0' else 'b', reason=status['reason'], now=now)
    game['check'] = bool(status.get('check'))
  else:
    require(isinstance(move, int) and not isinstance(move, bool) and 0 <= move < connect4_rules.COLS,
            'Invalid column.')
    state = {'cells': st['cells'], 'turn': game['turn']}
    after = connect4_rules.drop(state, move)
    require(after is not None, 'That column is full.')
    st['cells'] = after['cells']
    st['moves'].append(move)
    status = connect4_rules.status(after)
    game['turn'] = after['turn']
    if status['over']:
      if status.get('draw'):
        finish_game(game, reason='draw', now=now, draw=True)
      else:
        finish_game(game, winner_side=status['winner'], reason='four', now=now)
      game['line'] = status.get('line')
  game['updated'] = ms(now)


# --- Party challenges (three quick games, party.py) -------------------------------------------------------

PARTY_RNG = random.SystemRandom()


def party_of(world, pid):
  """The party `pid` is still part of (not closed by them), if any."""
  for party in world['parties'].values():
    if pid in party['players'] and pid not in party['closed'] and not party_rules.is_finished(party):
      return party
  return None


def party_busy(world, pid) -> bool:
  """Busy until the party's last game is decided; the final screen does not block a new challenge."""
  party = party_of(world, pid)
  return party is not None and party['phase'] != 'final'


def party_housekeeping(world, by_pid, now):
  t = ms(now)
  for iid in list(world['invites']):
    inv = world['invites'][iid]
    if inv.get('status') == 'declined':
      if t - inv['answered'] > DECLINED_SECONDS * 1000:
        del world['invites'][iid]
    elif t > inv['expires'] or inv['from'] not in by_pid or inv['to'] not in by_pid:
      del world['invites'][iid]
  for party_id in list(world['parties']):
    party = world['parties'][party_id]
    party_rules.tick(party, t, PARTY_RNG)
    # Someone who left town forfeits after a while; the timers keep the party moving until then.
    if party['phase'] != 'final' and not party_rules.is_finished(party):
      away = party.setdefault('away', {})
      for pid in party['players']:
        if pid in by_pid:
          away.pop(pid, None)
        elif t - away.setdefault(pid, t) > PARTY_AWAY_SECONDS * 1000:
          try:
            party_rules.apply_action(party, pid, {'type': 'forfeit'}, t, PARTY_RNG)
          except party_rules.PartyError:
            pass
          break
    everyone_gone = all(p in party['closed'] or p not in by_pid for p in party['players'])
    if party_rules.is_finished(party) or (party['phase'] == 'final' and everyone_gone):
      del world['parties'][party_id]


def world_for(world, pid, now) -> dict:
  """The world as `pid` may see it: no raw parties, only their own party's public view."""
  view = {k: v for k, v in world.items() if k != 'parties'}
  mine = party_of(world, pid)
  view['party'] = party_rules.public_view(mine, pid, ms(now)) if mine else None
  view['partying'] = sorted({p for party in world['parties'].values() if party['phase'] != 'final' for p in party['players']})
  return view


def act_party_challenge(db, world, me, by_pid, body, now):
  to = body.get('to')
  require(isinstance(to, str) and to in by_pid and to != me['pid'], "They're not in town right now.")
  require(not party_busy(world, me['pid']), "Finish your party first.")
  require(not party_busy(world, to), f"{by_pid[to]['name']} is in a party right now.")
  for inv in world['invites'].values():
    if inv.get('status') == 'declined':
      continue
    require(not (inv['from'] == me['pid'] and inv['to'] == to), 'You already challenged them. Give them a moment.')
    if inv['from'] == to and inv['to'] == me['pid']:
      return act_party_answer(db, world, me, by_pid, {'id': inv['id'], 'accept': True}, now)
  mine = [i for i in world['invites'].values() if i['from'] == me['pid'] and i.get('status') != 'declined']
  require(len(mine) < 3, 'You have enough challenges waiting for an answer.')
  iid = secrets.token_hex(5)
  world['invites'][iid] = {
    'id': iid, 'from': me['pid'], 'to': to, 'fromName': me['name'], 'toName': by_pid[to]['name'],
    'created': ms(now), 'expires': ms(now) + INVITE_SECONDS * 1000, 'status': 'pending',
  }
  return {'invite': world['invites'][iid]}


def act_party_answer(db, world, me, by_pid, body, now):
  inv = world['invites'].get(body.get('id'))
  require(inv is not None and inv.get('status') == 'pending', 'That challenge has expired.')
  require(inv['to'] == me['pid'], 'That challenge is for someone else.', 403)
  if body.get('accept') is not True:
    inv.update({'status': 'declined', 'answered': ms(now)})
    return {'declined': True}
  require(inv['from'] in by_pid, f"{inv['fromName']} has left town.")
  require(not party_busy(world, me['pid']), 'Finish your party first.')
  require(not party_busy(world, inv['from']), f"{inv['fromName']} is in another party.")
  # Starting a party settles every other challenge either player had waiting.
  for iid in list(world['invites']):
    other = world['invites'][iid]
    if {other['from'], other['to']} & {me['pid'], inv['from']}:
      del world['invites'][iid]
  # Close any final screen still open from an earlier party.
  for old in list(world['parties'].values()):
    if old['phase'] == 'final':
      for pid in (me['pid'], inv['from']):
        if pid in old['players'] and pid not in old['closed']:
          old['closed'].append(pid)
  party_id = secrets.token_hex(6)
  names = {inv['from']: by_pid[inv['from']]['name'], me['pid']: me['name']}
  try:
    party = party_rules.new_party(party_id, inv['from'], me['pid'], names, ms(now), PARTY_RNG)
  except party_rules.PartyError as e:
    raise Problem(str(e))
  world['parties'][party_id] = party
  return {'party': party_id}


def act_party_act(db, world, me, by_pid, body, now):
  party = world['parties'].get(body.get('id'))
  require(party is not None, 'That party is over.')
  try:
    party_rules.apply_action(party, me['pid'], body.get('action'), ms(now), PARTY_RNG)
  except party_rules.PartyError as e:
    raise Problem(str(e))
  if party_rules.is_finished(party):
    del world['parties'][party['id']]
  return {'ok': True}


# --- Football (2 v 2 on the town pitch; the host's browser runs the match) --------------------------------
#
# The hub keeps only the line-up and the outcome. One human player's browser (the host) simulates
# the match with games/football.js and streams it to the others over their direct connections;
# empty places are bots in that simulation. If the host leaves, the next human continues from the
# last state they received.

def new_pitch():
  return {'status': 'idle', 'slots': {s: None for s in PITCH_SLOTS}, 'names': {}, 'match': None,
          'kickoff_at': None, 'level': 'medium', 'score': {'red': 0, 'blue': 0}, 'last': None}


def pitch_of(world):
  if not world.get('pitch'):
    world['pitch'] = new_pitch()
  return world['pitch']


def pitch_humans(pitch):
  return [pid for pid in (pitch['slots'][s] for s in PITCH_SLOTS) if pid]


def on_pitch(player) -> bool:
  area = META['pitch']
  x, y, w, h = area['rect']
  return player['map'] == area['map'] and x <= player['x'] < x + w and y <= player['y'] < y + h


def pitch_reset(pitch, now, result=None):
  last = result or pitch.get('last')
  pitch.clear()
  pitch.update(new_pitch())
  pitch['last'] = last


def pitch_housekeeping(world, by_pid, now):
  pitch = pitch_of(world)
  t = ms(now)
  for slot in PITCH_SLOTS:
    pid = pitch['slots'][slot]
    # Gone, or walked off the ground before kick-off: give the place back.
    if pid and (pid not in by_pid or by_pid[pid]['map'] != 'town'
                or (pitch['status'] != 'playing' and not on_pitch(by_pid[pid]))):
      pitch['slots'][slot] = None
  humans = pitch_humans(pitch)
  if pitch['status'] == 'lobby':
    if not humans:
      pitch_reset(pitch, now)
    elif t >= pitch['kickoff_at']:
      pitch.update({
        'status': 'playing', 'kickoff_at': None, 'score': {'red': 0, 'blue': 0},
        'match': {'id': secrets.token_hex(5), 'host': humans[0], 'seed': random.randrange(1, 1 << 30),
                  'started': t, 'duration': PITCH_MATCH_SECONDS},
      })
  elif pitch['status'] == 'playing':
    match = pitch['match']
    if not humans or t - match['started'] > PITCH_STALE_SECONDS * 1000:
      pitch_reset(pitch, now)
    elif match['host'] not in humans:
      match['host'] = humans[0]


def act_pitch_join(db, world, me, by_pid, body, now):
  pitch = pitch_of(world)
  require(on_pitch(me), 'Walk onto the football pitch to join a match.')
  team = body.get('team')
  require(team in (None, 'red', 'blue'), 'Pick the red or the blue team.')
  mine = next((s for s in PITCH_SLOTS if pitch['slots'][s] == me['pid']), None)
  if mine and (team is None or mine.startswith(team)):
    return {'slot': mine}
  free = [s for s in PITCH_SLOTS if not pitch['slots'][s]]
  if team:
    free = [s for s in free if s.startswith(team)]
  else:
    # Balance the teams: the side with fewer people first, red on a tie.
    count = {side: sum(1 for s in PITCH_SLOTS if s.startswith(side) and pitch['slots'][s]) for side in ('red', 'blue')}
    free.sort(key=lambda s: (count['red' if s.startswith('red') else 'blue'], 0 if s.startswith('red') else 1))
  require(free, 'That team is full.' if team else 'The match is full. Watch from the side, or wait for the next one.')
  if mine:
    pitch['slots'][mine] = None
  slot = free[0]
  pitch['slots'][slot] = me['pid']
  pitch['names'][me['pid']] = me['name']
  if pitch['status'] == 'idle':
    pitch.update({'status': 'lobby', 'kickoff_at': ms(now) + PITCH_LOBBY_SECONDS * 1000, 'match': None})
  return {'slot': slot}


def act_pitch_leave(db, world, me, by_pid, body, now):
  pitch = pitch_of(world)
  for slot in PITCH_SLOTS:
    if pitch['slots'][slot] == me['pid']:
      pitch['slots'][slot] = None
  humans = pitch_humans(pitch)
  if not humans:
    pitch_reset(pitch, now)
  elif pitch['status'] == 'playing' and pitch['match']['host'] == me['pid']:
    pitch['match']['host'] = humans[0]
  return {'ok': True}


def act_pitch_level(db, world, me, by_pid, body, now):
  pitch = pitch_of(world)
  level = body.get('level')
  require(level in BOT_LEVELS, 'Pick easy, medium or hard bots.')
  require(me['pid'] in pitch_humans(pitch), 'Join the match first.')
  require(pitch['status'] != 'playing', 'The match has already started.')
  pitch['level'] = level
  return {'ok': True}


def pitch_host_match(pitch, me, body):
  match = pitch.get('match')
  require(pitch['status'] == 'playing' and match and match['id'] == body.get('id'), 'That match is over.')
  require(match['host'] == me['pid'], 'Only the player running the match can report it.', 403)
  red, blue = body.get('red'), body.get('blue')
  require(all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 99 for v in (red, blue)), 'Invalid score.')
  return match, red, blue


def act_pitch_score(db, world, me, by_pid, body, now):
  pitch = pitch_of(world)
  _match, red, blue = pitch_host_match(pitch, me, body)
  pitch['score'] = {'red': red, 'blue': blue}
  return {'ok': True}


def act_pitch_result(db, world, me, by_pid, body, now):
  pitch = pitch_of(world)
  match, red, blue = pitch_host_match(pitch, me, body)
  winner = 'red' if red > blue else 'blue' if blue > red else 'draw'
  players = {slot: pitch['slots'][slot] for slot in PITCH_SLOTS}
  names = {pid: pitch['names'].get(pid) for pid in players.values() if pid}
  pitch_reset(pitch, now, {'id': match['id'], 'red': red, 'blue': blue, 'winner': winner, 'at': ms(now),
                           'players': players, 'names': names})
  return {'ok': True}


# --- Requests ------------------------------------------------------------------------------------------

def sync(db, pid: str, handle: str, host: str, cid: str, body: dict, now: float | None = None) -> dict:
  now = now or now_s()
  require(isinstance(body, dict), 'Invalid request.')
  st = clean_state(body.get('st'))
  name = clean_name(body.get('name'), handle)
  look = clean_look(body.get('look'))
  out = body.get('out') or []
  require(isinstance(out, list) and len(out) <= MAX_OUT, 'Too many messages at once.')
  ack = body.get('ack') if isinstance(body.get('ack'), int) else 0
  since = body.get('since') if isinstance(body.get('since'), int) else -1
  with Tx(db):
    upsert_presence(db, pid, handle, host, cid, name, look, st, now)
    players = online(db, now)
    online_pids = {p['pid'] for p in players}
    for msg in out:
      if not isinstance(msg, dict):
        continue
      to, kind, value = msg.get('to'), msg.get('k'), msg.get('v')
      if to not in online_pids or to == pid or kind not in MAIL_KINDS:
        continue
      raw = json.dumps(value, separators=(',', ':'))
      if len(raw) > MAX_MAIL_BYTES:
        continue
      db.execute('INSERT INTO mail (to_pid, from_pid, k, v, created) VALUES (?,?,?,?,?)',
                 (to, pid, kind, raw, now))
    if ack:
      db.execute('DELETE FROM mail WHERE to_pid = ? AND id <= ?', (pid, ack))
    inbox = [
      {'id': r['id'], 'from': r['from_pid'], 'k': r['k'], 'v': json.loads(r['v'])}
      for r in db.execute('SELECT * FROM mail WHERE to_pid = ? AND id > ? ORDER BY id LIMIT 200', (pid, ack))
    ]
    world = load_world(db)
    before = copy(world)
    housekeeping(db, world, players, now)
    save_world(db, before, world)
    wv = world_version(db)
  peers = [peer_view(p, now) for p in players if p['pid'] != pid]
  return {
    'now': ms(now), 'pid': pid, 'peers': peers, 'inbox': inbox, 'wv': wv,
    'world': world_for(world, pid, now) if since != wv else None,
  }


def act(db, pid: str, body: dict, now: float | None = None) -> dict:
  now = now or now_s()
  require(isinstance(body, dict), 'Invalid request.')
  op = body.get('op')
  with Tx(db):
    me = db.execute('SELECT * FROM presence WHERE pid = ?', (pid,)).fetchone()
    require(me is not None and now - me['seen'] < ONLINE_SECONDS, 'Rejoin the town first.', 409)
    me = dict(me)
    players = online(db, now)
    by_pid = {p['pid']: p for p in players}
    world = load_world(db)
    before = copy(world)
    result = ACTIONS.get(op, unknown_action)(db, world, me, by_pid, body, now)
    save_world(db, before, world)
    wv = world_version(db)
  return {'ok': True, 'result': result, 'wv': wv, 'world': world_for(world, pid, now)}


def unknown_action(*_args):
  raise Problem('Unknown action.')


def act_lock(db, world, me, by_pid, body, now):
  key = f"{me['map']}:{me['room']}"
  require(key in META['lockable'], 'Only meeting rooms can be locked.')
  require(key not in world['locks'], 'This room is already locked.')
  inside = {p['pid'] for p in by_pid.values() if p['map'] == me['map'] and p['room'] == me['room']}
  # Positions reach the locker peer to peer before the hub hears of them, so the people it saw
  # inside (on this map, and online) count as inside too: someone who has just walked in is not
  # then put out of the room they were locked into.
  seen = body.get('inside')
  if isinstance(seen, list):
    inside |= {pid for pid in seen[:50] if isinstance(pid, str) and by_pid.get(pid, {}).get('map') == me['map']}
  world['locks'][key] = {'by': me['pid'], 'byName': me['name'], 'at': ms(now), 'allow': sorted(inside)}
  return {'locked': key}


def act_unlock(db, world, me, by_pid, body, now):
  key = f"{me['map']}:{body.get('room') or me['room']}"
  lock = world['locks'].get(key)
  require(lock is not None, 'This room is not locked.')
  require(me['pid'] in lock['allow'], 'Only people inside can unlock this room.', 403)
  del world['locks'][key]
  return {'unlocked': key}


def act_knock(db, world, me, by_pid, body, now):
  key = f"{me['map']}:{body.get('room')}"
  lock = world['locks'].get(key)
  require(lock is not None, 'The door is open.')
  for pid in lock['allow']:
    if pid in by_pid:
      db.execute('INSERT INTO mail (to_pid, from_pid, k, v, created) VALUES (?,?,?,?,?)',
                 (pid, me['pid'], 'knock', json.dumps({'room': body.get('room'), 'name': me['name']}), now))
  return {'knocked': key}


def act_admit(db, world, me, by_pid, body, now):
  key = f"{me['map']}:{body.get('room') or me['room']}"
  lock = world['locks'].get(key)
  require(lock is not None, 'This room is not locked.')
  require(me['pid'] in lock['allow'], 'Only people inside can let someone in.', 403)
  guest = body.get('pid')
  require(guest in by_pid, 'They are no longer here.')
  if guest not in lock['allow']:
    lock['allow'].append(guest)
  db.execute('INSERT INTO mail (to_pid, from_pid, k, v, created) VALUES (?,?,?,?,?)',
             (guest, me['pid'], 'admit', json.dumps({'room': body.get('room') or me['room']}), now))
  return {'admitted': guest}


def bubble_of(world, pid):
  for bid, b in world['bubbles'].items():
    if pid in b['members']:
      return bid
  return None


def act_bubble(db, world, me, by_pid, body, now):
  others = body.get('with')
  require(isinstance(others, list) and 1 <= len(others) <= 12, 'Choose who to bubble up with.')
  guests = [p for p in others if p in by_pid and p != me['pid'] and by_pid[p]['map'] == me['map']]
  require(guests, 'Nobody nearby to bubble up with.')
  bid = bubble_of(world, me['pid'])
  if bid is None:
    bid = 'b' + secrets.token_hex(4)
    world['bubbles'][bid] = {'members': [me['pid']], 'map': me['map'], 'at': ms(now), 'by': me['pid']}
  members = world['bubbles'][bid]['members']
  for g in guests:
    old = bubble_of(world, g)
    if old and old != bid:
      world['bubbles'][old]['members'].remove(g)
    if g not in members:
      members.append(g)
  return {'bubble': bid}


def act_bubble_join(db, world, me, by_pid, body, now):
  bid = body.get('bubble')
  b = world['bubbles'].get(bid)
  require(b is not None and b['map'] == me['map'], 'That bubble has popped.')
  old = bubble_of(world, me['pid'])
  if old and old != bid:
    world['bubbles'][old]['members'].remove(me['pid'])
  if me['pid'] not in b['members']:
    b['members'].append(me['pid'])
  return {'bubble': bid}


def act_bubble_leave(db, world, me, by_pid, body, now):
  bid = bubble_of(world, me['pid'])
  if bid:
    world['bubbles'][bid]['members'].remove(me['pid'])
    if len(world['bubbles'][bid]['members']) < 2:
      del world['bubbles'][bid]
  return {'bubble': None}


def act_tv(db, world, me, by_pid, body, now):
  screen = body.get('screen')
  require(screen in META['screens'], 'Unknown screen.')
  video = body.get('video')
  if video is None:
    world['tv'].pop(screen, None)
    return {'tv': None}
  require(isinstance(video, str) and VIDEO_ID.match(video), 'That is not a YouTube video link.')
  world['tv'][screen] = {
    'video': video, 'title': clean_text(body.get('title'), 120), 'by': me['pid'], 'byName': me['name'],
    'at': ms(now),
  }
  # Its length in seconds, when the town could find it: it knows when the video has finished.
  length = body.get('length')
  if isinstance(length, int) and not isinstance(length, bool) and 0 < length <= 86_400:
    world['tv'][screen]['length'] = length
  return {'tv': world['tv'][screen]}


def act_chat(db, world, me, by_pid, body, now):
  text = clean_text(body.get('text'), 280)
  require(text, 'Write something first.')
  require(now - me.get('chat_at', 0) >= 0.6, 'Slow down a little.', 429)
  db.execute('UPDATE presence SET chat_at = ? WHERE pid = ?', (now, me['pid']))
  feed = world['feed']
  feed.append({'id': secrets.token_hex(5), 'pid': me['pid'], 'name': me['name'], 'text': text, 'at': ms(now)})
  del feed[:-FEED_KEEP]
  return {'sent': True}


def seated_game(world, table_id, pid):
  game = world['games'].get(table_id)
  require(game is not None, 'No game at this table.')
  require(pid in game['players'].values(), "You're not playing at this table.", 403)
  return game


def act_move(db, world, me, by_pid, body, now):
  game = seated_game(world, body.get('table'), me['pid'])
  apply_game_move(game, me['pid'], body.get('move'), now, as_bot=body.get('bot') is True)
  if game['status'].get('over'):
    mark_played(db, list(game['players'].values()), now)
  return {'game': game}


def act_resign(db, world, me, by_pid, body, now):
  game = seated_game(world, body.get('table'), me['pid'])
  require(not game['status'].get('over'), 'This game is already over.')
  side = next(s for s, p in game['players'].items() if p == me['pid'])
  finish_game(game, winner_side=other_side(game, side), reason='resigned', now=now)
  mark_played(db, list(game['players'].values()), now)
  return {'game': game}


def act_rematch(db, world, me, by_pid, body, now):
  table_id = body.get('table')
  game = seated_game(world, table_id, me['pid'])
  require(game['status'].get('over'), 'Finish this game first.')
  if me['pid'] not in game['rematch']:
    game['rematch'].append(me['pid'])
  pids = list(game['players'].values())
  if all(p in game['rematch'] or is_bot(p) for p in pids):
    names = dict(game['names'])
    start_game(world, table_id, pids, names, now, swap=True)
  return {'game': world['games'][table_id]}


def act_sit(db, world, me, by_pid, body, now):
  """Sit at a free table: with someone already waiting there, a game starts."""
  table_id = body.get('table')
  table = META['tables'].get(table_id)
  require(table is not None and table['map'] == me['map'], 'Walk up to a table first.')
  require(me['pid'] not in active_pids(world), "You're already playing.")
  game = world['games'].get(table_id)
  if game and not game['status'].get('over'):
    raise Problem('This table is busy. Watch, or wait for the next game.', 409)
  level = body.get('bot')
  if level is not None:
    require(level in BOT_LEVELS, 'Pick an easy, medium or hard bot.')
    bot = f'bot:{level}'
    start_game(world, table_id, [me['pid'], bot], {me['pid']: me['name'], bot: f'Bot ({level.title()})'}, now)
    return {'game': world['games'][table_id]}
  others = [p for p in by_pid.values()
            if p['map'] == table['map'] and p['pid'] != me['pid'] and p['pid'] not in active_pids(world)]
  others.sort(key=lambda p: p['map_since'])
  if not others:
    return {'waiting': True}
  start_game(world, table_id, [me['pid'], others[0]['pid']], {me['pid']: me['name'], others[0]['pid']: others[0]['name']}, now)
  return {'game': world['games'][table_id]}


def act_stand(db, world, me, by_pid, body, now):
  table_id = body.get('table')
  game = seated_game(world, table_id, me['pid'])
  if not game['status'].get('over'):
    side = next(s for s, p in game['players'].items() if p == me['pid'])
    finish_game(game, winner_side=other_side(game, side), reason='left', now=now)
  mark_played(db, list(game['players'].values()), now)
  game['rematch'] = [p for p in game['rematch'] if p != me['pid']]
  return {'game': game}


# --- Events (talk nights, meetups) ------------------------------------------------------------------

def find_event(world, eid):
  ev = next((e for e in world['events'] if e['id'] == eid), None)
  require(ev is not None, 'That event no longer exists.', 404)
  return ev


def act_event_create(db, world, me, by_pid, body, now):
  title = clean_text(body.get('title'), 80)
  require(title, 'Give the event a title.')
  kind = body.get('kind')
  require(kind in EVENT_KINDS, 'Unknown kind of event.')
  place = body.get('place')
  require(place in EVENT_PLACES, 'Unknown place.')
  starts = body.get('starts')
  require(isinstance(starts, int) and not isinstance(starts, bool), 'Pick a start time.')
  require(ms(now) - 10 * 60_000 <= starts <= ms(now) + 60 * 86_400_000, 'Pick a time in the next two months.')
  minutes = body.get('minutes', 60)
  require(isinstance(minutes, int) and 10 <= minutes <= 240, 'Events last between 10 minutes and 4 hours.')
  upcoming = [e for e in world['events'] if e['starts'] + e['minutes'] * 60_000 > ms(now)]
  require(len(upcoming) < MAX_EVENTS, 'The town calendar is full right now.')
  require(sum(1 for e in upcoming if e['host'] == me['pid']) < 3, 'You can host up to three upcoming events.')
  ev = {
    'id': 'e' + secrets.token_hex(4), 'title': title, 'kind': kind, 'place': place, 'starts': starts,
    'minutes': minutes, 'host': me['pid'], 'hostName': me['name'], 'created': ms(now),
    'going': [me['pid']], 'slots': [], 'current': None,
  }
  world['events'].append(ev)
  world['events'].sort(key=lambda e: e['starts'])
  return {'event': ev}


def act_event_cancel(db, world, me, by_pid, body, now):
  ev = find_event(world, body.get('id'))
  require(ev['host'] == me['pid'], 'Only the host can cancel this event.', 403)
  world['events'] = [e for e in world['events'] if e['id'] != ev['id']]
  return {'cancelled': ev['id']}


def act_event_rsvp(db, world, me, by_pid, body, now):
  ev = find_event(world, body.get('id'))
  going = body.get('going') is True
  if going and me['pid'] not in ev['going']:
    ev['going'].append(me['pid'])
  if not going and me['pid'] in ev['going'] and me['pid'] != ev['host']:
    ev['going'].remove(me['pid'])
  return {'event': ev}


def act_event_slot(db, world, me, by_pid, body, now):
  ev = find_event(world, body.get('id'))
  require(ev['kind'] == 'talks', 'Only talk nights have speaking slots.')
  title = clean_text(body.get('title'), 80)
  require(title, 'What is your talk called?')
  mine = next((s for s in ev['slots'] if s['pid'] == me['pid']), None)
  if mine:
    mine['title'] = title
  else:
    require(len(ev['slots']) < MAX_SLOTS, 'All the speaking slots are taken.')
    ev['slots'].append({'pid': me['pid'], 'name': me['name'], 'title': title})
  if me['pid'] not in ev['going']:
    ev['going'].append(me['pid'])
  return {'event': ev}


def act_event_unslot(db, world, me, by_pid, body, now):
  ev = find_event(world, body.get('id'))
  ev['slots'] = [s for s in ev['slots'] if s['pid'] != me['pid']]
  if ev['current'] and ev['current']['slot'] >= len(ev['slots']):
    ev['current'] = None
  return {'event': ev}


def act_talk_start(db, world, me, by_pid, body, now):
  ev = find_event(world, body.get('id'))
  require(ev['kind'] == 'talks', 'Only talk nights have talks.')
  slot = body.get('slot')
  require(isinstance(slot, int) and 0 <= slot < len(ev['slots']), 'Unknown speaking slot.')
  require(me['pid'] in (ev['host'], ev['slots'][slot]['pid']), 'Only the host or that speaker can start this talk.', 403)
  require(ms(now) >= ev['starts'] - 15 * 60_000, "This event hasn't started yet.")
  ev['current'] = {'slot': slot, 'started': ms(now), 'seconds': TALK_SECONDS}
  return {'event': ev}


def act_talk_stop(db, world, me, by_pid, body, now):
  ev = find_event(world, body.get('id'))
  cur = ev.get('current')
  require(cur is not None, 'No talk is running.')
  speaker = ev['slots'][cur['slot']]['pid'] if cur['slot'] < len(ev['slots']) else None
  require(me['pid'] in (ev['host'], speaker), 'Only the host or the speaker can stop the talk.', 403)
  ev['current'] = None
  return {'event': ev}


ACTIONS = {
  'lock': act_lock, 'unlock': act_unlock, 'knock': act_knock, 'admit': act_admit,
  'bubble': act_bubble, 'bubble_join': act_bubble_join, 'bubble_leave': act_bubble_leave,
  'tv': act_tv, 'chat': act_chat,
  'move': act_move, 'resign': act_resign, 'rematch': act_rematch, 'sit': act_sit, 'stand': act_stand,
  'event_create': act_event_create, 'event_cancel': act_event_cancel, 'event_rsvp': act_event_rsvp,
  'event_slot': act_event_slot, 'event_unslot': act_event_unslot, 'talk_start': act_talk_start,
  'talk_stop': act_talk_stop,
  'party_challenge': act_party_challenge, 'party_answer': act_party_answer, 'party_act': act_party_act,
  'pitch_join': act_pitch_join, 'pitch_leave': act_pitch_leave, 'pitch_level': act_pitch_level,
  'pitch_score': act_pitch_score, 'pitch_result': act_pitch_result,
}


def leave(db, pid: str, now: float | None = None) -> dict:
  now = now or now_s()
  with Tx(db):
    db.execute('UPDATE presence SET seen = ? WHERE pid = ?', (now - ONLINE_SECONDS - 1, pid))
    db.execute('DELETE FROM mail WHERE to_pid = ?', (pid,))
  return {'ok': True}
