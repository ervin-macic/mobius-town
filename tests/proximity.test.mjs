// Proximity rules: who hears whom. Run: node --test tests/proximity.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUBBLE_LEAK, HEAR_FULL, HEAR_MAX, VIDEO_MIN, audience, falloff, hearing, keepsMedia, wantsMedia,
} from '../av/proximity.js'

const town = { id: 'town', kind: 'outdoor' }
const lobby = { id: 'lobby', kind: 'house' }
const meetA = { id: 'meet-a', kind: 'meeting' }
const hallRoom = { id: 'auditorium', kind: 'hall' }
const at = (pid, x, y, extra = {}) => ({ pid, map: 'town', x, y, room: town, bubble: null, onStage: false, ...extra })

test('volume is full up close, fades with distance and stops at the edge', () => {
  assert.equal(falloff(0), 1)
  assert.equal(falloff(HEAR_FULL), 1)
  const mid = falloff((HEAR_FULL + HEAR_MAX) / 2)
  assert.ok(mid > 0 && mid < 1)
  assert.ok(falloff(HEAR_FULL + 1) > falloff(HEAR_FULL + 2), 'monotonic fade')
  assert.equal(falloff(HEAR_MAX), 0)
  assert.equal(falloff(HEAR_MAX + 5), 0)
})

test('nearby people are heard and seen; far people are not', () => {
  const me = at('me', 10, 10)
  const near = hearing(me, at('a', 11, 10))
  assert.deepEqual([near.gain, near.video, near.reason], [1, true, 'near'])
  const far = hearing(me, at('b', 30, 10))
  assert.deepEqual([far.gain, far.video], [0, false])
})

test('walls: different rooms and different maps are silent', () => {
  const me = at('me', 10, 10, { map: 'hall', room: lobby })
  assert.equal(hearing(me, at('a', 10, 11, { map: 'hall', room: meetA })).gain, 0)
  assert.equal(hearing(me, at('b', 10, 11, { map: 'cafe', room: { id: 'cafe', kind: 'house' } })).gain, 0)
})

test('meeting rooms: everyone inside hears everyone at full volume regardless of distance', () => {
  const me = at('me', 1, 3, { map: 'hall', room: meetA })
  const r = hearing(me, at('a', 8, 7, { map: 'hall', room: meetA }))
  assert.deepEqual([r.gain, r.video, r.reason], [1, true, 'room'])
})

test('bubbles: members hear each other fully, outsiders only faintly and without video', () => {
  const a = at('a', 10, 10, { bubble: 'b1' })
  const b = at('b', 14, 10, { bubble: 'b1' })
  const outsider = at('c', 11, 10)
  assert.deepEqual([hearing(a, b).gain, hearing(a, b).video], [1, true])
  const leak = hearing(outsider, a)
  assert.equal(leak.reason, 'leak')
  assert.ok(leak.gain > 0 && leak.gain <= BUBBLE_LEAK)
  assert.equal(leak.video, false)
  // Members faintly hear the outsider too.
  assert.ok(hearing(a, outsider).gain > 0 && hearing(a, outsider).gain <= BUBBLE_LEAK)
  // The leak still fades out with distance.
  assert.equal(hearing(at('d', 30, 10), a).gain, 0)
})

test('spotlight: whoever is on stage reaches the whole room at full volume', () => {
  const speaker = at('s', 24, 4, { map: 'hall', room: hallRoom, onStage: true })
  const backRow = at('l', 21, 15, { map: 'hall', room: hallRoom })
  const r = hearing(backRow, speaker)
  assert.deepEqual([r.gain, r.video, r.reason], [1, true, 'stage'])
  // ...but not people outside the auditorium.
  assert.equal(hearing(at('o', 14, 10, { map: 'hall', room: lobby }), speaker).gain, 0)
})

test('video appears only when someone is loud enough', () => {
  const me = at('me', 10, 10)
  for (let d = 0; d <= HEAR_MAX; d += 0.5) {
    const r = hearing(me, at('x', 10 + d, 10))
    assert.equal(r.video, r.gain >= VIDEO_MIN, `distance ${d}`)
  }
})

test('media connects a little before audible and hangs up only well out of range', () => {
  const me = at('me', 10, 10)
  assert.equal(wantsMedia(me, at('a', 10 + HEAR_MAX + 1, 10)), true)
  assert.equal(wantsMedia(me, at('a', 10 + HEAR_MAX + 3, 10)), false)
  assert.equal(keepsMedia(me, at('a', 10 + HEAR_MAX + 3, 10)), true, 'hysteresis')
  assert.equal(keepsMedia(me, at('a', 10 + HEAR_MAX + 6, 10)), false)
})

test('nearby chat reaches exactly the people who could hear your voice', () => {
  const me = at('me', 10, 10)
  const others = [at('a', 11, 10), at('b', 40, 40), at('c', 12, 10, { map: 'cafe' })]
  assert.deepEqual(audience(me, others).map((o) => o.pid), ['a'])
})
