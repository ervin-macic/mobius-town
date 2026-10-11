// Scene drawing. Pixel art is drawn in world pixels under an integer scale;
// text (names, chat, labels) is drawn afterwards in device pixels so it stays crisp.
import { avatarSheet, DIR_ROW, FEET_Y, FRAME_H, FRAME_W, sprite, T, WAVE_COL } from './assets.js'
import { MobiusRenderer } from './mobius.js'
import { cutsceneFocus, drawCutsceneScreen, drawCutsceneWorld } from './cutscenes.js'
import { catSprites, CAT_PET_SECONDS } from './cats.js'
import { beamHidden, drawBeam } from './beam.js'
import { drawSite, siteLabel } from './effects.js'

const NAME_FONT = '600 {px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
const font = (px) => NAME_FONT.replace('{px}', String(Math.round(px)))
const PIXEL_FONT = (px) => `${Math.round(px)}px KenneyMini, ui-monospace, monospace`
const DANCE_DIRS = ['down', 'left', 'up', 'right']
const NOTE_COLOURS = ['#ffd36a', '#5ee0c1', '#ff8fb8', '#a8a2ff']
const SITTING_ROWS = 22 // frame rows kept when seated (head and body; legs tuck behind the chair)

export function feetPx(a) {
  if (a.seat && !a.moving) return { x: a.seat.ax, y: a.seat.ay }
  return { x: Math.round(a.fx * T + T / 2), y: Math.round(a.fy * T + 13) }
}

function drawSprite(ctx, atlas, name, x, y, time) {
  const s = sprite(name)
  if (!s) return
  const frames = s.f
  const i = s.fps ? Math.floor(time * s.fps) % frames.length : 0
  const [sx, sy, w, h] = frames[i]
  ctx.drawImage(atlas, sx, sy, w, h, x, y, w, h)
}

function spriteWidth(name) {
  return sprite(name)?.f[0][2] || 96
}

/** A creation's picture (one of its frames), with its gentle motion. */
function drawPiece(ctx, p, time) {
  const frames = p.frames
  const img = frames.length > 1 && p.fps ? frames[Math.floor(time * p.fps) % frames.length] : frames[0]
  if (!img?.complete || !img.naturalWidth) return
  let x = p.x
  let y = p.y
  if (p.fx === 'sway') x += Math.round(Math.sin(time * 1.6 + p.x * 0.07))
  else if (p.fx === 'bob') y += Math.round(Math.sin(time * 2.2 + p.x * 0.05) * 1.5)
  if (p.fx === 'twinkle') ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 5 + p.x)
  ctx.drawImage(img, x, y)
  ctx.globalAlpha = 1
}

/** Soft lights from lamps, candles and anything a creation lights up. */
function drawGlows(ctx, game) {
  const glows = game.map.glows
  if (!glows?.length) return
  ctx.save()
  // 'screen' brightens towards the light's colour without blowing grass out to lime; by day,
  // outdoors, a lamp only hints at its glow.
  ctx.globalCompositeOperation = 'screen'
  const day = game.map.outdoor ? 0.45 : 1
  for (const gl of glows) {
    const r = gl.radius * T
    const f = (gl.flicker ? 0.75 + 0.15 * Math.sin(game.time * 11 + gl.x) + 0.1 * Math.sin(game.time * 7.3) : 1) * day
    const g = ctx.createRadialGradient(gl.x, gl.y, 1, gl.x, gl.y, r)
    const c = gl.colour.replace('#', '')
    const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',')
    g.addColorStop(0, `rgba(${rgb},${0.34 * f})`)
    g.addColorStop(0.45, `rgba(${rgb},${0.12 * f})`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.fillRect(gl.x - r, gl.y - r, r * 2, r * 2)
  }
  ctx.restore()
}

/** A room's mood: lighter, darker, warmer, cooler, tinted (its whole room, or its area outdoors). */
function drawMoods(ctx, game, mapW, mapH) {
  const moods = game.map.moods
  if (!moods?.length) return
  const me = game.me
  const myRoom = game.map.rooms[game.map.roomIdx?.[me.y * game.map.w + me.x]]?.id
  for (const { mood, rect, room } of moods) {
    if (!rect && room !== myRoom) continue
    const [x, y, w, h] = rect ? [rect[0] * T, rect[1] * T, rect[2] * T, rect[3] * T] : [0, 0, mapW, mapH]
    ctx.save()
    const b = mood.brightness || 0
    const warm = mood.warmth || 0
    if (b > 0) {
      ctx.globalCompositeOperation = 'screen'
      ctx.fillStyle = `rgba(255,248,236,${Math.min(0.5, b * 0.45)})`
      ctx.fillRect(x, y, w, h)
    } else if (b < 0) {
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = `rgba(60,56,110,${Math.min(0.75, -b * 0.7)})`
      ctx.fillRect(x, y, w, h)
    }
    if (warm) {
      ctx.globalCompositeOperation = 'soft-light'
      ctx.fillStyle = warm > 0 ? `rgba(255,170,90,${Math.min(0.6, warm * 0.5)})` : `rgba(110,160,255,${Math.min(0.6, -warm * 0.5)})`
      ctx.fillRect(x, y, w, h)
    }
    if (mood.tint) {
      ctx.globalCompositeOperation = 'soft-light'
      ctx.globalAlpha = 0.35
      ctx.fillStyle = mood.tint
      ctx.fillRect(x, y, w, h)
    }
    ctx.restore()
  }
}

/** The spot the Create panel points at: a soft dashed outline in front of you. */
function drawCreateMarker(ctx, game) {
  const m = game.createMarker
  if (!m || m.mapId !== game.mapId) return
  const p = 0.5 + 0.5 * Math.sin(game.time * 4)
  ctx.save()
  ctx.globalAlpha = 0.5 + 0.4 * p
  ctx.strokeStyle = '#ffd36a'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  ctx.lineDashOffset = -game.time * 8
  ctx.strokeRect(m.x * T + 0.5, m.y * T + 0.5, m.w * T - 1, m.h * T - 1)
  ctx.restore()
}

function avatarFrame(a, time) {
  if (a.dance) {
    const t = time - a.dance.start
    const beat = Math.floor(t * 3.2)
    const dir = DANCE_DIRS[Math.floor(beat / 2) % 4]
    return { col: beat % 2 ? WAVE_COL + (beat % 4 === 1 ? 0 : 1) : (beat % 4), row: DIR_ROW[dir], bob: Math.abs(Math.sin(t * Math.PI * 3.2)) * 2.5 }
  }
  if (a.emote?.kind === 'wave') {
    const t = time - a.emote.start
    return { col: WAVE_COL + (Math.floor(t * 5) % 2), row: DIR_ROW.down, bob: 0 }
  }
  const row = DIR_ROW[a.dir] ?? 0
  if (!a.moving) return { col: 0, row, bob: 0 }
  return { col: Math.floor(a.walkT * 9) % 4, row, bob: 0 }
}

function drawAvatar(ctx, game, a) {
  const { x, y } = feetPx(a)
  const sheet = avatarSheet(game.images.characters, a.look)
  if (a.speaking > 0.04) {
    ctx.save()
    ctx.globalAlpha = Math.min(0.85, 0.25 + a.speaking * 1.4)
    ctx.fillStyle = '#5cf08c'
    ctx.beginPath()
    ctx.ellipse(x, y, 8, 3.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  const { col, row, bob } = avatarFrame(a, game.time)
  const seated = a.seat && !a.moving && !a.dance
  const rows = seated ? SITTING_ROWS : FRAME_H
  const dy = seated ? 3 : 0
  ctx.drawImage(sheet, col * FRAME_W, row * FRAME_H, FRAME_W, rows, x - 8, y - FEET_Y + dy - Math.round(bob), FRAME_W, rows)
  if (a.dance) drawNotes(ctx, game, a, x, y)
  if (a.emote?.kind === 'heart') drawHearts(ctx, game, a, x, y)
}

/** Little pixel music notes drifting up around a dancer. */
function drawNotes(ctx, game, a, x, y) {
  const t = game.time - a.dance.start
  for (let k = 0; k < 4; k++) {
    const p = (t * 0.55 + k * 0.25) % 1
    const nx = Math.round(x + Math.sin(p * 6.2 + k * 1.7) * 11 + (k % 2 ? 4 : -4))
    const ny = Math.round(y - 26 - p * 22)
    ctx.globalAlpha = Math.max(0, 1 - p * p)
    ctx.fillStyle = '#231a33'
    ctx.fillRect(nx - 1, ny + 3, 4, 4)
    ctx.fillRect(nx + 2, ny - 3, 2, 7)
    ctx.fillStyle = NOTE_COLOURS[k % NOTE_COLOURS.length]
    ctx.fillRect(nx, ny + 4, 2, 2)
    ctx.fillRect(nx + 2, ny - 2, 1, 6)
    if (k % 2) ctx.fillRect(nx + 3, ny - 2, 2, 1)
  }
  ctx.globalAlpha = 1
}

/** Spinning pixel hearts floating up (the pack's own heart pickup animation). */
function drawHearts(ctx, game, a, x, y) {
  const t = game.time - a.emote.start
  for (let k = 0; k < 3; k++) {
    const p = (t * 0.75 - k * 0.22)
    if (p < 0 || p > 1) continue
    const hx = Math.round(x - 6 + (k - 1) * 8 + Math.sin(p * 9 + k) * 2)
    const hy = Math.round(y - 30 - p * 22)
    ctx.globalAlpha = 1 - p * p
    drawSprite(ctx, game.images.atlas, 'heart_spin', hx, hy, game.time + k * 0.1)
  }
  ctx.globalAlpha = 1
}

function drawCat(ctx, game, c) {
  const x = Math.round(c.x)
  const y = Math.round(c.y)
  ctx.fillStyle = 'rgba(24,18,40,0.28)'
  ctx.beginPath()
  ctx.ellipse(x, y + 1, 6, 2.2, 0, 0, Math.PI * 2)
  ctx.fill()
  const sheet = catSprites()[c.coat]
  const img = sheet?.[c.frame] || sheet?.sit
  if (img) ctx.drawImage(img, x - 8, y - 15)
  if (c.pose === 'sleep') {
    // A few tiny z's drifting up from a napping cat.
    for (let k = 0; k < 3; k++) {
      const p = (game.time * 0.35 + k / 3) % 1
      ctx.globalAlpha = Math.max(0, 1 - p) * 0.9
      ctx.fillStyle = '#fff6dc'
      const zx = Math.round(x + 4 + p * 6 + k)
      const zy = Math.round(y - 12 - p * 12)
      ctx.fillRect(zx, zy, 3, 1)
      ctx.fillRect(zx + 1, zy + 1, 1, 1)
      ctx.fillRect(zx, zy + 2, 3, 1)
    }
    ctx.globalAlpha = 1
  }
  if (c.petAt != null) {
    const t = game.time - c.petAt
    if (t < CAT_PET_SECONDS) {
      // Small pixel hearts rising off the cat (half the size of a person's heart emote).
      for (let k = 0; k < 3; k++) {
        const p = t * 0.8 - k * 0.24
        if (p < 0 || p > 1) continue
        ctx.globalAlpha = 1 - p * p
        const hx = Math.round(x + (k - 1) * 7 + Math.sin(p * 9 + k) * 2)
        const hy = Math.round(y - 14 - p * 12)
        ctx.fillStyle = '#2a1e26'
        ctx.fillRect(hx - 3, hy - 2, 7, 4)
        ctx.fillRect(hx - 2, hy + 2, 5, 1)
        ctx.fillRect(hx - 1, hy + 3, 3, 1)
        ctx.fillStyle = '#ff6b8a'
        ctx.fillRect(hx - 2, hy - 1, 2, 2)
        ctx.fillRect(hx + 1, hy - 1, 2, 2)
        ctx.fillRect(hx - 2, hy + 1, 5, 1)
        ctx.fillRect(hx - 1, hy + 2, 3, 1)
        ctx.fillStyle = '#ffd0dc'
        ctx.fillRect(hx - 2, hy - 1, 1, 1)
      }
      ctx.globalAlpha = 1
    }
  }
}

const TEAM_COLOUR = { red: '#ff5a5a', blue: '#4d8dff' }

function drawFootballer(ctx, game, p) {
  const sheet = avatarSheet(game.images.characters, p.look)
  const speed = Math.hypot(p.vx, p.vy)
  const angle = speed > 6 ? Math.atan2(p.vy, p.vx) : p.facing
  const c = Math.cos(angle), sn = Math.sin(angle)
  const dir = Math.abs(c) > Math.abs(sn) ? (c > 0 ? 'right' : 'left') : (sn > 0 ? 'down' : 'up')
  const col = speed > 6 ? Math.floor(game.time * 11) % 4 : 0
  const x = Math.round(p.x), y = Math.round(p.y)
  // A team-coloured ring at the feet; brighter and thicker for you.
  ctx.save()
  ctx.globalAlpha = p.me ? 0.95 : 0.7
  ctx.strokeStyle = TEAM_COLOUR[p.team]
  ctx.lineWidth = p.me ? 2 : 1.4
  ctx.beginPath()
  ctx.ellipse(x, y + 2, 7, 3, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  ctx.drawImage(sheet, col * FRAME_W, (DIR_ROW[dir] ?? 0) * FRAME_H, FRAME_W, FRAME_H, x - 8, y + 3 - FEET_Y, FRAME_W, FRAME_H)
}

function drawBall(ctx, game, b) {
  const x = Math.round(b.x), y = Math.round(b.y)
  ctx.fillStyle = 'rgba(20,28,20,0.35)'
  ctx.beginPath()
  ctx.ellipse(x + 1, y + 3, 4, 1.8, 0, 0, Math.PI * 2)
  ctx.fill()
  // A 7 px pixel ball; its patch turns as it rolls.
  ctx.fillStyle = '#1e1a24'
  ctx.fillRect(x - 2, y - 4, 5, 1)
  ctx.fillRect(x - 3, y - 3, 7, 5)
  ctx.fillRect(x - 2, y + 2, 5, 1)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x - 2, y - 3, 5, 5)
  ctx.fillRect(x - 3, y - 2, 7, 3)
  const roll = Math.floor((b.x + b.y) / 4) % 3
  ctx.fillStyle = '#2a2632'
  ctx.fillRect(x - 1 + roll - 1, y - 1, 2, 2)
  ctx.fillStyle = '#c8d0d8'
  ctx.fillRect(x - 2, y + 1, 5, 1)
}

const COURT_TEAM = ['#ff5a5a', '#4d8dff', '#2fb5b0', '#f0c43a']

/** One thing a court game asked to draw, in world pixels (relative to the court's corner). */
function drawCourtItem(ctx, game, cv, it) {
  const ox = cv.ox
  const oy = cv.oy
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d)
  ctx.globalAlpha = Math.max(0, Math.min(1, num(it.alpha, 1)))
  drawCourtShape(ctx, game, cv, it, ox, oy, num)
  ctx.globalAlpha = 1
}

function drawCourtShape(ctx, game, cv, it, ox, oy, num) {
  switch (it.t) {
    case 'player': {
      const p = cv.players[it.slot]
      if (!p) return
      const x = Math.round(ox + num(it.x))
      const y = Math.round(oy + num(it.y))
      const z = Math.max(0, Math.round(num(it.z)))
      ctx.fillStyle = `rgba(24,18,40,${Math.max(0.12, 0.3 - z / 120)})`
      ctx.beginPath()
      ctx.ellipse(x, y + 2, Math.max(3, 6 - z / 10), 2.2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.save()
      ctx.globalAlpha = p.me ? 0.95 : 0.7
      ctx.strokeStyle = COURT_TEAM[p.team] || '#ffffff'
      ctx.lineWidth = p.me ? 2 : 1.4
      ctx.beginPath()
      ctx.ellipse(x, y + 2, 7, 3, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      const sheet = avatarSheet(game.images.characters, p.look)
      const row = DIR_ROW[it.dir] ?? 0
      let col = 0
      if (it.pose === 'jump' || it.pose === 'reach') col = WAVE_COL + (it.pose === 'reach' ? 1 : 0)
      else if (it.moving || it.pose === 'run') col = Math.floor(game.time * 9) % 4
      ctx.drawImage(sheet, col * FRAME_W, (it.pose === 'jump' || it.pose === 'reach' ? DIR_ROW.down : row) * FRAME_H,
        FRAME_W, FRAME_H, x - 8, y + 3 - z - FEET_Y, FRAME_W, FRAME_H)
      break
    }
    case 'ball': {
      const x = ox + num(it.x)
      const y = oy + num(it.y)
      const z = Math.max(0, num(it.z))
      const r = Math.max(1, Math.min(8, num(it.r, 3)))
      ctx.fillStyle = `rgba(20,24,20,${Math.max(0.12, 0.35 - z / 160)})`
      ctx.beginPath()
      ctx.ellipse(Math.round(x), Math.round(y) + 2, r + 1 + z / 30, 1.6 + z / 60, 0, 0, Math.PI * 2)
      ctx.fill()
      const bx = Math.round(x)
      const by = Math.round(y - z)
      ctx.fillStyle = '#1e1a24'
      ctx.beginPath()
      ctx.arc(bx, by, r + 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = typeof it.colour === 'string' ? it.colour : '#ffffff'
      ctx.beginPath()
      ctx.arc(bx, by, r, 0, Math.PI * 2)
      ctx.fill()
      if (typeof it.stripe === 'string') {
        ctx.fillStyle = it.stripe
        ctx.fillRect(bx - r + 1, by - 1, r * 2 - 1, 1)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.fillRect(bx - Math.ceil(r / 2), by - Math.ceil(r / 2), 1, 1)
      break
    }
    case 'shadow':
      ctx.fillStyle = 'rgba(24,18,40,0.28)'
      ctx.beginPath()
      ctx.ellipse(Math.round(ox + num(it.x)), Math.round(oy + num(it.y)), Math.max(1, num(it.rx, 4)), Math.max(1, num(it.ry, 2)), 0, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'rect':
      ctx.fillStyle = typeof it.colour === 'string' ? it.colour : '#ffffff'
      ctx.fillRect(Math.round(ox + num(it.x)), Math.round(oy + num(it.y)), Math.round(num(it.w)), Math.round(num(it.h)))
      break
    case 'line':
      ctx.strokeStyle = typeof it.colour === 'string' ? it.colour : '#ffffff'
      ctx.lineWidth = Math.max(1, Math.min(4, num(it.width, 1)))
      ctx.beginPath()
      ctx.moveTo(ox + num(it.x1) + 0.5, oy + num(it.y1) + 0.5)
      ctx.lineTo(ox + num(it.x2) + 0.5, oy + num(it.y2) + 0.5)
      ctx.stroke()
      break
    case 'circle':
      ctx.beginPath()
      ctx.arc(ox + num(it.x), oy + num(it.y), Math.max(1, Math.min(64, num(it.r, 4))), 0, Math.PI * 2)
      if (it.fill === false) {
        ctx.strokeStyle = typeof it.colour === 'string' ? it.colour : '#ffffff'
        ctx.lineWidth = 1
        ctx.stroke()
      } else {
        ctx.fillStyle = typeof it.colour === 'string' ? it.colour : '#ffffff'
        ctx.fill()
      }
      break
    default:
  }
}

function drawBubbles(ctx, game, avatars) {
  const groups = new Map()
  for (const a of avatars) {
    if (!a.bubbleId) continue
    if (!groups.has(a.bubbleId)) groups.set(a.bubbleId, [])
    groups.get(a.bubbleId).push(a)
  }
  if (!groups.size) return
  const layer = game.bubbleLayer || (game.bubbleLayer = document.createElement('canvas'))
  const map = game.map
  if (layer.width !== map.w * T || layer.height !== map.h * T) {
    layer.width = map.w * T
    layer.height = map.h * T
  }
  for (const [, members] of groups) {
    const lctx = layer.getContext('2d')
    lctx.clearRect(0, 0, layer.width, layer.height)
    const pts = members.map(feetPx)
    // Outline pass, then fill pass: overlapping circles merge into one bubble.
    for (const [r, colour] of [[23, '#ffffff'], [21, '#8fd3ff']]) {
      lctx.fillStyle = colour
      for (const p of pts) {
        lctx.beginPath()
        lctx.ellipse(p.x, p.y - 6, r, r * 0.8, 0, 0, Math.PI * 2)
        lctx.fill()
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j]
          if (Math.hypot(a.x - b.x, a.y - b.y) > 5 * T) continue
          lctx.lineWidth = r * 1.6
          lctx.lineCap = 'round'
          lctx.strokeStyle = colour
          lctx.beginPath()
          lctx.moveTo(a.x, a.y - 6)
          lctx.lineTo(b.x, b.y - 6)
          lctx.stroke()
        }
      }
    }
    ctx.save()
    ctx.globalAlpha = 0.3 + 0.05 * Math.sin(game.time * 2.4)
    ctx.drawImage(layer, 0, 0)
    ctx.restore()
  }
}

function drawSpotlights(ctx, game, avatars) {
  for (const o of game.map.objects) {
    if (o.kind !== 'spotlight') continue
    const occupied = avatars.some((a) => o.tiles.some(([x, y]) => a.x === x && a.y === y))
    const xs = o.tiles.map((t) => t[0]), ys = o.tiles.map((t) => t[1])
    const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * T
    const cy = ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * T
    const pulse = occupied ? 0.55 + 0.15 * Math.sin(game.time * 3) : 0.12
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34)
    g.addColorStop(0, `rgba(255,246,200,${pulse})`)
    g.addColorStop(1, 'rgba(255,246,200,0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - 40, cy - 40, 80, 80)
  }
}

function drawTv(ctx, game) {
  const tv = game.map.objects.find((o) => o.kind === 'tv')
  if (!tv) return
  const [x, y, w, h] = tv.screen
  const img = game.tvImage
  if (img) {
    const pix = game.tvPixels || (game.tvPixels = document.createElement('canvas'))
    if (pix.width !== w || pix.height !== h || pix.source !== img) {
      pix.width = w
      pix.height = h
      const pctx = pix.getContext('2d')
      pctx.imageSmoothingEnabled = true
      const ratio = Math.max(w / img.width, h / img.height)
      const dw = img.width * ratio, dh = img.height * ratio
      pctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
      pix.source = img
    }
    ctx.drawImage(pix, x, y)
    ctx.fillStyle = `rgba(255,255,255,${0.04 + 0.03 * Math.sin(game.time * 7)})`
    for (let yy = y; yy < y + h; yy += 2) ctx.fillRect(x, yy, w, 1)
  } else {
    ctx.fillStyle = `rgba(120,150,255,${0.06 + 0.04 * Math.sin(game.time * 2)})`
    ctx.fillRect(x, y, w, h)
  }
}

/** Animated flames with a flickering warm light (fireplaces and torches). */
function drawFire(ctx, game, f) {
  {
    const t = game.time + (f.px % 7)
    const flicker = 0.5 + 0.25 * Math.sin(t * 13) + 0.15 * Math.sin(t * 7.3) + 0.1 * Math.sin(t * 23.1)
    const r = f.small ? 22 : 34
    const cx = f.px
    const cy = f.py - 8
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r)
    g.addColorStop(0, `rgba(255,170,70,${0.32 * flicker})`)
    g.addColorStop(0.5, `rgba(255,120,40,${0.14 * flicker})`)
    g.addColorStop(1, 'rgba(255,90,30,0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.restore()
    const s = sprite('fire')
    if (!s) return
    const i = Math.floor(t * (s.fps || 10)) % s.f.length
    const [sx, sy, w, h] = s.f[i]
    if (f.small) ctx.drawImage(game.images.atlas, sx, sy, w, h, f.px - 6, f.py - 13, 12, 13)
    else ctx.drawImage(game.images.atlas, sx, sy, w, h, f.px - 8, f.py - h, w, h)
  }
}

/** Meeting-room doors: a wooden door slides down and bolts shut when the room locks. */
function drawDoor(ctx, game, d) {
  {
    const t = game.doorAnim[d.id]?.t || 0
    if (t <= 0.01) return
    const x = d.x * T + 1
    const top = d.y * T - 10
    const full = T + 10
    const h = Math.round(full * t)
    // Frame and planks.
    ctx.fillStyle = '#2b1d24'
    ctx.fillRect(x, top, T - 2, h)
    ctx.fillStyle = '#8a5a3a'
    ctx.fillRect(x + 1, top, T - 4, Math.max(0, h - 1))
    ctx.fillStyle = '#a8724a'
    for (let px = x + 2; px < x + T - 3; px += 4) ctx.fillRect(px, top, 2, Math.max(0, h - 2))
    ctx.fillStyle = '#5e3a28'
    if (h > 8) ctx.fillRect(x + 1, top + Math.round(h * 0.33), T - 4, 1)
    if (h > 14) ctx.fillRect(x + 1, top + Math.round(h * 0.7), T - 4, 1)
    if (t >= 1) {
      // Brass lock plate with a keyhole and a little glint right after it locks.
      const lx = x + T / 2 - 4
      const ly = top + Math.round(full * 0.5) - 3
      ctx.fillStyle = '#2b1d24'
      ctx.fillRect(lx - 1, ly - 3, 8, 10)
      ctx.fillStyle = '#e8b640'
      ctx.fillRect(lx, ly, 6, 6)
      ctx.fillRect(lx + 1, ly - 2, 1, 2)
      ctx.fillRect(lx + 4, ly - 2, 1, 2)
      ctx.fillRect(lx + 1, ly - 3, 4, 1)
      ctx.fillStyle = '#3a2410'
      ctx.fillRect(lx + 2, ly + 2, 2, 3)
      const since = game.time - (game.doorAnim[d.id].lockedAt || 0)
      if (since < 0.6) {
        ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - since / 0.6)})`
        ctx.fillRect(lx + 4, ly + 1, 1, 1)
        ctx.fillRect(lx + 3, ly, 3, 3)
      }
    }
  }
}

/** The Möbius strip floating above its pedestal, with a soft glow. */
function drawMobius(ctx, game, m) {
  const r = game.mobiusRenderer || (game.mobiusRenderer = new MobiusRenderer(m.size))
  const boost = game.cutscene?.kind === 'mobius' ? 3 : 1
  const canvas = r.draw(game.time, boost)
  const bob = Math.round(Math.sin(game.time * 1.3) * 2)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(m.cx, m.cy, 4, m.cx, m.cy, m.size * 0.6)
  g.addColorStop(0, `rgba(120,230,220,${0.16 + 0.05 * Math.sin(game.time * 2)})`)
  g.addColorStop(1, 'rgba(120,230,220,0)')
  ctx.fillStyle = g
  ctx.fillRect(m.cx - m.size, m.cy - m.size, m.size * 2, m.size * 2)
  ctx.restore()
  ctx.drawImage(canvas, Math.round(m.cx - canvas.width / 2), Math.round(m.cy - canvas.height / 2) + bob)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 4)
}

/** The auditorium's event board: shows a live lightning talk and its countdown. */
function drawStageBoard(ctx, game, toScreen, dpr) {
  const board = game.map.board
  const info = game.stageBoard
  if (!board || !info) return
  const p = toScreen(board.px, board.py)
  ctx.font = PIXEL_FONT(15 * dpr)
  const title = info.title || 'Lightning talks'
  const line2 = info.line || ''
  const w = Math.max(ctx.measureText(title).width, ctx.measureText(line2).width + 30 * dpr) + 28 * dpr
  const h = (line2 ? 50 : 30) * dpr
  ctx.fillStyle = '#1b1426'
  roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, 6 * dpr)
  ctx.fill()
  ctx.strokeStyle = '#ffd36a'
  ctx.lineWidth = 2 * dpr
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffd36a'
  ctx.fillText(title, p.x, p.y - (line2 ? 11 : 0) * dpr)
  if (line2) {
    ctx.font = font(12.5 * dpr)
    ctx.fillStyle = info.warn ? '#ff8a8a' : '#ffffff'
    ctx.fillText(line2, p.x, p.y + 11 * dpr)
  }
}

function drawLabels(ctx, game, s, dpr, avatars, cam) {
  const toScreen = (wx, wy) => ({ x: wx * s - cam.x, y: wy * s - cam.y })
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const label of game.map.labels || []) {
    if (!label.text) continue
    const p = toScreen(label.x, label.y)
    ctx.font = font(11 * dpr)
    const w = ctx.measureText(label.text).width + 12 * dpr
    ctx.fillStyle = 'rgba(20,16,32,0.55)'
    roundRect(ctx, p.x - w / 2, p.y - 9 * dpr, w, 18 * dpr, 9 * dpr)
    ctx.fill()
    ctx.fillStyle = '#fff6dc'
    ctx.fillText(label.text, p.x, p.y + 0.5 * dpr)
  }
  drawStageBoard(ctx, game, toScreen, dpr)
  const now = game.serverNow()
  for (const site of game.sites || []) {
    const text = siteLabel(site, now)
    if (!text) continue
    const [ax, ay, aw] = site.area || [site.x - 1, site.y - 1, 3]
    const p = toScreen((ax + aw / 2) * T, ay * T - (site.area ? 52 : 26))
    ctx.font = font(11 * dpr)
    const tw = ctx.measureText(text).width + 16 * dpr
    ctx.fillStyle = site.status === 'failed' ? 'rgba(90,40,48,0.85)' : 'rgba(42,34,20,0.88)'
    roundRect(ctx, p.x - tw / 2, p.y - 10 * dpr, tw, 20 * dpr, 10 * dpr)
    ctx.fill()
    ctx.strokeStyle = '#ffd36a'
    ctx.lineWidth = 1.2 * dpr
    ctx.stroke()
    ctx.fillStyle = '#fff3c4'
    ctx.fillText(text, p.x, p.y + 0.5 * dpr)
  }
  if (game.cutscene) return
  // Cat names, only for cats close to you (or being petted), small and quiet.
  const me = feetPx(game.me)
  for (const c of game.cats || []) {
    const near = Math.hypot(c.x - me.x, c.y - me.y) < T * 3.2
    if (!near && c.petAt == null) continue
    const p = toScreen(c.x, c.y + 7)
    ctx.font = font(10 * dpr)
    const tw = ctx.measureText(c.name).width + 10 * dpr
    ctx.fillStyle = 'rgba(22,18,34,0.62)'
    roundRect(ctx, p.x - tw / 2, p.y - 7 * dpr, tw, 14 * dpr, 7 * dpr)
    ctx.fill()
    ctx.fillStyle = '#ffe9b8'
    ctx.fillText(c.name, p.x, p.y + 0.5 * dpr)
  }
  if (game.footballView) {
    for (const p of game.footballView.players) {
      const head = toScreen(p.x, p.y - 21)
      ctx.font = font(10.5 * dpr)
      const tw = ctx.measureText(p.name).width + 10 * dpr
      ctx.fillStyle = p.team === 'red' ? 'rgba(170,40,48,0.9)' : 'rgba(40,80,170,0.9)'
      roundRect(ctx, head.x - tw / 2, head.y - 7.5 * dpr, tw, 15 * dpr, 7.5 * dpr)
      ctx.fill()
      if (p.me) {
        ctx.strokeStyle = '#ffd36a'
        ctx.lineWidth = 1.5 * dpr
        ctx.stroke()
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillText(p.name, head.x, head.y + 0.5 * dpr)
    }
  }
  const cv = game.courtView
  if (cv) {
    for (const it of cv.items) {
      if (it.t === 'player') {
        const p = cv.players[it.slot]
        if (!p) continue
        const head = toScreen(cv.ox + (it.x || 0), cv.oy + (it.y || 0) - (it.z || 0) - 21)
        ctx.font = font(10.5 * dpr)
        const tw = ctx.measureText(p.name).width + 10 * dpr
        const team = ['rgba(170,40,48,0.9)', 'rgba(40,80,170,0.9)', 'rgba(30,120,116,0.9)', 'rgba(150,120,30,0.9)'][p.team] || 'rgba(22,18,34,0.8)'
        ctx.fillStyle = team
        roundRect(ctx, head.x - tw / 2, head.y - 7.5 * dpr, tw, 15 * dpr, 7.5 * dpr)
        ctx.fill()
        if (p.me) {
          ctx.strokeStyle = '#ffd36a'
          ctx.lineWidth = 1.5 * dpr
          ctx.stroke()
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillText(p.name, head.x, head.y + 0.5 * dpr)
      } else if (it.t === 'text' && typeof it.text === 'string') {
        const p = toScreen(cv.ox + (it.x || 0), cv.oy + (it.y || 0))
        ctx.font = PIXEL_FONT(Math.max(8, Math.min(24, it.size || 10)) * 1.3 * dpr)
        ctx.fillStyle = 'rgba(20,16,32,0.75)'
        ctx.fillText(it.text.slice(0, 40), p.x + 1.5 * dpr, p.y + 1.5 * dpr)
        ctx.fillStyle = typeof it.colour === 'string' ? it.colour : '#ffffff'
        ctx.fillText(it.text.slice(0, 40), p.x, p.y)
      }
    }
  }
  const sorted = [...avatars].sort((a, b) => a.fy - b.fy)
  for (const a of sorted) {
    const feet = feetPx(a)
    const head = toScreen(feet.x, feet.y - 22 + (a.seat && !a.moving ? 3 : 0))
    const isMe = a === game.me
    ctx.font = font(11.5 * dpr)
    const name = a.name
    const tw = ctx.measureText(name).width
    const padX = 6 * dpr
    // "Can't hear you" only means something where this town can make calls at all.
    const muted = a.muted && game.callsAvailable
    // Office agents carry a coloured pill with a status dot (engine/office.js PILLS).
    const dot = a.pill?.dot ? 10 * dpr : 0
    const pillW = tw + padX * 2 + (muted ? 12 * dpr : 0) + dot
    const pillH = 17 * dpr
    const py = head.y - 6 * dpr
    ctx.fillStyle = isMe ? 'rgba(46,118,255,0.88)' : a.pill?.bg || 'rgba(22,18,34,0.72)'
    roundRect(ctx, head.x - pillW / 2, py - pillH / 2, pillW, pillH, pillH / 2)
    ctx.fill()
    if (dot) {
      ctx.fillStyle = a.pill.dot
      ctx.beginPath()
      ctx.arc(head.x - pillW / 2 + padX + 3 * dpr, py, 3.2 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
    if (a.speaking > 0.04) {
      ctx.strokeStyle = '#5cf08c'
      ctx.lineWidth = 2 * dpr
      ctx.stroke()
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillText(name, head.x - (muted ? 6 * dpr : 0) + dot / 2, py + 0.5 * dpr)
    if (muted) {
      const mx = head.x + pillW / 2 - 9 * dpr
      ctx.strokeStyle = '#ff8a8a'
      ctx.lineWidth = 1.6 * dpr
      ctx.beginPath()
      ctx.moveTo(mx - 3 * dpr, py - 4 * dpr)
      ctx.lineTo(mx + 3 * dpr, py + 4 * dpr)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(mx, py - 1 * dpr, 2.2 * dpr, 0, Math.PI * 2)
      ctx.stroke()
    }
    let top = py - pillH / 2 - 4 * dpr
    if (a.emote && a.emote.kind !== 'wave' && a.emote.kind !== 'heart') {
      const icon = { excl: 'bubble_excl', q: 'bubble_q', dots: 'bubble_dots', talk: 'bubble_talk' }[a.emote.kind]
      const sp = icon && sprite(icon)
      if (sp) {
        const [sx, sy, w, h] = sp.f[0]
        const k = s * 0.9
        const bob = Math.sin((game.time - a.emote.start) * 8) * 2 * dpr
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(game.images.atlas, sx, sy, w, h, head.x - (w * k) / 2, top - h * k + bob, w * k, h * k)
        top -= h * k + 4 * dpr
      }
    }
    if (a.chat) {
      ctx.font = font(12.5 * dpr)
      const lines = wrap(ctx, a.chat.text, 180 * dpr)
      const lh = 16 * dpr
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16 * dpr
      const bh = lines.length * lh + 10 * dpr
      const bx = head.x - bw / 2
      const by = top - bh - 6 * dpr
      ctx.fillStyle = 'rgba(255,255,255,0.96)'
      roundRect(ctx, bx, by, bw, bh, 9 * dpr)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(head.x - 5 * dpr, by + bh - 1)
      ctx.lineTo(head.x + 5 * dpr, by + bh - 1)
      ctx.lineTo(head.x, by + bh + 6 * dpr)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#1d1a2a'
      lines.forEach((l, i) => ctx.fillText(l, head.x, by + 5 * dpr + lh / 2 + i * lh))
    }
  }
}

// Zoomed between whole-number scales, the world is drawn crisp at the next whole scale into
// this buffer and then scaled to the screen smoothly: no shimmering pixels, barely any blur.
let buffer = null

function worldBuffer(width, height) {
  buffer ||= document.createElement('canvas')
  if (buffer.width !== width || buffer.height !== height) {
    buffer.width = width
    buffer.height = height
  }
  return buffer
}

export function drawScene(game, ctx, w, h) {
  const dpr = window.devicePixelRatio || 1
  const s = game.scale()
  const n = Math.max(1, Math.ceil(s - 1e-6))
  const direct = n === s
  const map = game.map
  const ground = game.images.grounds[game.mapId]
  const me = game.me
  // The view in world pixels: centred on the focus, kept inside the map, and eased in world
  // space so that zooming keeps your character where it is on screen.
  const vw = w / s
  const vh = h / s
  const mapW = map.w * T
  const mapH = map.h * T
  const feet = game.matchFit ? { x: game.matchFit.cx, y: game.matchFit.cy + 8 } : feetPx(me)
  const focus = cutsceneFocus(game, feet)
  const tx = mapW <= vw ? mapW / 2 : Math.max(vw / 2, Math.min(mapW - vw / 2, focus.x))
  const ty = mapH <= vh ? mapH / 2 : Math.max(vh / 2, Math.min(mapH - vh / 2, focus.y - 8))
  const view = game.view
  const glide = game.camGlide
  if (glide) {
    // A teleport across this map: ease from where the view was to where you land.
    const k = Math.min(1, (game.time - glide.start) / glide.duration)
    const e = k < 0.5 ? 4 * k * k * k : 1 - (2 - 2 * k) ** 3 / 2
    view.x = glide.x + (tx - glide.x) * e
    view.y = glide.y + (ty - glide.y) * e
    if (k >= 1) game.camGlide = null
  } else if (game.snapCamera || !Number.isFinite(view.x)) {
    view.x = tx
    view.y = ty
    game.snapCamera = false
  } else {
    const k = game.cutscene ? 0.08 : 0.2
    view.x += (tx - view.x) * k
    view.y += (ty - view.y) * k
  }
  // Snap to whole pixels of the crisp drawing so sprites never shimmer.
  const ox = Math.round((view.x - vw / 2) * n)
  const oy = Math.round((view.y - vh / 2) * n)
  const cam = { x: (ox * s) / n, y: (oy * s) / n }
  game.camera = cam

  const background = map.outdoor ? '#1c3a24' : '#16121f'
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, w, h)
  const g = direct ? ctx : worldBuffer(Math.ceil((w * n) / s), Math.ceil((h * n) / s)).getContext('2d')
  if (!direct) {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = background
    g.fillRect(0, 0, buffer.width, buffer.height)
  }
  g.imageSmoothingEnabled = false
  g.setTransform(n, 0, 0, n, -ox, -oy)
  if (ground) g.drawImage(ground, 0, 0)
  for (const u of map.underlay || []) {
    if (u.frames) drawPiece(g, u, game.time)
    else if (u.img.complete && u.img.naturalWidth) g.drawImage(u.img, u.x, u.y)
  }
  const cv = game.courtView
  if (cv) for (const it of cv.items) if (it.layer === 'ground' && it.t !== 'text') drawCourtItem(g, game, cv, it)

  // Footballers in a match are drawn by the match, so their town avatars step aside; so does
  // anyone a teleport effect is drawing (or who is between its two beams).
  const hidden = game.hiddenAvatars
  const avatars = hidden?.has(me.id) || beamHidden(game, me) ? [] : [me]
  for (const a of game.others.values()) {
    if (a.mapId === game.mapId && !hidden?.has(a.id) && !beamHidden(game, a)) avatars.push(a)
  }
  // The Agent Office's crew (engine/office.js) are drawn like people.
  for (const a of game.npcs || []) if (a.mapId === game.mapId) avatars.push(a)

  drawTv(g, game)
  drawSpotlights(g, game, avatars)
  drawBubbles(g, game, avatars)

  // Depth-sorted props, avatars and the monument, culled to the view.
  const viewL = ox / n - 32, viewR = ox / n + vw + 32
  const viewT = oy / n - 96, viewB = oy / n + vh + 160
  const actors = avatars.map((a) => ({ z: feetPx(a).y + 0.5, draw: () => drawAvatar(g, game, a) }))
  for (const c of game.cats || []) actors.push({ z: c.y + 0.4, draw: () => drawCat(g, game, c) })
  const fb = game.footballView
  if (fb) {
    for (const p of fb.players) actors.push({ z: p.y + 3, draw: () => drawFootballer(g, game, p) })
    actors.push({ z: fb.ball.y + 0.2, draw: () => drawBall(g, game, fb.ball) })
  }
  for (const e of game.effects) {
    if (e.mapId === game.mapId && e.kind?.startsWith('beam')) actors.push({ z: e.y + 0.6, draw: () => drawBeam(g, game, e) })
  }
  if (cv) {
    for (const it of cv.items) {
      if (it.layer === 'ground' || it.t === 'text') continue
      const y = Number.isFinite(it.y) ? it.y : Number.isFinite(it.y2) ? Math.max(it.y1, it.y2) : 0
      actors.push({ z: cv.oy + y + (it.t === 'player' ? 3 : 0.3), draw: () => drawCourtItem(g, game, cv, it) })
    }
  }
  if (map.mobius) actors.push({ z: map.mobius.z, draw: () => drawMobius(g, game, map.mobius) })
  for (const f of map.fires || []) actors.push({ z: f.z, draw: () => drawFire(g, game, f) })
  for (const d of map.roomDoors || []) actors.push({ z: (d.y + 1) * T - 1, draw: () => drawDoor(g, game, d) })
  actors.sort((p, q) => p.z - q.z)
  let ai = 0
  const atlas = game.images.atlas
  for (const e of map.ents) {
    if (Array.isArray(e)) {
      const [name, x, y, z] = e
      while (ai < actors.length && actors[ai].z <= z) actors[ai++].draw()
      if (x > viewR || y > viewB || z < viewT || x + spriteWidth(name) < viewL) continue
      drawSprite(g, atlas, name, x, y, game.time)
    } else {
      while (ai < actors.length && actors[ai].z <= e.z) actors[ai++].draw()
      if (e.x > viewR || e.y > viewB || e.z < viewT || e.x + (e.frames[0]?.naturalWidth || 256) < viewL) continue
      drawPiece(g, e, game.time)
    }
  }
  while (ai < actors.length) actors[ai++].draw()
  drawCutsceneWorld(g, game)
  for (const o of map.overlay || []) drawPiece(g, o, game.time)
  drawGlows(g, game)
  for (const site of game.sites || []) drawSite(g, site, game.time)
  drawCreateMarker(g, game)
  game.fx.drawWorld(g, game.time)
  drawMoods(g, game, mapW, mapH)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (!direct) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(buffer, 0, 0, (buffer.width * s) / n, (buffer.height * s) / n)
  }
  game.fx.drawLights(ctx, w, h, game.time)
  drawLabels(ctx, game, s, dpr, avatars, cam)
  drawCutsceneScreen(ctx, game, w, h, dpr, s, cam)
  game.fx.drawBanner(ctx, w, h, dpr, game.time)

  if (game.fade > 0) {
    ctx.fillStyle = `rgba(10,8,16,${game.fade})`
    ctx.fillRect(0, 0, w, h)
  }
}
