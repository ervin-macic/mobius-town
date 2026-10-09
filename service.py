#!/usr/bin/env python3
"""Mobius Town service: each player's door into the shared town.

Every installation runs this service. The installation named HUB_HOST also
keeps the shared world (hub.py). Elsewhere, the player's own service forwards
to the hub. The first time, it proves who the player is the way Möbius apps
federate (as Ball Game's leaderboard does): it stores a short-lived proof bound
to the exact request and sends the request to the hub's `exchange`. The hub
checks, through the Möbius identity directory, that the sending installation
belongs to the player's @handle, fetches the proof back, and returns a session
token that this service keeps server-side. No credential leaves an installation.

Requests from this installation's own app arrive on the private lane; requests
from other installations arrive anonymously on the public lane.
"""
from __future__ import annotations

MOBIUS_PRELOAD = True

import asyncio  # noqa: E402
import hashlib  # noqa: E402
import ipaddress  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import secrets  # noqa: E402
import socket  # noqa: E402
import sqlite3  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402
from urllib.parse import quote, urlsplit  # noqa: E402

import httpx  # noqa: E402

import hub  # noqa: E402
from hub import Problem, require  # noqa: E402

HUB_HOST = 'mobius-production-8969.up.railway.app'
SERVICE_PATH = '/api/app-services/mobius-town'
PROOF_SECONDS = 120
IDENTITY_CACHE_SECONDS = 300
MAX_PEER_RESPONSE = 512 * 1024
CID = re.compile(r'^[A-Za-z0-9_-]{8,64}$')


class Ctx:
  """Per-request environment (the preloaded module must not read it at import)."""

  def __init__(self):
    self.store = Path(os.environ['APP_STORAGE_DIR'])
    self.api = os.environ['API_BASE_URL'].rstrip('/')
    self.token = os.environ['APP_TOKEN']
    self.host = urlsplit(os.environ.get('INSTANCE_ORIGIN', '')).netloc.lower()
    self.is_hub = self.host == HUB_HOST


def digest(value) -> str:
  return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def local_db(ctx: Ctx) -> sqlite3.Connection:
  """This installation's own small database: proofs and its players' hub sessions."""
  ctx.store.mkdir(parents=True, exist_ok=True)
  db = sqlite3.connect(str(ctx.store / 'local.sqlite3'), timeout=10, isolation_level=None)
  db.row_factory = sqlite3.Row
  db.execute('PRAGMA journal_mode=WAL')
  db.execute('PRAGMA busy_timeout=10000')
  db.executescript("""
    CREATE TABLE IF NOT EXISTS proofs (id TEXT PRIMARY KEY, document TEXT NOT NULL, expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS hub_sessions (cid TEXT PRIMARY KEY, token TEXT NOT NULL, pid TEXT NOT NULL,
      handle TEXT NOT NULL, created REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at REAL NOT NULL);
  """)
  return db


def hub_db(ctx: Ctx):
  path = ctx.store / 'world' / 'hub.sqlite3'
  path.parent.mkdir(parents=True, exist_ok=True)
  return hub.connect(path)


# --- Talking to Möbius and to other installations --------------------------------------------------

async def platform(ctx: Ctx, path: str):
  async with httpx.AsyncClient(timeout=6, follow_redirects=False, trust_env=False) as client:
    response = await client.get(ctx.api + path, headers={'Authorization': 'Bearer ' + ctx.token})
  if response.status_code >= 400:
    raise Problem('Möbius could not complete the request. Please retry.', 502)
  return response.json() if response.content else {}


async def identity(ctx: Ctx) -> dict:
  """This installation's owner: @handle and display name (cached briefly)."""
  with local_db(ctx) as db:
    row = db.execute("SELECT v, at FROM cache WHERE k = 'identity'").fetchone()
  if row and time.time() - row['at'] < IDENTITY_CACHE_SECONDS:
    return json.loads(row['v'])
  data = await platform(ctx, '/api/identity')
  profile = data.get('profile') or {}
  me = {
    'handle': (profile.get('handle') or '').lower() or None,
    'name': profile.get('display_name') or profile.get('name') or profile.get('handle') or None,
    'unavailable': bool(data.get('account_unavailable')),
  }
  with local_db(ctx) as db:
    db.execute("INSERT OR REPLACE INTO cache VALUES ('identity', ?, ?)", (json.dumps(me), time.time()))
  return me


async def require_handle(ctx: Ctx) -> dict:
  me = await identity(ctx)
  require(me['handle'] and not me['unavailable'],
          'Connect a Möbius account with an @handle (in Möbius · You) to meet people in Mobius Town.', 409)
  return me


async def hosts_of(ctx: Ctx, handle: str) -> list[str]:
  found = await platform(ctx, '/api/identity/handles/' + quote(handle, safe=''))
  require(found.get('linked') is True and found.get('hosts'), 'That Möbius ID has no reachable installation.', 403)
  return [h.lower() for h in found['hosts'] if isinstance(h, str)]


def public_host(name: str) -> str:
  """A public internet host name that resolves only to public addresses."""
  require(isinstance(name, str) and re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?', name) and '.' in name,
          'Invalid installation address.', 403)
  try:
    addresses = {info[4][0] for info in socket.getaddrinfo(name, 443, type=socket.SOCK_STREAM)}
  except OSError:
    raise Problem('The other Möbius installation could not be reached.', 502)
  require(addresses and all(ipaddress.ip_address(a.split('%')[0]).is_global for a in addresses),
          'Invalid installation address.', 403)
  return name


async def peer(host: str, path: str, body=None):
  url = 'https://' + public_host(host) + SERVICE_PATH + '/' + path
  try:
    async with httpx.AsyncClient(timeout=12, follow_redirects=False, trust_env=False) as client:
      async with client.stream('POST' if body is not None else 'GET', url, json=body) as response:
        raw = b''
        async for chunk in response.aiter_bytes():
          raw += chunk
          if len(raw) > MAX_PEER_RESPONSE:
            raise Problem('The town sent too much data.', 502)
    data = json.loads(raw) if raw else {}
  except Problem:
    raise
  except Exception:
    raise Problem('Mobius Town is unreachable right now. You can keep exploring on your own.', 502)
  if response.status_code == 429:
    raise Problem('The town is very busy right now.', 429)
  if response.status_code >= 400:
    message = data.get('error') if isinstance(data, dict) else None
    raise Problem(message or 'The town refused the request.', response.status_code if response.status_code < 500 else 502)
  return data


# --- This installation's player ---------------------------------------------------------------------------

def body_cid(body) -> str:
  cid = body.get('cid') if isinstance(body, dict) else None
  require(isinstance(cid, str) and CID.match(cid), 'Invalid client id.')
  return cid


async def remote_session(ctx: Ctx, cid: str, fresh: bool = False) -> dict:
  """Return this player's hub session, proving identity to the hub when needed."""
  with local_db(ctx) as db:
    row = db.execute('SELECT * FROM hub_sessions WHERE cid = ?', (cid,)).fetchone()
  if row and not fresh and time.time() - row['created'] < hub.SESSION_SECONDS - 600:
    return dict(row)
  me = await require_handle(ctx)
  command = {'action': 'session', 'actor': me['handle'], 'body': {'cid': cid}, 'request_id': secrets.token_hex(8)}
  key = secrets.token_hex(32)
  expires = time.time() + PROOF_SECONDS
  proof = {'digest': digest(command), 'actor': me['handle'], 'target': HUB_HOST, 'expires': expires}
  with local_db(ctx) as db:
    db.execute('DELETE FROM proofs WHERE expires < ?', (time.time(),))
    db.execute('INSERT INTO proofs VALUES (?,?,?)', (key, json.dumps(proof), expires))
  result = await peer(HUB_HOST, 'exchange', {'sender': ctx.host, 'proof': key, 'request': command})
  require(isinstance(result, dict) and isinstance(result.get('token'), str) and isinstance(result.get('pid'), str),
          'The town did not open a session.', 502)
  session = {'cid': cid, 'token': result['token'], 'pid': result['pid'], 'handle': me['handle'], 'created': time.time()}
  with local_db(ctx) as db:
    db.execute('INSERT OR REPLACE INTO hub_sessions VALUES (?,?,?,?,?)',
               (cid, session['token'], session['pid'], session['handle'], session['created']))
  return session


async def forward(ctx: Ctx, cid: str, path: str, body: dict):
  session = await remote_session(ctx, cid)
  try:
    return await peer(HUB_HOST, 's/' + path, {**body, 'session': session['token']})
  except Problem as exc:
    if exc.status != 401:
      raise
  session = await remote_session(ctx, cid, fresh=True)
  return await peer(HUB_HOST, 's/' + path, {**body, 'session': session['token']})


async def own_request(ctx: Ctx, req: dict):
  path, method = req.get('path') or '', req.get('method')
  body = req.get('body') if isinstance(req.get('body'), dict) else {}
  require(method == 'POST', 'Not found.', 404)
  if path == 'hello':
    me = await identity(ctx)
    return {'me': me if me['handle'] else None, 'hub': HUB_HOST, 'isHub': ctx.is_hub,
            'problem': None if me['handle'] and not me['unavailable'] else
            'Connect a Möbius account with an @handle (in Möbius · You) to meet people in Mobius Town.'}
  cid = body_cid(body)
  if path == 'join':
    me = await require_handle(ctx)
    if ctx.is_hub:
      with hub_db(ctx) as db:
        pid = hub.local_pid(db, me['handle'], cid)
      return {'pid': pid, 'handle': me['handle']}
    session = await remote_session(ctx, cid, fresh=True)
    return {'pid': session['pid'], 'handle': session['handle']}
  if path in ('sync', 'act', 'leave'):
    if not ctx.is_hub:
      return await forward(ctx, cid, path, body)
    me = await require_handle(ctx)
    with hub_db(ctx) as db:
      pid = hub.local_pid(db, me['handle'], cid)
      if path == 'sync':
        return hub.sync(db, pid, me['handle'], HUB_HOST, cid, body)
      if path == 'act':
        return hub.act(db, pid, body)
      return hub.leave(db, pid)
  raise Problem('Not found.', 404)


# --- Requests from other installations ------------------------------------------------------------------

async def public_request(ctx: Ctx, req: dict):
  path, method = req.get('path') or '', req.get('method')
  body = req.get('body')
  if path.startswith('proof/') and method == 'GET':
    key = path[len('proof/'):]
    require(re.fullmatch(r'[a-f0-9]{64}', key), 'Proof not found.', 404)
    with local_db(ctx) as db:
      row = db.execute('SELECT document, expires FROM proofs WHERE id = ?', (key,)).fetchone()
    require(row is not None and row['expires'] > time.time(), 'Proof expired.', 403)
    return json.loads(row['document'])
  require(ctx.is_hub, 'This installation does not host Mobius Town.', 404)
  require(method == 'POST' and isinstance(body, dict), 'Not found.', 404)
  if path == 'exchange':
    require(set(body) == {'sender', 'proof', 'request'}, 'Invalid request.')
    sender, key, command = body['sender'], body['proof'], body['request']
    require(isinstance(sender, str) and isinstance(key, str) and re.fullmatch(r'[a-f0-9]{64}', key), 'Invalid proof.')
    require(isinstance(command, dict) and set(command) == {'action', 'actor', 'body', 'request_id'}
            and command['action'] == 'session' and isinstance(command['body'], dict), 'Invalid request.')
    handle = command['actor']
    require(isinstance(handle, str) and hub.HANDLE.match(handle), 'Invalid Möbius handle.', 403)
    cid = body_cid(command['body'])
    sender = sender.lower()
    require(sender in await hosts_of(ctx, handle), 'That installation does not belong to this Möbius ID.', 403)
    proof = await peer(sender, 'proof/' + key)
    require(isinstance(proof, dict) and proof.get('digest') == digest(command) and proof.get('target') == ctx.host
            and proof.get('actor') == handle and isinstance(proof.get('expires'), (int, float))
            and time.time() < proof['expires'] <= time.time() + PROOF_SECONDS + 5,
            "The identity proof doesn't match.", 403)
    with hub_db(ctx) as db:
      token, pid = hub.open_session(db, handle, sender, cid)
    return {'token': token, 'pid': pid}
  if path in ('s/sync', 's/act', 's/leave'):
    with hub_db(ctx) as db:
      session = hub.session_for(db, body.get('session'))
      pid = session['pid']
      if path == 's/sync':
        return hub.sync(db, pid, session['handle'], session['host'], session['cid'], body)
      if path == 's/act':
        return hub.act(db, pid, body)
      return hub.leave(db, pid)
  raise Problem('Not found.', 404)


async def main(req) -> dict:
  require(isinstance(req, dict) and req.get('schema') == 1, 'Invalid service request.')
  ctx = Ctx()
  if req.get('public'):
    return await public_request(ctx, req)
  scope = (req.get('actor') or {}).get('scope')
  require(scope in ('owner', 'app', 'agent'), 'Open Mobius Town from your signed-in Möbius.', 403)
  return await own_request(ctx, req)


if __name__ == '__main__':
  try:
    print(json.dumps({'status': 200, 'body': asyncio.run(main(json.load(sys.stdin))),
                      'headers': {'Cache-Control': 'no-store'}}))
  except Problem as exc:
    print(json.dumps({'status': exc.status, 'body': {'error': exc.message}}))
  except Exception as exc:
    print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
    print(json.dumps({'status': 500, 'body': {'error': 'Mobius Town could not complete this request. Please retry.'}}))
