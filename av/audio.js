// Mobius Town sound: background music, dance songs, one-shot effects and
// positional loops (a crackling fire), played only through Web Audio:
// fetch -> arrayBuffer -> decodeAudioData -> AudioBufferSourceNode -> GainNode
// (-> StereoPannerNode). The app runs in an opaque-origin sandbox where
// <audio>, data: and blob: media are unavailable, so nothing else is used.
//
// Files are manifest static assets at `${baseUrl}audio/<file>`. Every looping
// file carries 0.3 s of its own loop tail before the loop and 0.3 s of its head
// after it (built by art/audio-src/build_audio.py), and loopStart/loopEnd below
// mark the exact loop. A browser whose MP3 decoder keeps the ~25 ms encoder
// delay shifts both points together, so loops stay seamless everywhere.
//
// Graph:  scene track -> sceneBus -+
//         dance songs -> danceBus -+-> duck -> musicBus ---------+
//         loops and positional effects -> townSfxBus ---------+-> muffle -> master -> speakers
//         other effects (the game you play) -> sfxBus --------------------->
//
// muffle(true) while you sit at a game: the town round about (music, the fire, sounds nearby)
// turns soft and dull, as if through a wall, and the game's own sounds stay clear.
//
// Nothing runs per frame: gains change only when the listener, emitters,
// dancers, volumes or switches change, and identical updates are ignored.

export const NEAR_TILES = 2 // full volume within this distance
export const DANCE_RADIUS = 8 // a dance song fades out at this distance
export const SHOT_RADIUS = 8 // default reach of a positional one-shot
export const EMITTER_RADIUS = 6 // default reach of an emitter without a radius
export const PAN_TILES = 6 // horizontal offset that would pan fully...
export const PAN_LIMIT = 0.8 // ...but pan never goes beyond this
export const SCENE_FADE = 1.5 // seconds, crossfade between scene tracks
export const DEFAULT_VOLUMES = Object.freeze({ music: 0.35, sfx: 0.7 })

const DUCK_DEPTH = 0.7 // duck(1) leaves music at 30 %
const MUFFLE_HZ = 600 // low-pass cut-off while muffled
const MUFFLE_LEVEL = 0.45 // and the town's level
const OPEN_HZ = 20000
const DANCE_OVER_SCENE = 0.85 // scene music dips by this share of the loudest dance song
const MAX_DANCES = 2 // only the two loudest dance songs play at once
const SMOOTH = 0.12 // seconds for position and volume changes
const LATE = 1.0 // seconds: a one-shot that took longer to load is skipped
const RETRY_MS = 20000 // a file that failed to load is retried after this
const SILENT = 0.001

const loop = (file, loopStart, loopEnd) => Object.freeze({ file, loopStart, loopEnd })

/** Scene music (setScene). */
export const MUSIC = Object.freeze({
  town: loop('town.mp3', 0.3, 76.253129),
  interior: loop('interior.mp3', 0.3, 64.3),
})

/** Dance songs (setDance / songs()). */
export const SONGS = Object.freeze([
  Object.freeze({ id: 'disco', title: 'Disco Boogie', ...loop('dance-disco.mp3', 0.3, 35.209093) }),
  Object.freeze({ id: 'minstrel', title: 'Minstrel Dance', ...loop('dance-minstrel.mp3', 0.3, 56.60771) }),
  Object.freeze({ id: 'flowerbed', title: 'Flowerbed Fields', ...loop('dance-flowerbed.mp3', 0.3, 53.26551) }),
  Object.freeze({ id: 'tropical', title: 'Island Conga', ...loop('dance-tropical.mp3', 0.3, 17.754558) }),
])

/** Looping positional sounds (setEmitters). */
export const AMBIENT = Object.freeze({
  fire: loop('fire.mp3', 0.3, 35.3),
})

/** One-shot effects (play). */
export const EFFECTS = Object.freeze([
  'coin', 'splash', 'lock', 'unlock', 'door', 'chime', 'fanfare', 'win', 'lose', 'pop', 'click', 'sparkle', 'whoosh',
])

const SONG_BY_ID = new Map(SONGS.map((s) => [s.id, s]))
const EFFECT_SET = new Set(EFFECTS)

/** Every file the module may fetch, relative to `${baseUrl}audio/`. */
export const AUDIO_FILES = Object.freeze([
  ...Object.values(MUSIC).map((m) => m.file),
  ...SONGS.map((s) => s.file),
  ...Object.values(AMBIENT).map((a) => a.file),
  ...EFFECTS.map((name) => `${name}.mp3`),
])

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const unit = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : fallback)

/**
 * How loud and where a sound at `source` is for `listener` (both { map, x, y }, tiles).
 * Full volume within NEAR_TILES (or half the radius if that is smaller), fading to
 * silence at `radius`; silent on another map. Pan follows the horizontal offset.
 */
export function positional(listener, source, radius = DANCE_RADIUS) {
  if (!listener || !source || listener.map == null || listener.map !== source.map) return { gain: 0, pan: 0 }
  const dx = Number(source.x) - Number(listener.x)
  const dy = Number(source.y) - Number(listener.y)
  const r = Number(radius)
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(r > 0)) return { gain: 0, pan: 0 }
  const d = Math.hypot(dx, dy)
  const near = Math.min(NEAR_TILES, r / 2)
  let gain = 0
  if (d <= near) gain = 1
  else if (d < r) gain = Math.pow(1 - (d - near) / (r - near), 1.6)
  return { gain, pan: clamp(dx / PAN_TILES, -PAN_LIMIT, PAN_LIMIT) }
}

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    let settled = false
    const ok = (buffer) => { if (!settled) { settled = true; resolve(buffer) } }
    const bad = (err) => { if (!settled) { settled = true; reject(err || new Error('could not decode')) } }
    try {
      const p = ctx.decodeAudioData(data, ok, bad) // callback form for older Safari
      if (p && typeof p.then === 'function') p.then(ok, bad)
    } catch (err) {
      bad(err)
    }
  })
}

function hold(param, now) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
  } else {
    const v = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(v, now)
  }
}

export class TownAudio {
  constructor(options) {
    const {
      baseUrl = '',
      fetchImpl = globalThis.fetch,
      AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
    } = options || {}
    this._base = String(baseUrl || '')
    if (this._base && !this._base.endsWith('/')) this._base += '/'
    this._fetch = fetchImpl
    this._Ctx = AudioContextImpl
    this._ctx = null
    this._destroyed = false
    this._warned = new Set()
    this._buffers = new Map() // file -> { buffer, promise, failedAt }
    this._enabled = { music: true, sfx: true }
    this._volumes = { ...DEFAULT_VOLUMES }
    this._duckAmount = 0
    this._muffled = false
    this._scene = 'silent'
    this._sceneTrack = null // { name, voice }
    this._sceneDip = 1
    this._listener = null
    this._emitters = new Map() // id -> { spec, voice, pending }
    this._dancers = new Map() // key -> { song, where, voice, pending }
    this._warming = false
  }

  /** Create or resume the AudioContext. Call from a user gesture; safe to repeat. Resolves to `ready`. */
  unlock() {
    try {
      if (this._destroyed) return Promise.resolve(false)
      if (!this._ctx) {
        if (typeof this._Ctx !== 'function') {
          this._warn('no-webaudio', 'Web Audio is not available, so the town stays silent')
          return Promise.resolve(false)
        }
        this._ctx = new this._Ctx()
        this._buildGraph()
        this._prime()
      }
      const ctx = this._ctx
      let resumed = Promise.resolve()
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') resumed = Promise.resolve(ctx.resume())
      return resumed.then(
        () => { this._applyAll(); this._warmEffects(); return this.ready },
        (err) => { this._warn('resume', err); return this.ready },
      )
    } catch (err) {
      this._warn('unlock', err)
      return Promise.resolve(false)
    }
  }

  /** True once the context is running. */
  get ready() {
    return !!this._ctx && !this._destroyed && this._ctx.state === 'running'
  }

  /** Switch channels on or off ({ music, sfx } booleans; missing keys are unchanged). Off fades out. */
  setEnabled(channels) {
    this._safe('setEnabled', () => {
      const { music, sfx } = channels || {}
      if (typeof music === 'boolean') this._enabled.music = music
      if (typeof sfx === 'boolean') this._enabled.sfx = sfx
      if (!this._live()) return
      this._applyBusGains()
      this._syncScene()
      this._syncDances()
      this._syncEmitters()
      if (this._enabled.sfx) this._warmEffects()
    })
  }

  /** Channel volumes 0..1 ({ music, sfx }; defaults 0.35 / 0.7). */
  setVolumes(volumes) {
    this._safe('setVolumes', () => {
      const { music, sfx } = volumes || {}
      this._volumes.music = unit(music, this._volumes.music)
      this._volumes.sfx = unit(sfx, this._volumes.sfx)
      if (this._live()) this._applyBusGains()
    })
  }

  /** 'town' | 'interior' | 'silent'. Crossfades over ~1.5 s; loads only the track it needs. */
  setScene(scene) {
    this._safe('setScene', () => {
      let name = 'silent'
      if (scene === 'town' || scene === 'interior') name = scene
      else if (scene !== 'silent' && scene != null) this._warn(`scene:${scene}`, `unknown scene "${scene}", using silence`)
      this._scene = name
      if (this._live()) this._syncScene()
    })
  }

  /** Lower all music while people talk: 0 = normal, 1 = fully ducked (30 %). Smooth. */
  duck(amount) {
    this._safe('duck', () => {
      const a = unit(amount, 0)
      if (Math.abs(a - this._duckAmount) < 1e-3) return
      this._duckAmount = a
      if (this._live()) this._ramp(this._duckNode.gain, 1 - DUCK_DEPTH * a, 0.3)
    })
  }

  /** Muffle the town (music, loops, positional sounds) while you play a game; game sounds stay clear. */
  muffle(on) {
    this._safe('muffle', () => {
      const next = !!on
      if (next === this._muffled) return
      this._muffled = next
      if (this._live()) this._applyMuffle()
    })
  }

  /** The local player's position: { map, x, y } in tiles. */
  setListener(listener) {
    this._safe('setListener', () => {
      const next = listener && listener.map != null
        ? { map: listener.map, x: Number(listener.x), y: Number(listener.y) }
        : null
      const cur = this._listener
      if (cur === next) return
      if (cur && next && cur.map === next.map && cur.x === next.x && cur.y === next.y) return
      this._listener = next
      if (!this._live()) return
      this._syncEmitters()
      this._syncDances()
    })
  }

  /** Replace all positional loops: [{ id, map, x, y, sound: 'fire', radius = 6, volume = 1 }]. */
  setEmitters(list) {
    this._safe('setEmitters', () => {
      const next = new Map()
      for (const e of Array.isArray(list) ? list : []) {
        if (!e || e.id == null) continue
        if (!AMBIENT[e.sound]) {
          this._warn(`emitter:${e.sound}`, `unknown emitter sound "${e.sound}"`)
          continue
        }
        next.set(String(e.id), {
          map: e.map,
          x: Number(e.x),
          y: Number(e.y),
          sound: e.sound,
          radius: Number(e.radius) > 0 ? Number(e.radius) : EMITTER_RADIUS,
          volume: unit(e.volume, 1),
        })
      }
      for (const [id, em] of this._emitters) {
        const spec = next.get(id)
        if (!spec || spec.sound !== em.spec.sound) {
          this._stopVoice(em.voice, 0.4)
          this._emitters.delete(id)
        }
      }
      for (const [id, spec] of next) {
        const em = this._emitters.get(id)
        if (em) em.spec = spec
        else this._emitters.set(id, { spec, voice: null, pending: false })
      }
      if (this._live()) this._syncEmitters()
    })
  }

  /**
   * Play a one-shot effect. With map/x/y it is positional (optional radius, default 8 tiles).
   * Returns { stop(fadeSeconds) } or null when nothing will play.
   */
  play(name, options) {
    return this._safe('play', () => {
      const { map, x, y, volume = 1, radius = SHOT_RADIUS } = options || {}
      if (!EFFECT_SET.has(name)) {
        this._warn(`effect:${name}`, `unknown sound "${name}"`)
        return null
      }
      // Only while the context runs: a suspended (hidden iOS) page must not queue up a burst.
      if (!this.ready || !this._enabled.sfx) return null
      let level = unit(volume, 1)
      let pan = null
      if (map !== undefined || x !== undefined || y !== undefined) {
        const p = positional(this._listener, { map, x, y }, radius)
        level *= p.gain
        pan = p.pan
      }
      if (level <= SILENT) return null
      const file = `${name}.mp3`
      const handle = {
        voice: null,
        stopped: false,
        stop: (fade = 0.08) => {
          handle.stopped = true
          this._safe('stop', () => this._stopVoice(handle.voice, Math.max(0.01, Number(fade) || 0.01)))
        },
      }
      // A sound out in the town (it has a position) is muffled with the town; a game's is not.
      const bus = pan === null ? this._sfxBus : this._townSfxBus
      const cached = this._buffers.get(file)?.buffer
      if (cached) {
        handle.voice = this._startVoice(cached, bus, { level, pan })
        return handle
      }
      const asked = this._ctx.currentTime
      this._load(file).then((buffer) => {
        if (!buffer || handle.stopped || !this._live() || !this._enabled.sfx) return
        if (this._ctx.currentTime - asked > LATE) return
        handle.voice = this._startVoice(buffer, bus, { level, pan })
      })
      return handle
    }, null)
  }

  /** Dance songs: [{ id, title }]. */
  songs() {
    return SONGS.map(({ id, title }) => ({ id, title }))
  }

  /**
   * Start, change or stop the dance song of one dancer. key 'me' plays centred; other keys
   * are positional at { map, x, y } (fading out by 8 tiles). Repeating the same song only
   * moves it. Only the two loudest dance songs play, and scene music dips under them.
   */
  setDance(key, songId, position) {
    this._safe('setDance', () => {
      const { map, x, y } = position || {}
      if (key == null) return
      const k = String(key)
      const song = songId == null ? null : SONG_BY_ID.get(songId)
      if (songId != null && !song) this._warn(`song:${songId}`, `unknown dance song "${songId}"`)
      const cur = this._dancers.get(k)
      if (!song) {
        if (cur) {
          this._stopVoice(cur.voice, 0.6)
          this._dancers.delete(k)
        }
      } else {
        const where = k === 'me' ? null : { map, x: Number(x), y: Number(y) }
        if (cur && cur.song.id === song.id) {
          cur.where = where
        } else {
          if (cur) this._stopVoice(cur.voice, 0.6)
          this._dancers.set(k, { song, where, voice: null, pending: false })
        }
      }
      if (this._live()) this._syncDances()
    })
  }

  /** Stop everything and close the context. The instance stays inert afterwards. */
  destroy() {
    this._safe('destroy', () => {
      if (this._destroyed) return
      this._destroyed = true
      const voices = [this._sceneTrack?.voice]
      for (const em of this._emitters.values()) voices.push(em.voice)
      for (const d of this._dancers.values()) voices.push(d.voice)
      for (const v of voices) this._kill(v)
      this._sceneTrack = null
      this._emitters.clear()
      this._dancers.clear()
      this._buffers.clear()
      const ctx = this._ctx
      this._ctx = null
      if (ctx && typeof ctx.close === 'function') {
        Promise.resolve(ctx.close()).catch((err) => this._warn('close', err))
      }
    })
  }

  // ---- internals -------------------------------------------------------------------------

  _live() {
    return !!this._ctx && !this._destroyed
  }

  _warn(key, err) {
    if (this._warned.has(key)) return
    this._warned.add(key)
    try {
      console.warn('[town audio]', typeof err === 'string' ? err : `${key}: ${err?.message || err}`)
    } catch {
      // console unavailable: stay silent
    }
  }

  _safe(tag, fn, fallback) {
    try {
      return fn()
    } catch (err) {
      this._warn(tag, err)
      return fallback
    }
  }

  _buildGraph() {
    const ctx = this._ctx
    const gain = (to, value) => {
      const g = ctx.createGain()
      g.gain.value = value
      g.gain._townTarget = value
      g.connect(to)
      return g
    }
    this._master = gain(ctx.destination, 1)
    this._muffleGain = gain(this._master, this._muffled ? MUFFLE_LEVEL : 1)
    this._muffleFilter = ctx.createBiquadFilter()
    this._muffleFilter.type = 'lowpass'
    this._muffleFilter.frequency.value = this._muffled ? MUFFLE_HZ : OPEN_HZ
    this._muffleFilter.frequency._townTarget = this._muffleFilter.frequency.value
    this._muffleFilter.connect(this._muffleGain)
    this._musicBus = gain(this._muffleFilter, this._enabled.music ? this._volumes.music : 0)
    this._duckNode = gain(this._musicBus, 1 - DUCK_DEPTH * this._duckAmount)
    this._sceneBus = gain(this._duckNode, 1)
    this._danceBus = gain(this._duckNode, 1)
    this._townSfxBus = gain(this._muffleFilter, this._enabled.sfx ? this._volumes.sfx : 0)
    this._sfxBus = gain(this._master, this._enabled.sfx ? this._volumes.sfx : 0)
  }

  // Older iOS only unlocks output once a source starts inside the gesture.
  _prime() {
    try {
      const ctx = this._ctx
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100)
      src.connect(this._master)
      src.start(0)
    } catch (err) {
      this._warn('prime', err)
    }
  }

  _applyAll() {
    if (!this._live()) return
    this._applyBusGains()
    this._applyMuffle()
    this._syncScene()
    this._syncEmitters()
    this._syncDances()
  }

  _applyBusGains() {
    this._ramp(this._musicBus.gain, this._enabled.music ? this._volumes.music : 0, 0.4)
    this._ramp(this._sfxBus.gain, this._enabled.sfx ? this._volumes.sfx : 0, 0.25)
    this._ramp(this._townSfxBus.gain, this._enabled.sfx ? this._volumes.sfx : 0, 0.25)
  }

  _applyMuffle() {
    this._ramp(this._muffleGain.gain, this._muffled ? MUFFLE_LEVEL : 1, 0.35)
    this._ramp(this._muffleFilter.frequency, this._muffled ? MUFFLE_HZ : OPEN_HZ, 0.35)
  }

  // Smoothly move an AudioParam to `value` over about `time` seconds (no-op if already there).
  _ramp(param, value, time = SMOOTH) {
    if (param._townTarget !== undefined && Math.abs(param._townTarget - value) < 1e-4) return
    param._townTarget = value
    const now = this._ctx.currentTime
    hold(param, now)
    param.setTargetAtTime(value, now, time / 3)
  }

  _load(file) {
    let entry = this._buffers.get(file)
    if (entry) {
      if (entry.buffer) return Promise.resolve(entry.buffer)
      if (entry.promise) return entry.promise
      if (Date.now() - entry.failedAt < RETRY_MS) return Promise.resolve(null)
    }
    entry = { buffer: null, promise: null, failedAt: 0 }
    this._buffers.set(file, entry)
    const ctx = this._ctx
    const url = `${this._base}audio/${file}`
    const p = Promise.resolve()
      .then(() => {
        const f = this._fetch
        if (typeof f !== 'function') throw new Error('fetch is not available')
        return f(url)
      })
      .then((res) => {
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'error'}`)
        return res.arrayBuffer()
      })
      .then((data) => decode(ctx, data))
      .then(
        (buffer) => {
          entry.buffer = buffer
          entry.promise = null
          return buffer
        },
        (err) => {
          entry.failedAt = Date.now()
          entry.promise = null
          if (!this._destroyed) this._warn(`load:${file}`, `could not load ${url}: ${err?.message || err}`)
          return null
        },
      )
    entry.promise = p
    return p
  }

  // Effects are tiny (~100 KB together): fetch them once, one at a time, after the scene track.
  _warmEffects() {
    if (this._warming || !this._live() || !this._enabled.sfx) return
    this._warming = true
    const scene = this._sceneTrack ? MUSIC[this._sceneTrack.name] : null
    let chain = scene ? this._load(scene.file) : Promise.resolve()
    for (const name of EFFECTS) chain = chain.then(() => (this._live() ? this._load(`${name}.mp3`) : null))
    chain.catch((err) => this._warn('warm', err))
  }

  // Start a buffer through gain (-> panner) into `dest`. Loops use the file's loop points.
  _startVoice(buffer, dest, { level = 1, pan = null, meta = null, offset = 0, fadeIn = 0 } = {}) {
    const ctx = this._ctx
    const src = ctx.createBufferSource()
    src.buffer = buffer
    if (meta) {
      src.loop = true
      if (meta.loopEnd <= buffer.duration + 1e-3) {
        src.loopStart = meta.loopStart
        src.loopEnd = meta.loopEnd
      }
    }
    const g = ctx.createGain()
    let panner = null
    src.connect(g)
    if (pan !== null && typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner()
      panner.pan.value = pan
      g.connect(panner)
      panner.connect(dest)
    } else {
      g.connect(dest)
    }
    const now = ctx.currentTime
    if (fadeIn > 0) {
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(level, now + fadeIn)
    } else {
      g.gain.value = level
    }
    g.gain._townTarget = level
    const voice = { src, gain: g, panner, level, pan, stopped: false }
    src.onended = () => this._disconnect(voice)
    src.start(now, offset)
    return voice
  }

  _setVoice(voice, level, pan) {
    if (!voice || voice.stopped) return
    if (Math.abs(voice.level - level) > 1e-3) {
      voice.level = level
      this._ramp(voice.gain.gain, level)
    }
    if (voice.panner && pan !== null && Math.abs(voice.pan - pan) > 1e-3) {
      voice.pan = pan
      this._ramp(voice.panner.pan, pan)
    }
  }

  _stopVoice(voice, fade) {
    if (!voice || voice.stopped || !this._ctx) return
    voice.stopped = true
    const now = this._ctx.currentTime
    const g = voice.gain.gain
    hold(g, now)
    g.linearRampToValueAtTime(0, now + fade)
    try {
      voice.src.stop(now + fade + 0.05)
    } catch (err) {
      this._warn('stop', err)
    }
  }

  _kill(voice) {
    if (!voice) return
    voice.stopped = true
    try { voice.src.stop() } catch { /* already stopped */ }
    this._disconnect(voice)
  }

  _disconnect(voice) {
    for (const node of [voice.src, voice.gain, voice.panner]) {
      try { node?.disconnect() } catch { /* already gone */ }
    }
  }

  _syncScene() {
    const want = this._enabled.music ? this._scene : 'silent'
    const cur = this._sceneTrack
    if (cur && cur.name === want && !cur.failed) return
    if (cur) {
      this._stopVoice(cur.voice, SCENE_FADE)
      this._sceneTrack = null
    }
    if (want === 'silent') return
    const meta = MUSIC[want]
    const track = { name: want, voice: null }
    this._sceneTrack = track
    this._load(meta.file).then((buffer) => {
      if (this._sceneTrack !== track || !this._live()) return
      if (!buffer) {
        track.failed = true
        return
      }
      track.voice = this._startVoice(buffer, this._sceneBus, { meta, offset: meta.loopStart, fadeIn: SCENE_FADE })
    })
  }

  _syncEmitters() {
    for (const [id, em] of this._emitters) {
      const meta = AMBIENT[em.spec.sound]
      const { gain, pan } = positional(this._listener, em.spec, em.spec.radius)
      const level = gain * em.spec.volume
      const audible = this._enabled.sfx && level > SILENT
      if (!audible) {
        if (em.voice) {
          this._stopVoice(em.voice, 0.5)
          em.voice = null
        }
        continue
      }
      if (em.voice) {
        this._setVoice(em.voice, level, pan)
        continue
      }
      if (em.pending) continue
      em.pending = true
      this._load(meta.file).then((buffer) => {
        em.pending = false
        if (!buffer || this._emitters.get(id) !== em || em.voice || !this._live()) return
        const now = positional(this._listener, em.spec, em.spec.radius)
        const lvl = now.gain * em.spec.volume
        if (!this._enabled.sfx || lvl <= SILENT) return
        // Start somewhere inside the loop so neighbouring fires do not crackle in step.
        const offset = meta.loopStart + Math.random() * (meta.loopEnd - meta.loopStart)
        em.voice = this._startVoice(buffer, this._townSfxBus, { level: lvl, pan: now.pan, meta, offset, fadeIn: 0.6 })
      })
    }
  }

  _syncDances() {
    const ranked = []
    for (const [key, d] of this._dancers) {
      const p = d.where ? positional(this._listener, d.where, DANCE_RADIUS) : { gain: 1, pan: null }
      ranked.push({ key, d, gain: p.gain, pan: p.pan })
    }
    ranked.sort((a, b) => b.gain - a.gain)
    let loudest = 0
    ranked.forEach(({ key, d, gain, pan }, i) => {
      const audible = this._enabled.music && i < MAX_DANCES && gain > SILENT
      if (!audible) {
        if (d.voice) {
          this._stopVoice(d.voice, 0.6)
          d.voice = null
        }
        return
      }
      loudest = Math.max(loudest, gain)
      if (d.voice) {
        this._setVoice(d.voice, gain, pan)
        return
      }
      if (d.pending) return
      d.pending = true
      const song = d.song
      this._load(song.file).then((buffer) => {
        d.pending = false
        if (!buffer || this._dancers.get(key) !== d || d.song !== song || d.voice || !this._live()) return
        if (!this._enabled.music) return
        const p = d.where ? positional(this._listener, d.where, DANCE_RADIUS) : { gain: 1, pan: null }
        if (p.gain <= SILENT) return
        d.voice = this._startVoice(buffer, this._danceBus, { level: p.gain, pan: p.pan, meta: song, offset: song.loopStart, fadeIn: 0.4 })
      })
    })
    const dip = 1 - DANCE_OVER_SCENE * loudest
    if (Math.abs(dip - this._sceneDip) > 1e-3) {
      this._sceneDip = dip
      this._ramp(this._sceneBus.gain, dip, 0.8)
    }
  }
}
