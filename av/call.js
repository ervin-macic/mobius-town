// The app's side of Möbius's `media.call` capability.
//
// The shell owns the microphone, camera, peer connections, playback and video
// painting; this controller only relays signalling between players, sets
// per-person volumes and tells the shell where to paint video tiles.

const CAP = 'media.call'
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]

export function callCapabilityAvailable() {
  try {
    return !!window.mobius?.capabilities?.available(CAP, 1)
  } catch {
    return false
  }
}

export class CallController {
  constructor({ relay, onLevels, onChange, onNotice }) {
    this.relay = relay
    this.onLevels = onLevels || (() => {})
    this.onChange = onChange || (() => {})
    this.onNotice = onNotice || (() => {})
    // Devices the call has (a call joined to listen has none until you turn one on).
    this.has = { audio: false, video: false }
    this.deviceRequested = null // 'audio' | 'video' while the browser is asked for one
    this.session = null
    this.status = { state: 'off', audio: false, video: false, error: null }
    this.peers = new Map() // pid -> { state, audio, video, polite }
    this.gains = new Map()
    this.lastTilesKey = ''
    this.tileSets = {} // source -> tiles (the video strip, the stage screen); sent to the shell merged
    this.startedAt = 0
    this.screenRequested = false
  }

  available() {
    return callCapabilityAvailable()
  }

  live() {
    return this.status.state === 'live'
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this.onChange()
  }

  async start({ audio = true, video = true } = {}) {
    if (!this.available()) {
      this.setStatus({ state: 'off', error: 'unavailable' })
      return false
    }
    if (this.session) return this.live()
    this.setStatus({ state: 'starting', error: null })
    let session
    try {
      session = window.mobius.capabilities.open(CAP, { audio, video, iceServers: ICE })
    } catch (err) {
      this.setStatus({ state: 'error', error: err?.message || 'Could not start voice and video.' })
      return false
    }
    this.session = session
    session.on('signal', ({ peer, data } = {}) => {
      if (typeof peer === 'string' && data) this.relay(peer, data)
    })
    session.on('peer', (value = {}) => {
      if (typeof value.peer !== 'string') return
      const prev = this.peers.get(value.peer) || {}
      this.peers.set(value.peer, { ...prev, state: value.state, audio: !!value.audio, video: !!value.video, screen: !!value.screen })
      if (value.state === 'closed' || value.state === 'failed') this.peers.delete(value.peer)
      this.onChange()
    })
    session.on('levels', (value = {}) => this.onLevels(value))
    session.on('local', (value = {}) => {
      if (value.screen) this.screenRequested = false
      for (const kind of ['audio', 'video']) {
        if (!value[kind]) continue
        this.has[kind] = true
        if (this.deviceRequested === kind) this.deviceRequested = null
      }
      this.setStatus({ audio: !!value.audio, video: !!value.video, screen: !!value.screen, screenError: null })
    })
    session.on('playback', (value = {}) => this.setStatus({ playback: value.state || 'running' }))
    session.on('error', (value = {}) => {
      if (value.code === 'limit_exceeded') this.setStatus({ crowded: true })
      const refused = value.code === 'denied' || value.code === 'unavailable'
      if (this.screenRequested && refused) {
        this.screenRequested = false
        this.setStatus({
          screenError: value.code === 'denied'
            ? 'Screen sharing was cancelled, or your browser blocked it.'
            : 'This browser cannot share a screen.',
        })
      } else if (this.deviceRequested && refused) {
        const device = this.deviceRequested === 'audio' ? 'microphone' : 'camera'
        this.deviceRequested = null
        this.onNotice(value.code === 'denied'
          ? `Your browser blocked the ${device}. Allow it for this site, then try again.`
          : `No ${device} is available on this device, or another app is using it.`)
      }
    })
    session.result.catch(() => {}).finally(() => {
      if (this.session === session) {
        this.session = null
        this.has = { audio: false, video: false }
        this.deviceRequested = null
        this.peers.clear()
        this.gains.clear()
        this.lastTilesKey = ''
        this.tileSets = {}
        this.setStatus({ state: 'off', audio: false, video: false, screen: false })
      }
    })
    try {
      const ready = await session.ready
      this.startedAt = performance.now()
      this.has = { audio: !!ready?.audio, video: !!ready?.video }
      this.setStatus({
        state: 'live', audio: !!ready?.audio, video: !!ready?.video, error: null,
        videoError: ready?.videoError || null, audioError: ready?.audioError || null,
        playback: ready?.playback || 'running',
      })
      return true
    } catch (err) {
      const denied = err?.code === 'denied'
      this.session = null
      this.setStatus({
        state: 'error', audio: false, video: false,
        error: denied ? 'Microphone and camera access was blocked. Allow it in your browser to talk.'
          : (err?.message || 'Could not start voice and video.'),
      })
      return false
    }
  }

  stop() {
    const s = this.session
    if (!s) return
    try {
      s.finish().catch(() => {})
    } catch {
      /* already closed */
    }
  }

  control(action, value) {
    if (!this.session) return
    try {
      this.session.control(action, value)?.catch?.(() => {})
    } catch {
      /* session ended */
    }
  }

  setLocal(patch) {
    const shown = {}
    for (const kind of ['audio', 'video']) {
      if (patch[kind] === undefined) continue
      // A device the call does not have yet is asked for now; the shell reports when it is on.
      if (patch[kind] && !this.has[kind]) this.deviceRequested = kind
      else shown[kind] = patch[kind]
    }
    this.control('local', patch)
    if (Object.keys(shown).length) this.setStatus(shown)
  }

  connect(pid, polite) {
    if (!this.live() || this.peers.has(pid)) return
    this.peers.set(pid, { state: 'connecting', audio: false, video: false, polite })
    this.control('connect', { peer: pid, polite })
  }

  disconnect(pid) {
    if (!this.peers.has(pid)) return
    this.peers.delete(pid)
    this.gains.delete(pid)
    this.control('disconnect', { peer: pid })
  }

  handleSignal(from, data, polite) {
    if (!this.live()) return
    if (!this.peers.has(from)) this.peers.set(from, { state: 'connecting', audio: false, video: false, polite })
    this.control('signal', { peer: from, data })
  }

  setGains(gains) {
    const changed = {}
    let any = false
    for (const [pid, g] of Object.entries(gains)) {
      const v = Math.round(Math.max(0, Math.min(1, g)) * 100) / 100
      if (this.gains.get(pid) !== v && this.peers.has(pid)) {
        this.gains.set(pid, v)
        changed[pid] = v
        any = true
      }
    }
    if (any) this.control('volume', { gains: changed })
  }

  /** Share (or stop sharing) a screen. Call from a click: the browser asks what to share. */
  shareScreen(on) {
    this.screenRequested = !!on
    this.control('screen', { share: !!on })
  }

  /** Video rectangles from one part of the UI; the shell gets every part's tiles together. */
  setTiles(tiles, source = 'strip') {
    this.tileSets[source] = tiles
    tiles = Object.values(this.tileSets).flat()
    const key = JSON.stringify(tiles)
    if (key === this.lastTilesKey) return
    this.lastTilesKey = key
    this.control('tiles', { tiles })
  }

  resumeAudio() {
    this.control('audio-resume')
  }
}
