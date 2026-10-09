// Football for Mobius Town: 2-vs-2 (or 1-vs-1) top-down physics football in the
// spirit of Haxball. Pure functions on plain data (ES module, no dependencies).
//
//   createMatch({ players, seed = 1, duration = 180 }) -> state
//   stepMatch(state, inputs, dt) -> events[]
//   chooseFootballInput(state, playerId) -> { mx, my, kick }
//   encodeSnapshot(state) -> snapshot (a small JSON array, see below)
//   decodeSnapshot(state, snapshot) -> events[] | null
//   interpolateSnapshot(state, from, to, alpha) -> events[] | null
//   snapshotTick(snapshot) -> tick | null
//   matchSummary(state) -> { phase, score: { red, blue }, clockLeft, phaseLeft, winner, lastGoal }
//   FIELD, TUNING (geometry and physics constants for the renderer)
//
// Deterministic: no DOM, timers, network or Math.random. The only randomness
// (bot noise) comes from a seeded PRNG kept in the state, and stepMatch advances
// in fixed 1/60 s ticks through an accumulator, so the same inputs give the same
// match however the caller slices time. The state is plain JSON-able data.
//
// Units are pixels and seconds. (0, 0) is the top-left corner of the pitch
// inside the lines; x grows to the right, y downwards. Red attacks the right
// goal (x = FIELD.w), blue the left goal (x = 0).
//
// players  [{ id, team: 'red' | 'blue', name?, bot?: 'easy' | 'medium' | 'hard' }],
//          one or two per team (bot: true means 'medium'). createMatch throws a
//          TypeError for bad input. A bot is driven by chooseFootballInput
//          whenever stepMatch gets no input for it; state.players[i].bot may be
//          changed mid-match (e.g. to let a bot stand in for a dropped player).
// inputs   { [playerId]: { mx, my, kick } }. mx, my: analog stick in [-1, 1]
//          (the vector is clamped to length 1, so diagonals are not faster).
//          kick: the kick button is down. Held, it kicks whenever the ball is in
//          reach and the cooldown allows; a press is remembered for ~0.12 s, so
//          a tap just before the ball arrives still kicks. Missing = idle.
// events   { type: 'kick', id } | { type: 'goal', team, scorer, own }
//          | { type: 'phase', phase } | { type: 'end', winner }
//          | { type: 'post' } | { type: 'bounce' }, each with the `tick` it
//          happened on. scorer: id of the last player to touch the ball, or of
//          the scoring team's shooter when a defender only deflected the shot in
//          (null if unknown); own: true for an own goal. Bounces and posts are
//          rate-limited (at most one of each per 0.1 s).
// state    plain data the renderer reads directly: ball { x, y, vx, vy };
//          players[i] { id, team, name, bot, x, y, vx, vy, facing } with facing
//          in radians (0 = +x, PI / 2 = +y): the way the player last ran or
//          kicked. Treat everything else in it as private.
//
// Phases   kickoff  1.5 s freeze, inputs ignored: formation positions, ball on
//                   the centre spot, the kicking team's nearest player just
//                   behind it. Red kicks off first.
//          play     the match clock (duration seconds of play) runs.
//          goal     2.5 s: play goes on but no goal counts and the clock stops;
//                   then a kickoff by the team that conceded, or the end if the
//                   clock ran out.
//          ended    frozen; the winner is 'red', 'blue' or 'draw'.
//
// Networking. The host steps the match and sends encodeSnapshot(state) about 15
// times a second (about 150 bytes of JSON for four players):
//   [1, tick, phase (0 kickoff, 1 play, 2 goal, 3 ended), phase ticks left,
//    clock ticks left, [red, blue], kicking-off team (0 red, 1 blue),
//    last toucher (player index or -1), last goal ([team, scorer index or -1,
//    own 0 | 1] or 0), [ball x, y, vx, vy], [[player index, x, y, vx, vy,
//    facing in 16ths of a turn], ...]]
// with positions to 0.1 px and velocities to 1 px/s; a tick is 1/60 s.
// Player indexes follow the `players` array given to createMatch, so every peer
// must create its state from the same list. Clients keep their own state from
// createMatch and apply snapshots with decodeSnapshot (or, to smooth them,
// interpolateSnapshot between the two snapshots around a render time about two
// snapshots behind the newest). Both return the goal / phase / end events the
// snapshot implies, so only kick / post / bounce sounds need the host's event
// list. A new host continues from its last decoded snapshot with stepMatch.

const TAU = Math.PI * 2

const W = 352
const H = 192
const CX = W / 2
const CY = H / 2
const GOAL_MOUTH = 56
const GOAL_DEPTH = 14
const GOAL_TOP = CY - GOAL_MOUTH / 2 // y of the upper posts (68)
const GOAL_BOTTOM = CY + GOAL_MOUTH / 2 // y of the lower posts (124)
const PR = 6 // player radius
const BR = 3.5 // ball radius
const POST_R = 2.5
const MARGIN = 10 // how far a player's centre may run beyond the lines
const POSTS = [[0, GOAL_TOP], [0, GOAL_BOTTOM], [W, GOAL_TOP], [W, GOAL_BOTTOM]]

export const FIELD = Object.freeze({
  w: W,
  h: H,
  goalMouth: GOAL_MOUTH,
  goalDepth: GOAL_DEPTH,
  goalTop: GOAL_TOP,
  goalBottom: GOAL_BOTTOM,
  playerRadius: PR,
  ballRadius: BR,
  postRadius: POST_R,
  posts: Object.freeze(POSTS.map(post => Object.freeze(post.slice()))), // [x, y] centres
  centre: Object.freeze([CX, CY]),
  centreCircle: 28,
  boxDepth: 48, // penalty boxes: 48 deep, 112 tall, centred on each goal
  boxHeight: 112,
  margin: MARGIN,
})

const TICK_RATE = 60
const DT = 1 / TICK_RATE
const SUBSTEPS = 3 // collisions are checked 3 times a tick: a full-speed ball moves < 1.6 px between checks
const UNITS_PER_TICK = 1000 // the accumulator counts 1/60000 s, so sliced time adds up exactly
const MAX_CALL_DT = 0.25 // a stalled tab pauses the match rather than fast-forwarding it

const PLAYER_SPEED = 72
const PLAYER_ACCEL = 500 // px/s² towards the stick's velocity (top speed in ~0.15 s)
const PLAYER_DECEL = 380 // px/s² once the stick is released (stops in ~0.2 s)
const INV_PLAYER_MASS = 1 / 3
const INV_BALL_MASS = 1
const BALL_FRICTION = 1.1 // per second: v *= exp(-1.1 dt), so a ball rolls v / 1.1 px
const BALL_DECAY = Math.exp(-BALL_FRICTION * DT)
const BALL_STOP = 2
const BALL_MAX = 280
const KICK_POWER = 230
const KICK_GAP = 5
const KICK_DIST = PR + BR + KICK_GAP
const KICK_COOLDOWN = 15 // ticks (0.25 s)
const KICK_WINDOW = 7 // ticks a press waits for the ball to come into reach
const E_WALL = 0.6
const E_NET = 0.25 // nets swallow the ball
const E_POST = 0.6
const E_TOUCH = 0.4 // player against ball: the ball runs a little ahead, which is a dribble
const E_PLAYERS = 0.3
const KICKOFF_TICKS = 90
const GOAL_TICKS = 150
const DEFLECTION_TICKS = 90 // a shot touched by a defender on its way in still belongs to the shooter
const BOUNCE_MIN = 30 // px/s into a wall before it is worth a sound
const POST_MIN = 15
const SOUND_GAP = 6 // ticks between two bounce (or two post) events

export const TUNING = Object.freeze({
  tickRate: TICK_RATE,
  playerSpeed: PLAYER_SPEED,
  playerAccel: PLAYER_ACCEL,
  playerDecel: PLAYER_DECEL,
  playerMass: 1 / INV_PLAYER_MASS,
  ballMass: 1 / INV_BALL_MASS,
  ballFriction: BALL_FRICTION,
  ballStopSpeed: BALL_STOP,
  ballMaxSpeed: BALL_MAX,
  kickPower: KICK_POWER,
  kickReach: KICK_GAP, // max gap between player and ball for a kick
  kickCooldown: KICK_COOLDOWN / TICK_RATE,
  kickWindow: KICK_WINDOW / TICK_RATE,
  wallRestitution: E_WALL,
  netRestitution: E_NET,
  postRestitution: E_POST,
  kickoffSeconds: KICKOFF_TICKS / TICK_RATE,
  goalSeconds: GOAL_TICKS / TICK_RATE,
})

const TEAMS = ['red', 'blue']
const PHASES = ['kickoff', 'play', 'goal', 'ended']
const IDLE = Object.freeze({ mx: 0, my: 0, kick: false })

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const dist = (ax, ay, bx, by) => Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))
const attackDir = team => (team === 'red' ? 1 : -1)
const otherTeam = team => (team === 'red' ? 'blue' : 'red')

/** Next float in [0, 1) from the state's mulberry32 generator. */
function random(state) {
  const a = (state.rng + 0x6d2b79f5) >>> 0
  state.rng = a
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ---------------------------------------------------------------- match setup

/** A new match in its first kickoff (red to kick off). Throws a TypeError for bad input. */
export function createMatch({ players, seed = 1, duration = 180 } = {}) {
  if (!Array.isArray(players)) throw new TypeError('createMatch: players must be an array')
  const ids = new Set()
  const size = { red: 0, blue: 0 }
  const list = players.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') throw new TypeError(`createMatch: player ${index} must be an object`)
    const { id, team, name, bot } = entry
    if (typeof id !== 'string' || id === '') throw new TypeError(`createMatch: player ${index} needs a non-empty string id`)
    if (ids.has(id)) throw new TypeError(`createMatch: duplicate player id ${JSON.stringify(id)}`)
    ids.add(id)
    if (team !== 'red' && team !== 'blue') throw new TypeError(`createMatch: unknown team ${JSON.stringify(team)} for ${id}`)
    if (++size[team] > 2) throw new TypeError(`createMatch: more than two players on ${team}`)
    if (name !== undefined && name !== null && typeof name !== 'string') throw new TypeError(`createMatch: name of ${id} must be a string`)
    let level = null
    if (bot === true) level = 'medium'
    else if (bot) {
      if (typeof bot !== 'string' || !hasOwn(BOTS, bot)) throw new TypeError(`createMatch: unknown bot level ${JSON.stringify(bot)} for ${id}`)
      level = bot
    }
    return {
      id, team, name: name || id, bot: level, index, slot: size[team] - 1,
      x: 0, y: 0, vx: 0, vy: 0, facing: 0, cooldown: 0, kickWindow: 0, mem: null,
    }
  })
  if (size.red === 0 || size.blue === 0) throw new TypeError('createMatch: each team needs a player')
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new TypeError('createMatch: seed must be a finite number')
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new TypeError('createMatch: duration must be a positive number of seconds')
  }
  const state = {
    players: list,
    teamSize: size,
    ball: { x: CX, y: CY, vx: 0, vy: 0 },
    phase: 'kickoff',
    phaseTicks: KICKOFF_TICKS, // ticks left in a kickoff or goal phase
    clockTicks: Math.max(1, Math.round(duration * TICK_RATE)), // ticks of play left
    score: { red: 0, blue: 0 },
    kickoffTeam: 'red',
    lastTouch: -1, // index of the last player to touch the ball since the kickoff
    teamTouch: { red: { index: -1, tick: 0 }, blue: { index: -1, tick: 0 } }, // each team's last touch
    lastGoal: null, // { team, scorer, own }
    tick: 0,
    acc: 0, // time not yet simulated, in 1/60000 s
    rng: seed >>> 0,
    bounceWait: 0, // ticks until another bounce event may be reported
    postWait: 0,
    attackers: { red: -1, blue: -1 }, // bots: which teammate goes for the ball
  }
  for (const p of list) placeAt(p, formation(state, p))
  startKickoff(state, 'red')
  return state
}

function placeAt(p, [x, y]) {
  p.x = x
  p.y = y
}

/** Formation spot in the team's own half: 1v1 mid-half, 2v2 one high and one low. */
function formation(state, p) {
  const x = p.team === 'red' ? W / 4 : W * 3 / 4
  if (state.teamSize[p.team] < 2) return [x, CY]
  return [x, p.slot === 0 ? CY - 32 : CY + 32]
}

function startKickoff(state, team) {
  state.phase = 'kickoff'
  state.phaseTicks = KICKOFF_TICKS
  state.kickoffTeam = team
  state.lastTouch = -1
  state.teamTouch = { red: { index: -1, tick: 0 }, blue: { index: -1, tick: 0 } }
  state.attackers = { red: -1, blue: -1 }
  // Whoever of the kicking team stands nearest the ball right now takes the kick.
  let taker = null, best = Infinity
  for (const p of state.players) {
    if (p.team !== team) continue
    const d = dist(p.x, p.y, CX, CY)
    if (d < best) { best = d; taker = p }
  }
  for (const p of state.players) {
    if (p === taker) placeAt(p, [CX - attackDir(team) * (PR + BR + 2), CY])
    else placeAt(p, formation(state, p))
    p.vx = 0
    p.vy = 0
    p.facing = p.team === 'red' ? 0 : Math.PI
    p.cooldown = 0
    p.kickWindow = 0
    p.mem = null
  }
  const ball = state.ball
  ball.x = CX
  ball.y = CY
  ball.vx = 0
  ball.vy = 0
}

// ---------------------------------------------------------------- stepping

function readInput(input) {
  if (input === null || typeof input !== 'object') return IDLE
  let mx = typeof input.mx === 'number' && Number.isFinite(input.mx) ? input.mx : 0
  let my = typeof input.my === 'number' && Number.isFinite(input.my) ? input.my : 0
  const m = Math.sqrt(mx * mx + my * my)
  if (m > 1) { mx /= m; my /= m }
  return { mx, my, kick: !!input.kick }
}

/**
 * Advance the match by dt seconds (clamped to 0.25 s per call) in fixed 1/60 s
 * ticks; leftover time waits in state.acc for the next call. Returns the events.
 */
export function stepMatch(state, inputs, dt) {
  const events = []
  if (!state || state.phase === 'ended') return events
  const given = state.players.map(p => (inputs && typeof inputs === 'object' && hasOwn(inputs, p.id) ? readInput(inputs[p.id]) : null))
  // A press that arrives between ticks still counts at the next tick.
  if (state.phase !== 'kickoff') {
    given.forEach((input, i) => { if (input && input.kick) state.players[i].kickWindow = KICK_WINDOW })
  }
  const seconds = typeof dt === 'number' && dt > 0 ? Math.min(dt, MAX_CALL_DT) : 0
  state.acc += Math.round(seconds * TICK_RATE * UNITS_PER_TICK)
  while (state.acc >= UNITS_PER_TICK) {
    state.acc -= UNITS_PER_TICK
    tick(state, given, events)
    if (state.phase === 'ended') { state.acc = 0; break }
  }
  return events
}

function tick(state, given, events) {
  state.tick++
  if (state.bounceWait > 0) state.bounceWait--
  if (state.postWait > 0) state.postWait--
  if (state.phase === 'kickoff') {
    if (--state.phaseTicks <= 0) {
      state.phase = 'play'
      state.phaseTicks = 0
      events.push({ type: 'phase', phase: 'play', tick: state.tick })
    }
    return
  }
  const { players, ball } = state
  // Every bot decides from the same picture of the pitch before anyone moves.
  const controls = players.map((p, i) => given[i] || (p.bot ? readInput(chooseFootballInput(state, p.id)) : IDLE))
  for (let i = 0; i < players.length; i++) {
    const p = players[i], input = controls[i]
    steer(p, input)
    if (input.kick) p.kickWindow = KICK_WINDOW
    if (p.cooldown > 0) p.cooldown--
  }
  for (const p of players) tryKick(state, p, events)
  const impact = { wall: 0, post: 0 }
  for (let s = 0; s < SUBSTEPS; s++) moveAndCollide(state, impact)
  ball.vx *= BALL_DECAY
  ball.vy *= BALL_DECAY
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
  if (speed < BALL_STOP) { ball.vx = 0; ball.vy = 0 }
  if (impact.post >= POST_MIN && state.postWait === 0) {
    events.push({ type: 'post', tick: state.tick })
    state.postWait = SOUND_GAP
  } else if (impact.wall >= BOUNCE_MIN && state.bounceWait === 0) {
    events.push({ type: 'bounce', tick: state.tick })
    state.bounceWait = SOUND_GAP
  }
  if (state.phase === 'play') {
    state.clockTicks--
    const team = scoringTeam(ball)
    if (team) scoreGoal(state, team, events)
    else if (state.clockTicks <= 0) endMatch(state, events)
  } else if (--state.phaseTicks <= 0) { // the goal celebration is over
    if (state.clockTicks <= 0) endMatch(state, events)
    else {
      startKickoff(state, otherTeam(state.lastGoal ? state.lastGoal.team : otherTeam(state.kickoffTeam)))
      events.push({ type: 'phase', phase: 'kickoff', tick: state.tick })
    }
  }
}

/** Move the player's velocity towards the stick's at a limited rate. */
function steer(p, input) {
  const tx = input.mx * PLAYER_SPEED, ty = input.my * PLAYER_SPEED
  const dvx = tx - p.vx, dvy = ty - p.vy
  const dv = Math.sqrt(dvx * dvx + dvy * dvy)
  const limit = (input.mx !== 0 || input.my !== 0 ? PLAYER_ACCEL : PLAYER_DECEL) * DT
  if (dv <= limit) {
    p.vx = tx
    p.vy = ty
  } else {
    p.vx += dvx / dv * limit
    p.vy += dvy / dv * limit
  }
  if (input.mx * input.mx + input.my * input.my > 0.04) p.facing = Math.atan2(input.my, input.mx)
}

/** Haxball rule: the kick pushes the ball straight away from the kicker's centre. */
function tryKick(state, p, events) {
  if (p.kickWindow <= 0) return
  const ball = state.ball
  const dx = ball.x - p.x, dy = ball.y - p.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (p.cooldown > 0 || d > KICK_DIST) {
    p.kickWindow--
    return
  }
  const nx = d > 1e-9 ? dx / d : Math.cos(p.facing)
  const ny = d > 1e-9 ? dy / d : Math.sin(p.facing)
  ball.vx += nx * KICK_POWER
  ball.vy += ny * KICK_POWER
  limitBallSpeed(ball)
  p.facing = Math.atan2(ny, nx)
  p.cooldown = KICK_COOLDOWN
  p.kickWindow = 0
  touch(state, p)
  events.push({ type: 'kick', id: p.id, tick: state.tick })
}

function touch(state, p) {
  state.lastTouch = p.index
  const mark = state.teamTouch[p.team]
  mark.index = p.index
  mark.tick = state.tick
}

function limitBallSpeed(ball) {
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
  if (speed > BALL_MAX) {
    ball.vx *= BALL_MAX / speed
    ball.vy *= BALL_MAX / speed
  }
}

function moveAndCollide(state, impact) {
  const h = DT / SUBSTEPS
  const { players, ball } = state
  for (const p of players) {
    p.x += p.vx * h
    p.y += p.vy * h
  }
  ball.x += ball.vx * h
  ball.y += ball.vy * h
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) collide(players[i], players[j], PR + PR, INV_PLAYER_MASS, INV_PLAYER_MASS, E_PLAYERS)
  }
  for (const p of players) {
    if (collide(p, ball, PR + BR, INV_PLAYER_MASS, INV_BALL_MASS, E_TOUCH)) touch(state, p)
  }
  for (const p of players) keepPlayerIn(p)
  keepBallIn(ball, impact)
  limitBallSpeed(ball)
}

/** Separate two overlapping discs and bounce them apart; true if they touched. */
function collide(a, b, reach, ia, ib, e) {
  const dx = b.x - a.x, dy = b.y - a.y
  const d2 = dx * dx + dy * dy
  if (d2 >= reach * reach) return false
  const d = Math.sqrt(d2)
  const nx = d > 1e-9 ? dx / d : 1, ny = d > 1e-9 ? dy / d : 0
  const push = (reach - d) / (ia + ib)
  a.x -= nx * push * ia
  a.y -= ny * push * ia
  b.x += nx * push * ib
  b.y += ny * push * ib
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn < 0) {
    const j = -(1 + e) * vn / (ia + ib)
    a.vx -= nx * j * ia
    a.vy -= ny * j * ia
    b.vx += nx * j * ib
    b.vy += ny * j * ib
  }
  return true
}

/** Push a body out of a fixed disc (a post); returns the speed it hit with. */
function offPost(body, px, py, reach, e) {
  const dx = body.x - px, dy = body.y - py
  const d2 = dx * dx + dy * dy
  if (d2 >= reach * reach) return 0
  const d = Math.sqrt(d2)
  const nx = d > 1e-9 ? dx / d : px === 0 ? 1 : -1, ny = d > 1e-9 ? dy / d : 0
  body.x = px + nx * reach
  body.y = py + ny * reach
  const vn = body.vx * nx + body.vy * ny
  if (vn >= 0) return 0
  body.vx -= (1 + e) * vn * nx
  body.vy -= (1 + e) * vn * ny
  return -vn
}

/** Players may step a little over the lines but never into a goal. */
function keepPlayerIn(p) {
  if (p.x < -MARGIN) { p.x = -MARGIN; if (p.vx < 0) p.vx = 0 }
  if (p.x > W + MARGIN) { p.x = W + MARGIN; if (p.vx > 0) p.vx = 0 }
  if (p.y < -MARGIN) { p.y = -MARGIN; if (p.vy < 0) p.vy = 0 }
  if (p.y > H + MARGIN) { p.y = H + MARGIN; if (p.vy > 0) p.vy = 0 }
  // Each goal is a solid box reaching back to the edge of the play area.
  if (p.y > GOAL_TOP - PR && p.y < GOAL_BOTTOM + PR) {
    if (p.x < PR) blockOutOfGoal(p, Math.min(p.x, 0), 1)
    else if (p.x > W - PR) blockOutOfGoal(p, Math.max(p.x, W), -1)
  }
  for (let i = 0; i < POSTS.length; i++) offPost(p, POSTS[i][0], POSTS[i][1], POST_R + PR, 0)
}

/** cx: the goal box's point nearest the player along x; inward: +1 left goal, -1 right goal. */
function blockOutOfGoal(p, cx, inward) {
  const lineX = inward > 0 ? 0 : W
  const cy = clamp(p.y, GOAL_TOP, GOAL_BOTTOM)
  const dx = p.x - cx, dy = p.y - cy
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d >= PR) return
  if (d > 1e-9 && (p.x - lineX) * inward > 0) { // outside the box: push straight away from it
    p.x = cx + dx / d * PR
    p.y = cy + dy / d * PR
    const vn = (p.vx * dx + p.vy * dy) / d
    if (vn < 0) {
      p.vx -= vn * dx / d
      p.vy -= vn * dy / d
    }
    return
  }
  // Inside the box: leave by the shortest way (onto the pitch, or above / below the net).
  const depthIn = (lineX - p.x) * inward + PR
  const up = p.y - (GOAL_TOP - PR), down = GOAL_BOTTOM + PR - p.y
  if (depthIn <= up && depthIn <= down) {
    p.x = lineX + inward * PR
    if (p.vx * inward < 0) p.vx = 0
  } else if (up <= down) {
    p.y = GOAL_TOP - PR
    if (p.vy > 0) p.vy = 0
  } else {
    p.y = GOAL_BOTTOM + PR
    if (p.vy < 0) p.vy = 0
  }
}

/**
 * The ball bounces off the lines except through a goal mouth; inside a net it
 * bounces (softly) off the sides and back. The order matters near the posts: the
 * end lines come first, so a ball beside a goal always goes back onto the pitch.
 */
function keepBallIn(ball, impact) {
  if (ball.y < GOAL_TOP || ball.y > GOAL_BOTTOM) {
    if (ball.x < BR) {
      ball.x = BR
      if (ball.vx < 0) { impact.wall = Math.max(impact.wall, -ball.vx); ball.vx = -ball.vx * E_WALL }
    } else if (ball.x > W - BR) {
      ball.x = W - BR
      if (ball.vx > 0) { impact.wall = Math.max(impact.wall, ball.vx); ball.vx = -ball.vx * E_WALL }
    }
  } else if (ball.x < 0 || ball.x > W) { // in a net
    if (ball.y < GOAL_TOP + BR) {
      ball.y = GOAL_TOP + BR
      if (ball.vy < 0) ball.vy = -ball.vy * E_NET
    } else if (ball.y > GOAL_BOTTOM - BR) {
      ball.y = GOAL_BOTTOM - BR
      if (ball.vy > 0) ball.vy = -ball.vy * E_NET
    }
    if (ball.x < BR - GOAL_DEPTH) {
      ball.x = BR - GOAL_DEPTH
      if (ball.vx < 0) ball.vx = -ball.vx * E_NET
    } else if (ball.x > W + GOAL_DEPTH - BR) {
      ball.x = W + GOAL_DEPTH - BR
      if (ball.vx > 0) ball.vx = -ball.vx * E_NET
    }
  }
  if (ball.y < BR) {
    ball.y = BR
    if (ball.vy < 0) { impact.wall = Math.max(impact.wall, -ball.vy); ball.vy = -ball.vy * E_WALL }
  } else if (ball.y > H - BR) {
    ball.y = H - BR
    if (ball.vy > 0) { impact.wall = Math.max(impact.wall, ball.vy); ball.vy = -ball.vy * E_WALL }
  }
  for (let i = 0; i < POSTS.length; i++) {
    impact.post = Math.max(impact.post, offPost(ball, POSTS[i][0], POSTS[i][1], POST_R + BR, E_POST))
  }
}

/** The team that scores when the whole ball is over a goal line between the posts. */
function scoringTeam(ball) {
  if (ball.y <= GOAL_TOP || ball.y >= GOAL_BOTTOM) return null
  if (ball.x < -BR) return 'blue'
  if (ball.x > W + BR) return 'red'
  return null
}

/**
 * The goal goes to the last player to touch the ball. If that was a defender,
 * a shot from the scoring team in the last 1.5 s still counts as theirs (a
 * deflection); otherwise it is an own goal.
 */
function scoreGoal(state, team, events) {
  const last = state.players[state.lastTouch] || null
  const mark = state.teamTouch[team]
  let scorer = last, own = false
  if (last && last.team !== team) {
    if (mark.index >= 0 && state.tick - mark.tick <= DEFLECTION_TICKS) scorer = state.players[mark.index]
    else own = true
  }
  const goal = { team, scorer: scorer ? scorer.id : null, own }
  state.score[team]++
  state.lastGoal = goal
  state.phase = 'goal'
  state.phaseTicks = GOAL_TICKS
  events.push({ type: 'goal', ...goal, tick: state.tick }, { type: 'phase', phase: 'goal', tick: state.tick })
}

function winnerOf(state) {
  const { red, blue } = state.score
  return red > blue ? 'red' : blue > red ? 'blue' : 'draw'
}

function endMatch(state, events) {
  state.phase = 'ended'
  state.phaseTicks = 0
  state.clockTicks = Math.max(0, state.clockTicks)
  for (const body of [state.ball, ...state.players]) {
    body.vx = 0
    body.vy = 0
  }
  events.push({ type: 'phase', phase: 'ended', tick: state.tick }, { type: 'end', winner: winnerOf(state), tick: state.tick })
}

/** What the HUD shows. Times are in seconds; winner is null until the match has ended. */
export function matchSummary(state) {
  return {
    phase: state.phase,
    score: { red: state.score.red, blue: state.score.blue },
    clockLeft: Math.max(0, state.clockTicks) / TICK_RATE,
    phaseLeft: Math.max(0, state.phaseTicks) / TICK_RATE,
    winner: state.phase === 'ended' ? winnerOf(state) : null,
    lastGoal: state.lastGoal ? { ...state.lastGoal } : null,
  }
}

// ---------------------------------------------------------------- bots

// think: ticks between decisions (their reaction time) plus up to `jitter` more;
// speed: fraction of top speed; aimNoise: px of error on the aim point;
// tolerance: how far off the aim (radians) a shot may go; lead: seconds ahead
// they predict the ball; shootRange: px from the goal they shoot from;
// smart: dribble round a defender who blocks every shot.
const BOTS = {
  easy: { think: 22, jitter: 10, speed: 0.68, aimNoise: 12, tolerance: 0.32, lead: 0, shootRange: 140, smart: false },
  medium: { think: 11, jitter: 5, speed: 0.86, aimNoise: 7, tolerance: 0.26, lead: 0.15, shootRange: 130, smart: true },
  hard: { think: 4, jitter: 2, speed: 1, aimNoise: 2.5, tolerance: 0.15, lead: 0.3, shootRange: 120, smart: true },
}

/**
 * The input a bot of the player's level (medium for a human) would give this
 * tick. It may update the player's bot memory and draw from the state's PRNG,
 * so call it once per tick per player (stepMatch does this for bots).
 */
export function chooseFootballInput(state, playerId) {
  const p = state && Array.isArray(state.players) ? state.players.find(q => q.id === playerId) : undefined
  if (!p || (state.phase !== 'play' && state.phase !== 'goal')) return { mx: 0, my: 0, kick: false }
  const bot = hasOwn(BOTS, p.bot) ? BOTS[p.bot] : BOTS.medium
  if (!p.mem) p.mem = { next: 0, tx: p.x, ty: p.y, arrive: true, kick: false, clear: false, cover: false, aimX: 0, aimY: 0, shoot: true, aimUntil: 0 }
  const mem = p.mem
  if (state.tick >= mem.next) { // a slow bot keeps acting on what it saw a while ago
    think(state, p, bot, mem)
    mem.next = state.tick + bot.think + Math.floor(random(state) * (bot.jitter + 1))
  }
  return act(state, p, bot, mem)
}

function think(state, p, bot, mem) {
  mem.kick = false
  mem.clear = false
  if (state.phase === 'goal') { // jog back into position while the goal is celebrated
    setTarget(mem, formation(state, p), true)
    return
  }
  const dir = attackDir(p.team)
  const ball = state.ball
  const lone = !state.players.some(q => q.team === p.team && q !== p)
  const attacker = isAttacker(state, p)
  const danger = shotAtGoal(ball, dir)
  if (danger && (!attacker || lone || (ball.x - p.x) * dir > 0)) {
    // The ball is rolling into our goal and we are on the right side to stop it.
    setTarget(mem, intercept(p, bot, ball, danger, dir), false)
    mem.clear = true
  } else if (lone && covers(state, p, mem, dir)) planCover(state, p, bot, mem)
  else if (attacker) planAttack(state, p, bot, mem)
  else planDefence(state, p, bot, mem)
}

/**
 * A bot alone in its team guards its goal instead of attacking when the
 * opponent will reach the ball first, or is nearer while the bot would have to
 * run round the ball. Once covering it keeps covering until it is clearly first
 * to the ball (no dithering), except that a dead ball it stands next to on the
 * goal side is always worth winning.
 */
function covers(state, p, mem, dir) {
  const ball = state.ball
  const me = dist(p.x, p.y, ball.x, ball.y)
  const them = nearestOpponent(state, p, ball.x, ball.y)
  const goalSide = (ball.x - p.x) * dir > 0
  if (goalSide && me < 30 && ball.vx * ball.vx + ball.vy * ball.vy < 25 * 25) mem.cover = false
  else mem.cover = mem.cover ? me > them - 6 : me > them + 12 || (!goalSide && them < me)
  return mem.cover
}

/**
 * Where the ball will cross our goal line between the posts (with a little
 * margin) if it rolls on, or null. Friction slows both axes alike, so the path
 * is a straight line; wall bounces are ignored.
 */
function shotAtGoal(ball, dir) {
  const lineX = dir > 0 ? 0 : W
  const dx = lineX - ball.x
  if (ball.vx * dx <= 0 || Math.abs(dx) >= Math.abs(ball.vx) / BALL_FRICTION) return null
  const y = ball.y + ball.vy * dx / ball.vx
  return y > GOAL_TOP - 4 && y < GOAL_BOTTOM + 4 ? [lineX, y] : null
}

/** The first point along the ball's path the bot can reach before the ball does. */
function intercept(p, bot, ball, [cx, cy], dir) {
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
  const run = PLAYER_SPEED * bot.speed
  for (let i = 1; i <= 6; i++) {
    const x = ball.x + (cx - ball.x) * i / 6, y = ball.y + (cy - ball.y) * i / 6
    const left = 1 - BALL_FRICTION * dist(ball.x, ball.y, x, y) / speed
    const ballTime = left > 0 ? -Math.log(left) / BALL_FRICTION : Infinity
    const myTime = Math.max(0, dist(p.x, p.y, x, y) - PR - BR) / run + bot.think / TICK_RATE / 2
    if (myTime <= ballTime) return [x, y]
  }
  return [cx + dir * (PR + 1), clamp(cy, GOAL_TOP, GOAL_BOTTOM)] // last ditch: on the line
}

/**
 * Wait on the line from the ball to the middle of our goal, a few steps off the
 * ball (getting there round the ball, not through it). A ball that has stopped
 * is closed down instead, so two players never just stare at it.
 */
function planCover(state, p, bot, mem) {
  const ownX = attackDir(p.team) > 0 ? 0 : W
  const ball = state.ball
  const [bx, by] = predictBall(ball, bot.lead)
  const d = dist(bx, by, ownX, CY) || 1
  const slow = ball.vx * ball.vx + ball.vy * ball.vy < 25 * 25
  const back = slow ? PR + BR + 4 : clamp(d * 0.35, 18, 70)
  setTarget(mem, roundBall(p, bx, by, (ownX - bx) / d, (CY - by) / d, back), true)
  mem.clear = true
}

const ORBIT = PR + BR + 6 // how close a bot passes the ball when going round it
const AIM_HOLD = 30 // ticks an attacker keeps its aim point
const DRIBBLE_ANGLE = 0.4 // radians off the line that still pushes the ball the right way
const CUT_BACK_ANGLE = 0.3 // a goal mouth narrower than this (radians) is not worth a shot

/**
 * Next waypoint to the spot `r` px from the ball (bx, by) in the unit direction
 * (dx, dy). From the wrong side the bot circles the ball at ORBIT, 0.9 rad per
 * waypoint, so its straight runs between waypoints never touch the ball.
 */
function roundBall(p, bx, by, dx, dy, r) {
  const nx = -dy, ny = dx
  const rx = p.x - bx, ry = p.y - by
  const angle = Math.atan2(rx * nx + ry * ny, rx * dx + ry * dy) // 0: already on that side
  if (Math.abs(angle) <= 0.9) return [bx + dx * r, by + dy * r]
  const t = angle - Math.sign(angle) * 0.9
  const c = Math.cos(t), s = Math.sin(t)
  return [bx + ORBIT * (c * dx + s * nx), by + ORBIT * (c * dy + s * ny)]
}

function setTarget(mem, [x, y], arrive) {
  mem.tx = clamp(x, -MARGIN, W + MARGIN)
  mem.ty = clamp(y, -MARGIN, H + MARGIN)
  mem.arrive = arrive
}

/** Run at the target; slow down into it when arriving; kick when it makes sense. */
function act(state, p, bot, mem) {
  const dx = mem.tx - p.x, dy = mem.ty - p.y
  const d = Math.sqrt(dx * dx + dy * dy)
  let mx = 0, my = 0
  if (d > 0.5) {
    const speed = bot.speed * (mem.arrive ? Math.min(1, d / 12) : 1)
    mx = dx / d * speed
    my = dy / d * speed
  }
  return { mx, my, kick: wantsKick(state, p, bot, mem) }
}

function wantsKick(state, p, bot, mem) {
  if (!mem.kick && !mem.clear) return false
  const ball = state.ball
  const kx = ball.x - p.x, ky = ball.y - p.y
  const kd = Math.sqrt(kx * kx + ky * ky)
  if (kd > KICK_DIST + 2 || kd < 1e-9) return false
  if (mem.clear) return kx / kd * attackDir(p.team) > 0.3 // anything upfield will do
  const ax = mem.aimX - ball.x, ay = mem.aimY - ball.y
  const ad = Math.sqrt(ax * ax + ay * ay) || 1
  // Narrow angles need straighter kicks (sloppy bots still miss).
  const allowed = Math.min(bot.tolerance, goalWindow(ball.x, ball.y, attackDir(p.team)) / 2 + 0.04)
  return (kx * ax + ky * ay) / (kd * ad) >= Math.cos(allowed)
}

/** The angle (radians) the goal mouth spans seen from (x, y), for a team attacking in dir. */
function goalWindow(x, y, dir) {
  const lineX = dir > 0 ? W : 0
  const ax = lineX - x, ay = GOAL_TOP - y, bx = lineX - x, by = GOAL_BOTTOM - y
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by))
}

/**
 * The teammate who goes for the ball: the one with the shorter run (being
 * upfield of the ball costs a detour), switching only for a clear gain so the
 * two do not swap roles every tick. Shared per team, so two bots agree.
 */
function isAttacker(state, p) {
  const mate = state.players.find(q => q.team === p.team && q !== p)
  if (!mate) return true
  const ball = state.ball, dir = attackDir(p.team)
  const cost = q => dist(q.x, q.y, ball.x, ball.y) + ((q.x - ball.x) * dir > 0 ? 16 : 0)
  const current = state.attackers[p.team]
  let attacker = current === p.index ? p : current === mate.index ? mate : cost(p) <= cost(mate) ? p : mate
  const other = attacker === p ? mate : p
  if (cost(other) + 12 < cost(attacker)) attacker = other
  state.attackers[p.team] = attacker.index
  return attacker === p
}

/** Where the ball will be after t seconds of rolling, kept on the pitch. */
function predictBall(ball, t) {
  if (!(t > 0)) return [ball.x, ball.y]
  const f = (1 - Math.exp(-BALL_FRICTION * t)) / BALL_FRICTION
  return [clamp(ball.x + ball.vx * f, BR, W - BR), clamp(ball.y + ball.vy * f, BR, H - BR)]
}

function nearestOpponent(state, p, x, y) {
  let best = Infinity
  for (const q of state.players) if (q.team !== p.team) best = Math.min(best, dist(q.x, q.y, x, y))
  return best
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay
  const len2 = vx * vx + vy * vy
  const t = len2 > 0 ? clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1) : 0
  return dist(px, py, ax + vx * t, ay + vy * t)
}

// Aim points across the goal mouth (offsets from its middle); ±19 still clears the posts.
const AIM_OFFSETS = [0, -11, 11, -19, 19]

/** The most open aim point, or the defender to dribble round when every shot is blocked. */
function openAim(state, p, bx, by, goalX, dir) {
  let bestY = CY, bestScore = -Infinity, bestClear = Infinity, blocker = null
  for (const off of AIM_OFFSETS) {
    let clear = 40, nearest = null
    for (const q of state.players) {
      if (q.team === p.team) continue
      const d = segmentDistance(q.x, q.y, bx, by, goalX, CY + off)
      if (d < clear) { clear = d; nearest = q }
    }
    const score = Math.min(clear, 28) - Math.abs(off) * 0.15
    if (score > bestScore) { bestScore = score; bestY = CY + off; bestClear = clear; blocker = nearest }
  }
  // A keeper on the line is beaten by aiming wide; only go round field players.
  const goRound = bestClear < PR + BR + 3 && blocker && Math.abs(blocker.x - goalX) > 40 && (blocker.x - bx) * dir > 0
  return { y: bestY, blocker: goRound ? blocker : null }
}

/**
 * Attacker: get behind the ball on the line from the aim point through it,
 * circling round the ball rather than through it, then run through the ball
 * (a dribble) and shoot once in range and on target, or under pressure. The aim
 * is kept for a while (AIM_HOLD) so the bot commits instead of dithering.
 */
function planAttack(state, p, bot, mem) {
  const dir = attackDir(p.team)
  const ball = state.ball
  const [bx, by] = predictBall(ball, Math.min(bot.lead, dist(p.x, p.y, ball.x, ball.y) / 200))
  const goalX = dir > 0 ? W + 6 : -6
  const passed = !mem.shoot && (bx - mem.aimX) * dir > 0 // the defender we went round is behind us
  if (state.tick >= mem.aimUntil || passed) {
    const aim = openAim(state, p, bx, by, goalX, dir)
    mem.aimX = goalX
    mem.aimY = aim.y
    mem.shoot = true
    if (goalWindow(bx, by, dir) < CUT_BACK_ANGLE) { // too tight an angle: bring it in front of goal first
      mem.aimX = goalX - dir * 46
      mem.aimY = CY
      mem.shoot = false
    } else if (bot.smart && aim.blocker) {
      const q = aim.blocker
      let side = by < q.y ? -1 : by > q.y ? 1 : random(state) < 0.5 ? -1 : 1
      if (q.y + side * 30 < 12 || q.y + side * 30 > H - 12) side = -side
      mem.aimX = q.x + dir * 12
      mem.aimY = q.y + side * 30
      mem.shoot = false
    }
    mem.aimY += (random(state) * 2 - 1) * bot.aimNoise
    mem.aimUntil = state.tick + AIM_HOLD
  }
  let ux = mem.aimX - bx, uy = mem.aimY - by // from the ball towards the aim
  const ul = Math.sqrt(ux * ux + uy * uy) || 1
  ux /= ul
  uy /= ul
  const rx = p.x - bx, ry = p.y - by
  const offLine = Math.abs(Math.atan2(rx * uy - ry * ux, -(rx * ux + ry * uy))) // 0: right behind the ball
  if (offLine <= DRIBBLE_ANGLE && Math.sqrt(rx * rx + ry * ry) <= ORBIT + 6) {
    setTarget(mem, [bx + ux * 30, by + uy * 30], false)
    const pressed = nearestOpponent(state, p, ball.x, ball.y) < PR + BR + 14
    mem.kick = mem.shoot && (dist(bx, by, goalX, CY) <= bot.shootRange || pressed)
  } else {
    setTarget(mem, roundBall(p, bx, by, -ux, -uy, ORBIT), false)
  }
}

/**
 * Defender: with the ball in our half, keep goal on the line from the goal to
 * the ball (and clear a loose ball we reach first from the goal side); with the
 * ball in their half, wait between it and our goal.
 */
function planDefence(state, p, bot, mem) {
  const dir = attackDir(p.team)
  const ownX = dir > 0 ? 0 : W
  const ball = state.ball
  const [bx, by] = predictBall(ball, bot.lead)
  const gap = dist(p.x, p.y, ball.x, ball.y)
  const ownHalf = (bx - CX) * dir < 0
  mem.clear = true
  if (ownHalf && gap > 1e-9 && gap < 44 && (ball.x - p.x) * dir > PR && gap <= nearestOpponent(state, p, ball.x, ball.y) + 8) {
    setTarget(mem, [ball.x + (ball.x - p.x) / gap * 20, ball.y + (ball.y - p.y) / gap * 20], false)
  } else if (ownHalf) {
    const vx = bx - ownX, vy = by - CY
    const vd = Math.sqrt(vx * vx + vy * vy) || 1
    const depth = clamp(vd * 0.3, PR + 4, 26)
    setTarget(mem, [ownX + dir * Math.max(PR + 4, Math.abs(vx) / vd * depth), clamp(CY + vy / vd * depth, GOAL_TOP + 4, GOAL_BOTTOM - 4)], true)
  } else {
    setTarget(mem, [ownX + (bx - ownX) * 0.42, CY + (by - CY) * 0.4], true)
  }
}

// ---------------------------------------------------------------- snapshots

const SNAP_VERSION = 1
const FACINGS = 16
const round1 = v => Math.round(v * 10) / 10 || 0 // `|| 0` turns -0 into 0
const round0 = v => Math.round(v) || 0
const facingIndex = f => ((Math.round(f / (TAU / FACINGS)) % FACINGS) + FACINGS) % FACINGS
const facingAngle = i => (i * TAU / FACINGS > Math.PI ? i * TAU / FACINGS - TAU : i * TAU / FACINGS)

/** Compact snapshot for the network (layout in the header comment). */
export function encodeSnapshot(state) {
  const { ball, lastGoal } = state
  const scorer = lastGoal ? state.players.findIndex(p => p.id === lastGoal.scorer) : -1
  return [
    SNAP_VERSION,
    state.tick,
    PHASES.indexOf(state.phase),
    state.phaseTicks,
    state.clockTicks,
    [state.score.red, state.score.blue],
    TEAMS.indexOf(state.kickoffTeam),
    state.lastTouch,
    lastGoal ? [TEAMS.indexOf(lastGoal.team), scorer, lastGoal.own ? 1 : 0] : 0,
    [round1(ball.x), round1(ball.y), round0(ball.vx), round0(ball.vy)],
    state.players.map(p => [p.index, round1(p.x), round1(p.y), round0(p.vx), round0(p.vy), facingIndex(p.facing)]),
  ]
}

/** The tick a snapshot was taken on, or null if it is not a snapshot. */
export function snapshotTick(snap) {
  return Array.isArray(snap) && snap[0] === SNAP_VERSION && Number.isInteger(snap[1]) ? snap[1] : null
}

const isCount = v => Number.isInteger(v) && v >= 0
const isNumber = v => typeof v === 'number' && Number.isFinite(v)

function validSnapshot(state, snap) {
  if (!Array.isArray(snap) || snap.length !== 11 || snap[0] !== SNAP_VERSION) return false
  const [, tick, phase, phaseTicks, clockTicks, score, kickoff, lastTouch, goal, ball, players] = snap
  const n = state.players.length
  if (!isCount(tick) || !isCount(phase) || phase >= PHASES.length || !isCount(phaseTicks) || !isCount(clockTicks)) return false
  if (!Array.isArray(score) || score.length !== 2 || !isCount(score[0]) || !isCount(score[1])) return false
  if ((kickoff !== 0 && kickoff !== 1) || !Number.isInteger(lastTouch) || lastTouch < -1 || lastTouch >= n) return false
  if (goal !== 0 && !(Array.isArray(goal) && goal.length === 3 && (goal[0] === 0 || goal[0] === 1)
    && Number.isInteger(goal[1]) && goal[1] >= -1 && goal[1] < n && (goal[2] === 0 || goal[2] === 1))) return false
  if (!Array.isArray(ball) || ball.length !== 4 || !ball.every(isNumber)) return false
  if (!Array.isArray(players) || players.length !== n) return false
  const seen = new Set()
  for (const entry of players) {
    if (!Array.isArray(entry) || entry.length !== 6 || !entry.every(isNumber)) return false
    const [i, , , , , facing] = entry
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i) || !Number.isInteger(facing)) return false
    seen.add(i)
  }
  return true
}

/**
 * Apply a snapshot onto a state created (by createMatch) with the same players.
 * Returns the goal / phase / end events it implies compared with the state
 * before, or null (state untouched) if the snapshot is malformed or does not
 * fit. Bot memory and leftover time are reset, so a new host can carry on.
 */
export function decodeSnapshot(state, snap) {
  if (!state || !Array.isArray(state.players) || !validSnapshot(state, snap)) return null
  const [, tick, phaseCode, phaseTicks, clockTicks, [red, blue], kickoff, lastTouch, goal, ball, players] = snap
  const phase = PHASES[phaseCode]
  const lastGoal = goal ? {
    team: TEAMS[goal[0]],
    scorer: goal[1] >= 0 ? state.players[goal[1]].id : null,
    own: goal[2] === 1,
  } : null
  const events = []
  // One event per team that scored since the state's last update (a client that
  // missed snapshots hears one cheer, not several).
  for (const [team, now] of [['red', red], ['blue', blue]]) {
    if (now <= state.score[team]) continue
    const known = lastGoal && lastGoal.team === team
    events.push({ type: 'goal', team, scorer: known ? lastGoal.scorer : null, own: known ? lastGoal.own : false, tick })
  }
  if (phase !== state.phase) events.push({ type: 'phase', phase, tick })
  state.tick = tick
  state.phase = phase
  state.phaseTicks = phaseTicks
  state.clockTicks = clockTicks
  state.score = { red, blue }
  state.kickoffTeam = TEAMS[kickoff]
  state.lastTouch = lastTouch
  state.teamTouch = { red: { index: -1, tick: 0 }, blue: { index: -1, tick: 0 } }
  if (lastTouch >= 0) state.teamTouch[state.players[lastTouch].team] = { index: lastTouch, tick }
  state.lastGoal = lastGoal
  state.acc = 0
  state.attackers = { red: -1, blue: -1 }
  const b = state.ball
  b.x = ball[0]
  b.y = ball[1]
  b.vx = ball[2]
  b.vy = ball[3]
  for (const [i, x, y, vx, vy, facing] of players) {
    const p = state.players[i]
    p.x = x
    p.y = y
    p.vx = vx
    p.vy = vy
    p.facing = facingAngle(((facing % FACINGS) + FACINGS) % FACINGS)
    p.cooldown = 0
    p.kickWindow = 0
    p.mem = null
  }
  if (phase === 'ended' && events.some(e => e.type === 'phase')) events.push({ type: 'end', winner: winnerOf(state), tick })
  return events
}

/**
 * Apply `from` with ball and player positions blended towards `to` by alpha
 * (0..1): render clients a little in the past, between the two snapshots
 * around the render tick. A kickoff reset, or a jump no ball could make in the
 * time between them, is not blended (nobody slides across the pitch). Returns
 * what decodeSnapshot(state, from) returns.
 */
export function interpolateSnapshot(state, from, to, alpha) {
  const events = decodeSnapshot(state, from)
  if (events === null || !to || to === from || !validSnapshot(state, to)) return events
  const t = alpha > 0 ? Math.min(alpha, 1) : 0
  const gap = to[1] - from[1]
  if (t === 0 || gap <= 0 || (to[2] === 0 && from[2] !== 0)) return events
  const reach = gap / TICK_RATE * BALL_MAX + 8
  const blend = (body, x, y, vx, vy) => {
    if (Math.abs(x - body.x) > reach || Math.abs(y - body.y) > reach) return
    body.x += (x - body.x) * t
    body.y += (y - body.y) * t
    body.vx += (vx - body.vx) * t
    body.vy += (vy - body.vy) * t
  }
  blend(state.ball, ...to[9])
  for (const [i, x, y, vx, vy] of to[10]) blend(state.players[i], x, y, vx, vy)
  return events
}
