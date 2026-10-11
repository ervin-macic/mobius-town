// The Agent Office, glued into the town: while you are inside, your agents (read from your own
// Möbius by net/agents.js) work at the desks of engine/office.js's crew, and walking up to one
// opens its card. Opening a chat hands over to Möbius itself, which is where an agent is stopped
// or given a new prompt. Your agents never leave this browser: nothing here goes to the hub.
import { fetchAgentDetail, fetchAgents } from './net/agents.js'
import { npcCentre, OFFICE_MAP, OfficeCrew } from './engine/office.js'
import { getMap } from './engine/maps.js'

const REFRESH_MS = 20_000
// The first look failed (the town is busy, say): try again soon rather than leave the office empty.
const RETRY_MS = [2500, 5000, 10_000]

export const OFFICE_SIGN =
  'Walk in to see the Möbius agents working for you, most recently active at the desks. Everyone who '
  + 'walks in gets an office of their own: nobody else sees your agents, and you don’t see anyone else in there.'

export class AgentOffice {
  constructor({ town }) {
    this.town = town
    this.crew = getMap(OFFICE_MAP) ? new OfficeCrew() : null
    this.inside = false
    this.timer = null
    this.near = null
    this.loading = null
    this.retries = 0
    this.retryTimer = null
  }

  /** The town changed map: start or stop looking after the office. */
  onMap(mapId) {
    const inside = mapId === OFFICE_MAP && !!this.crew
    if (inside === this.inside) return
    this.inside = inside
    clearInterval(this.timer)
    clearTimeout(this.retryTimer)
    this.timer = null
    this.retries = 0
    if (inside) {
      this.refresh()
      this.timer = setInterval(() => { if (!document.hidden) this.refresh() }, REFRESH_MS)
    } else {
      this.setNear(null)
    }
  }

  stop() {
    clearInterval(this.timer)
    clearTimeout(this.retryTimer)
    this.timer = null
    this.inside = false
  }

  /** Read your agents again (at most one request at a time). */
  refresh() {
    if (this.loading) return this.loading
    const town = this.town
    if (!town.state.office) town.set({ office: { status: 'loading', agents: [], at: 0 } })
    this.loading = fetchAgents({ token: town.token }).then(({ status, agents }) => {
      this.loading = null
      const prev = town.state.office
      if (status !== 'ok') window.mobius?.signal?.('error', { message: `agents ${status}`, source: 'office' })
      if (status !== 'ok' && status !== 'denied' && this.inside && this.retries < RETRY_MS.length) {
        clearTimeout(this.retryTimer)
        this.retryTimer = setTimeout(() => this.refresh(), RETRY_MS[this.retries++])
      } else if (status === 'ok') {
        this.retries = 0
      }
      if (status !== 'ok' && prev?.agents?.length) {
        // A blip keeps the people you already see; only the status line changes.
        town.set({ office: { ...prev, status } })
        return
      }
      this.crew?.setAgents(agents, town.game?.time || 0)
      town.set({ office: { status, agents, at: Date.now() } })
      if (status === 'denied' && !this.deniedToast) {
        this.deniedToast = true
        town.toast('Your agents can’t come in yet: Möbius Town needs permission to read your chat summaries.', { long: true })
      }
    })
    return this.loading
  }

  /** Every frame: the crew goes about its day, and the person you stand next to gets the prompt. */
  frame(dt) {
    const game = this.town.game
    if (!game || !this.crew) return
    if (game.mapId !== OFFICE_MAP) {
      if (game.npcs?.length) game.npcs = []
      return
    }
    this.crew.update(dt, { time: game.time, me: game.me })
    game.npcs = this.crew.npcs
    this.setNear(game.frozen ? null : this.crew.nearest(game.me))
  }

  setNear(npc) {
    if (npc === this.near) return
    this.near = npc
    const game = this.town.game
    if (!game) return
    game.nearAgent = npc
    game.markUi()
  }

  /** Tapping someone in the office walks you over and opens their card. */
  tap(tile) {
    if (!this.inside || !this.crew) return false
    const game = this.town.game
    const npc = this.crew.at(tile.x, tile.y)
    if (!npc) return false
    const spot = this.crew.besideOf(npc, game.me)
    if (!spot) {
      this.talkTo(npc.id)
      return true
    }
    game.walkTo(spot[0], spot[1], () => this.talkTo(npc.id))
    return true
  }

  /** Open an agent's card (by crew id "agent:<chat id>" or chat id). */
  talkTo(id) {
    const agentId = String(id).replace(/^agent:/, '')
    const npc = this.crew?.npcs.find((n) => n.agentId === agentId)
    if (npc) this.town.game.face(facing(this.town.game.me, npc))
    this.town.set({ overlay: { kind: 'agent', id: agentId } })
    window.mobius?.signal?.('agent_card_opened', { activity: npc?.activity || 'unknown' })
  }

  openDirectory() {
    this.town.set({ overlay: { kind: 'directory' } })
    this.refresh()
  }

  agent(id) {
    return this.town.state.office?.agents?.find((a) => a.id === id) || null
  }

  detail(id) {
    return fetchAgentDetail(id, { token: this.town.token })
  }

  /** Hand over to Möbius: open the chat, with your new prompt waiting in its box when you wrote one. */
  openChat(id, draft = '') {
    const text = String(draft || '').trim()
    window.parent.postMessage({ type: 'moebius:open-chat', chatId: id, ...(text ? { draft: text } : {}) }, '*')
    window.mobius?.signal?.('agent_chat_opened', { with_prompt: !!text })
  }
}

function facing(me, npc) {
  const c = npcCentre(npc)
  const dx = c.x - me.fx
  const dy = c.y - me.fy
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
}
