// Moments: particles (confetti, fireworks...), room lights, banners, and the construction sites
// people see while a builder works. Everything is drawn in the town's pixel style: small square
// particles, no blur, a few flat colours.

const T = 16
const PARTY = ['#ff6b8a', '#ffd36a', '#5ee0c1', '#8fb8ff', '#c79bff', '#ff9a52', '#ffffff']
const rnd = (a, b) => a + Math.random() * (b - a)
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const clamp01 = (v) => Math.max(0, Math.min(1, v))

/** One burst of particles over an area (world pixels). */
class Burst {
  constructor(kind, { x, y, w = 96, h = 64, seconds = 4, start }) {
    this.kind = kind
    this.x = x
    this.y = y
    this.w = w
    this.h = h
    this.seconds = seconds
    this.start = start
    this.parts = []
    this.spawnAcc = 0
    this.rockets = []
    if (kind === 'stars') {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2
        const v = rnd(40, 90)
        this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 20, life: rnd(1, 1.8), age: 0, c: pick(['#ffd36a', '#fff3b0', '#ffffff']) })
      }
    }
  }

  get done() {
    return this.age >= this.seconds && !this.parts.length && !this.rockets.length
  }

  rate() {
    return { confetti: 70, snow: 26, petals: 16, sparkles: 18, hearts: 5, balloons: 2.2, bubbles: 6, fireworks: 0.9 }[this.kind] || 0
  }

  update(dt, time) {
    this.age = time - this.start
    const spawning = this.age < this.seconds * 0.75
    if (spawning) {
      this.spawnAcc += dt * this.rate()
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1
        this.spawn()
      }
    }
    for (const r of this.rockets) {
      r.age += dt
      r.y += r.vy * dt
      r.vy += 40 * dt
      if (r.age >= r.fuse) {
        r.dead = true
        const n = 28
        const c = pick(PARTY)
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          const v = rnd(36, 60)
          this.parts.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.9, 1.4), age: 0, c, spark: true })
        }
      }
    }
    this.rockets = this.rockets.filter((r) => !r.dead)
    for (const p of this.parts) {
      p.age += dt
      if (this.kind === 'confetti' || this.kind === 'petals') {
        p.vx += Math.sin(time * 3 + p.seed) * 14 * dt
        p.vy = Math.min(p.vy + 30 * dt, this.kind === 'petals' ? 16 : 34)
      } else if (this.kind === 'snow') {
        p.vx = Math.sin(time * 1.3 + p.seed) * 6
      } else if (p.spark || this.kind === 'stars') {
        p.vy += 38 * dt
        p.vx *= 0.985
      } else if (this.kind === 'balloons' || this.kind === 'hearts' || this.kind === 'bubbles') {
        p.vx = Math.sin(time * 1.6 + p.seed) * (this.kind === 'bubbles' ? 10 : 5)
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    this.parts = this.parts.filter((p) => p.age < p.life)
  }

  spawn() {
    const x = this.x + rnd(-this.w / 2, this.w / 2)
    const seed = Math.random() * 10
    switch (this.kind) {
      case 'confetti':
        this.parts.push({ x, y: this.y - this.h / 2 - rnd(10, 50), vx: rnd(-10, 10), vy: rnd(10, 26), life: rnd(2.2, 3.4), age: 0, c: pick(PARTY), seed })
        break
      case 'snow':
        this.parts.push({ x, y: this.y - this.h / 2 - rnd(0, 40), vx: 0, vy: rnd(12, 22), life: rnd(3, 5), age: 0, c: '#ffffff', seed })
        break
      case 'petals':
        this.parts.push({ x, y: this.y - this.h / 2 - rnd(0, 40), vx: rnd(-6, 6), vy: rnd(6, 12), life: rnd(3, 5), age: 0, c: pick(['#ffb3c8', '#ff8fb8', '#ffd0dc']), seed })
        break
      case 'sparkles':
        this.parts.push({ x, y: this.y + rnd(-this.h / 2, this.h / 2), vx: 0, vy: -4, life: rnd(0.5, 1.1), age: 0, c: pick(['#fff8d8', '#ffd36a', '#ffffff']), seed })
        break
      case 'hearts':
        this.parts.push({ x, y: this.y + rnd(-6, 10), vx: 0, vy: rnd(-26, -16), life: rnd(1.6, 2.4), age: 0, c: '#ff6b8a', seed })
        break
      case 'balloons':
        this.parts.push({ x, y: this.y + this.h / 2, vx: 0, vy: rnd(-26, -18), life: rnd(4, 6), age: 0, c: pick(PARTY.slice(0, 6)), seed })
        break
      case 'bubbles':
        this.parts.push({ x, y: this.y + rnd(0, this.h / 2), vx: 0, vy: rnd(-22, -12), life: rnd(1.6, 3), age: 0, c: '#bfe9ff', seed, r: rnd(2, 4) })
        break
      case 'fireworks':
        this.rockets.push({ x: x + rnd(-10, 10), y: this.y + this.h / 2, vy: rnd(-150, -120), age: 0, fuse: rnd(0.7, 1.0) })
        break
      default:
    }
  }

  draw(ctx) {
    for (const r of this.rockets) {
      ctx.fillStyle = '#fff3b0'
      ctx.fillRect(Math.round(r.x), Math.round(r.y), 1, 3)
      ctx.fillStyle = 'rgba(255,200,120,0.6)'
      ctx.fillRect(Math.round(r.x), Math.round(r.y) + 3, 1, 3)
    }
    for (const p of this.parts) {
      const fade = clamp01(Math.min(1, (p.life - p.age) / 0.5))
      ctx.globalAlpha = fade
      const x = Math.round(p.x)
      const y = Math.round(p.y)
      switch (this.kind) {
        case 'confetti': {
          const flip = Math.sin(p.age * 9 + p.seed) > 0
          ctx.fillStyle = p.c
          ctx.fillRect(x, y, flip ? 2 : 1, flip ? 1 : 2)
          break
        }
        case 'hearts':
          ctx.fillStyle = '#2a1e26'
          ctx.fillRect(x - 3, y - 2, 7, 4)
          ctx.fillRect(x - 2, y + 2, 5, 1)
          ctx.fillStyle = p.c
          ctx.fillRect(x - 2, y - 1, 2, 2)
          ctx.fillRect(x + 1, y - 1, 2, 2)
          ctx.fillRect(x - 2, y + 1, 5, 1)
          ctx.fillRect(x - 1, y + 2, 3, 1)
          break
        case 'balloons':
          ctx.fillStyle = '#2a1e26'
          ctx.fillRect(x - 3, y - 4, 7, 8)
          ctx.fillStyle = p.c
          ctx.fillRect(x - 2, y - 3, 5, 6)
          ctx.fillStyle = 'rgba(255,255,255,0.7)'
          ctx.fillRect(x - 1, y - 2, 1, 2)
          ctx.fillStyle = 'rgba(40,30,40,0.7)'
          ctx.fillRect(x, y + 4, 1, 6)
          break
        case 'bubbles':
          ctx.strokeStyle = p.c
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(x + 0.5, y + 0.5, p.r, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(x - 1, y - 1, 1, 1)
          break
        case 'sparkles':
        case 'stars': {
          const s = Math.abs(Math.sin(p.age * 10 + (p.seed || 0))) > 0.5 ? 2 : 1
          ctx.fillStyle = p.c
          ctx.fillRect(x - s, y, s * 2 + 1, 1)
          ctx.fillRect(x, y - s, 1, s * 2 + 1)
          break
        }
        default:
          ctx.fillStyle = p.c
          ctx.fillRect(x, y, p.spark ? 1 : 2, p.spark ? 1 : 2)
      }
    }
    ctx.globalAlpha = 1
  }
}

export class Effects {
  constructor() {
    this.bursts = []
    this.lights = null // { kind, start, until }
    this.banner = null // { text, sub, start, until }
    this.poofs = []
  }

  spawn(kind, opts, time) {
    if (this.bursts.length > 12) this.bursts.shift()
    this.bursts.push(new Burst(kind, { ...opts, start: time }))
  }

  /** A dust cloud and sparkles: something has just been built (or taken away) here. */
  poof(x, y, w, h, time) {
    this.poofs.push({ x, y, w, h, start: time })
    this.spawn('sparkles', { x, y, w, h, seconds: 1.4 }, time)
  }

  setLights(kind, seconds, time) {
    this.lights = { kind, start: time, until: time + seconds }
  }

  setBanner(text, sub, seconds, time) {
    this.banner = { text, sub, start: time, until: time + seconds }
  }

  update(dt, time) {
    for (const b of this.bursts) b.update(dt, time)
    this.bursts = this.bursts.filter((b) => !b.done)
    this.poofs = this.poofs.filter((p) => time - p.start < 1.2)
    if (this.lights && time > this.lights.until + 1) this.lights = null
    if (this.banner && time > this.banner.until) this.banner = null
  }

  drawWorld(ctx, time) {
    for (const p of this.poofs) {
      const t = (time - p.start) / 1.2
      const n = Math.max(6, Math.round((p.w + p.h) / 10))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const r = (8 + t * 20) * (0.7 + (i % 3) * 0.2)
        const x = p.x + Math.cos(a) * (p.w / 2) * Math.min(1, 0.4 + t) + Math.cos(a) * r * 0.3
        const y = p.y + Math.sin(a) * (p.h / 2) * Math.min(1, 0.4 + t) * 0.8 - t * 6
        const s = Math.round(6 * (1 - t) + 2)
        ctx.globalAlpha = (1 - t) * 0.85
        ctx.fillStyle = i % 2 ? '#e9e2d6' : '#cfc6b8'
        ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s)
      }
      ctx.globalAlpha = 1
    }
    for (const b of this.bursts) b.draw(ctx)
  }

  /** Room-light moments, over the whole view (screen pixels). */
  drawLights(ctx, w, h, time) {
    const l = this.lights
    if (!l) return
    const e = time - l.start
    const out = clamp01((l.until + 1 - time) / 1)
    ctx.save()
    if (l.kind === 'dim') {
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = `rgba(40,36,90,${0.72 * clamp01(e / 0.6) * out})`
      ctx.fillRect(0, 0, w, h)
    } else if (l.kind === 'on') {
      ctx.globalCompositeOperation = 'screen'
      ctx.fillStyle = `rgba(255,240,210,${0.35 * clamp01(1 - e / 1.2)})`
      ctx.fillRect(0, 0, w, h)
    } else if (l.kind === 'flash') {
      const a = Math.max(0, Math.sin(e * 12)) * 0.45 * out
      ctx.globalCompositeOperation = 'screen'
      ctx.fillStyle = `rgba(255,255,255,${a})`
      ctx.fillRect(0, 0, w, h)
    } else if (l.kind === 'party') {
      const hue = (e * 70) % 360
      ctx.globalCompositeOperation = 'soft-light'
      ctx.fillStyle = `hsla(${hue},90%,60%,${0.45 * out})`
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'screen'
      for (let i = 0; i < 4; i++) {
        const cx = w * (0.5 + 0.38 * Math.sin(e * (0.9 + i * 0.3) + i * 1.7))
        const cy = h * (0.5 + 0.3 * Math.cos(e * (0.7 + i * 0.25) + i))
        const r = Math.min(w, h) * 0.22
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r)
        g.addColorStop(0, `hsla(${(hue + i * 90) % 360},100%,70%,${0.32 * out})`)
        g.addColorStop(1, 'hsla(0,0%,0%,0)')
        ctx.fillStyle = g
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
      }
    }
    ctx.restore()
  }

  /** A big caption, like the town's little films use, without taking over the controls. */
  drawBanner(ctx, w, h, dpr, time) {
    const b = this.banner
    if (!b) return
    const e = time - b.start
    const a = clamp01(e / 0.5) * clamp01((b.until - time) / 0.6)
    if (a <= 0) return
    const y = h * 0.3
    const top = y - 40 * dpr
    const bottom = y + (b.sub ? 60 : 32) * dpr
    const band = ctx.createLinearGradient(0, top, 0, bottom)
    band.addColorStop(0, 'rgba(7,5,12,0)')
    band.addColorStop(0.3, `rgba(7,5,12,${0.6 * a})`)
    band.addColorStop(0.75, `rgba(7,5,12,${0.6 * a})`)
    band.addColorStop(1, 'rgba(7,5,12,0)')
    ctx.fillStyle = band
    ctx.fillRect(0, top, w, bottom - top)
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const bounce = Math.max(0, 1 - e * 2.5) * 10 * dpr * Math.abs(Math.sin(e * 12))
    let size = 34 * dpr
    ctx.font = `${Math.round(size)}px KenneyBlocks, KenneyMini, ui-monospace, monospace`
    while (ctx.measureText(b.text).width > w * 0.92 && size > 14 * dpr) {
      size -= 2 * dpr
      ctx.font = `${Math.round(size)}px KenneyBlocks, KenneyMini, ui-monospace, monospace`
    }
    ctx.fillStyle = '#7a4a12'
    ctx.fillText(b.text, w / 2, y + 3 * dpr - bounce)
    ctx.fillStyle = '#ffd36a'
    ctx.fillText(b.text, w / 2, y - bounce)
    if (b.sub) {
      ctx.font = `600 ${Math.round(16 * dpr)}px ui-sans-serif, system-ui, sans-serif`
      ctx.fillStyle = '#fff6dc'
      ctx.fillText(b.sub, w / 2, y + 36 * dpr)
    }
    ctx.globalAlpha = 1
  }
}

// --- Construction sites ----------------------------------------------------------------------------

/** Tape, posts and a little crane around an area being built; a marker while it is planned. */
export function drawSite(ctx, site, time) {
  if (site.status === 'done' || site.status === 'cancelled') return
  const failed = site.status === 'failed'
  if (!site.area) {
    // Planning: a pulsing marker on the spot in front of whoever asked.
    const d = { up: [0, -2], down: [0, 2], left: [-2, 0], right: [2, 0] }[site.dir] || [0, 2]
    const x = (site.x + d[0]) * T + 8
    const y = (site.y + d[1]) * T + 8
    const p = 0.5 + 0.5 * Math.sin(time * 4)
    ctx.globalAlpha = failed ? 0.4 : 0.55 + 0.35 * p
    ctx.strokeStyle = '#ffd36a'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 2])
    ctx.lineDashOffset = -time * 8
    ctx.strokeRect(x - 20.5, y - 14.5, 41, 29)
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    for (let k = 0; k < 6; k++) {
      const a = time * 2 + k
      const sx = Math.round(x + Math.cos(a) * 16)
      const sy = Math.round(y + Math.sin(a * 1.3) * 10)
      ctx.fillStyle = k % 2 ? '#fff8d8' : '#ffd36a'
      ctx.fillRect(sx, sy, 1, 1)
    }
    return
  }
  const [ax, ay, aw, ah] = site.area
  const x0 = ax * T
  const y0 = ay * T
  const w = aw * T
  const h = ah * T
  ctx.globalAlpha = failed ? 0.45 : 1
  // Dusty ground.
  ctx.fillStyle = 'rgba(150,120,80,0.18)'
  ctx.fillRect(x0, y0, w, h)
  // Hazard tape, gently fluttering.
  const tape = (xa, ya, xb, yb) => {
    const len = Math.hypot(xb - xa, yb - ya)
    const n = Math.max(1, Math.floor(len / 4))
    for (let i = 0; i < n; i++) {
      const t = i / n
      const x = xa + (xb - xa) * t
      const y = ya + (yb - ya) * t + Math.sin(time * 3 + i * 0.6) * 0.6
      ctx.fillStyle = (Math.floor(i / 1) % 2) ? '#2a2230' : '#ffd23a'
      ctx.fillRect(Math.round(x), Math.round(y) - 6, 4, 2)
    }
  }
  tape(x0, y0, x0 + w, y0)
  tape(x0, y0 + h, x0 + w, y0 + h)
  tape(x0, y0, x0, y0 + h)
  tape(x0 + w, y0, x0 + w, y0 + h)
  // Cones at the corners.
  for (const [cx, cy] of [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]]) {
    ctx.fillStyle = '#2a2230'
    ctx.fillRect(cx - 3, cy - 9, 6, 9)
    ctx.fillStyle = '#ff8a3a'
    ctx.fillRect(cx - 2, cy - 8, 4, 7)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(cx - 2, cy - 5, 4, 1)
  }
  if (!failed) {
    // A little crane swinging its hook over the site.
    const mx = x0 + w - 10
    const top = y0 - 40
    ctx.fillStyle = '#2a2230'
    ctx.fillRect(mx - 1, top, 4, 40)
    ctx.fillStyle = '#ffc23a'
    ctx.fillRect(mx, top + 1, 2, 38)
    const arm = Math.min(w - 16, 56)
    ctx.fillStyle = '#2a2230'
    ctx.fillRect(mx - arm, top - 1, arm + 6, 4)
    ctx.fillStyle = '#ffc23a'
    ctx.fillRect(mx - arm + 1, top, arm + 4, 2)
    const hx = Math.round(mx - arm * (0.5 + 0.4 * Math.sin(time * 0.8)))
    const drop = 18 + 8 * Math.sin(time * 1.3)
    ctx.fillStyle = '#4a4058'
    ctx.fillRect(hx, top + 3, 1, drop)
    ctx.fillStyle = '#2a2230'
    ctx.fillRect(hx - 3, top + 3 + drop, 7, 5)
    ctx.fillStyle = '#9a8f80'
    ctx.fillRect(hx - 2, top + 4 + drop, 5, 3)
    // Dust puffs and sparkles: work is happening.
    for (let k = 0; k < 5; k++) {
      const t = (time * 0.6 + k / 5) % 1
      const px = x0 + ((k * 37) % Math.max(1, w - 8)) + 4
      const py = y0 + h - 6 - t * 14
      ctx.globalAlpha = (1 - t) * 0.6
      ctx.fillStyle = '#d8cdbd'
      ctx.fillRect(Math.round(px), Math.round(py), 3, 3)
    }
    ctx.globalAlpha = 1
    // Progress: a bar along the bottom tape.
    const pct = Math.max(0.04, Math.min(1, (site.pct || 0) / 100))
    ctx.fillStyle = '#2a2230'
    ctx.fillRect(x0 + 4, y0 + h + 3, w - 8, 4)
    ctx.fillStyle = '#5ee0c1'
    ctx.fillRect(x0 + 5, y0 + h + 4, Math.round((w - 10) * pct), 2)
  }
  ctx.globalAlpha = 1
}

/** The words over a site: who is building what, and how far along. */
export function siteLabel(site, now) {
  if (site.status === 'done' || site.status === 'cancelled') return null
  const who = site.name || 'Someone'
  if (site.status === 'failed') return `${who}'s build stopped`
  const what = site.text.length > 38 ? `${site.text.slice(0, 36)}…` : site.text
  const eta = site.eta ? Math.max(0, Math.round((site.eta - now) / 1000)) : null
  const tail = site.status === 'planning' ? 'planning…' : `${site.label}${eta ? ` · ~${eta < 60 ? `${eta}s` : `${Math.ceil(eta / 60)} min`}` : ''}`
  return `${who} is building “${what}” · ${tail}`
}
