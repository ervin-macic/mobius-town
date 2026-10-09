import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BODIES, DEFAULT_LOOK, lookKey, normalizeLook, randomLook } from '../engine/assets.js'

test('looks saved before the character choice become the male character', () => {
  assert.deepEqual(normalizeLook({ skin: 2, hair: 3, shirt: 4, pants: 1 }), { body: 0, skin: 2, hair: 3, shirt: 4, pants: 1 })
  assert.equal(normalizeLook(null).body, DEFAULT_LOOK.body)
})

test('the character choice is kept, and anything unknown falls back', () => {
  assert.equal(normalizeLook({ body: 1 }).body, 1)
  for (const bad of [2, -1, 0.5, '1', true, null]) assert.equal(normalizeLook({ body: bad }).body, 0, String(bad))
  assert.equal(BODIES.length, 2)
})

test('surprise colours keep the chosen character; a first look may be either', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.equal(randomLook(1).body, 1)
    assert.equal(randomLook(0).body, 0)
    assert.ok([0, 1].includes(randomLook().body))
  }
})

test('the two characters never share a recoloured sheet', () => {
  const look = { skin: 1, hair: 2, shirt: 3, pants: 4 }
  assert.notEqual(lookKey({ ...look, body: 0 }), lookKey({ ...look, body: 1 }))
})
