// Town cats. Every client computes the same cats from the shared server clock, so everyone sees
// each cat in the same place without any network traffic: a cat's day is a series of 18-second
// segments; in segment k it walks (by the deterministic A* in maps.js) from spot k to spot k+1 of
// its home patch, then sits or naps there. Spots come from a hash of the cat and k, never from
// Math.random, and petting is a local flourish (plus a peer message so people nearby see hearts).
import { findPath, seatAt, tileKind } from './maps.js'
import { sprite, T } from './assets.js'

export const CATS = [
  { id: 'mochi', name: 'Mochi', coat: 'ginger', map: 'town', zone: [23, 26, 41, 33] },
  { id: 'miso', name: 'Miso', coat: 'tuxedo', map: 'town', zone: [4, 21, 21, 30] },
  { id: 'pixel', name: 'Pixel', coat: 'grey', map: 'town', zone: [43, 21, 59, 30] },
  { id: 'biscuit', name: 'Biscuit', coat: 'cream', map: 'town', zone: [17, 46, 47, 53] },
  { id: 'latte', name: 'Latte', coat: 'brown', map: 'cafe', zone: [1, 4, 15, 9], sleepy: true },
]

const SEGMENT = 18 // seconds per walk-then-rest segment
const SPEED = 2 // tiles per second while walking
const PET_SECONDS = 2.8
const CATCH_UP = 0.6

// 16 x 16 frames: '#' outline, 'o' fur, 's' fur shade, 'w' white, 'e' eye, 'n' nose, 'p' inner ear,
// 'k' closed eye. Left-facing frames are the right-facing ones mirrored.
const HEAD_FRONT = [
  '................', '................', '...#........#...', '..#p#......#p#..', '..#po######op#..',
  '.#oooooooooooo#.', '.#oooooooooooo#.', '.#ooeooooooeoo#.', '.#ooeoonnooeoo#.', '..#oowwwwwwoo#..',
  '...##wwwwww##...',
]
const HEAD_BACK = [
  '................', '................', '...#........#...', '..#o#......#o#..', '..#oo######oo#..',
  '.#oooooooooooo#.', '.#oooooooooooo#.', '.#oooooooooooo#.', '.#ssooooooooss#.', '..#soooooooos#..',
  '...##oooooo##...',
]
const SIDE = [
  '................', '................', '................', '................', '.#........#..#..',
  '#o#......#p##p#.', '#o#......#ooooo#', '.#o#.....#oooeo#', '..#o#####oooooon', '...#oooooooowww#',
  '...#oooooooooww#', '...#sssooooooo#.', '...#ss######ss#.',
]
const FRAMES = {
  down_a: [...HEAD_FRONT, '...#oowwwwoo#...', '...#ooowwooo#...', '...#ow#..#wo#...', '...#ww#..#oo#...', '....##...#ww#...'],
  down_b: [...HEAD_FRONT, '...#oowwwwoo#...', '...#ooowwooo#...', '...#ow#..#wo#...', '...#oo#..#ww#...', '...#ww#...##....'],
  up_a: [...HEAD_BACK, '...#oooooooo#...', '...#oooooooo#.#.', '...#os#..#so##o#', '...#oo#..#oo#.#.', '....##...#oo#...'],
  up_b: [...HEAD_BACK, '...#oooooooo#...', '...#oooooooo#.#.', '...#os#..#so##o#', '...#oo#..#oo#.#.', '...#oo#...##....'],
  right_a: [...SIDE, '...#o#....#o#...', '...#w#....#w#...', '....#......#....'],
  right_b: [...SIDE, '....#o#..#o#....', '....#w#..#w#....', '.....#....#.....'],
  sit: [...HEAD_FRONT, '..#ooowwwwooo#..', '..#oooowwoooo#..', '..#ooo#ww#ooo##.', '..#ow#wwww#wo#o#', '...##########o#.'],
  sleep: [
    '................', '................', '................', '................', '................',
    '...#........#...', '..#p#......#p#..', '..#po######op#..', '.#oooooooooooo#.', '.#ookkooookkoo#.',
    '#oooooonnoooooo#', '#oooooooooooooo#', '#ooooooooooooso#', '.#sooooooooooss#', '..############..',
    '................',
  ],
}
// Petted: the sitting cat with happy, closed "^ ^" eyes.
FRAMES.happy = [...FRAMES.sit.slice(0, 7), '.#ookooooookoo#.', '.#okokonnokoko#.', ...FRAMES.sit.slice(9)]
for (const [name, rows] of Object.entries(FRAMES)) {
  if (rows.length !== 16 || rows.some((r) => r.length !== 16)) throw new Error(`cat frame ${name} is not 16 x 16`)
}

const COATS = {
  ginger: { o: '#e88c3c', s: '#c46828', w: '#f6efe4' },
  tuxedo: { o: '#3a3440', s: '#26222c', w: '#f4efe6' },
  grey: { o: '#9696a5', s: '#707080', w: '#eeeef2' },
  cream: { o: '#ecdcbc', s: '#d0b890', w: '#fffaf0' },
  brown: { o: '#8a5a3c', s: '#6a4028', w: '#f0e2cc' },
}
const FIXED = { '#': '#2a1e26', e: '#7ad87a', n: '#f08ca0', p: '#f0a0aa', k: '#2a1e26' }

let sprites = null

/** Canvases for every coat and frame (left-facing frames mirrored), built once. */
export function catSprites() {
  if (sprites) return sprites
  sprites = {}
  for (const [coat, colours] of Object.entries(COATS)) {
    sprites[coat] = {}
    for (const [name, rows] of Object.entries(FRAMES)) {
      for (const flip of name.startsWith('right') ? [false, true] : [false]) {
        const canvas = document.createElement('canvas')
        canvas.width = 16
        canvas.height = 16
        const ctx = canvas.getContext('2d')
        rows.forEach((row, y) => {
          for (let x = 0; x < 16; x++) {
            const c = row[x]
            if (!c || c === '.') continue
            ctx.fillStyle = colours[c] || FIXED[c] || '#ff00ff'
            ctx.fillRect(flip ? 15 - x : x, y, 1, 1)
          }
        })
        sprites[coat][flip ? name.replace('right', 'left') : name] = canvas
      }
    }
  }
  return sprites
}

function hash(text, k) {
  let h = 2166136261 ^ k
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

/** True when something drawn in front of a cat resting on (x, y) would mostly hide it. */
function hidden(map, x, y) {
  const cx = x * T + T / 2 - 8, cy = y * T + 13 - 15
  for (const [name, ex, ey, ez] of map.ents) {
    if (ez <= y * T + 13) continue
    const frame = sprite(name)?.f?.[0]
    if (!frame) continue
    const ox = Math.min(cx + 16, ex + frame[2]) - Math.max(cx, ex)
    const oy = Math.min(cy + 16, ey + frame[3]) - Math.max(cy, ey)
    if (ox > 0 && oy > 0 && ox * oy > 16 * 16 * 0.3) return true
  }
  return false
}

function zoneTiles(cat, map) {
  if (cat.tiles) return cat.tiles
  const [x0, y0, x1, y1] = cat.zone
  const tiles = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue
      // Rest only where people can see the cat: open floor, not a seat, not under a table or tree.
      if (tileKind(map, x, y) === 0 && !seatAt(map, x, y) && !hidden(map, x, y)) tiles.push([x, y])
    }
  }
  cat.tiles = tiles
  return tiles
}

function spot(cat, map, k) {
  const tiles = zoneTiles(cat, map)
  // A sleepy cat keeps the same spot for several segments in a row, so it naps far more than it walks.
  const epoch = cat.sleepy ? Math.floor(k / 4) : k
  return tiles[hash(cat.id, epoch) % tiles.length]
}

const paths = new Map()

function segmentPath(cat, map, k) {
  const key = `${cat.id}:${k}`
  if (paths.has(key)) return paths.get(key)
  const [sx, sy] = spot(cat, map, k)
  const [gx, gy] = spot(cat, map, k + 1)
  const [x0, y0, x1, y1] = cat.zone
  const outside = (x, y) => x < x0 || y < y0 || x > x1 || y > y1 || tileKind(map, x, y) !== 0
  const route = findPath(map, sx, sy, gx, gy, outside, 4000)
  // An unreachable spot (an island in the patch) means a short teleport-free rest instead.
  const path = [[sx, sy], ...(route && route.length && route[route.length - 1][0] === gx && route[route.length - 1][1] === gy ? route : [])]
  if (path.length === 1 && (sx !== gx || sy !== gy)) path.push([sx, sy])
  if (paths.size > 400) paths.clear()
  paths.set(key, path)
  return path
}

/** Where cat `cat` is at shared time `seconds`: feet in world pixels, facing, pose and frame name. */
export function catPose(cat, map, seconds) {
  const k = Math.floor(seconds / SEGMENT)
  const t = seconds - k * SEGMENT
  let path = segmentPath(cat, map, k)
  const last = path[path.length - 1]
  const [ex, ey] = spot(cat, map, k + 1)
  if (last[0] !== ex || last[1] !== ey) path = [...path, [ex, ey]] // unreachable: hop at the end
  const steps = path.length - 1
  const speed = Math.max(SPEED, steps / (SEGMENT - 3))
  const walking = steps / speed
  if (t < walking) {
    const f = t * speed
    const i = Math.min(steps - 1, Math.floor(f))
    const [ax, ay] = path[i]
    const [bx, by] = path[i + 1]
    const u = f - i
    const dir = bx > ax ? 'right' : bx < ax ? 'left' : by > ay ? 'down' : 'up'
    const step = Math.floor(t / 0.18) % 2 ? 'b' : 'a'
    return {
      x: (ax + (bx - ax) * u) * T + T / 2, y: (ay + (by - ay) * u) * T + 13, dir, pose: 'walk',
      frame: `${dir}_${step}`,
    }
  }
  const [rx, ry] = walking ? path[steps] : path[0]
  const rest = hash(cat.id, k * 13 + 1) % 3
  const pose = cat.sleepy || rest === 0 ? 'sleep' : 'sit'
  return { x: rx * T + T / 2, y: ry * T + 13, dir: 'down', pose, frame: pose }
}

/** Every cat on `mapId` at shared time `seconds`, with local petting applied. */
export function catsOn(game, mapId, map, seconds, now) {
  const out = []
  for (const cat of CATS) {
    if (cat.map !== mapId) continue
    let p = catPose(cat, map, seconds)
    const pet = game.catPets.get(cat.id)
    if (pet) {
      const since = now - pet.start
      if (since < PET_SECONDS) {
        p = { ...p, x: pet.x, y: pet.y, pose: 'happy', frame: 'happy', dir: 'down' }
      } else if (since < PET_SECONDS + CATCH_UP) {
        const u = (since - PET_SECONDS) / CATCH_UP
        p = { ...p, x: pet.x + (p.x - pet.x) * u, y: pet.y + (p.y - pet.y) * u }
      } else {
        game.catPets.delete(cat.id)
      }
    }
    out.push({ ...cat, ...p, petAt: pet?.start ?? null })
  }
  return out
}

export const CAT_PET_SECONDS = PET_SECONDS
