// Town sound engine with fake Web Audio and fetch. Run: node --test tests/audio.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AMBIENT, AUDIO_FILES, EFFECTS, MUSIC, PAN_LIMIT, SCENE_FADE, SONGS, TownAudio, positional,
} from '../av/audio.js'

// ---- fakes ------------------------------------------------------------------------------

class FakeParam {
  constructor(value) {
    this.value = value
    this.events = []
  }

  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v }
  linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); this.value = v }
  setTargetAtTime(v, t, tc) { this.events.push(['target', v, t, tc]); this.value = v }
  cancelScheduledValues(t) { this.events.push(['cancel', t]) }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind
    this.outputs = []
    this.disconnected = false
  }

  connect(node) { this.outputs.push(node); return node }
  disconnect() { this.disconnected = true }
}

class FakeSource extends FakeNode {
  constructor() {
    super('source')
    this.buffer = null
    this.loop = false
    this.loopStart = 0
    this.loopEnd = 0
    this.started = null
    this.stoppedAt = null
    this.onended = null
  }

  start(when = 0, offset = 0) { this.started = { when, offset } }
  stop(when = 0) { this.stoppedAt = when }
}

// Decoded fake buffers remember their file; loop files are as long as the real ones.
const LOOP_META = Object.fromEntries([...Object.values(MUSIC), ...SONGS, ...Object.values(AMBIENT)].map((m) => [m.file, m]))
const durationOf = (file) => (LOOP_META[file] ? LOOP_META[file].loopEnd + 0.3 : 0.5)

function makeContextClass({ decodeFails = [] } = {}) {
  const contexts = []
  class FakeContext {
    constructor() {
      this.state = 'suspended'
      this.currentTime = 0
      this.sampleRate = 44100
      this.destination = new FakeNode('destination')
      this.sources = []
      this.resumeCalls = 0
      contexts.push(this)
    }

    resume() { this.resumeCalls += 1; this.state = 'running'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
    createGain() { const n = new FakeNode('gain'); n.gain = new FakeParam(1); return n }
    createStereoPanner() { const n = new FakeNode('panner'); n.pan = new FakeParam(0); return n }
    createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s }
    createBuffer(channels, length, rate) { return { file: null, duration: length / rate } }

    decodeAudioData(data, ok, fail) {
      if (decodeFails.includes(data.file)) {
        const err = new Error('unsupported data')
        fail?.(err)
        return Promise.reject(err)
      }
      const buffer = { file: data.file, duration: durationOf(data.file) }
      ok?.(buffer)
      return Promise.resolve(buffer)
    }
  }
  return { FakeContext, contexts }
}

function makeFetch(fail = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const file = url.split('/').pop()
    if (fail[file] === 'reject') throw new Error('network down')
    if (fail[file] === '404') return { ok: false, status: 404 }
    return { ok: true, status: 200, arrayBuffer: async () => ({ file }) }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

const BASE = '/app-assets/by-id/42/'

function setup({ fail = {}, decodeFails = [] } = {}) {
  const { FakeContext, contexts } = makeContextClass({ decodeFails })
  const fetchImpl = makeFetch(fail)
  const audio = new TownAudio({ baseUrl: BASE, fetchImpl, AudioContextImpl: FakeContext })
  return { audio, fetchImpl, contexts, ctx: () => contexts[0] }
}

const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve))
}
const sourcesOf = (ctx, file) => ctx.sources.filter((s) => s.buffer?.file === file)
const fileSources = (ctx) => ctx.sources.filter((s) => s.buffer?.file)
const voiceGain = (src) => src.outputs[0] // source -> voice gain
const pannerOf = (src) => (voiceGain(src).outputs[0].kind === 'panner' ? voiceGain(src).outputs[0] : null)
const busOf = (src) => (pannerOf(src) || voiceGain(src)).outputs[0]
const last = (param) => param.events[param.events.length - 1]
const musicFetches = (fetchImpl) => fetchImpl.calls.filter((u) => /\/(town|interior|dance-[a-z]+)\.mp3$/.test(u))
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

function captureWarnings() {
  const original = console.warn
  const lines = []
  console.warn = (...args) => lines.push(args.join(' '))
  return { lines, restore: () => { console.warn = original } }
}

// ---- tests ------------------------------------------------------------------------------

test('every file the engine can fetch is one of the shipped audio files', () => {
  assert.equal(new Set(AUDIO_FILES).size, AUDIO_FILES.length)
  assert.equal(AUDIO_FILES.length, 20)
  for (const name of ['coin', 'splash', 'lock', 'unlock', 'door', 'chime', 'fanfare', 'win', 'lose', 'pop', 'click', 'sparkle', 'whoosh']) {
    assert.ok(EFFECTS.includes(name), name)
  }
  for (const m of [...Object.values(MUSIC), ...SONGS, ...Object.values(AMBIENT)]) {
    assert.ok(m.loopStart > 0 && m.loopEnd > m.loopStart + 10, m.file)
  }
})

test('unlock creates and resumes one context, and repeating it is harmless', async () => {
  const { audio, contexts } = setup()
  assert.equal(audio.ready, false)
  assert.equal(await audio.unlock(), true)
  assert.equal(audio.ready, true)
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].resumeCalls, 1)
  assert.equal(await audio.unlock(), true)
  assert.equal(contexts.length, 1, 'no second context')
  // A context the OS suspended again is resumed by the next unlock.
  contexts[0].state = 'interrupted'
  assert.equal(audio.ready, false)
  assert.equal(await audio.unlock(), true)
  assert.equal(contexts[0].resumeCalls, 2)
})

test('setScene loads only the track it needs and crossfades over ~1.5 s', async () => {
  const { audio, fetchImpl, ctx } = setup()
  audio.setScene('town') // before unlock: remembered, nothing fetched
  assert.deepEqual(fetchImpl.calls, [])
  await audio.unlock()
  await flush()
  assert.deepEqual(musicFetches(fetchImpl), [`${BASE}audio/town.mp3`])
  const [town] = sourcesOf(ctx(), 'town.mp3')
  assert.equal(town.loop, true)
  assert.equal(town.loopStart, MUSIC.town.loopStart)
  assert.equal(town.loopEnd, MUSIC.town.loopEnd)
  assert.equal(town.started.offset, MUSIC.town.loopStart)
  assert.deepEqual(last(voiceGain(town).gain), ['linear', 1, SCENE_FADE], 'fades in')

  ctx().currentTime = 10
  audio.setScene('interior')
  await flush()
  assert.deepEqual(musicFetches(fetchImpl), [`${BASE}audio/town.mp3`, `${BASE}audio/interior.mp3`])
  assert.deepEqual(last(voiceGain(town).gain), ['linear', 0, 10 + SCENE_FADE], 'town fades out')
  assert.ok(near(town.stoppedAt, 10 + SCENE_FADE, 0.1), 'then stops')
  const [interior] = sourcesOf(ctx(), 'interior.mp3')
  assert.deepEqual(last(voiceGain(interior).gain), ['linear', 1, 10 + SCENE_FADE], 'interior fades in')
  assert.equal(interior.loopEnd, MUSIC.interior.loopEnd)

  audio.setScene('interior') // same scene: nothing new
  await flush()
  assert.equal(sourcesOf(ctx(), 'interior.mp3').length, 1)

  ctx().currentTime = 20
  audio.setScene('silent')
  await flush()
  assert.deepEqual(last(voiceGain(interior).gain), ['linear', 0, 20 + SCENE_FADE])
  assert.equal(musicFetches(fetchImpl).length, 2, 'silence fetches nothing')

  audio.setScene('town') // back again: decoded buffer is cached
  await flush()
  assert.equal(musicFetches(fetchImpl).filter((u) => u.endsWith('/town.mp3')).length, 1)
  assert.equal(sourcesOf(ctx(), 'town.mp3').length, 2)
})

test('positional gain: full up close, fades to silence at the radius, silent on another map; pan clamps', () => {
  const me = { map: 'town', x: 10, y: 10 }
  const at = (x, y, map = 'town') => ({ map, x, y })
  assert.deepEqual(positional(me, at(10, 10), 8), { gain: 1, pan: 0 })
  assert.equal(positional(me, at(12, 10), 8).gain, 1, 'full within 2 tiles')
  assert.equal(positional(me, at(11.4, 11.4), 8).gain, 1)
  let previous = 1
  for (let d = 2.5; d < 8; d += 0.5) {
    const g = positional(me, at(10, 10 + d), 8).gain
    assert.ok(g > 0 && g < previous, `fades at ${d}`)
    previous = g
  }
  assert.equal(positional(me, at(18, 10), 8).gain, 0, 'silent at the radius')
  assert.equal(positional(me, at(30, 10), 8).gain, 0)
  assert.equal(positional(me, at(10, 10, 'cafe'), 8).gain, 0, 'another map')
  // A smaller radius fades sooner.
  assert.ok(positional(me, at(14, 10), 6).gain < positional(me, at(14, 10), 8).gain)
  // Pan: by horizontal offset only, clamped to +-0.8.
  assert.ok(positional(me, at(13, 10), 8).pan > 0, 'right')
  assert.ok(positional(me, at(7, 10), 8).pan < 0, 'left')
  assert.equal(positional(me, at(10, 15), 8).pan, 0, 'straight below')
  assert.ok(positional(me, at(13, 10), 8).pan < positional(me, at(14, 10), 8).pan)
  assert.equal(positional(me, at(40, 10), 60).pan, PAN_LIMIT)
  assert.equal(positional(me, at(-20, 10), 60).pan, -PAN_LIMIT)
  // Nonsense is silent, never NaN.
  assert.equal(positional(null, at(10, 10), 8).gain, 0)
  assert.equal(positional(me, { map: 'town', x: 'west', y: 10 }, 8).gain, 0)
  assert.equal(positional(me, at(10, 10), 0).gain, 0)
})

test('emitters: positional loops start when audible, update only on change, stop when out of reach', async () => {
  const { audio, ctx } = setup()
  await audio.unlock()
  audio.setListener({ map: 'town', x: 10, y: 10 })
  const hearth = { id: 'hearth', map: 'town', x: 13, y: 10, sound: 'fire', radius: 6, volume: 0.5 }
  const cafeFire = { id: 'cafe-fire', map: 'cafe', x: 4, y: 4, sound: 'fire' }
  audio.setEmitters([hearth, cafeFire])
  await flush()
  let fires = sourcesOf(ctx(), 'fire.mp3')
  assert.equal(fires.length, 1, 'the fire on another map does not run')
  const [fire] = fires
  assert.equal(fire.loop, true)
  assert.equal(fire.loopStart, AMBIENT.fire.loopStart)
  assert.equal(fire.loopEnd, AMBIENT.fire.loopEnd)
  assert.ok(fire.started.offset >= AMBIENT.fire.loopStart && fire.started.offset < AMBIENT.fire.loopEnd)
  const expected = positional({ map: 'town', x: 10, y: 10 }, hearth, 6)
  assert.ok(near(voiceGain(fire).gain.value, 0.5 * expected.gain))
  assert.ok(near(pannerOf(fire).pan.value, expected.pan))
  assert.ok(pannerOf(fire).pan.value > 0, 'fire is to the right')

  // Identical updates do no work.
  const events = () => voiceGain(fire).gain.events.length + pannerOf(fire).pan.events.length
  const before = events()
  audio.setListener({ map: 'town', x: 10, y: 10 })
  audio.setEmitters([{ ...hearth }, { ...cafeFire }])
  assert.equal(events(), before)

  // Walking up to it: full emitter volume, centred.
  audio.setListener({ map: 'town', x: 13, y: 11 })
  assert.equal(last(voiceGain(fire).gain)[1], 0.5)
  assert.equal(last(pannerOf(fire).pan)[1], 0)

  // Going into the cafe stops the hearth and starts the cafe fire.
  audio.setListener({ map: 'cafe', x: 4, y: 6 })
  await flush()
  assert.notEqual(fire.stoppedAt, null)
  fires = sourcesOf(ctx(), 'fire.mp3')
  assert.equal(fires.length, 2)
  assert.equal(fires[1].stoppedAt, null)

  // Removing an emitter stops its loop.
  audio.setEmitters([hearth])
  assert.notEqual(fires[1].stoppedAt, null)
})

test('one-shots: centred or positional, silent when out of reach, with a stop handle', async () => {
  const { audio, ctx } = setup()
  await audio.unlock()
  await flush(40) // effects warm up in the background
  const handle = audio.play('coin')
  const [coin] = sourcesOf(ctx(), 'coin.mp3')
  assert.ok(coin, 'a cached effect starts at once')
  assert.equal(coin.loop, false)
  assert.equal(pannerOf(coin), null, 'centred')
  assert.equal(voiceGain(coin).gain.value, 1)
  handle.stop(0.2)
  assert.ok(near(coin.stoppedAt, 0.25))

  audio.setListener({ map: 'town', x: 10, y: 10 })
  audio.play('splash', { map: 'town', x: 6, y: 10, volume: 0.8 })
  const [splash] = sourcesOf(ctx(), 'splash.mp3')
  const p = positional({ map: 'town', x: 10, y: 10 }, { map: 'town', x: 6, y: 10 }, 8)
  assert.ok(near(voiceGain(splash).gain.value, 0.8 * p.gain))
  assert.ok(pannerOf(splash).pan.value < 0, 'to the left')

  assert.equal(audio.play('door', { map: 'cafe', x: 10, y: 10 }), null, 'another map')
  assert.equal(audio.play('door', { map: 'town', x: 40, y: 10 }), null, 'too far')
  assert.equal(sourcesOf(ctx(), 'door.mp3').length, 0)
})

test('a one-shot whose file arrives too late is skipped; the next one plays at once', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { FakeContext, contexts } = makeContextClass()
  const fetchImpl = async (url) => {
    await gate
    return { ok: true, status: 200, arrayBuffer: async () => ({ file: url.split('/').pop() }) }
  }
  const audio = new TownAudio({ baseUrl: BASE, fetchImpl, AudioContextImpl: FakeContext })
  await audio.unlock()
  assert.notEqual(audio.play('fanfare'), null)
  contexts[0].currentTime = 2 // the moment has passed by the time the file arrives
  release()
  await flush(40)
  assert.equal(sourcesOf(contexts[0], 'fanfare.mp3').length, 0)
  audio.play('fanfare')
  assert.equal(sourcesOf(contexts[0], 'fanfare.mp3').length, 1)
})

test('setDance starts, keeps, replaces and stops songs per dancer; scene music dips under them', async () => {
  const { audio, ctx } = setup()
  await audio.unlock()
  audio.setScene('town')
  audio.setListener({ map: 'town', x: 10, y: 10 })
  await flush()
  const [town] = sourcesOf(ctx(), 'town.mp3')
  const sceneBus = busOf(town)
  assert.deepEqual(audio.songs(), SONGS.map(({ id, title }) => ({ id, title })))
  assert.ok(audio.songs().length >= 3 && audio.songs().length <= 5)

  audio.setDance('me', 'disco')
  await flush()
  const [disco] = sourcesOf(ctx(), 'dance-disco.mp3')
  assert.equal(disco.loop, true)
  assert.equal(disco.loopEnd, SONGS.find((s) => s.id === 'disco').loopEnd)
  assert.equal(pannerOf(disco), null, 'own dance is centred')
  assert.ok(sceneBus.gain.value < 0.2, 'scene music dips under my dance')

  audio.setDance('me', 'disco') // same song keeps playing
  await flush()
  assert.equal(sourcesOf(ctx(), 'dance-disco.mp3').length, 1)
  assert.equal(disco.stoppedAt, null)

  audio.setDance('me', 'minstrel') // replace
  await flush()
  assert.notEqual(disco.stoppedAt, null)
  const [minstrel] = sourcesOf(ctx(), 'dance-minstrel.mp3')
  assert.equal(minstrel.stoppedAt, null)

  // Someone else dancing nearby is positional and independent of mine.
  audio.setDance('p2', 'tropical', { map: 'town', x: 14, y: 10 })
  await flush()
  const [tropical] = sourcesOf(ctx(), 'dance-tropical.mp3')
  const p = positional({ map: 'town', x: 10, y: 10 }, { map: 'town', x: 14, y: 10 }, 8)
  assert.ok(near(voiceGain(tropical).gain.value, p.gain))
  assert.ok(pannerOf(tropical).pan.value > 0)
  assert.equal(minstrel.stoppedAt, null)

  // They move: same song, new position, no restart.
  audio.setDance('p2', 'tropical', { map: 'town', x: 12, y: 10 })
  await flush()
  assert.equal(sourcesOf(ctx(), 'dance-tropical.mp3').length, 1)
  assert.equal(voiceGain(tropical).gain.value, 1)

  // Dancers out of reach or on another map make no sound.
  audio.setDance('p3', 'flowerbed', { map: 'cafe', x: 10, y: 10 })
  audio.setDance('p2', 'tropical', { map: 'town', x: 30, y: 10 })
  await flush()
  assert.equal(sourcesOf(ctx(), 'dance-flowerbed.mp3').length, 0)
  assert.notEqual(tropical.stoppedAt, null)

  audio.setDance('me', null)
  await flush()
  assert.notEqual(minstrel.stoppedAt, null)
  assert.equal(sceneBus.gain.value, 1, 'scene music comes back')
})

test('duck and volumes are smooth and skip repeats', async () => {
  const { audio, ctx } = setup()
  await audio.unlock()
  audio.setScene('town')
  await flush()
  const [town] = sourcesOf(ctx(), 'town.mp3')
  const duckNode = busOf(town).outputs[0]
  const musicBus = duckNode.outputs[0]
  assert.ok(near(musicBus.gain.value, 0.35), 'default music volume')
  audio.duck(1)
  assert.equal(last(duckNode.gain)[0], 'target', 'smooth')
  assert.ok(near(duckNode.gain.value, 0.3))
  const n = duckNode.gain.events.length
  audio.duck(1)
  assert.equal(duckNode.gain.events.length, n, 'repeat ignored')
  audio.duck(0)
  assert.equal(duckNode.gain.value, 1)
  audio.setVolumes({ music: 0.5 })
  assert.ok(near(musicBus.gain.value, 0.5))
  audio.setVolumes({ music: 7, sfx: -1 })
  assert.equal(musicBus.gain.value, 1, 'clamped')
})

test('disabled channels create no sources and fetch nothing; switching back on resumes', async () => {
  const { audio, fetchImpl, ctx } = setup()
  audio.setEnabled({ music: false, sfx: false })
  await audio.unlock()
  audio.setScene('town')
  audio.setListener({ map: 'town', x: 10, y: 10 })
  audio.setEmitters([{ id: 'hearth', map: 'town', x: 11, y: 10, sound: 'fire' }])
  audio.setDance('me', 'disco')
  assert.equal(audio.play('coin'), null)
  await flush()
  assert.equal(fileSources(ctx()).length, 0)
  assert.deepEqual(fetchImpl.calls, [])

  audio.setEnabled({ music: true })
  await flush()
  assert.equal(sourcesOf(ctx(), 'town.mp3').length, 1)
  assert.equal(sourcesOf(ctx(), 'dance-disco.mp3').length, 1)
  assert.equal(sourcesOf(ctx(), 'fire.mp3').length, 0, 'effects still off')

  audio.setEnabled({ sfx: true })
  await flush()
  assert.equal(sourcesOf(ctx(), 'fire.mp3').length, 1)
  assert.notEqual(audio.play('coin'), null)
  await flush()
  assert.equal(sourcesOf(ctx(), 'coin.mp3').length, 1)

  ctx().currentTime = 5
  audio.setEnabled({ music: false })
  const [town] = sourcesOf(ctx(), 'town.mp3')
  const [disco] = sourcesOf(ctx(), 'dance-disco.mp3')
  assert.ok(near(town.stoppedAt, 5 + SCENE_FADE, 0.1), 'music fades out, then stops')
  assert.notEqual(disco.stoppedAt, null)
  const musicBus = busOf(town).outputs[0].outputs[0]
  assert.equal(musicBus.gain.value, 0)
  audio.setScene('interior')
  await flush()
  assert.equal(sourcesOf(ctx(), 'interior.mp3').length, 0, 'no new music while off')
})

test('failures never throw: no Web Audio, blocked context, network errors, 404s, bad data, bad input', async () => {
  const warnings = captureWarnings()
  try {
    const silent = new TownAudio({ baseUrl: BASE, fetchImpl: makeFetch(), AudioContextImpl: null })
    assert.equal(await silent.unlock(), false)
    silent.setScene('town')
    assert.equal(silent.play('coin'), null)
    silent.setDance('me', 'disco')
    silent.destroy()

    class Blocked { constructor() { throw new Error('blocked by policy') } }
    const blocked = new TownAudio({ fetchImpl: makeFetch(), AudioContextImpl: Blocked })
    assert.equal(await blocked.unlock(), false)
    assert.equal(blocked.ready, false)

    assert.doesNotThrow(() => new TownAudio(null))

    const { audio, ctx, fetchImpl } = setup({ fail: { 'town.mp3': 'reject', 'coin.mp3': '404' }, decodeFails: ['door.mp3'] })
    await audio.unlock()
    audio.setScene('town')
    await flush(40)
    assert.equal(sourcesOf(ctx(), 'town.mp3').length, 0)
    for (let i = 0; i < 3; i += 1) {
      assert.doesNotThrow(() => audio.play('coin'))
      assert.doesNotThrow(() => audio.play('door'))
    }
    await flush()
    assert.equal(sourcesOf(ctx(), 'coin.mp3').length, 0)
    assert.equal(sourcesOf(ctx(), 'door.mp3').length, 0)
    assert.notEqual(audio.play('chime'), null, 'other sounds still work')
    assert.equal(sourcesOf(ctx(), 'chime.mp3').length, 1)
    const loadWarnings = warnings.lines.filter((l) => l.includes('could not load'))
    assert.equal(loadWarnings.length, 3, 'one warning per broken file')
    for (const file of ['town.mp3', 'coin.mp3', 'door.mp3']) {
      assert.equal(loadWarnings.filter((l) => l.includes(file)).length, 1, file)
    }
    // A broken file is retried after a while, but still warned about only once.
    const coinFetches = () => fetchImpl.calls.filter((u) => u.endsWith('/coin.mp3')).length
    const fetchedBefore = coinFetches()
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 60_000
      audio.play('coin')
      await flush()
    } finally {
      Date.now = realNow
    }
    assert.equal(coinFetches(), fetchedBefore + 1, 'retried later')
    assert.equal(warnings.lines.filter((l) => l.includes('coin.mp3')).length, 1, 'still one warning')

    for (const call of [
      () => audio.play('nope'),
      () => audio.play(),
      () => audio.play('coin', null),
      () => audio.setScene('ballroom'),
      () => audio.setEmitters(null),
      () => audio.setEmitters([null, { id: 1, sound: 'lava' }, { id: 2, sound: 'fire', map: 'town', x: 'a', y: null }]),
      () => audio.setListener(undefined),
      () => audio.setListener({ map: 'town', x: NaN, y: 1 }),
      () => audio.setDance(undefined, 'disco'),
      () => audio.setDance('me', 'polka'),
      () => audio.setDance('p9', 'disco', null),
      () => audio.setEnabled(null),
      () => audio.setVolumes(null),
      () => audio.duck('loud'),
    ]) {
      assert.doesNotThrow(call)
    }
    assert.equal(audio.play('nope'), null)
    audio.play('nope')
    assert.equal(warnings.lines.filter((l) => l.includes('"nope"')).length, 1, 'warned once')

    audio.destroy()
    assert.equal(ctx().state, 'closed')
    assert.equal(audio.ready, false)
    assert.equal(await audio.unlock(), false)
    assert.equal(audio.play('chime'), null)
    assert.doesNotThrow(() => audio.setScene('interior'))
  } finally {
    warnings.restore()
  }
})
