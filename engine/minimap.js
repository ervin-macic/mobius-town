// Little pictures of the maps, for the corner minimap and the town map. A map is painted once at
// full size from its ground and props, then shrunk in halving steps (so each 16 px tile averages
// cleanly into a few pixels) and cached at the exact device size it is shown at; the page never
// resamples it again, so it stays crisp. Bigger than full size it is enlarged in whole steps,
// pixel for pixel.
import { loadAtlas, loadGround, PALETTES, sprite, T } from './assets.js'
import { getMap } from './maps.js'

// Keyed by the map object itself: getMap() hands out a new one whenever what Möbians built on it
// changes (engine/creations.js), so a new build gets a fresh picture and the old one is dropped.
const painted = new WeakMap() // map -> Promise<canvas> at full size
const sized = new Map() // `${mapId}#${version}:${w}x${h}` -> Promise<canvas>, the most recent few
const versions = new WeakMap()
let lastVersion = 0
const KEEP = 8

/** A number for this exact state of a map (its creations included). */
export function mapVersion(map) {
  if (!versions.has(map)) versions.set(map, ++lastVersion)
  return versions.get(map)
}

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Wait for a creation's pictures (data URLs) so they are in the painting. */
function decoded(img) {
  return img?.decode ? img.decode().catch(() => {}) : Promise.resolve()
}

function paint(mapId, map) {
  if (!painted.has(map)) {
    const pictures = [
      ...(map.underlay || []).map((u) => u.img),
      ...map.ents.filter((e) => !Array.isArray(e)).map((e) => e.frames?.[0]),
      ...(map.overlay || []).map((o) => o.frames?.[0]),
    ].filter(Boolean)
    painted.set(map, Promise.all([loadGround(mapId), loadAtlas(), ...pictures.map(decoded)]).then(([ground, atlas]) => {
      const c = canvas(map.w * T, map.h * T)
      const g = c.getContext('2d')
      g.imageSmoothingEnabled = false
      g.drawImage(ground, 0, 0)
      for (const u of map.underlay || []) if (u.img?.complete) g.drawImage(u.img, u.x, u.y)
      // Props in their depth order (getMap sorts them), each at its first frame: the town's own
      // sprites ([name, x, y, ...]) and the pieces Möbians built ({ frames, x, y }).
      for (const e of map.ents) {
        if (!Array.isArray(e)) {
          if (e.frames?.[0]?.complete) g.drawImage(e.frames[0], e.x, e.y)
          continue
        }
        const s = sprite(e[0])
        if (!s) continue
        const [sx, sy, w, h] = s.f[0]
        g.drawImage(atlas, sx, sy, w, h, e[1], e[2], w, h)
      }
      for (const o of map.overlay || []) if (o.frames?.[0]?.complete) g.drawImage(o.frames[0], o.x, o.y)
      return c
    }))
  }
  return painted.get(map)
}

function resize(src, w, h) {
  let cur = src
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2))
    const g = half.getContext('2d')
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(cur, 0, 0, half.width, half.height)
    cur = half
  }
  const out = canvas(w, h)
  const g = out.getContext('2d')
  g.imageSmoothingEnabled = w < cur.width
  g.imageSmoothingQuality = 'high'
  g.drawImage(cur, 0, 0, w, h)
  return out
}

/** The map `mapId` as a canvas exactly `w` x `h` device pixels. */
export function mapImage(mapId, w, h) {
  const map = getMap(mapId)
  const k = `${mapId}#${mapVersion(map)}:${w}x${h}`
  if (!sized.has(k)) {
    sized.set(k, paint(mapId, map).then((full) => resize(full, w, h)))
    while (sized.size > KEEP) sized.delete(sized.keys().next().value)
  }
  return sized.get(k)
}

/**
 * The size to show a map at inside a box of CSS pixels: as large as fits, in device pixels
 * (`w`, `h`; `kx`, `ky` pixels per tile), and in CSS pixels. From full size up, whole steps only.
 */
export function fitMap(mapId, boxW, boxH, dpr = 1) {
  const map = getMap(mapId)
  if (!map) return null
  let k = Math.min((boxW * dpr) / map.w, (boxH * dpr) / map.h)
  if (k >= T) k = T * Math.floor(k / T)
  const w = Math.max(1, Math.round(map.w * k))
  const h = Math.max(1, Math.round(map.h * k))
  return { mapId, w, h, kx: w / map.w, ky: h / map.h, cssW: w / dpr, cssH: h / dpr, dpr }
}

/** Someone's dot colour on a map: their shirt. */
export function shirtColour(look) {
  return (PALETTES.shirt[look?.shirt] || PALETTES.shirt[0])[0]
}
