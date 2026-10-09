// The imperative game core: local player, remote avatars, camera, input and
// the frame loop. React reads a small UI snapshot through `subscribe`.
import { DEFAULT_LOOK, loadAtlas, loadCharacters, loadGround, normalizeLook, T } from './assets.js'
import { doorAt, findPath, getMap, lockDoors, objectsAt, roomAt, seatAt, spawnNear, tileKind } from './maps.js'
import { drawScene } from './render.js'
import { catsOn } from './cats.js'
import { heading, MIN_TAP, walk, WALK_SPEED } from './motion.js'

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
export const ZOOM_STEP = 1.2 // each button press or key zooms 20%
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

function makeAvatar(id, name, look, mapId, x, y, dir = 'down') {
  return {
    id, name, look: normalizeLook(look), mapId, x, y, fx: x, fy: y, dir,
    moving: false, walkT: 0, emote: null, chat: null, speaking: 0, status: '',
    path: [], muted: false, seat: null, dance: null,
  }
}

export class Game {
  constructor({ canvas, me, onEvent }) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.onEvent = onEvent || (() => {})
    const start = spawnNear(getMap('town'))
    this.me = makeAvatar(me.id, me.name, me.look || DEFAULT_LOOK, 'town', start[0], start[1], start[2])
    this.mapId = 'town'
    this.map = getMap('town')
    this.others = new Map()
    this.world = { locks: {}, bubbles: {}, tv: {}, games: {} }
    // Walking: the arrow keys held now (in press order; the last one sets your facing), when
    // each was pressed, and short taps still being walked out (a tap moves a little, not a tile).
    this.held = []
    this.pressedAt = {}
    this.nudge = {}
    // The chair you just stood up from: you don't sit straight back down on it.
    this.sitBlock = null
    this.lastBump = 0
    this.blocker = (x, y) => tileKind(this.map, x, y) === 1 || this.isBlocked(x, y)
    // Zoom: 1 is the default distance; the drawn level glides to the target.
    this.zoomLevel = 1
    this.zoomTarget = 1
    this.onZoom = null
    this.callsAvailable = false // set by the town: whether voice and video exist here
    // `view` is the eased centre of the screen in world pixels (so zooming keeps it in place);
    // `camera` is the drawn frame's top-left in device pixels, for hit-testing.
    this.view = { x: NaN, y: NaN }
    this.camera = { x: 0, y: 0 }
    this.fade = 0
    this.fadeTarget = 0
    this.pendingDoor = null
    this.time = 0
    this.images = { atlas: null, characters: null, grounds: {} }
    this.tvImage = null
    this.listeners = new Set()
    this.uiSnapshot = null
    this.uiDirty = true
    this.lastUiAt = 0
    this.frozen = false
    this.raf = 0
    this.lockDoorTiles = lockDoors(this.map)
    this.decor = {}
    this.doorAnim = {}
    this.cutscene = null
    this.effects = []
    // Cats walk on the shared clock; the town sets this to its server-synchronised clock.
    this.serverNow = () => Date.now()
    this.cats = []
    this.catPets = new Map()
    this.nearCat = null
    // Football: the town fills these each frame while a match is on (see engine/match.js).
    this.onFrame = null
    this.footballView = null
    this.hiddenAvatars = null
    this.matchFit = null
  }

  // --- lifecycle -------------------------------------------------------------------

  async load() {
    const [atlas, characters] = await Promise.all([loadAtlas(), loadCharacters()])
    this.images.atlas = atlas
    this.images.characters = characters
    await this.ensureGround(this.mapId)
  }

  async ensureGround(mapId) {
    if (!this.images.grounds[mapId]) this.images.grounds[mapId] = await loadGround(mapId)
  }

  start() {
    let last = performance.now()
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      this.update(dt)
      this.render()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }

  // --- UI snapshot for React ------------------------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  snapshot() {
    if (!this.uiSnapshot || this.uiDirty) this.uiSnapshot = this.computeUi()
    return this.uiSnapshot
  }

  markUi() {
    this.uiDirty = true
  }

  computeUi() {
    this.uiDirty = false
    const room = roomAt(this.map, this.me.x, this.me.y)
    const objs = this.usableObjects()
    return {
      mapId: this.mapId,
      mapName: this.map.name,
      room: room ? { id: room.id, name: room.name, kind: room.kind, lockable: !!room.lockable } : null,
      x: this.me.x,
      y: this.me.y,
      object: objs[0] || null,
      frozen: this.frozen,
    }
  }

  flushUi(now) {
    if (!this.uiDirty || now - this.lastUiAt < 80) return
    this.lastUiAt = now
    const next = this.computeUi()
    const prev = this.uiSnapshot
    this.uiSnapshot = next
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
      for (const fn of this.listeners) fn()
    }
  }

  // --- world state from the network ---------------------------------------------------------

  setWorld(world) {
    this.world = world || this.world
    this.markUi()
    this.leaveLockedRoom()
  }

  /**
   * News of a lock can reach you a moment after you walked in. Inside a room locked without
   * you, you step back out through its door.
   */
  leaveLockedRoom() {
    const me = this.me
    const room = roomAt(this.map, me.x, me.y)
    if (!room?.lockable || !room.door) return false
    const lock = this.world.locks?.[`${this.mapId}:${room.id}`]
    if (!lock || (lock.allow || []).includes(me.id)) return false
    const [dx, dy] = room.door
    const out = [[dx + 1, dy], [dx - 1, dy], [dx, dy + 1], [dx, dy - 1]]
      .find(([x, y]) => tileKind(this.map, x, y) === 0 && roomAt(this.map, x, y)?.id !== room.id)
    if (!out) return false
    Object.assign(me, { x: out[0], y: out[1], fx: out[0], fy: out[1], path: [], seat: null, moving: false })
    this.clearHeld()
    this.afterPath = null
    this.markUi()
    this.onEvent('step', { mapId: this.mapId, x: out[0], y: out[1], dir: me.dir })
    this.onEvent('lockedout', { room: room.id, name: room.name })
    return true
  }

  upsertOther(id, state) {
    let a = this.others.get(id)
    if (!a) {
      a = makeAvatar(id, state.name || 'Guest', state.look, state.mapId || 'town', state.x, state.y, state.dir)
      this.others.set(id, a)
    }
    if (state.name) a.name = state.name
    if (state.look) a.look = normalizeLook(state.look)
    // Newer towns also send the exact position (fx, fy); x, y stay the whole tile for older ones.
    const precise = Number.isFinite(state.fx) && Number.isFinite(state.fy)
    const tx = precise ? state.fx : state.x
    const ty = precise ? state.fy : state.y
    if (state.mapId && state.mapId !== a.mapId) {
      a.mapId = state.mapId
      a.fx = tx
      a.fy = ty
    }
    if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
      // Snap long jumps (doors, teleports); otherwise glide.
      if (Math.abs(tx - a.fx) + Math.abs(ty - a.fy) > 4) {
        a.fx = tx
        a.fy = ty
      }
      a.x = state.x
      a.y = state.y
      a.tx = tx
      a.ty = ty
    }
    if ('moving' in state) {
      a.netMoving = !!state.moving
      a.netAt = this.time
    }
    if (state.dir) a.dir = state.dir
    if ('status' in state) a.status = state.status || ''
    if ('muted' in state) a.muted = !!state.muted
    a.seenAt = performance.now()
    return a
  }

  removeOther(id) {
    this.others.delete(id)
  }

  setSpeaking(id, level) {
    const a = id === this.me.id ? this.me : this.others.get(id)
    if (a) a.speaking = level
  }

  showChat(id, text) {
    const a = id === this.me.id ? this.me : this.others.get(id)
    if (!a) return
    a.chat = { text: String(text).slice(0, 140), until: this.time + Math.min(9, 3 + text.length / 14) }
  }

  showEmote(id, kind) {
    const a = id === this.me.id ? this.me : this.others.get(id)
    if (!a) return
    a.emote = { kind, until: this.time + (kind === 'heart' ? 2.2 : 2.6), start: this.time }
  }

  /** Start or stop a dance (song id or null) for the local player or someone else. */
  setDance(id, song) {
    const a = id === this.me.id ? this.me : this.others.get(id)
    if (!a) return
    a.dance = song ? { song, start: a.dance?.song === song ? a.dance.start : this.time } : null
  }

  /** A short scripted moment: input freezes, the camera visits `focus`, render.js draws the scene. */
  playCutscene(kind, { focus, duration = 5, caption = '', sub = '', data = {} } = {}) {
    if (this.cutscene) return false
    this.cutscene = { kind, start: this.time, duration, focus, caption, sub, data }
    this.held = []
    this.me.path = []
    this.frozen = true
    this.onEvent('cutscene', { kind, phase: 'start' })
    return true
  }

  skipCutscene() {
    if (this.cutscene && this.time - this.cutscene.start > 0.4) this.cutscene.duration = this.time - this.cutscene.start + 0.45
  }

  endCutscene() {
    const c = this.cutscene
    this.cutscene = null
    this.frozen = false
    this.markUi()
    if (c) this.onEvent('cutscene', { kind: c.kind, phase: 'end' })
  }

  setTvImage(img) {
    this.tvImage = img
  }

  // --- local player -------------------------------------------------------------------------------

  setLook(look) {
    this.me.look = normalizeLook(look)
  }

  setName(name) {
    this.me.name = name
  }

  setFrozen(frozen) {
    this.frozen = frozen
    if (frozen) {
      this.clearHeld()
      this.me.path = []
    }
    this.markUi()
  }

  /** An arrow key went down: walk that way (with any others held, so two make a diagonal). */
  pressDir(dir) {
    if (!DIRS[dir]) return
    if (!this.held.includes(dir)) {
      this.held.push(dir)
      this.pressedAt[dir] = this.time
    }
    this.me.path = []
    this.route = null
    this.afterPath = null
    if (this.frozen || this.pendingDoor) return
    const me = this.me
    if (me.dance) {
      me.dance = null
      this.onEvent('dance', { song: null })
    }
    if (me.seat) this.standUp(dir)
    else this.face(dir)
  }

  releaseDir(dir) {
    if (!this.held.includes(dir)) return
    this.held = this.held.filter((d) => d !== dir)
    // A quick tap is still walked out for MIN_TAP, so it nudges you a little way.
    const until = (this.pressedAt[dir] ?? this.time) + MIN_TAP
    if (until > this.time) this.nudge[dir] = until
  }

  clearHeld() {
    this.held = []
    this.nudge = {}
  }

  face(dir) {
    if (this.me.dir === dir) return
    this.me.dir = dir
    this.onEvent('turn', { dir })
  }

  /** Get up from a chair: step off it in `dir` when that tile is free, else just stand. */
  standUp(dir) {
    const me = this.me
    me.seat = null
    this.sitBlock = `${me.x},${me.y}`
    this.onEvent('stand', {})
    me.dir = dir
    const [dx, dy] = DIRS[dir]
    if (this.canEnter(me.x + dx, me.y + dy)) me.path = [[me.x + dx, me.y + dy]]
    this.markUi()
  }

  sit(seat) {
    const me = this.me
    Object.assign(me, { fx: seat.x, fy: seat.y, x: seat.x, y: seat.y, seat, dir: seat.face, moving: false })
    this.clearHeld()
    this.onEvent('sit', { seat })
    this.markUi()
  }

  isBlocked(x, y) {
    const roomId = this.lockDoorTiles.get(`${x},${y}`)
    if (!roomId) return false
    const lock = this.world.locks?.[`${this.mapId}:${roomId}`]
    if (!lock) return false
    return !(lock.allow || []).includes(this.me.id)
  }

  canEnter(x, y) {
    return tileKind(this.map, x, y) !== 1 && !this.isBlocked(x, y)
  }

  /** Walk to a tile along a path (round props and locked doors); `then` runs on arrival. */
  walkTo(x, y, then = null) {
    if (this.frozen) return
    const me = this.me
    const path = findPath(this.map, me.x, me.y, x, y, (bx, by) => this.isBlocked(bx, by))
    if (!path) {
      // Explain a locked door rather than silently refusing to move.
      const open = findPath(this.map, me.x, me.y, x, y)
      const lockedStep = open?.find(([bx, by]) => this.isBlocked(bx, by))
      if (lockedStep) this.onEvent('blocked', { x: lockedStep[0], y: lockedStep[1] })
      this.route = null
      return
    }
    // Paths run tile centre to tile centre: first settle onto the tile you are on.
    if (Math.abs(me.fx - me.x) > 0.01 || Math.abs(me.fy - me.y) > 0.01) path.unshift([me.x, me.y])
    if (me.seat && path.length) {
      me.seat = null
      this.sitBlock = `${me.x},${me.y}`
      this.onEvent('stand', {})
    }
    me.path = path
    this.afterPath = then
    this.clearHeld()
    if (!path.length) this.arrivePath()
  }

  routeTo(mapId, x, y, then = null) {
    if (this.frozen) return false
    if (mapId === this.mapId) {
      this.route = null
      this.walkTo(x, y, then)
      return true
    }
    // Leave an interior through its front door, or enter the target building from town.
    const doors = this.map.doors || []
    const door = this.mapId === 'town'
      ? doors.find((d) => d.to === mapId)
      : doors.find((d) => d.to === 'town')
    if (!door) return false
    this.route = { mapId, x, y, then }
    this.walkTo(door.x, door.y)
    return true
  }

  /** Glide along me.path at walking speed; returns whether you moved. */
  followPath(dt) {
    const me = this.me
    let budget = WALK_SPEED * dt
    let moved = false
    while (budget > 1e-9 && me.path.length) {
      const [nx, ny] = me.path[0]
      const dx = nx - me.fx, dy = ny - me.fy
      const d = Math.hypot(dx, dy)
      if (d > 1e-6) {
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
        if (dir !== me.dir) me.dir = dir
      }
      if (d <= budget) {
        me.fx = nx
        me.fy = ny
        budget -= d
        moved = moved || d > 1e-6
        me.path.shift()
        if (!me.path.length) {
          this.enterTile()
          if (!this.pendingDoor) this.arrivePath()
        }
      } else {
        me.fx += (dx / d) * budget
        me.fy += (dy / d) * budget
        budget = 0
        moved = true
      }
    }
    return moved
  }

  /** The end of a walk: sit on a chair there, then run the walk's follow-up. */
  arrivePath() {
    const me = this.me
    const seat = seatAt(this.map, me.x, me.y)
    if (seat && this.sitBlock !== `${me.x},${me.y}`) this.sit(seat)
    const then = this.afterPath
    this.afterPath = null
    if (then) then()
  }

  /** Bookkeeping when the tile under your feet changes: tell the town, take a door. */
  enterTile() {
    const me = this.me
    const x = Math.round(me.fx), y = Math.round(me.fy)
    if (x === me.x && y === me.y) return
    me.x = x
    me.y = y
    if (this.sitBlock && this.sitBlock !== `${x},${y}`) this.sitBlock = null
    this.markUi()
    this.onEvent('step', { mapId: this.mapId, x, y, dir: me.dir })
    const door = doorAt(this.map, x, y)
    if (door && !this.pendingDoor) this.useDoor(door)
  }

  /** Walking into a locked door asks whether to knock (at most once a second). */
  bump(h) {
    const me = this.me
    const x = me.x + Math.sign(Math.round(h.x)), y = me.y + Math.sign(Math.round(h.y))
    if (!this.isBlocked(x, y) || this.time - this.lastBump < 1) return
    this.lastBump = this.time
    this.onEvent('blocked', { x, y })
  }

  useDoor(door) {
    this.pendingDoor = door
    this.fadeTarget = 1
    this.clearHeld()
    this.me.path = []
  }

  async finishDoor() {
    const door = this.pendingDoor
    await this.teleport(door.to, door.tx, door.ty, door.face)
    this.pendingDoor = null
    this.fadeTarget = 0
    const route = this.route
    if (route) {
      this.route = null
      setTimeout(() => this.routeTo(route.mapId, route.x, route.y, route.then), 220)
    }
  }

  async teleport(mapId, x, y, dir = 'down') {
    await this.ensureGround(mapId)
    const changed = mapId !== this.mapId
    this.mapId = mapId
    this.map = getMap(mapId)
    this.lockDoorTiles = lockDoors(this.map)
    Object.assign(this.me, { mapId, x, y, fx: x, fy: y, dir, moving: false, path: [], seat: null })
    this.nudge = {}
    this.sitBlock = null
    this.snapCamera = true
    this.markUi()
    if (changed) this.onEvent('map', { mapId, x, y, dir })
    this.onEvent('step', { mapId, x, y, dir })
  }

  usableObjects() {
    const objs = objectsAt(this.map, this.me.x, this.me.y)
    const out = objs.map((o) => ({ id: o.id, kind: o.kind, text: o.text || null }))
    // A cat close by wins the prompt: petting is the thing you came over for.
    if (this.nearCat) out.unshift({ id: this.nearCat.id, kind: 'cat', text: this.nearCat.name })
    return out
  }

  /** The cat within reach of the player, if any. */
  closestCat() {
    if (this.me.moving) return null
    const feet = { x: this.me.fx * T + T / 2, y: this.me.fy * T + 13 }
    let best = null
    for (const c of this.cats) {
      const d = Math.hypot(c.x - feet.x, c.y - feet.y)
      if (d <= T * 1.8 && (!best || d < best.d)) best = { id: c.id, name: c.name, d }
    }
    return best
  }

  /** Pet a cat: it sits up happily with hearts for a moment (`remote` when someone else pets it). */
  petCat(id, remote = false) {
    const cat = this.cats.find((c) => c.id === id)
    if (!cat) return false
    this.catPets.set(id, { start: this.time, x: cat.x, y: cat.y })
    if (!remote) this.onEvent('pet', { id, name: cat.name })
    return true
  }

  /** Zoom towards (factor > 1) or away from your character, between 50% and 250%. */
  zoomBy(factor) {
    this.setZoom(this.zoomTarget * factor)
  }

  setZoom(level) {
    // Rounded, so stepping out and back in lands exactly where it started (100% included),
    // while small touchpad movements still count.
    this.zoomTarget = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level)) * 1000) / 1000
    this.onZoom?.(this.zoomTarget)
  }

  /** Glide the drawn zoom towards the target in log space (in and out feel alike), ~0.2 s. */
  glideZoom(dt) {
    if (this.zoomLevel === this.zoomTarget) return
    const k = 1 - Math.exp(-dt * 14)
    const next = Math.exp(Math.log(this.zoomLevel) + (Math.log(this.zoomTarget) - Math.log(this.zoomLevel)) * k)
    this.zoomLevel = Math.abs(next - this.zoomTarget) < 0.002 ? this.zoomTarget : next
  }

  /** Device pixels per world pixel. Fractional while zoomed; render.js keeps it crisp. */
  scale() {
    const w = this.canvas.width
    const h = this.canvas.height
    const dpr = window.devicePixelRatio || 1
    if (this.matchFit) {
      // Playing football: fit the whole pitch on screen, whatever the zoom.
      return Math.max(1, Math.floor(Math.min(w / this.matchFit.w, h / this.matchFit.h)))
    }
    // At 100%, about 20 x 11 tiles in view at a whole-number scale: close enough to see faces,
    // wide enough to see who is around.
    const base = Math.max(2, Math.round(Math.max(2 * dpr, Math.min(w / (T * 20), h / (T * 11.5)))))
    return Math.max(1, base * this.zoomLevel)
  }

  // --- frame loop --------------------------------------------------------------------------

  update(dt) {
    this.time += dt
    this.onFrame?.(dt)
    this.glideZoom(dt)
    this.cats = catsOn(this, this.mapId, this.map, this.serverNow() / 1000, this.time)
    const near = this.closestCat()
    if ((near?.id || null) !== (this.nearCat?.id || null)) {
      this.nearCat = near
      this.markUi()
    }
    const me = this.me
    let moved = false
    if (!this.frozen && !this.pendingDoor) {
      if (me.path.length) {
        moved = this.followPath(dt)
      } else {
        for (const [d, until] of Object.entries(this.nudge)) if (until <= this.time) delete this.nudge[d]
        const h = heading([...this.held, ...Object.keys(this.nudge)])
        if (h && !me.seat) {
          const r = walk(this.blocker, me.fx, me.fy, h, dt)
          if (r.moved) {
            me.fx = r.x
            me.fy = r.y
            moved = true
          }
          if (r.hitX || r.hitY) this.bump(h)
          const last = this.held[this.held.length - 1]
          if (last) this.face(last)
        }
      }
    }
    me.moving = moved
    me.walkT = moved ? me.walkT + dt : 0
    if (!this.pendingDoor) this.enterTile()
    // Coming to rest on a chair sits you down (but not straight back onto the one you left).
    const resting = !moved && !this.held.length && !Object.keys(this.nudge).length && !me.path.length
    if (resting && !me.seat && !this.pendingDoor && !this.frozen) {
      const seat = seatAt(this.map, me.x, me.y)
      if (seat && this.sitBlock !== `${me.x},${me.y}`) this.sit(seat)
    }
    for (const a of this.others.values()) {
      const dx = (a.tx ?? a.x) - a.fx
      const dy = (a.ty ?? a.y) - a.fy
      const dist = Math.hypot(dx, dy)
      const speed = WALK_SPEED * (dist > 2 ? 2.2 : 1.1)
      if (dist > 0.001) {
        const stepLen = Math.min(dist, speed * dt)
        a.fx += (dx / dist) * stepLen
        a.fy += (dy / dist) * stepLen
        a.walkT += dt
        a.moving = true
        // Face the way they walk; on a diagonal keep the facing they sent.
        if (Math.abs(dx) > 1.5 * Math.abs(dy)) a.dir = dx > 0 ? 'right' : 'left'
        else if (Math.abs(dy) > 1.5 * Math.abs(dx)) a.dir = dy > 0 ? 'down' : 'up'
      } else if (a.netMoving && this.time - (a.netAt ?? -1) < 0.3) {
        // Caught up between two updates of someone still walking: keep the stride going.
        a.walkT += dt
        a.moving = true
      } else {
        a.moving = false
        a.walkT = 0
      }
      const seat = !a.moving && a.mapId === this.mapId ? seatAt(this.map, a.x, a.y) : null
      a.seat = seat
      if (seat) a.dir = seat.face
      if (a.chat && a.chat.until < this.time) a.chat = null
      if (a.emote && a.emote.until < this.time) a.emote = null
    }
    if (me.chat && me.chat.until < this.time) me.chat = null
    if (me.emote && me.emote.until < this.time) me.emote = null
    // Meeting-room doors swing shut when the room is locked.
    for (const d of this.map.roomDoors || []) {
      const locked = !!this.world.locks?.[`${this.mapId}:${d.room}`]
      const anim = this.doorAnim[d.id] || (this.doorAnim[d.id] = { t: locked ? 1 : 0 })
      const target = locked ? 1 : 0
      if (anim.t !== target) {
        anim.t = target > anim.t ? Math.min(1, anim.t + dt * 3.5) : Math.max(0, anim.t - dt * 3.5)
        if (anim.t === 1) {
          anim.lockedAt = this.time
          this.onEvent('doorlock', { room: d.room, x: d.x, y: d.y })
        }
        if (anim.t === 0) this.onEvent('doorunlock', { room: d.room, x: d.x, y: d.y })
      }
    }
    if (this.cutscene && this.time - this.cutscene.start >= this.cutscene.duration) this.endCutscene()
    this.effects = this.effects.filter((e) => this.time - e.start < e.duration)
    // Door fade.
    const fadeSpeed = 5
    if (this.fade < this.fadeTarget) {
      this.fade = Math.min(this.fadeTarget, this.fade + dt * fadeSpeed)
      if (this.fade >= 1 && this.pendingDoor && !this.doorBusy) {
        this.doorBusy = true
        this.finishDoor().finally(() => { this.doorBusy = false })
      }
    } else if (this.fade > this.fadeTarget) {
      this.fade = Math.max(this.fadeTarget, this.fade - dt * fadeSpeed)
    }
    this.flushUi(performance.now())
  }

  render() {
    const canvas = this.canvas
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    if (!this.images.atlas) return
    drawScene(this, this.ctx, w, h)
  }

  // Screen (CSS px relative to canvas) -> tile.
  screenToTile(sx, sy) {
    const dpr = window.devicePixelRatio || 1
    const s = this.scale()
    const wx = (sx * dpr + this.camera.x) / s
    const wy = (sy * dpr + this.camera.y) / s
    return { x: Math.floor(wx / T), y: Math.floor(wy / T) }
  }

  // Tile centre -> screen CSS px (for HTML overlays such as prompts).
  tileToScreen(x, y) {
    const dpr = window.devicePixelRatio || 1
    const s = this.scale()
    return { x: ((x + 0.5) * T * s - this.camera.x) / dpr, y: ((y + 0.5) * T * s - this.camera.y) / dpr }
  }
}
