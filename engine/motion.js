// Free walking on the tile grid. Pure functions over a `blocked(x, y)` tile test.
//
// Positions are in tiles, as everywhere in the engine: whole numbers (fx, fy) mean "standing
// exactly on tile (fx, fy)", and the tile you are on is (round(fx), round(fy)). The walker is
// a small box at the feet that moves one axis at a time in short sub-steps, so walking
// diagonally into a wall slides along it, and walking at the edge of a one-tile doorway eases
// you round its corner instead of stopping you dead.

export const WALK_SPEED = 5.4 // tiles per second (the old one-tile step took 0.17 s)
export const MIN_TAP = 0.07 // a quick tap still walks this long: about a third of a tile

// The feet's box inside a tile, as fractions of the tile.
const BODY = { left: 0.22, right: 0.78, top: 0.5, bottom: 0.94 }
const STEP = 0.05 // collision sub-step, in tiles
const EASE = 0.45 // how far round a corner the walker is eased, in tiles

/** True when the feet box at (fx, fy) overlaps no blocked tile. */
export function fits(blocked, fx, fy) {
  const x0 = Math.floor(fx + BODY.left)
  const x1 = Math.floor(fx + BODY.right - 1e-9)
  const y0 = Math.floor(fy + BODY.top)
  const y1 = Math.floor(fy + BODY.bottom - 1e-9)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (blocked(x, y)) return false
  }
  return true
}

/** Move by (dx, dy) one axis at a time, stopping each axis at the first wall. */
export function slide(blocked, fx, fy, dx, dy) {
  let x = fx, y = fy, hitX = false, hitY = false
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / STEP))
  const sx = dx / n, sy = dy / n
  for (let i = 0; i < n; i++) {
    if (sx && !hitX) {
      if (fits(blocked, x + sx, y)) x += sx
      else hitX = true
    }
    if (sy && !hitY) {
      if (fits(blocked, x, y + sy)) y += sy
      else hitY = true
    }
  }
  return { x, y, hitX, hitY }
}

/**
 * Walking straight along one axis (ax or ay is -1 or 1, the other 0) into the edge of an
 * opening: the signed sideways shift, at most EASE, that lines the feet up with the gap
 * along a clear path, or 0 when there is no gap close by.
 */
export function cornerShift(blocked, fx, fy, ax, ay) {
  for (let k = 1; k * STEP <= EASE + 1e-9; k++) {
    for (const sign of [1, -1]) {
      const off = sign * k * STEP
      const at = (o) => (ax ? [fx, fy + o] : [fx + o, fy])
      const [px, py] = at(off)
      if (!fits(blocked, px, py) || !fits(blocked, px + ax * STEP, py + ay * STEP)) continue
      let clear = true
      for (let j = 1; j < k && clear; j++) clear = fits(blocked, ...at(sign * j * STEP))
      if (clear) return off
    }
  }
  return 0
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** The unit walking vector for the held directions (diagonals included; opposites cancel). */
export function heading(dirs) {
  let x = 0, y = 0
  for (const d of new Set(dirs)) {
    x += DIRS[d]?.[0] || 0
    y += DIRS[d]?.[1] || 0
  }
  const len = Math.hypot(x, y)
  return len ? { x: x / len, y: y / len } : null
}

/**
 * One frame of walking: from (fx, fy) along unit heading `h` for `dt` seconds. Returns the
 * new position, whether anything moved, and which axes hit a wall.
 */
export function walk(blocked, fx, fy, h, dt, speed = WALK_SPEED) {
  const dist = speed * dt
  const r = slide(blocked, fx, fy, h.x * dist, h.y * dist)
  // Straight into an edge: ease round the corner towards the opening.
  if ((r.hitX && !h.y) || (r.hitY && !h.x)) {
    const shift = cornerShift(blocked, r.x, r.y, r.hitX ? Math.sign(h.x) : 0, r.hitY ? Math.sign(h.y) : 0)
    if (shift) {
      const d = Math.sign(shift) * Math.min(Math.abs(shift), dist)
      const s = r.hitX ? slide(blocked, r.x, r.y, 0, d) : slide(blocked, r.x, r.y, d, 0)
      r.x = s.x
      r.y = s.y
    }
  }
  return { ...r, moved: Math.abs(r.x - fx) > 1e-9 || Math.abs(r.y - fy) > 1e-9 }
}
