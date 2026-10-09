// Football on the town pitch, from this player's side.
//
// The hub (hub.py) keeps the line-up: four places, red0 red1 blue0 blue1, each a person or empty
// (a bot). When a match starts, one person's browser, the host, runs games/football.js at 60 Hz
// and sends a compact snapshot about 15 times a second over the direct peer connections; the
// other players send their stick, kick and pass buttons to the host about 20 times a second and draw the
// match one snapshot behind, smoothly interpolated. Spectators just draw the snapshots. When the
// host leaves, the hub names a new host, who carries on from the last snapshot it received.
import {
  createMatch, decodeSnapshot, encodeSnapshot, FIELD, interpolateSnapshot, matchSummary, snapshotTick, stepMatch,
} from '../games/football.js'

export const SLOTS = ['red0', 'red1', 'blue0', 'blue1']
const SNAP_MS = 1000 / 15
const INPUT_MS = 1000 / 20
const INPUT_STALE_MS = 900
const LINGER_MS = 6000
const KIT = { red: 0, blue: 1 } // shirt palette index for each team
// Each team fields one male and one female bot.
const BOT_LOOKS = [
  { body: 0, skin: 0, hair: 6, pants: 4 }, { body: 1, skin: 3, hair: 2, pants: 4 },
  { body: 1, skin: 1, hair: 5, pants: 4 }, { body: 0, skin: 2, hair: 7, pants: 4 },
]

const teamOf = (slot) => (slot.startsWith('red') ? 'red' : 'blue')

export class MatchController {
  constructor({ town }) {
    this.town = town
    this.pitch = null
    this.match = null // { id, host, state, slots, names, level, mine, from, to, toAt, ended }
    this.keys = new Set()
    this.stick = null
    this.kickDown = false
    this.passDown = false
    this.lastInputAt = 0
    this.lastSnapAt = 0
    this.inputs = new Map() // host: pid -> { mx, my, kick, pass, at, q }
    this.lastSummaryKey = ''
    this.reported = new Set()
    this.seq = 0
  }

  get pid() {
    return this.town.pid
  }

  // --- what the hub says ------------------------------------------------------------------

  /** Called on every world update with world.pitch. */
  setPitch(pitch) {
    this.pitch = pitch || null
    const live = pitch?.status === 'playing' && pitch.match
    if (live && (!this.match || this.match.id !== pitch.match.id)) this.begin(pitch)
    if (live && this.match && this.match.id === pitch.match.id) this.updateLineup(pitch)
    if (!live && this.match && !this.match.ended) {
      // The match ended on the hub (a result, or everyone left): show the last state briefly.
      this.finish()
    }
    this.publish()
  }

  begin(pitch) {
    const m = pitch.match
    const players = SLOTS.map((slot) => {
      const pid = pitch.slots[slot]
      return { id: slot, team: teamOf(slot), name: pid ? (pitch.names[pid] || 'Player') : 'Bot', ...(pid ? {} : { bot: pitch.level || 'medium' }) }
    })
    this.match = {
      id: m.id, host: m.host, slots: { ...pitch.slots }, names: { ...pitch.names }, level: pitch.level || 'medium',
      state: createMatch({ players, seed: m.seed, duration: m.duration }),
      from: null, to: null, toAt: 0, ended: null, sentEnd: false, startedAt: performance.now(),
    }
    this.inputs.clear()
    this.reported.clear()
    this.keys.clear()
    this.kickDown = false
    this.passDown = false
    this.stick = null
    if (this.isPlayer()) this.town.onMatchStart?.(this.match)
  }

  updateLineup(pitch) {
    const match = this.match
    if (pitch.match.host !== match.host) {
      const takingOver = pitch.match.host === this.pid
      // A new host carries on from the newest snapshot, not the blended frame a few ticks
      // behind it; otherwise it restarts in the past and everyone drops its snapshots as stale.
      if (takingOver && match.to) decodeSnapshot(match.state, match.to)
      // ...and goes on counting kicks from where the old host's count reached.
      if (takingOver) match.kicks = match.kc ?? 0
      match.from = null
      match.to = null
      this.lastSnapAt = 0
    }
    match.host = pitch.match.host
    for (const [i, slot] of SLOTS.entries()) {
      const pid = pitch.slots[slot]
      if (pid === match.slots[slot]) continue
      match.slots[slot] = pid
      if (pid) match.names[pid] = pitch.names[pid] || 'Player'
      // A person who drops out is replaced by a bot at once (and a bot place can be taken over).
      const p = match.state.players[i]
      if (p) {
        p.bot = pid ? undefined : match.level
        p.name = pid ? (pitch.names[pid] || 'Player') : 'Bot'
      }
    }
  }

  finish() {
    const match = this.match
    match.ended = performance.now()
    this.town.onMatchEnd?.(match, this.mySlot() ? this.myPosition() : null)
    setTimeout(() => {
      if (this.match === match) {
        this.match = null
        this.publish()
        this.town.onMatchCleared?.()
      }
    }, LINGER_MS)
  }

  // --- roles ------------------------------------------------------------------------------------

  isHost() {
    return !!this.match && !this.match.ended && this.match.host === this.pid
  }

  mySlot() {
    if (!this.match) return null
    return SLOTS.find((s) => this.match.slots[s] === this.pid) || null
  }

  isPlayer() {
    return !!this.mySlot()
  }

  /** True while this player's keys drive a footballer instead of the avatar. */
  controlling() {
    return !!this.match && !this.match.ended && this.isPlayer()
  }

  myPosition() {
    const i = SLOTS.indexOf(this.mySlot())
    const p = this.match?.state.players[i]
    return p ? { x: p.x, y: p.y } : null
  }

  // --- input ----------------------------------------------------------------------------------------

  key(dir, down) {
    if (down) this.keys.add(dir)
    else this.keys.delete(dir)
  }

  kick(down) {
    this.kickDown = down
    if (down) this.lastInputAt = 0 // send a press at once
  }

  /** The pass button: the engine rolls the ball to the teammate (alone, a soft touch ahead). */
  pass(down) {
    this.passDown = down
    if (down) this.lastInputAt = 0 // send a press at once
  }

  setStick(mx, my) {
    this.stick = mx === 0 && my === 0 ? null : { mx, my }
  }

  localInput() {
    let mx = 0, my = 0
    if (this.stick) ({ mx, my } = this.stick)
    else {
      if (this.keys.has('left')) mx -= 1
      if (this.keys.has('right')) mx += 1
      if (this.keys.has('up')) my -= 1
      if (this.keys.has('down')) my += 1
    }
    return { mx, my, kick: this.kickDown, pass: this.passDown }
  }

  // --- the frame loop ------------------------------------------------------------------------------

  frame(dt) {
    const match = this.match
    if (!match || match.ended) return
    const now = performance.now()
    if (this.isHost()) {
      const inputs = {}
      for (const [i, slot] of SLOTS.entries()) {
        const pid = match.slots[slot]
        if (!pid) continue
        if (pid === this.pid) inputs[slot] = this.localInput()
        else {
          const got = this.inputs.get(pid)
          inputs[slot] = got && now - got.at < INPUT_STALE_MS ? got : { mx: 0, my: 0, kick: false }
        }
        void i
      }
      const events = stepMatch(match.state, inputs, dt)
      this.handleEvents(events, true)
      match.kicks = (match.kicks || 0) + events.filter((e) => e.type === 'kick').length
      if (now - this.lastSnapAt >= SNAP_MS) {
        this.lastSnapAt = now
        // kc: kicks and passes so far, so the other players hear every one of them.
        this.town.mesh.broadcast({ t: 'fbs', m: match.id, s: encodeSnapshot(match.state), kc: match.kicks }, false)
      }
    } else {
      if (this.isPlayer() && now - this.lastInputAt >= INPUT_MS) {
        this.lastInputAt = now
        const { mx, my, kick, pass } = this.localInput()
        this.town.mesh.send(match.host, { t: 'fbi', m: match.id, x: Math.round(mx * 100) / 100, y: Math.round(my * 100) / 100, k: kick ? 1 : 0, p: pass ? 1 : 0, q: ++this.seq }, false)
      }
      if (match.from && match.to) {
        const alpha = Math.min(1, (now - match.toAt) / SNAP_MS)
        const events = interpolateSnapshot(match.state, match.from, match.to, alpha)
        if (events) this.handleEvents(events, false)
      }
    }
    this.publish()
  }

  onMessage(from, msg) {
    const match = this.match
    if (!match || msg.m !== match.id || match.ended) return
    if (msg.t === 'fbi' && this.isHost()) {
      const mx = Number(msg.x), my = Number(msg.y)
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return
      const prev = this.inputs.get(from)
      if (prev && typeof msg.q === 'number' && msg.q < prev.q) return
      // A peer from before the pass button sends no p: it simply never passes.
      this.inputs.set(from, { mx: Math.max(-1, Math.min(1, mx)), my: Math.max(-1, Math.min(1, my)), kick: msg.k === 1, pass: msg.p === 1, at: performance.now(), q: msg.q })
    } else if (msg.t === 'fbs' && !this.isHost() && Array.isArray(msg.s)) {
      const tick = snapshotTick(msg.s)
      if (tick == null || (match.to && tick <= snapshotTick(match.to))) return
      // The host counts its kicks (passes too): play one when the count goes up. An older host
      // sends no count, so then a ball that suddenly speeds up stands in for a kick.
      if (Number.isInteger(msg.kc)) {
        if (Number.isInteger(match.kc) && msg.kc > match.kc) this.town.onMatchEvent?.({ type: 'kick' }, false)
        match.kc = msg.kc
      } else if (match.to && kicked(match.to, msg.s)) {
        this.town.onMatchEvent?.({ type: 'kick' }, false)
      }
      match.from = match.to || msg.s
      match.to = msg.s
      match.toAt = performance.now()
      if (!match.seenSnapshot) {
        match.seenSnapshot = true
        decodeSnapshot(match.state, msg.s)
      }
    }
  }

  handleEvents(events, host) {
    for (const ev of events || []) {
      if (ev.type === 'goal' && host && !this.reported.has(`goal:${ev.tick}`)) {
        this.reported.add(`goal:${ev.tick}`)
        const s = matchSummary(this.match.state).score
        this.town.act('pitch_score', { id: this.match.id, red: s.red, blue: s.blue })
      }
      if (ev.type === 'end' && host && !this.match.sentEnd) {
        this.match.sentEnd = true
        const s = matchSummary(this.match.state).score
        this.town.act('pitch_result', { id: this.match.id, red: s.red, blue: s.blue })
      }
      this.town.onMatchEvent?.(ev, host)
    }
  }

  // --- what the renderer and the HUD see -----------------------------------------------------------

  /** Everything needed to draw the match in world pixels, or null. */
  view(field) {
    const match = this.match
    if (!match || !field) return null
    if (!this.isHost() && !match.seenSnapshot && !this.isPlayer()) return null
    const [fx, fy] = field
    const state = match.state
    const players = state.players.map((p, i) => {
      const slot = SLOTS[i]
      const pid = match.slots[slot]
      const team = teamOf(slot)
      const base = pid ? (pid === this.pid ? this.town.profile?.look : this.town.peerInfo.get(pid)?.look) : BOT_LOOKS[i]
      return {
        slot, team, pid, bot: !pid, me: pid === this.pid,
        name: pid ? (pid === this.pid ? 'You' : (match.names[pid] || 'Player')) : 'Bot',
        look: { body: 0, skin: 1, hair: 0, pants: 0, ...base, shirt: KIT[team] },
        x: fx + p.x, y: fy + p.y, vx: p.vx, vy: p.vy, facing: p.facing,
      }
    })
    const b = state.ball
    return { players, ball: { x: fx + b.x, y: fy + b.y, vx: b.vx, vy: b.vy }, summary: matchSummary(state), ended: !!match.ended }
  }

  /** Avatars the match draws itself (so their town avatars are hidden). */
  hiddenPids() {
    const match = this.match
    if (!match || (!this.isPlayer() && !match.seenSnapshot && !this.isHost())) return null
    return new Set(SLOTS.map((s) => match.slots[s]).filter(Boolean))
  }

  publish() {
    const pitch = this.pitch
    const match = this.match
    const summary = match ? matchSummary(match.state) : null
    const view = {
      status: pitch?.status || 'idle',
      kickoffAt: pitch?.kickoff_at || null,
      level: pitch?.level || 'medium',
      slots: pitch?.slots || {},
      names: pitch?.names || {},
      last: pitch?.last || null,
      mySlot: SLOTS.find((s) => pitch?.slots?.[s] === this.pid) || null,
      match: match ? {
        id: match.id, host: match.host, ended: !!match.ended, player: this.isPlayer(), host_me: this.isHost(),
        connected: this.isHost() || !!match.seenSnapshot,
        score: summary.score, phase: summary.phase, clock: Math.ceil(summary.clockLeft), phaseLeft: summary.phaseLeft,
        winner: summary.winner, lastGoal: summary.lastGoal,
        slots: { ...match.slots }, names: { ...match.names }, mySlot: this.mySlot(),
      } : null,
    }
    const key = JSON.stringify(view)
    if (key === this.lastSummaryKey) return
    this.lastSummaryKey = key
    this.town.set({ football: view })
  }
}

function kicked(prev, next) {
  const pb = prev?.[9], nb = next?.[9]
  if (!Array.isArray(pb) || !Array.isArray(nb)) return false
  const before = Math.hypot(pb[2], pb[3]), after = Math.hypot(nb[2], nb[3])
  return after - before > 120
}

export { FIELD }
