// Tests for the football engine games/football.js (node --test, no packages).
//
//   node --test tests/football.test.mjs
//
// Every match is seeded, so each run plays the same games. Ball tests park the
// players beyond the lines in the corners, where they cannot reach the ball.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIELD, TUNING, createMatch, stepMatch, chooseFootballInput, encodeSnapshot, decodeSnapshot,
  interpolateSnapshot, snapshotTick, matchSummary,
} from '../games/football.js'

const DT = 1 / 60
const { w: W, h: H, goalTop: GOAL_TOP, goalBottom: GOAL_BOTTOM, goalDepth: GOAL_DEPTH, ballRadius: BR, playerRadius: PR } = FIELD
const KICK_DIST = PR + BR + TUNING.kickReach
const KICKER_X = W / 2 - (PR + BR + 2) // where red's kick-off taker stands

const ONE_V_ONE = [{ id: 'r', team: 'red' }, { id: 'b', team: 'blue' }]
const TWO_V_TWO = [{ id: 'r1', team: 'red' }, { id: 'r2', team: 'red' }, { id: 'b1', team: 'blue' }, { id: 'b2', team: 'blue' }]

/** Seeded PRNG (mulberry32): floats in [0, 1). */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Step `seconds` one tick at a time with the same inputs; returns every event. */
function run(state, seconds, inputs = {}) {
  const events = []
  for (let i = Math.round(seconds * 60); i > 0; i--) events.push(...stepMatch(state, inputs, DT))
  return events
}

const types = events => events.map(e => e.type)
const player = (state, id) => state.players.find(p => p.id === id)
const speedOf = body => Math.hypot(body.vx, body.vy)

function setBall(state, x, y, vx = 0, vy = 0) {
  Object.assign(state.ball, { x, y, vx, vy })
}

function park(state) {
  state.players.forEach((p, i) => Object.assign(p, { x: i % 2 ? W + 10 : -10, y: i < 2 ? -10 : H + 10, vx: 0, vy: 0 }))
}

/** A match past its kick-off freeze with every player parked out of the way. */
function openPlay(players = ONE_V_ONE, options = {}) {
  const state = createMatch({ players, ...options })
  run(state, TUNING.kickoffSeconds)
  assert.equal(state.phase, 'play')
  park(state)
  return state
}

/** Play a whole match; returns the final state. */
function playOut(players, seed, duration) {
  const state = createMatch({ players, seed, duration })
  while (state.phase !== 'ended') stepMatch(state, {}, 0.25)
  return state
}

// ------------------------------------------------------------------ set-up

test('createMatch: rejects bad input with a TypeError', () => {
  const bad = [
    undefined,
    {},
    { players: 'r,b' },
    { players: [{ id: 'a', team: 'red' }] }, // no blue player
    { players: [{ id: 'a', team: 'red' }, { id: 'b', team: 'green' }] },
    { players: [{ id: 'a', team: 'red' }, { id: 'a', team: 'blue' }] },
    { players: [{ id: 'a', team: 'red' }, { id: 'b', team: 'red' }, { id: 'c', team: 'red' }, { id: 'd', team: 'blue' }] },
    { players: [{ id: '', team: 'red' }, { id: 'b', team: 'blue' }] },
    { players: [{ team: 'red' }, { id: 'b', team: 'blue' }] },
    { players: [null, { id: 'b', team: 'blue' }] },
    { players: [{ id: 'a', team: 'red', bot: 'godlike' }, { id: 'b', team: 'blue' }] },
    { players: [{ id: 'a', team: 'red', name: 7 }, { id: 'b', team: 'blue' }] },
    { players: ONE_V_ONE, duration: 0 },
    { players: ONE_V_ONE, duration: Infinity },
    { players: ONE_V_ONE, seed: 'lucky' },
  ]
  for (const options of bad) assert.throws(() => createMatch(options), TypeError, JSON.stringify(options))
})

test('createMatch: players, bots and a plain-data state', () => {
  const state = createMatch({ players: [{ id: 'a', team: 'red', bot: true, name: 'Ann' }, { id: 'b', team: 'blue', bot: 'hard' }, { id: 'c', team: 'blue' }] })
  assert.deepEqual(state.players.map(p => [p.id, p.team, p.name, p.bot]), [['a', 'red', 'Ann', 'medium'], ['b', 'blue', 'b', 'hard'], ['c', 'blue', 'c', null]])
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state)
  assert.deepEqual(matchSummary(createMatch({ players: ONE_V_ONE })), {
    phase: 'kickoff', score: { red: 0, blue: 0 }, clockLeft: 180, phaseLeft: 1.5, winner: null, lastGoal: null,
  })
  assert.equal(matchSummary(createMatch({ players: ONE_V_ONE, duration: 90 })).clockLeft, 90)
})

test('kickoff: formation, ball on the centre spot, the kicker just behind it, a 1.5 s freeze', () => {
  const state = createMatch({ players: TWO_V_TWO })
  const at = id => [player(state, id).x, player(state, id).y]
  assert.equal(state.phase, 'kickoff')
  assert.equal(state.kickoffTeam, 'red')
  assert.deepEqual(at('r1'), [KICKER_X, 96]) // nearest red player (a tie, so the first) takes the kick
  assert.deepEqual(at('r2'), [88, 128])
  assert.deepEqual(at('b1'), [264, 64])
  assert.deepEqual(at('b2'), [264, 128])
  assert.deepEqual(state.ball, { x: 176, y: 96, vx: 0, vy: 0 })
  assert.deepEqual(state.players.map(p => p.facing), [0, 0, Math.PI, Math.PI]) // facing the goal they attack

  // Everyone runs and kicks during the freeze: nothing moves, nothing happens.
  const pushing = { r1: { mx: 1, my: 0, kick: true }, r2: { mx: 1, my: -1, kick: true }, b1: { mx: -1, my: 0, kick: true }, b2: { mx: -1, my: 1 } }
  const frozen = JSON.stringify(encodeSnapshot(state).slice(9))
  assert.deepEqual(run(state, 1.5 - DT, pushing), [])
  assert.equal(JSON.stringify(encodeSnapshot(state).slice(9)), frozen)
  assert.equal(state.phase, 'kickoff')
  assert.ok(Math.abs(matchSummary(state).phaseLeft - DT) < 1e-9)
  const start = run(state, DT, pushing)
  assert.deepEqual(start, [{ type: 'phase', phase: 'play', tick: 90 }])
  assert.deepEqual(run(state, DT, pushing), [{ type: 'kick', id: 'r1', tick: 91 }]) // the kicker is in reach at once

  const single = createMatch({ players: ONE_V_ONE })
  assert.deepEqual([player(single, 'r').x, player(single, 'r').y, player(single, 'b').x, player(single, 'b').y], [KICKER_X, 96, 264, 96])
})

// ------------------------------------------------------------------ stepping

test('stepping: the same match however the caller slices time', () => {
  const players = [{ id: 'h1', team: 'red' }, { id: 'bot1', team: 'red', bot: 'hard' }, { id: 'h2', team: 'blue' }, { id: 'bot2', team: 'blue', bot: 'easy' }]
  const random = seeded(5)
  const script = [] // the humans hold a new stick position every half second
  for (let i = 0; i < 40; i++) {
    script.push({
      h1: { mx: random() * 2 - 1, my: random() * 2 - 1, kick: random() < 0.4 },
      h2: { mx: random() * 2 - 1, my: random() * 2 - 1, kick: random() < 0.4 },
    })
  }
  const SEGMENT = 30000 // half a second in 1/60000 s
  const slicings = {
    ticks: () => Array(30).fill(1000),
    tenths: () => Array(5).fill(6000),
    quarters: () => [SEGMENT / 2, SEGMENT / 2], // the most one call may advance
    ragged: rand => {
      const parts = []
      for (let left = SEGMENT; left > 0;) {
        const part = Math.min(left, 1 + Math.floor(rand() * 2500))
        parts.push(part)
        left -= part
      }
      return parts
    },
  }
  const results = {}
  for (const [name, slice] of Object.entries(slicings)) {
    const rand = seeded(77)
    const state = createMatch({ players, seed: 3, duration: 60 })
    const snapshots = [], events = []
    for (const inputs of script) {
      for (const units of slice(rand)) events.push(...stepMatch(state, inputs, units / 60000))
      snapshots.push(encodeSnapshot(state))
    }
    results[name] = { snapshots, events, state: JSON.stringify(state) }
  }
  assert.ok(results.ticks.events.some(e => e.type === 'kick'), 'the script should produce some play')
  for (const name of ['tenths', 'quarters', 'ragged']) {
    assert.deepEqual(results[name].snapshots, results.ticks.snapshots, name)
    assert.deepEqual(results[name].events, results.ticks.events, name)
    assert.equal(results[name].state, results.ticks.state, name)
  }
  // The same seed replays the same match; a different seed plays a different one.
  const a = playOut(TWO_V_TWO.map(p => ({ ...p, bot: 'medium' })), 11, 20)
  const b = playOut(TWO_V_TWO.map(p => ({ ...p, bot: 'medium' })), 11, 20)
  const c = playOut(TWO_V_TWO.map(p => ({ ...p, bot: 'medium' })), 12, 20)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  assert.notEqual(JSON.stringify(a), JSON.stringify(c))
})

test('stepping: leftover time carries over, a long stall is capped, junk is tolerated', () => {
  const state = createMatch({ players: [{ id: 'constructor', team: 'red' }, { id: 'b', team: 'blue' }] })
  assert.deepEqual(stepMatch(state, {}, DT / 2), [])
  assert.equal(state.tick, 0)
  stepMatch(state, {}, DT / 2)
  assert.equal(state.tick, 1)
  stepMatch(state, {}, 10) // a tab that slept: at most a quarter of a second
  assert.equal(state.tick, 16)
  for (const [inputs, dt] of [[null, DT], [{ constructor: 'run' }, DT], [{ b: { mx: 'left', my: Infinity, kick: 1 } }, DT], [{}, NaN], [{}, -1], [[], DT]]) {
    stepMatch(state, inputs, dt)
  }
  run(state, 2, { constructor: { mx: NaN, my: 0.5 }, b: { mx: 9, my: 9 } })
  for (const p of state.players) assert.ok([p.x, p.y, p.vx, p.vy, p.facing].every(Number.isFinite))
  assert.ok(speedOf(player(state, 'b')) <= TUNING.playerSpeed + 1e-9)
})

// ------------------------------------------------------------------ ball

test('ball: friction slows a rolling ball smoothly to a stop', () => {
  const state = openPlay()
  setBall(state, 100, 40, 100, 0)
  let ticks = 0, last = 100
  while (state.ball.vx > 0) {
    stepMatch(state, {}, DT)
    ticks++
    assert.ok(state.ball.vx < last)
    last = state.ball.vx
    if (ticks === 60) assert.ok(Math.abs(state.ball.vx - 100 * Math.exp(-TUNING.ballFriction)) < 1e-6)
  }
  assert.equal(state.ball.vy, 0)
  assert.ok(ticks > 3.4 * 60 && ticks < 3.8 * 60, `stopped after ${ticks} ticks`)
  const rolled = state.ball.x - 100
  assert.ok(Math.abs(rolled - (100 - TUNING.ballStopSpeed) / TUNING.ballFriction) < 2, `rolled ${rolled} px`)
  const stopped = state.ball.x
  run(state, 1)
  assert.equal(state.ball.x, stopped)
  assert.equal(speedOf(state.ball), 0)
})

test('ball: bounces off the touchlines and end lines and only leaves the pitch through a goal mouth', () => {
  let state = openPlay()
  setBall(state, 100, 30, 0, -200)
  let events = run(state, 0.3)
  assert.ok(state.ball.vy > 0, 'came back off the top touchline')
  assert.ok(state.ball.vy < 200 * TUNING.wallRestitution)
  assert.deepEqual(types(events), ['bounce'])

  state = openPlay()
  setBall(state, 40, 40, -200, 0) // at the end line beside the goal
  events = run(state, 0.5)
  assert.ok(state.ball.vx > 0)
  assert.deepEqual(types(events), ['bounce'])

  const random = seeded(3)
  let goals = 0
  for (let shot = 0; shot < 300; shot++) {
    state = openPlay()
    const angle = random() * Math.PI * 2, speed = 60 + random() * 220
    setBall(state, 10 + random() * (W - 20), 10 + random() * (H - 20), Math.cos(angle) * speed, Math.sin(angle) * speed)
    for (let i = 0; i < 240 && state.phase === 'play'; i++) {
      const tick = stepMatch(state, {}, DT)
      const { x, y } = state.ball
      const onPitch = x >= BR - 1e-9 && x <= W - BR + 1e-9 && y >= BR - 1e-9 && y <= H - BR + 1e-9
      const inMouth = y > GOAL_TOP && y < GOAL_BOTTOM && x >= BR - GOAL_DEPTH - 1e-9 && x <= W + GOAL_DEPTH - BR + 1e-9
      const inNet = (x < 0 || x > W) && y >= GOAL_TOP + BR - 1e-9 && y <= GOAL_BOTTOM - BR + 1e-9
      assert.ok(onPitch || (inMouth && (inNet || (x >= 0 && x <= W))), `shot ${shot}: ball at ${x}, ${y}`)
      for (const [px, py] of FIELD.posts) assert.ok(Math.hypot(x - px, y - py) >= FIELD.postRadius + BR - 1e-6, `shot ${shot} is inside a post`)
      if (tick.some(e => e.type === 'goal')) {
        goals++
        assert.ok(x < -BR || x > W + BR)
      }
    }
  }
  assert.ok(goals > 5, `${goals} goals from 300 random shots`)
})

test('goals: only when the whole ball is over the line between the posts', () => {
  let state = openPlay()
  setBall(state, -BR + 0.5, 96) // nearly all of the ball is over the line
  assert.deepEqual(run(state, 0.5), [])
  assert.deepEqual(state.score, { red: 0, blue: 0 })
  setBall(state, -BR - 0.1, 96) // now all of it
  assert.deepEqual(stepMatch(state, {}, DT), [
    { type: 'goal', team: 'blue', scorer: null, own: false, tick: state.tick },
    { type: 'phase', phase: 'goal', tick: state.tick },
  ])
  assert.deepEqual(state.score, { red: 0, blue: 1 })

  state = openPlay()
  setBall(state, W + BR + 0.1, 100)
  assert.equal(stepMatch(state, {}, DT)[0].team, 'red')

  // A slow ball that stops on the line is no goal; a slightly faster one is.
  state = openPlay()
  setBall(state, 10, 96, -13, 0)
  assert.deepEqual(run(state, 4), [])
  assert.equal(state.ball.vx, 0)
  assert.ok(state.ball.x > -BR && state.ball.x < BR, `stopped at ${state.ball.x}`)
  state = openPlay()
  setBall(state, 10, 96, -40, 0)
  assert.ok(types(run(state, 2)).includes('goal'))
  assert.ok(state.ball.x >= BR - GOAL_DEPTH, 'the net holds the ball')
})

test('posts: the ball bounces off a post; a shot off the inside of a post goes in', () => {
  let state = openPlay()
  setBall(state, 40, GOAL_TOP, -150, 0) // straight at the upper left post
  let events = run(state, 0.6)
  assert.deepEqual(types(events), ['post'])
  assert.ok(state.ball.vx > 0)
  assert.equal(state.phase, 'play')

  state = openPlay()
  setBall(state, 40, GOAL_TOP + 5, -150, 0) // glances off the inside of the post
  events = run(state, 1)
  assert.deepEqual(types(events), ['post', 'goal', 'phase'])
  assert.equal(state.score.blue, 1)
})

test('events: wall bounces are rate-limited', () => {
  const state = openPlay()
  setBall(state, 5, 12, -100, -150) // into the top left corner: the end line, then the touchline 2 ticks later
  const events = run(state, 0.15)
  assert.ok(state.ball.vx > 0 && state.ball.vy > 0, 'it hit both walls')
  assert.deepEqual(types(events), ['bounce'])
})

// ------------------------------------------------------------------ players and kicks

test('players: analog stick up to top speed (diagonals no faster), smooth starts and stops, kept out of the goals', () => {
  const state = openPlay()
  const p = player(state, 'r')
  setBall(state, 300, 20)
  Object.assign(p, { x: 60, y: 150 })
  run(state, DT, { r: { mx: 1, my: 0 } })
  assert.ok(Math.abs(p.vx - TUNING.playerAccel * DT) < 1e-9, 'accelerates, does not jump to top speed')
  run(state, 0.3, { r: { mx: 1, my: 0 } })
  assert.equal(p.vx, TUNING.playerSpeed)
  run(state, 0.4, { r: { mx: -1, my: -1 } })
  assert.ok(Math.abs(speedOf(p) - TUNING.playerSpeed) < 1e-9)
  run(state, 0.3, { r: { mx: 0.5, my: 0 } })
  assert.ok(Math.abs(p.vx - TUNING.playerSpeed / 2) < 1e-9 && Math.abs(p.vy) < 1e-9)
  run(state, 0.05, {})
  assert.ok(speedOf(p) > 0, 'slows down smoothly')
  run(state, 0.2, {})
  assert.equal(speedOf(p), 0)
  assert.ok(Math.abs(p.facing) < 1e-9, 'faces the way it last ran')

  Object.assign(p, { x: 40, y: 96 }) // run into the left goal mouth: stopped on the line
  run(state, 1.5, { r: { mx: -1, my: 0 } })
  assert.equal(p.x, PR)
  Object.assign(p, { x: 40, y: 40 }) // off the pitch beside the goal: only up to the margin
  run(state, 1.5, { r: { mx: -1, my: -1 } })
  assert.deepEqual([p.x, p.y], [-FIELD.margin, -FIELD.margin])
  run(state, 2, { r: { mx: 0, my: 1 } }) // down the back of the goal: the net stops it
  assert.equal(p.x, -FIELD.margin)
  assert.equal(p.y, GOAL_TOP - PR)
})

test('kicks: reach, power away from the kicker, cooldown, and a short press window', () => {
  const state = openPlay()
  const kicker = player(state, 'r')
  const place = (dx, dy, vx = 0, vy = 0) => {
    Object.assign(kicker, { x: 100, y: 96, vx: 0, vy: 0 })
    setBall(state, 100 + dx, 96 + dy, vx, vy)
  }
  const hold = { r: { mx: 0, my: 0, kick: true } }

  place(KICK_DIST + 0.1, 0) // just out of reach
  assert.deepEqual(run(state, 0.3, hold), [])
  assert.equal(speedOf(state.ball), 0)

  place(10, 10) // in reach, diagonally
  const events = stepMatch(state, hold, DT)
  assert.deepEqual(events, [{ type: 'kick', id: 'r', tick: state.tick }])
  const decay = Math.exp(-TUNING.ballFriction * DT)
  assert.ok(Math.abs(state.ball.vx - TUNING.kickPower * Math.SQRT1_2 * decay) < 1e-9)
  assert.ok(Math.abs(state.ball.vy - TUNING.kickPower * Math.SQRT1_2 * decay) < 1e-9)
  assert.ok(Math.abs(kicker.facing - Math.PI / 4) < 1e-9)

  // Holding kick with the ball always in reach: one kick per cooldown.
  const kicks = []
  for (let i = 1; i <= 30; i++) {
    place(KICK_DIST - 0.5, 0)
    if (stepMatch(state, hold, DT).length) kicks.push(i)
  }
  assert.deepEqual(kicks, [15, 30]) // every 0.25 s

  // A tap just before the ball arrives still kicks; one too early does not.
  run(state, 0.5)
  place(KICK_DIST + 6, 0, -90, 0)
  let tap = stepMatch(state, hold, DT)
  tap = tap.concat(run(state, 0.2))
  assert.deepEqual(types(tap), ['kick'])
  assert.ok(state.ball.vx > 0)
  run(state, 0.5)
  place(KICK_DIST + 30, 0, -90, 0)
  tap = stepMatch(state, hold, DT).concat(run(state, 0.6))
  assert.ok(!types(tap).includes('kick'))
})

test('dribbling: running into the ball pushes it ahead, the touch counts as possession', () => {
  const state = openPlay()
  const p = player(state, 'r')
  Object.assign(p, { x: 60, y: 96 })
  setBall(state, 80, 96)
  run(state, 2, { r: { mx: 1, my: 0 } })
  assert.ok(state.ball.x > 150, `ball at ${state.ball.x}`)
  assert.ok(state.ball.x - p.x < 30, 'the ball stays near the dribbler')
  assert.equal(state.lastTouch, p.index)
})

// ------------------------------------------------------------------ match flow

test('goal: the score changes at once, play runs on for 2.5 s without goals or clock, then the conceding team kicks off', () => {
  const state = openPlay(TWO_V_TWO, { duration: 60 })
  const b1 = player(state, 'b1'), r2 = player(state, 'r2')
  Object.assign(b1, { x: 30, y: 96 })
  Object.assign(r2, { x: 150, y: 150 }) // the red player nearest the centre spot when play restarts
  setBall(state, 20, 96)
  const events = run(state, 0.5, { b1: { mx: 0, my: 0, kick: true } })
  const goal = events.find(e => e.type === 'goal')
  assert.deepEqual(goal, { type: 'goal', team: 'blue', scorer: 'b1', own: false, tick: goal.tick })
  assert.deepEqual(state.score, { red: 0, blue: 1 })
  assert.equal(state.phase, 'goal')
  assert.deepEqual(matchSummary(state).lastGoal, { team: 'blue', scorer: 'b1', own: false })

  const clock = matchSummary(state).clockLeft
  setBall(state, W + BR + 2, 96) // a ball in the other net during the celebration does not count
  const b2 = player(state, 'b2'), from = b2.x
  const after = run(state, 2.5, { b2: { mx: -1, my: 0 } })
  assert.ok(b2.x < from - 50, 'players keep running during the celebration')
  assert.equal(matchSummary(state).clockLeft, clock)
  assert.deepEqual(state.score, { red: 0, blue: 1 })
  assert.deepEqual(after.filter(e => e.type === 'phase'), [{ type: 'phase', phase: 'kickoff', tick: goal.tick + 150 }])
  assert.equal(state.kickoffTeam, 'red')
  assert.deepEqual([r2.x, r2.y], [KICKER_X, 96])
  assert.deepEqual([player(state, 'r1').x, player(state, 'r1').y], [88, 64])
  assert.deepEqual(state.ball, { x: 176, y: 96, vx: 0, vy: 0 })
})

test('goals: own goals, and deflected shots belong to the shooter', () => {
  let state = openPlay(TWO_V_TWO)
  Object.assign(player(state, 'r1'), { x: 30, y: 96 })
  setBall(state, 20, 96)
  let goal = run(state, 0.5, { r1: { kick: true } }).find(e => e.type === 'goal')
  assert.deepEqual([goal.team, goal.scorer, goal.own], ['blue', 'r1', true])

  // b1 shoots; r1 gets a touch on it on the way in.
  state = openPlay(TWO_V_TWO)
  Object.assign(player(state, 'b1'), { x: 60, y: 96 })
  Object.assign(player(state, 'r1'), { x: 16, y: 104 })
  setBall(state, 50, 96)
  const events = run(state, 1, { b1: { kick: true } })
  goal = events.find(e => e.type === 'goal')
  assert.equal(state.lastTouch, player(state, 'r1').index, 'r1 touched it last')
  assert.deepEqual([goal.team, goal.scorer, goal.own], ['blue', 'b1', false])
})

test('clock: runs only during play; full time ends the match with the right winner', () => {
  let state = createMatch({ players: ONE_V_ONE, duration: 3 })
  run(state, 1.5)
  assert.equal(matchSummary(state).clockLeft, 3)
  assert.deepEqual(run(state, 3 - DT), [])
  assert.ok(Math.abs(matchSummary(state).clockLeft - DT) < 1e-9)
  assert.deepEqual(types(run(state, DT)), ['phase', 'end'])
  assert.deepEqual(matchSummary(state), { phase: 'ended', score: { red: 0, blue: 0 }, clockLeft: 0, phaseLeft: 0, winner: 'draw', lastGoal: null })
  const frozen = JSON.stringify(state)
  assert.deepEqual(stepMatch(state, { r: { mx: 1, my: 0, kick: true } }, 0.25), [])
  assert.equal(JSON.stringify(state), frozen)

  // A goal after one second: the clock waits through the celebration and the next kick-off.
  state = createMatch({ players: ONE_V_ONE, duration: 3 })
  run(state, 2.5)
  setBall(state, W + BR + 1, 96)
  assert.equal(stepMatch(state, {}, DT)[0].team, 'red')
  const clock = matchSummary(state).clockLeft
  assert.ok(Math.abs(clock - (2 - DT)) < 1e-9)
  run(state, 2.5 + 1.5)
  assert.equal(matchSummary(state).clockLeft, clock)
  const end = run(state, clock + 1)
  assert.deepEqual(end.find(e => e.type === 'end'), { type: 'end', winner: 'red', tick: 90 + 60 + 150 + 90 + 120 })

  // A goal on the very last tick counts; the whistle comes after the celebration.
  state = createMatch({ players: ONE_V_ONE, duration: 1 })
  run(state, 1.5 + 1 - DT)
  setBall(state, -BR - 1, 96)
  assert.deepEqual(types(stepMatch(state, {}, DT)), ['goal', 'phase'])
  assert.equal(matchSummary(state).clockLeft, 0)
  const whistle = run(state, 2.5)
  assert.deepEqual(types(whistle), ['phase', 'end'])
  assert.equal(whistle[1].winner, 'blue')
})

// ------------------------------------------------------------------ bots

test('bots: well-formed input; idle when frozen or unknown', () => {
  const state = createMatch({ players: [{ id: 'a', team: 'red', bot: 'hard' }, { id: 'b', team: 'blue', bot: 'easy' }] })
  const idle = { mx: 0, my: 0, kick: false }
  assert.deepEqual(chooseFootballInput(state, 'a'), idle) // kick-off freeze
  assert.deepEqual(chooseFootballInput(state, 'nobody'), idle)
  assert.deepEqual(chooseFootballInput(null, 'a'), idle)
  run(state, 1.5)
  let kicks = 0
  for (let i = 0; i < 1200; i++) {
    const inputs = {}
    for (const id of ['a', 'b']) {
      const input = chooseFootballInput(state, id)
      assert.deepEqual(Object.keys(input).sort(), ['kick', 'mx', 'my'])
      assert.ok(Number.isFinite(input.mx) && Number.isFinite(input.my) && Math.hypot(input.mx, input.my) <= 1 + 1e-9)
      assert.equal(typeof input.kick, 'boolean')
      if (input.kick) kicks++
      inputs[id] = input
    }
    stepMatch(state, inputs, DT)
  }
  assert.ok(kicks > 0)
})

test('bots: a bot alone scores against an idle opponent', () => {
  for (const [level, limit] of [['hard', 30], ['medium', 30], ['easy', 60]]) {
    for (const team of ['red', 'blue']) {
      for (let seed = 1; seed <= 3; seed++) {
        const state = createMatch({ players: [{ id: 'bot', team, bot: level }, { id: 'idle', team: team === 'red' ? 'blue' : 'red' }], seed, duration: 120 })
        let goal = null
        for (let i = 0; i < limit * 60 && !goal; i++) goal = stepMatch(state, {}, DT).find(e => e.type === 'goal')
        assert.ok(goal, `${level} ${team} seed ${seed}: no goal in ${limit} s`)
        assert.deepEqual([goal.team, goal.scorer], [team, 'bot'])
      }
    }
  }
})

test('bots: hard beats easy over several seeded matches (1v1 and 2v2)', () => {
  let hardGoals = 0, easyGoals = 0, hardWins = 0, easyWins = 0
  for (let game = 0; game < 8; game++) {
    const hardTeam = game % 2 === 0 ? 'red' : 'blue'
    const roster = game < 4 ? TWO_V_TWO : ONE_V_ONE
    const players = roster.map(p => ({ ...p, bot: p.team === hardTeam ? 'hard' : 'easy' }))
    const { score } = playOut(players, 21 + game, 45)
    const hard = score[hardTeam], easy = score[hardTeam === 'red' ? 'blue' : 'red']
    hardGoals += hard
    easyGoals += easy
    if (hard > easy) hardWins++
    else if (easy > hard) easyWins++
  }
  assert.ok(hardWins >= 6 && hardWins > easyWins, `hard won ${hardWins}, easy ${easyWins} of 8`)
  assert.ok(hardGoals > 2 * easyGoals, `goals: hard ${hardGoals}, easy ${easyGoals}`)
})

test('bots: medium sits between easy and hard', () => {
  const tally = (strong, weak) => {
    let a = 0, b = 0
    for (let game = 0; game < 4; game++) {
      const team = game % 2 === 0 ? 'red' : 'blue'
      const { score } = playOut(ONE_V_ONE.map(p => ({ ...p, bot: p.team === team ? strong : weak })), 31 + game, 40)
      a += score[team]
      b += score[team === 'red' ? 'blue' : 'red']
    }
    return [a, b]
  }
  const [medium, easy] = tally('medium', 'easy')
  assert.ok(medium > easy, `medium ${medium} vs easy ${easy}`)
  const [hard, medium2] = tally('hard', 'medium')
  assert.ok(hard > medium2, `hard ${hard} vs medium ${medium2}`)
})

// ------------------------------------------------------------------ snapshots

const BOTS_2V2 = TWO_V_TWO.map((p, i) => ({ ...p, bot: ['hard', 'medium', 'easy', 'hard'][i] }))

test('snapshots: small, exact round trip, malformed ones refused', () => {
  const host = createMatch({ players: BOTS_2V2, seed: 9 })
  let sawGoal = false
  for (let i = 0; i < 40 * 60 && !(sawGoal && host.phase === 'play'); i++) sawGoal = stepMatch(host, {}, DT).some(e => e.type === 'goal') || sawGoal
  assert.ok(sawGoal && host.phase === 'play', 'a match with a goal behind it')
  const snap = encodeSnapshot(host)
  const json = JSON.stringify(snap)
  assert.ok(json.length < 400, `${json.length} bytes: ${json}`)
  assert.equal(snapshotTick(snap), host.tick)
  assert.equal(snapshotTick(JSON.parse(json)), host.tick)
  assert.equal(snapshotTick({ tick: 3 }), null)

  // A fresh client takes the snapshot exactly, and hears what it missed.
  const client = createMatch({ players: BOTS_2V2, seed: 9 })
  const events = decodeSnapshot(client, JSON.parse(json))
  assert.deepEqual(encodeSnapshot(client), snap)
  assert.deepEqual(matchSummary(client), matchSummary(host))
  const goals = events.filter(e => e.type === 'goal')
  assert.deepEqual(goals.map(e => e.team), ['red', 'blue'].filter(team => host.score[team] > 0))
  assert.equal(goals.find(e => e.team === host.lastGoal.team).scorer, host.lastGoal.scorer)
  assert.deepEqual(events.filter(e => e.type === 'phase'), [{ type: 'phase', phase: 'play', tick: host.tick }])
  assert.deepEqual(decodeSnapshot(client, snap), [], 'nothing new the second time')

  // The worst case still fits: far-off positions, top speeds, long matches.
  const big = createMatch({ players: BOTS_2V2, duration: 3600 })
  big.tick = 999999
  big.score = { red: 99, blue: 99 }
  big.lastGoal = { team: 'blue', scorer: 'b2', own: true }
  big.lastTouch = 3
  setBall(big, -10.55, 120.55, -279.6, 279.6)
  big.players.forEach(p => Object.assign(p, { x: -9.95, y: 201.95, vx: -71.6, vy: -71.6, facing: -2.3 }))
  const bigJson = JSON.stringify(encodeSnapshot(big))
  assert.ok(bigJson.length < 400, `${bigJson.length} bytes: ${bigJson}`)

  const before = JSON.stringify(client)
  const broken = [
    null, 42, {}, [], snap.slice(0, 10), [2, ...snap.slice(1)],
    [...snap.slice(0, 10), snap[10].slice(1)], // a player missing
    [...snap.slice(0, 9), [NaN, 1, 2, 3], snap[10]],
    [...snap.slice(0, 7), 9, ...snap.slice(8)], // the last toucher is not a player
    [...snap.slice(0, 2), 7, ...snap.slice(3)], // unknown phase
    [...snap.slice(0, 10), [snap[10][0], snap[10][0], snap[10][2], snap[10][3]]], // the same player twice
  ]
  for (const bad of broken) assert.equal(decodeSnapshot(client, bad), null, JSON.stringify(bad))
  assert.equal(JSON.stringify(client), before)
  assert.equal(decodeSnapshot(createMatch({ players: ONE_V_ONE }), snap), null, 'a snapshot of another match')
})

test('snapshots: a new host carries on from the last snapshot', () => {
  // Physics only: the continuation matches the old host's to well under a pixel.
  const host = openPlay(ONE_V_ONE)
  Object.assign(player(host, 'r'), { x: 120.04, y: 60, vx: 30.3, vy: 0 })
  setBall(host, 140.02, 90, 160.3, -70.2)
  const snap = encodeSnapshot(host)
  const heir = createMatch({ players: ONE_V_ONE })
  decodeSnapshot(heir, snap)
  run(host, 1.5, { r: { mx: 1, my: 0.5 } })
  run(heir, 1.5, { r: { mx: 1, my: 0.5 } })
  assert.equal(heir.tick, host.tick)
  assert.ok(Math.hypot(heir.ball.x - host.ball.x, heir.ball.y - host.ball.y) < 0.5)
  assert.ok(Math.hypot(player(heir, 'r').x - player(host, 'r').x, player(heir, 'r').y - player(host, 'r').y) < 0.5)

  // With bots: the match simply goes on to its end from wherever the snapshot was.
  const botHost = createMatch({ players: BOTS_2V2, seed: 4, duration: 30 })
  run(botHost, 12)
  const botHeir = createMatch({ players: BOTS_2V2, seed: 4, duration: 30 })
  decodeSnapshot(botHeir, JSON.parse(JSON.stringify(encodeSnapshot(botHost))))
  const clock = matchSummary(botHeir).clockLeft
  assert.ok(clock > 0 && clock < 30)
  const events = []
  while (botHeir.phase !== 'ended') events.push(...stepMatch(botHeir, {}, 0.25))
  assert.ok(events.some(e => e.type === 'end'))
  assert.ok(botHeir.tick >= botHost.tick + clock * 60)
})

test('interpolation: positions blend between two snapshots, never across a kick-off reset', () => {
  const host = createMatch({ players: BOTS_2V2, seed: 2 })
  run(host, 4)
  const a = encodeSnapshot(host)
  run(host, 4 * DT)
  const b = encodeSnapshot(host)
  assert.ok(Math.hypot(b[9][0] - a[9][0], b[9][1] - a[9][1]) > 0.5, 'the ball moved between them')
  const client = createMatch({ players: BOTS_2V2, seed: 2 })
  interpolateSnapshot(client, a, b, 0.5)
  assert.ok(Math.abs(client.ball.x - (a[9][0] + b[9][0]) / 2) < 1e-9)
  assert.ok(Math.abs(client.ball.y - (a[9][1] + b[9][1]) / 2) < 1e-9)
  b[10].forEach(([i, x, y]) => {
    assert.ok(Math.abs(client.players[i].x - (a[10][i][1] + x) / 2) < 1e-9)
    assert.ok(Math.abs(client.players[i].y - (a[10][i][2] + y) / 2) < 1e-9)
  })
  assert.equal(client.tick, a[1])
  interpolateSnapshot(client, a, b, 1)
  assert.ok(Math.hypot(client.ball.x - b[9][0], client.ball.y - b[9][1]) < 1e-9)
  interpolateSnapshot(client, a, null, 0.7)
  assert.deepEqual([client.ball.x, client.ball.y], [a[9][0], a[9][1]])

  // Across a goal's reset to the kick-off, nobody slides over the pitch.
  const scorer = openPlay(ONE_V_ONE)
  setBall(scorer, -BR - 1, 96)
  run(scorer, 2.5 - 4 * DT)
  const lastGoal = encodeSnapshot(scorer)
  run(scorer, 8 * DT)
  const kickoff = encodeSnapshot(scorer)
  assert.deepEqual([lastGoal[2], kickoff[2]], [2, 0])
  const viewer = createMatch({ players: ONE_V_ONE })
  interpolateSnapshot(viewer, lastGoal, kickoff, 0.5)
  assert.deepEqual([viewer.ball.x, viewer.ball.y], [lastGoal[9][0], lastGoal[9][1]])
})
