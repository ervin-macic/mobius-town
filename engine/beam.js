// Teleport effects, drawn in world pixels like the rest of the scene so they stay pixel-crisp.
//
// Leaving ('beam-out'): a column of light rises where you stand, you brighten and dissolve from
// the feet up into pixels that drift skywards, and the light fades. Arriving ('beam-in'): a beam
// drops onto the spot, the ground ripples, you materialise head first out of the light.
// game.js owns the timing (BEAM) and hides the real avatar while an effect draws it.
import { avatarSheet, DIR_ROW, FEET_Y, FRAME_H, FRAME_W, PALETTES } from './assets.js'

/** Seconds. The whole teleport takes about 1.3 s; see Game.beamTo. */
export const BEAM = {
  out: 0.55, // the departure, until you have dissolved
  outFx: 0.8, // the departure's light, which lingers a little
  glide: 0.42, // the camera's trip across the map
  glideTiles: 26, // further than this on the same map, the view fades instead of gliding
  fade: 0.2, // the view fading out or in (another map, far away, or reduced motion)
  materialise: 0.5, // from the arrival beam until you stand there yourself
  inFx: 0.95, // the arrival's light and ripples
  remoteHide: 3, // someone who beamed away stays hidden this long unless they arrive sooner
}

// Character frames have pixels from row 5 (the top of a head) to row 27 (the soles).
const TOP = 5
const FEET = 28
const CORE = '#f4fffb'
const GLOW = [94, 224, 193] // --mt-teal

const clamp01 = (t) => Math.max(0, Math.min(1, t))
const linear = (a, b, x) => clamp01((x - a) / (b - a))
const smooth = (a, b, x) => {
  const t = linear(a, b, x)
  return t * t * (3 - 2 * t)
}

// The same scatter on every frame and in every browser: no Math.random in drawing.
function hash(i, salt) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return s - Math.floor(s)
}

let scratch = null
function scratchCanvas() {
  if (!scratch) {
    scratch = document.createElement('canvas')
    scratch.width = FRAME_W
    scratch.height = FRAME_H
  }
  return scratch
}

/**
 * The standing frame of `look` facing `dir`, washed towards white by `glow` (0..1), with only the
 * rows between `from` and `to` kept (a two-row checkered edge where it dissolves).
 */
function partialSprite(game, look, dir, glow, from, to) {
  const c = scratchCanvas()
  const g = c.getContext('2d')
  g.globalCompositeOperation = 'source-over'
  g.clearRect(0, 0, FRAME_W, FRAME_H)
  g.drawImage(avatarSheet(game.images.characters, look), 0, (DIR_ROW[dir] ?? 0) * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H)
  if (glow > 0.01) {
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = `rgba(232,255,250,${Math.min(0.92, glow)})`
    g.fillRect(0, 0, FRAME_W, FRAME_H)
    g.globalCompositeOperation = 'source-over'
  }
  const top = Math.round(from), bottom = Math.round(to)
  if (top > 0) g.clearRect(0, 0, FRAME_W, top)
  if (bottom < FRAME_H) g.clearRect(0, bottom, FRAME_W, FRAME_H - bottom)
  // Checker the rows next to each cut so the edge crumbles rather than slices.
  for (const row of [top, bottom - 1]) {
    if (row < 0 || row >= FRAME_H || top >= bottom) continue
    for (let x = row % 2; x < FRAME_W; x += 2) g.clearRect(x, row, 1, 1)
  }
  return c
}

/** A vertical shaft of light from `top` down to `bottom` (world px), `w` its half-width. */
function column(ctx, x, top, bottom, w, a) {
  if (a <= 0.01 || w <= 0.2 || bottom <= top) return
  ctx.save()
  // 'screen' brightens towards white; additive light would turn green over grass.
  ctx.globalCompositeOperation = 'screen'
  const h = bottom - top
  const shaft = (half, colour, alpha) => {
    const grad = ctx.createLinearGradient(0, top, 0, bottom)
    grad.addColorStop(0, `rgba(${colour},0)`)
    grad.addColorStop(0.35, `rgba(${colour},${alpha * 0.7})`)
    grad.addColorStop(1, `rgba(${colour},${alpha})`)
    ctx.fillStyle = grad
    const hw = Math.max(0.5, Math.round(half * 2) / 2)
    ctx.fillRect(Math.round(x - hw), top, Math.round(hw * 2), h)
  }
  // Stepped layers, pixel-art style: a wide soft glow, a brighter band and a white core.
  shaft(w * 1.7, GLOW.join(','), 0.18 * a)
  shaft(w, GLOW.join(','), 0.32 * a)
  shaft(Math.max(1, w * 0.35), '236,255,250', 0.85 * a)
  // A pool of light on the ground.
  const pool = ctx.createRadialGradient(x, bottom, 0.5, x, bottom, 14)
  pool.addColorStop(0, `rgba(210,255,246,${0.55 * a})`)
  pool.addColorStop(1, 'rgba(94,224,193,0)')
  ctx.fillStyle = pool
  ctx.fillRect(x - 16, bottom - 8, 32, 14)
  ctx.restore()
}

function sparkle(ctx, x, y, a, size = 1) {
  if (a <= 0.03) return
  ctx.globalAlpha = Math.min(1, a)
  ctx.fillStyle = CORE
  ctx.fillRect(Math.round(x) - size, Math.round(y), size * 2 + 1, 1)
  ctx.fillRect(Math.round(x), Math.round(y) - size, 1, size * 2 + 1)
  ctx.globalAlpha = 1
}

/** Twinkling crosses around the shaft, rising (`dir` -1) or settling (`dir` 1). */
function sparkles(ctx, x, feet, e, strength, dir, salt) {
  for (let k = 0; k < 9; k++) {
    const p = (e * 0.9 + hash(k, salt)) % 1
    const sx = x + (hash(k, salt + 1) - 0.5) * 26
    const sy = dir < 0 ? feet - 4 - p * 64 : feet - 70 + p * 60
    const twinkle = Math.abs(Math.sin(e * 9 + k * 1.9))
    sparkle(ctx, sx, sy, strength * twinkle * (1 - p * 0.6), k % 3 === 0 ? 2 : 1)
  }
}

function shirtOf(look) {
  return (PALETTES.shirt[look?.shirt] || PALETTES.shirt[0])[0]
}

function departure(ctx, game, fx, e) {
  const { x, y } = fx
  const top = y - FEET_Y // the frame's top row in the world
  const grow = smooth(0, 0.12, e)
  const fade = 1 - smooth(0.5, fx.duration, e)
  column(ctx, x, y - 118, y + 2, 5.5 * grow * (0.6 + 0.4 * fade), grow * fade)
  // Dissolving from the feet up (rows below the cut are gone), brightening and lifting a little.
  const p = linear(0.06, BEAM.out, e)
  const cut = FEET - p * (FEET - TOP)
  const lift = Math.round(smooth(0, 1, p) * 5)
  if (cut > TOP) ctx.drawImage(partialSprite(game, fx.look, fx.dir, 0.2 + p * 0.8, 0, cut), x - FRAME_W / 2, top - lift)
  // Each row lets go of a few motes as the cut passes it; they float up and fade.
  const colours = [CORE, `rgb(${GLOW.join(',')})`, shirtOf(fx.look)]
  for (let i = 0; i < 26; i++) {
    const row = TOP + hash(i, 3) * (FEET - TOP)
    const born = 0.06 + ((FEET - row) / (FEET - TOP)) * (BEAM.out - 0.06)
    const age = e - born
    if (age < 0 || age > 0.55) continue
    const mx = x + Math.round((hash(i, 4) - 0.5) * 11 + Math.sin(age * 7 + i) * 1.5)
    const my = Math.round(top - lift + row - age * (34 + hash(i, 5) * 40))
    ctx.globalAlpha = 1 - age / 0.55
    ctx.fillStyle = colours[i % 3]
    ctx.fillRect(mx, my, 1, i % 4 === 0 ? 2 : 1)
  }
  ctx.globalAlpha = 1
  sparkles(ctx, x, y, e, fade * grow, -1, 7)
}

function arrival(ctx, game, fx, e) {
  const { x, y } = fx
  const top = y - FEET_Y
  // The beam drops from the sky in a tenth of a second, then holds, narrows and fades.
  const drop = smooth(0, 0.12, e)
  const fade = 1 - smooth(0.42, fx.duration, e)
  const bottom = y - 130 + drop * 132
  column(ctx, x, y - 132, bottom, 5.5 * (0.5 + 0.5 * fade), Math.max(drop * 0.6, drop * fade))
  // Two ripples run out over the ground where it lands.
  for (let r = 0; r < 2; r++) {
    const t = e - 0.12 - r * 0.13
    if (t <= 0 || t > 0.5) continue
    const rad = 3 + t * 46
    ctx.strokeStyle = `rgba(220,255,248,${0.85 * (1 - t / 0.5)})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(x, y + 1, rad, rad * 0.42, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Materialising head first out of the light; the real avatar takes over at BEAM.materialise.
  if (e < BEAM.materialise) {
    const reveal = TOP + linear(0.1, BEAM.materialise - 0.08, e) * (FEET - TOP)
    const glow = 1 - smooth(0.2, BEAM.materialise, e)
    if (reveal > TOP) ctx.drawImage(partialSprite(game, fx.look, fx.dir, glow, 0, reveal), x - FRAME_W / 2, top)
    // Motes falling in to fill the rows still to come.
    for (let i = 0; i < 18; i++) {
      const row = TOP + hash(i, 11) * (FEET - TOP)
      const lands = 0.1 + ((row - TOP) / (FEET - TOP)) * (BEAM.materialise - 0.18)
      const left = lands - e
      if (left < 0 || left > 0.3) continue
      ctx.globalAlpha = 1 - left / 0.3
      ctx.fillStyle = i % 2 ? CORE : `rgb(${GLOW.join(',')})`
      ctx.fillRect(x + Math.round((hash(i, 12) - 0.5) * 10), Math.round(top + row - left * 70), 1, 1)
    }
    ctx.globalAlpha = 1
  }
  sparkles(ctx, x, y, e, fade * drop, 1, 13)
}

/** Draw one teleport effect (from game.effects) at its place in the depth order. */
export function drawBeam(ctx, game, fx) {
  const e = game.time - fx.start
  if (e < 0 || e > fx.duration || !game.images.characters) return
  if (fx.kind === 'beam-out') departure(ctx, game, fx, e)
  else if (fx.kind === 'beam-in') arrival(ctx, game, fx, e)
}

/** Whether a teleport hides this avatar right now (an effect is drawing it, or it is in transit). */
export function beamHidden(game, a) {
  return (a.beamHideUntil || 0) > game.time
}
