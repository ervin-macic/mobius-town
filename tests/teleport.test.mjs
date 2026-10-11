// Teleporting: where you land next to someone, locked meeting rooms, private offices, and how the
// town map groups people by building. Run: node --test tests/teleport.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.window = { devicePixelRatio: 1 }
const { landingSpot, placeLabel, standable, teleportKind, townOverview } = await import('../engine/teleport.js')
const { getMap, isPrivateMap, roomAt, seatAt, tileKind } = await import('../engine/maps.js')

const occupiedBy = (tiles) => (mapId) => new Set(tiles.filter((t) => t.map === mapId).map((t) => `${t.x},${t.y}`))

test('teleport_lands_beside_them_on_plain_floor', () => {
  const target = { map: 'town', x: 31, y: 29, dir: 'down' }
  const spot = landingSpot(target, { pid: 'me' })
  assert.equal(spot.kind, 'near')
  assert.equal(spot.map, 'town')
  assert.ok(Math.hypot(spot.x - target.x, spot.y - target.y) <= 2.01)
  assert.ok(!(spot.x === target.x && spot.y === target.y))
  assert.equal(tileKind(getMap('town'), spot.x, spot.y), 0)
  assert.equal(seatAt(getMap('town'), spot.x, spot.y), null)
})

test('teleport_never_lands_on_someone_else', () => {
  const target = { map: 'town', x: 31, y: 29, dir: 'down' }
  const first = landingSpot(target, { pid: 'me' })
  const second = landingSpot(target, { pid: 'me', occupied: occupiedBy([{ map: 'town', x: first.x, y: first.y }]) })
  assert.ok(second && !(second.x === first.x && second.y === first.y))
})

test('teleport_never_lands_inside_a_room_locked_without_you', () => {
  const hall = getMap('hall')
  const target = { map: 'hall', x: 3, y: 4, dir: 'down' } // inside Meeting Room A
  assert.equal(roomAt(hall, target.x, target.y).id, 'meet-a')
  const locks = { 'hall:meet-a': { by: 'them', allow: ['them'] } }
  const spot = landingSpot(target, { pid: 'me', locks })
  assert.equal(spot.kind, 'locked')
  assert.equal(spot.room.id, 'meet-a')
  assert.notEqual(roomAt(hall, spot.x, spot.y).id, 'meet-a')
})

test('teleport_into_a_locked_room_you_may_enter_lands_beside_them', () => {
  const target = { map: 'hall', x: 3, y: 4, dir: 'down' }
  const locks = { 'hall:meet-a': { by: 'them', allow: ['them', 'me'] } }
  const spot = landingSpot(target, { pid: 'me', locks })
  assert.equal(spot.kind, 'near')
  assert.equal(roomAt(getMap('hall'), spot.x, spot.y).id, 'meet-a')
})

test('teleport_to_someone_in_their_office_stops_outside_the_building', () => {
  assert.equal(isPrivateMap('office'), true)
  assert.equal(isPrivateMap('town'), false)
  const spot = landingSpot({ map: 'office', x: 11, y: 11, dir: 'up' }, { pid: 'me' })
  assert.equal(spot.kind, 'private')
  assert.equal(spot.map, 'town')
  const doors = getMap('town').doors.filter((d) => d.to === 'office')
  assert.ok(spot.y > doors[0].y, 'in front of the office door')
  assert.ok(Math.abs(spot.x - doors[0].x) <= 3)
  assert.ok(standable(getMap('town'), spot.x, spot.y))
  assert.equal(teleportKind({ map: 'office', x: 1, y: 1 }), 'private')
})

test('the_town_map_groups_people_by_building_and_keeps_offices_private', () => {
  const view = townOverview([
    { pid: 'a', mapId: 'town', x: 30, y: 30 },
    { pid: 'b', mapId: 'cafe', x: 5, y: 5 },
    { pid: 'c', mapId: 'office', x: 11, y: 11 },
    { pid: 'd', mapId: 'office', x: 3, y: 3 },
    { pid: 'e', mapId: 'moon', x: 1, y: 1 },
  ])
  assert.deepEqual(view.outdoors.map((p) => p.pid), ['a'])
  assert.deepEqual(view.elsewhere.map((p) => p.pid), ['e'])
  const office = view.buildings.find((g) => g.building === 'office')
  assert.equal(office.private, true)
  assert.deepEqual(office.people.map((p) => p.pid), ['c', 'd'])
  assert.equal(view.buildings.find((g) => g.building === 'cafe').private, false)
  assert.equal(placeLabel({ mapId: 'office', x: 11, y: 11 }), 'In their office')
})
