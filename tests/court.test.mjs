// Tests for court games: the runtime games/court-sdk.js, the volleyball cartridge
// games/cartridges/volleyball.js and the forge harness forge/cartridge_test.mjs (node --test,
// no packages).
//
//   node --test tests/court.test.mjs
//
// Matches are seeded, so every run plays the same games. Rule tests drive the cartridge
// directly with people who press nothing, set up the moment they need in the state, and step.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { Worker } from 'node:worker_threads'
import {
  COURT_WORKER_SOURCE, SLOT_IDS, createCourtRuntime, courtWorkerMain, lerpView, sanitizeView, validateMeta,
  validateOptions, validateView,
} from '../games/court-sdk.js'
import { formatReport, testCartridge } from '../forge/cartridge_test.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CODE = readFileSync(new URL('../games/cartridges/volleyball.js', import.meta.url), 'utf8')
const COURT = { w: 192, h: 112 } // 12 x 7 tiles
const NET = COURT.w / 2
const LEVELS = ['easy', 'medium', 'hard']

/** The cartridge's game object, evaluated like the runtime does (plain script, strict). */
function loadGame(code = CODE) {
  return new Function('"use strict";\n' + code + '\n;return game;')() // eslint-disable-line no-new-func
}
const game = loadGame()
const META = validateMeta(game.meta).meta

/** Players for the cartridge: bots[i] is a level, or null for a person. */
function lineup(bots = [null, null, null, null]) {
  return SLOT_IDS(META).map((slot, i) => ({ slot, team: slot.slice(0, -1), index: Number(slot.slice(-1)), bot: bots[i], name: slot }))
}

/** A match driven directly: people press nothing unless `inputs` says so; bots play. */
function newMatch({ bots, seed = 1, points = 11, court = COURT } = {}) {
  const players = lineup(bots)
  const ctx = { players, court, seed, options: { points } }
  return { s: game.init(ctx), players, ctx }
}

function step(m, ticks = 1, inputs = {}) {
  const events = []
  for (let i = 0; i < ticks; i++) {
    const all = { ...inputs }
    for (const p of m.players) if (p.bot) all[p.slot] = game.bot(m.s, p.slot, p.bot)
    events.push(...(game.step(m.s, all, 1 / 60) || []))
  }
  return events
}

const types = (events) => events.map((e) => (e.type === 'sound' ? `sound:${e.name}` : e.type === 'banner' ? `banner:${e.text}` : e.type))

/** Put the ball in play: falling at (x, y, z) after `team`'s touch number `touches`. */
function rally(m, { x, y = 56, z = 20, vx = 0, vy = 0, vz = 0, team = 0, touches = 1, kind = 'pass' }) {
  const s = m.s
  Object.assign(s, { phase: 'rally', phaseTick: 0, touchTeam: team, touches, kind, lastHit: team * 2, lock: 0, announce: false })
  Object.assign(s.ball, { x, y, z, vx, vy, vz })
}

/** Step until the rally ends (or `ticks` run out); returns the events. */
function playOut(m, ticks = 240, inputs = {}) {
  const events = []
  for (let i = 0; i < ticks && m.s.phase === 'rally'; i++) events.push(...step(m, 1, inputs))
  return events
}

/** Load a cartridge on a fresh runtime as host; returns { rt, ready }. */
function host(code = CODE, { bots = ['medium', 'medium', 'medium', 'medium'], seed = 1, options = {}, court = COURT } = {}) {
  const rt = createCourtRuntime()
  const players = SLOT_IDS(META).map((slot, i) => ({ slot, bot: bots[i], name: slot }))
  const ready = rt.handle({ t: 'load', code, players, court, seed, options, role: 'host' })
  return { rt, ready, players }
}

/** Play a whole all-bot match through the runtime. */
function botMatch(levels, seed, court = COURT) {
  const { rt } = host(CODE, { bots: levels, seed, court })
  let frames = 0, hits = 0, points = 0, end = null
  while (!end && frames < 20000) {
    const f = rt.handle({ t: 'step', frames: 6, inputs: {} })
    assert.equal(f.t, 'frame', f.message)
    assert.equal(f.warnings, undefined, JSON.stringify(f.warnings))
    frames += 6
    for (const e of f.events) {
      if (e.type === 'sound' && (e.name === 'click' || e.name === 'whoosh')) hits++
      if (e.type === 'score') points++
      if (e.type === 'end') end = e
    }
  }
  return { end, seconds: frames / 60, points, hitsPerPoint: hits / Math.max(1, points) }
}

/** Run worker source in a node worker with `self` as its global, like a browser worker. */
function nodeWorker(source) {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (m) => parentPort.postMessage(m);
    parentPort.on('message', (data) => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data }); });
    ${source}
  `, { eval: true })
  const waiting = []
  worker.on('message', (m) => waiting.shift()?.(m))
  return { call: (msg) => new Promise((resolve) => { waiting.push(resolve); worker.postMessage(msg) }), close: () => worker.terminate() }
}

const PROBE = `const game = {
  meta: { id: 'probe', title: 'Probe', controls: [
    typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof EventSource, typeof importScripts, typeof indexedDB,
    typeof caches, typeof BroadcastChannel, typeof Worker, typeof SharedWorker, typeof setTimeout, typeof postMessage, typeof eval,
    (() => { try { return typeof (function () {}).constructor('return 1') } catch (e) { return 'x' } })(),
    (() => { try { return typeof Function('return 1') } catch (e) { return 'x' } })(),
    typeof Math.sqrt, typeof JSON.stringify ].map((t) => t[0]).join('') },
  init () { return {} }, step () {}, bot () { return {} }, snapshot () { return {} }, restore () { return {} },
  view () { return { draw: [], score: { red: 0, blue: 0 }, clock: null, message: null, over: false } },
}`

// ------------------------------------------------------------------ the runtime

test('runtime: meta, load, step, show, players and restore replies', () => {
  const rt = createCourtRuntime()
  const meta = rt.handle({ t: 'meta', code: CODE, id: 7 })
  assert.equal(meta.t, 'meta')
  assert.equal(meta.id, 7) // an id is echoed
  assert.deepEqual(meta.warnings, [])
  assert.equal(meta.meta.id, 'volleyball')
  assert.deepEqual(meta.meta.teams, [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }])
  assert.equal(meta.meta.perTeam, 2)
  assert.equal(meta.meta.durationSeconds, 300)
  assert.deepEqual(meta.meta.court, { minW: 8, minH: 5 })
  assert.equal(meta.meta.options.points.default, 11)
  assert.deepEqual(meta.meta.props, [{ kind: 'net', at: ['mid', 0], length: 'h', vertical: true }])

  const { rt: h, ready, players } = host(CODE, { seed: 5 })
  assert.equal(ready.t, 'ready')
  assert.deepEqual(ready.options, { points: 11 })
  assert.equal(ready.view.over, false)
  assert.deepEqual(ready.view.score, { red: 0, blue: 0 })
  assert.equal(ready.snap.t, 0)
  assert.equal(ready.warnings, undefined)

  const f = h.handle({ t: 'step', frames: 1, inputs: {} })
  assert.equal(f.t, 'frame')
  assert.ok(Array.isArray(f.events))
  assert.equal(typeof f.ms, 'number')
  assert.ok(f.bytes > 50 && f.bytes < 2048)
  assert.equal(f.snap, undefined) // only when asked
  const g = h.handle({ t: 'step', frames: 99, inputs: {}, snap: true }) // at most 6 steps per message
  assert.equal(g.snap.t, 7)

  const viewer = createCourtRuntime()
  const vready = viewer.handle({ t: 'load', code: CODE, players, court: COURT, seed: 5, options: {}, role: 'view' })
  assert.equal(vready.t, 'ready')
  assert.equal(vready.view, undefined)
  assert.deepEqual(viewer.handle({ t: 'show', snap: g.snap }), { t: 'view', view: g.view })

  // A person leaves red0: a bot takes the place at once.
  assert.equal(h.handle({ t: 'players', players: players.map((p, i) => (i === 0 ? { ...p, bot: null, name: 'Ann' } : p)) }), null)
  assert.equal(h.handle({ t: 'step', frames: 6, inputs: { red0: { mx: 1, my: 0, a: false, b: false } } }).t, 'frame')

  const again = createCourtRuntime()
  again.handle({ t: 'load', code: CODE, players, court: COURT, seed: 5, options: {}, role: 'view' })
  const restored = again.handle({ t: 'restore', snap: g.snap })
  assert.equal(restored.t, 'ready')
  assert.deepEqual(restored.view, g.view)
  assert.deepEqual(restored.snap, g.snap)
  assert.equal(again.handle({ t: 'step', frames: 6, inputs: {} }).t, 'frame') // the new host carries on
})

test('runtime: options get defaults and are clamped', () => {
  assert.deepEqual(host(CODE, { options: { points: 100 } }).ready.options, { points: 25 })
  assert.deepEqual(host(CODE, { options: { points: '7' } }).ready.options, { points: 7 })
  assert.deepEqual(host(CODE, { options: { points: 'lots', colour: 'red' } }).ready.options, { points: 11 })
  const { options, notes } = validateOptions(META, { points: 2.6, colour: 'red' })
  assert.deepEqual(options, { points: 5 })
  assert.equal(notes.length, 2)
  const m = validateMeta({ id: 'x', title: 'X', options: { fast: { type: 'bool', default: false }, mode: { type: 'choice', choices: ['a', 'b'], default: 'a' } } }).meta
  assert.deepEqual(validateOptions(m, { fast: 'true', mode: 'c' }).options, { fast: true, mode: 'a' })
})

test('runtime: every failure is an error reply that says where', () => {
  const rt = createCourtRuntime()
  const players = SLOT_IDS(META).map((slot) => ({ slot, bot: 'easy' }))
  const load = (code, extra = {}) => rt.handle({ t: 'load', code, players, court: COURT, seed: 1, role: 'host', ...extra })
  const check = (reply, where, pattern) => {
    assert.equal(reply.t, 'error', JSON.stringify(reply))
    assert.equal(reply.where, where)
    assert.match(reply.message, pattern)
    assert.ok(reply.message.length <= 300)
  }
  check(rt.handle({ t: 'step', frames: 1 }), 'step', /not hosting/)
  check(rt.handle({ t: 'show', snap: {} }), 'show', /no game/)
  check(rt.handle({ t: 'dance' }), 'message', /unknown message type/)
  check(rt.handle(null), 'message', /messages are objects/)
  check(load('const game = {'), 'load', /SyntaxError/)
  check(load('export const game = {}'), 'load', /plain script/)
  check(load('const game = {}; import("https://example.com/x.js")'), 'load', /cannot load other code/)
  check(load('const game = { meta: {} }'), 'load', /game\.init\(\).*must be a function/)
  check(load('let x = 1'), 'load', /must declare `const game/)
  check(load(CODE.replace("id: 'volleyball'", "id: 'Volley Ball'")), 'load', /meta\.id/)
  check(rt.handle({ t: 'meta', code: CODE.replace("id: 'volleyball'", "id: 'Volley Ball'") }), 'meta', /meta\.id/)
  check(load(CODE, { court: { w: 64, h: 48 } }), 'load', /smaller than this game needs \(8x5\)/)
  check(load(CODE, { players: players.slice(1) }), 'load', /players must list 4 places in the order red0, red1, blue0, blue1/)
  check(load(CODE, { players: players.map((p) => ({ ...p, bot: 'godlike' })) }), 'load', /unknown bot level/)
  // Errors inside the cartridge name the function, and the line in the cartridge.
  const line = CODE.split('\n').findIndex((l) => l.includes('  step(s, inputs) {')) + 2
  assert.equal(load(CODE.replace('  step(s, inputs) {', '  step(s, inputs) {\n    if (s.tick > 2) null.boom')).t, 'ready')
  let err = null
  for (let i = 0; i < 6 && !err; i++) { const r = rt.handle({ t: 'step', frames: 1, inputs: {} }); if (r.t === 'error') err = r }
  check(err, 'step', new RegExp(`TypeError: Cannot read properties of null \\(reading 'boom'\\) \\(line ${line}\\)`))
  assert.equal(load(CODE.replace('  bot(s, slot, level) {', '  bot(s, slot, level) {\n    throw new Error("no bots today")')).t, 'ready')
  check(rt.handle({ t: 'step', frames: 1, inputs: {} }), 'bot', /no bots today/)
  check(load(CODE.replace('  init({ players, court, seed, options }) {', '  init({ players, court, seed, options }) {\n    return null')), 'init', /must return the match state/)
  check(load(CODE.replace('  snapshot(s) {', '  snapshot(s) {\n    return { big: "x".repeat(20000) }')), 'snapshot', /bytes; keep it under 2048/)
  check(load(CODE, { snap: { v: 99 } }), 'restore', /not a volleyball snapshot/)
})

test('runtime: events and views are checked and cleaned; the end is never missed', () => {
  const cart = (step, view, meta = '') => `const game = {
    meta: { id: 'tiny', title: 'Tiny', durationSeconds: 10 ${meta} },
    init () { return { t: 0 } },
    step (s) { s.t++; ${step} },
    bot () { return { mx: 0, my: 0, a: false, b: false } },
    snapshot (s) { return { t: s.t } },
    restore (snap) { return { t: snap.t } },
    view (snap) { ${view} },
  }`
  const okView = 'return { draw: [], score: { red: 0, blue: 0 }, clock: null, message: null, over: false }'
  const players = SLOT_IDS(META).map((slot) => ({ slot, bot: 'easy' }))
  const run = (code) => {
    const rt = createCourtRuntime()
    assert.equal(rt.handle({ t: 'load', code, players, court: COURT, seed: 1, role: 'host' }).t, 'ready')
    return rt
  }
  // Bad events are dropped with a warning; banners are cut to 40 characters.
  let f = run(cart(`return [{ type: 'sound', name: 'kazoo' }, { type: 'banner', text: '${'x'.repeat(50)}' }, { type: 'score', team: 'green', score: { red: 1, blue: 0 } }, { type: 'sound', name: 'pop' }]`, okView)).handle({ t: 'step', frames: 1 })
  assert.deepEqual(f.events, [{ type: 'banner', text: 'x'.repeat(40) }, { type: 'sound', name: 'pop' }])
  assert.equal(f.warnings.length, 3)
  // A view that says over without an end event gets one.
  f = run(cart('', "return { draw: [], score: { red: 2, blue: 1 }, clock: 0, message: 'Done', over: s => 1, winner: 'red' }".replace('s => 1', 'snap.t > 1'))).handle({ t: 'step', frames: 3 })
  assert.deepEqual(f.events, [{ type: 'end', winner: 'red', score: { red: 2, blue: 1 } }])
  assert.match(f.warnings.join(), /no end event/)
  // A match that runs past durationSeconds is ended by the runtime (the leader wins).
  const slow = run(cart('', "return { draw: [], score: { red: 0, blue: 3 }, clock: null, message: null, over: false }"))
  let end = null, frames = 0
  while (!end && frames < 2000) { f = slow.handle({ t: 'step', frames: 6 }); frames += 6; end = f.events.find((e) => e.type === 'end') }
  assert.deepEqual(end, { type: 'end', winner: 'blue', score: { red: 0, blue: 3 } })
  assert.equal(frames, 11 * 60)
  assert.match(f.warnings.join(), /past durationSeconds/)
  // After the end: the final view and no events.
  const after = slow.handle({ t: 'step', frames: 6 })
  assert.deepEqual([after.events, after.view], [[], f.view])
  // Views: unknown items dropped, numbers fixed, positions clamped, strings cut.
  const messy = `return { draw: [
    { t: 'sprite', x: 1, y: 1 }, { t: 'ball', x: NaN, y: 1 }, { t: 'ball', x: 500, y: -90, r: 99, colour: 'url(x)' },
    { t: 'text', x: 10, y: 10, text: '${'y'.repeat(50)}', size: 3 }, { t: 'player', slot: 'green0', x: 1, y: 1 },
    { t: 'player', slot: 'red1', x: 5, y: 6, pose: 'dab', id: 'red1', layer: 'sky' } ],
    score: { red: -1 }, clock: 'soon', message: 7, over: false }`
  f = run(cart('', messy)).handle({ t: 'step', frames: 1 })
  assert.deepEqual(f.view, {
    draw: [
      { t: 'ball', x: 240, y: -48, z: 0, r: 16, colour: '#ffffff' },
      { t: 'text', x: 10, y: 10, size: 6, colour: '#ffffff', text: 'y'.repeat(40) },
      { t: 'player', x: 5, y: 6, z: 0, dir: 'down', pose: 'stand', moving: false, slot: 'red1', id: 'red1' },
    ],
    score: { red: 0, blue: 0 }, clock: null, message: null, over: false,
  })
  assert.equal(f.warnings.length, 5) // at most five per reply
})

test('validateMeta: normalises good metas and rejects bad ones with reasons', () => {
  const minimal = validateMeta({ id: 'tag', title: 'Tag' })
  assert.equal(minimal.ok, true)
  assert.deepEqual(minimal.meta, {
    id: 'tag', title: 'Tag', teams: [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }], perTeam: 2, durationSeconds: 180,
    lobbySeconds: 6, buttons: [], controls: '', court: { minW: 4, minH: 3 }, options: {}, props: [],
  })
  assert.deepEqual(validateMeta({ id: 'tag', title: 'Tag', colour: 'red' }).warnings, ['meta.colour is not a meta field (ignored)'])
  const v = validateMeta(game.meta)
  assert.equal(v.ok, true, v.errors.join('; '))
  const bad = [
    [null, /must be an object/],
    [{ title: 'No id' }, /meta\.id/],
    [{ id: 'Big', title: 'X' }, /meta\.id/],
    [{ id: 'x'.repeat(33), title: 'X' }, /meta\.id/],
    [{ id: 'x', title: '' }, /meta\.title/],
    [{ id: 'x', title: 'x'.repeat(41) }, /meta\.title/],
    [{ id: 'x', title: 'X', teams: [{ id: 'red' }] }, /exactly 2 teams/],
    [{ id: 'x', title: 'X', teams: [{ id: 'red' }, { id: 'red' }] }, /different ids/],
    [{ id: 'x', title: 'X', teams: [{ id: 'Red' }, { id: 'blue' }] }, /teams\[0\]\.id/],
    [{ id: 'x', title: 'X', perTeam: 5 }, /perTeam/],
    [{ id: 'x', title: 'X', perTeam: 1.5 }, /perTeam/],
    [{ id: 'x', title: 'X', durationSeconds: 1000 }, /durationSeconds/],
    [{ id: 'x', title: 'X', lobbySeconds: 2 }, /lobbySeconds/],
    [{ id: 'x', title: 'X', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'a', label: 'C' }] }, /at most 2 buttons/],
    [{ id: 'x', title: 'X', buttons: [{ id: 'c', label: 'C' }] }, /buttons\[0\]\.id/],
    [{ id: 'x', title: 'X', buttons: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }, /twice/],
    [{ id: 'x', title: 'X', controls: 'x'.repeat(121) }, /controls/],
    [{ id: 'x', title: 'X', court: { minW: 1 } }, /court\.minW/],
    [{ id: 'x', title: 'X', options: { n: { type: 'float', default: 1 } } }, /options\.n\.type/],
    [{ id: 'x', title: 'X', options: { n: { type: 'int', min: 1, max: 5, default: 9 } } }, /default must be between/],
    [{ id: 'x', title: 'X', options: { n: { type: 'int', min: 5, max: 1, default: 3 } } }, /min <= max/],
    [{ id: 'x', title: 'X', options: { m: { type: 'choice', choices: ['a'], default: 'b' } } }, /one of its choices/],
    [{ id: 'x', title: 'X', props: [{ at: [0, 0] }] }, /kind/],
    [{ id: 'x', title: 'X', props: [{ kind: 'hoop', at: ['left', 0] }] }, /\.at must be/],
    [{ id: 'x', title: 'X', props: [{ kind: 'net', at: [0, 0], length: 'long' }] }, /\.length/],
  ]
  for (const [meta, pattern] of bad) {
    const r = validateMeta(meta)
    assert.equal(r.ok, false, JSON.stringify(meta))
    assert.equal(r.meta, null)
    assert.match(r.errors.join('; '), pattern, JSON.stringify(meta))
  }
  assert.deepEqual(validateMeta({ id: 'x', title: 'X', props: [{ kind: 'hoop', at: [-1, 'mid'], flip: true }] }).meta.props, [{ kind: 'hoop', at: [-1, 'mid'], flip: true }])
})

test('SLOT_IDS, validateView and sanitizeView', () => {
  assert.deepEqual(SLOT_IDS(META), ['red0', 'red1', 'blue0', 'blue1'])
  assert.deepEqual(SLOT_IDS(validateMeta({ id: 'x', title: 'X', perTeam: 3, teams: [{ id: 'cats' }, { id: 'dogs' }] }).meta), ['cats0', 'cats1', 'cats2', 'dogs0', 'dogs1', 'dogs2'])
  const good = { draw: [{ t: 'ball', id: 'b', x: 10, y: 10, z: 5 }, { t: 'rect', x: 0, y: 0, w: 20, h: 10, colour: '#123', layer: 'ground', alpha: 0.5 }], score: { red: 1, blue: 2 }, clock: 30, message: 'Hi', over: false }
  assert.deepEqual(validateView(good, COURT, META), [])
  assert.deepEqual(sanitizeView(good, COURT, META).draw[1], { t: 'rect', x: 0, y: 0, w: 20, h: 10, colour: '#123', layer: 'ground', alpha: 0.5 })
  const errors = validateView({ draw: [{ t: 'line', x1: 0, y1: 0, x2: 1e4, y2: 0 }, { t: 'circle', x: 1, y: 1, r: 4, fill: 'yes' }], score: { red: 1 }, over: true, winner: 'green' }, COURT, META)
  assert.equal(errors.length, 4)
  assert.match(errors.join('\n'), /x2 = 10000 is outside the court/)
  assert.match(errors.join('\n'), /fill must be true or false/)
  assert.match(errors.join('\n'), /score\.blue/)
  assert.match(errors.join('\n'), /winner must be red, blue or draw/)
  assert.deepEqual(validateView(null, COURT, META), ['view() must return { draw, score, clock, message, over }'])
})

test('lerpView: items with the same id move part way; the rest comes from the newer view', () => {
  const a = { draw: [{ t: 'ball', id: 'ball', x: 0, y: 10, z: 4 }, { t: 'player', id: 'red0', slot: 'red0', x: 50, y: 50, z: 0, pose: 'run' }, { t: 'text', x: 1, y: 1, text: 'old' }], score: { red: 0, blue: 0 }, clock: 10, message: 'a', over: false }
  const b = { draw: [{ t: 'ball', id: 'ball', x: 10, y: 20, z: 8 }, { t: 'player', id: 'red0', slot: 'red0', x: 150, y: 50, z: 0, pose: 'jump' }, { t: 'text', x: 9, y: 9, text: 'new' }, { t: 'circle', id: 'land', x: 4, y: 4, r: 3 }], score: { red: 1, blue: 0 }, clock: 9, message: 'b', over: false }
  const mid = lerpView(a, b, 0.25)
  assert.deepEqual(mid.draw[0], { t: 'ball', id: 'ball', x: 2.5, y: 12.5, z: 5 })
  assert.equal(mid.draw[1], b.draw[1]) // a 100 px jump is a reset, not a slide
  assert.equal(mid.draw[2], b.draw[2]) // no id: from b
  assert.equal(mid.draw[3], b.draw[3]) // new in b
  assert.deepEqual([mid.score, mid.clock, mid.message], [b.score, b.clock, b.message])
  assert.deepEqual(lerpView(a, b, -3).draw[0], { t: 'ball', id: 'ball', x: 0, y: 10, z: 4 })
  assert.equal(lerpView(a, b, 1), b)
  assert.equal(lerpView(null, b, 0.5), b)
  assert.equal(lerpView(a, null, 0.5), a)
  assert.deepEqual(a.draw[0], { t: 'ball', id: 'ball', x: 0, y: 10, z: 4 }) // inputs untouched
})

// ------------------------------------------------------------------ the worker build

test('worker: the shipped source is self-contained and runs a match in a bare context', () => {
  const create = vm.runInNewContext('(' + createCourtRuntime.toString() + ')', { performance })
  const rt = create()
  const players = SLOT_IDS(META).map((slot) => ({ slot, bot: 'hard' }))
  assert.equal(rt.handle({ t: 'load', code: CODE, players, court: COURT, seed: 2, role: 'host' }).t, 'ready')
  for (let i = 0; i < 100; i++) assert.equal(rt.handle({ t: 'step', frames: 6, inputs: {} }).t, 'frame')
  assert.ok(COURT_WORKER_SOURCE.startsWith('(function courtWorkerMain(scope, createRuntime)'))
  assert.ok(COURT_WORKER_SOURCE.endsWith(');'))
})

test('worker: hardening removes network, storage, timers and code generation, then answers', async () => {
  const w = nodeWorker(COURT_WORKER_SOURCE)
  try {
    const probe = await w.call({ t: 'meta', code: PROBE, id: 1 })
    assert.equal(probe.t, 'meta', probe.message)
    // fetch XMLHttpRequest WebSocket EventSource importScripts indexedDB caches BroadcastChannel Worker
    // SharedWorker setTimeout postMessage eval, fn.constructor(), Function(): gone; Math, JSON: there.
    assert.equal(probe.meta.controls, 'uuuuuuuuuuuuuxxff')
    const players = SLOT_IDS(META).map((slot) => ({ slot, bot: 'medium' }))
    const ready = await w.call({ t: 'load', code: CODE, players, court: COURT, seed: 4, role: 'host', id: 2 })
    assert.equal(ready.t, 'ready')
    assert.equal(ready.id, 2)
    const f = await w.call({ t: 'step', frames: 6, inputs: {}, snap: true, id: 3 })
    assert.equal(f.t, 'frame')
    assert.equal(f.snap.t, 6)
    const bad = await w.call({ t: 'load', code: 'const game = { meta: { id: "t", title: "T" }, init () { fetch("https://example.com") } , step () {}, bot () {}, snapshot () {}, restore () {}, view () {} }', players, court: COURT, seed: 1, role: 'host' })
    assert.equal(bad.t, 'error')
    assert.equal(bad.where, 'init')
    assert.match(bad.message, /fetch is not defined/)
  } finally {
    await w.close()
  }
})

test('worker: courtWorkerMain strips the scope and its prototypes, wires replies and catches throws', () => {
  // A realm of its own: the hardening locks code generation away in the realm it runs in.
  const context = vm.createContext({})
  const posted = []
  context.record = (json) => posted.push(JSON.parse(json))
  const scope = vm.runInContext(`
    const proto = { importScripts () {}, caches: {}, WebSocket () {} }
    const scope = Object.create(proto)
    Object.assign(scope, { fetch () {}, indexedDB: {}, setTimeout () {}, navigator: { sendBeacon () {} } })
    scope.postMessage = function (m) { record(JSON.stringify(m)) }
    scope
  `, context)
  const main = vm.runInContext('(' + courtWorkerMain.toString() + ')', context)
  let calls = 0
  main(scope, () => ({
    handle (msg) {
      calls++
      if (msg === 'boom') throw new Error('kaboom')
      return msg === 'quiet' ? null : { t: 'echo', msg }
    },
  }))
  for (const name of ['fetch', 'indexedDB', 'setTimeout', 'postMessage', 'importScripts', 'caches', 'WebSocket']) assert.equal(scope[name], undefined, name)
  assert.equal(scope.navigator.sendBeacon, undefined)
  assert.throws(() => vm.runInContext('(function () {}).constructor("return 1")', context), /cannot generate code/)
  scope.onmessage({ data: 'hi' })
  scope.onmessage({ data: 'quiet' })
  scope.onmessage({ data: 'boom' })
  assert.equal(calls, 3)
  assert.deepEqual(posted, [{ t: 'echo', msg: 'hi' }, { t: 'error', message: 'kaboom', where: 'worker' }])
})

// ------------------------------------------------------------------ volleyball rules

test('volleyball: a serve from behind the back line, by itself after 2 s or on Hit', () => {
  const m = newMatch({ seed: 3 })
  const s = m.s
  assert.equal(s.phase, 'serve')
  const server = s.players.find((p) => p.team === s.serving && p.k === s.rot[s.serving])
  assert.ok(s.serving === 0 ? server.x < 0 : server.x > COURT.w, `server at ${server.x}`)
  const name = s.serving === 0 ? 'Red' : 'Blue'
  assert.deepEqual(types(step(m, 1)), [`banner:${name} serves`])
  const view = game.view(game.snapshot(s))
  assert.equal(view.message, `${name} serves`)
  assert.ok(view.draw.some((d) => d.t === 'circle' && d.id === 'serve'), 'a serve indicator')
  assert.equal(view.draw.find((d) => d.t === 'ball').z > 14, true) // held up
  step(m, 118)
  assert.equal(s.phase, 'serve')
  assert.deepEqual(types(step(m, 1)), ['sound:click']) // 2 s: it goes by itself
  assert.equal(s.phase, 'rally')
  assert.equal(s.kind, 'serve')

  // Pressing Hit serves as soon as allowed (after half a second), and the ball goes over.
  const m2 = newMatch({ seed: 3 })
  const slot = m2.s.players.find((p) => p.team === m2.s.serving && p.k === m2.s.rot[m2.s.serving]).slot
  step(m2, 29, { [slot]: { mx: 0, my: 0, a: true, b: false } })
  assert.equal(m2.s.phase, 'serve')
  step(m2, 1, { [slot]: { mx: 0, my: 0, a: true, b: false } })
  assert.equal(m2.s.phase, 'rally')
  const towards = m2.s.serving === 0 ? 1 : -1
  assert.ok(m2.s.ball.vx * towards > 50)
  const events = playOut(m2)
  assert.deepEqual(events.filter((e) => e.type === 'score').map((e) => e.team), [m2.s.serving === 0 ? 'red' : 'blue']) // nobody touched it: an ace
  assert.match(game.view(game.snapshot(m2.s)).message, /^Ace! Point/)
})

test('volleyball: rally scoring: a ball down in your half is their point, and they serve', () => {
  const m = newMatch({ seed: 1 })
  Object.assign(m.s, { serving: 0, rot: [0, -1] }) // red serves; blue has not served yet
  rally(m, { x: 150, z: 10, team: 0, kind: 'shot' })
  const events = playOut(m)
  assert.deepEqual(events, [{ type: 'sound', name: 'chime' }, { type: 'score', team: 'red', score: { red: 1, blue: 0 } }])
  assert.equal(m.s.phase, 'point')
  assert.equal(game.view(game.snapshot(m.s)).message, 'Point Red')
  rally(m, { x: 40, z: 10, team: 0, kind: 'pass' })
  assert.deepEqual(playOut(m).filter((e) => e.type === 'score'), [{ type: 'score', team: 'blue', score: { red: 1, blue: 1 } }])
  assert.equal(m.s.serving, 1) // the serve changes sides, and blue's first server serves
  assert.equal(m.s.rot[1], 0)
  step(m, 100)
  assert.equal(m.s.phase, 'serve')
  assert.deepEqual(types(step(m, 1)), ['banner:Blue serves'])
})

test('volleyball: out, the net and round the end of the net', () => {
  // Out: against the side that touched it last.
  let m = newMatch()
  rally(m, { x: 120, y: 56, z: 30, vx: 150, vz: 40, team: 1, kind: 'shot' })
  let events = playOut(m)
  assert.deepEqual(events.filter((e) => e.type !== 'sound'), [{ type: 'score', team: 'red', score: { red: 1, blue: 0 } }, { type: 'banner', text: 'Out!' }])
  assert.ok(m.s.ball.x > COURT.w + 1)
  // A ball on the line is in.
  m = newMatch()
  rally(m, { x: 190, y: 112.5, z: 3.5, team: 0, kind: 'shot' })
  assert.deepEqual(playOut(m).filter((e) => e.type === 'score').map((e) => e.team), ['red'])
  // Into the net: a pop, the ball drops on the hitter's side, a point to the others.
  m = newMatch()
  rally(m, { x: 80, z: 12, vx: 120, vz: 10, team: 0, kind: 'shot' })
  events = playOut(m)
  assert.deepEqual(types(events), ['sound:pop', 'sound:chime', 'score', 'banner:Net!'])
  assert.equal(events[2].team, 'blue')
  assert.ok(m.s.ball.x < NET)
  // Over the net but round its end: out.
  m = newMatch()
  rally(m, { x: 90, y: 4, z: 40, vx: 100, vy: -150, vz: 0, team: 0, kind: 'shot' })
  assert.deepEqual(playOut(m).filter((e) => e.type !== 'sound'), [{ type: 'score', team: 'blue', score: { red: 0, blue: 1 } }, { type: 'banner', text: 'Out!' }])
})

test('volleyball: a side may touch the ball three times in a row, not four', () => {
  const m = newMatch()
  const red0 = m.s.players[0]
  Object.assign(red0, { x: 40, y: 56, vx: 0, vy: 0 })
  rally(m, { x: 40, y: 56, z: 14, team: 0, touches: 3, kind: 'shot' })
  const events = step(m, 1, { red0: { mx: 0, my: 0, a: true, b: false } })
  assert.deepEqual(events.filter((e) => e.type !== 'sound'), [{ type: 'score', team: 'blue', score: { red: 0, blue: 1 } }, { type: 'banner', text: 'Four hits!' }])
  // The touches count again once the other side has played it.
  const m2 = newMatch()
  Object.assign(m2.s.players[0], { x: 40, y: 56 })
  rally(m2, { x: 40, y: 56, z: 14, team: 1, touches: 3, kind: 'spike' })
  assert.deepEqual(types(step(m2, 1, { red0: { mx: 0, my: 0, a: true, b: false } })), ['sound:click'])
  assert.deepEqual([m2.s.touchTeam, m2.s.touches, m2.s.kind], [0, 1, 'pass'])
})

test('volleyball: Hit picks the shot: pass, set, then over the net; jump at the net to spike', () => {
  const m = newMatch()
  const [red0, red1] = m.s.players
  const press = { red0: { mx: 0, my: 0, a: true, b: false } }
  Object.assign(red0, { x: 30, y: 40 })
  Object.assign(red1, { x: 60, y: 80 })
  rally(m, { x: 30, y: 40, z: 15, vz: -20, team: 1, touches: 3, kind: 'spike' })
  step(m, 1, press)
  assert.equal(m.s.kind, 'pass')
  let land = landing(m.s.ball, 18) // a pass comes down at the front of our half, by the teammate
  assert.ok(land.x > NET - 40 && land.x < NET - 10, `pass to ${land.x}`)
  assert.ok(Math.abs(land.y - (80 + (56 - 80) * 0.3)) < 6, `pass to y ${land.y}`)

  const m2 = newMatch()
  Object.assign(m2.s.players[0], { x: 70, y: 50 })
  Object.assign(m2.s.players[1], { x: 40, y: 90 })
  rally(m2, { x: 70, y: 50, z: 15, vz: -10, team: 0, touches: 1, kind: 'pass' })
  step(m2, 1, press)
  assert.equal(m2.s.kind, 'set')
  land = landing(m2.s.ball, 26) // a set comes down by the net in front of the attacker
  assert.ok(Math.abs(land.x - (NET - 13)) < 3 && Math.abs(land.y - 90) < 3, `set to ${land.x}, ${land.y}`)

  // Third touch from the back: a placed shot over the net.
  const m3 = newMatch()
  Object.assign(m3.s.players[0], { x: 30, y: 50 })
  rally(m3, { x: 30, y: 50, z: 15, team: 0, touches: 2, kind: 'set' })
  step(m3, 1, press)
  assert.equal(m3.s.kind, 'shot')
  assert.ok(landing(m3.s.ball, 3).x > NET)

  // Jumping at the net: a spike, hard and down, with a whoosh.
  const m4 = newMatch()
  Object.assign(m4.s.players[0], { x: 84, y: 56 })
  step(m4, 1, { red0: { mx: 0, my: 0, a: false, b: true } }) // jump
  step(m4, 12)
  assert.ok(m4.s.players[0].z > 8)
  assert.equal(game.view(game.snapshot(m4.s)).draw.find((d) => d.slot === 'red0').pose, 'jump')
  rally(m4, { x: 84, y: 56, z: 28, team: 0, touches: 2, kind: 'set' })
  Object.assign(m4.s.ball, { x: m4.s.players[0].x, y: m4.s.players[0].y })
  const events = step(m4, 1, { red0: { mx: 1, my: 0, a: true, b: false } }) // aimed deep, straight on
  assert.deepEqual(types(events), ['sound:whoosh'])
  assert.equal(m4.s.kind, 'spike')
  assert.ok(m4.s.ball.vx > 140)
  assert.equal(game.view(game.snapshot(m4.s)).draw.find((d) => d.slot === 'red0').pose, 'reach')
  const finish = playOut(m4)
  assert.deepEqual(finish.filter((e) => e.type !== 'sound'), [{ type: 'score', team: 'red', score: { red: 1, blue: 0 } }, { type: 'banner', text: 'Kill!' }])
})

/** Where the ball comes down through height h. */
function landing(b, h) {
  const t = (b.vz + Math.sqrt(b.vz * b.vz + 2 * 240 * (b.z - h))) / 240
  return { x: b.x + b.vx * t, y: b.y + b.vy * t }
}

test('volleyball: a jumping player at the net blocks a spike', () => {
  const m = newMatch({ seed: 9 })
  const blue0 = m.s.players[2]
  Object.assign(blue0, { x: NET + 5, y: 56, z: 11, vz: 0 })
  rally(m, { x: NET - 3, y: 56, z: 27, vx: 200, vz: -40, team: 0, touches: 3, kind: 'spike' })
  const events = step(m, 1)
  assert.equal(events[0].name, 'pop')
  assert.equal(m.s.kind, 'block')
  assert.deepEqual([m.s.touchTeam, m.s.touches, m.s.lastHit], [1, 0, 2]) // blue touched it; not one of their three
  // Nobody in the air: the spike goes through.
  const m2 = newMatch({ seed: 9 })
  Object.assign(m2.s.players[2], { x: NET + 5, y: 56, z: 0 })
  rally(m2, { x: NET - 3, y: 56, z: 27, vx: 200, vz: -40, team: 0, touches: 3, kind: 'spike' })
  step(m2, 1)
  assert.equal(m2.s.kind, 'spike')
  assert.ok(m2.s.ball.x > NET)
})

test('volleyball: nobody crosses the net or runs off more than a tile beyond the lines', () => {
  const m = newMatch()
  Object.assign(m.s, { phase: 'point', phaseTick: -1000 }) // free running, no serve coming
  step(m, 180, { red0: { mx: 1, my: -1, a: false, b: false }, red1: { mx: -1, my: 1, a: false, b: false }, blue0: { mx: -1, my: 1, a: false, b: false }, blue1: { mx: 1, my: -1, a: false, b: false } })
  const [red0, red1, blue0, blue1] = m.s.players
  assert.deepEqual([red0.x, red0.y], [NET - 5, -14])
  assert.deepEqual([red1.x, red1.y], [-14, COURT.h + 14])
  assert.deepEqual([blue0.x, blue0.y], [NET + 5, COURT.h + 14])
  assert.deepEqual([blue1.x, blue1.y], [COURT.w + 14, -14])
})

test('volleyball: first to the points, by two, at most points + 4; the clock ends it too', () => {
  const won = (score, team, points = 11) => {
    const m = newMatch({ points })
    m.s.score = score.slice()
    rally(m, { x: team === 'red' ? 150 : 40, z: 10, team: team === 'red' ? 0 : 1, kind: 'shot' })
    return { m, events: playOut(m) }
  }
  let { m, events } = won([10, 10], 'red')
  assert.equal(m.s.phase, 'point')
  ;({ m, events } = won([11, 10], 'red'))
  assert.equal(m.s.phase, 'over')
  assert.deepEqual(events.slice(-3), [{ type: 'banner', text: 'Red wins!' }, { type: 'sound', name: 'fanfare' }, { type: 'end', winner: 'red', score: { red: 12, blue: 10 } }])
  const view = game.view(game.snapshot(m.s))
  assert.deepEqual([view.over, view.winner, view.message], [true, 'red', 'Red wins!'])
  assert.deepEqual(step(m, 30), []) // nothing happens after the end
  assert.equal(won([14, 14], 'blue').m.s.phase, 'over') // 15-14: the cap
  assert.equal(won([4, 3], 'red', 5).m.s.phase, 'over') // 5-3 with points: 5
  // Match point is announced before the serve.
  ;({ m } = won([9, 9], 'red'))
  step(m, 100)
  assert.deepEqual(types(step(m, 1)), ['banner:Match point'])
  assert.equal(game.view(game.snapshot(m.s)).message, 'Red serves · match point')
  // The clock: the leader wins when it runs out, or it is a draw.
  for (const [score, winner] of [[[3, 5], 'blue'], [[4, 4], 'draw']]) {
    const c = newMatch()
    Object.assign(c.s, { score, clock: 2, announce: false })
    assert.deepEqual(step(c, 1), [])
    const end = step(c, 1)
    assert.deepEqual(types(end), ['banner:Time!', `banner:${winner === 'draw' ? 'A draw!' : 'Blue wins!'}`, 'sound:fanfare', 'end'])
    assert.equal(end[3].winner, winner)
    assert.deepEqual(game.view(game.snapshot(c.s)).clock, 0)
  }
  assert.equal(game.view(game.snapshot(newMatch().s)).clock, 300)
})

// ------------------------------------------------------------------ bots, determinism, snapshots

test('volleyball: bots finish matches at every level, and better bots win and rally longer', () => {
  const results = {}
  for (const level of LEVELS) {
    results[level] = [1, 2].map((seed) => botMatch([level, level, level, level], seed))
    for (const r of results[level]) {
      assert.ok(r.end, `${level} match ended`)
      assert.ok(r.seconds <= 300)
      assert.ok(Math.max(r.end.score.red, r.end.score.blue) >= 11 || r.seconds >= 299, JSON.stringify(r))
    }
  }
  const rally = (level) => results[level].reduce((a, r) => a + r.hitsPerPoint, 0) / 2
  assert.ok(rally('hard') > rally('easy') + 1, `hard ${rally('hard')} v easy ${rally('easy')} hits per point`)
  for (const seed of [1, 2, 3]) {
    assert.equal(botMatch(['hard', 'hard', 'easy', 'easy'], seed).end.winner, 'red')
    assert.equal(botMatch(['easy', 'easy', 'medium', 'medium'], seed, { w: 128, h: 80 }).end.winner, 'blue')
  }
  // Mixed teams on the smallest court still play out.
  const mixed = botMatch(['easy', 'hard', 'medium', 'hard'], 4, { w: 128, h: 80 })
  assert.ok(mixed.end && mixed.points >= 11)
})

test('volleyball: the same seed and inputs replay the same match', () => {
  const play = (seed) => {
    const { rt } = host(CODE, { bots: [null, 'hard', null, 'easy'], seed })
    const snaps = []
    let held = {}
    for (let i = 0; i < 900; i++) {
      if (i % 20 === 0) held = { red0: { mx: Math.sin(i), my: Math.cos(i * 3), a: i % 40 === 0, b: i % 100 === 0 }, blue0: { mx: -Math.sin(i * 2), my: 0.5, a: true, b: false } }
      const f = rt.handle({ t: 'step', frames: 1, inputs: held, snap: i % 10 === 0 })
      if (f.snap) snaps.push(JSON.stringify(f.snap) + JSON.stringify(f.events))
    }
    return snaps
  }
  const a = play(11)
  assert.deepEqual(play(11), a)
  assert.notDeepEqual(play(12), a)
})

test('volleyball: snapshots are small, round trip through restore, and draw within the limits', () => {
  const m = newMatch({ bots: ['hard', 'medium', 'easy', 'hard'], seed: 6 })
  let checked = 0
  for (let i = 0; i < 60 * 120 && m.s.phase !== 'over'; i++) {
    step(m, 1)
    if (i % 37) continue
    const snap = game.snapshot(m.s)
    const json = JSON.stringify(snap)
    assert.ok(json.length < 400, `${json.length} bytes`)
    const back = game.restore(JSON.parse(json), m.ctx)
    assert.deepEqual(game.snapshot(back), snap)
    const view = game.view(JSON.parse(json))
    assert.deepEqual(validateView(view, COURT, META), [])
    assert.ok(view.draw.length <= 12)
    checked++
  }
  assert.ok(checked > 100)
  // A restored host plays on to the end.
  const r = newMatch({ bots: ['hard', 'hard', 'hard', 'hard'], seed: 2 })
  step(r, 60 * 40)
  const resumed = { ...r, s: game.restore(JSON.parse(JSON.stringify(game.snapshot(r.s))), r.ctx) }
  let ended = false
  for (let i = 0; i < 60 * 300 && !ended; i++) ended = step(resumed, 1).some((e) => e.type === 'end')
  assert.ok(ended)
})

// ------------------------------------------------------------------ the forge harness

test('harness: volleyball passes; the CLI reports, prints JSON and the meta', async () => {
  const report = await testCartridge(CODE, { matches: 2, seed: 3, file: 'volleyball.js' })
  assert.equal(report.ok, true, report.failures.join('\n'))
  assert.equal(report.matches.length, 2)
  assert.ok(report.matches.every((m) => m.ended && m.restore && m.restore.consistent))
  assert.equal(report.worker.ok, true)
  assert.ok(report.timing.avgMs < 1.5 && report.snapshotBytes < 2048)

  const text = formatReport(report)
  assert.match(text, /match 1 {2}12x7 {2}hard,hard v hard,hard/)
  assert.match(text, /match 2 {2}8x5 {3}easy,easy v easy,easy/)
  assert.match(text, /hits\/point/)
  assert.match(text, /PASS: 2 matches, every check passed\./)

  const cli = (...args) => spawnSync(process.execPath, ['forge/cartridge_test.mjs', ...args], { cwd: ROOT, encoding: 'utf8' })
  const run = cli('games/cartridges/volleyball.js', '--matches', '1', '--json')
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.equal(JSON.parse(run.stdout).ok, true)
  const meta = cli('games/cartridges/volleyball.js', '--meta')
  assert.equal(meta.status, 0)
  assert.deepEqual(JSON.parse(meta.stdout).props, [{ kind: 'net', at: ['mid', 0], length: 'h', vertical: true }])
  assert.equal(cli('no/such/game.js').status, 2)
})

test('harness: broken cartridges fail with a reason', async () => {
  // A tiny game that ends after `end` frames; the faults are put in on purpose.
  const tiny = ({ step = '', x = '0', end = 300 } = {}) => `const game = {
    meta: { id: 'tiny', title: 'Tiny', durationSeconds: 10 },
    init ({ seed }) { return { t: 0, r: seed } },
    step (s) { s.t++; ${step}; if (s.t === ${end}) return [{ type: 'end', winner: 'draw', score: { red: 0, blue: 0 } }] },
    bot () { return { mx: 0, my: 0, a: false, b: false } },
    snapshot (s) { return { t: s.t, x: ${x} } },
    restore (snap) { return { t: snap.t, r: 1 } },
    view (snap) { return { draw: [{ t: 'ball', id: 'b', x: 10 + snap.x, y: 10 }], score: { red: 0, blue: 0 }, clock: null, message: null, over: snap.t >= ${end}, winner: 'draw' } },
  }`
  const fine = await testCartridge(tiny({}), { matches: 2 })
  assert.equal(fine.ok, true, fine.failures.join('\n'))
  const cases = [
    [tiny({ step: 'if (s.t === 100) s.oops.x = 1' }), /frame 99: step threw TypeError/],
    [tiny({ x: 'Math.random()' }), /not deterministic/],
    [tiny({ step: 'setTimeout(() => {}, 1)' }), /sandboxed worker step threw ReferenceError: setTimeout is not defined/],
    [tiny({ step: 'for (let i = 0; i < 1e6; i++) s.r = (s.r * 31 + i) % 1000003', end: 120 }), /a frame takes .* ms on average/],
    [tiny({ x: '"x".repeat(3000).length' }), /outside the court/],
    [tiny({}).replace("durationSeconds: 10", "durationSeconds: 10, perTeam: 9"), /meta\.perTeam/],
    [tiny({ end: 99999 }), /the match ran past durationSeconds/],
  ]
  for (const [code, pattern] of cases) {
    const report = await testCartridge(code, { matches: 1 })
    assert.equal(report.ok, false)
    assert.match(report.failures.join('\n'), pattern)
  }
})
