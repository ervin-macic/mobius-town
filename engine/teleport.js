// Where everyone is, and where a teleport sets you down. Pure functions over the map data and the
// hub's room locks, so the rules are tested without a browser (tests/teleport.test.mjs):
//
//   - You land on a free floor tile within two steps of the person, in their room, facing them,
//     side by side if there is room (stacked, the sprites overlap), else in front of them; never
//     on a seat, a door, a stage spotlight or someone else, and never somewhere you could not
//     walk to them from (behind a counter, say).
//   - Someone in a meeting room locked without you: you land just outside its door, to knock.
//   - Someone on a private map (an office): you land outside that building's door in town.
//
// The town map groups people indoors by building: the town door that leads (perhaps through
// another building) to the map they are on.
import { WORLD } from './world.gen.js'
import { findPath, getMap, inBounds, isPrivateMap, lockDoors, roomAt, seatAt, tileKind } from './maps.js'

export const LAND_RADIUS = 2
// When everything within two steps is taken (a packed café), look a little further.
const WIDE_RADIUS = 4
const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

const noOne = () => new Set()
const key = (x, y) => `${x},${y}`

/** The way to face from (x, y) to look at (tx, ty). */
export function facing(x, y, tx, ty) {
  const dx = tx - x, dy = ty - y
  if (!dx && !dy) return 'down'
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

const spotlights = new Map()
function spotlightTiles(map) {
  if (!spotlights.has(map.id)) {
    const tiles = new Set()
    for (const o of map.objects) if (o.kind === 'spotlight') for (const [x, y] of o.tiles) tiles.add(key(x, y))
    spotlights.set(map.id, tiles)
  }
  return spotlights.get(map.id)
}

const doorways = new Map()
function roomDoorTiles(map) {
  if (!doorways.has(map.id)) doorways.set(map.id, lockDoors(map))
  return doorways.get(map.id)
}

/** Plain floor to stand on: not a wall or prop, a map door, a meeting-room doorway, a seat or a stage. */
export function standable(map, x, y) {
  return inBounds(map, x, y) && tileKind(map, x, y) === 0 && !seatAt(map, x, y)
    && !roomDoorTiles(map).has(key(x, y)) && !spotlightTiles(map).has(key(x, y))
}

/** Free standable tiles within `radius` of (cx, cy) that pass `keep`, nearest first (ties: top-left first). */
function around(map, cx, cy, radius, keep) {
  const out = []
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (standable(map, x, y) && keep(x, y)) out.push({ x, y, d: Math.hypot(x - cx, y - cy) })
    }
  }
  return out.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
}

/**
 * The building in town that `mapId` is inside: the interior reached straight from a town door,
 * with the doorway's centre in tiles (doors are two tiles wide). Null for the town itself.
 */
export function buildingOf(mapId) {
  const town = getMap('town')
  if (!town || !mapId || mapId === 'town' || !getMap(mapId)) return null
  const seen = new Set()
  let id = mapId
  while (id && !seen.has(id)) {
    seen.add(id)
    const doors = town.doors.filter((d) => d.to === id)
    if (doors.length) {
      const xs = doors.map((d) => d.x)
      return { id, name: getMap(id).name, x: (Math.min(...xs) + Math.max(...xs) + 1) / 2, y: doors[0].y, doors }
    }
    // A room inside another building: leave through its own front door and look again.
    const exits = getMap(id)?.doors || []
    id = (exits.find((d) => d.to === 'town') || exits.find((d) => d.to !== id))?.to
  }
  return null
}

/** Just south of a building's town door, where you come out of it. */
function outsideBuilding(mapId, occupied) {
  const b = buildingOf(mapId)
  if (!b) return null
  const town = getMap('town')
  const taken = occupied('town')
  const cx = b.x - 0.5, cy = b.y + 1
  // Out in front of the door: never beside it or behind it.
  const spot = around(town, cx, cy, 3, (x, y) => y > b.y && !taken.has(key(x, y)))[0]
  return spot ? { map: 'town', x: spot.x, y: spot.y, dir: 'down' } : null
}

/** Just outside a meeting room's door, facing it. */
function outsideRoom(map, room, occupied) {
  if (!room.door) return null
  const [dx, dy] = room.door
  const taken = occupied(map.id)
  const spot = around(map, dx, dy, 2, (x, y) => roomAt(map, x, y).id !== room.id && !taken.has(key(x, y)))[0]
  return spot ? { map: map.id, x: spot.x, y: spot.y, dir: facing(spot.x, spot.y, dx, dy) } : null
}

/** Next to them: nearest first, side by side or in front preferred, and one you can walk to them from. */
function beside(map, target, room, occupied) {
  const taken = occupied(map.id)
  const [fx, fy] = STEP[target.dir] || [0, 1]
  const front = key(target.x + fx, target.y + fy)
  for (const radius of [LAND_RADIUS, WIDE_RADIUS]) {
    const options = around(map, target.x, target.y, radius, (x, y) => (x !== target.x || y !== target.y)
      && roomAt(map, x, y).id === room.id && !taken.has(key(x, y)))
    // Beside them on their row reads best (nobody's sprite covers the other's), and the tile
    // they face is where they see you arrive: each counts as a little nearer.
    for (const o of options) {
      if (o.y === target.y) o.d -= 0.3
      if (key(o.x, o.y) === front) o.d -= 0.2
    }
    options.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
    for (const o of options) {
      const path = findPath(map, o.x, o.y, target.x, target.y, () => false, 400)
      if (path && path.length <= radius * 2 + 2) return { map: map.id, x: o.x, y: o.y, dir: facing(o.x, o.y, target.x, target.y) }
    }
  }
  return null
}

/**
 * What a teleport to `target` ({ map, x, y }) does for player `pid`, without working out the tile:
 * 'near' (beside them), 'locked' (to the door of their locked meeting room), 'private' (outside
 * their office's building), or null for a map this town does not know.
 */
export function teleportKind(target, { pid = null, locks = {} } = {}) {
  const map = getMap(target?.map)
  if (!map) return null
  if (isPrivateMap(map.id)) return 'private'
  const room = Number.isInteger(target.x) && Number.isInteger(target.y) ? roomAt(map, target.x, target.y) : null
  const lock = room?.lockable ? locks?.[`${map.id}:${room.id}`] : null
  return lock && !(lock.allow || []).includes(pid) ? 'locked' : 'near'
}

/**
 * Where a teleport to `target` ({ map, x, y, dir }) lands for player `pid`: { map, x, y, dir, kind, room }
 * with kind 'near' (beside them), 'locked' (outside their locked meeting room; room says which)
 * or 'private' (outside the building of their private map). Null when there is nowhere to land.
 * `locks` is the hub's world.locks; `occupied(mapId)` gives the "x,y" tiles people stand on there.
 */
export function landingSpot(target, { pid = null, locks = {}, occupied = noOne } = {}) {
  const map = getMap(target?.map)
  if (!map || !Number.isInteger(target.x) || !Number.isInteger(target.y)) return null
  const kind = teleportKind(target, { pid, locks })
  if (kind === 'private') {
    const spot = outsideBuilding(map.id, occupied)
    return spot && { ...spot, kind, room: null }
  }
  const room = roomAt(map, target.x, target.y)
  if (kind === 'locked') {
    const spot = outsideRoom(map, room, occupied)
    return spot && { ...spot, kind, room: { id: room.id, name: room.name } }
  }
  const spot = beside(map, target, room, occupied)
  return spot && { ...spot, kind: 'near', room: { id: room.id, name: room.name } }
}

/**
 * The town map's view of everyone: who is out in town, and who is inside each building (one group
 * per building, and a separate one for people on its private maps). `people`: [{ pid, mapId, ... }].
 * People on maps this town does not know (a newer town's) are `elsewhere`.
 */
export function townOverview(people) {
  const outdoors = []
  const elsewhere = []
  const groups = new Map()
  for (const p of people) {
    if (p.mapId === 'town') {
      outdoors.push(p)
      continue
    }
    const b = buildingOf(p.mapId)
    if (!b) {
      elsewhere.push(p)
      continue
    }
    const hidden = isPrivateMap(p.mapId)
    const id = hidden ? `${b.id}:private` : b.id
    if (!groups.has(id)) groups.set(id, { id, building: b.id, name: b.name, x: b.x, y: b.y, private: hidden, people: [] })
    groups.get(id).people.push(p)
  }
  return { outdoors, buildings: [...groups.values()], elsewhere }
}

let landmarks = null
function townLandmarks() {
  if (landmarks) return landmarks
  const town = WORLD.maps.town
  landmarks = (town?.labels || []).filter((l) => l.text).map((l) => ({ name: `the ${l.text}`, x: l.x / WORLD.tile, y: l.y / WORLD.tile }))
  for (const o of town?.objects || []) {
    if ((o.kind === 'fountain' || o.kind === 'statue') && o.focus) {
      landmarks.push({ name: `the ${o.kind}`, x: o.focus[0] / WORLD.tile, y: o.focus[1] / WORLD.tile })
    }
  }
  return landmarks
}

/**
 * Where someone is, in a few words: "Out in town, near the Café", "Town Hall · Meeting Room A ·
 * locked". `short`, for a list already headed by the place: "Near the Café", "Meeting Room A · locked".
 */
export function placeLabel(p, locks = {}, { short = false } = {}) {
  const map = getMap(p?.mapId)
  if (!map) return 'Somewhere new'
  if (isPrivateMap(map.id)) return 'In their office'
  if (map.id === 'town') {
    let best = null
    for (const l of townLandmarks()) {
      const d = Math.hypot(l.x - p.x, l.y - p.y)
      if (d < 12 && (!best || d < best.d)) best = { ...l, d }
    }
    if (!best) return 'Out in town'
    return short ? `Near ${best.name}` : `Out in town, near ${best.name}`
  }
  const room = Number.isInteger(p.x) && Number.isInteger(p.y) ? roomAt(map, p.x, p.y) : null
  const inner = room && room.name !== map.name
  const parts = short && inner && buildingOf(map.id)?.id === map.id ? [] : [map.name]
  if (inner) parts.push(room.name)
  if (room?.lockable && locks?.[`${map.id}:${room.id}`]) parts.push('locked')
  return parts.join(' · ')
}
