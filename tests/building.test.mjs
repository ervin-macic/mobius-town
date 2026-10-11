// Triggers from this player's side (engine/building.js): a surprise built around someone waits
// until they really walk in; walking in fires it once; it is never for someone else.
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.Image = class {
  constructor() { this.complete = true; this.naturalWidth = 1 }
}

const { Building } = await import('../engine/building.js')
const { getMap, setCreations } = await import('../engine/maps.js')

function creation(who = ['@sam'], once = 'per_person') {
  return {
    id: 'c0000000001', rev: 1, masked: false,
    body: {
      v: 1, title: "Sam's birthday", map: 'cafe', area: [1, 3, 14, 7], ground: [], props: [], solid: [], hide: [],
      seats: [], glows: [], labels: [], uses: [], music: null, game: null, mood: null, surprise_for: ['@sam'],
      triggers: [{ when: 'enter', where: 'room', who, once, everyone_sees: true, do: [{ sound: 'fanfare' }, { banner: 'HAPPY BIRTHDAY' }] }],
    },
  }
}

function setup(handle = 'sam') {
  const fired = []
  const acts = []
  const game = {
    mapId: 'town', map: getMap('town'), me: { x: 30, y: 30 }, time: 0,
    fx: { setLights() {}, setBanner: (t) => fired.push(t), spawn() {}, poof() {} },
    refreshMap() { this.map = getMap(this.mapId) },
    others: new Map(),
  }
  const town = {
    pid: handle, identityHandle: handle, profile: { name: handle[0].toUpperCase() + handle.slice(1) },
    serverNow: () => Date.now(), stopped: false, game, state: { world: {} },
    act: async (op, args) => { acts.push([op, args]); return {} },
    mesh: { broadcast() {} }, sound: { play() {}, setDance() {} }, set() {}, toast() {}, emote() {},
    hello: { isHub: false },
  }
  const b = new Building({ town })
  return { b, game, fired, acts }
}

function enter(game, b, mapId, x, y) {
  game.mapId = mapId
  game.map = getMap(mapId)
  game.me = { x, y }
  b.onMap(mapId)
}

async function settle() {
  await new Promise((r) => setTimeout(r, 20))
}

test('a surprise built around its person waits until they walk in, then fires once', async () => {
  const { b, game, fired, acts } = setup('sam')
  enter(game, b, 'cafe', 8, 6)
  await settle()
  // Sam is already in the café when the surprise appears there.
  b.index = [{ id: 'c0000000001', rev: 1, map: 'cafe', area: [1, 3, 14, 7], masked: true, fired: [] }]
  b.bodies.set('c0000000001', { rev: 1, body: creation().body })
  b.apply()
  b.checkTriggers()
  await settle()
  assert.deepEqual(fired, [], 'not while Sam was already inside')
  assert.equal(acts.filter(([op]) => op === 'trigger_fire').length, 0)
  // Sam steps out to town and comes back in.
  enter(game, b, 'town', 55, 32)
  await settle()
  enter(game, b, 'cafe', 8, 9)
  await settle()
  b.checkTriggers()
  await settle()
  assert.deepEqual(fired, ['HAPPY BIRTHDAY'])
  assert.deepEqual(acts.find(([op]) => op === 'trigger_fire')[1], { creation: 'c0000000001', trigger: 0 })
  // Once per person: walking in again does nothing.
  enter(game, b, 'town', 55, 32)
  await settle()
  enter(game, b, 'cafe', 8, 9)
  await settle()
  b.checkTriggers()
  await settle()
  assert.equal(fired.length, 1)
})

test('arriving through the door into a trigger fires it; it is never for someone else', async () => {
  const sam = setup('sam')
  sam.b.index = [{ id: 'c0000000001', rev: 1, map: 'cafe', area: [1, 3, 14, 7], masked: false, fired: [] }]
  sam.b.bodies.set('c0000000001', { rev: 1, body: creation().body })
  enter(sam.game, sam.b, 'cafe', 8, 9)
  await settle()
  sam.b.checkTriggers()
  await settle()
  assert.deepEqual(sam.fired, ['HAPPY BIRTHDAY'])

  const bob = setup('bob')
  bob.b.index = [{ id: 'c0000000001', rev: 1, map: 'cafe', area: [1, 3, 14, 7], masked: false, fired: [] }]
  bob.b.bodies.set('c0000000001', { rev: 1, body: creation().body })
  enter(bob.game, bob.b, 'cafe', 8, 9)
  await settle()
  bob.b.checkTriggers()
  await settle()
  assert.deepEqual(bob.fired, [])
  setCreations('cafe', [])
})
