// Court games for Möbius Town: the runtime that plays a game *cartridge*.
//
// A court is a painted rectangle in town where up to two teams play a game (volleyball,
// basketball, dodgeball...). Like the Football Ground, people walk on and press X to join, bots
// fill the empty places, one player's browser (the host) runs the match and streams compact
// snapshots to everyone else, who draw them smoothly interpolated.
//
// The rules live in a cartridge: a plain JavaScript file that declares `const game = { ... }`.
// Cartridges may be written by an AI builder for one Möbian and are then run in every visitor's
// browser, so each runs in a blob Web Worker (opaque origin, no token) that this module hardens:
// no network, no storage, no page, no nested workers, no code generation. A cartridge can only
// compute and answer through the protocol below; everything it returns is checked and cleaned
// before the town sees it.
//
// ------------------------------------------------------------------------------- the cartridge
//
// Plain ES2020 script: no import/export, no DOM, no timers, no Math.random (use a seeded
// generator kept in the state so matches replay exactly). Top-level helper functions and
// constants are fine; the runtime evaluates the file and takes its top-level `game`.
//
//   const game = {
//     meta: {
//       id: 'volleyball',              // [a-z0-9-]{1,32}
//       title: 'Beach volleyball',     // <= 40 chars
//       teams: [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }],  // exactly 2; ids [a-z]{1,8}
//       perTeam: 2,                    // 1..4 places per team (bots fill empty ones)
//       durationSeconds: 300,          // hard cap (10..900): the match must end by then
//       lobbySeconds: 6,               // 3..20
//       buttons: [{ id: 'a', label: 'Hit' }, { id: 'b', label: 'Jump' }],  // 0..2, ids 'a'/'b', labels <= 12
//       controls: 'Arrows/WASD move · Space hits · Q jumps',  // <= 120 chars, shown in the lobby
//       court: { minW: 8, minH: 5 },   // smallest court in tiles (2..40)
//       options: { points: { type: 'int', min: 5, max: 25, default: 11, doc: 'Points to win' } },
//       props: [{ kind: 'net', at: ['mid', 0], length: 'h', vertical: true }],
//     },
//     init({ players, court, seed, options }) -> state,
//     step(state, inputs, dt) -> events[] | undefined,
//     bot(state, slot, level) -> { mx, my, a, b },
//     snapshot(state) -> small JSON (rounded numbers; <= 2 KB; sent ~15x/s),
//     restore(snap, { players, court, seed, options }) -> state,
//     view(snap) -> { draw: [...], score: { red, blue }, clock: seconds-left | null,
//                     message: string | null, over: bool, winner?: 'red' | 'blue' | 'draw' },
//   }
//
// meta     Defaults when left out: teams red/blue, perTeam 2, durationSeconds 180, lobbySeconds 6,
//          buttons [], controls '', court 4x3, options {}, props []. Unknown keys are ignored.
//   options  Up to 8, each { type, default, doc } with type 'int' | 'number' (+ min, max),
//            'bool', or 'choice' (+ choices: [...]). The builder sets them per court; the runtime
//            fills defaults and clamps before init sees them.
//   props    Up to 24 kit items the town builds on the court with the cartridge (a net, hoops,
//            goals): { kind, at: [x, y], ...kit parameters }. at is a tile offset from the court's
//            top-left; each coordinate is an integer (negative counts from the far edge: -1 is
//            the last column/row), or 'mid' (floor(w / 2) or floor(h / 2)). A `length` of 'w' or
//            'h' means the court's width or height in tiles. Everything else is passed to the kit.
//
// players  [{ slot, team, index, bot, name }] in slot order: every place of the first team, then
//          the second; slot = team id + index ('red0', 'red1', 'blue0', 'blue1'); bot is null for
//          a person, else 'easy' | 'medium' | 'hard'. The entries are live: when someone leaves
//          and a bot takes the place (or the reverse), bot and name change in place.
// court    { w, h }: the court rectangle in world pixels (tiles x 16). All coordinates are
//          relative to its top-left corner; x grows right, y grows down (towards the viewer).
// seed     uint32. Keep a seeded PRNG in the state; never use Math.random or the clock.
// step     Called 60 times a second with dt = 1/60 and inputs for every slot:
//          { mx, my, a, b }, mx and my in [-1, 1] (a stick; keys give -1/0/1 per axis), a and b
//          booleans: the button is down. Bots' inputs come from bot(); an idle person sends zeros.
//          Treat a button held over several steps as one press where that matters.
// bot      Called once per step for every bot place, before step(), with the same state. It may
//          keep memory in the state and draw from the state's PRNG.
// snapshot Everything view() needs and restore() needs to carry on (another browser becomes the
//          host when this one leaves). Round numbers (0.1 px is plenty) and keep it small.
// view     Pure function of a snapshot: it runs on every screen. Draw primitives below.
//
// Events (returned by step):
//   { type: 'sound', name }   name: click pop chime whoosh coin splash sparkle fanfare win lose
//   { type: 'score', team, score: { red, blue } }    a point/goal (the town shows the score)
//   { type: 'banner', text }                          a short on-screen message (<= 40 chars)
//   { type: 'end', winner, score }                    the match is over (winner: a team id or 'draw')
// After 'end' the runtime stops stepping and keeps showing the final view.
//
// Draw primitives, in world pixels from the court's top-left, y down, z = height above the
// ground. Items are depth-sorted by y; `layer: 'ground'` draws flat under everything. Optional
// on every item: id (string/number, <= 32 chars: items with the same id are interpolated between
// snapshots), alpha (0..1). Keep a view to <= 60 items, positions within the court +- 48 px.
//   { t: 'player', id, slot, x, y, z = 0, dir: 'down'|'up'|'left'|'right', moving, pose: 'stand'|'run'|'jump'|'reach' }
//       the town draws the slot's avatar in its team shirt, feet at (x, y - z), with a ground
//       shadow at (x, y) and its name tag.
//   { t: 'ball', id, x, y, z = 0, r = 3, colour = '#ffffff', stripe? }
//       a ball centred at (x, y - z) (z = r rests on the ground) with a shadow at (x, y).
//   { t: 'shadow', x, y, rx = 4, ry = 2 }
//   { t: 'rect', x, y, w, h, colour }               colour: '#rgb', '#rrggbb', '#rrggbbaa',
//   { t: 'line', x1, y1, x2, y2, colour, width = 1 }        a CSS name or rgb()/rgba()
//   { t: 'circle', x, y, r, colour, fill = true }
//   { t: 'text', x, y, text, colour, size = 10 }   text <= 40 chars, size 6..24, centred on (x, y)
//
// ------------------------------------------------------------------------------- the protocol
//
// The town posts messages to the worker; each gets one reply (or none), in order. A message may
// carry an `id`, echoed in its reply. Every failure replies { t: 'error', message (<= 300 chars),
// where } with where = meta | load | init | restore | step | bot | snapshot | view | show |
// players | message | worker (the cartridge function that threw, with its line when the engine
// reports one). A cartridge stuck in an endless loop never replies: terminate the worker when a
// reply is more than a couple of seconds late, and end the match.
//
//   { t: 'meta', code }  ->  { t: 'meta', meta, warnings }   validated, normalised meta (warnings:
//        unknown meta keys); nothing starts
//   { t: 'load', code, players, court: { w, h }, seed, options, role: 'host' | 'view', snap?, elapsed? }
//        -> { t: 'ready', meta, options, view?, snap? }
//        host: state = snap ? restore(snap, ctx) : init(ctx), and the reply carries the first
//        view and snapshot. view: only keeps the game for 'show' (with snap, the reply has its view).
//        elapsed: seconds already played (after a restore), for the duration cap.
//   { t: 'step', frames: 1..6, inputs: { [slot]: { mx, my, a, b } }, snap: bool }    (host)
//        -> { t: 'frame', events, view, ms, bytes, snap?, warnings? }
//        Runs `frames` steps of 1/60 s (bot places from bot(): their entries in inputs are
//        ignored; a person without an entry is idle; mx/my clamped to -1..1, a/b true only for
//        true or 1), then returns the view of the new snapshot (exactly what viewers will draw)
//        and, when asked, the snapshot.
//        ms: time spent; bytes: snapshot size. After 'end' it returns the final view and no
//        events. If view says over without an 'end' event, or the match runs 1 s past
//        durationSeconds, the runtime adds the 'end' event itself (with a warning).
//   { t: 'show', snap }  ->  { t: 'view', view, warnings? }                         (any role)
//   { t: 'players', players }  ->  null (or an error)    lineup change (bots/names), any time
//   { t: 'restore', snap, players?, elapsed? }  ->  { t: 'ready', meta, options, view, snap }
//        become the host from the newest snapshot (the old host left)
//
// Views in replies are always clean: known types, finite numbers, positions clamped to the court
// +- 48 px, strings cut to size, at most 120 items, score as { [team id]: integer }, winner set
// when over. warnings lists what had to be cleaned or dropped (the forge test fails on them).
//
// ------------------------------------------------------------------------------- this module
//
//   createCourtRuntime()          -> { handle(msg) -> reply | null, ...the helpers below }
//   courtWorkerMain(scope, createRuntime)   hardens a worker scope and wires it to a runtime
//   COURT_WORKER_SOURCE           worker source: new Worker(URL.createObjectURL(new Blob([...])));
//                                 '(' + courtWorkerMain + ')(self, ' + createCourtRuntime + ');', after a
//                                 one-line prologue only when the bundler keeps function names
//   validateMeta(meta)            -> { ok, errors, warnings, meta }   (meta normalised, or null)
//   validateOptions(meta, given)  -> { options, notes }               (defaults filled, clamped)
//   validateView(view, court, meta?) -> errors[]                      (strict; [] when valid)
//   sanitizeView(view, court, meta?) -> view                          (what the runtime returns)
//   lerpView(a, b, t)             -> view between two views: x/y/z (and line ends) of items with the
//                                 same t and id move; one that jumped > 48 px is not blended (a reset)
//   SLOT_IDS(meta)                -> ['red0', 'red1', 'blue0', 'blue1'] style ids
//
// Loading: the worker evaluates a cartridge with new Function, which needs 'unsafe-eval' in the
// Content-Security-Policy the blob worker inherits from the page; where that is refused it loads
// the cartridge with importScripts from a blob: URL instead (needs blob: in script-src).
//
// createCourtRuntime and courtWorkerMain are shipped to the worker as source text
// (Function.prototype.toString), so each must stay self-contained: nothing from outside its own
// body but standard globals (the app bundle is minified and module-level names get renamed).
// Keep their syntax plain too (no object spread, optional chaining, classes or async), so no
// bundler helper sneaks in.

/**
 * A court-game runtime. Self-contained: it is shipped to the worker as source text.
 * env (optional, from courtWorkerMain): { loadScript(code) -> game }, used when the page's
 * Content-Security-Policy forbids new Function ('unsafe-eval') but allows blob: scripts.
 */
export function createCourtRuntime(env) {
  'use strict'
  var DT = 1 / 60
  var MAX_FRAMES = 6
  var TILE = 16
  var MARGIN = 48
  var MAX_ITEMS = 60
  var HARD_ITEMS = 120
  var SNAP_BUDGET = 2048
  var SNAP_LIMIT = 16384
  var CODE_LIMIT = 200000
  var MAX_EVENTS = 32
  var SOUNDS = ['click', 'pop', 'chime', 'whoosh', 'coin', 'splash', 'sparkle', 'fanfare', 'win', 'lose']
  var LEVELS = ['easy', 'medium', 'hard']
  var DIRS = ['down', 'up', 'left', 'right']
  var POSES = ['stand', 'run', 'jump', 'reach']
  var FUNCS = ['init', 'step', 'bot', 'snapshot', 'restore', 'view']
  var OPTION_TYPES = ['int', 'number', 'bool', 'choice']
  var COLOUR = /^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]{3,20}|rgba?\(\s*[0-9.]+%?\s*,\s*[0-9.]+%?\s*,\s*[0-9.]+%?\s*(,\s*[0-9.]+%?\s*)?\))$/
  var MODULE_SYNTAX = /^\s*(import|export)\b(?!\s*[(.])/m
  // import(...) anywhere, even with comments before the bracket (strings and comments that say
  // "import (" are refused too: rephrase them). import.meta and static imports fail to parse anyway.
  var DYNAMIC_IMPORT = /(^|[^.\w$])import(\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(\n|$)|<!--[^\n]*(\n|$)|-->[^\n]*(\n|$))*\(/
  var MakeFunction = Function // kept before the worker locks code generation away
  var loadScript = env && typeof env.loadScript === 'function' ? env.loadScript : null
  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) }
  var isNum = function (v) { return typeof v === 'number' && isFinite(v) }
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
  var now = typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? function () { return performance.now() }
    : function () { return Date.now() }

  // The loaded game and, on the host, its match.
  var game = null
  var meta = null
  var ctx = null
  var state = null
  var role = null
  var ended = false
  var finalFrame = null
  var frames = 0
  var capFrames = 0
  var where = 'load'
  var lineBase = -1
  var probed = false

  // ----------------------------------------------------------------------------- meta

  function validateMeta(raw) {
    var errors = []
    var warnings = []
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, errors: ['game.meta must be an object'], warnings: warnings, meta: null }
    }
    var known = ['id', 'title', 'teams', 'perTeam', 'durationSeconds', 'lobbySeconds', 'buttons', 'controls', 'court', 'options', 'props']
    Object.keys(raw).forEach(function (k) { if (known.indexOf(k) < 0) warnings.push('meta.' + k + ' is not a meta field (ignored)') })
    var out = {}
    if (typeof raw.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(raw.id)) errors.push('meta.id must be 1-32 characters of a-z, 0-9 and -')
    out.id = String(raw.id)
    if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.trim().length > 40) errors.push('meta.title must be 1-40 characters')
    out.title = typeof raw.title === 'string' ? raw.title.trim() : ''
    var teams = raw.teams === undefined ? [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }] : raw.teams
    if (!Array.isArray(teams) || teams.length !== 2) {
      errors.push('meta.teams must list exactly 2 teams, like [{ id: "red", name: "Red" }, { id: "blue", name: "Blue" }]')
      out.teams = [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }]
    } else {
      out.teams = teams.map(function (t, i) {
        var ok = t && typeof t === 'object' && typeof t.id === 'string' && /^[a-z]{1,8}$/.test(t.id)
        if (!ok) errors.push('meta.teams[' + i + '].id must be 1-8 letters a-z')
        var id = ok ? t.id : 'team' + i
        var name = t && typeof t.name === 'string' && t.name.trim() ? t.name.trim() : id.charAt(0).toUpperCase() + id.slice(1)
        if (name.length > 16) errors.push('meta.teams[' + i + '].name must be at most 16 characters')
        return { id: id, name: name }
      })
      if (out.teams[0].id === out.teams[1].id) errors.push('meta.teams need two different ids')
    }
    out.perTeam = intField(raw.perTeam, 'meta.perTeam', 2, 1, 4, errors)
    out.durationSeconds = intField(raw.durationSeconds, 'meta.durationSeconds', 180, 10, 900, errors)
    out.lobbySeconds = intField(raw.lobbySeconds, 'meta.lobbySeconds', 6, 3, 20, errors)
    var buttons = raw.buttons === undefined ? [] : raw.buttons
    out.buttons = []
    if (!Array.isArray(buttons) || buttons.length > 2) errors.push('meta.buttons must be a list of at most 2 buttons')
    else {
      buttons.forEach(function (b, i) {
        if (!b || typeof b !== 'object' || (b.id !== 'a' && b.id !== 'b')) { errors.push('meta.buttons[' + i + '].id must be "a" or "b"'); return }
        if (typeof b.label !== 'string' || !b.label.trim() || b.label.trim().length > 12) errors.push('meta.buttons[' + i + '].label must be 1-12 characters')
        if (out.buttons.some(function (o) { return o.id === b.id })) errors.push('meta.buttons has button "' + b.id + '" twice')
        out.buttons.push({ id: b.id, label: typeof b.label === 'string' ? b.label.trim().slice(0, 12) : b.id })
      })
    }
    if (raw.controls !== undefined && (typeof raw.controls !== 'string' || raw.controls.length > 120)) errors.push('meta.controls must be text of at most 120 characters')
    out.controls = typeof raw.controls === 'string' ? raw.controls.trim().slice(0, 120) : ''
    var court = raw.court === undefined ? {} : raw.court
    if (!court || typeof court !== 'object') { errors.push('meta.court must be { minW, minH } in tiles'); court = {} }
    out.court = {
      minW: intField(court.minW, 'meta.court.minW', 4, 2, 40, errors),
      minH: intField(court.minH, 'meta.court.minH', 3, 2, 40, errors),
    }
    out.options = {}
    var options = raw.options === undefined ? {} : raw.options
    if (!options || typeof options !== 'object' || Array.isArray(options)) errors.push('meta.options must be an object of named options')
    else {
      var names = Object.keys(options)
      if (names.length > 8) errors.push('meta.options has ' + names.length + ' options; at most 8')
      names.forEach(function (name) {
        var o = checkOption(name, options[name], errors)
        if (o) out.options[name] = o
      })
    }
    out.props = []
    var props = raw.props === undefined ? [] : raw.props
    if (!Array.isArray(props) || props.length > 24) errors.push('meta.props must be a list of at most 24 kit items')
    else props.forEach(function (p, i) { var c = checkProp(p, 'meta.props[' + i + ']', errors); if (c) out.props.push(c) })
    return { ok: errors.length === 0, errors: errors, warnings: warnings, meta: errors.length ? null : out }
  }

  function intField(v, name, fallback, lo, hi, errors) {
    if (v === undefined) return fallback
    if (!(typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi)) {
      errors.push(name + ' must be a whole number from ' + lo + ' to ' + hi)
      return fallback
    }
    return v
  }

  function checkOption(name, o, errors) {
    var at = 'meta.options.' + name
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,23}$/.test(name)) { errors.push(at + ': option names are 1-24 letters, digits or _'); return null }
    if (!o || typeof o !== 'object' || OPTION_TYPES.indexOf(o.type) < 0) { errors.push(at + '.type must be ' + OPTION_TYPES.join(', ')); return null }
    var out = { type: o.type, default: o.default, doc: typeof o.doc === 'string' ? o.doc.slice(0, 120) : '' }
    if (o.type === 'int' || o.type === 'number') {
      var whole = o.type === 'int'
      var good = function (v) { return isNum(v) && (!whole || Math.floor(v) === v) }
      if (!good(o.min) || !good(o.max) || o.min > o.max) { errors.push(at + ' needs min <= max (' + (whole ? 'whole numbers' : 'numbers') + ')'); return null }
      if (!good(o.default) || o.default < o.min || o.default > o.max) { errors.push(at + '.default must be between min and max'); return null }
      out.min = o.min
      out.max = o.max
    } else if (o.type === 'bool') {
      if (typeof o.default !== 'boolean') { errors.push(at + '.default must be true or false'); return null }
    } else {
      var simple = function (v) { return (typeof v === 'string' && v.length <= 24) || isNum(v) }
      if (!Array.isArray(o.choices) || !o.choices.length || o.choices.length > 12 || !o.choices.every(simple)) {
        errors.push(at + '.choices must list 1-12 short strings or numbers'); return null
      }
      if (o.choices.indexOf(o.default) < 0) { errors.push(at + '.default must be one of its choices'); return null }
      out.choices = o.choices.slice()
    }
    return out
  }

  function checkProp(p, at, errors) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(at + ' must be an object { kind, at: [x, y], ... }'); return null }
    if (typeof p.kind !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(p.kind)) { errors.push(at + '.kind must name a kit item'); return null }
    var coord = function (v) { return v === 'mid' || (typeof v === 'number' && Math.floor(v) === v && Math.abs(v) <= 40) }
    if (!Array.isArray(p.at) || p.at.length !== 2 || !coord(p.at[0]) || !coord(p.at[1])) {
      errors.push(at + '.at must be [x, y] tiles from the court corner (integers, negative from the far edge, or "mid")'); return null
    }
    var out = {}
    var ok = true
    Object.keys(p).forEach(function (k) {
      var v = p[k]
      var json = v === null || typeof v === 'string' || typeof v === 'boolean' || isNum(v) || Array.isArray(v)
      if (!json) { errors.push(at + '.' + k + ' must be plain data'); ok = false }
      out[k] = Array.isArray(v) ? v.slice() : v
    })
    if (p.length !== undefined && p.length !== 'w' && p.length !== 'h' && !(typeof p.length === 'number' && p.length >= 1 && p.length <= 40)) {
      errors.push(at + '.length must be tiles (1-40), "w" or "h"'); ok = false
    }
    return ok ? out : null
  }

  function slotIds(m) {
    var teams = m && Array.isArray(m.teams) && m.teams.length === 2 ? m.teams : [{ id: 'red' }, { id: 'blue' }]
    var n = m && typeof m.perTeam === 'number' && m.perTeam >= 1 && m.perTeam <= 4 ? Math.floor(m.perTeam) : 2
    var out = []
    for (var t = 0; t < 2; t++) for (var i = 0; i < n; i++) out.push(String(teams[t] && teams[t].id) + i)
    return out
  }

  function readOptions(m, given) {
    var options = {}
    var notes = []
    var src = given && typeof given === 'object' && !Array.isArray(given) ? given : {}
    var specs = m && m.options ? m.options : {}
    Object.keys(src).forEach(function (k) { if (!hasOwn(specs, k)) notes.push('unknown option "' + k + '" (ignored)') })
    Object.keys(specs).forEach(function (k) {
      var o = specs[k]
      var v = src[k]
      options[k] = o.default
      if (v === undefined || v === null) return
      if (o.type === 'int' || o.type === 'number') {
        var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
        if (!isNum(n)) { notes.push(k + ': ' + JSON.stringify(v) + ' is not a number; using ' + o.default); return }
        if (o.type === 'int') n = Math.round(n)
        options[k] = clamp(n, o.min, o.max)
        if (options[k] !== n) notes.push(k + ': ' + n + ' is outside ' + o.min + '..' + o.max + '; using ' + options[k])
      } else if (o.type === 'bool') {
        if (v === true || v === 'true' || v === 1) options[k] = true
        else if (v === false || v === 'false' || v === 0) options[k] = false
        else notes.push(k + ': ' + JSON.stringify(v) + ' is not true/false; using ' + o.default)
      } else if (o.choices.indexOf(v) >= 0) options[k] = v
      else notes.push(k + ': ' + JSON.stringify(v) + ' is not one of ' + o.choices.join(', ') + '; using ' + o.default)
    })
    return { options: options, notes: notes }
  }

  function readPlayers(m, list) {
    var ids = slotIds(m)
    if (!Array.isArray(list) || list.length !== ids.length) {
      throw new Error('players must list ' + ids.length + ' places in the order ' + ids.join(', '))
    }
    return list.map(function (entry, i) {
      var e = entry && typeof entry === 'object' ? entry : {}
      if (e.slot !== undefined && e.slot !== ids[i]) throw new Error('players[' + i + '] must be place ' + ids[i] + ', not ' + JSON.stringify(e.slot))
      var bot = e.bot === true ? 'medium' : e.bot ? e.bot : null
      if (bot !== null && LEVELS.indexOf(bot) < 0) throw new Error('players[' + i + ']: unknown bot level ' + JSON.stringify(e.bot))
      var name = typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 24) : bot ? 'Bot' : 'Player'
      return { slot: ids[i], team: m.teams[Math.floor(i / m.perTeam)].id, index: i % m.perTeam, bot: bot, name: name }
    })
  }

  function readCourt(m, court) {
    var w = court && court.w
    var h = court && court.h
    if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0) throw new Error('court must be { w, h } in world pixels')
    if (w > 40 * TILE || h > 40 * TILE) throw new Error('court is larger than 40x40 tiles')
    if (w < m.court.minW * TILE || h < m.court.minH * TILE) {
      throw new Error('a court of ' + (w / TILE) + 'x' + (h / TILE) + ' tiles is smaller than this game needs (' + m.court.minW + 'x' + m.court.minH + ')')
    }
    return { w: w, h: h }
  }

  function readSeed(v) {
    return isNum(v) ? (Math.floor(Math.abs(v)) % 4294967296) >>> 0 : 1
  }

  function readInput(v) {
    if (!v || typeof v !== 'object') return { mx: 0, my: 0, a: false, b: false }
    return {
      mx: isNum(v.mx) ? clamp(v.mx, -1, 1) : 0,
      my: isNum(v.my) ? clamp(v.my, -1, 1) : 0,
      a: v.a === true || v.a === 1,
      b: v.b === true || v.b === 1,
    }
  }

  // ----------------------------------------------------------------------------- events

  function cleanEvent(ev, m) {
    var ids = m ? m.teams.map(function (t) { return t.id }) : null
    if (!ev || typeof ev !== 'object') return { event: null, error: 'an event must be an object' }
    if (ev.type === 'sound') {
      if (SOUNDS.indexOf(ev.name) < 0) return { event: null, error: 'unknown sound ' + JSON.stringify(ev.name) + ' (use ' + SOUNDS.join(' ') + ')' }
      return { event: { type: 'sound', name: ev.name }, error: null }
    }
    if (ev.type === 'banner') {
      if (typeof ev.text !== 'string' || !ev.text.trim()) return { event: null, error: 'a banner needs text' }
      return { event: { type: 'banner', text: ev.text.trim().slice(0, 40) }, error: ev.text.trim().length > 40 ? 'banner text is longer than 40 characters' : null }
    }
    if (ev.type === 'score' || ev.type === 'end') {
      var score = cleanScore(ev.score, ids)
      if (!score) return { event: null, error: ev.type + ' needs score: { ' + (ids || ['red', 'blue']).join(', ') + ' } as whole numbers' }
      if (ev.type === 'score') {
        if (ids ? ids.indexOf(ev.team) < 0 : typeof ev.team !== 'string') return { event: null, error: 'score needs team: one of ' + (ids || []).join(', ') }
        return { event: { type: 'score', team: ev.team, score: score }, error: null }
      }
      if (ev.winner !== 'draw' && (ids ? ids.indexOf(ev.winner) < 0 : typeof ev.winner !== 'string')) return { event: null, error: 'end needs winner: a team id or "draw"' }
      return { event: { type: 'end', winner: ev.winner, score: score }, error: null }
    }
    return { event: null, error: 'unknown event type ' + JSON.stringify(ev.type) + ' (use sound, score, banner, end)' }
  }

  function cleanScore(score, ids) {
    if (!score || typeof score !== 'object') return null
    var keys = ids || Object.keys(score)
    var out = {}
    for (var i = 0; i < keys.length; i++) {
      var v = score[keys[i]]
      if (!(typeof v === 'number' && Math.floor(v) === v && v >= 0)) return null
      out[keys[i]] = v
    }
    return out
  }

  // ----------------------------------------------------------------------------- views

  var ITEM_SPECS = {
    player: { pos: ['x', 'y'], nums: { z: [0, -16, 240] }, enums: { dir: DIRS, pose: POSES }, bools: { moving: false }, slot: true },
    ball: { pos: ['x', 'y'], nums: { z: [0, -16, 240], r: [3, 0.5, 16] }, colours: { colour: '#ffffff', stripe: null } },
    shadow: { pos: ['x', 'y'], nums: { rx: [4, 0.5, 48], ry: [2, 0.5, 48] } },
    rect: { pos: ['x', 'y'], need: ['w', 'h'], nums: { w: [8, 0, 1e9], h: [8, 0, 1e9] }, colours: { colour: '#ffffff' } },
    line: { pos: ['x1', 'y1', 'x2', 'y2'], nums: { width: [1, 0.5, 8] }, colours: { colour: '#ffffff' } },
    circle: { pos: ['x', 'y'], nums: { r: [4, 0.5, 64] }, colours: { colour: '#ffffff' }, bools: { fill: true } },
    text: { pos: ['x', 'y'], nums: { size: [10, 6, 24] }, colours: { colour: '#ffffff' }, text: true },
  }
  var ITEM_TYPES = Object.keys(ITEM_SPECS)

  /** One draw item, checked: { item: cleaned copy or null (dropped), error: first problem or null }. */
  function checkItem(it, court, slots) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { item: null, error: 'a draw item must be an object' }
    if (typeof it.t !== 'string' || !hasOwn(ITEM_SPECS, it.t)) {
      return { item: null, error: 'unknown draw type ' + JSON.stringify(it.t) + ' (use ' + ITEM_TYPES.join(', ') + ')' }
    }
    var spec = ITEM_SPECS[it.t]
    var out = { t: it.t }
    var error = null
    var note = function (e) { if (!error) error = e }
    var w = court && isNum(court.w) ? court.w : 0
    var h = court && isNum(court.h) ? court.h : 0
    var i, k, v
    for (i = 0; i < spec.pos.length; i++) {
      k = spec.pos[i]
      v = it[k]
      if (!isNum(v)) return { item: null, error: it.t + '.' + k + ' must be a number' }
      var vertical = k.charAt(0) === 'y'
      var hi = (vertical ? h : w) + MARGIN
      if (v < -MARGIN || v > hi) { note(it.t + '.' + k + ' = ' + Math.round(v) + ' is outside the court (+- ' + MARGIN + ' px)'); v = clamp(v, -MARGIN, hi) }
      out[k] = v
    }
    if (spec.need) {
      for (i = 0; i < spec.need.length; i++) if (!isNum(it[spec.need[i]])) return { item: null, error: it.t + '.' + spec.need[i] + ' must be a number' }
    }
    var nums = spec.nums || {}
    for (k in nums) {
      var d = nums[k]
      v = it[k]
      if (v === undefined || v === null) { out[k] = d[0]; continue }
      if (!isNum(v)) { note(it.t + '.' + k + ' must be a number'); out[k] = d[0]; continue }
      if (v < d[1] || v > d[2]) { note(it.t + '.' + k + ' = ' + v + ' is outside ' + d[1] + '..' + d[2]); v = clamp(v, d[1], d[2]) }
      out[k] = v
    }
    if (it.t === 'rect') { // keep the whole rectangle near the court
      var maxW = w + MARGIN - out.x
      var maxH = h + MARGIN - out.y
      if (out.w > maxW || out.h > maxH) { note('rect reaches more than ' + MARGIN + ' px beyond the court'); out.w = Math.max(0, Math.min(out.w, maxW)); out.h = Math.max(0, Math.min(out.h, maxH)) }
    }
    var enums = spec.enums || {}
    for (k in enums) {
      v = it[k]
      if (v === undefined || v === null) { out[k] = enums[k][0]; continue }
      if (enums[k].indexOf(v) < 0) { note(it.t + '.' + k + ' must be ' + enums[k].join(', ')); v = enums[k][0] }
      out[k] = v
    }
    var bools = spec.bools || {}
    for (k in bools) {
      v = it[k]
      if (v === undefined || v === null) { out[k] = bools[k]; continue }
      if (typeof v !== 'boolean') note(it.t + '.' + k + ' must be true or false')
      out[k] = !!v
    }
    var colours = spec.colours || {}
    for (k in colours) {
      v = it[k]
      if (v === undefined || v === null) { if (colours[k] !== null) out[k] = colours[k]; continue }
      if (typeof v !== 'string' || v.length > 40 || !COLOUR.test(v)) {
        note(it.t + '.' + k + ' ' + JSON.stringify(v) + ' is not a colour (use #rrggbb)')
        if (colours[k] !== null) out[k] = colours[k]
        continue
      }
      out[k] = v
    }
    if (spec.slot) {
      if (typeof it.slot !== 'string' || (slots && slots.indexOf(it.slot) < 0)) {
        return { item: null, error: 'player.slot must be one of ' + (slots ? slots.join(', ') : 'the slot ids') }
      }
      out.slot = it.slot
    }
    if (spec.text) {
      v = it.text
      if (typeof v === 'number' && isFinite(v)) v = String(v)
      if (typeof v !== 'string' || !v) return { item: null, error: 'text.text must be a non-empty string' }
      if (v.length > 40) { note('text is longer than 40 characters'); v = v.slice(0, 40) }
      out.text = v
    }
    if (it.id !== undefined && it.id !== null) {
      if ((typeof it.id === 'string' && it.id.length <= 32) || isNum(it.id)) out.id = it.id
      else note(it.t + '.id must be a short string or a number')
    }
    if (it.layer !== undefined && it.layer !== null) {
      if (it.layer === 'ground') out.layer = 'ground'
      else note(it.t + '.layer must be "ground" (or left out)')
    }
    if (it.alpha !== undefined && it.alpha !== null) {
      if (isNum(it.alpha)) {
        if (it.alpha < 0 || it.alpha > 1) note(it.t + '.alpha must be 0..1')
        out.alpha = clamp(it.alpha, 0, 1)
      } else note(it.t + '.alpha must be a number 0..1')
    }
    return { item: out, error: error }
  }

  /** { view: clean copy, errors: [...] } */
  function checkView(view, court, m) {
    var errors = []
    var add = function (e) { if (errors.length < 20) errors.push(e) }
    var ids = m ? m.teams.map(function (t) { return t.id }) : null
    var out = { draw: [], score: {}, clock: null, message: null, over: false }
    if (!view || typeof view !== 'object' || Array.isArray(view)) {
      add('view() must return { draw, score, clock, message, over }')
      if (ids) ids.forEach(function (id) { out.score[id] = 0 })
      return { view: out, errors: errors }
    }
    var slots = m ? slotIds(m) : null
    var draw = view.draw
    if (!Array.isArray(draw)) { add('view.draw must be an array of draw items'); draw = [] }
    if (draw.length > MAX_ITEMS) add('view.draw has ' + draw.length + ' items; keep it to ' + MAX_ITEMS)
    var n = Math.min(draw.length, HARD_ITEMS)
    for (var i = 0; i < n; i++) {
      var r = checkItem(draw[i], court, slots)
      if (r.error) add('draw[' + i + '] ' + r.error)
      if (r.item) out.draw.push(r.item)
    }
    var score = view.score && typeof view.score === 'object' ? view.score : null
    if (!score) add('view.score must be an object like { red: 0, blue: 0 }')
    var keys = ids || (score ? Object.keys(score).slice(0, 2) : [])
    keys.forEach(function (id) {
      var v = score ? score[id] : 0
      if (!(typeof v === 'number' && Math.floor(v) === v && v >= 0)) {
        if (score) add('view.score.' + id + ' must be a whole number >= 0')
        v = isNum(v) && v > 0 ? Math.floor(v) : 0
      }
      out.score[id] = Math.min(v, 9999)
    })
    if (view.clock !== null && view.clock !== undefined) {
      if (isNum(view.clock) && view.clock >= 0) out.clock = Math.min(view.clock, 86400)
      else add('view.clock must be seconds left (a number >= 0) or null')
    }
    if (view.message !== null && view.message !== undefined && view.message !== '') {
      if (typeof view.message !== 'string') add('view.message must be a string or null')
      else {
        if (view.message.length > 60) add('view.message is longer than 60 characters')
        out.message = view.message.slice(0, 60)
      }
    }
    if (view.over !== undefined && typeof view.over !== 'boolean') add('view.over must be true or false')
    out.over = view.over === true
    if (out.over) {
      if (view.winner === 'draw' || (ids ? ids.indexOf(view.winner) >= 0 : typeof view.winner === 'string')) out.winner = view.winner
      else { add('view.winner must be ' + (ids ? ids.join(', ') + ' or ' : '') + 'draw when the match is over'); out.winner = 'draw' }
    }
    return { view: out, errors: errors }
  }

  function validateView(view, court, m) {
    return checkView(view, court, m || null).errors
  }

  function sanitizeView(view, court, m) {
    return checkView(view, court, m || null).view
  }

  /** The view a fraction t of the way from a to b: numeric x/y/z (and line ends) of items with the same type and id move; everything else comes from b. */
  function lerpView(a, b, t) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.draw)) return a || b || null
    if (!a || typeof a !== 'object' || !Array.isArray(a.draw) || a === b) return b
    var f = t > 0 ? (t < 1 ? t : 1) : 0
    if (f === 1) return b
    var before = new Map()
    for (var i = 0; i < a.draw.length; i++) {
      var it = a.draw[i]
      if (it && it.id !== undefined && it.id !== null) before.set(it.t + '\u0000' + it.id, it)
    }
    var keys = ['x', 'y', 'z', 'x1', 'y1', 'x2', 'y2']
    var draw = b.draw.map(function (item) {
      if (!item || item.id === undefined || item.id === null) return item
      var from = before.get(item.t + '\u0000' + item.id)
      if (!from) return item
      var k, j
      for (j = 0; j < keys.length; j++) { // a reset or teleport is not blended: nobody slides across the court
        k = keys[j]
        if (k !== 'z' && isNum(from[k]) && isNum(item[k]) && Math.abs(item[k] - from[k]) > MARGIN) return item
      }
      var out = Object.assign({}, item)
      for (j = 0; j < keys.length; j++) {
        k = keys[j]
        if (isNum(from[k]) && isNum(item[k])) out[k] = from[k] + (item[k] - from[k]) * f
      }
      return out
    })
    return Object.assign({}, b, { draw: draw })
  }

  // ----------------------------------------------------------------------------- loading

  function describe(err) {
    if (err && typeof err === 'object' && typeof err.message === 'string') {
      var name = typeof err.name === 'string' && err.name ? err.name : 'Error'
      var line = lineOf(err)
      return (name === 'Error' ? '' : name + ': ') + err.message + (line > 0 ? ' (line ' + line + ')' : '')
    }
    try { return String(err) } catch (e) { return 'unknown error' }
  }

  function lineOf(err) {
    if (lineBase < 0) return 0
    var stack = typeof err.stack === 'string' ? err.stack : ''
    var m = /<anonymous>:(\d+):\d+/.exec(stack) || /> Function:(\d+):\d+/.exec(stack)
    return m ? Number(m[1]) - lineBase + 1 : 0
  }

  function probeLines() { // which reported line is the cartridge's first line, in this engine
    try {
      var probe = new MakeFunction('"use strict";\nreturn new Error("probe")')()
      var stack = typeof probe.stack === 'string' ? probe.stack : ''
      var m = /<anonymous>:(\d+):\d+/.exec(stack) || /> Function:(\d+):\d+/.exec(stack)
      lineBase = m ? Number(m[1]) : 0
    } catch (e) { lineBase = 0 }
    if (!lineBase) lineBase = -1
  }

  function evaluate(code, at) {
    where = at || 'load'
    if (typeof code !== 'string' || !code.trim()) throw new Error('no cartridge code was given')
    if (code.length > CODE_LIMIT) throw new Error('the cartridge is ' + code.length + ' characters; the limit is ' + CODE_LIMIT)
    if (MODULE_SYNTAX.test(code)) throw new Error('a cartridge is a plain script: remove import/export and declare `const game = { ... }`')
    if (DYNAMIC_IMPORT.test(code)) throw new Error('a cartridge cannot load other code: remove import()')
    if (!probed) { probed = true; probeLines() }
    var g
    try {
      g = new MakeFunction('"use strict";\n' + code + '\n;return typeof game === "undefined" ? undefined : game;')()
    } catch (err) {
      // A Content-Security-Policy without 'unsafe-eval' refuses new Function: load it as a script.
      if (!loadScript || !err || err.name !== 'EvalError' || !/unsafe-eval|CSP|Content.Security/i.test(String(err.message))) throw err
      g = loadScript(code)
    }
    if (!g || typeof g !== 'object') throw new Error('the cartridge must declare `const game = { meta, init, step, bot, snapshot, restore, view }` at its top level')
    var missing = FUNCS.filter(function (k) { return typeof g[k] !== 'function' })
    if (missing.length) throw new Error('game.' + missing.join('(), game.') + '() must be a function')
    var checked = validateMeta(g.meta)
    if (!checked.ok) throw new Error('bad meta: ' + checked.errors.join('; '))
    return { game: g, meta: checked.meta, warnings: checked.warnings }
  }

  function fail(at, err) {
    var message = typeof err === 'string' ? err : describe(err)
    if (/\bgame is not defined\b/.test(message)) message += ' (declare it with `const game = { ... }`)'
    return { t: 'error', message: message.slice(0, 300), where: at }
  }

  function clone(v) {
    if (v === undefined) return undefined
    return JSON.parse(JSON.stringify(v))
  }

  // ----------------------------------------------------------------------------- the match

  function makeFrame() {
    where = 'snapshot'
    var snap = game.snapshot(state)
    var json = JSON.stringify(snap)
    if (typeof json !== 'string') throw new Error('snapshot() must return JSON data')
    if (json.length > SNAP_LIMIT) throw new Error('the snapshot is ' + json.length + ' bytes; keep it under ' + SNAP_BUDGET)
    where = 'view'
    var checked = checkView(game.view(JSON.parse(json)), ctx.court, meta)
    return { view: checked.view, problems: checked.errors, json: json }
  }

  function startMatch(snap, elapsed) {
    where = snap !== undefined && snap !== null ? 'restore' : 'init'
    state = where === 'restore' ? game.restore(clone(snap), ctx) : game.init(ctx)
    if (state === undefined || state === null) throw new Error(where + '() must return the match state')
    role = 'host'
    ended = false
    finalFrame = null
    frames = isNum(elapsed) && elapsed > 0 ? Math.round(elapsed * 60) : 0
    capFrames = (meta.durationSeconds + 1) * 60
    var fr = makeFrame()
    if (fr.view.over) { ended = true; finalFrame = fr }
    var reply = { t: 'ready', meta: meta, options: ctx.options, view: fr.view, snap: JSON.parse(fr.json) }
    if (fr.problems.length) reply.warnings = fr.problems.slice(0, 5)
    return reply
  }

  function onLoad(msg) {
    game = null
    meta = null
    ctx = null
    state = null
    role = null
    ended = false
    finalFrame = null
    var loaded = evaluate(msg.code)
    var m = loaded.meta
    var court = readCourt(m, msg.court)
    var players = readPlayers(m, msg.players)
    var options = readOptions(m, msg.options).options
    game = loaded.game
    meta = m
    ctx = { players: players, court: court, seed: readSeed(msg.seed), options: options }
    if (msg.role === 'view') {
      role = 'view'
      var reply = { t: 'ready', meta: meta, options: options }
      if (msg.snap !== undefined && msg.snap !== null) reply.view = show(msg.snap).view
      return reply
    }
    return startMatch(msg.snap, msg.elapsed)
  }

  function onStep(msg) {
    if (role !== 'host' || !game || state === null) return fail('step', 'not hosting a match: send load with role "host" (or restore) first')
    var started = now()
    var count = isNum(msg.frames) ? clamp(Math.round(msg.frames), 1, MAX_FRAMES) : 1
    var given = msg.inputs && typeof msg.inputs === 'object' ? msg.inputs : {}
    var events = []
    var warnings = []
    var warn = function (w) { if (warnings.length < 5 && warnings.indexOf(w) < 0) warnings.push(w) }
    var players = ctx.players
    for (var f = 0; f < count && !ended; f++) {
      var inputs = {}
      for (var i = 0; i < players.length; i++) {
        var p = players[i]
        if (p.bot) {
          where = 'bot'
          inputs[p.slot] = readInput(game.bot(state, p.slot, p.bot))
        } else inputs[p.slot] = readInput(hasOwn(given, p.slot) ? given[p.slot] : null)
      }
      where = 'step'
      var out = game.step(state, inputs, DT)
      frames++
      if (out !== undefined && out !== null) {
        if (!Array.isArray(out)) warn('step() must return an array of events (or nothing)')
        else {
          for (var e = 0; e < out.length; e++) {
            var c = cleanEvent(out[e], meta)
            if (c.error) warn('event ' + c.error)
            if (!c.event) continue
            if (c.event.type === 'end') {
              if (ended) continue // one end is enough
              ended = true
            }
            if (events.length < MAX_EVENTS || c.event.type === 'end') events.push(c.event)
            else warn('more than ' + MAX_EVENTS + ' events in one frame')
          }
        }
      }
    }
    var fr
    if (ended && finalFrame) fr = finalFrame
    else {
      fr = makeFrame()
      if (!ended && (fr.view.over || frames >= capFrames)) {
        warn(fr.view.over ? 'view says over but step() sent no end event' : 'the match ran past durationSeconds')
        events.push({ type: 'end', winner: leader(fr.view), score: Object.assign({}, fr.view.score) })
        ended = true
      }
      if (ended) finalFrame = fr
    }
    for (var w = 0; w < fr.problems.length; w++) warn(fr.problems[w])
    var reply = { t: 'frame', events: events, view: fr.view, ms: 0, bytes: fr.json.length }
    if (msg.snap) reply.snap = JSON.parse(fr.json)
    if (warnings.length) reply.warnings = warnings
    reply.ms = Math.round((now() - started) * 1000) / 1000
    return reply
  }

  function leader(view) {
    if (view.over && view.winner) return view.winner
    var ids = meta.teams.map(function (t) { return t.id })
    var a = view.score[ids[0]] || 0
    var b = view.score[ids[1]] || 0
    return a > b ? ids[0] : b > a ? ids[1] : 'draw'
  }

  function show(snap) {
    where = 'view'
    var checked = checkView(game.view(clone(snap)), ctx.court, meta)
    var reply = { t: 'view', view: checked.view }
    if (checked.errors.length) reply.warnings = checked.errors.slice(0, 5)
    return reply
  }

  function onShow(msg) {
    if (!game) return fail('show', 'no game loaded: send load first')
    if (msg.snap === undefined || msg.snap === null) return fail('show', 'show needs a snap')
    return show(msg.snap)
  }

  function lineup(list) {
    var next = readPlayers(meta, list)
    for (var i = 0; i < next.length; i++) {
      ctx.players[i].bot = next[i].bot
      ctx.players[i].name = next[i].name
    }
  }

  function onPlayers(msg) {
    if (!game) return fail('players', 'no game loaded: send load first')
    where = 'players'
    lineup(msg.players)
    return null
  }

  function onRestore(msg) {
    if (!game) return fail('restore', 'no game loaded: send load first')
    if (msg.snap === undefined || msg.snap === null) return fail('restore', 'restore needs a snap')
    if (msg.players !== undefined) { where = 'players'; lineup(msg.players) }
    return startMatch(msg.snap, msg.elapsed)
  }

  function onMeta(msg) {
    var loaded = evaluate(msg.code, 'meta')
    return { t: 'meta', meta: loaded.meta, warnings: loaded.warnings }
  }

  /** Answer one protocol message; never throws. */
  function handle(msg) {
    if (!msg || typeof msg !== 'object') return fail('message', 'messages are objects like { t: "load", ... }')
    var reply
    where = 'message'
    try {
      if (msg.t === 'load') reply = onLoad(msg)
      else if (msg.t === 'step') reply = onStep(msg)
      else if (msg.t === 'show') reply = onShow(msg)
      else if (msg.t === 'players') reply = onPlayers(msg)
      else if (msg.t === 'restore') reply = onRestore(msg)
      else if (msg.t === 'meta') reply = onMeta(msg)
      else reply = fail('message', 'unknown message type ' + JSON.stringify(msg.t))
    } catch (err) {
      reply = fail(where, err)
    }
    if (reply && msg.id !== undefined) reply.id = msg.id
    return reply
  }

  return {
    handle: handle,
    validateMeta: validateMeta,
    validateOptions: readOptions,
    validateView: validateView,
    sanitizeView: sanitizeView,
    lerpView: lerpView,
    slotIds: slotIds,
    cleanEvent: cleanEvent,
    SOUNDS: SOUNDS.slice(),
    DRAW_TYPES: ITEM_TYPES.slice(),
  }
}

/**
 * The worker's entry point: lock the scope down, then answer messages with a runtime. Also
 * self-contained (shipped as source). Defence in depth: the worker already has no credentials.
 */
export function courtWorkerMain(scope, createRuntime) {
  'use strict'
  var post = typeof scope.postMessage === 'function' ? scope.postMessage.bind(scope) : function () {}
  // Kept privately for pages whose policy forbids new Function: a cartridge then loads as a
  // blob: script (the cartridge itself can no longer reach importScripts).
  var importer = typeof scope.importScripts === 'function' ? scope.importScripts.bind(scope) : null
  var Blob_ = scope.Blob
  var URL_ = scope.URL
  var env = null
  if (importer && typeof Blob_ === 'function' && URL_ && typeof URL_.createObjectURL === 'function') {
    env = {
      loadScript: function (code) {
        var key = '__courtGame' + Math.floor(Math.random() * 1e9)
        var source = 'self[' + JSON.stringify(key) + '] = (function () { "use strict";\n' + code + '\n;return typeof game === "undefined" ? undefined : game; })();'
        var url = URL_.createObjectURL(new Blob_([source], { type: 'text/javascript' }))
        try {
          importer(url)
        } finally {
          URL_.revokeObjectURL(url)
        }
        var game = scope[key]
        try { delete scope[key] } catch (e) { scope[key] = undefined }
        return game
      },
    }
  }
  // Network, storage, other contexts, timers that evaluate strings, and the reply channel (only
  // this function answers, so a cartridge cannot post unchecked messages).
  var BLOCKED = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts',
    'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'ServiceWorker', 'MessageChannel',
    'FontFace', 'fonts', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'Notification',
    'webkitRequestFileSystem', 'webkitRequestFileSystemSync', 'webkitResolveLocalFileSystemURL',
    'webkitResolveLocalFileSystemSyncURL', 'requestFileSystem', 'setTimeout', 'setInterval', 'setImmediate',
    'postMessage', 'close', 'eval',
  ]
  function remove(obj, name) {
    try { delete obj[name] } catch (e) { /* not configurable */ }
    try { if (name in obj) Object.defineProperty(obj, name, { value: undefined, writable: false, configurable: false }) } catch (e) { /* frozen */ }
    try { if (obj[name] !== undefined) obj[name] = undefined } catch (e) { /* read-only */ }
  }
  function strip(start, names) {
    for (var o = start; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (var i = 0; i < names.length; i++) remove(o, names[i])
    }
  }
  strip(scope, BLOCKED)
  var nav = null
  try { nav = scope.navigator } catch (e) { nav = null }
  if (nav) strip(nav, ['sendBeacon', 'storage', 'serviceWorker'])

  var runtime = createRuntime(env) // keeps its own reference to Function for loading cartridges

  // No code generation from here on: eval is gone and every function constructor throws.
  var make = Function
  function blocked() { throw new Error('a cartridge cannot generate code') }
  blocked.prototype = Function.prototype
  var protos = [Function.prototype]
  var kinds = ['return async function () {}', 'return function* () {}', 'return async function* () {}']
  for (var k = 0; k < kinds.length; k++) {
    try { protos.push(Object.getPrototypeOf(make(kinds[k])())) } catch (e) { /* not supported here */ }
  }
  for (var p = 0; p < protos.length; p++) {
    try { Object.defineProperty(protos[p], 'constructor', { value: blocked, writable: false, configurable: false }) } catch (e) { /* frozen */ }
  }
  for (var o = scope; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    try { if (Object.prototype.hasOwnProperty.call(o, 'Function')) Object.defineProperty(o, 'Function', { value: blocked, writable: false, configurable: false }) } catch (e) { /* frozen */ }
  }

  scope.onmessage = function (event) {
    var reply
    try {
      reply = runtime.handle(event ? event.data : null)
    } catch (err) {
      reply = { t: 'error', message: String(err && err.message ? err.message : err).slice(0, 300), where: 'worker' }
    }
    if (reply === null || reply === undefined) return
    try {
      post(reply)
    } catch (err) {
      try {
        post({ t: 'error', message: ('could not send the reply: ' + String(err && err.message ? err.message : err)).slice(0, 300), where: 'worker', id: reply.id })
      } catch (e) { /* nothing more to do */ }
    }
  }
}

/**
 * A bundler that keeps function names (esbuild --keep-names) wraps functions in a module-level
 * helper, helper(fn, "name"), even inside the two shipped functions; the worker has no such
 * helper. Find its (minified) name from functions we know are wrapped and define it there as
 * the identity. Returns '' for an ordinary build.
 */
function bundlerHelpers(sources) {
  const names = new Set()
  const wrapped = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\(\s*[A-Za-z_$][\w$]*\s*,\s*["'](?:validateMeta|remove)["']\s*\)/g
  for (const src of sources) for (const m of src.matchAll(wrapped)) names.add(m[1])
  return [...names].map((name) => `const ${name} = function (f) { return f };\n`).join('')
}

const MAIN_SOURCE = courtWorkerMain.toString()
const RUNTIME_SOURCE = createCourtRuntime.toString()

/** Source of the court worker: new Worker(URL.createObjectURL(new Blob([COURT_WORKER_SOURCE], { type: 'text/javascript' }))). */
export const COURT_WORKER_SOURCE = bundlerHelpers([MAIN_SOURCE, RUNTIME_SOURCE]) + '(' + MAIN_SOURCE + ')(self, ' + RUNTIME_SOURCE + ');'

const TOOLS = createCourtRuntime()

/** -> { ok, errors, warnings, meta } with meta normalised (defaults filled), or null when not ok. */
export function validateMeta(meta) {
  return TOOLS.validateMeta(meta)
}

/** Fill a normalised meta's option defaults and clamp the given values -> { options, notes }. */
export function validateOptions(meta, options) {
  return TOOLS.validateOptions(meta, options)
}

/** Strict check of a view -> errors[] (empty when valid). court: { w, h } px; meta (normalised) optional. */
export function validateView(view, court, meta) {
  return TOOLS.validateView(view, court, meta)
}

/** The cleaned view the runtime would return for this one. */
export function sanitizeView(view, court, meta) {
  return TOOLS.sanitizeView(view, court, meta)
}

/** A view a fraction t (0..1) of the way from view a to view b (items with the same t and id move). */
export function lerpView(a, b, t) {
  return TOOLS.lerpView(a, b, t)
}

/** Slot ids in order, `${team.id}${index}`: ['red0', 'red1', 'blue0', 'blue1'] for two a side. */
export function SLOT_IDS(meta) {
  return TOOLS.slotIds(meta)
}

/** Sound names a cartridge may play. */
export const COURT_SOUNDS = TOOLS.SOUNDS

/** Draw item types a view may use. */
export const COURT_DRAW_TYPES = TOOLS.DRAW_TYPES
