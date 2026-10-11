// Creations: what Möbians built, laid over the base maps.
//
// The hub sends a small index (id, revision, map, area, who built it) and, on request, each
// creation's body: finished pictures (data URLs) with their sort lines, tiles made solid or freed,
// seats, lights, labels, interactions, triggers and an optional court game. applyCreations() folds
// the creations on one map into a copy of that map, so walking, sitting, prompts and drawing all
// see them without knowing they exist.

const T = 16

// One Image per picture, shared by every creation that uses it.
const images = new Map()

export function picture(url) {
  let img = images.get(url)
  if (!img) {
    img = new Image()
    img.decoding = 'async'
    img.src = url
    images.set(url, img)
  }
  return img
}

/** Forget pictures no creation uses any more. */
export function prunePictures(bodies) {
  const used = new Set()
  for (const b of bodies) {
    for (const g of b.ground || []) used.add(g.img)
    for (const p of b.props || []) for (const f of p.frames || []) used.add(f)
  }
  for (const url of images.keys()) if (!used.has(url)) images.delete(url)
}

const inRect = (x, y, [rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh

/** The tiles of a rectangle. */
export function rectTiles([x, y, w, h]) {
  const out = []
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) out.push([xx, yy])
  return out
}

/**
 * The base map with these creations on it (oldest first). `list` items: { id, rev, body, masked }.
 * A masked creation (a surprise for this viewer) keeps only its triggers until it is revealed.
 */
export function applyCreations(base, list) {
  const w = base.w
  const m = { ...base, creations: list, solid: base.solid.slice() }
  const shown = list.filter((c) => !c.masked)
  const hidden = new Set()
  for (const c of shown) for (const key of c.body.hide || []) hidden.add(key)
  const freed = new Set()
  for (const e of base.ents) {
    if (!hidden.has(e[6])) continue
    for (const [x, y] of e[4] || []) freed.add(y * w + x)
  }
  // Freed tiles (hidden furniture) walk again; doors stay doors.
  for (const i of freed) if (m.solid[i] === 1) m.solid[i] = 0
  for (const c of shown) {
    for (const [x, y] of c.body.solid || []) {
      const i = y * w + x
      if (x >= 0 && y >= 0 && x < w && y < base.h && m.solid[i] !== 2) m.solid[i] = 1
    }
  }
  // Drawing: base furniture that stays, plus every creation piece, in one sorted list.
  const ents = base.ents.filter((e) => !hidden.has(e[6]))
  const under = []
  const over = []
  for (const c of shown) {
    for (const g of c.body.ground || []) under.push({ img: picture(g.img), x: g.x, y: g.y, c: c.id })
    for (const p of c.body.props || []) {
      const piece = { frames: p.frames.map(picture), x: p.x, y: p.y, z: p.z, fps: p.fps || 0, fx: p.fx || null, c: c.id }
      if (p.layer === 'ground') under.push(piece)
      else if (p.layer === 'over') over.push(piece)
      else ents.push(piece)
    }
  }
  const z = (e) => (Array.isArray(e) ? e[3] : e.z)
  m.ents = ents.map((e, i) => [e, i]).sort((a, b) => (z(a[0]) - z(b[0])) || (a[1] - b[1])).map(([e]) => e)
  m.underlay = under
  m.overlay = over
  // Seats: hidden chairs take their seats with them; creations add their own.
  const objects = base.objects.filter((o) => !(o.kind === 'seat' && freed.has(o.y * w + o.x)))
  for (const c of shown) {
    ;(c.body.seats || []).forEach((s, i) => objects.push({ id: `${c.id}:s${i}`, kind: 'seat', ...s }))
    ;(c.body.uses || []).forEach((u, i) => objects.push({
      id: `${c.id}:u${i}`, kind: 'cuse', creation: c.id, index: i, use: u.tiles, text: u.prompt, prompt: u.prompt,
    }))
    const game = c.body.game
    if (game) {
      const use = rectTiles(game.court).filter(([x, y]) => m.solid[y * w + x] === 0)
      objects.push({ id: `court:${c.id}`, kind: 'court', creation: c.id, use, rect: game.court, text: game.meta?.title })
    }
  }
  m.objects = objects
  const useIndex = new Map()
  for (const o of objects) {
    if (o.kind === 'seat') continue
    const tiles = o.use || (o.seats ? o.seats.map((s) => [s.x, s.y]) : o.tiles) || []
    for (const [x, y] of tiles) {
      const k = y * w + x
      if (!useIndex.has(k)) useIndex.set(k, [])
      useIndex.get(k).push(o)
    }
  }
  m.useIndex = useIndex
  const seatIndex = new Map()
  for (const o of objects) if (o.kind === 'seat') seatIndex.set(o.y * w + o.x, o)
  m.seatIndex = seatIndex
  m.labels = [...(base.labels || [])]
  m.glows = []
  m.moods = []
  m.music = []
  m.triggers = []
  for (const c of list) {
    const b = c.body
    ;(b.triggers || []).forEach((trig, i) => m.triggers.push({ creation: c.id, index: i, trig, area: b.area, title: b.title }))
    if (c.masked) continue
    m.labels.push(...(b.labels || []))
    for (const g of b.glows || []) m.glows.push({ ...g, c: c.id })
    if (b.mood) m.moods.push({ c: c.id, mood: b.mood, rect: base.outdoor ? b.area : null, room: roomOf(base, b.area) })
    if (b.music) m.music.push({ c: c.id, ...b.music })
  }
  return m
}

/** The room a creation stands in (its area's centre). */
export function roomOf(map, [x, y, w, h]) {
  const cx = Math.floor(x + w / 2)
  const cy = Math.floor(y + h / 2)
  const i = map.roomIdx?.[cy * map.w + cx]
  return map.rooms[i]?.id || map.rooms[0].id
}

/** Does a trigger's place contain (x, y) for someone on `mapId` in `roomId`? */
export function triggerHere(t, map, x, y, roomId) {
  const trig = t.trig
  if (trig.when === 'near') return Math.hypot(trig.at[0] - x, trig.at[1] - y) <= (trig.radius || 2)
  if (trig.where === 'map') return true
  if (trig.where === 'room') return roomId === roomOf(map, t.area)
  return Array.isArray(trig.where) && inRect(x, y, trig.where)
}

/** Is this trigger for this person (by @handle or display name)? */
export function triggerFor(trig, handle, name) {
  if (trig.who === 'anyone' || !trig.who) return true
  const h = String(handle || '').toLowerCase()
  const n = String(name || '').toLowerCase()
  return trig.who.some((w) => {
    const v = String(w).toLowerCase()
    return v.replace(/^@/, '') === h || v === n
  })
}

/** Where a creation's centre is, in world pixels. */
export function areaCentre([x, y, w, h]) {
  return { x: (x + w / 2) * T, y: (y + h / 2) * T }
}
