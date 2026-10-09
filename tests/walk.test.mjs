// Walking: free movement with diagonals and small taps, walls and doorways, locked meeting
// rooms, chairs, map doors and other people's positions. Run: node --test tests/walk.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.window = { devicePixelRatio: 1 }
const { Game } = await import('../engine/game.js')
const { getMap, lockDoors, roomAt, tileKind } = await import('../engine/maps.js')
const { MIN_TAP, WALK_SPEED, cornerShift, fits, heading } = await import('../engine/motion.js')

const FRAME = 1 / 60

function game(mapId = 'town') {
  const events = []
  const canvas = { width: 1920, height: 1080, getContext: () => ({}) }
  const g = new Game({ canvas, me: { id: 'me', name: 'Me' }, onEvent: (type, payload) => events.push({ type, ...payload }) })
  g.ensureGround = async () => {} // no images in tests
  if (mapId !== 'town') {
    g.mapId = mapId
    g.map = getMap(mapId)
    g.lockDoorTiles = lockDoors(g.map)
    g.me.mapId = mapId
  }
  g.events = events
  return g
}

function place(g, x, y) {
  Object.assign(g.me, { x: Math.round(x), y: Math.round(y), fx: x, fy: y, path: [], seat: null, moving: false })
  g.events.length = 0
}

function run(g, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) g.update(FRAME)
}

function locked(allow) {
  return { locks: { 'hall:meet-a': { by: 'x', byName: 'X', at: 0, allow } }, bubbles: {}, tv: {}, games: {} }
}

test('two arrow keys walk diagonally, as fast as one', () => {
  const g = game()
  place(g, 30, 26)
  g.pressDir('right')
  g.pressDir('down')
  run(g, 0.3)
  const dx = g.me.fx - 30, dy = g.me.fy - 26
  assert.ok(Math.abs(dx - dy) < 0.02, `even diagonal: ${dx}, ${dy}`)
  assert.ok(Math.abs(Math.hypot(dx, dy) - WALK_SPEED * 0.3) < 0.12, `speed: ${Math.hypot(dx, dy)}`)
  assert.equal(g.me.dir, 'down', 'you face the key pressed last')
  assert.equal(g.me.moving, true)
})

test('a quick tap nudges you a little way, not a whole tile', () => {
  const g = game()
  place(g, 30, 26)
  g.pressDir('right')
  g.update(FRAME)
  g.releaseDir('right')
  run(g, 0.5)
  const moved = g.me.fx - 30
  assert.ok(moved > 0.2 && moved < 0.55, `tap moved ${moved} tiles (about ${MIN_TAP * WALK_SPEED})`)
  assert.equal(g.me.moving, false)
})

test('opposite keys cancel', () => {
  const g = game()
  place(g, 30, 26)
  g.pressDir('left')
  g.pressDir('right')
  run(g, 0.3)
  assert.equal(g.me.fx, 30)
  assert.equal(heading(['left', 'right']), null)
})

test('walls stop you, and walking diagonally into one slides along it', () => {
  const g = game()
  place(g, 31, 26) // just below the fountain
  assert.equal(tileKind(g.map, 31, 25), 1)
  g.pressDir('up')
  g.pressDir('right')
  run(g, 0.3)
  assert.ok(g.me.fy >= 25.45, `stopped at the fountain: ${g.me.fy}`)
  assert.ok(g.me.fx > 31.9, `slid along it: ${g.me.fx}`)
})

test('walking at the edge of a one-tile doorway eases you through it', () => {
  const g = game('hall')
  place(g, 11, 5.35) // in the lobby, a little low for Meeting Room A's door at (9, 5)
  assert.ok(!fits(g.blocker, 9, 5.35), 'straight on, the wall below the door is in the way')
  assert.ok(cornerShift(g.blocker, 9.8, 5.35, -1, 0) < 0, 'stopped by the wall below it, the opening is up')
  g.pressDir('left')
  run(g, 1)
  assert.ok(g.me.fx < 8.5, `walked into the room: ${g.me.fx}`)
  assert.equal(roomAt(g.map, g.me.x, g.me.y).id, 'meet-a')
})

test('a locked meeting room keeps out the people it does not let in', () => {
  const g = game('hall')
  g.setWorld(locked(['someone-else']))
  place(g, 11, 5)
  g.pressDir('left')
  run(g, 1)
  assert.ok(g.me.fx > 9.5, `stopped outside the door: ${g.me.fx}`)
  assert.notEqual(roomAt(g.map, g.me.x, g.me.y).id, 'meet-a')
  assert.ok(g.events.some((e) => e.type === 'blocked' && e.x === 9 && e.y === 5), 'asked whether to knock')
  // Tapping your way to the room is refused too.
  g.walkTo(5, 4)
  run(g, 2)
  assert.notEqual(roomAt(g.map, g.me.x, g.me.y).id, 'meet-a')
})

test('people a locked room lets in come and go', () => {
  const g = game('hall')
  g.setWorld(locked(['me']))
  place(g, 11, 5)
  g.pressDir('left')
  run(g, 1)
  assert.equal(roomAt(g.map, g.me.x, g.me.y).id, 'meet-a')
})

test('if a room locks without you just as you walk in, you step back out of its door', () => {
  const g = game('hall')
  place(g, 7, 4)
  assert.equal(roomAt(g.map, 7, 4).id, 'meet-a')
  g.setWorld(locked(['someone-else']))
  assert.deepEqual([g.me.x, g.me.y], [10, 5])
  assert.ok(g.events.some((e) => e.type === 'lockedout' && e.room === 'meet-a'))
  g.setWorld(locked(['someone-else']))
  assert.deepEqual([g.me.x, g.me.y], [10, 5], 'and stays out')
})

test('coming to rest on a chair sits you down; a key gets you up and off it', () => {
  const g = game()
  place(g, 25, 21) // below the bench by the notice board
  g.pressDir('up')
  run(g, 0.2)
  g.releaseDir('up')
  run(g, 0.2)
  assert.ok(g.me.seat, 'seated')
  assert.deepEqual([g.me.fx, g.me.fy, g.me.dir], [25, 20, 'down'])
  assert.ok(g.events.some((e) => e.type === 'sit'))
  g.pressDir('down')
  g.update(FRAME)
  g.releaseDir('down')
  run(g, 0.5)
  assert.equal(g.me.seat, null)
  assert.deepEqual([g.me.x, g.me.y], [25, 21])
  assert.ok(g.events.some((e) => e.type === 'stand'))
})

test('tapping a door on the map walks you there and through it', async () => {
  const g = game()
  place(g, 12, 20)
  g.walkTo(8, 18) // the Chess Club's door
  run(g, 1.5)
  assert.equal(g.pendingDoor?.to, 'chess')
  run(g, 0.5)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(g.mapId, 'chess')
})

test('other people glide to exactly where they are; older towns that send whole tiles still work', () => {
  const g = game()
  place(g, 20, 26)
  g.upsertOther('new', { mapId: 'town', x: 30, y: 26, fx: 30.4, fy: 26.2, dir: 'right', moving: true })
  g.upsertOther('old', { mapId: 'town', x: 32, y: 27, dir: 'down' })
  run(g, 0.5)
  const a = g.others.get('new'), b = g.others.get('old')
  assert.ok(Math.abs(a.fx - 30.4) < 1e-6 && Math.abs(a.fy - 26.2) < 1e-6)
  assert.deepEqual([b.fx, b.fy], [32, 27])
  // Walking diagonally, they keep the facing they sent rather than flickering.
  g.upsertOther('new', { mapId: 'town', x: 31, y: 27, fx: 31, fy: 27, dir: 'right', moving: true })
  g.update(FRAME)
  assert.equal(a.dir, 'right')
  assert.equal(a.moving, true)
})
