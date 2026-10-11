// Cats on maps with creations (engine/cats.js): a creation's pictures sit among the map's sprites,
// so the cats must read both, and they must keep out of whatever was built on their patch.
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.Image = class {
  constructor() { this.complete = true; this.naturalWidth = 1 }
}

const { baseMap, tileKind } = await import('../engine/maps.js')
const { applyCreations } = await import('../engine/creations.js')
const { catsOn, CATS } = await import('../engine/cats.js')

const T = 16
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** A creation on the café floor: one tall piece (drawn among the sprites) over solid tiles. */
function planter(solid) {
  return {
    id: 'c0000000042', rev: 1, masked: false,
    body: {
      v: 1, title: 'Planters', map: 'cafe', area: [1, 4, 14, 6], ground: [],
      props: [{ x: 7 * T, y: 4 * T, z: 6 * T, layer: 'normal', frames: [PIXEL], fps: 0, fx: null, w: 32, h: 44 }],
      solid, hide: [], seats: [], glows: [], labels: [], uses: [], music: null, game: null, mood: null, surprise_for: [], triggers: [],
    },
  }
}

const game = { catPets: new Map() }

test('cats work out their spots on a map with a creation on it', () => {
  const map = applyCreations(baseMap('cafe'), [planter([])])
  assert.ok(map.ents.some((e) => !Array.isArray(e)), 'the creation adds a piece among the sprites')
  const cats = catsOn(game, 'cafe', map, 1234, 0)
  assert.equal(cats.length, CATS.filter((c) => c.map === 'cafe').length)
})

test('cats keep out of what was built, even after they first settled on the plain map', () => {
  const latte = CATS.find((c) => c.map === 'cafe')
  const [x0, y0, x1, y1] = latte.zone
  // Before: settle the cats on the plain café (the way a session starts).
  for (let s = 0; s < 18 * 40; s += 9) catsOn(game, 'cafe', baseMap('cafe'), s, 0)
  // Then nearly the whole patch is built over, leaving one walkable row.
  const solid = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (y !== y1 && tileKind(baseMap('cafe'), x, y) === 0) solid.push([x, y])
  }
  const map = applyCreations(baseMap('cafe'), [planter(solid)])
  for (let s = 0; s < 18 * 40; s += 3) {
    const cat = catsOn(game, 'cafe', map, s, 0)[0]
    const tx = Math.floor(cat.x / T), ty = Math.floor((cat.y - 13) / T)
    if (cat.pose === 'walk') continue
    assert.notEqual(tileKind(map, tx, ty), 1, `the cat rests on a built tile ${tx},${ty} at ${s}s`)
  }
})
