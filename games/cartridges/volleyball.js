// Beach volleyball: a court-game cartridge for Möbius Town (2 v 2, rally scoring).
//
// ================================================================== HOW TO WRITE A COURT GAME
//
// Copy this file to start a new game (basketball, dodgeball, tennis...): keep its shape, change
// the rules. Test it until it passes:   town.py test-game mygame.js
// (the same as `node forge/cartridge_test.mjs mygame.js`: it plays fast bot matches and checks
// everything below: the contract, that matches end, timing per frame, snapshot size, views).
//
// A cartridge is a plain script: ES2020, no import/export, no DOM, no timers, no network, no
// storage and no Math.random. It declares `const game = { ... }` at its top level; helper
// functions and constants beside it are fine. It runs in a sandboxed worker in every player's
// browser. One browser, the host, calls init, then bot and step 60 times a second, and sends
// snapshot(state) to everyone about 15 times a second; every screen draws view(snapshot). When
// the host leaves, another player's browser calls restore(snapshot) and carries on, so the
// snapshot must hold everything that matters.
//
// game.meta (checked by the runtime; defaults in brackets)
//   id                [a-z0-9-]{1,32}
//   title             <= 40 characters
//   teams             exactly 2: [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }]; ids are
//                     [a-z]{1,8}. Keep red/blue unless you have a reason: the town dresses the first
//                     team in red shirts and the second in blue. [red, blue]
//   perTeam           places per team, 1..4; bots fill the empty ones. [2]
//   durationSeconds   hard cap, 10..900: the match MUST send its 'end' event by then. [180]
//   lobbySeconds      3..20 seconds of lobby before the start. [6]
//   buttons           0..2 of { id: 'a' | 'b', label <= 12 }, shown on phones. [none]
//   controls          <= 120 characters for the lobby: how to play. ['']
//   court             { minW, minH }: smallest court in tiles (16 px each). [4 x 3]
//   options           up to 8 settings the builder may choose per court: { type: 'int' | 'number',
//                     min, max, default, doc } or { type: 'bool', default, doc } or
//                     { type: 'choice', choices: [...], default, doc }. The runtime fills
//                     defaults and clamps before init sees them. [none]
//   props             kit items the town builds with the court (a net, hoops, goals): { kind,
//                     at: [x, y], ...kit params }. at is in tiles from the court's top-left: an
//                     integer (negative counts back from the far edge, -1 = last column/row) or
//                     'mid' (half the width/height, rounded down). length 'w'/'h' = the court's
//                     width/height in tiles. Players and the ball are yours to draw; props are
//                     fixed scenery drawn by the town. [none]
//
// init({ players, court, seed, options }) -> state
//   players  [{ slot, team, index, bot, name }] in order: every place of the first team, then
//            the second. slot = team id + index: 'red0', 'red1', 'blue0', 'blue1'. bot is null
//            for a person, else 'easy' | 'medium' | 'hard'; it may change during a match (a
//            person leaves and a bot takes over), so don't copy it into the state.
//   court    { w, h } in pixels: the court rectangle. All coordinates are relative to its
//            top-left corner: x grows right, y grows down (towards the viewer), z is height.
//   seed     a uint32: keep a seeded generator in the state (see random()) so a match replays
//            exactly from the same seed and inputs.
//   options  the meta options, already filled in and clamped.
//   The state is yours: any plain data. It never leaves the host's worker.
//
// step(state, inputs, dt) -> events[]
//   One fixed step of dt = 1/60 s. inputs has an entry for every slot: { mx, my, a, b } with
//   mx, my in [-1, 1] (stick or keys) and a, b booleans (the button is down). A held button
//   arrives as true on every step, so detect presses where that matters. Must stay fast: under
//   about 1 ms per step with four bots, and end the match by meta.durationSeconds.
//
// bot(state, slot, level) -> { mx, my, a, b }
//   The input a bot of this level would give now. Called for every bot slot before each step;
//   it may keep memory in the state and use the state's generator. Make the levels clearly
//   different (reaction time, speed, accuracy, tactics) and keep bots competent: a match of
//   four bots must finish, and look like the game.
//
// snapshot(state) -> plain JSON, at most 2 KB (aim for a few hundred bytes)
//   Everything view() draws and restore() needs: round numbers (0.1 px is plenty), use short
//   keys or arrays. Never include functions or references to other objects.
//
// restore(snap, { players, court, seed, options }) -> state
//   Rebuild a state from a snapshot so another browser can carry on hosting. Bot memory may
//   start fresh. snapshot(restore(snap)) should give the snapshot back.
//
// view(snap) -> { draw, score, clock, message, over, winner }
//   A pure function of the snapshot: it runs on every screen, ~60 times a second.
//   draw     <= 60 draw items (below), in pixels from the court's top-left, within 48 px of it
//   score    { red, blue }: whole numbers keyed by team id
//   clock    seconds left to show, or null
//   message  a short line for the HUD (<= 60 characters) or null
//   over     true once the match has ended, with winner: 'red' | 'blue' | 'draw'
//
// Events returned by step (all optional; the town plays and shows them for everyone):
//   { type: 'sound', name }    click pop chime whoosh coin splash sparkle fanfare win lose
//   { type: 'score', team, score: { red, blue } }      a point; team is who scored
//   { type: 'banner', text }                            a big short message (<= 40 characters)
//   { type: 'end', winner: 'red' | 'blue' | 'draw', score: { red, blue } }   exactly once
//
// Draw items (optional on all: id for smooth interpolation between snapshots, alpha 0..1,
// layer: 'ground' to lie flat under everything; the rest are depth-sorted by y):
//   { t: 'player', id, slot, x, y, z, dir: 'down'|'up'|'left'|'right', moving, pose: 'stand'|'run'|'jump'|'reach' }
//       the town draws the slot's own avatar in its team's shirt with its name tag; (x, y) are
//       the feet on the ground, z lifts them (a jump) above their shadow.
//   { t: 'ball', id, x, y, z, r = 3, colour = '#ffffff', stripe? }   centred at (x, y - z), shadow at (x, y)
//   { t: 'shadow', x, y, rx, ry }
//   { t: 'rect', x, y, w, h, colour }              colours: '#rrggbb' (or #rgb, #rrggbbaa)
//   { t: 'line', x1, y1, x2, y2, colour, width }
//   { t: 'circle', x, y, r, colour, fill }
//   { t: 'text', x, y, text, colour, size }        <= 40 characters, centred on (x, y)
//
// Tips: keep tuning numbers together at the top; make one button enough to play (pick the
// right action from context) and keep a second one optional; give people a moment between
// points; show what is about to happen (here: a ring where the ball will land and an arrow at
// the server); test with every bot level, and on the smallest court your meta allows.
//
// ======================================================================= THE GAME: VOLLEYBALL
//
// Red plays on the left half, blue on the right, across a net running north-south through the
// middle of the court (x = court.w / 2, NET_H px high; the town builds the net from meta.props).
// Seen top-down like the town: players run on the sand (x, y) and jump (z); the ball flies in
// 3D with gravity and a shadow.
//
// Controls: move with the stick. Hit (a) plays the ball when it is within reach; the game picks
// the shot: the first touch is a pass to your teammate's side of the net, the second a set to
// your teammate at the net, the third goes over: a spike (hard and down) if you are near the
// net and the ball is high or you are jumping, otherwise a placed shot. Jump (b) near the net
// and hit to spike on any touch; jump at the net as they spike to block. Attacks and serves go
// where the stick points (up/down: which side; towards the net: deeper; away: shorter), or
// with the stick at rest to the most open spot.
//
// Rules: rally scoring (every rally wins a point; the winners serve next, and a team that wins
// the serve back rotates its server). Serve from behind your back line: press Hit, or it goes
// by itself after 2 s. A point is lost when the ball lands in your half, when you hit it out,
// into the net or round the end of the net, or when your side touches it four times in a row.
// First to `points` (11) wins, by two, but the first to points + 4 wins outright; when the clock
// (5 minutes) runs out the leader wins, or it is a draw. Nobody may cross the net; players can
// run about a tile beyond the lines.

// ----------------------------------------------------------------------------- tuning
// Units: pixels and seconds. z is height above the sand; the ball's z is its centre.

const TICK = 1 / 60
const DURATION = 300 // = meta.durationSeconds
const TEAM_IDS = ['red', 'blue']
const TEAM_NAMES = ['Red', 'Blue']
const TEAM_COLOURS = ['#ff5a5a', '#4d8dff']

const GRAVITY = 240 // on the ball, px/s²
const BALL_R = 3 // a ball resting on the sand has z = BALL_R
const NET_H = 16 // top of the net
const NET_CLEAR = NET_H + BALL_R + 3 // the height a placed shot crosses the net at, at least
const SPIKE_CLEAR = NET_H + BALL_R + 1 // ...and a spike
const IN_SLACK = 1 // a ball this far over a line still touches it: in

const RUN = 80 // player top speed
const ACCEL = 700 // px/s² towards the stick's velocity
const DECEL = 600 // px/s² when the stick is released
const AIR_CONTROL = 0.35 // steering left in the air
const JUMP_V = 110 // take-off speed: a jump rises 13.4 px and lasts 0.49 s
const PLAYER_G = 450
const JUMP_TIME = JUMP_V / PLAYER_G // seconds to the top of a jump
const OUTSIDE = 14 // how far beyond the lines players may run
const NET_GAP = 5 // the closest a player's feet come to the net
const MATE_GAP = 9 // teammates don't stand inside each other
const SERVE_BACK = 8 // the server stands this far behind the back line

const REACH = 22 // a player reaches a ball up to this high above their feet...
const HIT_R = 12 // ...and this far away across the sand,
const DIVE = 6 // ...or this much farther for a low ball (a dive: the dig goes astray)
const HIT_WINDOW = 12 // ticks a press of Hit waits for the ball to come into reach
const HIT_COOL = 18 // ticks before the same player can touch again
const BALL_LOCK = 6 // ticks after any touch before the next one
const REACH_POSE = 14 // ticks the arms stay up after a touch
const NEAR_NET = 30 // feet this close to the net can spike...
const SPIKE_Z = 18 // ...a ball at least this high (or while jumping)
const PASS_DEPTH = 24 // a pass comes down this far from the net...
const PASS_Z = 18 // ...at this height
const PASS_APEX = 46
const SET_DEPTH = 13 // a set comes down this close to the net...
const SET_Z = 26 // ...at this height, for a jumping spike
const SPIKE_SPEED = 160 // spike speed across the sand from SPIKE_Z...
const SPIKE_GAIN = 3.5 // ...plus this much per pixel of extra height
const SPIKE_MAX = 215
const SERVE_APEX = 48
const LANE_EDGE = 10 // aimed balls stay this far inside the side lines

const SERVE_MIN = 30 // ticks before a serve can be struck
const SERVE_AUTO = 120 // ...and when it goes by itself
const POINT_TICKS = 100 // pause after a point

const PHASES = ['serve', 'rally', 'point', 'over']
const KINDS = ['none', 'serve', 'pass', 'set', 'spike', 'shot', 'block']
const FACES = ['down', 'right', 'up', 'left']
// Why the last point ended (the HUD line and banners).
const MSG = { none: 0, serve: 1, ace: 2, kill: 3, out: 4, net: 5, four: 6, point: 7, block: 8, time: 9, won: 10 }
const BANNERS = { 2: 'Ace!', 3: 'Kill!', 4: 'Out!', 5: 'Net!', 6: 'Four hits!' }

// Bot levels: what makes easy, medium and hard play differently.
//   react, reactJitter  ticks before a bot notices that the ball was touched (+ 0..reactJitter)
//   think, jitter       ticks between decisions (+ 0..jitter); in between it follows its plan
//   speed               share of top running speed
//   err, aimErr         px it misjudges where to stand / where its attack goes
//   whiff               chance it misses a ball it reached
//   serveFault          chance of a bad serve (long, wide or into the net); serveWait: ticks it waits
//   jump, block, smart  chances to jump for a spike, to go up for a block, to play round a block
//   judge               lets a ball the others hit out drop
const LEVELS = {
  easy: { react: 18, reactJitter: 8, think: 16, jitter: 8, speed: 0.74, err: 7, aimErr: 22, whiff: 0.09, serveFault: 0.12, serveWait: [30, 80], jump: 0.1, block: 0, smart: 0, judge: false },
  medium: { react: 12, reactJitter: 6, think: 8, jitter: 4, speed: 0.9, err: 3.5, aimErr: 11, whiff: 0.025, serveFault: 0.05, serveWait: [15, 50], jump: 0.55, block: 0.08, smart: 0.45, judge: true },
  hard: { react: 7, reactJitter: 5, think: 3, jitter: 2, speed: 1, err: 1.2, aimErr: 4, whiff: 0, serveFault: 0.015, serveWait: [10, 30], jump: 0.95, block: 0.22, smart: 0.85, judge: true },
}

// ----------------------------------------------------------------------------- the cartridge

const game = {
  meta: {
    id: 'volleyball',
    title: 'Beach volleyball',
    teams: [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }],
    perTeam: 2,
    durationSeconds: DURATION,
    lobbySeconds: 6,
    buttons: [{ id: 'a', label: 'Hit' }, { id: 'b', label: 'Jump' }],
    controls: 'Arrows/WASD move · Space hits · Q jumps (spike or block at the net)',
    court: { minW: 8, minH: 5 },
    options: {
      points: { type: 'int', min: 5, max: 25, default: 11, doc: 'Points to win (by two; the first to points + 4 wins outright)' },
    },
    props: [{ kind: 'net', at: ['mid', 0], length: 'h', vertical: true }],
  },

  init({ players, court, seed, options }) {
    const s = createState(players, court, seed, options)
    s.serving = random(s) < 0.5 ? 0 : 1 // a coin toss for the first serve
    s.rot[s.serving] = 0
    for (const p of s.players) [p.x, p.y] = basePosition(s, p)
    startServe(s)
    return s
  },

  step(s, inputs) { // dt is always 1/60 s: this game counts ticks (TICK)
    const events = []
    if (s.phase === 'over') return events
    s.tick++
    s.phaseTick++
    if (s.announce) announce(s, events)
    for (const p of s.players) movePlayer(s, p, readInput(inputs && inputs[p.slot]))
    keepApart(s)
    for (const p of s.players) keepInside(s, p)
    if (s.phase === 'serve') serveTick(s, events)
    else if (s.phase === 'rally') touchTick(s, events)
    if (s.phase === 'rally' || s.phase === 'point') flyBall(s, events)
    if (s.phase === 'point' && s.phaseTick >= POINT_TICKS) startServe(s)
    if (s.phase !== 'over' && --s.clock <= 0) endMatch(s, events, true)
    return events
  },

  bot(s, slot, level) {
    const p = s.players.find((q) => q.slot === slot)
    if (!p) return { mx: 0, my: 0, a: false, b: false }
    const L = LEVELS[level] || LEVELS.medium
    p.botTick = s.tick // step() knows this player is a bot (bots serve less reliably)
    p.level = LEVELS[level] ? level : 'medium'
    if (!p.mem) p.mem = { next: 0, seen: s.hits, tx: p.x, ty: p.y, chase: false, zc: 10, attack: false, jumpAt: -1, serveAt: -1, aimX: 0, aimY: 0, ball: -1, whiff: false, jump: false, jumped: false, block: false }
    const m = p.mem
    if (m.seen !== s.hits) { // the ball was just touched: it takes a moment to react
      m.seen = s.hits
      m.next = Math.max(m.next, s.tick + L.react + Math.floor(random(s) * (L.reactJitter + 1)))
    }
    if (s.tick >= m.next) { // between decisions a bot acts on what it saw last
      think(s, p, L, m)
      m.next = s.tick + L.think + Math.floor(random(s) * (L.jitter + 1))
    }
    return act(s, p, L, m)
  },

  snapshot(s) {
    const b = s.ball
    return {
      v: 1,
      c: [s.w, s.h, s.n, s.points], // court size, players per team, points to win
      t: s.tick,
      ph: PHASES.indexOf(s.phase),
      pt: s.phaseTick,
      clock: s.clock, // ticks left
      sc: [s.score[0], s.score[1]],
      sv: [s.serving, s.rot[0], s.rot[1], s.sideout ? 1 : 0], // serving team, each team's server
      tc: [s.touchTeam, s.touches, s.lastHit, KINDS.indexOf(s.kind), s.lock], // last touch
      msg: [s.msg, s.msgTeam],
      win: s.winner,
      b: [r1(b.x), r1(b.y), r1(b.z), r1(b.vx), r1(b.vy), r1(b.vz)],
      p: s.players.map((p) => [r1(p.x), r1(p.y), r1(p.z), r1(p.vx), r1(p.vy), r1(p.vz), p.face, p.reach]),
    }
  },

  restore(snap, { players, seed }) {
    if (!snap || snap.v !== 1 || !Array.isArray(snap.p) || snap.p.length !== players.length) throw new Error('not a volleyball snapshot for these players')
    const s = createState(players, { w: snap.c[0], h: snap.c[1] }, seed, { points: snap.c[3] })
    s.tick = snap.t
    s.phase = PHASES[snap.ph]
    s.phaseTick = snap.pt
    s.clock = snap.clock
    s.score = [snap.sc[0], snap.sc[1]]
    s.serving = snap.sv[0]
    s.rot = [snap.sv[1], snap.sv[2]]
    s.sideout = snap.sv[3] === 1
    s.touchTeam = snap.tc[0]
    s.touches = snap.tc[1]
    s.lastHit = snap.tc[2]
    s.kind = KINDS[snap.tc[3]]
    s.lock = snap.tc[4]
    s.msg = snap.msg[0]
    s.msgTeam = snap.msg[1]
    s.winner = snap.win
    const [x, y, z, vx, vy, vz] = snap.b
    Object.assign(s.ball, { x, y, z, vx, vy, vz })
    snap.p.forEach((q, i) => Object.assign(s.players[i], { x: q[0], y: q[1], z: q[2], vx: q[3], vy: q[4], vz: q[5], face: q[6], reach: q[7] }))
    s.rng = (seed ^ Math.imul(snap.t + 1, 0x9e3779b1)) >>> 0 || 1 // a fresh stream for the new host
    return s
  },

  view(snap) {
    const [w, h, n, points] = snap.c
    const net = w / 2
    const phase = PHASES[snap.ph]
    const [bx, by, bz, bvx, bvy, bvz] = snap.b
    const cx = (x) => clamp(x, -40, w + 40)
    const cy = (y) => clamp(y, -40, h + 40)
    const draw = []
    // Where the ball will come down, while it flies.
    if (phase === 'rally') {
      const t = timeDown(bz, bvz, BALL_R)
      if (t !== null && t > 0.12) {
        draw.push({ t: 'circle', id: 'land', x: cx(bx + bvx * t), y: cy(by + bvy * t), r: 3.5, colour: '#fff6d8', fill: false, alpha: 0.75, layer: 'ground' })
      }
    }
    // The serve: a ring under the server and an arrow pointing over the net.
    if (phase === 'serve') {
      const team = snap.sv[0]
      const q = snap.p[team * n + snap.sv[1 + team]] || snap.p[0]
      const dir = team === 0 ? 1 : -1
      const colour = TEAM_COLOURS[team]
      draw.push({ t: 'circle', id: 'serve', x: q[0], y: q[1] + 1, r: 8, colour, fill: false, layer: 'ground' })
      const ax = q[0] + dir * 11, tip = q[0] + dir * 22
      draw.push(
        { t: 'line', id: 'serve1', x1: ax, y1: q[1], x2: tip, y2: q[1], colour, width: 2, layer: 'ground' },
        { t: 'line', id: 'serve2', x1: tip, y1: q[1], x2: tip - dir * 4, y2: q[1] - 4, colour, width: 2, layer: 'ground' },
        { t: 'line', id: 'serve3', x1: tip, y1: q[1], x2: tip - dir * 4, y2: q[1] + 4, colour, width: 2, layer: 'ground' },
      )
    }
    // Touches used by the side on the ball: three dots beside the net post.
    const [touchTeam, touches, , kind] = snap.tc
    if (phase === 'rally' && touchTeam >= 0 && touches > 0 && KINDS[kind] !== 'serve' && KINDS[kind] !== 'block') {
      const dir = touchTeam === 0 ? -1 : 1
      for (let i = 0; i < 3; i++) {
        draw.push({ t: 'circle', id: 'touch' + i, x: net + dir * (7 + i * 6), y: -7, r: 2, colour: TEAM_COLOURS[touchTeam], fill: i < touches, layer: 'ground' })
      }
    }
    snap.p.forEach((q, i) => {
      const [x, y, z, vx, vy, , face, reach] = q
      const moving = Math.abs(vx) + Math.abs(vy) > 8
      const slot = TEAM_IDS[i < n ? 0 : 1] + (i % n)
      const pose = reach > 0 ? 'reach' : z > 0.5 ? 'jump' : moving ? 'run' : 'stand'
      draw.push({ t: 'player', id: slot, slot, x, y, z, dir: FACES[face], moving, pose })
    })
    draw.push({ t: 'ball', id: 'ball', x: cx(bx), y: cy(by), z: clamp(bz, 0, 200), r: BALL_R, colour: '#fff4d8', stripe: '#3d72d9' })
    const over = phase === 'over'
    const out = {
      draw,
      score: { red: snap.sc[0], blue: snap.sc[1] },
      clock: Math.ceil(Math.max(0, snap.clock) / 60),
      message: messageOf(snap, points),
      over,
    }
    if (over) out.winner = snap.win === 2 ? 'draw' : TEAM_IDS[snap.win]
    return out
  },
}

// ----------------------------------------------------------------------------- set-up

function createState(players, court, seed, options) {
  const n = Math.max(1, Math.floor(players.length / 2))
  const points = options && Number.isInteger(options.points) ? options.points : 11
  return {
    w: court.w,
    h: court.h,
    net: court.w / 2,
    n,
    points,
    tick: 0,
    clock: DURATION * 60, // ticks of match left
    phase: 'serve',
    phaseTick: 0,
    score: [0, 0],
    serving: 0, // team index: 0 red (left), 1 blue (right)
    rot: [-1, -1], // each team's server (index within the team)
    sideout: true, // the serve just changed sides (announce it)
    touchTeam: -1, // team of the last touch
    touches: 0, // touches in a row by that team
    lastHit: -1, // player index of the last touch
    kind: 'none', // what the last touch was (KINDS)
    lock: 0, // ticks until the ball can be touched again
    msg: MSG.none,
    msgTeam: 0,
    winner: -1, // 0, 1 or 2 (a draw) once over
    announce: false,
    ball: { x: 0, y: 0, z: BALL_R, vx: 0, vy: 0, vz: 0 },
    players: players.map((p, i) => ({
      slot: p.slot,
      index: i,
      team: p.team === TEAM_IDS[0] ? 0 : 1,
      k: p.index, // place within the team
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      face: 0, // FACES index
      reach: 0, // ticks the arms stay up
      hitWin: 0, // ticks a press of Hit keeps waiting
      cool: 0,
      jumpHeld: false,
      stick: { mx: 0, my: 0 }, // aims the next serve or attack
      botTick: -9, // last tick bot() was asked to play this place
      level: 'medium',
      mem: null, // bot memory
    })),
    rng: (seed >>> 0) || 1,
    hits: 0, // touches so far: tells bots a new ball is in the air
    plans: [{ chaser: -1 }, { chaser: -1 }], // each team's player going for the ball
  }
}

const dirOf = (team) => (team === 0 ? 1 : -1) // the way a team hits: red to the right
const serverOf = (s) => s.players.find((p) => p.team === s.serving && p.k === s.rot[s.serving]) || s.players[0]
const isBot = (s, p) => s.tick - p.botTick <= 1
const scoreOf = (s) => ({ red: s.score[0], blue: s.score[1] })

/** x range a team's players may use (their half, a little beyond the lines). */
function sideZone(s, team) {
  return team === 0 ? [-OUTSIDE, s.net - NET_GAP] : [s.net + NET_GAP, s.w + OUTSIDE]
}

/** Where a server stands: behind the back line. */
function serveZone(s, team) {
  return team === 0 ? [-OUTSIDE, -3] : [s.w + 3, s.w + OUTSIDE]
}

function startServe(s) {
  s.phase = 'serve'
  s.phaseTick = 0
  s.touchTeam = -1
  s.touches = 0
  s.lastHit = -1
  s.kind = 'none'
  s.lock = 0
  s.msg = MSG.serve
  s.msgTeam = s.serving
  s.announce = true
  const p = serverOf(s)
  p.x = s.serving === 0 ? -SERVE_BACK : s.w + SERVE_BACK
  p.y = clamp(p.y, 10, s.h - 10)
  p.vx = p.vy = p.vz = p.z = 0
  holdBall(s, p)
  for (const q of s.players) q.mem = null // bots make new plans
  s.plans = [{ chaser: -1 }, { chaser: -1 }]
}

function announce(s, events) {
  s.announce = false
  if (matchPoint(s)) events.push({ type: 'banner', text: 'Match point' })
  else if (s.sideout) events.push({ type: 'banner', text: TEAM_NAMES[s.serving] + ' serves' })
  s.sideout = false
}

/** The server holds the ball up, ready to toss. */
function holdBall(s, p) {
  const b = s.ball
  b.x = p.x + dirOf(p.team) * 3
  b.y = p.y
  b.z = 17 + 2 * Math.sin(s.phaseTick * 0.15)
  b.vx = b.vy = b.vz = 0
}

// ----------------------------------------------------------------------------- players

function readInput(v) {
  if (!v || typeof v !== 'object') return { mx: 0, my: 0, a: false, b: false }
  const axis = (n) => (typeof n === 'number' && Number.isFinite(n) ? clamp(n, -1, 1) : 0)
  return { mx: axis(v.mx), my: axis(v.my), a: !!v.a, b: !!v.b }
}

function movePlayer(s, p, input) {
  p.stick.mx = input.mx
  p.stick.my = input.my
  const serving = s.phase === 'serve' && p === serverOf(s)
  let mx = input.mx, my = input.my
  const m = Math.hypot(mx, my)
  if (m > 1) { mx /= m; my /= m } // diagonals are not faster
  const air = p.z > 0
  const limit = (mx || my ? ACCEL : DECEL) * (air ? AIR_CONTROL : 1) * TICK
  const dvx = mx * RUN - p.vx, dvy = my * RUN - p.vy
  const dv = Math.hypot(dvx, dvy)
  if (dv <= limit) { p.vx = mx * RUN; p.vy = my * RUN } else { p.vx += dvx / dv * limit; p.vy += dvy / dv * limit }
  if (input.b && !p.jumpHeld && !air && !serving) p.vz = JUMP_V // Jump: once per press
  p.jumpHeld = input.b
  if (input.a) p.hitWin = HIT_WINDOW // Hit: a press waits a moment for the ball; held, it stays ready
  else if (p.hitWin > 0) p.hitWin--
  if (p.cool > 0) p.cool--
  if (p.reach > 0) p.reach--
  p.x += p.vx * TICK
  p.y += p.vy * TICK
  if (p.z > 0 || p.vz > 0) {
    p.z += p.vz * TICK - PLAYER_G * TICK * TICK / 2
    p.vz -= PLAYER_G * TICK
    if (p.z <= 0) { p.z = 0; p.vz = 0 }
  }
  if (Math.abs(p.vx) + Math.abs(p.vy) > 8) p.face = faceOf(p.vx, p.vy)
}

/** Teammates step aside rather than stand inside each other. */
function keepApart(s) {
  const ps = s.players
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j]
      if (a.team !== b.team) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      if (d >= MATE_GAP) continue
      const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : 1
      const push = (MATE_GAP - d) / 2
      a.x -= nx * push; a.y -= ny * push
      b.x += nx * push; b.y += ny * push
    }
  }
}

/** Your own side of the net, at most OUTSIDE beyond the lines; the server behind the back line. */
function keepInside(s, p) {
  const serving = s.phase === 'serve' && p === serverOf(s)
  const [x0, x1] = serving ? serveZone(s, p.team) : sideZone(s, p.team)
  const y0 = serving ? 6 : -OUTSIDE, y1 = serving ? s.h - 6 : s.h + OUTSIDE
  if (p.x < x0) { p.x = x0; if (p.vx < 0) p.vx = 0 }
  if (p.x > x1) { p.x = x1; if (p.vx > 0) p.vx = 0 }
  if (p.y < y0) { p.y = y0; if (p.vy < 0) p.vy = 0 }
  if (p.y > y1) { p.y = y1; if (p.vy > 0) p.vy = 0 }
}

function faceOf(vx, vy) {
  return Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : vy > 0 ? 0 : 2
}

// ----------------------------------------------------------------------------- serving and touching

function serveTick(s, events) {
  const p = serverOf(s)
  holdBall(s, p)
  if (s.phaseTick >= SERVE_MIN && (p.hitWin > 0 || s.phaseTick >= SERVE_AUTO)) serve(s, p, events)
}

function serve(s, p, events) {
  const dir = dirOf(p.team)
  let [tx, ty] = aimAt(s, p, true)
  let apex = SERVE_APEX
  const level = isBot(s, p) ? LEVELS[p.level] : null
  if (level && random(s) < level.serveFault) { // a bot misses now and then: long, wide or into the net
    const r = random(s)
    if (r < 0.4) tx = dir > 0 ? s.w + 8 + random(s) * 14 : -8 - random(s) * 14
    else if (r < 0.7) ty = random(s) < 0.5 ? -8 - random(s) * 10 : s.h + 8 + random(s) * 10
    else apex = NET_H + 3
  }
  const b = s.ball
  b.x = p.x + dir * 3
  b.y = p.y
  b.z = 18
  apply(b, arc(b, tx, ty, BALL_R, apex))
  touched(s, p, 'serve')
  s.touches = 1
  s.touchTeam = p.team
  s.phase = 'rally'
  s.phaseTick = 0
  s.msg = MSG.none
  p.face = dir > 0 ? 1 : 3
  events.push({ type: 'sound', name: 'click' })
}

function touchTick(s, events) {
  if (s.lock > 0) { s.lock--; return }
  let best = null, bestD = Infinity
  for (const p of s.players) {
    if (p.hitWin <= 0 || p.cool > 0) continue
    const d = reachOf(s, p)
    if (d < bestD) { best = p; bestD = d }
  }
  if (best) strike(s, best, bestD, events)
}

/** How far the ball is from p across the sand if p can touch it now, else Infinity. */
function reachOf(s, p) {
  const b = s.ball
  if (b.z > p.z + REACH || b.z < BALL_R + 0.5) return Infinity
  if ((b.x - s.net) * dirOf(p.team) > 0) return Infinity // it is over their side of the net
  if (s.kind === 'serve' && s.touchTeam === p.team) return Infinity // your own team's serve
  const d = Math.hypot(b.x - p.x, b.y - p.y)
  return d <= HIT_R + DIVE * clamp((12 - b.z) / 8, 0, 1) ? d : Infinity
}

function touched(s, p, kind) {
  s.lastHit = p.index
  s.kind = kind
  s.hits++
  s.lock = BALL_LOCK
  p.hitWin = 0
  p.cool = HIT_COOL
  p.reach = REACH_POSE
}

/** p plays the ball: the touch count decides the shot (pass, set, attack). */
function strike(s, p, dist, events) {
  const b = s.ball
  if (s.touchTeam === p.team) s.touches++
  else { s.touchTeam = p.team; s.touches = 1 }
  touched(s, p, 'none')
  if (s.touches > 3) { awardPoint(s, 1 - p.team, MSG.four, events); return }
  // A ball taken at full stretch, in a dive, off the sand or off a hard hit goes astray.
  const stretch = Math.min(1, dist / HIT_R)
  const speed = Math.hypot(b.vx, b.vy, b.vz)
  const sloppy = stretch * stretch * 12 + Math.max(0, dist - HIT_R) * 1.5 + Math.max(0, 7 - b.z) * 1.5 + Math.max(0, speed - 160) * 0.06
  const nearNet = Math.abs(p.x - s.net) <= NEAR_NET
  const air = p.z > 2
  const last = s.touches === 3 || (s.n === 1 && s.touches === 2)
  let kind
  if (last || (air && nearNet)) kind = nearNet && (air || b.z >= SPIKE_Z) ? 'spike' : 'shot'
  else kind = s.touches === 2 ? 'set' : 'pass'
  if (kind === 'spike' && p.stick.mx * dirOf(p.team) < -0.8) kind = 'shot' // stick pulled right back: a tip
  if (kind === 'spike' && !spike(s, p)) kind = 'shot'
  if (kind === 'shot') shot(s, p)
  else if (kind === 'pass') pass(s, p, sloppy)
  else if (kind === 'set') setBall(s, p, sloppy)
  s.kind = kind
  p.face = faceOf(b.vx, b.vy)
  events.push({ type: 'sound', name: kind === 'spike' ? 'whoosh' : 'click' })
}

/** First touch: up to the front of our half, in front of the teammate who will set. */
function pass(s, p, sloppy) {
  const dir = dirOf(p.team)
  const mate = partnerOf(s, p)
  let tx = s.net - dir * PASS_DEPTH
  let ty = clamp(mate === p ? p.y : mate.y + (s.h / 2 - mate.y) * 0.3, 14, s.h - 14)
  const e = sloppy * random(s), a = random(s) * Math.PI * 2
  tx += Math.cos(a) * e
  ty += Math.sin(a) * e
  apply(s.ball, arc(s.ball, tx, ty, PASS_Z, Math.max(PASS_APEX, s.ball.z + 14)))
}

/** Second touch: up by the net in front of the attacker, high enough for them to get there. */
function setBall(s, p, sloppy) {
  const dir = dirOf(p.team)
  const hitter = partnerOf(s, p)
  const tx = s.net - dir * SET_DEPTH
  const ty = clamp(hitter.y, 14, s.h - 14)
  const run = Math.hypot(tx - hitter.x, ty - hitter.y) / RUN
  const apex = apexFor(s.ball.z, SET_Z, clamp(run + 0.35, 0.8, 1.5))
  const e = sloppy * 0.6 * random(s), a = random(s) * Math.PI * 2
  apply(s.ball, arc(s.ball, tx + Math.cos(a) * e, ty + Math.sin(a) * e, SET_Z, apex))
}

/** A spike: hard and down into their court. False if the ball is too low to get over. */
function spike(s, p) {
  const b = s.ball
  const dir = dirOf(p.team)
  const [tx, ty] = aimAt(s, p, false)
  const power = clamp(SPIKE_SPEED + (b.z - SPIKE_Z) * SPIKE_GAIN, 130, SPIKE_MAX)
  const back = dir > 0 ? s.w - 6 : 6
  for (let deeper = 0; deeper <= 2; deeper++) {
    const x = dir > 0 ? Math.min(tx + deeper * 14, back) : Math.max(tx - deeper * 14, back)
    for (let v = power; v >= 120; v -= 15) {
      const plan = drive(b, x, ty, v)
      if (netHeight(s, b, plan) >= SPIKE_CLEAR) { apply(b, plan); return true }
    }
  }
  return false
}

/** A placed shot over the net: as flat as clears it. */
function shot(s, p) {
  const b = s.ball
  const [tx, ty] = aimAt(s, p, false)
  for (let apex = Math.max(b.z + 6, NET_H + 14); apex <= 110; apex += 4) {
    const plan = arc(b, tx, ty, BALL_R, apex)
    if (netHeight(s, b, plan) >= NET_CLEAR + 2) { apply(b, plan); return }
  }
  apply(b, arc(b, tx, ty, BALL_R, 110))
}

/** The teammate p plays to (the one nearest the middle of the net), or p when alone. */
function partnerOf(s, p) {
  let best = p, bestD = Infinity
  for (const q of s.players) {
    if (q.team !== p.team || q === p) continue
    const d = Math.abs(q.x - s.net) + Math.abs(q.y - s.h / 2) * 0.5
    if (d < bestD) { bestD = d; best = q }
  }
  return best
}

/**
 * Where p's serve or attack goes. The stick aims: up/down picks the side, towards the net
 * deeper, away from it shorter. At rest: the most open spot.
 */
function aimAt(s, p, serve) {
  const { mx, my } = p.stick
  if (Math.hypot(mx, my) <= 0.3) return openSpot(s, p.team, serve)
  const dir = dirOf(p.team)
  const near = s.net + dir * 12, far = dir > 0 ? s.w - 9 : 9
  const forward = clamp(mx * dir, -1, 1)
  const depth = serve ? 0.72 + 0.22 * forward : 0.55 + 0.4 * forward
  return [near + (far - near) * depth, s.h / 2 + my * (s.h / 2 - LANE_EDGE)]
}

/**
 * The spot in the other half farthest from its defenders (a little random). With `from` (the
 * ball), lanes a blocker at the net covers count as closed.
 */
function openSpot(s, team, serve, from) {
  const dir = dirOf(team)
  const near = s.net + dir * 12, far = dir > 0 ? s.w - 9 : 9
  let best = null, bestScore = -Infinity
  for (const depth of serve ? [0.6, 0.8, 0.95] : [0.3, 0.6, 0.9]) {
    for (const lane of [0.08, 0.5, 0.92]) {
      const x = near + (far - near) * depth, y = LANE_EDGE + (s.h - 2 * LANE_EDGE) * lane
      let gap = 99
      for (const q of s.players) {
        if (q.team === team) continue
        gap = Math.min(gap, Math.hypot(q.x - x, q.y - y))
        if (from && Math.abs(q.x - s.net) < NET_GAP + 6 && (x - from.x) * dir > 0) {
          const cross = from.y + (y - from.y) * (s.net - from.x) / (x - from.x) // where it passes the net
          if (Math.abs(cross - q.y) < 11) gap -= 30
        }
      }
      const score = gap + random(s) * 12
      if (score > bestScore) { bestScore = score; best = [x, y] }
    }
  }
  return best
}

// ----------------------------------------------------------------------------- the ball in the air

/** Velocities that take the ball from where it is to (tx, ty) at height tz over an apex. */
function arc(b, tx, ty, tz, apex) {
  const top = Math.max(apex, b.z + 1, tz + 1)
  const up = Math.sqrt(2 * (top - b.z) / GRAVITY)
  const down = Math.sqrt(2 * (top - tz) / GRAVITY)
  const t = up + down
  return { vx: (tx - b.x) / t, vy: (ty - b.y) / t, vz: GRAVITY * up }
}

/** Velocities for a hard, straight-ish hit landing at (tx, ty), `speed` px/s across the sand. */
function drive(b, tx, ty, speed) {
  const dx = tx - b.x, dy = ty - b.y
  const t = Math.max(20, Math.hypot(dx, dy)) / speed
  return { vx: dx / t, vy: dy / t, vz: (BALL_R - b.z + GRAVITY * t * t / 2) / t }
}

/** The apex that keeps a ball from z0 down to z1 in the air for `time` seconds. */
function apexFor(z0, z1, time) {
  let lo = Math.max(z0, z1), hi = lo + 200
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const t = Math.sqrt(2 * (mid - z0) / GRAVITY) + Math.sqrt(2 * (mid - z1) / GRAVITY)
    if (t < time) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function apply(b, v) {
  b.vx = v.vx
  b.vy = v.vy
  b.vz = v.vz
}

/** The height of the ball's centre where it would cross the net with velocities v. */
function netHeight(s, b, v) {
  if (v.vx === 0) return Infinity
  const t = (s.net - b.x) / v.vx
  if (t <= 0) return Infinity
  return b.z + v.vz * t - GRAVITY * t * t / 2
}

/** Seconds until a ball at height z rising at vz comes down through height h (null if never). */
function timeDown(z, vz, h) {
  const disc = vz * vz + 2 * GRAVITY * (z - h)
  if (disc < 0) return null
  const t = (vz + Math.sqrt(disc)) / GRAVITY
  return t >= 0 ? t : null
}

function flyBall(s, events) {
  const b = s.ball
  const x0 = b.x, y0 = b.y, z0 = b.z
  b.x += b.vx * TICK // exact for constant gravity, so the bots' predictions come true
  b.y += b.vy * TICK
  b.z += b.vz * TICK - GRAVITY * TICK * TICK / 2
  b.vz -= GRAVITY * TICK
  if (s.phase !== 'rally') { settle(s, x0); return }
  if ((x0 < s.net) !== (b.x < s.net)) crossNet(s, x0, y0, z0, events)
  if (s.phase === 'rally' && b.z <= BALL_R) land(s, events)
}

/** The ball crosses the plane of the net: over it, into it, round its end, or into a block. */
function crossNet(s, x0, y0, z0, events) {
  const b = s.ball
  const f = (s.net - x0) / (b.x - x0)
  const y = y0 + (b.y - y0) * f
  const z = z0 + (b.z - z0) * f
  const from = x0 < s.net ? 0 : 1 // the team whose side it comes from
  if (y < 0 || y > s.h) { awardPoint(s, 1 - from, MSG.out, events); return }
  if (z - BALL_R < NET_H) {
    b.x = s.net + (from === 0 ? -1 : 1) * (BALL_R + 0.5) // it drops at the foot of the net
    b.vx = -b.vx * 0.15
    b.vy *= 0.4
    b.vz = Math.min(b.vz, 0) * 0.5
    events.push({ type: 'sound', name: 'pop' })
    awardPoint(s, 1 - from, MSG.net, events)
    return
  }
  const blocker = s.kind === 'serve' ? null : blockerAt(s, 1 - from, y, z)
  if (!blocker) return
  touched(s, blocker, 'block')
  s.touchTeam = blocker.team // a block is not one of the blockers' three touches
  s.touches = 0
  events.push({ type: 'sound', name: 'pop' })
  const roll = random(s)
  if (roll < 0.4) { // stuffed: straight back down on the attackers' side
    b.x = s.net + (from === 0 ? -1 : 1) * (BALL_R + 1)
    b.vx = -b.vx * 0.25
    b.vy *= 0.4
    b.vz = -40 - random(s) * 40
    events.push({ type: 'banner', text: 'Block!' })
  } else if (roll < 0.75) { // softened: it pops up on the blockers' side, theirs to play
    b.vx *= 0.25
    b.vy *= 0.4
    b.vz = 75
  } else { // off the hands and away wide
    b.vx *= 0.5
    b.vy = (b.vy >= 0 ? 1 : -1) * (80 + random(s) * 70)
    b.vz = 55
  }
}

/** A player of `team` high in a jump at the net with their hands where the ball crosses. */
function blockerAt(s, team, y, z) {
  for (const p of s.players) {
    if (p.team !== team || p.z < 8) continue // hands up only near the top of the jump
    if (Math.abs(p.x - s.net) > NET_GAP + 4 || Math.abs(p.y - y) > 6) continue
    if (z <= p.z + REACH + 2) return p
  }
  return null
}

function land(s, events) {
  const b = s.ball
  b.z = BALL_R
  const inside = b.x >= -IN_SLACK && b.x <= s.w + IN_SLACK && b.y >= -IN_SLACK && b.y <= s.h + IN_SLACK
  if (!inside) {
    const faulty = s.touchTeam >= 0 ? s.touchTeam : b.x < s.net ? 1 : 0
    awardPoint(s, 1 - faulty, MSG.out, events)
    return
  }
  const winner = b.x < s.net ? 1 : 0
  let msg = MSG.point
  if (s.touchTeam === winner) msg = s.kind === 'serve' ? MSG.ace : s.kind === 'spike' ? MSG.kill : s.kind === 'block' ? MSG.block : MSG.point
  awardPoint(s, winner, msg, events)
}

/** After the point the ball bounces on the sand and stops at the net. */
function settle(s, x0) {
  const b = s.ball
  if ((x0 < s.net) !== (b.x < s.net) && b.z - BALL_R < NET_H && b.y >= 0 && b.y <= s.h) {
    b.x = x0
    b.vx = -b.vx * 0.2
  }
  if (b.z < BALL_R) {
    b.z = BALL_R
    b.vz = -b.vz * 0.35
    if (b.vz < 20) b.vz = 0
    b.vx *= 0.5
    b.vy *= 0.5
  }
  b.x = clamp(b.x, -40, s.w + 40)
  b.y = clamp(b.y, -40, s.h + 40)
}

// ----------------------------------------------------------------------------- scoring

function awardPoint(s, team, msg, events) {
  s.score[team]++
  s.phase = 'point'
  s.phaseTick = 0
  s.msg = msg
  s.msgTeam = team
  events.push({ type: 'sound', name: 'chime' }, { type: 'score', team: TEAM_IDS[team], score: scoreOf(s) })
  if (BANNERS[msg]) events.push({ type: 'banner', text: BANNERS[msg] })
  if (s.serving !== team) { // the serve changes sides: the new serving team rotates its server
    s.serving = team
    s.rot[team] = (s.rot[team] + 1) % s.n
    s.sideout = true
  }
  if (winnerOf(s) >= 0) endMatch(s, events, false)
}

/** The team that has won (first to points, by two; or to points + 4), or -1. */
function winnerOf(s) {
  for (let t = 0; t < 2; t++) {
    const me = s.score[t], them = s.score[1 - t]
    if (me >= s.points + 4 || (me >= s.points && me - them >= 2)) return t
  }
  return -1
}

/** Would the next point win the match for either team? */
function matchPoint(s, score = s.score, points = s.points) {
  for (let t = 0; t < 2; t++) {
    const me = score[t] + 1, them = score[1 - t]
    if (me >= points + 4 || (me >= points && me - them >= 2)) return true
  }
  return false
}

function endMatch(s, events, timeUp) {
  const [red, blue] = s.score
  s.winner = red > blue ? 0 : blue > red ? 1 : 2
  s.phase = 'over'
  s.phaseTick = 0
  s.clock = Math.max(0, s.clock)
  s.msg = timeUp ? MSG.time : MSG.won
  s.msgTeam = s.winner
  for (const p of s.players) { p.vx = 0; p.vy = 0 }
  if (timeUp) events.push({ type: 'banner', text: 'Time!' })
  events.push(
    { type: 'banner', text: s.winner === 2 ? 'A draw!' : TEAM_NAMES[s.winner] + ' wins!' },
    { type: 'sound', name: 'fanfare' },
    { type: 'end', winner: s.winner === 2 ? 'draw' : TEAM_IDS[s.winner], score: scoreOf(s) },
  )
}

function messageOf(snap, points) {
  const [msg, team] = snap.msg
  const name = TEAM_NAMES[team] || ''
  if (msg === MSG.serve) return name + ' serves' + (matchPoint(null, snap.sc, points) ? ' · match point' : '')
  if (msg === MSG.time) return 'Time! ' + (team === 2 ? 'A draw' : name + ' wins')
  if (msg === MSG.won) return team === 2 ? 'A draw' : name + ' wins!'
  const why = { 2: 'Ace! ', 3: 'Kill! ', 4: 'Out! ', 5: 'Net! ', 6: 'Four hits! ', 8: 'Block! ' }[msg] || ''
  return msg === MSG.none ? null : why + 'Point ' + name
}

// ----------------------------------------------------------------------------- bots

/** Decide where to go and what to do (every few ticks, by level). */
function think(s, p, L, m) {
  m.chase = false
  m.attack = false
  if (m.ball !== s.hits) { // a new ball in the air: roll this ball's dice once
    m.ball = s.hits
    m.whiff = random(s) < L.whiff
    m.jump = random(s) < L.jump
    m.block = random(s) < L.block
    m.jumped = false
    m.jumpAt = -1
  }
  if (s.phase === 'serve') {
    if (p === serverOf(s)) {
      if (m.serveAt < 0) m.serveAt = s.tick - s.phaseTick + SERVE_MIN + L.serveWait[0] + Math.floor(random(s) * (L.serveWait[1] - L.serveWait[0]))
      const [ax, ay] = openSpot(s, p.team, true)
      m.aimX = ax + noise(s) * L.aimErr
      m.aimY = ay + noise(s) * L.aimErr
      setTarget(m, [p.x, p.y])
    } else setTarget(m, basePosition(s, p))
    return
  }
  if (s.phase !== 'rally') { setTarget(m, basePosition(s, p)); return }
  if (ballIsOurs(s, p.team, L)) playBall(s, p, L, m)
  else defend(s, p, L, m)
}

/** The ball comes down on our side and we may still touch it. */
function ballIsOurs(s, team, L) {
  if (s.kind === 'serve' && s.touchTeam === team) return false
  if (s.touchTeam === team && s.touches >= 3) return false
  const b = s.ball
  const t = timeDown(b.z, b.vz, BALL_R)
  if (t === null) return false
  const x = b.x + b.vx * t, y = b.y + b.vy * t
  if ((x - s.net) * dirOf(team) >= 0) return false
  // A sharp player lets a ball the others hit out drop.
  const out = x < -4 || x > s.w + 4 || y < -4 || y > s.h + 4
  return !(L.judge && out && s.touchTeam !== team)
}

function contactHeight(touch, attack, jump) {
  if (attack) return jump ? JUMP_V * JUMP_V / (2 * PLAYER_G) + 15 : 19
  return touch === 1 ? 9 : 15
}

function playBall(s, p, L, m) {
  const team = p.team
  const touch = s.touchTeam === team ? s.touches + 1 : 1 // which of our touches comes next
  const chaser = chaserFor(s, team, touch)
  if (chaser !== p) { support(s, p, touch, chaser, m); return }
  const attack = touch >= 3 || (s.n === 1 && touch >= 2)
  let zc = contactHeight(touch, attack, false)
  let pt = interceptAt(s, team, zc)
  if (attack && m.jump && Math.abs(pt.x - s.net) < NEAR_NET - 6 && timeDown(s.ball.z, s.ball.vz, contactHeight(touch, true, true)) !== null) {
    zc = contactHeight(touch, true, true) // go up to meet it high
    pt = interceptAt(s, team, zc)
    if (!m.jumped) m.jumpAt = s.tick + Math.max(0, Math.round((pt.t - JUMP_TIME) * 60))
  }
  m.chase = true
  m.attack = attack
  m.zc = zc
  setTarget(m, [pt.x + noise(s) * L.err, pt.y + noise(s) * L.err])
}

/** Who goes for the ball: the one who gets there with most time to spare (shared by the team). */
function chaserFor(s, team, touch) {
  const plan = s.plans[team]
  let best = null, bestCost = Infinity, current = null, currentCost = Infinity
  for (const q of s.players) {
    if (q.team !== team) continue
    const pt = interceptAt(s, team, contactHeight(touch, false, false))
    const speed = RUN * (isBot(s, q) ? LEVELS[q.level].speed : 0.9)
    let cost = Math.hypot(pt.x - q.x, pt.y - q.y) / speed - pt.t
    if (q.index === s.lastHit && s.n > 1) cost += 0.5 // who touched it last leaves it to a teammate
    if (!isBot(s, q)) cost += 0.1 // a bot takes the close calls next to a person
    if (cost < bestCost) { bestCost = cost; best = q }
    if (q.index === plan.chaser) { current = q; currentCost = cost }
  }
  if (current && currentCost < bestCost + 0.25) best = current // no dithering
  plan.chaser = best.index
  return best
}

/** Where the ball comes down through height zc, kept on our side of the net. */
function interceptAt(s, team, zc) {
  const b = s.ball
  let t = timeDown(b.z, b.vz, zc)
  if (t === null) t = timeDown(b.z, b.vz, BALL_R + 2)
  if (t === null) t = 0
  const [x0, x1] = sideZone(s, team)
  return { x: clamp(b.x + b.vx * t, x0, x1), y: clamp(b.y + b.vy * t, -OUTSIDE, s.h + OUTSIDE), t }
}

/** Not my ball: be where the next touch will be needed. */
function support(s, p, touch, chaser, m) {
  const dir = dirOf(p.team)
  if (touch === 1) setTarget(m, [s.net - dir * (PASS_DEPTH + 4), clamp(p.y + (s.h / 2 - p.y) * 0.5, 16, s.h - 16)]) // ready to set
  else if (touch === 2) setTarget(m, [s.net - dir * (SET_DEPTH + 18), clamp(p.y, 16, s.h - 16)]) // ready to attack
  else setTarget(m, [s.net - dir * s.net * 0.55, clamp(chaser.y + (s.h / 2 - chaser.y) * 0.6, 16, s.h - 16)]) // cover
}

/** Their ball: take up a defensive spot, or go up to block an attack at the net. */
function defend(s, p, L, m) {
  const dir = dirOf(p.team)
  const opp = 1 - p.team
  if (m.block && s.touchTeam === opp && s.touches === 2 && s.n > 1) {
    const pt = interceptAt(s, opp, 26) // where their attacker will meet the set
    if (Math.abs(pt.x - s.net) < NEAR_NET && nearestInLane(s, p.team, pt.y) === p) {
      setTarget(m, [s.net - dir * (NET_GAP + 1), clamp(pt.y, 4, s.h - 4)])
      if (!m.jumped) m.jumpAt = s.tick + Math.max(0, Math.round((pt.t - JUMP_TIME * 0.5) * 60))
      return
    }
  }
  m.jumpAt = -1
  setTarget(m, basePosition(s, p))
}

function nearestInLane(s, team, y) {
  let best = null
  for (const q of s.players) if (q.team === team && (!best || Math.abs(q.y - y) < Math.abs(best.y - y))) best = q
  return best
}

/** Formation: receiving back, the server's partner mid-court, defence in between; side by side. */
function basePosition(s, p) {
  const dir = dirOf(p.team)
  let depth = 0.55
  if (s.phase === 'serve') depth = s.serving === p.team ? 0.42 : 0.68
  return [s.net - dir * s.net * depth, laneOf(s, p)]
}

/** A player's lane across the court; next to a person, a bot takes the other half. */
function laneOf(s, p) {
  let k = p.k
  if (s.n === 2) {
    const mate = s.players.find((q) => q.team === p.team && q !== p)
    if (mate && !isBot(s, mate) && isBot(s, p)) k = mate.y < s.h / 2 ? 1 : 0
  }
  return s.h / 2 + ((k + 0.5) / s.n - 0.5) * s.h * 0.9
}

function setTarget(m, [x, y]) {
  m.tx = x
  m.ty = y
}

/** Turn the plan into a stick and buttons. */
function act(s, p, L, m) {
  const out = { mx: 0, my: 0, a: false, b: false }
  const dx = m.tx - p.x, dy = m.ty - p.y
  const d = Math.hypot(dx, dy)
  if (d > 0.75) {
    const speed = L.speed * Math.min(1, d / 8) // slow down into the spot
    out.mx = dx / d * speed
    out.my = dy / d * speed
  }
  if (s.phase === 'serve') {
    if (p === serverOf(s) && m.serveAt >= 0 && s.tick >= m.serveAt) {
      out.a = true
      aimStick(s, p, m.aimX, m.aimY, true, out)
    }
    return out
  }
  if (s.phase !== 'rally') return out
  if (m.jumpAt >= 0 && s.tick >= m.jumpAt) {
    if (p.z === 0) out.b = true
    m.jumpAt = -1
    m.jumped = true // one jump per ball
  }
  if (m.chase && !m.whiff && reachOf(s, p) < Infinity) {
    const b = s.ball
    const nx = b.x + b.vx * TICK - p.x, ny = b.y + b.vy * TICK - p.y
    const leaving = Math.hypot(nx, ny) > HIT_R - 0.5 || b.z + b.vz * TICK < BALL_R + 2
    if (b.z <= m.zc + 1.5 || leaving) {
      out.a = true
      if (m.attack) {
        const [ax, ay, tip] = attackAim(s, p, L)
        aimStick(s, p, ax, ay, false, out)
        out.mx = tip ? -dirOf(p.team) : clamp(out.mx * dirOf(p.team), -0.75, 1) * dirOf(p.team) // pull back only to tip
      }
    }
  }
  return out
}

/** Where a bot attacks: the open spot, and a sharp bot plays round a block at the net or tips over it. */
function attackAim(s, p, L) {
  const dir = dirOf(p.team)
  const b = s.ball
  const blocker = s.players.find((q) => q.team !== p.team && Math.abs(q.x - s.net) < NET_GAP + 6 && Math.abs(q.y - b.y) < 14)
  let x, y
  if (blocker && random(s) < L.smart) {
    if (random(s) < 0.3) { // a tip just over the block: the stick pulled right back
      y = clamp(blocker.y + (random(s) < 0.5 ? -12 : 12), LANE_EDGE, s.h - LANE_EDGE)
      return [s.net + dir * 14, y + noise(s) * L.aimErr, true]
    }
    [x, y] = openSpot(s, p.team, false, b)
  } else [x, y] = openSpot(s, p.team, false, null)
  return [x + noise(s) * L.aimErr, y + noise(s) * L.aimErr, false]
}

/** The stick that aims a serve or attack at (tx, ty): aimAt() backwards. */
function aimStick(s, p, tx, ty, serve, out) {
  const dir = dirOf(p.team)
  const near = s.net + dir * 12, far = dir > 0 ? s.w - 9 : 9
  const depth = (tx - near) / (far - near)
  const forward = clamp(serve ? (depth - 0.72) / 0.22 : (depth - 0.55) / 0.4, -1, 1)
  out.mx = forward * dir
  out.my = clamp((ty - s.h / 2) / (s.h / 2 - LANE_EDGE), -1, 1)
  if (Math.hypot(out.mx, out.my) <= 0.3) out.mx = (forward < 0 ? -0.31 : 0.31) * dir
}

// ----------------------------------------------------------------------------- helpers

/** Next float in [0, 1) from the state's mulberry32 generator: the only randomness. */
function random(s) {
  const a = (s.rng + 0x6d2b79f5) >>> 0
  s.rng = a
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Roughly bell-shaped noise in [-1, 1]. */
function noise(s) {
  return (random(s) + random(s) + random(s) - 1.5) / 1.5
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function r1(v) {
  return Math.round(v * 10) / 10 || 0 // `|| 0` turns -0 into 0
}
