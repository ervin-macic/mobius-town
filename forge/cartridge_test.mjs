#!/usr/bin/env node
// Test a court-game cartridge the way Möbius Town will run it.
//
//   node forge/cartridge_test.mjs path/to/game.js [--matches 4] [--seed 1] [--json] [--meta]
//
// It loads the cartridge with the town's own runtime (games/court-sdk.js), then:
//   - validates game.meta (and reports unknown keys);
//   - plays --matches all-bot matches at full speed with mixed bot levels, alternating a typical
//     12x7 court and the smallest court the meta allows; one match also has a person pressing
//     random keys who leaves mid-match (a bot takes the place);
//   - checks that nothing throws, every match sends its end event by meta.durationSeconds, a
//     frame (bots + step + snapshot + view) takes < 1.5 ms on average (CPU time, so a busy or
//     throttled machine does not fail a game) and < 8 ms at most (wall clock, leaving out the
//     slowest 0.1% of frames; a match with slower frames is replayed and each frame counts
//     its faster run: a slow game is slow both times, a machine's pause is not), snapshots
//     are <= 2048 bytes of JSON, views and events are valid (anything the runtime has to clean
//     up counts as a failure), a viewer drawing the host's snapshots sees exactly the host's
//     view, score events match the view, and the final view is over with the end's winner;
//   - restores a fresh host from a snapshot mid-match: its view must match, and it must carry on
//     (the first match to its end);
//   - runs the first seconds again in a sandboxed worker built from COURT_WORKER_SOURCE (no
//     network, no timers, no eval): it must produce exactly the same views (deterministic, and
//     no blocked API used).
// Prints a short report (--json: the full report as JSON); --meta prints only the validated
// meta as JSON (the forge reads props from it). Exit code 0 only if everything passed.
// Node 24, no packages.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { Worker } from 'node:worker_threads'
import { COURT_WORKER_SOURCE, createCourtRuntime, SLOT_IDS } from '../games/court-sdk.js'

export const LIMITS = Object.freeze({
  codeBytes: 120 * 1024,
  avgMs: 1.5,
  maxMs: 8,
  snapshotBytes: 2048,
  viewItems: 60,
})

const TILE = 16
const SNAP_EVERY = 4 // frames: ~15 snapshots a second, like the town
const WARMUP = 60 // frames left out of the max (the engine is still compiling)
const WORKER_FRAMES = 600
const LEVEL_SETS = [
  ['hard', 'hard', 'hard', 'hard'],
  ['easy', 'easy', 'easy', 'easy'],
  ['medium', 'medium', 'medium', 'medium'],
  ['hard', 'easy', 'medium', 'medium'],
  ['medium', 'hard', 'easy', 'hard'],
  ['easy', 'medium', 'hard', 'easy'],
]
const HIT_SOUNDS = new Set(['click', 'whoosh'])

/** A seeded PRNG (mulberry32) for the scripted person. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d

/** Players for a match: levels cycled over the slots; `person` slots get bot: null. */
function lineup(meta, levels, people = []) {
  return SLOT_IDS(meta).map((slot, i) => {
    const person = people.includes(i)
    return { slot, bot: person ? null : levels[i % levels.length], name: person ? 'Person' : 'Bot ' + (i + 1) }
  })
}

/** A syntax check with line numbers (the runtime's own error has none for syntax errors). */
function syntaxError(code, file) {
  try {
    new vm.Script('(function () { "use strict";\n' + code + '\n})', { filename: file, lineOffset: -1 })
    return null
  } catch (err) {
    const where = /:(\d+)\s*$/m.exec(String(err.stack).split('\n')[0]) || /:(\d+)\n/.exec(String(err.stack))
    return `${err.name}: ${err.message}${where ? ` (line ${where[1]})` : ''}`
  }
}

/** The person's input: a new random stick every half second, buttons now and then. */
function personInput(random, frame, held) {
  if (frame % 30 === 0) {
    held.mx = random() * 2 - 1
    held.my = random() * 2 - 1
    held.a = random() < 0.5
    held.b = random() < 0.2
  }
  return { mx: held.mx, my: held.my, a: held.a && frame % 30 < 8, b: held.b && frame % 30 < 4 }
}

/**
 * The host's messages for a match, frame by frame (the same every time, so a match can be
 * replayed): bots everywhere, or a person pressing random keys in the first place who leaves
 * after 15 s (a bot takes over).
 */
function matchScript(opts) {
  const { meta, levels, seed } = opts
  const random = seeded(seed * 7919 + 13)
  const held = { mx: 0, my: 0, a: false, b: false }
  const leaveAt = opts.person ? 60 * 15 : -1
  let players = lineup(meta, levels, opts.person ? [0] : [])
  return {
    players,
    next(at) {
      let change = null
      if (at === leaveAt) change = players = lineup(meta, levels, [])
      const inputs = {}
      for (const p of players) if (!p.bot) inputs[p.slot] = personInput(random, at, held)
      return { change, players, step: { t: 'step', frames: 1, inputs, snap: at % SNAP_EVERY === 0 || at === opts.restoreAt } }
    },
  }
}

/** Wall-clock time of every frame when the match is played again (only the host). */
function replayTimes(opts, frames) {
  const script = matchScript(opts)
  const host = createCourtRuntime()
  host.handle({ t: 'load', code: opts.code, players: script.players, court: opts.court, seed: opts.seed, options: {}, role: 'host' })
  const times = []
  for (let at = 0; at < frames; at++) {
    const { change, step } = script.next(at)
    if (change) host.handle({ t: 'players', players: change })
    const t0 = performance.now()
    host.handle(step)
    if (at >= WARMUP) times.push(performance.now() - t0)
  }
  return times
}

/**
 * Play one match on the host runtime, mirrored by a viewer; returns its stats and failures.
 * opts: { code, meta, court, levels, seed, person, restoreAt, restoreToEnd }
 */
function playMatch(opts) {
  const { code, meta, court, seed } = opts
  const failures = []
  const fail = (msg) => { if (failures.length < 12 && !failures.includes(msg)) failures.push(msg) }
  const script = matchScript(opts)
  let players = script.players
  const host = createCourtRuntime()
  const viewer = createCourtRuntime()
  const stats = {
    court: `${court.w / TILE}x${court.h / TILE}`,
    levels: players.map((p) => p.bot || 'person'),
    seed,
    frames: 0,
    seconds: 0,
    ended: false,
    winner: null,
    score: null,
    points: 0,
    hitsPerPoint: { avg: 0, max: 0 },
    wall: [], // ms per frame, wall clock (after the warm-up)
    cpu: 0, // ms of CPU time on this thread, all frames
    snapshotBytes: 0,
    viewItems: 0,
    sounds: {},
    banners: 0,
    restore: null,
  }
  const load = { t: 'load', code, players, court, seed, options: {} }
  const ready = host.handle({ ...load, role: 'host' })
  if (ready.t !== 'ready') { fail(`load (${ready.where}): ${ready.message}`); return { stats, failures } }
  for (const w of ready.warnings || []) fail(`first view: ${w}`)
  const vready = viewer.handle({ ...load, role: 'view' })
  if (vready.t !== 'ready') fail(`viewer load (${vready.where}): ${vready.message}`)
  const limit = meta.durationSeconds * 60 + 120
  let hits = 0
  const rallies = []
  let lastFrame = null
  let viewMismatch = 0
  while (stats.frames < limit) {
    const at = stats.frames
    const { change, step } = script.next(at)
    if (change) { // the person leaves: a bot takes the place
      players = change
      const r = host.handle({ t: 'players', players })
      if (r !== null) fail(`players (${r.where}): ${r.message}`)
      viewer.handle({ t: 'players', players })
    }
    const wantSnap = step.snap
    const cpu = process.threadCpuUsage()
    const t0 = performance.now()
    const r = host.handle(step)
    const wall = performance.now() - t0
    const used = process.threadCpuUsage(cpu)
    stats.frames++
    if (r.t !== 'frame') { fail(`frame ${at}: ${r.where} threw ${r.message}`); break }
    lastFrame = r
    stats.cpu += (used.user + used.system) / 1000 // ticks of a few ms: right on average, not per frame
    if (at >= WARMUP) stats.wall.push(wall)
    stats.snapshotBytes = Math.max(stats.snapshotBytes, r.bytes)
    stats.viewItems = Math.max(stats.viewItems, r.view.draw.length)
    for (const w of r.warnings || []) fail(`frame ${at}: ${w}`)
    for (const e of r.events) {
      if (e.type === 'sound') {
        stats.sounds[e.name] = (stats.sounds[e.name] || 0) + 1
        if (HIT_SOUNDS.has(e.name)) hits++
      } else if (e.type === 'banner') stats.banners++
      else if (e.type === 'score') {
        stats.points++
        rallies.push(hits)
        hits = 0
        if (!same(e.score, r.view.score)) fail(`frame ${at}: the score event says ${JSON.stringify(e.score)} but the view shows ${JSON.stringify(r.view.score)}`)
      } else if (e.type === 'end') {
        stats.ended = true
        stats.winner = e.winner
        stats.score = e.score
        if (!r.view.over) fail(`frame ${at}: after the end event the view is not over`)
        else if (r.view.winner !== e.winner) fail(`frame ${at}: the end event's winner is ${e.winner} but the view says ${r.view.winner}`)
      }
    }
    if (wantSnap) {
      const shown = viewer.handle({ t: 'show', snap: r.snap })
      if (shown.t !== 'view') fail(`viewer, frame ${at}: ${shown.where} threw ${shown.message}`)
      else if (!same(shown.view, r.view) && viewMismatch++ === 0) fail(`frame ${at}: a viewer drawing the snapshot sees a different view than the host (view() must depend only on the snapshot)`)
    }
    if (at === opts.restoreAt && !stats.ended) stats.restore = restoreCheck(opts, players, r, fail)
    if (stats.ended) break
  }
  stats.seconds = round(stats.frames / 60, 1)
  if (!stats.ended) fail(`no end event after ${stats.seconds} s (durationSeconds is ${meta.durationSeconds})`)
  else if (stats.frames > meta.durationSeconds * 60) fail(`the match ended after ${stats.seconds} s, beyond durationSeconds (${meta.durationSeconds})`)
  if (lastFrame && stats.ended) {
    const again = host.handle({ t: 'step', frames: 2, inputs: {} })
    if (again.t !== 'frame' || again.events.length || !same(again.view, lastFrame.view)) fail('stepping after the end changed the view or sent events')
  }
  if (rallies.length) {
    stats.hitsPerPoint = { avg: round(rallies.reduce((a, b) => a + b, 0) / rallies.length, 2), max: Math.max(...rallies) }
  }
  return { stats, failures }
}

/** A new host restored from a snapshot shows the same view and carries on. */
function restoreCheck(opts, players, frame, fail) {
  const { code, meta, court, seed } = opts
  const fresh = createCourtRuntime()
  const ready = fresh.handle({ t: 'load', code, players, court, seed, options: {}, role: 'host', snap: frame.snap, elapsed: opts.restoreAt / 60 })
  const result = { at: round(opts.restoreAt / 60, 1), consistent: false, carriedOn: 0, ended: false }
  if (ready.t !== 'ready') { fail(`restore: ${ready.where} threw ${ready.message}`); return result }
  result.consistent = same(ready.view, frame.view)
  if (!result.consistent) fail('restore: the restored host shows a different view than the snapshot it came from')
  const until = opts.restoreToEnd ? meta.durationSeconds * 60 + 120 - opts.restoreAt : 600
  for (let i = 0; i < until; i++) {
    const r = fresh.handle({ t: 'step', frames: 1, inputs: {} })
    if (r.t !== 'frame') { fail(`after restore, frame ${i}: ${r.where} threw ${r.message}`); return result }
    for (const w of r.warnings || []) fail(`after restore: ${w}`)
    result.carriedOn++
    if (r.events.some((e) => e.type === 'end')) { result.ended = true; break }
  }
  if (opts.restoreToEnd && !result.ended) fail('after restore the match never ended')
  else if (result.ended && opts.restoreAt + result.carriedOn > meta.durationSeconds * 60) fail('after restore the match ended beyond durationSeconds')
  result.carriedOn = round(result.carriedOn / 60, 1)
  return result
}

/** Run the first frames in a hardened worker (COURT_WORKER_SOURCE) and compare with a direct run. */
async function workerCheck(code, meta, court, levels, seed) {
  const players = lineup(meta, levels)
  const direct = createCourtRuntime()
  const expected = []
  const load = { t: 'load', code, players, court, seed, options: {}, role: 'host' }
  expected.push(direct.handle(load))
  for (let i = 0; i < WORKER_FRAMES; i++) expected.push(direct.handle({ t: 'step', frames: 1, inputs: {} }))
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (m) => parentPort.postMessage(m);
    parentPort.on('message', (data) => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data }); });
    ${COURT_WORKER_SOURCE}
  `, { eval: true })
  // Every message is posted at once and the replies come back in order: one round trip per
  // frame would crawl on a busy machine.
  const replies = []
  const answered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('it stopped answering')), 120000)
    worker.on('message', (m) => { replies.push(m); if (replies.length === WORKER_FRAMES + 1) { clearTimeout(timer); resolve() } })
    worker.on('error', (err) => { clearTimeout(timer); reject(err) })
    worker.on('exit', (code) => { clearTimeout(timer); reject(new Error(`it exited (${code})`)) })
  })
  worker.postMessage(load)
  for (let i = 0; i < WORKER_FRAMES; i++) worker.postMessage({ t: 'step', frames: 1, inputs: {} })
  try {
    await answered
    for (let i = 0; i <= WORKER_FRAMES; i++) {
      const got = replies[i]
      if (got.t === 'error') return { ok: false, frames: i, detail: `in the sandboxed worker ${got.where} threw ${got.message} (no network, storage, timers or eval there)` }
      const want = expected[i]
      if (want.t !== got.t || !same(want.view, got.view) || !same(want.events || [], got.events || [])) {
        return { ok: false, frames: i, detail: `the sandboxed worker's frame ${i} differs from a direct run: the game is not deterministic (use a seeded generator kept in the state, never Math.random or the clock) or depends on a blocked API` }
      }
      if (got.view && got.view.over) return { ok: true, frames: i, detail: `same views as a direct run until the match ended at frame ${i}` }
    }
    return { ok: true, frames: WORKER_FRAMES, detail: `same views as a direct run for ${WORKER_FRAMES} frames` }
  } catch (err) {
    return { ok: false, frames: 0, detail: `the sandboxed worker failed: ${err.message}` }
  } finally {
    await worker.terminate()
  }
}

/** The largest frame time after leaving out the slowest 0.1% (at least 3): a busy machine pauses the process now and then. */
function robustMax(times) {
  if (!times.length) return { max: 0, raw: 0, dropped: 0 }
  const sorted = [...times].sort((a, b) => b - a)
  const dropped = Math.min(sorted.length - 1, Math.max(3, Math.ceil(sorted.length * 0.001)))
  return { max: sorted[dropped], raw: sorted[0], dropped }
}

/** Test a cartridge's source code; resolves to the report (report.ok: everything passed). */
export async function testCartridge(code, { matches = 4, seed = 1, file = 'game.js', worker = true } = {}) {
  const report = { ok: false, file, bytes: Buffer.byteLength(code), meta: null, metaWarnings: [], matches: [], timing: null, snapshotBytes: 0, viewItems: 0, worker: null, failures: [] }
  const failures = report.failures
  if (report.bytes > LIMITS.codeBytes) failures.push(`the cartridge is ${report.bytes} bytes; the limit is ${LIMITS.codeBytes}`)
  const bad = syntaxError(code, file)
  if (bad) { failures.push(bad); return report }
  const got = createCourtRuntime().handle({ t: 'meta', code })
  if (got.t !== 'meta') { failures.push(`${got.where === 'meta' ? 'loading' : got.where}: ${got.message}`); return report }
  const meta = got.meta
  report.meta = meta
  report.metaWarnings = got.warnings || []
  const typical = { w: Math.max(12, meta.court.minW) * TILE, h: Math.max(7, meta.court.minH) * TILE }
  const smallest = { w: meta.court.minW * TILE, h: meta.court.minH * TILE }
  const allWall = []
  let cpu = 0, frames = 0, replayed = 0
  for (let i = 0; i < matches; i++) {
    const court = i % 2 === 0 ? typical : smallest
    const levels = LEVEL_SETS[i % LEVEL_SETS.length]
    const opts = { code, meta, court, levels, seed: seed + i, person: i === 3, restoreAt: 60 * (20 + 7 * i), restoreToEnd: i === 0 }
    const { stats, failures: f } = playMatch(opts)
    let wall = stats.wall
    if (robustMax(wall).max >= LIMITS.maxMs) { // slow frames: the game, or the machine? Play it again
      const again = replayTimes(opts, stats.frames)
      wall = wall.map((t, k) => Math.min(t, again[k] ?? t))
      replayed++
    }
    allWall.push(...wall)
    cpu += stats.cpu
    frames += stats.frames
    const max = robustMax(wall)
    stats.ms = { avg: round(stats.cpu / Math.max(1, stats.frames), 4), max: round(max.max), rawMax: round(max.raw) }
    delete stats.wall
    delete stats.cpu
    report.matches.push(stats)
    for (const msg of f) failures.push(`match ${i + 1} (${stats.court}, ${stats.levels.join('/')}): ${msg}`)
    report.snapshotBytes = Math.max(report.snapshotBytes, stats.snapshotBytes)
    report.viewItems = Math.max(report.viewItems, stats.viewItems)
  }
  const avg = cpu / Math.max(1, frames)
  const max = robustMax(allWall)
  const wallAvg = allWall.length ? allWall.reduce((a, b) => a + b, 0) / allWall.length : 0
  report.timing = { avgMs: round(avg, 4), wallAvgMs: round(wallAvg, 4), maxMs: round(max.max), rawMaxMs: round(max.raw), outliers: max.dropped, frames: allWall.length, replayed }
  if (avg >= LIMITS.avgMs) failures.push(`a frame takes ${round(avg)} ms on average; keep it under ${LIMITS.avgMs} ms`)
  if (max.max >= LIMITS.maxMs) failures.push(`the slowest frames take ${round(max.max)} ms; keep every frame under ${LIMITS.maxMs} ms`)
  if (report.snapshotBytes > LIMITS.snapshotBytes) failures.push(`snapshots reach ${report.snapshotBytes} bytes of JSON; keep them under ${LIMITS.snapshotBytes}`)
  if (worker && matches > 0) {
    report.worker = await workerCheck(code, meta, typical, LEVEL_SETS[0], seed)
    if (!report.worker.ok) failures.push(report.worker.detail)
  }
  report.ok = failures.length === 0
  return report
}

/** The human-readable report. */
export function formatReport(report) {
  const lines = []
  const kb = (report.bytes / 1024).toFixed(1)
  lines.push(`Court game test: ${report.file} (${kb} KB)`)
  const m = report.meta
  if (m) {
    const options = Object.keys(m.options)
    lines.push(`  meta     ${m.id} "${m.title}" · ${m.perTeam} v ${m.perTeam} · ${m.durationSeconds} s · court >= ${m.court.minW}x${m.court.minH}` +
      (options.length ? ` · options: ${options.join(', ')}` : '') + (m.props.length ? ` · props: ${m.props.map((p) => p.kind).join(', ')}` : ''))
    for (const w of report.metaWarnings || []) lines.push(`  note     ${w}`)
  }
  report.matches.forEach((s, i) => {
    const per = m ? m.perTeam : 2
    const sides = `${s.levels.slice(0, per).join(',')} v ${s.levels.slice(per).join(',')}`
    const result = s.ended ? `${s.winner} ${Object.values(s.score).join('-')}` : 'no end'
    const restore = s.restore ? (s.restore.consistent ? `restore@${s.restore.at}s ok` : 'restore MISMATCH') : 'no restore (ended early)'
    lines.push(`  match ${i + 1}  ${s.court.padEnd(5)} ${sides.padEnd(31)} seed ${String(s.seed).padEnd(3)} ${result.padEnd(11)} ${String(s.seconds).padStart(5)} s  ` +
      `${String(s.points).padStart(2)} points  ${s.hitsPerPoint.avg.toFixed(1)} hits/point (max ${s.hitsPerPoint.max})  ` +
      `${s.ms.avg.toFixed(3)} ms/frame (max ${s.ms.max.toFixed(2)})  snapshot <= ${s.snapshotBytes} B  ${restore}`)
  })
  if (report.worker) lines.push(`  worker   ${report.worker.ok ? 'ok: ' : 'FAILED: '}${report.worker.detail}`)
  if (report.timing) {
    const t = report.timing
    lines.push(`  timing   ${t.avgMs.toFixed(3)} ms CPU per frame on average (limit ${LIMITS.avgMs}; ${t.wallAvgMs.toFixed(3)} ms wall clock), ` +
      `slowest ${t.maxMs.toFixed(2)} ms (limit ${LIMITS.maxMs}; ${t.rawMaxMs.toFixed(2)} ms before leaving out the slowest ${t.outliers} of ${t.frames} frames` +
      `${t.replayed ? `, best of two runs for ${t.replayed} match${t.replayed === 1 ? '' : 'es'}` : ''})`)
    lines.push(`  sizes    snapshots <= ${report.snapshotBytes} bytes (limit ${LIMITS.snapshotBytes}), views <= ${report.viewItems} items (limit ${LIMITS.viewItems})`)
  }
  if (report.ok) lines.push(`PASS: ${report.matches.length} matches, every check passed.`)
  else {
    lines.push(`FAIL: ${report.failures.length} problem${report.failures.length === 1 ? '' : 's'}:`)
    for (const f of report.failures) lines.push(`  - ${f}`)
  }
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = { file: null, matches: 4, seed: 1, json: false, meta: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--meta') args.meta = true
    else if (a === '--matches' || a === '--seed') {
      const v = Number(argv[++i])
      if (!Number.isInteger(v) || v < 0) throw new Error(`${a} needs a whole number`)
      args[a.slice(2)] = v
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else if (!args.file) args.file = a
    else throw new Error(`unexpected argument ${a}`)
  }
  if (!args.file) throw new Error('which cartridge? node forge/cartridge_test.mjs path/to/game.js [--matches 4] [--seed 1] [--json] [--meta]')
  return args
}

async function main(argv) {
  let args
  try { args = parseArgs(argv) } catch (err) { console.error(err.message); return 2 }
  let code
  try { code = readFileSync(args.file, 'utf8') } catch (err) { console.error(`cannot read ${args.file}: ${err.message}`); return 2 }
  if (args.meta) {
    const got = createCourtRuntime().handle({ t: 'meta', code })
    if (got.t !== 'meta') { console.error(`${got.where}: ${got.message}`); return 1 }
    console.log(JSON.stringify(got.meta))
    return 0
  }
  const report = await testCartridge(code, { matches: args.matches, seed: args.seed, file: basename(args.file) })
  console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report))
  return report.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
