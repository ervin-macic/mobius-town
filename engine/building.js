// Building: everything about creations from this player's side.
//
// - Keeps the town's creations current: the hub's sync carries a creations version (cv); when it
//   changes we fetch the index, then the bodies of creations on the maps we need, and lay them over
//   the maps (maps.setCreations) so walking, sitting, prompts and drawing see them at once.
// - Runs what creations do: interactions ("press X") and triggers (walking in, coming near), with
//   their moments (banners, confetti, lights, music). A trigger can be seen by everyone there.
// - Starts builds: a site on the hub (the construction site everyone sees), then a builder agent
//   chat on this person's own Möbius, which builds with forge/town.py and publishes the creation.
import { areaCentre, prunePictures, triggerFor, triggerHere } from './creations.js'
import { getMap, isPrivateMap, roomAt, setCreations } from './maps.js'
import { BUILDER_PROMPT, builderMessage } from './builderPrompt.js'

const T = 16
const BATCH = 40
const SHARED_FX_GAP_MS = 1500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class Building {
  constructor({ town }) {
    this.town = town
    this.cv = -1
    this.index = []
    this.bodies = new Map() // id -> { rev, body }
    this.policy = 'everyone'
    this.fetching = null
    this.again = false
    this.inside = new Set()
    // Triggers already looked at on this map. One that appears while you are already standing in
    // its place (a surprise built around you) waits until you really walk in; arriving on a map
    // (a door, joining the town) counts as walking in.
    this.evaluated = new Set()
    this.arrived = true
    this.loaded = new Set() // maps whose creations have been fetched (triggers wait for them)
    this.running = new Map() // trigger key -> started (ms), so one trigger does not stack
    this.revealed = new Set()
    this.fired = new Map() // creation id -> Set of trigger indices fired for me
    this.lastSharedFx = new Map()
    this.mySites = new Map() // site id -> { chatId, text, replace }
    this.known = null // creation ids seen on the current map (to celebrate new ones)
    this.music = new Map()
    this.chats = new Map() // builder chat id -> { running, waiting }
    this.lastChatPoll = 0
  }

  /** Every second: while a build of yours runs, see whether its builder is working or asking you. */
  async tick() {
    const mine = (this.town.state.building?.sites || []).filter((s) => s.chatId && (s.status === 'planning' || s.status === 'building'))
    if (!mine.length || Date.now() - this.lastChatPoll < 6000 || this.polling) return
    this.lastChatPoll = Date.now()
    this.polling = true
    try {
      const res = await fetch('/api/app-chats', { headers: { Authorization: `Bearer ${this.town.token}` } })
      if (!res.ok) return
      const list = await res.json()
      let changed = false
      for (const c of Array.isArray(list) ? list : []) {
        if (!mine.some((s) => s.chatId === c.id)) continue
        const next = { running: !!c.running, waiting: !!c.awaiting_owner }
        const prev = this.chats.get(c.id)
        if (!prev || prev.running !== next.running || prev.waiting !== next.waiting) changed = true
        this.chats.set(c.id, next)
        if (next.waiting && !prev?.waiting) {
          this.town.toast('Your builder has a question for you.', {
            long: true, actions: [{ label: 'Answer', primary: true, run: () => this.openChat(c.id) }],
          })
        }
      }
      if (changed) this.publish()
    } catch {
      /* the next tick tries again */
    } finally {
      this.polling = false
    }
  }

  get game() {
    return this.town.game
  }

  // --- keeping creations current --------------------------------------------------------------------------

  onSync(cv) {
    if (Number.isInteger(cv) && cv !== this.cv) this.refresh(cv)
  }

  async refresh(cv) {
    if (this.fetching) {
      this.again = true
      return
    }
    this.fetching = (async () => {
      try {
        const res = await this.town.hub.call('world', { op: 'index' })
        this.cv = Number.isInteger(res.cv) ? res.cv : cv
        this.policy = res.policy || 'everyone'
        this.index = Array.isArray(res.index) ? res.index : []
        for (const c of this.index) this.fired.set(c.id, new Set(c.fired || []))
        await this.loadMap(this.game?.mapId)
        this.apply()
      } catch (err) {
        console.info('[building] could not load creations:', err?.message)
      } finally {
        this.fetching = null
        if (this.again) {
          this.again = false
          this.refresh(this.cv)
        }
      }
    })()
    return this.fetching
  }

  /** Fetch the bodies of creations on `mapId` that are missing or out of date. */
  async loadMap(mapId) {
    if (!mapId) return
    const want = this.index.filter((c) => c.map === mapId && this.bodies.get(c.id)?.rev !== c.rev).map((c) => c.id)
    for (let i = 0; i < want.length; i += BATCH) {
      let ids = want.slice(i, i + BATCH)
      while (ids.length) {
        const res = await this.town.hub.call('world', { op: 'bodies', ids }, { timeoutMs: 30000 })
        for (const [id, entry] of Object.entries(res.bodies || {})) this.bodies.set(id, entry)
        const more = (res.more || []).filter((id) => !res.bodies?.[id])
        if (more.length === ids.length) break
        ids = more
      }
    }
  }

  /** Lay the creations over every map we have bodies for, and refresh what the game shows. */
  apply() {
    const byMap = new Map()
    const live = new Set(this.index.map((c) => c.id))
    for (const id of [...this.bodies.keys()]) if (!live.has(id)) this.bodies.delete(id)
    for (const c of this.index) {
      const entry = this.bodies.get(c.id)
      if (!entry) continue
      const masked = c.masked && !this.revealed.has(c.id) && !this.fired.get(c.id)?.size
      if (!byMap.has(c.map)) byMap.set(c.map, [])
      byMap.get(c.map).push({ id: c.id, rev: entry.rev, body: entry.body, masked })
    }
    for (const mapId of Object.keys(this.mapIds())) setCreations(mapId, byMap.get(mapId) || [])
    prunePictures([...this.bodies.values()].map((e) => e.body))
    const game = this.game
    if (!game) return
    this.loaded.add(game.mapId)
    const before = this.known
    game.refreshMap()
    const now = new Map((byMap.get(game.mapId) || []).filter((c) => !c.masked).map((c) => [c.id, c.rev]))
    if (before) {
      for (const [id, rev] of now) {
        if (before.get(id) === rev) continue
        const body = this.bodies.get(id)?.body
        if (body) this.celebrate(body, !before.has(id))
      }
      for (const id of before.keys()) {
        if (!now.has(id)) this.town.sound.play('whoosh', { volume: 0.5 })
      }
    }
    this.known = now
    this.updateMusic()
    this.publish()
    this.checkTriggers()
  }

  mapIds() {
    const out = {}
    for (const c of this.index) out[c.map] = true
    for (const id of ['town', 'cafe', 'chess', 'den', 'cinema', 'hall']) out[id] = true
    return out
  }

  /** A creation just appeared (or changed) on this map: a little poof where it stands. */
  celebrate(body, fresh) {
    const [x, y, w, h] = body.area
    const me = this.game.me
    const near = Math.hypot(me.x - (x + w / 2), me.y - (y + h / 2)) < 18
    this.game.fx.poof((x + w / 2) * T, (y + h / 2) * T, w * T, h * T, this.game.time)
    if (near) {
      this.town.sound.play('sparkle', { volume: 0.6 })
      if (fresh) setTimeout(() => this.town.sound.play('chime', { volume: 0.5 }), 260)
    }
  }

  /** Songs that creations play around themselves, on this map. */
  updateMusic() {
    const map = this.game?.map
    const want = new Map((map?.music || []).map((m) => [`creation:${m.c}`, m]))
    for (const key of this.music.keys()) {
      if (!want.has(key)) {
        this.town.sound.setDance(key, null)
        this.music.delete(key)
      }
    }
    for (const [key, m] of want) {
      const prev = this.music.get(key)
      if (prev && prev.song === m.song) continue
      this.town.sound.setDance(key, m.song, { map: this.game.mapId, x: Math.floor(m.x / T), y: Math.floor(m.y / T) })
      this.music.set(key, m)
    }
  }

  /** You walked onto another map: bring its creations. */
  async onMap(mapId) {
    this.inside.clear()
    this.evaluated.clear()
    this.arrived = true
    this.known = null
    await this.loadMap(mapId)
    this.apply()
  }

  // --- what creations do ---------------------------------------------------------------------------------

  me() {
    const t = this.town
    return { handle: t.identityHandle || '', name: t.profile?.name || '' }
  }

  /** Walking into a trigger's place (or near it) starts it, once per person unless it says otherwise. */
  checkTriggers() {
    const game = this.game
    if (!game || !this.town.pid || !this.loaded.has(game.mapId)) return
    const map = game.map
    const me = game.me
    const room = roomAt(map, me.x, me.y)?.id
    const who = this.me()
    const now = this.town.serverNow()
    const inside = new Set()
    const arrived = this.arrived
    this.arrived = false
    for (const t of map.triggers || []) {
      const key = `${t.creation}:${t.index}`
      const appeared = !this.evaluated.has(key) && !arrived
      this.evaluated.add(key)
      if (!triggerFor(t.trig, who.handle, who.name)) continue
      if (t.trig.from && now < t.trig.from) continue
      if (t.trig.until && now > t.trig.until) continue
      if (!triggerHere(t, map, me.x, me.y, room)) continue
      inside.add(key)
      if (this.inside.has(key) || appeared) continue
      const once = t.trig.once || 'per_person'
      if (once !== 'always' && this.fired.get(t.creation)?.has(t.index)) continue
      if (this.running.has(key)) continue
      this.fire(t)
    }
    this.inside = inside
  }

  async fire(t) {
    const key = `${t.creation}:${t.index}`
    this.running.set(key, Date.now())
    if ((t.trig.once || 'per_person') !== 'always') {
      if (!this.fired.has(t.creation)) this.fired.set(t.creation, new Set())
      this.fired.get(t.creation).add(t.index)
    }
    // Reveal a surprise as it starts, so its decorations are there when the lights come up.
    const entry = this.index.find((c) => c.id === t.creation)
    if (entry?.masked) {
      this.revealed.add(t.creation)
      setTimeout(() => this.apply(), 1200)
    }
    if (t.trig.everyone_sees) this.town.mesh.broadcast({ t: 'fx', c: t.creation, i: t.index }, true)
    this.town.act('trigger_fire', { creation: t.creation, trigger: t.index }).catch?.(() => {})
    try {
      await this.run(t.creation, t.trig.do, { area: t.area })
    } finally {
      setTimeout(() => this.running.delete(key), 3000)
    }
  }

  /** Someone near us set off a shared trigger: we see (and hear) it too. */
  onPeer(from, msg) {
    const body = this.bodies.get(msg.c)?.body
    const trig = body?.triggers?.[msg.i]
    if (!trig || !trig.everyone_sees) return
    const key = `${from}:${msg.c}:${msg.i}`
    const last = this.lastSharedFx.get(key) || 0
    if (Date.now() - last < SHARED_FX_GAP_MS) return
    this.lastSharedFx.set(key, Date.now())
    const a = this.game.others.get(from)
    if (!a || a.mapId !== this.game.mapId || body.map !== this.game.mapId) return
    // Their surprise is no secret to us; the actions that only matter to them stay theirs.
    const actions = trig.do.filter((x) => !('say' in x) && !('reveal' in x) && !('emote' in x))
    this.run(msg.c, actions, { area: body.area, shared: true })
  }

  /** Press X at something a creation made usable. */
  interact(obj) {
    const body = this.bodies.get(obj.creation)?.body
    const use = body?.uses?.[obj.index]
    if (!use) return false
    this.run(obj.creation, use.do, { area: body.area })
    return true
  }

  /** Run actions in order; `wait` pauses between them. */
  async run(cid, actions, { area, shared = false } = {}) {
    const game = this.game
    for (const a of actions || []) {
      if (this.town.stopped || !game) return
      const centre = areaCentre(area || [game.me.x - 2, game.me.y - 2, 4, 4])
      const atPx = (tile) => (tile ? { x: tile[0] * T + 8, y: tile[1] * T + 8 } : centre)
      if ('wait' in a) {
        await sleep(Math.min(10, a.wait) * 1000)
      } else if ('say' in a) {
        if (!shared) this.town.set({ overlay: { kind: 'sign', title: a.title || this.titleOf(cid), text: a.say } })
      } else if ('banner' in a) {
        game.fx.setBanner(a.banner, a.sub || '', a.seconds || 6, game.time)
      } else if ('effect' in a) {
        const at = atPx(a.at)
        const [, , w, h] = area || [0, 0, 6, 4]
        game.fx.spawn(a.effect, { x: at.x, y: at.y, w: Math.max(64, w * T), h: Math.max(48, h * T), seconds: a.seconds || 4 }, game.time)
      } else if ('sound' in a) {
        this.town.sound.play(a.sound, { volume: 0.8 })
      } else if ('music' in a) {
        const key = `moment:${cid}`
        const tile = { map: game.mapId, x: Math.floor(centre.x / T), y: Math.floor(centre.y / T) }
        this.town.sound.setDance(key, a.music, tile)
        setTimeout(() => this.town.sound.setDance(key, null), (a.seconds || 60) * 1000)
      } else if ('lights' in a) {
        game.fx.setLights(a.lights, a.seconds || 6, game.time)
      } else if ('reveal' in a) {
        if (!this.revealed.has(cid)) {
          this.revealed.add(cid)
          this.apply()
        }
      } else if ('emote' in a) {
        if (!shared) this.town.emote(a.emote)
      }
    }
  }

  titleOf(cid) {
    return this.index.find((c) => c.id === cid)?.title || 'Möbius Town'
  }

  // --- sites and builds ----------------------------------------------------------------------------------

  onWorld(world) {
    const sites = Object.values(world.sites || {})
    if (this.game) this.game.sites = sites.filter((s) => s.map === this.game.mapId)
    this.publish(sites)
  }

  publish(sites = Object.values(this.town.state.world.sites || {})) {
    const pid = this.town.pid
    const handle = this.town.identityHandle
    const mine = sites.filter((s) => (handle && s.handle === handle) || (pid && s.pid === pid))
      .map((s) => {
        const chatId = s.chat || this.mySites.get(s.id)?.chatId || null
        const chat = chatId ? this.chats.get(chatId) : null
        // A builder whose chat is idle well after the start, with the site still open, has stopped.
        const stopped = !!chat && !chat.running && !chat.waiting && this.town.serverNow() - s.started > 45000
        return { ...s, chatId, waiting: !!chat?.waiting, stopped }
      })
      .sort((a, b) => b.started - a.started)
    const list = this.index.filter((c) => !c.masked)
    this.town.set({
      building: {
        sites: mine, index: list, policy: this.policy, keeper: !!this.town.hello?.isHub,
        handle: handle || null,
      },
    })
  }

  /** The free spot in front of you a request starts from (the builder may move or resize it). */
  targetInFront() {
    const game = this.game
    const map = game.map
    const me = game.me
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[me.dir] || [0, 1]
    const claimed = (x, y) => (map.creations || []).some((c) => {
      const [ax, ay, aw, ah] = c.body.area
      return x >= ax && y >= ay && x < ax + aw && y < ay + ah
    })
    const free = (x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h && map.solid[y * map.w + x] === 0
      && !map.keepClear?.[y * map.w + x] && !claimed(x, y)
    const fits = (x, y, w, h) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!free(xx, yy)) return false
      return true
    }
    for (const [w, h] of [[4, 3], [3, 3], [2, 2]]) {
      for (let gap = 1; gap <= 4; gap++) {
        for (const shift of [0, -1, 1, -2, 2]) {
          const x = d[0] ? (d[0] > 0 ? me.x + gap : me.x - gap - w + 1) : me.x - Math.floor(w / 2) + shift
          const y = d[1] ? (d[1] > 0 ? me.y + gap : me.y - gap - h + 1) : me.y - Math.floor(h / 2) + shift
          if (fits(x, y, w, h)) return { mapId: game.mapId, x, y, w, h }
        }
      }
    }
    return null
  }

  showMarker(on) {
    if (!this.game) return
    this.game.createMarker = on && this.game.map.outdoor ? this.targetInFront() : null
  }

  /** Ask for something: a site everyone sees, then a builder agent on your own Möbius. */
  async start(text, { replace = null } = {}) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim()
    if (clean.length < 3) {
      this.town.toast('Say what you would like to build.')
      return null
    }
    // Everyone's Agent Office is the same private map: a build there would appear in all of them.
    if (isPrivateMap(this.game?.mapId)) {
      this.town.toast('Your Agent Office is yours alone, so nothing is built in here. Step outside and build anywhere in town.', { long: true })
      return null
    }
    const res = await this.town.act('site_begin', { text: clean, ...(replace ? { replace } : {}) })
    const site = res?.site
    if (!site) return null
    this.mySites.set(site.id, { text: clean, replace, chatId: null })
    this.publish()
    window.mobius?.signal?.('item_created', { type: replace ? 'build-change' : 'build' })
    const map = getMap(site.map)
    const room = map ? roomAt(map, site.x, site.y) : null
    const original = replace ? this.index.find((c) => c.id === replace) : null
    try {
      const chat = window.mobius?.chat?.start
      if (!chat) throw new Error('This Möbius cannot start a builder agent from an app yet.')
      const started = await window.mobius.chat.start({
        title: `Town build: ${clean.slice(0, 48)}`,
        draft: builderMessage({
          site, text: clean, name: this.town.profile?.name, handle: this.town.identityHandle,
          mapName: map?.name || site.map, room: room?.name, outdoor: !!map?.outdoor, replace, original,
        }),
        systemPrompt: BUILDER_PROMPT,
        scope: `town-build:${site.id}`,
        scopeLabel: 'Möbius Town builds',
      })
      const chatId = started?.chatId
      if (chatId) {
        this.mySites.get(site.id).chatId = chatId
        this.town.act('site_chat', { site: site.id, chat: chatId })
      }
      this.publish()
      return site
    } catch (err) {
      this.town.act('site_cancel', { site: site.id })
      this.town.toast(`The builder could not start: ${err?.message || 'unknown problem'}`, { long: true })
      return null
    }
  }

  cancel(siteId) {
    return this.town.act('site_cancel', { site: siteId })
  }

  async remove(cid) {
    const r = await this.town.act('creation_remove', { id: cid })
    if (r) {
      this.town.toast(`Removed “${r.title}”.`)
      window.mobius?.signal?.('item_deleted')
    }
    return r
  }

  setPolicy(policy) {
    return this.town.act('build_policy', { policy }).then((r) => {
      if (r) {
        this.policy = r.policy
        this.publish()
      }
      return r
    })
  }

  openChat(chatId) {
    if (chatId) window.parent.postMessage({ type: 'moebius:open-chat', chatId }, '*')
  }

  /** Walk over to a creation. */
  goTo(cid) {
    const c = this.index.find((x) => x.id === cid)
    if (!c) return
    const [x, y, w, h] = c.area
    const map = getMap(c.map)
    let best = null
    for (let yy = y - 1; yy <= y + h; yy++) {
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (!map || map.solid[yy * map.w + xx] !== 0) continue
        const d = Math.abs(xx - (x + w / 2)) + Math.abs(yy - (y + h + 1))
        if (!best || d < best[2]) best = [xx, yy, d]
      }
    }
    if (best) this.game.routeTo(c.map, best[0], best[1])
  }
}
