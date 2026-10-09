// Who hears whom, and how loudly. Pure functions, shared by voice, video and
// nearby text chat, so every rule lives in one place.
//
// Rules, in order:
//   different map                       -> silent
//   speaker in a spotlight, same room    -> full volume, shown to everyone in the room
//   different room (walls)               -> silent
//   same meeting room                    -> full volume, everyone sees everyone
//   same conversation bubble             -> full volume
//   one of you in a bubble, the other not -> a faint leak that fades with distance
//   otherwise                            -> fades with distance

export const HEAR_FULL = 2.5 // tiles: full volume within this distance
export const HEAR_MAX = 7 // tiles: silent at and beyond this distance
export const BUBBLE_LEAK = 0.16 // outsiders hear a bubble at this fraction
export const VIDEO_MIN = 0.22 // show someone's video at or above this gain
export const CONNECT_RANGE = HEAR_MAX + 1.5 // pre-connect media a little before audible
export const DROP_RANGE = HEAR_MAX + 4 // hang up once clearly out of range

export function falloff(distance) {
  if (distance <= HEAR_FULL) return 1
  if (distance >= HEAR_MAX) return 0
  const t = (distance - HEAR_FULL) / (HEAR_MAX - HEAR_FULL)
  return Math.pow(1 - t, 1.6)
}

/**
 * How `listener` hears `speaker`.
 * Each argument: { pid, map, x, y, room: { id, kind }, bubble, onStage }.
 * Returns { gain: 0..1, video: boolean, reason }.
 */
export function hearing(listener, speaker) {
  if (!listener || !speaker || listener.map !== speaker.map) return { gain: 0, video: false, reason: 'away' }
  const sameRoom = listener.room?.id === speaker.room?.id
  if (speaker.onStage && sameRoom) return { gain: 1, video: true, reason: 'stage' }
  if (!sameRoom) return { gain: 0, video: false, reason: 'walls' }
  if (listener.room?.kind === 'meeting') return { gain: 1, video: true, reason: 'room' }
  const d = Math.hypot(listener.x - speaker.x, listener.y - speaker.y)
  if (listener.bubble && listener.bubble === speaker.bubble) return { gain: 1, video: true, reason: 'bubble' }
  if (listener.bubble || speaker.bubble) {
    const gain = falloff(d) * BUBBLE_LEAK
    return { gain, video: false, reason: gain > 0 ? 'leak' : 'far' }
  }
  const gain = falloff(d)
  return { gain, video: gain >= VIDEO_MIN, reason: gain > 0 ? 'near' : 'far' }
}

/** Should a media connection exist (or start) between these two players? */
export function wantsMedia(a, b) {
  if (!a || !b || a.map !== b.map) return false
  if (hearing(a, b).gain > 0 || hearing(b, a).gain > 0) return true
  if (a.room?.id !== b.room?.id) return false
  return Math.hypot(a.x - b.x, a.y - b.y) <= CONNECT_RANGE
}

/** Should an existing media connection be kept? (hysteresis around wantsMedia) */
export function keepsMedia(a, b) {
  if (!a || !b || a.map !== b.map) return false
  if (hearing(a, b).gain > 0 || hearing(b, a).gain > 0) return true
  if (a.room?.id !== b.room?.id) return false
  return Math.hypot(a.x - b.x, a.y - b.y) <= DROP_RANGE
}

/** People who can hear `speaker` at all (for nearby text chat). */
export function audience(speaker, others) {
  return others.filter((o) => hearing(o, speaker).gain > 0)
}
