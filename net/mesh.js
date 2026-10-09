// Direct browser-to-browser data channels between players on the same map.
//
// Movement and chat flow over these at game speed; the hub only relays the
// one-off connection setup (offers/answers carried in its mailbox). If a pair
// cannot connect directly (strict NATs, no relay server), everything still
// works through the hub's slower sync.

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
const CONNECT_TIMEOUT_MS = 15000
const GATHER_TIMEOUT_MS = 2500
const RETRY_MS = [3000, 8000, 20000, 45000]

function waitForGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      clearTimeout(timer)
      resolve()
    }
    const check = () => { if (pc.iceGatheringState === 'complete') done() }
    const timer = setTimeout(done, GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

export class Mesh {
  constructor({ sendSignal, onMessage, onChange }) {
    this.self = null
    this.sendSignal = sendSignal
    this.onMessage = onMessage
    this.onChange = onChange || (() => {})
    this.peers = new Map()
    this.wanted = new Set()
    this.supported = typeof RTCPeerConnection === 'function'
    this.closed = false
  }

  setSelf(pid) {
    if (this.self !== pid) {
      for (const pidKey of [...this.peers.keys()]) this.drop(pidKey)
      this.self = pid
    }
  }

  isOpen(pid) {
    const p = this.peers.get(pid)
    return !!p && p.sure?.readyState === 'open'
  }

  lastHeard(pid) {
    return this.peers.get(pid)?.heardAt || 0
  }

  openCount() {
    let n = 0
    for (const pid of this.peers.keys()) if (this.isOpen(pid)) n++
    return n
  }

  /** Keep connections to exactly these peers (subject to retries). */
  want(pids) {
    if (!this.supported || !this.self || this.closed) return
    this.wanted = new Set(pids)
    const now = performance.now()
    for (const pid of this.wanted) {
      const p = this.peers.get(pid)
      if (!p && this.self < pid) {
        const retry = this.retries?.get(pid)
        if (!retry || retry.at <= now) this.initiate(pid)
      }
    }
    for (const pid of [...this.peers.keys()]) {
      if (!this.wanted.has(pid)) {
        const p = this.peers.get(pid)
        // Linger a little so walking through a door and back does not reconnect.
        if (!p.unwantedAt) p.unwantedAt = now
        else if (now - p.unwantedAt > 20000) this.drop(pid)
      } else {
        const p = this.peers.get(pid)
        if (p) p.unwantedAt = 0
      }
    }
    // Abandon connections that never came up.
    for (const [pid, p] of this.peers) {
      if (!this.isOpen(pid) && now - p.startedAt > CONNECT_TIMEOUT_MS) this.fail(pid)
    }
  }

  makePeer(pid, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE })
    const fast = pc.createDataChannel('fast', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 })
    const sure = pc.createDataChannel('sure', { negotiated: true, id: 1, ordered: true })
    const peer = { pid, pc, fast, sure, initiator, startedAt: performance.now(), heardAt: 0, unwantedAt: 0 }
    const onData = (e) => {
      peer.heardAt = performance.now()
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      this.onMessage(pid, msg)
    }
    fast.onmessage = onData
    sure.onmessage = onData
    sure.onopen = () => {
      this.retries?.delete(pid)
      this.onChange(pid, 'open')
    }
    sure.onclose = () => this.onChange(pid, 'closed')
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail(pid)
    }
    this.peers.set(pid, peer)
    return peer
  }

  async initiate(pid) {
    const peer = this.makePeer(pid, true)
    try {
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      await waitForGathering(peer.pc)
      if (this.peers.get(pid) !== peer) return
      this.sendSignal(pid, { type: 'offer', sdp: peer.pc.localDescription.sdp })
    } catch {
      this.fail(pid)
    }
  }

  async handleSignal(from, data) {
    if (!this.supported || this.closed || !data || typeof data !== 'object') return
    try {
      if (data.type === 'offer') {
        // The other side (smaller id) leads; replace any half-made attempt.
        if (this.peers.has(from)) this.drop(from)
        const peer = this.makePeer(from, false)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: String(data.sdp || '') })
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(answer)
        await waitForGathering(peer.pc)
        if (this.peers.get(from) !== peer) return
        this.sendSignal(from, { type: 'answer', sdp: peer.pc.localDescription.sdp })
      } else if (data.type === 'answer') {
        const peer = this.peers.get(from)
        if (peer && peer.initiator && peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription({ type: 'answer', sdp: String(data.sdp || '') })
        }
      } else if (data.type === 'bye') {
        this.drop(from)
      }
    } catch {
      this.fail(from)
    }
  }

  fail(pid) {
    const prev = this.retries?.get(pid)
    const attempt = (prev?.attempt || 0) + 1
    if (!this.retries) this.retries = new Map()
    this.retries.set(pid, { attempt, at: performance.now() + RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)] })
    this.drop(pid)
  }

  drop(pid) {
    const peer = this.peers.get(pid)
    if (!peer) return
    this.peers.delete(pid)
    try { peer.fast.close() } catch { /* already closed */ }
    try { peer.sure.close() } catch { /* already closed */ }
    try { peer.pc.close() } catch { /* already closed */ }
    this.onChange(pid, 'closed')
  }

  send(pid, msg, reliable = false) {
    const peer = this.peers.get(pid)
    const ch = reliable ? peer?.sure : peer?.fast
    if (!ch || ch.readyState !== 'open') return false
    try {
      ch.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  broadcast(msg, reliable = false) {
    let sent = 0
    for (const pid of this.peers.keys()) if (this.send(pid, msg, reliable)) sent++
    return sent
  }

  close() {
    this.closed = true
    for (const pid of [...this.peers.keys()]) this.drop(pid)
  }
}
