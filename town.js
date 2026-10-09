// Town: glues the game, the hub, the peer mesh and the call capability, and
// exposes one immutable UI state for React (subscribe/snapshot).
import { Game } from './engine/game.js'
import { freeTileNear, getMap, objectById, roomAt } from './engine/maps.js'
import { T } from './engine/assets.js'
import * as chess from './games/chess.js'
import * as c4 from './games/connect4.js'
import { chooseChessMove } from './games/chessbot.js'
import { chooseConnect4Column } from './games/c4bot.js'
import { HubClient, sleep } from './net/hub.js'
import { Mesh } from './net/mesh.js'
import { CallController, callCapabilityAvailable } from './av/call.js'
import { audience, hearing, keepsMedia, wantsMedia } from './av/proximity.js'
import { TownAudio } from './av/audio.js'
import { MatchController, SLOTS } from './engine/match.js'

// The platform allows an app's service about 120 requests a minute per address,
// and 60 a minute on the public route other installations forward through. So
// the town polls gently and pushes urgency instead: after a change that matters
// to someone, a peer nudge (over the direct connection) makes them sync at once.
const SYNC_MS = { active: 1100, normal: 1600, idle: 3000, hidden: 5000 }
const MIN_SYNC_GAP_MS = 300
const BUSY_BACKOFF_MS = 6000
const HEARTBEAT_MS = 1500
const PROX_MS = 200
const STAGE_LINGER_MS = 20000 // a listen-only stage call outlasts a short pause on stage
const TOAST_MS = 6500
const MAX_TILES_WIDE = 6
const YT_ID = /^[A-Za-z0-9_-]{11}$/
const EVENT_TICK_MS = 1000

// Music dips this long after the last word someone nearby said.
const VOICE_DUCK_MS = 1400

const FORTUNES = [
  'A friend is about to say hello.', 'Your next game ends in a glorious win.', 'Someone nearby shares your taste in music.',
  'An old idea will find a new home.', 'The fountain approves. Mostly.', 'You will dance before the day is done.',
  'A five-minute talk will change your mind about something.', 'Good news travels on one side of the strip.',
]

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function randomId(n = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
}

async function deviceCid() {
  const caps = window.mobius?.capabilities
  try {
    if (caps?.available('device.storage', 1)) {
      const saved = await caps.invoke('device.storage', { operation: 'get', key: 'cid' })
      if (typeof saved === 'string' && /^[a-z0-9]{8,64}$/.test(saved)) return saved
      const cid = randomId()
      await caps.invoke('device.storage', { operation: 'set', key: 'cid', value: cid })
      return cid
    }
  } catch {
    /* fall through to a per-visit id */
  }
  return randomId()
}

export function youtubeId(input) {
  const text = String(input || '').trim()
  if (YT_ID.test(text)) return text
  try {
    const url = new URL(text)
    const host = url.hostname.replace(/^www\.|^m\./, '')
    if (host === 'youtu.be') return YT_ID.test(url.pathname.slice(1, 12)) ? url.pathname.slice(1, 12) : null
    if (host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v')
      if (v && YT_ID.test(v)) return v
      const m = url.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/)
      if (m) return m[1]
    }
  } catch {
    return null
  }
  return null
}

const INITIAL = {
  ui: null,
  status: 'connecting',
  problem: null,
  online: 1,
  people: [],
  call: { available: false, state: 'off', audio: false, video: false, note: null },
  bubble: null,
  unread: 0,
  chat: [],
  toasts: [],
  overlay: null,
  roomLock: null,
  tiles: [],
  promptExtra: {},
  world: { locks: {}, bubbles: {}, tv: {}, games: {}, feed: [], events: [], invites: {}, party: null, partying: [] },
  partyHidden: false,
  onStage: false,
  zoom: 1,
  football: { status: 'idle', slots: {}, names: {}, level: 'medium', last: null, mySlot: null, match: null, kickoffAt: null },
  pid: null,
  panelRequest: null,
  dancing: null,
  songs: [],
  sound: { music: true, sfx: true },
  liveTalk: null,
}

export class Town {
  constructor({ appId, token }) {
    this.appId = appId
    this.token = token
    this.state = { ...INITIAL }
    this.listeners = new Set()
    this.subscribe = (fn) => {
      this.listeners.add(fn)
      return () => this.listeners.delete(fn)
    }
    this.snapshot = () => this.state
    this.peerInfo = new Map()
    this.outbox = []
    this.ack = 0
    this.wv = -1
    this.pid = null
    this.stopped = false
    this.seq = 0
    this.toastSeq = 0
    this.readTown = 0
    this.dismissedGames = new Set()
    this.seenFeed = new Set()
    // Music and effects: Web Audio only (the app's sandbox has no <audio> or blob: media).
    this.sound = new TownAudio({ baseUrl: `/app-assets/by-id/${appId}/` })
    this.duckFor = { cutscene: 0, voice: 0 }
    this.voiceAt = 0
    this.gains = {}
    this.football = new MatchController({ town: this })
    this.botBusy = new Set()
    this.reminded = new Set()
    this.seenInvites = new Set()
    this.inviteToasts = new Map()
    this.outgoing = new Map()
    this.serverOffset = 0
    this.lastTalkEnd = null
    this.mesh = new Mesh({
      sendSignal: (to, data) => this.mail(to, 'rtc', data, true),
      onMessage: (from, msg) => this.onPeerMessage(from, msg),
      onChange: () => {},
    })
    this.call = new CallController({
      relay: (to, data) => this.relayCall(to, data),
      onLevels: (levels) => this.onLevels(levels),
      onChange: () => this.refreshCall(),
      onNotice: (text) => this.toast(text, { long: true }),
    })
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  // --- identity -----------------------------------------------------------------------------

  async identify() {
    this.cid = await deviceCid()
    this.hub = new HubClient({ appId: this.appId, token: this.token, cid: this.cid })
    try {
      this.hello = await this.hub.hello()
    } catch (err) {
      this.hello = null
      this.helloError = err?.message || 'Möbius Town is unreachable right now.'
      return null
    }
    const me = this.hello?.me
    return me ? { handle: me.handle, name: me.name, isHub: this.hello.isHub } : { problem: this.hello?.problem }
  }

  callAvailable() {
    return callCapabilityAvailable()
  }

  callNote() {
    if (callCapabilityAvailable()) return null
    return 'Voice and video are on the way with a coming Möbius update. Until then you can walk, chat and play.'
  }

  // --- lifecycle --------------------------------------------------------------------------------

  async start(canvas, profile) {
    this.profile = profile
    // Still inside the "Enter the town" click, so the browser lets sound start.
    this.sound.unlock()
    this.game = new Game({
      canvas,
      me: { id: 'me', name: profile.name, look: profile.look },
      onEvent: (type, payload) => this.onGameEvent(type, payload),
    })
    // Cats (and anything else on the shared clock) follow the server's time, not this device's.
    this.game.serverNow = () => this.serverNow()
    this.game.onFrame = (dt) => this.footballFrame(dt)
    this.game.onZoom = (zoom) => this.set({ zoom })
    this.game.callsAvailable = this.call.available()
    if (profile.zoom) {
      // Start at the distance you left at, without gliding there.
      this.game.setZoom(profile.zoom)
      this.game.zoomLevel = this.game.zoomTarget
    }
    await this.game.load()
    this.game.start()
    this.unsubGame = this.game.subscribe(() => this.onGameUi())
    this.set({ ui: this.game.snapshot(), call: this.callView(), songs: this.sound.songs() })
    this.proxTimer = setInterval(() => this.proximityTick(), PROX_MS)
    this.eventTimer = setInterval(() => this.eventTick(), EVENT_TICK_MS)
    this.applyScene()
    if (profile.sound) this.setSoundPrefs(profile.sound)
    this.connect()
    if (profile.audio || profile.video) this.startCall({ audio: profile.audio, video: profile.video })
  }

  stop() {
    this.stopped = true
    this.wake()
    clearInterval(this.proxTimer)
    clearInterval(this.eventTimer)
    this.sound.destroy()
    this.unsubGame?.()
    this.game?.stop()
    this.mesh.close()
    this.call.stop()
    if (this.pid) this.hub?.leave()
  }

  destroy() {
    if (!this.stopped) this.stop()
  }

  setProfile(profile) {
    this.profile = profile
    this.game?.setLook(profile.look)
    this.game?.setName(profile.name)
    this.wake()
  }

  // --- hub connection -------------------------------------------------------------------------------

  async connect() {
    if (!this.hub) return
    const wakeOnline = () => this.wake()
    window.addEventListener('online', wakeOnline)
    let attempt = 0
    while (!this.stopped && !this.hello) {
      // The first check can fail transiently (a service update, a network blip): keep trying.
      try {
        this.hello = await this.hub.hello()
      } catch (err) {
        attempt++
        this.set({ status: attempt > 1 ? 'offline' : 'connecting', problem: err.message })
        await sleep(Math.min(30000, 1500 * attempt), this.wakeSignal())
      }
    }
    if (this.stopped) return
    if (this.hello.problem || !this.hello.me) {
      this.set({ status: 'offline', problem: this.hello.problem })
      this.toast(this.hello.problem, { long: true })
      return
    }
    attempt = 0
    while (!this.stopped) {
      try {
        this.set({ status: 'connecting' })
        const joined = await this.hub.join()
        this.pid = joined.pid
        this.game.me.id = joined.pid
        this.mesh.setSelf(joined.pid)
        this.set({ pid: joined.pid, problem: null })
        break
      } catch (err) {
        attempt++
        this.set({ status: 'offline', problem: err.message })
        if (err.status === 409 || err.status === 403) {
          this.toast(err.message, { long: true })
          return
        }
        await sleep(Math.min(30000, 2000 * attempt), this.wakeSignal())
      }
    }
    this.syncLoop()
  }

  wakeSignal() {
    this.waker = new AbortController()
    return this.waker.signal
  }

  wake() {
    this.waker?.abort()
  }

  syncDelay() {
    const party = this.partyDelay()
    if (party != null) return party
    const pitch = this.state.world.pitch
    if (pitch?.status === 'lobby' && pitch.kickoff_at && SLOTS.some((s) => pitch.slots?.[s] === this.pid)) {
      return Math.min(SYNC_MS.normal, Math.max(150, pitch.kickoff_at - this.serverNow() + 60))
    }
    if (document.hidden) return SYNC_MS.hidden
    const signalling = this.outbox.length > 0 || [...this.mesh.peers.values()].some((p) => p.sure?.readyState !== 'open')
    if (signalling) return SYNC_MS.active
    return this.peerInfo.size ? SYNC_MS.normal : SYNC_MS.idle
  }

  /** How soon to sync while a party runs: quickly around the secret DRAW moment, otherwise at the next timer. */
  partyDelay() {
    const p = this.state.world.party
    if (!p || p.phase === 'final' || p.finished) return null
    const now = this.serverNow()
    const g = p.game
    // The DRAW moment is secret: look a little more often inside its window. Reactions are timed
    // from the frame that shows DRAW, so a late look never costs anyone the duel.
    if (g?.kind === 'quickdraw' && g.stage === 'armed' && Array.isArray(g.window)) {
      const soon = g.window[0] - now
      return soon > 0 ? Math.min(SYNC_MS.normal, Math.max(150, soon)) : 450
    }
    // Every other change is a known timer or someone's action (which nudges us).
    if (Number.isFinite(p.wake_at)) return Math.min(SYNC_MS.normal, Math.max(150, p.wake_at - now + 40))
    return SYNC_MS.normal
  }

  presence() {
    const me = this.game.me
    const room = roomAt(this.game.map, me.x, me.y)
    return {
      map: this.game.mapId, room: room?.id || this.game.map.rooms[0].id, x: me.x, y: me.y, dir: me.dir,
      muted: this.call.live() ? !this.call.status.audio : true,
      video: this.call.live() && this.call.status.video,
      av: this.call.live(),
      status: this.game.me.dance ? `dance:${this.game.me.dance.song}`.slice(0, 40) : '',
    }
  }

  async syncLoop() {
    let failures = 0
    while (!this.stopped) {
      const started = performance.now()
      const out = this.outbox.splice(0, 40)
      try {
        const res = await this.hub.sync({
          st: this.presence(), name: this.profile.name, look: this.profile.look, out, ack: this.ack, since: this.wv,
        })
        failures = 0
        this.applySync(res)
        if (this.state.status !== 'online') this.set({ status: 'online', problem: null })
      } catch (err) {
        // Signalling is time-sensitive; drop stale offers rather than replaying them late.
        this.outbox.unshift(...out.filter((m) => m.k !== 'rtc' && m.k !== 'call'))
        if (err.status === 429) {
          // The platform's request budget: not a lost connection, just wait it out.
          await sleep(BUSY_BACKOFF_MS, this.wakeSignal())
          continue
        }
        failures++
        if (err.status === 401) {
          this.set({ status: 'offline', problem: err.message })
          this.toast(err.message, { long: true })
          return
        }
        if (failures >= 2) this.set({ status: 'offline', problem: err.message })
        if (err.status === 409) {
          // The hub forgot us (restart or long sleep): join again.
          try {
            const joined = await this.hub.join()
            this.pid = joined.pid
            this.game.me.id = joined.pid
            this.mesh.setSelf(joined.pid)
          } catch {
            /* retry on the next loop */
          }
        }
      }
      const delay = failures ? Math.min(15000, 1500 * failures) : this.syncDelay()
      await sleep(Math.max(60, delay - (performance.now() - started)), this.wakeSignal())
      // Nudges can arrive in bursts; keep a small gap so they never add up to a flood.
      const since = performance.now() - started
      if (since < MIN_SYNC_GAP_MS) await sleep(MIN_SYNC_GAP_MS - since)
    }
  }

  applySync(res) {
    if (res.pid && res.pid !== this.pid) {
      this.pid = res.pid
      this.game.me.id = res.pid
      this.mesh.setSelf(res.pid)
    }
    if (Number.isFinite(res.now)) this.serverOffset = res.now - Date.now()
    const seen = new Set()
    const nowMs = performance.now()
    for (const p of res.peers || []) {
      seen.add(p.pid)
      const prev = this.peerInfo.get(p.pid)
      const info = { ...prev, ...p, hubAt: nowMs }
      this.peerInfo.set(p.pid, info)
      const fresh = this.mesh.lastHeard(p.pid) > nowMs - 2500 && prev?.p2pAt > nowMs - 2500
      const a = this.game.upsertOther(p.pid, {
        name: p.name, look: p.look, muted: p.muted || !p.av,
        ...(fresh ? {} : { mapId: p.map, x: p.x, y: p.y, dir: p.dir }),
      })
      const danceSong = typeof p.status === 'string' && p.status.startsWith('dance:') ? p.status.slice(6) : null
      if ((a.dance?.song || null) !== danceSong) {
        this.game.setDance(p.pid, danceSong)
        this.sound.setDance(p.pid, danceSong, { map: a.mapId, x: a.x, y: a.y })
      }
    }
    for (const pid of [...this.peerInfo.keys()]) {
      if (!seen.has(pid)) {
        this.peerInfo.delete(pid)
        this.game.removeOther(pid)
        this.call.disconnect(pid)
        this.sound.setDance(pid, null)
      }
    }
    for (const m of res.inbox || []) {
      this.ack = Math.max(this.ack, m.id)
      this.onMail(m.from, m.k, m.v)
    }
    if (res.world) this.applyWorld(res.world, res.wv)
    this.set({ online: (res.peers || []).length + 1 })
    this.updateMeshWants()
  }

  applyWorld(world, wv) {
    this.wv = wv
    const prev = this.state.world
    this.game.setWorld(world)
    // Bubbles -> avatars.
    const bubbleOf = new Map()
    for (const [bid, b] of Object.entries(world.bubbles || {})) for (const pid of b.members) bubbleOf.set(pid, bid)
    this.game.me.bubbleId = bubbleOf.get(this.pid) || null
    for (const [pid, a] of this.game.others) a.bubbleId = bubbleOf.get(pid) || null
    const myBubble = bubbleOf.get(this.pid) || null
    if (myBubble && myBubble !== this.state.bubble) {
      const others = world.bubbles[myBubble].members.filter((p) => p !== this.pid)
      const names = others.map((p) => this.nameOf(p)).join(', ')
      if (!this.state.bubble) this.toast(`You're in a bubble with ${names}. Möbians nearby still hear you faintly.`)
    }
    // Town chat: the first load is history; later arrivals count as unread.
    const firstLoad = !this.feedLoaded
    this.feedLoaded = true
    const fresh = []
    for (const msg of world.feed || []) {
      if (this.seenFeed.has(msg.id)) continue
      this.seenFeed.add(msg.id)
      if (msg.pid === this.pid && !firstLoad) continue
      fresh.push(msg)
    }
    const chat = [...this.state.chat]
    for (const msg of fresh) {
      chat.push({ id: msg.id, scope: 'town', from: msg.pid, name: msg.name, text: msg.text, at: msg.at, me: msg.pid === this.pid })
    }
    chat.sort((a, b) => a.at - b.at)
    // TV image.
    const tv = world.tv?.tv
    if (tv?.video !== prev.tv?.tv?.video) this.loadTvThumb(tv?.video)
    // Games: open the board for players automatically.
    const promptExtra = {}
    for (const [tableId, g] of Object.entries(world.games || {})) {
      const mine = Object.values(g.players).includes(this.pid)
      const key = `${tableId}:${g.started}`
      const here = this.game?.mapId === g.map
      if (mine && here && !g.status?.over && !this.dismissedGames.has(key) && this.state.overlay?.table !== tableId) {
        this.dismissedGames.add(key)
        const opponent = Object.values(g.players).find((p) => p !== this.pid)
        this.set({ overlay: { kind: g.kind, table: tableId } })
        this.toast(`${g.kind === 'chess' ? 'Chess' : 'Connect Four'} with ${g.names?.[opponent] || 'a friend'} — have fun!`)
        window.mobius?.signal?.('item_created', { type: g.kind })
        this.takeSeat(tableId, g)
      }
      if (mine && !g.status?.over) this.maybeBotMove(tableId, g)
      promptExtra[tableId] = g.status?.over ? 'See the last game' : mine ? 'Back to your game' : 'Watch this game'
    }
    const partyPatch = this.applyParty(world, prev)
    this.football.setPitch(world.pitch)
    promptExtra.pitch = this.pitchPrompt(world.pitch)
    this.set({
      world, chat, unread: this.state.unread + (firstLoad ? 0 : fresh.length),
      bubble: myBubble, promptExtra, ...partyPatch,
    })
    this.eventTick()
    this.refreshRoomLock()
  }

  /** Invites and the party: toasts for challenges and answers; a new party opens its overlay. */
  applyParty(world, prev) {
    const invites = world.invites || {}
    for (const inv of Object.values(invites)) {
      if (inv.to === this.pid && inv.status === 'pending' && !this.seenInvites.has(inv.id)) {
        this.seenInvites.add(inv.id)
        const id = this.toast(`${inv.fromName} challenges you to a party: three quick games, best score wins.`, {
          ms: Math.max(5000, inv.expires - this.serverNow()),
          actions: [
            { label: 'Accept', primary: true, run: () => this.answerInvite(inv.id, true) },
            { label: 'Not now', run: () => this.answerInvite(inv.id, false) },
          ],
        })
        this.inviteToasts.set(inv.id, id)
        this.sound.play('chime')
      }
      if (inv.from === this.pid) {
        if (inv.status === 'declined') {
          if (this.outgoing.delete(inv.id)) this.toast(`${inv.toName} said not now.`)
        } else if (!this.outgoing.has(inv.id)) {
          this.outgoing.set(inv.id, inv)
        }
      }
    }
    for (const [iid, toastId] of this.inviteToasts) {
      if (invites[iid]?.status !== 'pending') {
        this.dismissToast(toastId)
        this.inviteToasts.delete(iid)
      }
    }
    for (const [iid, inv] of this.outgoing) {
      if (invites[iid]) continue
      this.outgoing.delete(iid)
      if (!world.party?.players?.includes(inv.to)) this.toast(`No answer from ${inv.toName} this time.`)
    }
    const party = world.party
    if (party && party.id !== prev.party?.id) {
      const opp = party.opponent
      if (party.phase !== 'final') {
        this.toast(`Party time with ${party.names?.[opp] || 'a friend'}! Three games: ${party.games.map((g) => party.titles?.[g] || g).join(', ')}.`)
        this.sound.play('fanfare', { volume: 0.7 })
        window.mobius?.signal?.('item_created', { type: 'party' })
      }
      return { partyHidden: false }
    }
    if (party && prev.party?.id === party.id) {
      // A game decided, or the whole party.
      const before = prev.party.results?.length || 0
      const latest = party.results?.[party.results.length - 1]
      if ((party.results?.length || 0) > before && latest && party.phase !== 'final') {
        this.sound.play(latest.winner === this.pid ? 'win' : 'lose')
      }
      if (party.phase === 'final' && prev.party.phase !== 'final') {
        this.sound.play(party.winner === this.pid ? 'fanfare' : party.draw ? 'chime' : 'lose')
      }
    }
    if (!party && this.state.partyHidden) return { partyHidden: false }
    return {}
  }

  challenge(pid) {
    return this.act('party_challenge', { to: pid }).then((r) => {
      if (r?.invite) this.toast(`Challenge sent to ${r.invite.toName}. Quick Draw, Rock–Paper–Scissors and a Speed Sprint.`)
      this.nudge(pid)
      return r
    })
  }

  answerInvite(id, accept) {
    const toastId = this.inviteToasts.get(id)
    if (toastId) this.dismissToast(toastId)
    const inv = this.state.world.invites?.[id]
    return this.act('party_answer', { id, accept }).then((r) => {
      if (inv) this.nudge(inv.from)
      return r
    })
  }

  /** Ask a peer to sync now, over the direct connection when there is one. */
  nudge(pid) {
    if (pid && pid !== this.pid) this.mesh.send(pid, { t: 'n' }, true)
  }

  /** The party overlay's actions; refusals are quiet (the overlay shows the server's state). */
  async partyAction(action) {
    const party = this.state.world.party
    if (!party || !this.pid) return null
    try {
      const res = await this.hub.act('party_act', { id: party.id, action })
      if (res.world) this.applyWorld(res.world, res.wv)
      this.nudge(party.opponent)
      return res.result
    } catch (err) {
      if (err?.status === 429) this.toast('The town is very busy right now. Try that again in a few seconds.')
      else console.info('[party]', err?.message)
      return null
    }
  }

  hideParty() {
    this.set({ partyHidden: true })
  }

  nameOf(pid) {
    if (pid === this.pid) return this.profile?.name || 'You'
    const info = this.peerInfo.get(pid)
    if (info?.name) return info.name
    for (const g of Object.values(this.state.world.games || {})) if (g.names?.[pid]) return g.names[pid]
    return 'Someone'
  }

  mail(to, k, v, urgent = false) {
    this.outbox.push({ to, k, v })
    if (urgent) this.wake()
  }

  // --- peer messages ------------------------------------------------------------------------------------

  onPeerMessage(from, msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'p') {
      const info = this.peerInfo.get(from)
      if (info) {
        if (typeof msg.s === 'number' && info.seq && msg.s <= info.seq) return
        Object.assign(info, { map: msg.m, x: msg.x, y: msg.y, dir: msg.d, seq: msg.s, p2pAt: performance.now() })
      }
      if (getMap(msg.m) && Number.isInteger(msg.x) && Number.isInteger(msg.y)) {
        this.game.upsertOther(from, { mapId: msg.m, x: msg.x, y: msg.y, dir: msg.d })
      }
    } else if (msg.t === 'c') {
      this.receiveChat(from, String(msg.text || '').slice(0, 280))
    } else if (msg.t === 'e') {
      if (['wave', 'heart', 'excl', 'q'].includes(msg.k)) this.game.showEmote(from, msg.k)
      if (msg.k === 'pet' && typeof msg.cat === 'string') this.game.petCat(msg.cat.slice(0, 24), true)
      if (msg.k === 'dance') {
        const song = typeof msg.song === 'string' ? msg.song.slice(0, 32) : null
        this.game.setDance(from, song)
        const a = this.game.others.get(from)
        if (a) this.sound.setDance(from, song, { map: a.mapId, x: a.x, y: a.y })
      }
    } else if (msg.t === 'fbi' || msg.t === 'fbs') {
      this.football.onMessage(from, msg)
    } else if (msg.t === 'sig') {
      this.call.handleSignal(from, msg.data, this.pid > from)
    } else if (msg.t === 'n') {
      this.wake()
    }
  }

  onMail(from, kind, value) {
    if (kind === 'rtc') {
      this.mesh.handleSignal(from, value)
    } else if (kind === 'call') {
      this.call.handleSignal(from, value, this.pid > from)
    } else if (kind === 'chat') {
      this.receiveChat(from, String(value?.text || '').slice(0, 280))
    } else if (kind === 'emote') {
      this.game.showEmote(from, value?.k)
    } else if (kind === 'knock') {
      const name = value?.name || this.nameOf(from)
      this.toast(`${name} is knocking on the door.`, {
        long: true,
        actions: [{ label: 'Let in', primary: true, run: () => this.act('admit', { pid: from, room: value?.room }) }],
      })
    } else if (kind === 'admit') {
      this.toast('The door is open for you — come in.')
    } else if (kind === 'nudge') {
      this.wake()
    }
  }

  broadcastPosition(moving = false) {
    if (!this.pid) return
    const me = this.game.me
    const target = me.to || me
    this.seq++
    this.mesh.broadcast({ t: 'p', m: this.game.mapId, x: target.x, y: target.y, d: me.dir, mv: moving, s: this.seq })
    this.lastBroadcast = performance.now()
  }

  // --- game events -------------------------------------------------------------------------------------

  onGameEvent(type, payload) {
    if (type === 'stepstart') {
      this.broadcastPosition(true)
    } else if (type === 'step' || type === 'turn') {
      this.broadcastPosition(false)
      this.proximityTick()
      const me = this.game.me
      this.sound.setListener({ map: this.game.mapId, x: me.x, y: me.y })
    } else if (type === 'sit') {
      if (payload.seat?.table) this.sitAtTable(payload.seat)
    } else if (type === 'stand') {
      if (this.state.overlay?.waiting) this.set({ overlay: null })
    } else if (type === 'dance') {
      this.stopDance(true)
    } else if (type === 'pet') {
      this.sound.play('pop', { volume: 0.4 })
      setTimeout(() => this.sound.play('sparkle', { volume: 0.35 }), 260)
      // People nearby see the hearts too.
      this.mesh.broadcast({ t: 'e', k: 'pet', cat: payload.id })
    } else if (type === 'cutscene') {
      this.duckFor.cutscene = payload.phase === 'start' ? 0.6 : 0
      this.updateDuck()
      this.set({ cutscene: payload.phase === 'start' ? payload.kind : null })
    } else if (type === 'doorlock' || type === 'doorunlock') {
      this.sound.play(type === 'doorlock' ? 'lock' : 'unlock', { map: this.game.mapId, x: payload.x, y: payload.y })
    } else if (type === 'map') {
      this.wake()
      this.set({ overlay: null })
      this.applyScene()
      this.sound.play('door')
      this.proximityTick()
    } else if (type === 'blocked') {
      const map = this.game.map
      const room = map.rooms.find((r) => r.door && r.door[0] === payload.x && r.door[1] === payload.y)
      if (room && (!this.lastKnockToast || performance.now() - this.lastKnockToast > 4000)) {
        this.lastKnockToast = performance.now()
        const lock = this.state.world.locks?.[`${this.game.mapId}:${room?.id}`]
        this.toast(`${room?.name || 'This room'} is locked${lock?.byName ? ` by ${lock.byName}` : ''}.`, {
          actions: [{ label: 'Knock', primary: true, run: () => this.act('knock', { room: room?.id }) }],
        })
      }
    }
  }

  onGameUi() {
    const ui = this.game.snapshot()
    this.set({ ui })
    this.refreshRoomLock()
  }

  refreshRoomLock() {
    const ui = this.game?.snapshot()
    const key = ui?.room ? `${ui.mapId}:${ui.room.id}` : null
    const lock = key ? this.state.world.locks?.[key] || null : null
    if (lock !== this.state.roomLock) this.set({ roomLock: lock })
  }

  // --- proximity, media and the mesh ----------------------------------------------------------------------

  contextOf(pid) {
    if (pid === this.pid || pid === 'me') {
      const me = this.game.me
      const map = this.game.map
      return {
        pid: this.pid, map: this.game.mapId, x: me.x, y: me.y, room: roomAt(map, me.x, me.y),
        bubble: me.bubbleId || null, onStage: this.onStage(map, me.x, me.y),
      }
    }
    const a = this.game.others.get(pid)
    if (!a) return null
    const map = getMap(a.mapId)
    if (!map) return null
    return {
      pid, map: a.mapId, x: a.x, y: a.y, room: roomAt(map, a.x, a.y), bubble: a.bubbleId || null,
      onStage: this.onStage(map, a.x, a.y),
    }
  }

  onStage(map, x, y) {
    return map.objects.some((o) => o.kind === 'spotlight' && o.tiles.some(([tx, ty]) => tx === x && ty === y))
  }

  updateMeshWants() {
    if (!this.pid) return
    const sameMap = []
    for (const [pid, info] of this.peerInfo) {
      const a = this.game.others.get(pid)
      if ((a?.mapId || info.map) === this.game.mapId) {
        const d = a ? Math.hypot(a.x - this.game.me.x, a.y - this.game.me.y) : 99
        sameMap.push([pid, d])
      }
    }
    sameMap.sort((p, q) => p[1] - q[1])
    // Opponents stay directly connected wherever they are, so moves and party actions arrive at once.
    const opponents = new Set()
    const party = this.state.world.party
    if (party?.opponent && party.phase !== 'final') opponents.add(party.opponent)
    for (const g of Object.values(this.state.world.games || {})) {
      const players = Object.values(g.players || {})
      if (!g.status?.over && players.includes(this.pid)) for (const p of players) if (p !== this.pid && this.peerInfo.has(p)) opponents.add(p)
    }
    const want = sameMap.slice(0, 24).map(([pid]) => pid)
    for (const pid of opponents) if (!want.includes(pid) && this.peerInfo.has(pid)) want.push(pid)
    this.mesh.want(want)
  }

  proximityTick() {
    if (!this.game || !this.pid) return
    const me = this.contextOf(this.pid)
    const tiles = []
    const gains = {}
    const now = performance.now()
    // Heartbeat so idle peers stay fresh over the mesh.
    if (!this.lastBroadcast || now - this.lastBroadcast > HEARTBEAT_MS) this.broadcastPosition(false)
    let stageLive = false
    for (const [pid, info] of this.peerInfo) {
      const other = this.contextOf(pid)
      if (!other) continue
      const heard = hearing(me, other)
      gains[pid] = heard.gain
      // Someone on a stage in your room, in the call: their talk reaches you wherever you sit.
      if (heard.reason === 'stage' && info.av) stageLive = true
      if (this.call.live() && info.av) {
        const connected = this.call.peers.has(pid)
        if (!connected && wantsMedia(me, other)) this.call.connect(pid, this.pid > pid)
        else if (connected && !keepsMedia(me, other)) this.call.disconnect(pid)
      }
      const media = this.call.peers.get(pid)
      if (heard.video || heard.reason === 'stage') {
        tiles.push({
          pid, name: info.name, look: info.look, gain: heard.gain, stage: heard.reason === 'stage',
          // A presenter's video is their screen, shown on the stage panel rather than the strip.
          video: !!media?.video && !media?.screen && info.video, audio: !!media?.audio && !info.muted, state: media?.state || null,
          reason: heard.reason,
        })
      }
    }
    this.gains = gains
    if (this.call.live()) this.call.setGains(gains)
    this.followStage(stageLive)
    if (me.onStage !== this.state.onStage) this.set({ onStage: me.onStage })
    // Stepping off the stage ends a presentation.
    if (!me.onStage && this.call.status.screen) {
      this.call.shareScreen(false)
      this.toast('You left the stage, so your screen share stopped.')
    }
    tiles.sort((a, b) => (b.stage - a.stage) || (b.gain - a.gain))
    const visible = tiles.slice(0, MAX_TILES_WIDE)
    const key = JSON.stringify(visible.map((t) => [t.pid, Math.round(t.gain * 10), t.video, t.audio, t.stage, t.state]))
    if (key !== this.tilesKey) {
      this.tilesKey = key
      this.set({ tiles: visible })
    }
    if (!this.lastPeopleAt || now - this.lastPeopleAt > 1000) {
      this.lastPeopleAt = now
      this.updateMeshWants()
      this.set({ people: this.peopleList(me) })
    }
  }

  peopleList(me) {
    const list = []
    for (const [pid, info] of this.peerInfo) {
      const ctx = this.contextOf(pid)
      const map = getMap(ctx?.map || info.map)
      const room = ctx ? ctx.room : null
      const where = room && room.name !== map?.name ? `${map?.name} · ${room.name}` : map?.name || 'Somewhere'
      const heard = ctx ? hearing(me, ctx) : { gain: 0, reason: 'away' }
      list.push({
        pid, name: info.name, handle: info.handle, look: info.look, where, mapId: ctx?.map || info.map,
        near: heard.gain > 0, gain: heard.gain, reason: heard.reason, muted: info.muted || !info.av,
        x: ctx?.x, y: ctx?.y, media: this.call.peers.get(pid)?.state || null,
        direct: this.mesh.isOpen(pid),
      })
    }
    list.sort((a, b) => (b.near - a.near) || a.name.localeCompare(b.name))
    return list
  }

  relayCall(to, data) {
    if (this.mesh.send(to, { t: 'sig', data }, true)) return
    this.mail(to, 'call', data, true)
  }

  onLevels(levels) {
    this.game?.setSpeaking(this.pid, levels?.self || 0)
    let heard = 0
    for (const [pid, level] of Object.entries(levels?.peers || {})) {
      this.game?.setSpeaking(pid, level)
      heard = Math.max(heard, (level || 0) * (this.gains[pid] ?? 0))
    }
    // Music steps back while someone you can hear is talking.
    const now = performance.now()
    if (heard > 0.06) this.voiceAt = now
    const voice = now - this.voiceAt < VOICE_DUCK_MS ? 1 : 0
    if (voice !== this.duckFor.voice) {
      this.duckFor.voice = voice
      this.updateDuck()
    }
  }

  updateDuck() {
    this.sound.duck(Math.max(this.duckFor.cutscene, this.duckFor.voice * 0.85))
  }

  callView() {
    const s = this.call.status
    return {
      available: this.call.available(),
      state: s.state === 'live' ? 'live' : s.state,
      audio: s.audio,
      video: s.video,
      screen: !!s.screen,
      screenError: s.screenError || null,
      // People sharing a screen whose share has reached us.
      presenters: [...this.call.peers].filter(([, p]) => p.screen && p.state === 'connected').map(([pid]) => pid),
      note: s.error === 'unavailable' || !this.call.available() ? this.callNote() : s.error,
    }
  }

  /** Share your screen with the room from the auditorium stage (or stop). */
  async shareScreen(on) {
    if (!on) {
      this.call.shareScreen(false)
      return
    }
    if (!this.contextOf(this.pid)?.onStage) {
      this.toast('Step into the stage spotlight to share your screen with the room.')
      return
    }
    // Presenting makes it your own call, even one joined just to watch.
    this.stageCall = false
    // No call yet: join without microphone or camera (no device prompt), then share.
    // The microphone button still works afterwards: the browser is asked for it then.
    if (!this.call.live()) await this.startCall({ audio: false, video: false })
    if (this.call.live()) this.call.shareScreen(true)
  }

  refreshCall() {
    const s = this.call.status
    if (s.state === 'live' && s.playback === 'suspended' && !this.soundToastShown) {
      this.soundToastShown = true
      this.toast('Your browser paused sound until you tap.', {
        actions: [{ label: 'Turn on sound', primary: true, run: () => this.call.resumeAudio() }],
      })
    }
    if (s.playback === 'running') this.soundToastShown = false
    if (this.wasLive && s.state === 'off' && !this.stopped && !this.callStopping) {
      this.toast('Voice and video stopped. Tap the microphone to rejoin.')
    }
    this.wasLive = s.state === 'live'
    // A call this town ended on purpose stays quiet until it has really ended.
    if (s.state !== 'live') this.callStopping = false
    this.set({ call: this.callView() })
    this.wake()
  }

  async startCall({ audio, video }) {
    const ok = await this.call.start({ audio, video })
    if (!ok && this.call.status.error && this.call.status.error !== 'unavailable') this.toast(this.call.status.error, { long: true })
    if (ok && video && !this.call.status.video) this.toast('No camera found — joining with your microphone.')
    if (ok && audio && !this.call.status.audio && this.call.status.audioError) {
      this.toast('No microphone is available — others can see you but not hear you.')
    }
    this.refreshCall()
  }

  // In a call without a microphone or camera (joined to watch the stage, or to share a screen),
  // turning one on asks the browser for it then; a refusal arrives as a notice.
  toggleMic() {
    if (!this.call.available()) return this.toast(this.callNote(), { long: true })
    if (!this.call.live()) return this.startCall({ audio: true, video: false })
    this.stageCall = false // speaking up makes it your own call
    this.call.setLocal({ audio: !this.call.status.audio })
    this.call.resumeAudio()
  }

  toggleCam() {
    if (!this.call.available()) return this.toast(this.callNote(), { long: true })
    if (!this.call.live()) return this.startCall({ audio: true, video: true })
    this.stageCall = false
    this.call.setLocal({ video: !this.call.status.video })
  }

  /**
   * Someone speaking or presenting from a stage reaches everyone in the room, including people
   * who never turned on a microphone. They join without microphone or camera (no device prompt),
   * so the talk and any shared screen arrive, and that call ends by itself once the stage has
   * been empty for a while, unless they turned on their microphone or camera meanwhile.
   */
  followStage(stageLive) {
    const now = performance.now()
    if (stageLive) this.stageSeenAt = now
    const s = this.call.status
    if (stageLive && s.state === 'off' && !this.stopped && !this.stageJoinFailed && this.call.available()) {
      this.stageCall = true
      this.startCall({ audio: false, video: false }).then(() => {
        // Do not retry in a loop after a failure; the microphone button still works.
        if (!this.call.live()) this.stageJoinFailed = true
      })
      return
    }
    if (this.stageCall && this.call.live() && !stageLive && !s.audio && !s.video && !s.screen
      && now - (this.stageSeenAt || 0) > STAGE_LINGER_MS) {
      this.stageCall = false
      this.callStopping = true
      this.call.stop()
    }
  }

  // --- actions ---------------------------------------------------------------------------------------------

  async act(op, args = {}) {
    if (!this.pid) {
      this.toast(this.state.problem || 'Connect to the town first.')
      return null
    }
    try {
      const res = await this.hub.act(op, args)
      if (res.world) this.applyWorld(res.world, res.wv)
      return res.result
    } catch (err) {
      this.toast(err.status === 429 ? 'The town is very busy right now. Try that again in a few seconds.' : err.message)
      return null
    }
  }

  toggleRoomLock() {
    const ui = this.game.snapshot()
    if (!ui.room?.lockable) return
    if (this.state.roomLock) this.act('unlock', { room: ui.room.id })
    else this.act('lock').then((r) => { if (r) this.toast(`${ui.room.name} is locked. Only Möbians inside can come and go.`) })
  }

  toggleBubble() {
    if (this.state.bubble) {
      this.act('bubble_leave')
      return
    }
    const me = this.contextOf(this.pid)
    if (!me) return
    const near = []
    let joinable = null
    for (const pid of this.peerInfo.keys()) {
      const o = this.contextOf(pid)
      if (!o || o.map !== me.map || o.room?.id !== me.room?.id) continue
      if (Math.hypot(o.x - me.x, o.y - me.y) <= 3.2) {
        near.push(pid)
        if (o.bubble) joinable = o.bubble
      }
    }
    if (!near.length) {
      this.toast('Walk up to someone first — a bubble wraps you and everyone within a few steps.')
      return
    }
    if (joinable) this.act('bubble_join', { bubble: joinable })
    else this.act('bubble', { with: near })
  }

  emote(kind, song = null) {
    if (kind === 'dance') return this.startDance(song)
    this.game?.showEmote(this.game.me.id, kind)
    this.mesh.broadcast({ t: 'e', k: kind }, true)
    if (kind === 'heart') this.sound.play('sparkle', { volume: 0.5 })
    else this.sound.play('pop', { volume: 0.5 })
  }

  startDance(song = null) {
    const songs = this.sound.songs()
    const id = song || this.profile?.danceSong || songs[0]?.id || 'groove'
    if (this.game.me.dance?.song === id) return this.stopDance()
    this.game.me.seat = null
    this.game.setDance(this.game.me.id, id)
    this.sound.setDance('me', id)
    this.mesh.broadcast({ t: 'e', k: 'dance', song: id }, true)
    this.set({ dancing: id })
    this.wake()
  }

  stopDance(already = false) {
    if (!already) this.game.setDance(this.game.me.id, null)
    this.sound.setDance('me', null)
    this.mesh.broadcast({ t: 'e', k: 'dance', song: null }, true)
    if (this.state.dancing) this.set({ dancing: null })
    this.wake()
  }

  sendChat(text, scope) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 280)
    if (!clean) return
    const at = Date.now()
    if (scope === 'town') {
      this.act('chat', { text: clean })
      this.push({ id: `me-${at}`, scope: 'town', from: this.pid, name: this.profile.name, text: clean, at, me: true })
      return
    }
    this.game.showChat(this.game.me.id, clean)
    const me = this.contextOf(this.pid)
    const others = [...this.peerInfo.keys()].map((pid) => this.contextOf(pid)).filter(Boolean)
    const listeners = me ? audience(me, others) : []
    for (const o of listeners) {
      if (!this.mesh.send(o.pid, { t: 'c', text: clean }, true)) this.mail(o.pid, 'chat', { text: clean }, true)
    }
    this.push({
      id: `me-${at}`, scope: 'nearby', from: this.pid, name: this.profile.name, text: clean, at, me: true,
      heardBy: listeners.length,
    })
  }

  receiveChat(from, text) {
    if (!text) return
    this.game.showChat(from, text)
    this.push({ id: `${from}-${Date.now()}`, scope: 'nearby', from, name: this.nameOf(from), text, at: Date.now() })
    this.set({ unread: this.state.unread + 1 })
  }

  push(entry) {
    const chat = [...this.state.chat, entry].slice(-200)
    this.set({ chat })
  }

  markRead() {
    if (this.state.unread) this.set({ unread: 0 })
  }

  toast(text, { long = false, actions = [], ms = null } = {}) {
    if (!text) return null
    const id = ++this.toastSeq
    const toasts = [...this.state.toasts.filter((t) => t.text !== text), { id, text, actions }].slice(-3)
    this.set({ toasts })
    setTimeout(() => this.dismissToast(id), ms || (long || actions.length ? 15000 : TOAST_MS))
    return id
  }

  dismissToast(id) {
    if (this.state.toasts.some((t) => t.id === id)) this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) })
  }

  closeOverlay() {
    this.set({ overlay: null })
  }

  // --- interacting with the world ----------------------------------------------------------------------

  petCat(id) {
    this.game.petCat(id)
  }

  // --- football ------------------------------------------------------------------------------------

  pitchField() {
    if (!this.field) this.field = getMap('town').objects.find((o) => o.kind === 'pitch')?.field || null
    return this.field
  }

  footballFrame(dt) {
    this.football.frame(dt)
    const onTown = this.game.mapId === 'town'
    const field = this.pitchField()
    this.game.footballView = onTown ? this.football.view(field) : null
    this.game.hiddenAvatars = onTown ? this.football.hiddenPids() : null
    this.game.matchFit = onTown && field && this.football.controlling()
      ? { w: field[2] + 56, h: field[3] + 96, cx: field[0] + field[2] / 2, cy: field[1] + field[3] / 2 }
      : null
  }

  pitchPrompt(pitch) {
    if (!pitch) return 'Play football'
    const mine = SLOTS.some((s) => pitch.slots?.[s] === this.pid)
    if (mine) return pitch.status === 'playing' ? 'You are playing' : 'You are in the line-up'
    const free = SLOTS.some((s) => !pitch.slots?.[s])
    if (pitch.status === 'playing') return free ? 'Join the match (take a bot\u2019s place)' : 'The match is full: watch from the side'
    return pitch.status === 'lobby' ? 'Join the match' : 'Play football'
  }

  joinPitch(team) {
    // The lobby panel that opens explains the controls, so no toast here.
    return this.act('pitch_join', team ? { team } : {}).then((r) => {
      this.wake()
      return r
    })
  }

  leavePitch() {
    this.football.keys.clear()
    return this.act('pitch_leave').then((r) => { this.wake(); return r })
  }

  setPitchLevel(level) {
    return this.act('pitch_level', { level })
  }

  onMatchStart() {
    this.sound.play('chime', { volume: 0.7 })
  }

  onMatchEvent(ev) {
    const mine = this.football.mySlot()
    const team = mine ? (mine.startsWith('red') ? 'red' : 'blue') : null
    if (ev.type === 'kick') this.sound.play('click', { volume: 0.55 })
    else if (ev.type === 'post') this.sound.play('pop', { volume: 0.35 })
    else if (ev.type === 'goal') this.sound.play(team ? (ev.team === team ? 'fanfare' : 'lose') : 'chime', { volume: 0.75 })
    else if (ev.type === 'end') this.sound.play(team && ev.winner === team ? 'win' : ev.winner === 'draw' || !team ? 'chime' : 'lose')
  }

  onMatchEnd(match, pos) {
    this.football.keys.clear()
    const field = this.pitchField()
    if (!pos || !field || this.game.mapId !== 'town') return
    // Step back into town where your footballer finished, on the nearest free tile.
    const tx = Math.round((field[0] + pos.x) / T - 0.5)
    const ty = Math.round((field[1] + pos.y) / T - 0.5)
    const spot = freeTileNear(getMap('town'), tx, ty, 3)
    if (spot) this.game.teleport('town', spot[0], spot[1], 'down')
  }

  tapAt(sx, sy) {
    const tile = this.game.screenToTile(sx, sy)
    const map = this.game.map
    // Tapping a cat walks over to it and pets it if it is still there.
    const cat = this.game.cats.find((c) => Math.abs(c.x / T - 0.5 - tile.x) < 1 && Math.abs((c.y - 13) / T - tile.y) < 1)
    if (cat) {
      const spot = freeTileNear(map, Math.round(cat.x / T - 0.5), Math.round((cat.y - 13) / T), 1)
      if (spot) {
        this.game.walkTo(spot[0], spot[1], () => { if (this.game.nearCat?.id === cat.id) this.petCat(cat.id) })
        return
      }
    }
    const target = map.objects.find((o) => {
      if (o.rect) {
        const [x, y, w, h] = o.rect
        return tile.x >= x && tile.x < x + w && tile.y >= y && tile.y < y + h
      }
      if (o.kind === 'tv') return tile.y <= 3 && o.use.some(([x]) => x === tile.x)
      return (o.use || o.tiles || []).some(([x, y]) => x === tile.x && y === tile.y)
    })
    if (target && target.kind !== 'lamp') {
      const spots = target.seats ? target.seats.map((s) => [s.x, s.y]) : target.use || target.tiles || []
      const me = this.game.me
      const best = [...spots].sort((a, b) => Math.hypot(a[0] - me.x, a[1] - me.y) - Math.hypot(b[0] - me.x, b[1] - me.y))[0]
      if (best) {
        this.game.walkTo(best[0], best[1], () => this.interact(target.id))
        return
      }
    }
    this.game.walkTo(tile.x, tile.y)
  }

  interact(objectId = null) {
    const map = this.game.map
    const near = this.game.snapshot().object
    if (!objectId && near?.kind === 'cat') {
      this.petCat(near.id)
      return
    }
    const obj = objectId ? objectById(map, objectId) : (() => {
      const ui = this.game.snapshot()
      return ui.object ? objectById(map, ui.object.id) : null
    })()
    if (!obj) return
    switch (obj.kind) {
      case 'sign':
        this.set({ overlay: { kind: 'sign', title: obj.text, text: SIGN_TEXT[obj.id] || null } })
        break
      case 'notice':
        this.set({ panelRequest: { panel: 'chat', tab: 'town', at: Date.now() } })
        break
      case 'pitch':
        if (!this.football.isPlayer()) this.joinPitch()
        break
      case 'statue':
        if (this.game.playCutscene('statue', {
          focus: obj.focus, duration: 7, caption: 'THE FOUNDER', sub: 'Built by agents, for people.',
        })) this.sound.play('fanfare')
        break
      case 'fountain': {
        const me = this.game.me
        const from = [me.fx * 16 + 8, me.fy * 16 - 8]
        const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)]
        if (this.game.playCutscene('fountain', {
          focus: obj.focus, duration: 5.2, caption: 'MAKE A WISH', sub: fortune, data: { from },
        })) {
          this.sound.play('coin')
          setTimeout(() => this.sound.play('splash'), 1900)
          setTimeout(() => this.sound.play('chime', { volume: 0.7 }), 2300)
        }
        break
      }
      case 'mobius':
        if (this.game.playCutscene('mobius', {
          focus: obj.focus, duration: 6, caption: 'ONE SIDE. ONE EDGE.', sub: 'Everyone in town is on the same side.',
        })) this.sound.play('sparkle')
        break
      case 'tv':
        this.set({ overlay: { kind: 'tv' } })
        break
      case 'chess':
      case 'connect4': {
        const game = this.state.world.games?.[obj.id]
        if (game) this.set({ overlay: { kind: obj.kind, table: obj.id } })
        else this.openTable(obj.id, obj.kind)
        break
      }
      case 'spotlight':
        this.toast("You're in the spotlight: everyone in the auditorium can hear and see you.")
        break
      default:
    }
  }

  // --- getting around ---------------------------------------------------------------------------------------

  goTo(placeId) {
    const place = PLACES.find((p) => p.id === placeId)
    if (!place || !this.game) return
    const [x, y] = place.exact ? [place.x, place.y] : freeTileNear(getMap(place.map), place.x, place.y, 2)
    const ok = this.game.routeTo(place.map, x, y)
    if (!ok) this.toast("Can't find a way there from here.")
  }

  walkToPerson(pid) {
    const a = this.game?.others.get(pid)
    if (!a) return
    this.game.routeTo(a.mapId, a.x, a.y)
  }

  // --- table games ---------------------------------------------------------------------------------------

  /** Sitting down at a game table: rejoin your game, watch, or wait (with a bot on offer). */
  sitAtTable(seat) {
    const kind = this.game.map.objects.find((o) => o.id === seat.table)?.kind
    const game = this.state.world.games?.[seat.table]
    if (game && !game.status?.over) {
      this.set({ overlay: { kind: game.kind, table: seat.table } })
      return
    }
    this.openTable(seat.table, kind)
  }

  openTable(table, kind) {
    this.act('sit', { table }).then((r) => {
      if (r?.game) this.set({ overlay: { kind: r.game.kind, table } })
      else if (r?.waiting) this.set({ overlay: { kind, table, waiting: true } })
    })
  }

  playBot(table, level) {
    this.act('sit', { table, bot: level }).then((r) => {
      if (!r?.game) return
      const key = `${table}:${r.game.started}`
      this.dismissedGames.add(key)
      this.set({ overlay: { kind: r.game.kind, table } })
      window.mobius?.signal?.('item_created', { type: `${r.game.kind}-bot` })
    })
  }

  /** When a game starts, walk to (and sit in) your seat at that table. */
  takeSeat(tableId, g) {
    const table = this.game.map.objects.find((o) => o.id === tableId)
    const side = Object.entries(g.players).find(([, p]) => p === this.pid)?.[0]
    const seat = table?.seats?.find((s) => s.side === side)
    if (!seat || (this.game.me.x === seat.x && this.game.me.y === seat.y)) return
    this.game.walkTo(seat.x, seat.y)
  }

  /** Bots think in this browser; the hub checks every move is legal. */
  maybeBotMove(tableId, g) {
    const botPid = g.players[g.turn]
    if (!botPid?.startsWith('bot:') || this.botBusy.has(tableId)) return
    const level = botPid.slice(4)
    const key = `${tableId}:${g.state.moves.length}`
    this.botBusy.add(tableId)
    setTimeout(async () => {
      try {
        let move = null
        if (g.kind === 'chess') {
          move = chooseChessMove(chess.parseFen(g.state.fen), { level, positions: g.state.positions, timeBudgetMs: 450 })
        } else {
          move = chooseConnect4Column({ cells: g.state.cells, turn: g.turn }, { level, timeBudgetMs: 250 })
        }
        if (move !== null && move !== undefined) await this.act('move', { table: tableId, move, bot: true })
      } finally {
        this.botBusy.delete(tableId)
        void key
      }
    }, 450 + Math.random() * 500)
  }

  // --- events ---------------------------------------------------------------------------------------------

  serverNow() {
    return Date.now() + this.serverOffset
  }

  createEvent(fields) {
    return this.act('event_create', fields)
  }

  /** Reminders, and the auditorium's live talk board. Runs every second. */
  eventTick() {
    if (!this.game) return
    const now = this.serverNow()
    const events = this.state.world.events || []
    for (const ev of events) {
      const startsIn = ev.starts - now
      const going = ev.going?.includes(this.pid)
      const soonKey = `${ev.id}:soon`
      const nowKey = `${ev.id}:now`
      if (startsIn > 0 && startsIn <= 5 * 60_000 && !this.reminded.has(soonKey)) {
        this.reminded.add(soonKey)
        if (going || ev.host === this.pid) {
          this.toast(`${ev.title} starts in ${Math.max(1, Math.round(startsIn / 60_000))} min at ${PLACE_NAMES[ev.place] || 'town'}.`, {
            actions: [{ label: 'Walk there', primary: true, run: () => this.goTo(EVENT_PLACE_TO_PLACE[ev.place] || 'plaza') }],
          })
        }
      }
      if (startsIn <= 0 && startsIn > -60_000 && !this.reminded.has(nowKey)) {
        this.reminded.add(nowKey)
        this.toast(`${ev.title} is starting now at ${PLACE_NAMES[ev.place] || 'town'}.`, {
          actions: [{ label: 'Walk there', primary: true, run: () => this.goTo(EVENT_PLACE_TO_PLACE[ev.place] || 'plaza') }],
        })
        this.sound.play('chime', { volume: 0.6 })
      }
    }
    // The stage board in the auditorium.
    const live = events.find((e) => e.place === 'stage' && e.starts - 15 * 60_000 <= now && now <= e.starts + e.minutes * 60_000)
    let board = null
    let liveTalk = null
    if (live) {
      const cur = live.current
      if (cur && live.slots[cur.slot]) {
        const left = cur.seconds - (now - cur.started) / 1000
        const speaker = live.slots[cur.slot]
        board = { title: live.title, line: `${speaker.name} · ${left > 0 ? formatClock(left) : "Time's up!"}`, warn: left <= 30 }
        liveTalk = { event: live.id, slot: cur.slot, speaker: speaker.name, title: speaker.title, left: Math.max(0, left) }
        const endKey = `${live.id}:${cur.slot}:${cur.started}`
        if (left <= 0 && this.lastTalkEnd !== endKey) {
          this.lastTalkEnd = endKey
          if (this.game.mapId === 'hall') {
            this.sound.play('chime')
            this.toast(`Time's up for ${speaker.name}! Give them a hand.`)
          }
        }
      } else {
        const next = live.slots.length ? `${live.slots.length} talk${live.slots.length === 1 ? '' : 's'} lined up` : 'Sign up to talk in Events'
        board = { title: live.title, line: live.starts > now ? `Starts ${formatClock((live.starts - now) / 1000)} · ${next}` : next }
      }
    }
    this.game.stageBoard = board
    const prev = this.state.liveTalk
    if (JSON.stringify(prev && { ...prev, left: Math.ceil(prev.left) }) !== JSON.stringify(liveTalk && { ...liveTalk, left: Math.ceil(liveTalk.left) })) {
      this.set({ liveTalk })
    }
  }

  // --- sound ------------------------------------------------------------------------------------------------

  applyScene() {
    if (!this.game) return
    const map = this.game.mapId
    this.sound.setScene(map === 'town' ? 'town' : map === 'cinema' ? 'silent' : 'interior')
    this.sound.setEmitters((this.game.map.fires || []).map((f) => ({
      id: f.id, map, x: f.x, y: f.y, sound: 'fire', radius: f.small ? 4 : 7, volume: f.small ? 0.35 : 0.7,
    })))
    const me = this.game.me
    this.sound.setListener({ map, x: me.x, y: me.y })
  }

  setSoundPrefs(prefs) {
    const next = { ...this.state.sound, ...prefs }
    this.sound.setEnabled(next)
    this.set({ sound: next })
  }

  gameMove(table, move) {
    return this.act('move', { table, move }).then((r) => {
      const game = r?.game
      if (game) {
        const opponent = Object.values(game.players).find((p) => p !== this.pid)
        this.nudge(opponent)
      }
      return r
    })
  }

  // --- the cinema TV -----------------------------------------------------------------------------------

  async setTv(input) {
    const id = youtubeId(input)
    if (!id) {
      this.toast('Paste a YouTube link, like youtube.com/watch?v=…')
      return false
    }
    let title = ''
    try {
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${this.token}` } })
      if (res.ok) title = (await res.json())?.title || ''
    } catch {
      /* title is optional */
    }
    const r = await this.act('tv', { screen: 'tv', video: id, title })
    return !!r
  }

  clearTv() {
    return this.act('tv', { screen: 'tv', video: null })
  }

  openTv() {
    const tv = this.state.world.tv?.tv
    if (!tv) return
    const offset = Math.max(0, Math.floor((Date.now() - tv.at) / 1000))
    const url = `https://www.youtube.com/watch?v=${tv.video}${offset > 5 ? `&t=${offset}s` : ''}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async loadTvThumb(video) {
    if (!video) {
      this.game.setTvImage(null)
      return
    }
    try {
      const url = `https://i.ytimg.com/vi/${video}/mqdefault.jpg`
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${this.token}` } })
      if (!res.ok) throw new Error('thumbnail')
      const blob = await res.blob()
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const img = new Image()
      img.onload = () => this.game.setTvImage(img)
      img.src = dataUrl
      this.set({ tvThumb: dataUrl })
    } catch {
      this.game.setTvImage(null)
    }
  }
}

export const PLACES = [
  { id: 'plaza', name: 'Town square', map: 'town', x: 31, y: 28 },
  { id: 'hall', name: 'Town Hall', map: 'hall', x: 14, y: 12 },
  { id: 'meet-a', name: 'Meeting Room A', map: 'hall', x: 7, y: 5 },
  { id: 'meet-b', name: 'Meeting Room B', map: 'hall', x: 7, y: 12 },
  { id: 'stage', name: 'Auditorium stage', map: 'hall', x: 24, y: 5, exact: true },
  { id: 'chess', name: 'Chess Club', map: 'chess', x: 8, y: 8 },
  { id: 'den', name: 'Game Den', map: 'den', x: 8, y: 8 },
  { id: 'cinema', name: 'Cinema', map: 'cinema', x: 9, y: 4 },
  { id: 'cafe', name: 'Café', map: 'cafe', x: 7, y: 7 },
  { id: 'fountain', name: 'Fountain', map: 'town', x: 32, y: 26, exact: true },
  { id: 'statue', name: 'Founder statue', map: 'town', x: 47, y: 25, exact: true },
  { id: 'garden', name: 'Möbius Garden', map: 'town', x: 32, y: 45, exact: true },
  { id: 'pond', name: 'Pond', map: 'town', x: 48, y: 45 },
  { id: 'football', name: 'Football Ground', map: 'town', x: 32, y: 53, exact: true },
]

const PLACE_NAMES = {
  stage: 'the Auditorium', plaza: 'the town square', cafe: 'the Café', cinema: 'the Cinema',
  garden: 'the Möbius Garden', 'meet-a': 'Meeting Room A', 'meet-b': 'Meeting Room B', football: 'the Football Ground',
}
const EVENT_PLACE_TO_PLACE = { stage: 'stage', plaza: 'plaza', cafe: 'cafe', cinema: 'cinema', garden: 'garden', 'meet-a': 'meet-a', 'meet-b': 'meet-b' }

const SIGN_TEXT = {
  'pitch-sign': 'Walk onto the pitch to join a match: two against two, three minutes, and bots fill any empty place. Arrow keys or WASD to run, Space or X to kick.',
  welcome: 'Welcome, Möbian! Walk up to others to talk — what you say reaches whoever is close. Houses hold games: the Chess Club and the Game Den start a match when two Möbians walk in. Meet privately in the Town Hall, take the stage in its auditorium, or put something on at the Cinema.',
  'sign-chess': 'Two Möbians inside means a game of chess. Spectators welcome.',
  'sign-den': 'Connect Four for two. Walk in with a friend.',
  'sign-cinema': 'Walk up to the screen and press X to choose what plays.',
  'sign-cafe': 'Grab a table and catch up. Bubbles welcome.',
  'lobby-desk': 'The meeting rooms on the left can be locked from inside. The auditorium on the right has a spotlight on stage: whoever stands in it is heard by the whole room.',
  statue: 'A statue of the first Möbius agent, who laid out these streets. The plaque reads: “Built by agents, for people.”',
}
