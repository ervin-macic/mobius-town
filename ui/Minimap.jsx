import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Collapse, Compass, Expand, Lock, Sparkles, Users, X } from '@openai/apps-sdk-ui/components/Icon'
import AvatarCanvas from './AvatarCanvas.jsx'
import { T } from '../engine/assets.js'
import { beamHidden } from '../engine/beam.js'
import { getMap, isPrivateMap } from '../engine/maps.js'
import { fitMap, mapImage, mapVersion, shirtColour } from '../engine/minimap.js'
import { buildingOf, placeLabel, teleportKind, townOverview } from '../engine/teleport.js'

// The minimap in a corner (the map you are on, everyone on it as a dot) and the town map it opens
// (everyone online, and a Teleport button for each). Dots are redrawn from the game about nine
// times a second straight onto a canvas, so React does not re-render while people walk.

const DRAW_MS = 110
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The minimap's box in CSS pixels for a w x h window; theme.js places it (beside the dock, or under the top bar). */
function minimapBox(w, h) {
  if (h < 560) return 116
  if (w <= 640) return 112
  if (w < 900) return 140
  return 168
}

function useViewport() {
  const [size, setSize] = useState(() => [window.innerWidth, window.innerHeight, window.devicePixelRatio || 1])
  useEffect(() => {
    const on = () => setSize([window.innerWidth, window.innerHeight, window.devicePixelRatio || 1])
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

// Shown or tucked away is remembered on this device (a phone and a laptop often differ).
const caps = () => window.mobius?.capabilities
async function readShown() {
  try {
    if (caps()?.available('device.storage', 1)) return (await caps().invoke('device.storage', { operation: 'get', key: 'minimap' })) !== 'hidden'
  } catch {
    /* default: shown */
  }
  return true
}
function saveShown(shown) {
  try {
    if (caps()?.available('device.storage', 1)) {
      caps().invoke('device.storage', { operation: 'set', key: 'minimap', value: shown ? 'shown' : 'hidden' }).catch(() => {})
    }
  } catch {
    /* not remembered this time */
  }
}

/** Where someone stands on a map picture (device px): the middle of their tile. */
const spot = (fit, x, y) => [(x + 0.5) * fit.kx, (y + 0.5) * fit.ky]

/** Someone: their shirt colour in a dark ring with a pale rim, so it reads on grass and on floors. */
function dot(ctx, x, y, r, colour, dpr, speaking) {
  ctx.beginPath()
  ctx.arc(x, y, r + 1.6 * dpr, 0, Math.PI * 2)
  ctx.fillStyle = speaking ? '#5cf08c' : 'rgba(255,246,220,0.95)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, r + 0.6 * dpr, 0, Math.PI * 2)
  ctx.fillStyle = '#120f1a'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, r - 0.4 * dpr, 0, Math.PI * 2)
  ctx.fillStyle = colour
  ctx.fill()
}

const ANGLE = { up: -Math.PI / 2, right: 0, down: Math.PI / 2, left: Math.PI }

/** You: a gold arrowhead pointing the way you face, with a soft pulse (none with reduced motion). */
function arrow(ctx, x, y, dir, size, pulse, dpr) {
  if (pulse != null) {
    ctx.beginPath()
    ctx.arc(x, y, size * (0.9 + pulse * 1.3), 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255,211,106,${0.75 * (1 - pulse)})`
    ctx.lineWidth = 1.5 * dpr
    ctx.stroke()
  }
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ANGLE[dir] ?? ANGLE.down)
  ctx.beginPath()
  ctx.moveTo(size, 0)
  ctx.lineTo(-size * 0.75, -size * 0.78)
  ctx.lineTo(-size * 0.35, 0)
  ctx.lineTo(-size * 0.75, size * 0.78)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2.2 * dpr
  ctx.strokeStyle = 'rgba(12,9,20,0.95)'
  ctx.stroke()
  ctx.fillStyle = '#ffd36a'
  ctx.fill()
  ctx.restore()
}

/** One frame of the minimap: the map picture, what is on screen, everyone on this map, and you. */
function drawMinimap(ctx, img, game, fit, now, reduce) {
  const { dpr } = fit
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, fit.w, fit.h)
  if (img) ctx.drawImage(img, 0, 0)
  // Dim the picture a touch so the dots stand out on bright grass and stone.
  ctx.fillStyle = 'rgba(12,9,20,0.16)'
  ctx.fillRect(0, 0, fit.w, fit.h)
  // The part of the map on your screen, when it is not the whole map.
  const s = game.scale()
  const vw = game.canvas.width / s, vh = game.canvas.height / s
  const map = game.map
  if (Number.isFinite(game.view.x) && (vw < map.w * T - 1 || vh < map.h * T - 1)) {
    const fx = fit.kx / T, fy = fit.ky / T
    ctx.strokeStyle = 'rgba(255,246,220,0.55)'
    ctx.lineWidth = dpr
    ctx.strokeRect(Math.round((game.view.x - vw / 2) * fx) + 0.5 * dpr, Math.round((game.view.y - vh / 2) * fy) + 0.5 * dpr,
      Math.round(vw * fx) - dpr, Math.round(vh * fy) - dpr)
  }
  const r = Math.max(2.2 * dpr, Math.min(3.8 * dpr, fit.kx * 0.3))
  // Nobody else is drawn on a private map: it is your own place, and theirs are theirs.
  if (!isPrivateMap(game.mapId)) {
    const players = game.footballView?.players
    for (const a of game.others.values()) {
      if (a.mapId !== game.mapId || beamHidden(game, a)) continue
      let at = spot(fit, a.fx, a.fy)
      // Playing football: show them where their footballer is.
      if (game.hiddenAvatars?.has(a.id)) {
        const p = players?.find((q) => q.pid === a.id)
        if (!p) continue
        at = [(p.x / T) * fit.kx, ((p.y - 5) / T) * fit.ky]
      }
      dot(ctx, at[0], at[1], r, shirtColour(a.look), dpr, a.speaking > 0.04)
    }
  } else {
    // Your own office: your agents (engine/office.js) as little lilac dots.
    for (const n of game.npcs || []) {
      const at = spot(fit, n.seat && !n.moving ? n.seat.ax / T - 0.5 : n.fx, n.seat && !n.moving ? (n.seat.ay - 13) / T : n.fy)
      dot(ctx, at[0], at[1], r * 0.85, '#c8a8ff', dpr, false)
    }
  }
  const me = game.me
  const [x, y] = spot(fit, me.fx, me.fy)
  arrow(ctx, x, y, me.dir, r * 1.9, reduce ? null : (now % 1600) / 1600, dpr)
}

/** The map you are on, in a corner. Click it (or press N) for the town map. */
export function Minimap({ town, mapId, onOpen }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const [shown, setShown] = useState(true)
  const [vw, vh, dpr] = useViewport()
  useEffect(() => {
    let alive = true
    readShown().then((v) => { if (alive) setShown(v) })
    return () => { alive = false }
  }, [])
  const box = minimapBox(vw, vh)
  const fit = fitMap(mapId, box, box, dpr)
  const key = fit ? `${mapId}:${fit.w}x${fit.h}` : ''

  useEffect(() => {
    if (!fit) return undefined
    let alive = true
    imgRef.current = null
    mapImage(mapId, fit.w, fit.h).then((img) => { if (alive) imgRef.current = img }).catch(() => {})
    return () => { alive = false }
  }, [key])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!shown || !canvas || !fit) return undefined
    canvas.width = fit.w
    canvas.height = fit.h
    const ctx = canvas.getContext('2d')
    const reduce = reducedMotion()
    let raf = 0
    let last = 0
    let shownVersion = mapVersion(getMap(mapId))
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      if (now - last < DRAW_MS) return
      last = now
      // Only once the game is on this map too (React hears of a door a moment after it).
      if (town.game?.mapId !== mapId) return
      // Something was built here (or taken away): paint the map again.
      const version = mapVersion(getMap(mapId))
      if (version !== shownVersion) {
        shownVersion = version
        mapImage(mapId, fit.w, fit.h).then((img) => { if (shownVersion === version) imgRef.current = img }).catch(() => {})
      }
      drawMinimap(ctx, imgRef.current, town.game, fit, now, reduce)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [shown, key, town])

  const toggle = (v) => {
    setShown(v)
    saveShown(v)
  }
  if (!fit) return null
  if (!shown) {
    return (
      <button type="button" className="mt-iconbtn mt-minimap-show" aria-label="Show the minimap" title="Show the minimap"
        onClick={() => toggle(true)}>
        <Compass aria-hidden="true" />
      </button>
    )
  }
  const name = getMap(mapId)?.name || 'Town'
  return (
    <div className="mt-minimap">
      <button type="button" className="mt-minimap-open" style={{ width: fit.cssW, height: fit.cssH }}
        aria-label={`Minimap of ${name}. Open the town map to see everyone and teleport (N)`} title="Town map (N)" onClick={onOpen}>
        <canvas ref={canvasRef} style={{ width: fit.cssW, height: fit.cssH }} aria-hidden="true" />
        <span className="mt-minimap-expand" aria-hidden="true"><Expand /></span>
      </button>
      <button type="button" className="mt-minimap-hide" aria-label="Hide the minimap" title="Hide the minimap" onClick={() => toggle(false)}>
        <Collapse aria-hidden="true" />
      </button>
    </div>
  )
}

// --- The town map -------------------------------------------------------------------------------

/** The town map's size: beside the list on wide screens, above it on narrow ones (CSS px). */
function overviewBox(w, h) {
  if (w < 760) {
    const width = Math.min(w - 2 * 10 - 2 * 14, 520)
    return [width, Math.min(h * 0.5, width * 1.15)]
  }
  return [Math.min(w - 2 * 16 - 2 * 20 - 320 - 20, 720), h - 2 * 20 - 2 * 18 - 64]
}

function pill(ctx, x, y, w, h) {
  const r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function paintOverview(canvas, img, fit) {
  const ctx = canvas.getContext('2d')
  const { dpr } = fit
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, fit.w, fit.h)
  ctx.drawImage(img, 0, 0)
  ctx.fillStyle = 'rgba(12,9,20,0.12)'
  ctx.fillRect(0, 0, fit.w, fit.h)
  // The town's own place names, as on the street.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.round(Math.max(10, Math.min(12, fit.kx / dpr * 1.4)) * dpr)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  for (const label of getMap('town').labels || []) {
    if (!label.text) continue
    const x = (label.x / T) * fit.kx, y = (label.y / T) * fit.ky
    const tw = ctx.measureText(label.text).width + 10 * dpr
    const th = 16 * dpr
    ctx.fillStyle = 'rgba(20,16,32,0.72)'
    pill(ctx, x - tw / 2, y - th / 2, tw, th)
    ctx.fill()
    ctx.fillStyle = '#fff6dc'
    ctx.fillText(label.text, x, y + 0.5 * dpr)
  }
}

function names(list) {
  const n = list.map((p) => p.name)
  if (n.length <= 3) return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] || ''
  return `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`
}

const byName = (a, b) => a.name.localeCompare(b.name)

function TeleportHint({ kind }) {
  if (kind === 'locked') return <span className="mt-tm-hint"><Lock aria-hidden="true" /> You land at the door</span>
  if (kind === 'private') return <span className="mt-tm-hint"><Lock aria-hidden="true" /> You land outside</span>
  return null
}

/**
 * Everyone online on the town map: out in town where they stand, indoors as a count on their
 * building's door (with a lock for people in their own office), and a list with a Teleport
 * button for each. Marks are buttons: choosing one jumps to that person in the list.
 */
export function TownMap({ town, state, onClose, onTeleport }) {
  const game = town.game
  const canvasRef = useRef(null)
  const closeRef = useRef(null)
  const rowRefs = useRef(new Map())
  const [selected, setSelected] = useState(null)
  const [hot, setHot] = useState(null)
  const [, setTick] = useState(0)
  const [vw, vh, dpr] = useViewport()
  const [bw, bh] = overviewBox(vw, vh)
  const fit = fitMap('town', bw, bh, dpr)
  const key = `${fit.w}x${fit.h}`

  // People walk: refresh the marks a few times a second while the map is open.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(timer)
  }, [])
  // Focus moves into the map, and back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement
    closeRef.current?.focus({ preventScroll: true })
    return () => before?.focus?.({ preventScroll: true })
  }, [])
  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas) return undefined
    canvas.width = fit.w
    canvas.height = fit.h
    mapImage('town', fit.w, fit.h).then((img) => { if (alive) paintOverview(canvas, img, fit) }).catch(() => {})
    return () => { alive = false }
  }, [key])
  useEffect(() => {
    if (!selected) return
    const el = rowRefs.current.get(selected)
    el?.scrollIntoView?.({ block: 'nearest' })
    el?.querySelector('button')?.focus({ preventScroll: true })
  }, [selected])

  if (!game) return null
  const locks = state.world.locks || {}
  const people = []
  for (const [pid, info] of town.peerInfo) {
    const a = game.others.get(pid)
    if (a) people.push({ pid, name: a.name, look: a.look, mapId: a.mapId, x: a.x, y: a.y, fx: a.fx, fy: a.fy })
    // Someone in their own private place is not in this world (town.js), only on the town map.
    else if (isPrivateMap(info.map)) people.push({ pid, name: info.name, look: info.look, mapId: info.map, x: info.x, y: info.y, fx: info.x, fy: info.y })
  }
  const view = townOverview(people)
  const me = { pid: state.pid, name: 'You', mapId: game.mapId, x: game.me.x, y: game.me.y }
  const myBuilding = game.mapId === 'town' ? null : buildingOf(game.mapId)
  const busy = !!game.beam
  const at = (x, y) => ({ left: (x + 0.5) * fit.kx / dpr, top: (y + 0.5) * fit.ky / dpr })
  const kindOf = (p) => teleportKind({ map: p.mapId, x: p.x, y: p.y }, { pid: state.pid, locks })

  // The list, in the map's order: out in town, then each building, then offices.
  const sections = []
  if (view.outdoors.length) sections.push({ id: 'out', title: 'Out in town', people: [...view.outdoors].sort(byName) })
  const groups = [...view.buildings].sort((a, b) => a.private - b.private || a.name.localeCompare(b.name))
  for (const g of groups) sections.push({ id: g.id, title: g.private ? 'In their office' : g.name, people: [...g.people].sort(byName) })
  if (view.elsewhere.length) sections.push({ id: 'else', title: 'Somewhere new', people: [...view.elsewhere].sort(byName) })

  const others = people.length
  // Your own office is yours alone: never "together" with anyone in theirs.
  const inMyOffice = isPrivateMap(game.mapId)
  const myPlace = inMyOffice ? 'In your office' : placeLabel(me, locks)
  return (
    <div className="mt-cover mt-tm-cover" role="dialog" aria-modal="true" aria-labelledby="mt-tm-title" onClick={onClose}>
      <div className="mt-card mt-tm" onClick={(e) => e.stopPropagation()}>
        <header className="mt-tm-head">
          <div className="mt-tm-titles">
            <h2 id="mt-tm-title" className="mt-pixel">Town map</h2>
            <p className="mt-tm-sub">
              {others ? `${others} ${others === 1 ? 'Möbian' : 'Möbians'} in town besides you` : 'Just you in town for now'}
              {' · '}You: {myPlace.charAt(0).toLowerCase() + myPlace.slice(1)}
            </p>
          </div>
          <button ref={closeRef} type="button" className="mt-iconbtn" aria-label="Close the town map" title="Close (Esc)" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="mt-tm-body" style={{ '--mt-tm-h': `${fit.cssH}px` }}>
          <div className="mt-tm-map" style={{ width: fit.cssW, height: fit.cssH }}>
            <canvas ref={canvasRef} style={{ width: fit.cssW, height: fit.cssH }} aria-hidden="true" />
            {view.outdoors.map((p) => (
              <button key={p.pid} type="button" className={`mt-tm-mark${hot === p.pid || selected === p.pid ? ' is-hot' : ''}`}
                style={{ ...at(p.fx, p.fy), '--mt-mark': shirtColour(p.look) }}
                aria-label={`${p.name}, ${placeLabel(p, locks).toLowerCase()}. Show in the list`}
                onClick={() => setSelected(p.pid)}>
                <span className="mt-tm-dot" aria-hidden="true" />
                <span className="mt-tm-name" aria-hidden="true">{p.name}</span>
              </button>
            ))}
            {groups.map((g) => {
              const mine = !inMyOffice && !g.private && myBuilding?.id === g.building
              return (
                <button key={g.id} type="button" className={`mt-tm-badge${g.private ? ' is-private' : ''}${mine ? ' is-mine' : ''}${g.people.some((p) => p.pid === hot) ? ' is-hot' : ''}`}
                  style={{ left: (g.x + (g.private ? 1.6 : 0)) * fit.kx / dpr, top: (g.y - 0.7) * fit.ky / dpr }}
                  aria-label={`${g.private ? 'In their office' : g.name}: ${names(g.people)}${mine ? ', and you' : ''}. Show in the list`}
                  onClick={() => setSelected([...g.people].sort(byName)[0].pid)}>
                  {g.private ? <Lock aria-hidden="true" /> : <Users aria-hidden="true" />}
                  <b>{g.people.length}</b>
                  <span className="mt-tm-name" aria-hidden="true">{g.private ? `${names(g.people)} · in their office` : `${g.name}: ${names(g.people)}`}</span>
                </button>
              )
            })}
            {game.mapId === 'town' ? (
              <span className="mt-tm-me" style={at(game.me.fx, game.me.fy)} aria-hidden="true">
                <span className={`mt-tm-arrow is-${game.me.dir}`} />
                <span className="mt-tm-name">You</span>
              </span>
            ) : myBuilding && (inMyOffice || !groups.some((g) => g.building === myBuilding.id && !g.private)) && (
              <span className="mt-tm-me is-indoors" style={{ left: myBuilding.x * fit.kx / dpr, top: (myBuilding.y - 0.7) * fit.ky / dpr }} aria-hidden="true">
                <span className="mt-tm-name">You</span>
              </span>
            )}
          </div>
          <section className="mt-tm-list" aria-label="Möbians you can teleport to">
            {!sections.length && (
              <p className="mt-empty">
                {state.status === 'online'
                  ? 'Nobody else is in town right now. When Möbians arrive, they appear here and on the map, and you can teleport to them.'
                  : state.problem || 'Connecting to the town…'}
              </p>
            )}
            {sections.map((sec) => (
              <div key={sec.id} className="mt-tm-section">
                <h3 className="mt-section">{sec.title}</h3>
                <ul>
                  {sec.people.map((p) => {
                    const kind = kindOf(p)
                    return (
                      <li key={p.pid} ref={(el) => { if (el) rowRefs.current.set(p.pid, el); else rowRefs.current.delete(p.pid) }}
                        className={`mt-tm-row${selected === p.pid ? ' is-selected' : ''}`}
                        onPointerEnter={() => setHot(p.pid)} onPointerLeave={() => setHot((h) => (h === p.pid ? null : h))}>
                        <AvatarCanvas look={p.look} scale={2} />
                        <div className="mt-tm-who">
                          <b>{p.name}</b>
                          <span>{placeLabel(p, locks, { short: true })}</span>
                          <TeleportHint kind={kind} />
                        </div>
                        <button type="button" className="mt-btn mt-tm-go" disabled={busy || !kind}
                          aria-label={`Teleport to ${p.name}`}
                          title={kind === 'locked' ? `${p.name} is in a locked room: you land at its door and can knock`
                            : kind === 'private' ? `${p.name} is in their office: you land outside the building`
                              : `Teleport next to ${p.name}`}
                          onFocus={() => setHot(p.pid)} onBlur={() => setHot((h) => (h === p.pid ? null : h))}
                          onClick={() => onTeleport(p.pid)}>
                          <Sparkles aria-hidden="true" /> Teleport
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
