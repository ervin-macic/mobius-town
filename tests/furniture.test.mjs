// Hiding furniture from a creation (engine/creations.js): a bench's or sofa's seat is a piece of
// its own under the backrest with the same key, so hiding the key leaves clean floor and no
// places to sit behind.
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.Image = class {
  constructor() { this.complete = true; this.naturalWidth = 1 }
}

const { baseMap } = await import('../engine/maps.js')
const { applyCreations } = await import('../engine/creations.js')

const PIECE = /^(bench3|sofa\d)_back$/

function hiding(mapId, keys) {
  return {
    id: 'c0000000007', rev: 1, masked: false,
    body: {
      v: 1, title: 'Clear the room', map: mapId, area: [0, 0, 1, 1], ground: [], props: [], solid: [], hide: keys,
      seats: [], glows: [], labels: [], uses: [], music: null, game: null, mood: null, surprise_for: [], triggers: [],
    },
  }
}

test('every bench and sofa has its seat as a piece under the same key', () => {
  for (const mapId of ['hall', 'cinema', 'office']) {
    const base = baseMap(mapId)
    const backs = base.ents.filter((e) => PIECE.test(e[0]))
    assert.ok(backs.length > 0, `${mapId} has benches or sofas`)
    for (const back of backs) {
      const names = base.ents.filter((e) => e[6] === back[6]).map((e) => e[0]).sort()
      assert.deepEqual(names, [back[0], back[0].replace('_back', '_seat')].sort(), back[6])
    }
  }
})

test('hiding a bench or sofa takes its seat and its places to sit', () => {
  let checked = 0
  for (const mapId of ['hall', 'cinema', 'office']) {
    const base = baseMap(mapId)
    for (const back of base.ents.filter((e) => PIECE.test(e[0]) && !e[5])) {
      const key = back[6]
      const map = applyCreations(base, [hiding(mapId, [key])])
      assert.equal(map.ents.filter((e) => Array.isArray(e) && e[6] === key).length, 0, `${key} is gone`)
      for (const [x, y] of back[4]) {
        assert.ok(base.seatIndex.has(y * base.w + x), `${key} had a seat at ${x},${y}`)
        assert.equal(map.seatIndex.has(y * map.w + x), false, `no seat left at ${x},${y}`)
      }
      checked++
    }
  }
  assert.ok(checked >= 14, `checked ${checked} benches and sofas`)
})
