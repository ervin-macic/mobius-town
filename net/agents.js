// Your agents for the Agent Office: the chats on this player's own Möbius, read through the
// app's chat-history permission (a title, a short excerpt of what it was asked, when it was last
// active). This is all the office knows: Möbius gives apps no live "working" or "waiting for you"
// status, so the office shows how recently each agent was active, never a guess about its state.
// Nothing read here is ever sent to the town's hub or to other players.

const LIST_LIMIT = 40
const HELPER_PREFIX = /^Delegation\s*·\s*/i
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Character options (see engine/assets.js LOOKS): body, skin, hair, shirt, pants.
const LOOK_SIZES = { body: 2, skin: 5, hair: 8, shirt: 10, pants: 6 }

/** How recently an agent was active: now (a few minutes), recent (this hour), today, earlier. */
export function activityOf(atMs, nowMs) {
  const age = nowMs - atMs
  if (!Number.isFinite(age)) return 'earlier'
  if (age <= 3 * MINUTE) return 'now'
  if (age <= HOUR) return 'recent'
  if (age <= DAY) return 'today'
  return 'earlier'
}

/** "just now", "4 min ago", "2 h ago", "yesterday", "3 days ago". */
export function agoText(atMs, nowMs) {
  const age = Math.max(0, nowMs - atMs)
  if (!Number.isFinite(age)) return 'a while ago'
  if (age < MINUTE) return 'just now'
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`
  const days = Math.floor(age / DAY)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** A stable look per agent, so each one is recognisable from visit to visit. */
export function lookFor(id) {
  let h = 2166136261
  for (const ch of String(id)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  const look = {}
  for (const [key, size] of Object.entries(LOOK_SIZES)) {
    look[key] = h % size
    h = Math.floor(h / size) ^ (h << 7 >>> 0)
    h >>>= 0
  }
  return look
}

/** Chat text as plain prose for a card: Markdown marks, code fences and links reduced to their words. */
export function plainText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The platform stores times as naive UTC; read them as UTC. */
export function parseTime(text) {
  if (typeof text !== 'string' || !text) return NaN
  const iso = /Z|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`
  return Date.parse(iso)
}

/** One chat-log summary as an office agent. */
export function toAgent(item, nowMs) {
  const title = String(item?.title || '').trim() || 'Untitled chat'
  const helper = HELPER_PREFIX.test(title)
  const name = helper ? title.replace(HELPER_PREFIX, '') : title
  const at = parseTime(item?.recency_at || item?.updated_at)
  return {
    id: String(item.id),
    title: name,
    label: name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name,
    helper,
    at,
    activity: activityOf(at, nowMs),
    excerpt: plainText(item?.excerpt),
    messages: Number(item?.message_count) || 0,
    look: lookFor(item.id),
  }
}

/** Agents worth showing, most recently active first: chats that have said something. */
export function officeAgents(items, nowMs) {
  return (items || [])
    .filter((item) => item && item.id && Number(item.message_count) > 0 && !item.deleted_at)
    .map((item) => toAgent(item, nowMs))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
}

async function getJson(url, token, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    return { status: 'offline' }
  }
  if (res.status === 401 || res.status === 403) return { status: 'denied' }
  if (!res.ok) return { status: 'error' }
  try {
    return { status: 'ok', data: await res.json() }
  } catch {
    return { status: 'error' }
  }
}

/**
 * Your agents, from your own Möbius. Resolves { status, agents }: status 'ok', 'denied' (the
 * app may not read chat summaries), 'offline' or 'error'. Never throws.
 */
export async function fetchAgents({ token, fetchImpl = fetch, now = Date.now() } = {}) {
  const got = await getJson(`/api/chat-logs?limit=${LIST_LIMIT}`, token, fetchImpl)
  if (got.status !== 'ok') return { status: got.status, agents: [] }
  return { status: 'ok', agents: officeAgents(got.data?.items, now) }
}

/** The latest message each way in one chat: what the agent last said, and what you last asked. */
export async function fetchAgentDetail(id, { token, fetchImpl = fetch } = {}) {
  const got = await getJson(`/api/chat-logs/${encodeURIComponent(id)}`, token, fetchImpl)
  if (got.status !== 'ok') return { status: got.status }
  const messages = Array.isArray(got.data?.messages) ? got.data.messages : []
  const last = (role) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = plainText(messages[i]?.text)
      if (messages[i]?.role === role && text) return text
    }
    return null
  }
  return { status: 'ok', fromAgent: last('assistant'), fromYou: last('user') }
}
