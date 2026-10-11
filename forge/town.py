#!/usr/bin/env python3
"""Möbius Town builder's command line. Read mobius-town-builder.md first.

    python3 /data/apps/mobius-town/forge/town.py look SITE
    python3 /data/apps/mobius-town/forge/town.py build SITE spec.json [--draft] [--replace ID]

It talks to this Möbius's own Möbius Town service with the agent's credentials
(the service forwards to the town's hub), and draws everything locally with the
kit, so only finished pictures travel.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

FORGE = Path(__file__).resolve().parent
APP = FORGE.parent
for path in (str(FORGE), str(APP)):
  if path not in sys.path:
    sys.path.insert(0, path)

SERVICE = 'mobius-town'


class Fail(Exception):
  pass


def api(op: str, **body):
  base = os.environ.get('API_BASE_URL', '').rstrip('/')
  token = os.environ.get('AGENT_TOKEN', '')
  if not base or not token:
    raise Fail('Run this from a Möbius chat: it needs $API_BASE_URL and $AGENT_TOKEN.')
  data = json.dumps({'op': op, **body}).encode()
  req = urllib.request.Request(f'{base}/api/services/{SERVICE}/build', data=data, method='POST', headers={
    'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
  try:
    with urllib.request.urlopen(req, timeout=60) as res:
      return json.loads(res.read() or b'{}')
  except urllib.error.HTTPError as err:
    try:
      detail = json.loads(err.read() or b'{}')
      message = detail.get('error') or detail.get('detail') or str(detail)
    except ValueError:
      message = f'HTTP {err.code}'
    raise Fail(f'The town said: {message}')
  except urllib.error.URLError as err:
    raise Fail(f'Could not reach this Möbius: {err.reason}')


def workdir(name: str) -> Path:
  root = Path(os.environ.get('TMPDIR') or '/tmp') / 'town' / name
  root.mkdir(parents=True, exist_ok=True)
  return root


def fetch_bodies(ids):
  out = {}
  ids = list(ids)
  while ids:
    res = api('bodies', ids=ids[:80])
    for cid, entry in (res.get('bodies') or {}).items():
      out[cid] = entry['body']
    rest = res.get('more') or []
    ids = rest + ids[80:]
    if rest and not res.get('bodies'):
      break
  return out


def bodies_near(index, map_id, window):
  wx, wy, ww, wh = window
  ids = [c['id'] for c in index if c['map'] == map_id and c['area'][0] < wx + ww and wx < c['area'][0] + c['area'][2]
         and c['area'][1] < wy + wh and wy < c['area'][1] + c['area'][3]]
  return fetch_bodies(ids)


# --- commands -----------------------------------------------------------------------------------------

def cmd_look(args):
  import look as L
  import preview as P
  ctx = api('look', site=args.site)
  site = ctx['site']
  m = L.W.Map(site['map'])
  window = P.window_around(m, site['x'], site['y'], 34 if m.outdoor else m.w, 22 if m.outdoor else m.h)
  bodies = bodies_near(ctx['index'], site['map'], window)
  area = L.Area(site['map'], list(bodies.values()), ctx['index'])
  out = workdir(args.site)
  pic = P.save_small(P.render(site['map'], window, list(bodies.values()), person=(site['x'], site['y'], site['dir']),
                              protected=True), out / 'look.png')
  (out / 'context.json').write_text(json.dumps(ctx, indent=1))
  print(L.context_text(ctx, area, window, picture=str(pic)))


def load_spec(path: Path):
  try:
    return json.loads(path.read_text())
  except FileNotFoundError:
    raise Fail(f'{path} not found.')
  except ValueError as err:
    raise Fail(f'{path} is not valid JSON: {err}')


def cmd_build(args):
  import compile as C
  import creations as CR
  import preview as P
  spec_path = Path(args.spec).resolve()
  spec = load_spec(spec_path)
  try:
    body, stored, notes = C.Compiler(spec, spec_path.parent).run()
  except C.SpecError as err:
    raise Fail(f'Spec problem: {err}')
  try:
    CR.validate(body, keeper=True)
  except CR.Problem as err:
    raise Fail(f'Spec problem: {err.message}')
  out = workdir(args.site or 'drafts')
  state_path = out / 'state.json'
  state = json.loads(state_path.read_text()) if state_path.exists() else {}
  replace = args.replace or state.get('creation')
  listing = api('list')
  index = [{'id': c['id'], 'map': c['map'], 'area': c['area'], 'title': c['title'], 'by': {'handle': c['by']}}
           for c in listing.get('creations', [])]
  m = P.W.Map(body['map'])
  window = P.window_for_area(m, body['area'])
  others = {cid: b for cid, b in bodies_near(index, body['map'], window).items() if cid != replace}
  pic = P.save_small(P.render(body['map'], window, list(others.values()) + [body], mark=body['area']),
                     out / ('draft.png' if args.draft else 'preview.png'))
  size = len(json.dumps(body))
  lines = []
  if args.draft:
    lines.append(f'Draft only (not published). Preview: {pic}')
  else:
    if args.site:
      try:
        api('progress', site=args.site, label='Putting it in place', pct=95, area=body['area'])
      except Fail:
        pass
    res = api('put', site=args.site, creation=body, spec=stored, replace=replace)
    state.update({'creation': res['id'], 'rev': res['rev']})
    state_path.write_text(json.dumps(state))
    lines.append(f'Published: {res["id"]} rev {res["rev"]} "{res["title"]}" on {res["map"]} at {res["area"]}. '
                 'Every Möbian in town sees it now.')
    lines.append(f'Preview: {pic}')
  lines.append(f'{len(body["props"])} pieces, {len(body["solid"])} solid tiles, {len(body["seats"])} seats, '
               f'{size // 1024} KB.')
  for n in notes:
    lines.append('Note: ' + n)
  print('\n'.join(lines))


def cmd_progress(args):
  res = api('progress', site=args.site, label=args.text, pct=args.pct, eta=args.eta)
  print(f'Site {res["site"]["id"]}: {res["site"]["label"]}')


def cmd_fail(args):
  api('fail', site=args.site, message=args.text)
  print('Marked as not built.')


def cmd_spec(args):
  res = api('spec', id=args.id)
  spec = res['spec']
  out = workdir(f'edit-{args.id}')
  files = spec.pop('_files', {}) or {}
  for name, content in files.items():
    target = out / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, str) and content.startswith('data:image/png;base64,'):
      import base64
      target.write_bytes(base64.b64decode(content.split(',', 1)[1]))
    else:
      target.write_text(content)
  path = out / 'spec.json'
  path.write_text(json.dumps(spec, indent=1))
  print(f'Spec of {args.id} (rev {res["rev"]}, "{res["title"]}"): {path}\n'
        f'Edit it, then: town.py build SITE {path} --replace {args.id}')


def cmd_remove(args):
  res = api('remove', id=args.id)
  print(f'Removed {res["removed"]} "{res["title"]}".')


def cmd_list(args):
  res = api('list')
  rows = res.get('creations') or []
  print(f'{len(rows)} creations; building is {res.get("policy")}.' + (' You are the keeper.' if res.get('keeper') else ''))
  for c in rows:
    print(f'{c["id"]}  {c["map"]:<7} {str(c["area"]):<18} @{c["by"]:<16} {c["title"]}')


def cmd_begin(args):
  try:
    x, y = (int(v) for v in args.at.split(','))
  except ValueError:
    raise Fail('--at is X,Y in tiles.')
  res = api('begin', map=args.map, at=[x, y], dir=args.dir, text=args.text)
  print(f'Site {res["site"]["id"]} opened. Next: town.py look {res["site"]["id"]}')


def cmd_kit(args):
  import kit
  import world as W
  cat = kit.catalogue()
  if args.kind:
    d = cat['items'].get(args.kind)
    if not d:
      raise Fail(f'No item "{args.kind}". Try: town.py kit --find WORD')
    print(json.dumps({args.kind: d}, indent=1))
    return
  if args.find:
    words = [w.lower() for w in args.find.split()]
    hits = 0
    for name, d in cat['items'].items():
      text = f'{name} {d["doc"]} {" ".join(d["params"])} {" ".join(str(v) for v in d["params"].values())}'.lower()
      if any(w in text for w in words):
        hits += 1
        params = ', '.join(f'{k}: {v}' for k, v in d['params'].items())
        print(f'item {name} {d["foot"][0]}x{d["foot"][1]} [{d["category"]}] — {d["doc"]}' + (f'\n    {params}' if params else ''))
    for name, doc in list(cat['materials'].items()) + list(cat['lines'].items()):
      if any(w in f'{name} {doc}'.lower() for w in words):
        hits += 1
        print(f'paint {name} — {doc}')
    for name in W.sprite_names():
      if any(w in name.lower() for w in words):
        hits += 1
        print(f'atlas sprite {name}')
    if not hits:
      print(f'Nothing matches "{args.find}". Use the closest kit item, an atlas sprite, or draw an image (slow).')
    return
  if args.games:
    games = sorted(p.stem for p in (APP / 'games' / 'cartridges').glob('*.js'))
    for g in games:
      try:
        out = subprocess.run(['node', str(FORGE / 'cartridge_test.mjs'), str(APP / 'games' / 'cartridges' / f'{g}.js'),
                              '--meta'], capture_output=True, text=True, timeout=60)
        meta = json.loads(out.stdout)
        print(f'{g}: {meta.get("title")} — {meta.get("perTeam")} v {meta.get("perTeam")}, court at least '
              f'{(meta.get("court") or {}).get("minW")}x{(meta.get("court") or {}).get("minH")} tiles. '
              f'{meta.get("controls", "")}')
        for k, o in (meta.get('options') or {}).items():
          print(f'  option {k}: {o}')
      except Exception as err:
        print(f'{g}: (could not read: {err})')
    return
  print('ITEMS (kind: params) — place with {"kind": ..., "at": [x, y], ...params}:')
  by_cat = {}
  for name, d in cat['items'].items():
    by_cat.setdefault(d['category'], []).append((name, d))
  for c in sorted(by_cat):
    print(f'\n[{c}]')
    for name, d in by_cat[c]:
      params = ', '.join(f'{k}: {v}' for k, v in d['params'].items())
      print(f'  {name} {d["foot"][0]}x{d["foot"][1]} — {d["doc"]}' + (f'\n      {params}' if params else ''))
  print('\nMATERIALS (paint): ' + ', '.join(f'{k} ({v})' for k, v in cat['materials'].items()))
  print('\nLINES (paint): ' + ', '.join(f'{k} ({v})' for k, v in cat['lines'].items()))
  print('\nEDGES: ' + ', '.join(cat['edges']))
  print('\nCOLOURS: ' + ', '.join(cat['colours']) + ' (or #rrggbb)')
  print('\nATLAS SPRITES ({"kind": "sprite", "name": ...}): ' + ', '.join(W.sprite_names()))
  import creations as CR
  print('\nEFFECTS: ' + ', '.join(CR.EFFECTS) + '\nSOUNDS: ' + ', '.join(CR.SOUNDS) + '\nSONGS: ' + ', '.join(CR.SONGS)
        + '\nLIGHTS: ' + ', '.join(CR.LIGHTS))
  print('\nGAMES: run `town.py kit --games`.')


def cmd_examples(args):
  import examples
  print(examples.text())


def cmd_test_game(args):
  harness = FORGE / 'cartridge_test.mjs'
  if not harness.exists():
    raise Fail('The court-game harness is missing from this town version.')
  res = subprocess.run(['node', str(harness), args.file] + (['--matches', str(args.matches)] if args.matches else []))
  sys.exit(res.returncode)


def main(argv=None):
  ap = argparse.ArgumentParser(prog='town.py', description='Build in Möbius Town.')
  sub = ap.add_subparsers(dest='cmd', required=True)
  p = sub.add_parser('look', help='context for a build request')
  p.add_argument('site')
  p.set_defaults(fn=cmd_look)
  p = sub.add_parser('build', help='compile, check and publish a spec')
  p.add_argument('site', help='the build site id (or "-" when changing a creation without a site)')
  p.add_argument('spec')
  p.add_argument('--draft', action='store_true', help='only render the preview')
  p.add_argument('--replace', help='replace this creation id')
  p.set_defaults(fn=cmd_build)
  p = sub.add_parser('progress', help='update the construction site')
  p.add_argument('site')
  p.add_argument('text')
  p.add_argument('--pct', type=int)
  p.add_argument('--eta', type=int, help='seconds until done')
  p.set_defaults(fn=cmd_progress)
  p = sub.add_parser('fail', help='close a site that could not be built')
  p.add_argument('site')
  p.add_argument('text')
  p.set_defaults(fn=cmd_fail)
  p = sub.add_parser('spec', help='download a creation\'s spec to change it')
  p.add_argument('id')
  p.set_defaults(fn=cmd_spec)
  p = sub.add_parser('remove', help='remove a creation')
  p.add_argument('id')
  p.set_defaults(fn=cmd_remove)
  p = sub.add_parser('list', help='list creations')
  p.set_defaults(fn=cmd_list)
  p = sub.add_parser('begin', help='open a build site from an ordinary chat')
  p.add_argument('--map', required=True)
  p.add_argument('--at', required=True, help='X,Y')
  p.add_argument('--dir', default='down')
  p.add_argument('text')
  p.set_defaults(fn=cmd_begin)
  p = sub.add_parser('kit', help='the catalogue')
  p.add_argument('--games', action='store_true')
  p.add_argument('--kind')
  p.add_argument('--find', help='search items, paints and atlas sprites by words')
  p.set_defaults(fn=cmd_kit)
  p = sub.add_parser('examples', help='example specs')
  p.set_defaults(fn=cmd_examples)
  p = sub.add_parser('test-game', help='test a court game cartridge')
  p.add_argument('file')
  p.add_argument('--matches', type=int)
  p.set_defaults(fn=cmd_test_game)
  args = ap.parse_args(argv)
  if getattr(args, 'site', None) == '-':
    args.site = None
  try:
    args.fn(args)
  except Fail as err:
    print(f'Error: {err}', file=sys.stderr)
    sys.exit(1)


if __name__ == '__main__':
  main()
