// Map data access and path finding. Pure functions over world.gen.js data.
import { WORLD } from './world.gen.js'

const parsed = new Map()

export function getMap(id) {
  if (parsed.has(id)) return parsed.get(id)
  const raw = WORLD.maps[id]
  if (!raw) return null
  const solid = new Uint8Array(raw.w * raw.h)
  for (let i = 0; i < solid.length; i++) solid[i] = raw.solid.charCodeAt(i) - 48
  const roomIdx = new Uint8Array(raw.w * raw.h)
  for (let i = 0; i < roomIdx.length; i++) roomIdx[i] = raw.roomGrid.charCodeAt(i) - 97
  const doors = new Map(raw.doors.map((d) => [d.y * raw.w + d.x, d]))
  const ents = [...raw.ents].sort((a, b) => a[3] - b[3])
  const objects = raw.objects.map((o) => ({ ...o }))
  const useIndex = new Map()
  for (const o of objects) {
    if (o.kind === 'seat') continue
    const tiles = o.use || (o.seats ? o.seats.map((s) => [s.x, s.y]) : o.tiles) || []
    for (const [x, y] of tiles) {
      const k = y * raw.w + x
      if (!useIndex.has(k)) useIndex.set(k, [])
      useIndex.get(k).push(o)
    }
  }
  const seatIndex = new Map()
  for (const o of objects) if (o.kind === 'seat') seatIndex.set(o.y * raw.w + o.x, o)
  const map = {
    ...raw, solid, roomIdx, doorIndex: doors, ents, objects, useIndex, seatIndex,
    fires: objects.filter((o) => o.kind === 'fire'),
    roomDoors: objects.filter((o) => o.kind === 'door'),
    mobius: objects.find((o) => o.kind === 'mobius') || null,
    board: objects.find((o) => o.kind === 'board') || null,
  }
  parsed.set(id, map)
  return map
}

export const MAP_IDS = Object.keys(WORLD.maps)

export function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h
}

/** 1 = wall/prop, 2 = door, 0 = floor. */
export function tileKind(map, x, y) {
  if (!inBounds(map, x, y)) return 1
  return map.solid[y * map.w + x]
}

export function roomAt(map, x, y) {
  if (!inBounds(map, x, y)) return map.rooms[0]
  return map.rooms[map.roomIdx[y * map.w + x]] || map.rooms[0]
}

export function doorAt(map, x, y) {
  return map.doorIndex.get(y * map.w + x) || null
}

export function objectsAt(map, x, y) {
  return map.useIndex.get(y * map.w + x) || []
}

export function seatAt(map, x, y) {
  return map.seatIndex.get(y * map.w + x) || null
}

export function objectById(map, id) {
  return map.objects.find((o) => o.id === id) || null
}

/** Meeting-room door tiles, keyed "x,y" -> room id, for lock checks. */
export function lockDoors(map) {
  const out = new Map()
  for (const room of map.rooms) {
    if (room.lockable && room.door) out.set(`${room.door[0]},${room.door[1]}`, room.id)
  }
  return out
}

/**
 * 4-directional A* from (sx, sy) to (gx, gy). `blocked(x, y)` adds dynamic
 * blocks such as locked doors. If the goal itself is blocked the path ends at
 * the nearest walkable neighbour. Returns [[x, y], ...] excluding the start.
 */
export function findPath(map, sx, sy, gx, gy, blocked = () => false, maxNodes = 6000) {
  const walk = (x, y) => tileKind(map, x, y) !== 1 && !blocked(x, y)
  let goals = [[gx, gy]]
  if (!walk(gx, gy)) {
    goals = [[gx, gy + 1], [gx, gy - 1], [gx - 1, gy], [gx + 1, gy]].filter(([x, y]) => walk(x, y))
    if (!goals.length) return null
  }
  const goalSet = new Set(goals.map(([x, y]) => y * map.w + x))
  const start = sy * map.w + sx
  if (goalSet.has(start)) return []
  const h = (i) => {
    const x = i % map.w, y = (i / map.w) | 0
    let best = Infinity
    for (const [ax, ay] of goals) best = Math.min(best, Math.abs(ax - x) + Math.abs(ay - y))
    return best
  }
  const open = [[h(start), 0, start]]
  const g = new Map([[start, 0]])
  const came = new Map()
  let expanded = 0
  while (open.length && expanded < maxNodes) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i
    const [, cost, cur] = open.splice(bi, 1)[0]
    if (cost > (g.get(cur) ?? Infinity)) continue
    expanded++
    if (goalSet.has(cur)) {
      const path = []
      let k = cur
      while (k !== start) {
        path.push([k % map.w, (k / map.w) | 0])
        k = came.get(k)
      }
      return path.reverse()
    }
    const cx = cur % map.w, cy = (cur / map.w) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy
      if (!inBounds(map, nx, ny) || !walk(nx, ny)) continue
      const ni = ny * map.w + nx
      // Doors are only walked onto as the final step.
      if (tileKind(map, nx, ny) === 2 && !goalSet.has(ni)) continue
      const nc = cost + 1
      if (nc < (g.get(ni) ?? Infinity)) {
        g.set(ni, nc)
        came.set(ni, cur)
        open.push([nc + h(ni), nc, ni])
      }
    }
  }
  return null
}

/** A free floor tile within `radius` of (x, y), preferring nearer ones. */
export function freeTileNear(map, x, y, radius = 2, random = Math.random) {
  const options = []
  for (let yy = y - radius; yy <= y + radius; yy++) {
    for (let xx = x - radius; xx <= x + radius; xx++) {
      if (tileKind(map, xx, yy) === 0 && roomAt(map, xx, yy)?.id === roomAt(map, x, y)?.id) options.push([xx, yy])
    }
  }
  return options.length ? options[Math.floor(random() * options.length)] : [x, y]
}

/** A free tile near the map's spawn point, so arrivals don't stack on one tile. */
export function spawnNear(map, radius = 3, random = Math.random) {
  const [sx, sy, dir] = map.spawn
  const options = []
  for (let y = sy - radius; y <= sy + radius; y++) {
    for (let x = sx - radius; x <= sx + radius; x++) {
      if (tileKind(map, x, y) === 0 && !map.objects.some((o) => (o.use || []).some(([ux, uy]) => ux === x && uy === y))) {
        options.push([x, y])
      }
    }
  }
  const [x, y] = options.length ? options[Math.floor(random() * options.length)] : [sx, sy]
  return [x, y, dir]
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
