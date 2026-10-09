// Zoom: steady 20% steps between 50% and 250%, a smooth glide, and a crisp 100%.
import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.window = { devicePixelRatio: 1 }
const { Game, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } = await import('../engine/game.js')

function game() {
  const canvas = { width: 1920, height: 1080, getContext: () => ({}) }
  return new Game({ canvas, me: { id: 'me', name: 'Me' } })
}

test('each step zooms 20%, within 50% to 250%, and lands back on 100%', () => {
  const g = game()
  const seen = []
  g.onZoom = (zoom) => seen.push(zoom)
  g.zoomBy(ZOOM_STEP)
  g.zoomBy(ZOOM_STEP)
  assert.ok(Math.abs(g.zoomTarget - 1.44) < 1e-9)
  g.zoomBy(1 / ZOOM_STEP)
  g.zoomBy(1 / ZOOM_STEP)
  assert.equal(g.zoomTarget, 1, 'back to exactly 100%')
  for (let i = 0; i < 20; i += 1) g.zoomBy(ZOOM_STEP)
  assert.equal(g.zoomTarget, ZOOM_MAX)
  for (let i = 0; i < 20; i += 1) g.zoomBy(1 / ZOOM_STEP)
  assert.equal(g.zoomTarget, ZOOM_MIN)
  assert.equal(seen.at(-1), ZOOM_MIN, 'the town hears every change')
})

test('small touchpad movements zoom a little, even starting from 100%', () => {
  const g = game()
  for (let i = 0; i < 5; i += 1) g.zoomBy(Math.exp(0.006))
  assert.ok(g.zoomTarget > 1.025 && g.zoomTarget < 1.035)
  for (let i = 0; i < 5; i += 1) g.zoomBy(Math.exp(-0.006))
  assert.ok(Math.abs(g.zoomTarget - 1) < 0.002)
})

test('the drawn zoom glides to the target without overshooting', () => {
  const g = game()
  g.zoomBy(ZOOM_STEP)
  let last = g.zoomLevel
  for (let frame = 0; frame < 30; frame += 1) {
    g.glideZoom(1 / 60)
    assert.ok(g.zoomLevel >= last && g.zoomLevel <= g.zoomTarget, 'moves steadily towards the target')
    last = g.zoomLevel
  }
  assert.equal(g.zoomLevel, g.zoomTarget, 'arrives within half a second')
})

test('100% is a whole-number scale and other levels scale from it', () => {
  const g = game()
  const base = g.scale()
  assert.equal(base, Math.round(base))
  g.setZoom(1.2)
  g.zoomLevel = g.zoomTarget
  assert.ok(Math.abs(g.scale() - base * 1.2) < 1e-9)
})
