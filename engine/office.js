// The Agent Office's crew: each of your Möbius agents as an office worker at their own desk.
// Pure engine code (no network, no DOM): town.js feeds it your agents (net/agents.js) and the
// game clock, and render.js draws its people like any other avatar (they carry `npc: true`).
//
// How busy someone looks follows how recently their chat was active, the one honest signal
// Möbius gives apps: agents active in the last few minutes sit typing at their desks, quieter
// ones drift to the coffee machine, the window, the meeting table or the sofa.
import { normalizeLook, T } from './assets.js'
import { findPath, getMap, seatAt, tileKind } from './maps.js'
import { WALK_SPEED } from './motion.js'

export const OFFICE_MAP = 'office'
export const REACH = 1.8 // tiles: close enough to talk to someone
const SPEED = WALK_SPEED * 0.75

// Where each kind of agent spends its time next (weights), by how recently it was active.
export const HABITS = {
  now: { desk: 0.84, coffee: 0.06, cooler: 0.04, window: 0.06 },
  recent: { desk: 0.5, coffee: 0.14, cooler: 0.08, window: 0.1, plant: 0.06, meeting: 0.12 },
  today: { desk: 0.24, coffee: 0.14, cooler: 0.08, window: 0.14, plant: 0.06, meeting: 0.14, lounge: 0.2 },
  earlier: { desk: 0.2, lounge: 0.4, meeting: 0.14, window: 0.14, coffee: 0.12 },
}
// How long a stay lasts, in seconds [min, max].
const STAY = {
  desk: { now: [26, 50], recent: [14, 30], today: [10, 20], earlier: [12, 24] },
  away: [7, 15],
}
const TYPING_GAP = { now: [1.5, 4], recent: [4, 9] }

// Name pills: green while active now, gold this hour, quiet grey otherwise.
export const PILLS = {
  now: { bg: 'rgba(38,112,76,0.92)', dot: '#7dffa8' },
  recent: { bg: 'rgba(104,78,150,0.92)', dot: '#ffd36a' },
  today: { bg: 'rgba(52,46,76,0.88)', dot: '#b8b2cc' },
  earlier: { bg: 'rgba(52,46,76,0.88)', dot: '#7c768f' },
}

function between(random, [lo, hi]) {
  return lo + random() * (hi - lo)
}

function pick(random, weights) {
  const entries = Object.entries(weights)
  let r = random() * entries.reduce((sum, [, w]) => sum + w, 0)
  for (const [key, w] of entries) {
    r -= w
    if (r <= 0) return key
  }
  return entries[entries.length - 1][0]
}

/** Where someone in the office is, in tiles, as you see them (a seated person sits on their chair). */
export function npcCentre(npc) {
  if (npc.seat && !npc.moving) return { x: npc.seat.ax / T - 0.5, y: (npc.seat.ay - 13) / T }
  return { x: npc.fx, y: npc.fy }
}

export class OfficeCrew {
  constructor({ mapId = OFFICE_MAP, random = Math.random } = {}) {
    this.map = getMap(mapId)
    this.mapId = mapId
    this.random = random
    this.desks = this.map.objects.filter((o) => o.kind === 'desk')
    this.pois = this.map.objects.filter((o) => o.kind === 'poi')
    this.npcs = []
    this.claims = new Map() // "seat:<id>" or "spot:x,y" -> npc id
  }

  /**
   * Show these agents (most recently active first), one per desk. People already here keep
   * their desk and whatever they are doing; newcomers appear at their desk or somewhere they
   * like to be, so the office looks lived-in the moment you walk in.
   */
  setAgents(agents, time = 0) {
    const shown = agents.slice(0, this.desks.length)
    const ids = new Set(shown.map((a) => a.id))
    for (const npc of this.npcs) if (!ids.has(npc.agentId)) this.release(npc)
    this.npcs = this.npcs.filter((npc) => ids.has(npc.agentId))
    const used = new Set(this.npcs.map((npc) => npc.desk.id))
    for (const agent of shown) {
      const existing = this.npcs.find((npc) => npc.agentId === agent.id)
      if (existing) {
        // Fresh activity since the last look: a little "!" so you notice.
        if (Number.isFinite(agent.at) && Number.isFinite(existing.at) && agent.at > existing.at) {
          existing.emote = { kind: 'excl', start: time, until: time + 2.6 }
        }
        Object.assign(existing, { name: agent.label, at: agent.at, activity: agent.activity, pill: PILLS[agent.activity] })
        continue
      }
      const desk = this.desks.find((d) => !used.has(d.id))
      used.add(desk.id)
      const npc = this.makeNpc(agent, desk)
      this.npcs.push(npc)
      this.settle(npc, time)
    }
  }

  makeNpc(agent, desk) {
    return {
      id: `agent:${agent.id}`, agentId: agent.id, npc: true,
      name: agent.label, look: normalizeLook(agent.look), mapId: this.mapId,
      x: desk.seatX, y: desk.seatY, fx: desk.seatX, fy: desk.seatY, dir: 'up',
      moving: false, walkT: 0, emote: null, chat: null, speaking: 0, status: '', path: [],
      muted: false, seat: null, dance: null, bubbleId: null,
      at: agent.at, activity: agent.activity, pill: PILLS[agent.activity],
      desk, doing: null, until: 0, nextTypeAt: 0, goal: null,
    }
  }

  /** First placement: straight into a desk chair or a favourite spot, no walking. */
  settle(npc, time) {
    const choice = npc.activity === 'now' ? 'desk' : pick(this.random, HABITS[npc.activity])
    const target = this.targetFor(npc, choice) || this.targetFor(npc, 'desk')
    this.claim(npc, target)
    Object.assign(npc, { x: target.x, y: target.y, fx: target.x, fy: target.y, path: [], moving: false })
    this.arrive(npc, target, time)
  }

  /** A free place for an activity: { key, x, y, seat?, face, activity }. */
  targetFor(npc, activity) {
    if (activity === 'desk') {
      return { key: `seat:${npc.desk.seat}`, x: npc.desk.seatX, y: npc.desk.seatY, seatId: npc.desk.seat, face: 'up', activity }
    }
    const poi = this.pois.find((p) => p.activity === activity)
    if (!poi) return null
    const options = poi.seatIds
      ? poi.seatIds.map((id) => {
        const seat = this.map.objects.find((o) => o.id === id)
        return seat && { key: `seat:${id}`, x: seat.x, y: seat.y, seatId: id, face: seat.face, activity }
      }).filter(Boolean)
      : (poi.spots || []).map(([x, y]) => ({ key: `spot:${x},${y}`, x, y, face: poi.face || 'down', activity }))
    const free = options.filter((o) => !this.claims.has(o.key) || this.claims.get(o.key) === npc.id)
    return free.length ? free[Math.floor(this.random() * free.length)] : null
  }

  claim(npc, target) {
    this.release(npc)
    this.claims.set(target.key, npc.id)
    npc.goal = target
  }

  release(npc) {
    if (npc.goal && this.claims.get(npc.goal.key) === npc.id) this.claims.delete(npc.goal.key)
    npc.goal = null
  }

  arrive(npc, target, time) {
    npc.moving = false
    npc.walkT = 0
    npc.path = []
    npc.doing = target.activity
    npc.seat = target.seatId ? seatAt(this.map, target.x, target.y) : null
    npc.dir = npc.seat ? npc.seat.face : target.face
    const stay = target.activity === 'desk' ? STAY.desk[npc.activity] : STAY.away
    npc.until = time + between(this.random, stay)
    npc.nextTypeAt = time + between(this.random, [0.5, 2.5])
  }

  /** Choose what to do next and set off there. */
  decide(npc, time, me) {
    let choice = pick(this.random, HABITS[npc.activity])
    if (choice === npc.doing && choice !== 'desk') choice = 'desk'
    let target = this.targetFor(npc, choice)
    // Someone sitting in your chair: wander instead of sitting on their lap.
    if (target?.seatId && me?.seat?.id === target.seatId) target = this.targetFor(npc, 'coffee') || this.targetFor(npc, 'window')
    if (!target) {
      npc.until = time + between(this.random, [3, 6])
      return
    }
    const path = findPath(this.map, npc.x, npc.y, target.x, target.y)
    if (!path) {
      npc.until = time + between(this.random, [3, 6])
      return
    }
    this.claim(npc, target)
    npc.seat = null
    npc.doing = null
    npc.path = path
    // Paths run tile centre to tile centre; seated people first stand on their own tile.
    if (Math.abs(npc.fx - npc.x) > 0.01 || Math.abs(npc.fy - npc.y) > 0.01) npc.path.unshift([npc.x, npc.y])
    if (!npc.path.length) this.arrive(npc, target, time)
  }

  walk(npc, dt, time) {
    let budget = SPEED * dt
    while (budget > 1e-9 && npc.path.length) {
      const [nx, ny] = npc.path[0]
      const dx = nx - npc.fx
      const dy = ny - npc.fy
      const d = Math.hypot(dx, dy)
      if (d > 1e-6) npc.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
      if (d <= budget) {
        npc.fx = nx
        npc.fy = ny
        npc.x = nx
        npc.y = ny
        budget -= d
        npc.path.shift()
      } else {
        npc.fx += (dx / d) * budget
        npc.fy += (dy / d) * budget
        npc.x = Math.round(npc.fx)
        npc.y = Math.round(npc.fy)
        budget = 0
      }
    }
    npc.moving = true
    npc.walkT += dt
    if (!npc.path.length && npc.goal) this.arrive(npc, npc.goal, time)
  }

  /** One frame: walking, typing at desks, chatting when two meet, and deciding what next. */
  update(dt, { time, me = null } = {}) {
    for (const npc of this.npcs) {
      if (npc.emote && npc.emote.until < time) npc.emote = null
      if (npc.path.length) {
        this.walk(npc, dt, time)
        continue
      }
      // You sat down in their chair: they get up and go somewhere else.
      if (npc.seat && me?.seat?.id === npc.seat.id) {
        npc.emote = { kind: 'q', start: time, until: time + 2.2 }
        npc.until = time
      }
      if (time >= npc.until) {
        this.decide(npc, time, me)
        continue
      }
      if (npc.doing === 'desk' && TYPING_GAP[npc.activity] && time >= npc.nextTypeAt && !npc.emote) {
        npc.emote = { kind: 'dots', start: time, until: time + 2.4 }
        npc.nextTypeAt = time + 2.4 + between(this.random, TYPING_GAP[npc.activity])
      } else if ((npc.doing === 'meeting' || npc.doing === 'lounge' || npc.doing === 'coffee') && !npc.emote
        && this.random() < dt * 0.12 && this.someoneNear(npc)) {
        npc.emote = { kind: 'talk', start: time, until: time + 2.4 }
      }
    }
  }

  someoneNear(npc) {
    const a = npcCentre(npc)
    return this.npcs.some((other) => {
      if (other === npc || other.path.length) return false
      const b = npcCentre(other)
      return Math.hypot(a.x - b.x, a.y - b.y) <= 2.6
    })
  }

  /** The person you are standing next to, if any (the closest within reach). */
  nearest(me) {
    let best = null
    for (const npc of this.npcs) {
      const c = npcCentre(npc)
      const d = Math.hypot(c.x - me.fx, c.y - me.fy)
      if (d <= REACH && (!best || d < best.d)) best = { npc, d }
    }
    return best?.npc || null
  }

  /**
   * Whoever is drawn on this tile, for taps: anywhere on their body counts (a person stands about
   * a tile and a half tall above their feet), the one whose feet are closest winning.
   */
  at(tx, ty) {
    let best = null
    for (const npc of this.npcs) {
      const c = npcCentre(npc)
      const dx = Math.abs(tx - c.x)
      const dy = ty - c.y // the tapped tile's row against the feet's row: 0 at the feet, -1 the body
      if (dx > 0.75 || dy < -1.6 || dy > 0.6) continue
      const d = Math.hypot(dx, dy + 0.5)
      if (!best || d < best.d) best = { npc, d }
    }
    return best?.npc || null
  }

  /** A free floor tile beside someone, to walk up to them. */
  besideOf(npc, from) {
    const c = npcCentre(npc)
    const cx = Math.round(c.x)
    const cy = Math.round(c.y)
    const options = [[cx, cy + 1], [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]]
      .filter(([x, y]) => tileKind(this.map, x, y) === 0 && !seatAt(this.map, x, y))
    options.sort((p, q) => Math.hypot(p[0] - from.x, p[1] - from.y) - Math.hypot(q[0] - from.x, q[1] - from.y))
    return options[0] || null
  }
}
