// The Agent Office: your agents from chat summaries, their desks and wandering, and the private
// office map. Run: node --test tests/office.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.window = { devicePixelRatio: 1 }
const { activityOf, agoText, fetchAgents, fetchAgentDetail, lookFor, officeAgents, parseTime, plainText } = await import('../net/agents.js')
const { OfficeCrew, npcCentre, REACH } = await import('../engine/office.js')
const { findPath, getMap, seatAt, tileKind } = await import('../engine/maps.js')
const { WORLD } = await import('../engine/world.gen.js')

const NOW = Date.parse('2026-10-11T13:00:00Z')
const MIN = 60_000

function item(id, minutesAgo, extra = {}) {
  const at = new Date(NOW - minutesAgo * MIN).toISOString().replace('Z', '') // naive UTC, as Möbius sends it
  return { id, title: `Chat ${id}`, recency_at: at, updated_at: at, message_count: 4, excerpt: `Do ${id}`, ...extra }
}

function sequence(...values) {
  let i = 0
  return () => values[i++ % values.length]
}

test('agents_are_most_recently_active_first_and_empty_chats_stay_out', () => {
  const agents = officeAgents([item('old', 600), item('fresh', 1), item('empty', 0, { message_count: 0 }), item('mid', 30)], NOW)
  assert.deepEqual(agents.map((a) => a.id), ['fresh', 'mid', 'old'])
  assert.deepEqual(agents.map((a) => a.activity), ['now', 'recent', 'today'])
})

test('helpers_are_named_without_the_delegation_prefix', () => {
  const [a] = officeAgents([item('h', 2, { title: 'Delegation · kit-furniture' })], NOW)
  assert.equal(a.helper, true)
  assert.equal(a.title, 'kit-furniture')
})

test('long_titles_get_a_short_name_tag', () => {
  const [a] = officeAgents([item('l', 2, { title: 'Möbius Town: change the world on the fly with an agent' })], NOW)
  assert.ok(a.label.length <= 22)
  assert.ok(a.label.endsWith('…'))
})

test('activity_follows_only_how_recently_the_chat_was_active', () => {
  assert.equal(activityOf(NOW - 2 * MIN, NOW), 'now')
  assert.equal(activityOf(NOW - 20 * MIN, NOW), 'recent')
  assert.equal(activityOf(NOW - 5 * 60 * MIN, NOW), 'today')
  assert.equal(activityOf(NOW - 3 * 24 * 60 * MIN, NOW), 'earlier')
  assert.equal(activityOf(NaN, NOW), 'earlier')
  assert.equal(agoText(NOW - 4 * MIN, NOW), '4 min ago')
  assert.equal(agoText(NOW - 26 * 60 * MIN, NOW), 'yesterday')
})

test('naive_platform_times_are_read_as_utc', () => {
  assert.equal(parseTime('2026-10-11T12:00:00'), Date.parse('2026-10-11T12:00:00Z'))
  assert.equal(parseTime('2026-10-11T12:00:00+01:00'), Date.parse('2026-10-11T11:00:00Z'))
})

test('each_agent_keeps_the_same_look_every_visit', () => {
  assert.deepEqual(lookFor('abc'), lookFor('abc'))
  const ranges = { body: 2, skin: 5, hair: 8, shirt: 10, pants: 6 }
  for (const id of ['a', 'b', '7400bcac-616d-4ed2-9d63-5beedd658be9']) {
    for (const [key, size] of Object.entries(ranges)) assert.ok(lookFor(id)[key] >= 0 && lookFor(id)[key] < size)
  }
})

test('a_denied_permission_is_reported_not_thrown', async () => {
  const denied = await fetchAgents({ token: 't', fetchImpl: async () => ({ ok: false, status: 403 }), now: NOW })
  assert.deepEqual(denied, { status: 'denied', agents: [] })
  const offline = await fetchAgents({ token: 't', fetchImpl: async () => { throw new Error('down') }, now: NOW })
  assert.equal(offline.status, 'offline')
})

test('the_agent_card_shows_the_latest_message_each_way', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ messages: [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'working on it' }, { role: 'user', text: 'and then?' }] }),
  })
  assert.deepEqual(await fetchAgentDetail('x', { token: 't', fetchImpl }), { status: 'ok', fromAgent: 'working on it', fromYou: 'and then?' })
})

test('the_office_is_private_and_the_hub_knows_it', async () => {
  assert.equal(WORLD.maps.office.private, true)
  assert.equal(WORLD.maps.town.private, undefined)
  const town = WORLD.maps.town
  assert.ok(town.doors.some((d) => d.to === 'office'))
})

test('every_desk_and_hangout_can_be_reached_from_the_door', () => {
  const map = getMap('office')
  const [sx, sy] = map.spawn
  const targets = []
  for (const o of map.objects) {
    if (o.kind === 'desk') targets.push([o.seatX, o.seatY])
    if (o.kind === 'poi') {
      for (const spot of o.spots || []) targets.push(spot)
      for (const id of o.seatIds || []) {
        const seat = map.objects.find((s) => s.id === id)
        targets.push([seat.x, seat.y])
      }
    }
  }
  assert.equal(map.objects.filter((o) => o.kind === 'desk').length, 8)
  for (const [x, y] of targets) {
    assert.equal(tileKind(map, x, y), 0, `spot ${x},${y} is floor`)
    assert.ok(findPath(map, sx, sy, x, y), `spot ${x},${y} is reachable`)
  }
})

test('each_agent_gets_its_own_desk_and_no_more_agents_than_desks', () => {
  const crew = new OfficeCrew({ random: sequence(0.3, 0.7, 0.1, 0.9, 0.5) })
  const agents = officeAgents(Array.from({ length: 12 }, (_, i) => item(`c${i}`, i * 10)), NOW)
  crew.setAgents(agents)
  assert.equal(crew.npcs.length, 8)
  assert.equal(new Set(crew.npcs.map((n) => n.desk.id)).size, 8)
  assert.deepEqual(crew.npcs.map((n) => n.agentId), agents.slice(0, 8).map((a) => a.id))
})

test('an_agent_active_now_starts_typing_at_its_desk', () => {
  const crew = new OfficeCrew({ random: sequence(0.5) })
  crew.setAgents(officeAgents([item('busy', 1)], NOW))
  const [npc] = crew.npcs
  assert.equal(npc.doing, 'desk')
  assert.equal(npc.seat?.id, npc.desk.seat)
  crew.update(3, { time: 3 })
  assert.equal(npc.emote?.kind, 'dots')
})

test('agents_never_share_a_seat_or_spot_as_they_wander', () => {
  let r = 1
  const random = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  const crew = new OfficeCrew({ random })
  crew.setAgents(officeAgents(Array.from({ length: 8 }, (_, i) => item(`w${i}`, [2, 30, 300, 3000][i % 4])), NOW))
  for (let t = 0; t < 400; t += 0.1) {
    crew.update(0.1, { time: t })
    const sitting = crew.npcs.filter((n) => !n.path.length).map((n) => `${n.x},${n.y}`)
    assert.equal(new Set(sitting).size, sitting.length, `two agents on one tile at t=${t.toFixed(1)}`)
  }
})

test('walking_up_to_an_agent_offers_to_talk_and_walking_away_does_not', () => {
  const crew = new OfficeCrew({ random: sequence(0.5) })
  crew.setAgents(officeAgents([item('near', 1)], NOW))
  const c = npcCentre(crew.npcs[0])
  assert.equal(crew.nearest({ fx: c.x, fy: c.y + 1 })?.agentId, 'near')
  assert.equal(crew.nearest({ fx: c.x + REACH + 1, fy: c.y + 2 }), null)
})

test('sitting_in_an_agents_chair_sends_them_elsewhere', () => {
  const crew = new OfficeCrew({ random: sequence(0.5) })
  crew.setAgents(officeAgents([item('owner', 1)], NOW))
  const [npc] = crew.npcs
  const me = { fx: npc.desk.seatX, fy: npc.desk.seatY, seat: seatAt(crew.map, npc.desk.seatX, npc.desk.seatY) }
  crew.update(0.1, { time: 1, me })
  crew.update(0.1, { time: 1.1, me })
  assert.notEqual(npc.goal?.key, `seat:${npc.desk.seat}`)
})

test('tapping_anywhere_on_an_agent_finds_them', () => {
  const crew = new OfficeCrew({ random: sequence(0.5) })
  crew.setAgents(officeAgents([item('tapped', 1)], NOW))
  const [npc] = crew.npcs
  const c = npcCentre(npc)
  const col = Math.round(c.x)
  const feetRow = Math.round(c.y)
  assert.equal(crew.at(col, feetRow)?.agentId, 'tapped') // their feet
  assert.equal(crew.at(col, feetRow - 1)?.agentId, 'tapped') // their head and shoulders
  assert.equal(crew.at(col + 3, feetRow), null)
  assert.equal(crew.at(col, feetRow + 3), null)
})

test('cards_show_chat_text_without_markdown_marks', () => {
  assert.equal(plainText('Build **three** apps in `/data/x`, see [the plan](https://x.y).'), 'Build three apps in /data/x, see the plan.')
  assert.equal(plainText('## Heading\n> quoted\n```js\ncode()\n```\nafter'), 'Heading\nquoted\n \nafter')
  assert.equal(plainText(null), '')
})
