import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CSS } from './theme.js'
import { FONTS } from './engine/fonts.gen.js'
import { DEFAULT_LOOK, normalizeLook, randomLook } from './engine/assets.js'
import { PLACES, Town } from './town.js'
import JoinScreen from './ui/JoinScreen.jsx'
import { Dock, HelpCard, LiveTalk, Prompt, promptFor, Toasts, TopBar, ZoomControl } from './ui/Hud.jsx'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './engine/game.js'
import { ChatPanel, PeoplePanel } from './ui/Panels.jsx'
import EventsPanel from './ui/Events.jsx'
import Overlays from './ui/Overlays.jsx'
import VideoStrip from './ui/VideoStrip.jsx'
import PartyOverlay from './ui/Party.jsx'
import { PitchLobby, Scoreboard, TouchPad } from './ui/Football.jsx'
import { StageControls, StageScreen } from './ui/StageScreen.jsx'
import { PARTY_CSS } from './ui/partyCss.js'

// Pixel fonts arrive as bytes: the frame's policy has no data: font source,
// and FontFace(name, buffer) involves no URL fetch at all.
let fontsLoaded = null
function loadFonts() {
  if (fontsLoaded) return fontsLoaded
  const add = (family, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const face = new FontFace(family, bytes.buffer)
    document.fonts.add(face)
    return face.load()
  }
  fontsLoaded = Promise.all([add('KenneyMini', FONTS.mini), add('KenneyBlocks', FONTS.blocks)]).catch(() => {})
  return fontsLoaded
}

const store = () => window.mobius?.storage || null

async function readProfile() {
  try {
    return (await store()?.get('profile.json')) || null
  } catch {
    return null
  }
}

async function saveProfile(profile) {
  try {
    await store()?.set('profile.json', profile)
  } catch (err) {
    window.mobius?.signal?.('error', { message: String(err?.message || err), source: 'profile' })
  }
}

function useImmersive(appId) {
  useEffect(() => {
    const post = (value) => window.parent.postMessage({ type: 'moebius:immersive', value, appId }, '*')
    post(true)
    return () => post(false)
  }, [appId])
}

export default function App({ appId, token }) {
  useImmersive(appId)
  const [phase, setPhase] = useState('loading')
  const [profile, setProfile] = useState(null)
  const [identity, setIdentity] = useState(null)
  const townRef = useRef(null)
  const [town, setTown] = useState(null)
  // Leaving the town ends this visit for good; coming back builds a fresh town.
  const [visit, setVisit] = useState(0)

  useEffect(() => {
    let alive = true
    const t = new Town({ appId, token })
    townRef.current = t
    Promise.all([loadFonts(), readProfile(), t.identify()]).then(([, saved, ident]) => {
      if (!alive) return
      setIdentity(ident)
      const name = saved?.name || ident?.name || ident?.handle || 'Traveller'
      setProfile({
        name,
        look: normalizeLook(saved?.look || randomLook()),
        audio: saved?.audio ?? true,
        video: saved?.video ?? true,
        sound: saved?.sound || { music: true, sfx: true },
        danceSong: saved?.danceSong || null,
        // How close you were to your character (the town keeps it within 50%-250%).
        zoom: Number.isFinite(saved?.zoom) ? saved.zoom : 1,
      })
      setTown(t)
      setPhase('join')
      window.mobius?.signal?.('app_ready', { item_count: saved ? 1 : 0 })
    })
    return () => {
      alive = false
      t.destroy()
    }
  }, [appId, token, visit])

  /** Leave the town: the game, its sound and every connection stop until you come back. */
  const leave = useCallback(() => {
    townRef.current?.destroy()
    setPhase('left')
  }, [])

  const enter = useCallback((next) => {
    const p = { ...profile, ...next }
    setProfile(p)
    saveProfile({ name: p.name, look: p.look, audio: p.audio, video: p.video, sound: p.sound, danceSong: p.danceSong, zoom: p.zoom })
    setPhase('play')
  }, [profile])

  return (
    <div className="mt-root">
      <style>{CSS + PARTY_CSS}</style>
      {phase === 'loading' && <div className="mt-loading"><p>Loading Möbius Town…</p></div>}
      {phase === 'join' && profile && (
        <JoinScreen
          mode="join"
          initial={profile}
          identity={identity}
          callAvailable={town?.callAvailable()}
          callNote={town?.callNote()}
          onDone={enter}
        />
      )}
      {phase === 'play' && town && (
        <GameView town={town} profile={profile} identity={identity} onLeave={leave}
          onProfile={(p) => { setProfile(p); saveProfile({ name: p.name, look: p.look, audio: p.audio, video: p.video, sound: p.sound, danceSong: p.danceSong, zoom: p.zoom }) }} />
      )}
      {phase === 'left' && (
        <div className="mt-cover" role="dialog" aria-modal="true" aria-labelledby="mt-left-title">
          <div className="mt-card">
            <h1 id="mt-left-title" className="mt-title">MÖBIUS TOWN</h1>
            <p className="mt-lede">
              You've left the town. The game, its music and your connection to the other Möbians have all stopped.
            </p>
            <div className="mt-actions">
              <button type="button" className="mt-btn is-primary" onClick={() => { setPhase('loading'); setVisit((v) => v + 1) }}>
                Enter again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const KICK_KEYS = new Set([' ', 'x', 'X', 'e', 'E', 'k', 'K'])
const PASS_KEYS = new Set(['q', 'Q', 'z', 'Z'])

const KEY_DIR = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
}

function isTyping(target) {
  const tag = target?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable
}

function GameView({ town, profile, identity, onProfile, onLeave }) {
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [panel, setPanel] = useState(null)
  const [editing, setEditing] = useState(false)
  const [help, setHelp] = useState(false)
  const [chatTab, setChatTab] = useState('nearby')

  useEffect(() => {
    const canvas = canvasRef.current
    let cancelled = false
    town.start(canvas, profile).then(() => { if (!cancelled) setReady(true) })
    return () => {
      cancelled = true
      town.stop()
    }
  }, [town])

  const state = useSyncExternalStore(town.subscribe, town.snapshot)

  // Wheel and touchpad pinch zoom in proportion to how far they move. A native, non-passive
  // listener, so the browser zooms the town rather than the page.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const wheel = (e) => {
      e.preventDefault()
      const pixels = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1)
      // A mouse-wheel notch (about 100) is exactly one 20% step, like the buttons. Small steps
      // from a touchpad zoom continuously: a pinch (ctrl) follows the fingers.
      const factor = Math.abs(pixels) >= 50
        ? ZOOM_STEP ** (-Math.sign(pixels) * Math.max(1, Math.round(Math.abs(pixels) / 100)))
        : Math.exp(-pixels * (e.ctrlKey ? 0.01 : Math.log(ZOOM_STEP) / 100))
      town.game?.zoomBy(factor)
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [town])

  // Remember the distance on this device once it settles.
  useEffect(() => {
    if (Math.abs(state.zoom - (profile.zoom ?? 1)) < 0.001) return undefined
    const timer = setTimeout(() => onProfile({ ...profile, zoom: state.zoom }), 800)
    return () => clearTimeout(timer)
  }, [state.zoom, profile, onProfile])

  const party = state.world.party
  const partyOpen = !!party && !state.partyHidden
  const modalOpen = editing || help || !!state.overlay || partyOpen
  const [narrow, setNarrow] = useState(() => window.innerWidth < 720)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 720)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => {
    if (!state.panelRequest) return
    setPanel(state.panelRequest.panel)
    if (state.panelRequest.tab) setChatTab(state.panelRequest.tab)
  }, [state.panelRequest])

  // Keyboard.
  useEffect(() => {
    const down = (e) => {
      town.sound.unlock()
      if (town.game?.cutscene) {
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          town.game.skipCutscene()
        }
        return
      }
      // Playing football: the keys drive your footballer, not your avatar.
      if (town.football.controlling() && !isTyping(e.target) && !modalOpen) {
        const fdir = KEY_DIR[e.key]
        if (fdir) {
          e.preventDefault()
          town.football.key(fdir, true)
          return
        }
        if (KICK_KEYS.has(e.key)) {
          e.preventDefault()
          if (!e.repeat) town.football.kick(true)
          return
        }
        if (PASS_KEYS.has(e.key)) {
          e.preventDefault()
          if (!e.repeat) town.football.pass(true)
          return
        }
      }
      if (e.key === 'Escape') {
        // A party is modal: Leave (with its confirmation) is the way out until the final screen.
        if (partyOpen) return
        if (state.overlay) town.closeOverlay()
        else if (panel) setPanel(null)
        else if (help) setHelp(false)
        return
      }
      if (isTyping(e.target) || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const dir = KEY_DIR[e.key]
      if (dir) {
        e.preventDefault()
        town.game?.pressDir(dir)
        return
      }
      switch (e.key) {
        case 'x': case 'X': case 'e': case 'E': case ' ':
          e.preventDefault()
          town.interact()
          break
        case 'Enter':
          e.preventDefault()
          setPanel('chat')
          break
        case 'b': case 'B': town.toggleBubble(); break
        case 'm': case 'M': town.toggleMic(); break
        case 'v': case 'V': town.toggleCam(); break
        case 'p': case 'P': setPanel((p) => (p === 'people' ? null : 'people')); break
        case '1': town.emote('wave'); break
        case '2': town.emote('heart'); break
        case '3': town.emote('excl'); break
        case '4': town.emote('q'); break
        case '5': town.emote('dance'); break
        case '+': case '=': town.game?.zoomBy(ZOOM_STEP); break
        case '-': case '_': town.game?.zoomBy(1 / ZOOM_STEP); break
        case '0': town.game?.setZoom(1); break
        default:
      }
    }
    const up = (e) => {
      const dir = KEY_DIR[e.key]
      if (dir) town.game?.releaseDir(dir)
      if (dir) town.football.key(dir, false)
      if (KICK_KEYS.has(e.key)) town.football.kick(false)
      if (PASS_KEYS.has(e.key)) town.football.pass(false)
    }
    const blur = () => {
      town.game?.clearHeld()
      town.football.keys.clear()
      town.football.kick(false)
      town.football.pass(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [town, panel, help, modalOpen, state.overlay, partyOpen])

  const onPointerDown = (e) => {
    if (e.button !== 0 || !town.game) return
    town.sound.unlock()
    if (town.game.cutscene) {
      town.game.skipCutscene()
      return
    }
    canvasRef.current?.focus({ preventScroll: true })
    if (town.football.controlling()) return
    const rect = canvasRef.current.getBoundingClientRect()
    town.tapAt(e.clientX - rect.left, e.clientY - rect.top)
  }

  const ui = state.ui
  const cinematic = !!state.cutscene
  const playingFootball = !!state.football?.match?.player && !state.football.match.ended
  return (
    <div className={`mt-game-view${cinematic ? ' is-cinematic' : ''}`}>
      <canvas
        ref={canvasRef}
        className="mt-canvas"
        tabIndex={0}
        aria-label={`Möbius Town map. You are in ${ui?.room?.name || ui?.mapName || 'town'}. Use the arrow keys to walk, or tap where you want to go.`}
        data-place={ui ? `${ui.mapId}:${ui.room?.id || ''}:${ui.x},${ui.y}` : ''}
        onPointerDown={onPointerDown}
      />
      {!ready && <div className="mt-loading"><p>Entering town…</p></div>}
      {ready && ui && (
        <>
          <VideoStrip
            town={town}
            tiles={state.tiles}
            self={{ video: state.call.state === 'live' && state.call.video && !state.call.screen, audio: state.call.audio, look: profile.look }}
            hidden={!state.call.available || modalOpen || cinematic || playingFootball || (narrow && !!panel)}
          />
          <TopBar
            ui={ui}
            status={state.status}
            online={state.online}
            roomLock={state.roomLock}
            onLock={() => town.toggleRoomLock()}
            onHelp={() => setHelp(true)}
            places={PLACES}
            onGo={(id) => town.goTo(id)}
            sound={state.sound}
            onSound={(prefs) => { town.setSoundPrefs(prefs); onProfile({ ...profile, sound: { ...state.sound, ...prefs } }) }}
            onEvents={() => setPanel((p) => (p === 'events' ? null : 'events'))}
            onLeave={onLeave}
            eventsLive={(state.world.events || []).filter((ev) => ev.starts <= town.serverNow() && town.serverNow() <= ev.starts + ev.minutes * 60_000).length}
          />
          {state.ui?.mapId === 'hall' && <LiveTalk talk={state.liveTalk} />}
          {!state.overlay && !cinematic && !playingFootball && !(state.football?.status === 'lobby' && state.football.mySlot) && (
            <Prompt label={promptFor(ui.object, state.promptExtra)} onActivate={() => town.interact()} />
          )}
          {!modalOpen && !cinematic && <StageScreen town={town} state={state} />}
          {state.call.available && !modalOpen && !cinematic && <StageControls town={town} state={state} />}
          {!modalOpen && !cinematic && !playingFootball && (
            <ZoomControl zoom={state.zoom} min={ZOOM_MIN} max={ZOOM_MAX}
              onZoom={(d) => town.game?.zoomBy(d > 0 ? ZOOM_STEP : 1 / ZOOM_STEP)} onReset={() => town.game?.setZoom(1)} />
          )}
          <Scoreboard town={town} state={state} />
          <PitchLobby town={town} state={state} />
          <TouchPad town={town} state={state} />
          <Dock
            me={{ name: profile.name, look: profile.look }}
            call={state.call}
            bubble={state.bubble}
            panel={panel}
            unread={state.unread}
            online={state.online}
            onEditLook={() => setEditing(true)}
            onMic={() => town.toggleMic()}
            onCam={() => town.toggleCam()}
            onBubble={() => town.toggleBubble()}
            onEmote={(k, song) => {
              town.emote(k, song)
              if (k === 'dance' && song) onProfile({ ...profile, danceSong: song })
            }}
            onPanel={(p) => setPanel((cur) => (cur === p ? null : p))}
            songs={state.songs}
            dancing={state.dancing}
          />
          {panel === 'chat' && <ChatPanel town={town} state={state} initialTab={chatTab} onClose={() => setPanel(null)} />}
          {panel === 'people' && <PeoplePanel town={town} state={state} onClose={() => setPanel(null)} />}
          {panel === 'events' && <EventsPanel town={town} state={state} onClose={() => setPanel(null)} />}
          <Toasts toasts={state.toasts} onDismiss={(id) => town.dismissToast(id)} />
          <Overlays town={town} state={state} />
          {partyOpen && (
            <PartyOverlay party={party} me={state.pid} serverNow={() => town.serverNow()}
              onAction={(action) => town.partyAction(action)} onClose={() => town.hideParty()} />
          )}
        </>
      )}
      {editing && (
        <JoinScreen
          mode="edit"
          initial={profile}
          identity={identity}
          onCancel={() => setEditing(false)}
          onDone={(next) => {
            const p = { ...profile, look: next.look, name: next.name }
            onProfile(p)
            town.setProfile(p)
            setEditing(false)
          }}
        />
      )}
      {help && <HelpCard onClose={() => setHelp(false)} />}
    </div>
  )
}
