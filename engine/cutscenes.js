// Small cinematic moments: the camera glides to a subject, letterbox bars
// slide in, the subject gets its effect, a caption fades in, then it all eases
// back. Purely visual; game.js owns timing and input freezing.

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function phase(c, time) {
  const e = time - c.start
  const w = Math.min(smooth(0, 0.9, e), 1 - smooth(c.duration - 0.9, c.duration, e))
  return { e, w }
}

/** Where the camera should look: the player, or the cutscene's subject. */
export function cutsceneFocus(game, feet) {
  const c = game.cutscene
  if (!c || !c.focus) return feet
  const { w } = phase(c, game.time)
  return { x: feet.x + (c.focus[0] - feet.x) * w, y: feet.y + (c.focus[1] - feet.y) * w }
}

function sparkle(ctx, x, y, a, size = 1) {
  if (a <= 0.02) return
  ctx.globalAlpha = a
  ctx.fillStyle = '#fff8d8'
  ctx.fillRect(Math.round(x) - size, Math.round(y), size * 2 + 1, 1)
  ctx.fillRect(Math.round(x), Math.round(y) - size, 1, size * 2 + 1)
  ctx.globalAlpha = 1
}

function statueWorld(ctx, game, c) {
  const { e, w } = phase(c, game.time)
  const [fx, fy] = c.focus
  ctx.save()
  // 'screen' brightens towards warm gold without tinting everything green like additive light would.
  ctx.globalCompositeOperation = 'screen'
  // God rays fanning down from above onto the statue.
  for (let i = 0; i < 6; i++) {
    const sway = Math.sin(game.time * 0.7 + i) * 6
    const ox = fx + (i - 2.5) * 12 + sway
    const oy = fy - 190
    const spread = 5 + i % 3 * 3
    const a = w * (0.34 + 0.12 * Math.sin(game.time * 2.1 + i * 1.3))
    const g = ctx.createLinearGradient(ox, oy, fx, fy + 20)
    g.addColorStop(0, `rgba(255,226,140,${a})`)
    g.addColorStop(0.7, `rgba(255,214,120,${a * 0.5})`)
    g.addColorStop(1, 'rgba(255,200,110,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(ox - 2, oy)
    ctx.lineTo(ox + 2, oy)
    ctx.lineTo(fx + (i - 2.5) * 4 + spread, fy + 26)
    ctx.lineTo(fx + (i - 2.5) * 4 - spread, fy + 26)
    ctx.closePath()
    ctx.fill()
  }
  // The sun breaking through above.
  const sun = ctx.createRadialGradient(fx, fy - 74, 2, fx, fy - 74, 46)
  sun.addColorStop(0, `rgba(255,252,225,${0.95 * w})`)
  sun.addColorStop(0.3, `rgba(255,214,110,${0.6 * w})`)
  sun.addColorStop(1, 'rgba(255,190,90,0)')
  ctx.fillStyle = sun
  ctx.fillRect(fx - 50, fy - 124, 100, 100)
  // A warm pool of light at the statue's feet.
  const pool = ctx.createRadialGradient(fx, fy + 22, 2, fx, fy + 22, 34)
  pool.addColorStop(0, `rgba(255,220,140,${0.55 * w})`)
  pool.addColorStop(1, 'rgba(255,220,140,0)')
  ctx.fillStyle = pool
  ctx.fillRect(fx - 40, fy - 10, 80, 64)
  ctx.restore()
  for (let k = 0; k < 16; k++) {
    const ang = k * 2.4 + game.time * 0.4
    const r = 14 + (k * 7) % 26
    const x = fx + Math.cos(ang) * r
    const y = fy - 6 + Math.sin(ang * 1.3) * r * 0.7 - ((game.time * 8 + k * 5) % 30)
    sparkle(ctx, x, y, w * Math.max(0, Math.sin(game.time * 5 + k * 1.7)), k % 3 === 0 ? 2 : 1)
  }
  void e
}

function fountainWorld(ctx, game, c) {
  const { e, w } = phase(c, game.time)
  const [fx, fy] = c.focus
  const start = c.data.from || [fx, fy + 40]
  const land = 1.9
  const p = Math.max(0, Math.min(1, (e - 0.8) / (land - 0.8)))
  if (e >= 0.8 && e < land) {
    const x = start[0] + (fx - start[0]) * p
    const y = start[1] + (fy + 2 - start[1]) * p - Math.sin(Math.PI * p) * 40
    const spin = Math.abs(Math.cos(e * 16))
    const cw = Math.max(1, Math.round(4 * spin))
    ctx.fillStyle = '#5a3a10'
    ctx.fillRect(Math.round(x - cw / 2) - 1, Math.round(y) - 3, cw + 2, 7)
    ctx.fillStyle = '#ffd34a'
    ctx.fillRect(Math.round(x - cw / 2), Math.round(y) - 2, cw, 5)
    ctx.fillStyle = '#fff3b0'
    if (cw > 2) ctx.fillRect(Math.round(x - cw / 2), Math.round(y) - 2, 1, 2)
    sparkle(ctx, x + 4, y - 4, 0.6 * spin)
  }
  if (e >= land) {
    const t = e - land
    // Ripples.
    for (let r = 0; r < 3; r++) {
      const rr = (t - r * 0.25) * 22
      if (rr <= 0 || rr > 26) continue
      ctx.strokeStyle = `rgba(220,245,255,${Math.max(0, 0.8 - rr / 30) * w})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(fx, fy + 2, rr, rr * 0.45, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    // Splash droplets.
    if (t < 0.7) {
      for (let k = 0; k < 9; k++) {
        const ang = Math.PI * (0.15 + 0.7 * (k / 8))
        const v = 34 + (k % 3) * 8
        const x = fx + Math.cos(ang) * v * t * (k % 2 ? 1 : -1) * 0.6
        const y = fy + 2 - Math.sin(ang) * v * t + 90 * t * t
        ctx.fillStyle = k % 2 ? '#bfe9ff' : '#ffffff'
        ctx.fillRect(Math.round(x), Math.round(y), 1, 2)
      }
    }
    for (let k = 0; k < 12; k++) {
      const ang = k * 0.52 + t * 2
      const r = 6 + t * 18 + (k % 3) * 3
      sparkle(ctx, fx + Math.cos(ang) * r, fy - 4 + Math.sin(ang) * r * 0.5 - t * 8, w * Math.max(0, 1 - t / 2.2) * Math.abs(Math.sin(t * 9 + k)))
    }
  }
}

function mobiusWorld(ctx, game, c) {
  const { w } = phase(c, game.time)
  const [fx, fy] = c.focus
  for (let k = 0; k < 20; k++) {
    const ang = game.time * 1.6 + (k * Math.PI * 2) / 20
    const r = 54 + 8 * Math.sin(game.time * 3 + k)
    sparkle(ctx, fx + Math.cos(ang) * r, fy + Math.sin(ang) * r * 0.45, w * (0.4 + 0.6 * Math.abs(Math.sin(game.time * 4 + k))), k % 4 === 0 ? 2 : 1)
  }
}

export function drawCutsceneWorld(ctx, game) {
  const c = game.cutscene
  if (!c) return
  if (c.kind === 'statue') statueWorld(ctx, game, c)
  else if (c.kind === 'fountain') fountainWorld(ctx, game, c)
  else if (c.kind === 'mobius') mobiusWorld(ctx, game, c)
}

export function drawCutsceneScreen(ctx, game, w, h, dpr) {
  const c = game.cutscene
  if (!c) return
  const { e, w: weight } = phase(c, game.time)
  // Letterbox bars.
  const bar = Math.round(h * 0.11 * weight)
  ctx.fillStyle = '#07050c'
  ctx.fillRect(0, 0, w, bar)
  ctx.fillRect(0, h - bar, w, bar)
  // Caption.
  const a = smooth(1.0, 1.7, e) * (1 - smooth(c.duration - 1.0, c.duration - 0.3, e))
  if (a <= 0 || !c.caption) return
  const y = h - bar - 74 * dpr
  // A soft dark band behind the words, like film subtitles, so the caption reads over any scene.
  const top = y - 34 * dpr
  const bottom = y + (c.sub ? 62 : 30) * dpr
  const band = ctx.createLinearGradient(0, top, 0, bottom)
  band.addColorStop(0, 'rgba(7,5,12,0)')
  band.addColorStop(0.3, `rgba(7,5,12,${0.62 * a})`)
  band.addColorStop(0.75, `rgba(7,5,12,${0.62 * a})`)
  band.addColorStop(1, 'rgba(7,5,12,0)')
  ctx.fillStyle = band
  ctx.fillRect(0, top, w, bottom - top)
  ctx.globalAlpha = a
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(34 * dpr)}px KenneyBlocks, KenneyMini, ui-monospace, monospace`
  ctx.fillStyle = '#7a4a12'
  ctx.fillText(c.caption, w / 2, y + 3 * dpr)
  ctx.fillStyle = '#ffd36a'
  ctx.fillText(c.caption, w / 2, y)
  if (c.sub) {
    ctx.font = `600 ${Math.round(16 * dpr)}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = '#fff6dc'
    ctx.fillText(c.sub, w / 2, y + 38 * dpr)
  }
  ctx.globalAlpha = 1
}
