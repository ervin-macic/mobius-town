// Court games on built courts, from this player's side (the football pitch's model, for any game).
//
// The hub keeps each court's line-up (world.courts[creationId]): places like red0 red1 blue0 blue1,
// each a person or empty (a bot). When a match starts, one person's browser, the host, runs the
// game's cartridge in a sandboxed Web Worker (no token, no network; games/court-sdk.js) at 60 Hz
// and streams snapshots about 15 times a second over the direct peer connections; the other
// players send their stick and buttons to the host about 20 times a second. Everyone, players and
// spectators, turns snapshots into a picture with the same cartridge's view(), so the town only
// draws simple things: players (as town avatars in team shirts), a ball, shapes and text.
import { COURT_WORKER_SOURCE, lerpView } from '../games/court-sdk.js'

const T = 16
const SNAP_MS = 1000 / 15
const INPUT_MS = 1000 / 20
const INPUT_STALE_MS = 900
const LINGER_MS = 6000
const WATCHDOG_MS = 2500
const MAX_FRAMES = 4
const SOUNDS = new Set(['click', 'pop', 'chime', 'whoosh', 'coin', 'splash', 'sparkle', 'fanfare', 'win', 'lose'])
// Bots look like townsfolk; the shirt is the team's.
const BOT_LOOKS = [
  { body: 0, skin: 0, hair: 6, pants: 4 }, { body: 1, skin: 3, hair: 2, pants: 4 }, { body: 1, skin: 1, hair: 5, pants: 4 },
  { body: 0, skin: 2, hair: 7, pants: 4 }, { body: 0, skin: 4, hair: 1, pants: 2 }, { body: 1, skin: 2, hair: 3, pants: 1 },
  { body: 0, skin: 1, hair: 4, pants: 5 }, { body: 1, skin: 0, hair: 0, pants: 3 },
]
const KITS = [0, 1, 5, 3] // team shirts: red, blue, teal, yellow

export function slotIds(meta) {
  const out = []
  for (const t of meta.teams) for (let i = 0; i < meta.perTeam; i++) out.push(`${t.id}${i}`)
  return out
}

export class CourtController {
  constructor({ town }) {
    this.town = town
    this.courts = {}
    this.match = null
    this.keys = new Set()
    this.stick = null
    this.buttons = { a: false, b: false }
    this.inputs = new Map()
    this.seq = 0
    this.lastInputAt = 0
    this.lastSnapAt = 0
    this.reported = new Set()
    this.lastKey = ''
  }

  get pid() {
    return this.town.pid
  }

  /** The creation's game: { cartridge: {id, code, hash}, court: [x,y,w,h], options, meta }. */
  gameOf(cid) {
    return this.town.building.bodies.get(cid)?.body?.game || null
  }

  mapOf(cid) {
    return this.town.building.bodies.get(cid)?.body?.map || null
  }

  // --- what the hub says ----------------------------------------------------------------------------

  setCourts(courts) {
    this.courts = courts || {}
    const m = this.match
    if (m) {
      const court = this.courts[m.cid]
      const live = court?.status === 'playing' && court.match?.id === m.id
      if (!live && !m.ended) this.finish()
      else if (live) this.updateLineup(court)
    }
    if (!this.match || this.match.ended) this.follow()
    this.publish()
  }

  /** Watch (or play) the live match on a court on this map: yours first, else the nearest. */
  follow() {
    const game = this.town.game
    if (!game) return
    let best = null
    for (const [cid, court] of Object.entries(this.courts)) {
      if (court.status !== 'playing' || !court.match) continue
      if (this.mapOf(cid) !== game.mapId || !this.gameOf(cid)) continue
      const mine = Object.values(court.slots).includes(this.pid)
      const [x, y, w, h] = this.gameOf(cid).court
      const d = Math.hypot(game.me.x - (x + w / 2), game.me.y - (y + h / 2))
      if (!mine && d > 22) continue
      const score = mine ? -1 : d
      if (!best || score < best.score) best = { cid, court, score }
    }
    if (best && (!this.match || this.match.id !== best.court.match.id)) this.begin(best.cid, best.court)
  }

  playersFor(court, meta) {
    return slotIds(meta).map((slot, i) => {
      const pid = court.slots[slot]
      const team = meta.teams.find((t) => slot.startsWith(t.id))
      return { slot, team: team.id, index: i, bot: pid ? null : (court.level || 'medium'), name: pid ? (court.names?.[pid] || 'Player') : 'Bot' }
    })
  }

  begin(cid, court) {
    this.stop()
    const g = this.gameOf(cid)
    if (!g) return
    const m = court.match
    const role = m.host === this.pid ? 'host' : 'view'
    let worker
    try {
      const url = URL.createObjectURL(new Blob([COURT_WORKER_SOURCE], { type: 'text/javascript' }))
      worker = new Worker(url)
      URL.revokeObjectURL(url)
    } catch (err) {
      this.town.toast(`This game can't run here: ${err?.message || 'workers are unavailable'}.`)
      return
    }
    const match = this.match = {
      cid, id: m.id, host: m.host, role, worker, meta: g.meta, court: g.court, options: g.options || {},
      slots: { ...court.slots }, names: { ...court.names }, level: court.level || 'medium',
      ready: false, waiting: false, waitingSince: 0, acc: 0, view: null, from: null, to: null, toAt: 0,
      snap: null, ended: null, sentEnd: false, startedAt: performance.now(), pendingEvents: [],
    }
    this.inputs.clear()
    this.reported.clear()
    this.keys.clear()
    this.buttons = { a: false, b: false }
    this.stick = null
    worker.onmessage = (e) => this.onWorker(match, e.data)
    worker.onerror = (e) => this.crash(match, e?.message || 'the game crashed')
    worker.postMessage({
      t: 'load', code: g.cartridge.code, players: this.playersFor(court, g.meta),
      court: { w: g.court[2] * T, h: g.court[3] * T }, seed: m.seed, options: g.options || {}, role,
      elapsed: Math.max(0, (this.town.serverNow() - m.started) / 1000),
    })
    match.waiting = true
    match.waitingSince = performance.now()
    if (this.isPlayer()) this.town.sound.play('chime', { volume: 0.7 })
  }

  updateLineup(court) {
    const m = this.match
    if (court.match.host !== m.host) {
      const takingOver = court.match.host === this.pid
      m.host = court.match.host
      if (takingOver && m.snap && m.ready) {
        m.role = 'host'
        m.worker.postMessage({
          t: 'restore', snap: m.snap, players: this.playersFor(court, m.meta),
          elapsed: Math.max(0, (this.town.serverNow() - court.match.started) / 1000),
        })
        m.waiting = true
        m.waitingSince = performance.now()
      } else if (!takingOver) {
        m.role = 'view'
      }
      m.from = null
      m.to = null
      this.lastSnapAt = 0
    }
    let changed = false
    for (const slot of Object.keys(court.slots)) {
      if (court.slots[slot] !== m.slots[slot]) changed = true
    }
    if (changed || court.level !== m.level) {
      m.slots = { ...court.slots }
      m.names = { ...m.names, ...court.names }
      m.level = court.level || m.level
      if (m.ready) m.worker.postMessage({ t: 'players', players: this.playersFor(court, m.meta) })
    }
  }

  finish() {
    const m = this.match
    if (!m || m.ended) return
    m.ended = performance.now()
    this.keys.clear()
    this.stick = null
    const mine = this.mySlot()
    setTimeout(() => {
      if (this.match === m) {
        this.stop()
        this.publish()
        if (mine) this.town.onCourtEnd?.(m)
      }
    }, LINGER_MS)
  }

  stop() {
    if (this.match?.worker) this.match.worker.terminate()
    this.match = null
  }

  crash(match, message) {
    if (this.match !== match) return
    console.info('[court] game stopped:', message)
    this.town.toast(`The game stopped working: ${String(message).slice(0, 140)}`, { long: true })
    if (this.isPlayer()) this.leave()
    this.stop()
    this.publish()
  }

  // --- roles -------------------------------------------------------------------------------------

  isHost() {
    return !!this.match && !this.match.ended && this.match.role === 'host' && this.match.host === this.pid
  }

  mySlot() {
    const m = this.match
    if (!m) return null
    return Object.keys(m.slots).find((s) => m.slots[s] === this.pid) || null
  }

  isPlayer() {
    return !!this.mySlot()
  }

  controlling() {
    return !!this.match && !this.match.ended && this.isPlayer()
  }

  /** In a lobby (waiting for kick-off) on any court. */
  lobby() {
    for (const [cid, court] of Object.entries(this.courts)) {
      if (court.status === 'lobby' && Object.values(court.slots).includes(this.pid)) return { cid, court }
    }
    return null
  }

  // --- actions ----------------------------------------------------------------------------------

  join(cid, team = null) {
    return this.town.act('court_join', { court: cid, ...(team ? { team } : {}) }).then((r) => {
      this.town.wake()
      return r
    })
  }

  leave(cid = this.match?.cid || this.lobby()?.cid) {
    this.keys.clear()
    if (!cid) return null
    return this.town.act('court_leave', { court: cid }).then((r) => { this.town.wake(); return r })
  }

  setLevel(cid, level) {
    return this.town.act('court_level', { court: cid, level })
  }

  key(dir, down) {
    if (down) this.keys.add(dir)
    else this.keys.delete(dir)
  }

  button(id, down) {
    if (id !== 'a' && id !== 'b') return
    this.buttons[id] = down
    if (down) this.lastInputAt = 0
  }

  setStick(mx, my) {
    this.stick = mx === 0 && my === 0 ? null : { mx, my }
  }

  localInput() {
    let mx = 0
    let my = 0
    if (this.stick) ({ mx, my } = this.stick)
    else {
      if (this.keys.has('left')) mx -= 1
      if (this.keys.has('right')) mx += 1
      if (this.keys.has('up')) my -= 1
      if (this.keys.has('down')) my += 1
      const len = Math.hypot(mx, my)
      if (len > 1) {
        mx /= len
        my /= len
      }
    }
    return { mx, my, a: this.buttons.a, b: this.buttons.b }
  }

  // --- the frame loop --------------------------------------------------------------------------------

  frame(dt) {
    const m = this.match
    if (!m) return
    const now = performance.now()
    if (m.waiting && now - m.waitingSince > WATCHDOG_MS) {
      this.crash(m, 'it stopped responding')
      return
    }
    if (m.ended || !m.ready) {
      this.publish()
      return
    }
    if (this.isHost()) {
      m.acc += dt
      if (!m.waiting) {
        const frames = Math.min(MAX_FRAMES, Math.floor(m.acc * 60 + 1e-6))
        if (frames > 0) {
          m.acc -= frames / 60
          const inputs = {}
          for (const [slot, pid] of Object.entries(m.slots)) {
            if (!pid) continue
            if (pid === this.pid) inputs[slot] = this.localInput()
            else {
              const got = this.inputs.get(pid)
              inputs[slot] = got && now - got.at < INPUT_STALE_MS ? got : { mx: 0, my: 0, a: false, b: false }
            }
          }
          const snap = now - this.lastSnapAt >= SNAP_MS
          if (snap) this.lastSnapAt = now
          m.waiting = true
          m.waitingSince = now
          m.worker.postMessage({ t: 'step', frames, inputs, snap })
        }
        if (m.acc > 0.25) m.acc = 0.25 // a long pause is not caught up
      }
    } else {
      if (this.isPlayer() && now - this.lastInputAt >= INPUT_MS) {
        this.lastInputAt = now
        const { mx, my, a, b } = this.localInput()
        this.town.mesh.send(m.host, { t: 'cgi', c: m.cid, m: m.id, x: Math.round(mx * 100) / 100, y: Math.round(my * 100) / 100, a: a ? 1 : 0, b: b ? 1 : 0, q: ++this.seq }, false)
      }
    }
    this.publish()
  }

  onWorker(match, msg) {
    if (this.match !== match || !msg) return
    match.waiting = false
    if (msg.t === 'error') {
      this.crash(match, msg.message || 'the game failed')
      return
    }
    if (msg.t === 'ready') {
      match.ready = true
      match.meta = { ...match.meta, ...msg.meta }
      if (msg.view) match.view = msg.view
      if (msg.snap) match.snap = msg.snap
      // A viewer that arrived with a snapshot in hand draws it at once.
      if (match.role !== 'host' && match.snap && !msg.view) {
        match.waiting = true
        match.waitingSince = performance.now()
        match.worker.postMessage({ t: 'show', snap: match.snap })
      }
      return
    }
    if (msg.t === 'frame') {
      match.view = msg.view
      if (msg.snap) {
        match.snap = msg.snap
        const ev = match.pendingEvents.concat(msg.events || []).filter((e) => e.type === 'sound' || e.type === 'banner' || e.type === 'score' || e.type === 'end')
        match.pendingEvents = []
        this.town.mesh.broadcast({ t: 'cgs', c: match.cid, m: match.id, s: msg.snap, ev: ev.slice(-8) }, false)
      } else {
        match.pendingEvents.push(...(msg.events || []))
      }
      this.handleEvents(msg.events || [], true)
      return
    }
    if (msg.t === 'view') {
      match.from = match.to || msg.view
      match.to = msg.view
      match.toAt = performance.now()
      match.view = msg.view
    }
  }

  onMessage(from, msg) {
    const m = this.match
    if (!m || msg.c !== m.cid || msg.m !== m.id || m.ended) return
    if (msg.t === 'cgi' && this.isHost()) {
      const mx = Number(msg.x)
      const my = Number(msg.y)
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return
      const prev = this.inputs.get(from)
      if (prev && typeof msg.q === 'number' && msg.q < prev.q) return
      this.inputs.set(from, { mx: Math.max(-1, Math.min(1, mx)), my: Math.max(-1, Math.min(1, my)), a: msg.a === 1, b: msg.b === 1, at: performance.now(), q: msg.q })
    } else if (msg.t === 'cgs' && !this.isHost() && from === m.host && msg.s && typeof msg.s === 'object') {
      m.snap = msg.s
      if (m.ready && !m.waiting) {
        m.waiting = true
        m.waitingSince = performance.now()
        m.worker.postMessage({ t: 'show', snap: msg.s })
      }
      if (Array.isArray(msg.ev)) this.handleEvents(msg.ev.slice(0, 8), false)
    }
  }

  handleEvents(events, host) {
    const m = this.match
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue
      if (ev.type === 'sound' && SOUNDS.has(ev.name)) {
        const [x, y, w, h] = m.court
        this.town.sound.play(ev.name, this.isPlayer() ? { volume: 0.7 } : { map: this.mapOf(m.cid), x: x + w / 2, y: y + h / 2, volume: 0.7 })
      } else if (ev.type === 'banner' && typeof ev.text === 'string') {
        m.banner = { text: ev.text.slice(0, 40), at: performance.now() }
      } else if (ev.type === 'score' && host) {
        const score = this.cleanScore(ev.score)
        const key = `score:${JSON.stringify(score)}`
        if (score && !this.reported.has(key)) {
          this.reported.add(key)
          this.town.act('court_score', { court: m.cid, id: m.id, score })
        }
      } else if (ev.type === 'end') {
        if (host && !m.sentEnd) {
          m.sentEnd = true
          const score = this.cleanScore(ev.score) || this.cleanScore(m.view?.score)
          if (score) this.town.act('court_result', { court: m.cid, id: m.id, score })
        }
        const mine = this.mySlot()
        const team = mine ? m.meta.teams.find((t) => mine.startsWith(t.id))?.id : null
        this.town.sound.play(team && ev.winner === team ? 'win' : !team || ev.winner === 'draw' ? 'chime' : 'lose')
      }
    }
  }

  cleanScore(score) {
    const m = this.match
    if (!score || typeof score !== 'object') return null
    const out = {}
    for (const t of m.meta.teams) {
      const v = score[t.id]
      if (!Number.isInteger(v) || v < 0 || v > 999) return null
      out[t.id] = v
    }
    return out
  }

  // --- what the renderer and the HUD see -------------------------------------------------------------------

  /** Everything needed to draw the match in world pixels, or null. */
  view() {
    const m = this.match
    if (!m || !m.ready || this.mapOf(m.cid) !== this.town.game?.mapId) return null
    let view = m.view
    if (!this.isHost() && m.from && m.to) view = lerpView(m.from, m.to, Math.min(1, (performance.now() - m.toAt) / SNAP_MS))
    if (!view) return null
    const players = {}
    const slots = slotIds(m.meta)
    slots.forEach((slot, i) => {
      const pid = m.slots[slot]
      const teamIndex = m.meta.teams.findIndex((t) => slot.startsWith(t.id))
      const base = pid ? (pid === this.pid ? this.town.profile?.look : this.town.peerInfo.get(pid)?.look) : BOT_LOOKS[i % BOT_LOOKS.length]
      players[slot] = {
        look: { body: 0, skin: 1, hair: 0, pants: 0, ...base, shirt: KITS[teamIndex] ?? 0 },
        name: pid ? (pid === this.pid ? 'You' : (m.names[pid] || 'Player')) : 'Bot',
        me: pid === this.pid, team: teamIndex,
      }
    })
    return { ox: m.court[0] * T, oy: m.court[1] * T, items: view.draw || [], players }
  }

  hiddenPids() {
    const m = this.match
    if (!m || !m.ready || this.mapOf(m.cid) !== this.town.game?.mapId) return null
    return new Set(Object.values(m.slots).filter(Boolean))
  }

  fit() {
    const m = this.match
    if (!m || !this.controlling()) return null
    const [x, y, w, h] = m.court
    return { w: w * T + 56, h: h * T + 96, cx: (x + w / 2) * T, cy: (y + h / 2) * T }
  }

  publish() {
    const m = this.match
    const lobby = this.lobby()
    const view = m?.view
    const out = {
      lobby: lobby ? {
        cid: lobby.cid, slots: lobby.court.slots, names: lobby.court.names, level: lobby.court.level,
        kickoffAt: lobby.court.kickoff_at, meta: this.gameOf(lobby.cid)?.meta || null,
      } : null,
      match: m ? {
        cid: m.cid, id: m.id, ended: !!m.ended, player: this.isPlayer(), host: this.isHost(), ready: m.ready,
        meta: m.meta, score: view?.score || null, clock: Number.isFinite(view?.clock) ? Math.ceil(view.clock) : null,
        message: view?.message || null,
        banner: m.banner && performance.now() - m.banner.at < 2500 ? m.banner.text : null,
        slots: m.slots, names: m.names, mySlot: this.mySlot(),
      } : null,
    }
    const key = JSON.stringify(out)
    if (key === this.lastKey) return
    this.lastKey = key
    this.town.set({ court: out })
  }
}
