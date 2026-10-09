import { useEffect, useRef, useState } from 'react'
import {
  Calendar, Chat, ExitLogout, Group, HandWavingBye, Keyboard, Lock, LockKeyHole, Maps, Mic, MicOff, Minus, Music, Plus,
  SoundOffSpeaker, SoundOnReadOutLoudSpeaker, Users, Video, VideoFilledOff, X,
} from '@openai/apps-sdk-ui/components/Icon'
import AvatarCanvas from './AvatarCanvas.jsx'

const PROMPTS = {
  seat: 'Sit down',
  chess: 'Play chess',
  connect4: 'Play Connect Four',
  tv: 'Use the TV',
  notice: 'Read the town board',
  sign: 'Read the sign',
  statue: 'View the statue',
  fountain: 'Toss a coin into the fountain',
  mobius: 'Admire the Möbius strip',
  spotlight: 'You are on stage',
  pitch: 'Play football',
}

export function promptFor(object, extra) {
  if (!object) return null
  if (extra?.[object.id]) return extra[object.id]
  if (object.kind === 'sign' && object.text) return `Read: ${object.text}`
  if (object.kind === 'cat') return `Pet ${object.text}`
  return PROMPTS[object.kind] || 'Interact'
}

function PlacesMenu({ places, onGo }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`mt-iconbtn${open ? ' is-on' : ''}`} aria-label="Places" aria-expanded={open}
        title="Walk to a place" onClick={() => setOpen((v) => !v)}>
        <Maps aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-places" role="menu" aria-label="Walk to">
          {places.map((p) => (
            <button key={p.id} type="button" role="menuitem" className="mt-btn" onClick={() => { onGo(p.id); setOpen(false) }}>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return [open, setOpen, ref]
}

function SoundMenu({ sound, onSound }) {
  const [open, setOpen, ref] = usePopover()
  const on = sound.music || sound.sfx
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`mt-iconbtn${open ? ' is-on' : ''}`} aria-label="Sound settings" aria-expanded={open}
        title="Music and sounds" onClick={() => setOpen((v) => !v)}>
        {on ? <SoundOnReadOutLoudSpeaker aria-hidden="true" /> : <SoundOffSpeaker aria-hidden="true" />}
      </button>
      {open && (
        <div className="mt-places" role="group" aria-label="Sound settings">
          <button type="button" className={`mt-toggle${sound.music ? ' is-on' : ''}`} aria-pressed={sound.music}
            onClick={() => onSound({ music: !sound.music })}>
            <Music aria-hidden="true" /> {sound.music ? 'Music on' : 'Music off'}
          </button>
          <button type="button" className={`mt-toggle${sound.sfx ? ' is-on' : ''}`} aria-pressed={sound.sfx}
            onClick={() => onSound({ sfx: !sound.sfx })}>
            {sound.sfx ? <SoundOnReadOutLoudSpeaker aria-hidden="true" /> : <SoundOffSpeaker aria-hidden="true" />}
            {sound.sfx ? 'Sound effects on' : 'Sound effects off'}
          </button>
        </div>
      )}
    </div>
  )
}

export function LiveTalk({ talk }) {
  if (!talk) return null
  const s = Math.ceil(talk.left)
  return (
    <div className={`mt-live${s <= 30 ? ' is-warn' : ''}`} role="status" aria-live="off">
      <span className="mt-live-dot" aria-hidden="true" />
      <span className="mt-live-text"><b>{talk.speaker}</b> · {talk.title}</span>
      <span className="mt-live-clock">{s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : "Time's up"}</span>
    </div>
  )
}

export function TopBar({ ui, status, online, roomLock, onLock, onHelp, places, onGo, sound, onSound, onEvents, eventsLive, onLeave }) {
  const place = ui.room && ui.room.name !== ui.mapName ? ui.room.name : ui.mapName
  const dotClass = status === 'online' ? '' : status === 'connecting' ? ' is-warn' : ' is-off'
  const statusText = status === 'online'
    ? `${online} ${online === 1 ? 'Möbian' : 'Möbians'} in town`
    : status === 'connecting' ? 'Connecting…' : 'Offline — exploring alone'
  return (
    <div className="mt-top">
      <div className="mt-chip" role="status" aria-live="polite">
        <span className={`mt-dot${dotClass}`} aria-hidden="true" />
        <span className="mt-place">{place}</span>
        <span className="mt-sub">{statusText}</span>
      </div>
      {ui.room?.lockable && (
        <button
          type="button"
          className={`mt-btn${roomLock ? ' is-danger' : ''}`}
          style={{ background: roomLock ? undefined : 'var(--mt-panel)' }}
          onClick={onLock}
          aria-pressed={!!roomLock}
        >
          {roomLock ? <Lock aria-hidden="true" /> : <LockKeyHole aria-hidden="true" />}
          {roomLock ? 'Unlock room' : 'Lock room'}
        </button>
      )}
      <span className="mt-spacer" />
      <div className="mt-top-actions">
      <button type="button" className={`mt-iconbtn${eventsLive ? ' is-gold' : ''}`} aria-label="Events" title="Events and talks"
        onClick={onEvents}>
        <Calendar aria-hidden="true" />
        {eventsLive > 0 && <span className="mt-badge" style={{ background: 'var(--mt-gold)', color: '#2a1d0b' }}>{eventsLive}</span>}
      </button>
      <SoundMenu sound={sound} onSound={onSound} />
      <PlacesMenu places={places} onGo={onGo} />
      <button type="button" className="mt-iconbtn mt-kbd-btn" aria-label="Keyboard controls" title="Controls" onClick={onHelp}>
        <Keyboard aria-hidden="true" />
      </button>
      {onLeave && (
        <button type="button" className="mt-iconbtn" aria-label="Leave town" title="Leave town: stop the game and its sound" onClick={onLeave}>
          <ExitLogout aria-hidden="true" />
        </button>
      )}
      </div>
    </div>
  )
}

export function Dock({
  me, call, bubble, panel, unread, online, onEditLook, onMic, onCam, onBubble, onEmote, onPanel, songs, dancing,
}) {
  const [emotes, setEmotes] = useState(false)
  const emoteRef = useRef(null)
  useEffect(() => {
    if (!emotes) return undefined
    const close = (e) => { if (!emoteRef.current?.contains(e.target)) setEmotes(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [emotes])
  const callOn = call.state === 'live'
  return (
    <nav className="mt-dock" aria-label="Controls">
      <button type="button" className="mt-me" onClick={onEditLook} aria-label="Change your look" title="Change your look">
        <AvatarCanvas look={me.look} scale={2} />
        <span>{me.name}</span>
      </button>
      <span className="mt-dock-sep" aria-hidden="true" />
      <button
        type="button"
        className={`mt-iconbtn${callOn && call.audio ? ' is-on' : callOn ? ' is-alert' : ''}`}
        aria-label={callOn && call.audio ? 'Mute microphone' : 'Turn on microphone'}
        aria-pressed={callOn && call.audio}
        title={call.note || 'Microphone (M)'}
        disabled={!call.available}
        onClick={onMic}
      >
        {callOn && call.audio ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
      </button>
      <button
        type="button"
        className={`mt-iconbtn${callOn && call.video ? ' is-on' : ''}`}
        aria-label={callOn && call.video ? 'Turn camera off' : 'Turn camera on'}
        aria-pressed={callOn && call.video}
        title={call.note || 'Camera (V)'}
        disabled={!call.available}
        onClick={onCam}
      >
        {callOn && call.video ? <Video aria-hidden="true" /> : <VideoFilledOff aria-hidden="true" />}
      </button>
      <button
        type="button"
        className={`mt-iconbtn${bubble ? ' is-gold' : ''}`}
        aria-label={bubble ? 'Leave the conversation bubble' : 'Start a conversation bubble with Möbians nearby'}
        aria-pressed={!!bubble}
        title={bubble ? 'Leave bubble (B)' : 'Bubble up with Möbians nearby (B)'}
        onClick={onBubble}
      >
        <Group aria-hidden="true" />
      </button>
      <div ref={emoteRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="mt-iconbtn"
          aria-label="Emotes"
          aria-expanded={emotes}
          title="Emotes (1–4)"
          onClick={() => setEmotes((v) => !v)}
        >
          <HandWavingBye aria-hidden="true" />
          {dancing && <span className="mt-badge" style={{ background: 'var(--mt-teal)' }}><Music aria-hidden="true" style={{ width: 11, height: 11 }} /></span>}
        </button>
        {emotes && (
          <div className="mt-emotes" role="menu">
            {[['wave', 'Wave', '1'], ['heart', 'Heart', '2'], ['excl', 'Wow!', '3'], ['q', 'Hmm?', '4']].map(([k, label, key]) => (
              <button key={k} type="button" role="menuitem" className="mt-btn" onClick={() => { onEmote(k); setEmotes(false) }}>
                <span className="mt-key" style={{ minWidth: 24, height: 24, fontSize: 13 }}>{key}</span>{label}
              </button>
            ))}
            <div className="mt-emote-sep" role="separator" />
            <p className="mt-emote-head"><Music aria-hidden="true" /> Dance to…</p>
            {(songs.length ? songs : [{ id: 'groove', title: 'Your groove' }]).map((song, i) => (
              <button key={song.id} type="button" role="menuitemradio" aria-checked={dancing === song.id}
                className={`mt-btn${dancing === song.id ? ' is-on' : ''}`}
                onClick={() => { onEmote('dance', song.id); setEmotes(false) }}>
                {i === 0 && <span className="mt-key" style={{ minWidth: 24, height: 24, fontSize: 13 }}>5</span>}
                {song.title}{dancing === song.id ? ' · stop' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="mt-dock-sep" aria-hidden="true" />
      <button
        type="button"
        className={`mt-iconbtn${panel === 'chat' ? ' is-on' : ''}`}
        aria-label="Chat"
        aria-pressed={panel === 'chat'}
        title="Chat (Enter)"
        onClick={() => onPanel('chat')}
      >
        <Chat aria-hidden="true" />
        {unread > 0 && panel !== 'chat' && <span className="mt-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <button
        type="button"
        className={`mt-iconbtn${panel === 'people' ? ' is-on' : ''}`}
        aria-label={`Möbians (${online})`}
        aria-pressed={panel === 'people'}
        title="Möbians (P)"
        onClick={() => onPanel('people')}
      >
        <Users aria-hidden="true" />
        {online > 1 && <span className="mt-badge" style={{ background: '#2b6b58' }}>{online}</span>}
      </button>
    </nav>
  )
}

export function Prompt({ label, onActivate }) {
  if (!label) return null
  return (
    <button type="button" className="mt-prompt" onClick={onActivate}>
      <span className="mt-key">X</span>
      {label}
    </button>
  )
}

export function Toasts({ toasts, onDismiss }) {
  return (
    <div className="mt-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div className="mt-toast" key={t.id}>
          <p>{t.text}</p>
          {(t.actions || []).map((a) => (
            <button key={a.label} type="button" className={`mt-btn${a.primary ? ' is-primary' : ''}`}
              onClick={() => { a.run(); onDismiss(t.id) }}>
              {a.label}
            </button>
          ))}
          <button type="button" className="mt-iconbtn" style={{ width: 34, height: 34 }} aria-label="Dismiss"
            onClick={() => onDismiss(t.id)}>
            <X aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function HelpCard({ onClose }) {
  const rows = [
    ['Arrows / WASD', 'Walk (two at once for diagonals; tap for a small step)'],
    ['Q / Z', 'Pass to your teammate (football)'],
    ['X / E / Space', 'Use what you are standing at'],
    ['Enter', 'Chat with the Möbians who can hear you'],
    ['B', 'Start or leave a conversation bubble'],
    ['M / V', 'Microphone / camera'],
    ['1 – 4', 'Wave, heart, wow, hmm'],
    ['5', 'Dance (pick a song in the emote menu)'],
    ['P', 'Möbians: walk to someone or challenge them to a party'],
    ['+ / − / 0', 'Zoom in or out 20%, or back to 100%'],
    ['Esc', 'Close panels and games'],
  ]
  return (
    <div className="mt-cover" role="dialog" aria-modal="true" aria-labelledby="mt-help-title" onClick={onClose}>
      <div className="mt-card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)' }}>
        <h2 id="mt-help-title" className="mt-title" style={{ fontSize: 26 }}>CONTROLS</h2>
        <dl className="mt-help">
          {rows.map(([k, v]) => (
            <div key={k}><dt className="mt-pixel">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <p className="mt-note">
          Voices fade with distance. Inside a bubble you hear each other clearly while people nearby
          still hear you faintly. Meeting rooms are private and can be locked. Whoever stands in the
          auditorium spotlight is heard by the whole room.
        </p>
        <p className="mt-note">
          Walk onto any chair to sit. At a chess or Connect Four table with nobody opposite you can
          play a bot. A party is three quick games against a friend. The calendar schedules talks and
          meetups; the speaker icon switches music and sounds.
        </p>
        <div className="mt-actions"><button type="button" className="mt-btn is-primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  )
}

/** How close you are to your character: 20% a press, and the percentage resets to 100%. */
export function ZoomControl({ zoom, min, max, onZoom, onReset }) {
  const percent = Math.round(zoom * 100)
  return (
    <div className="mt-zoom" role="group" aria-label="Zoom">
      <button type="button" className="mt-iconbtn" aria-label="Zoom in" title="Zoom in 20% (+)"
        disabled={zoom >= max - 0.001} onClick={() => onZoom(1)}>
        <Plus aria-hidden="true" />
      </button>
      <button type="button" className="mt-zoom-level" title="Back to 100% (0)" aria-label={`Zoom ${percent}%, reset to 100%`} onClick={onReset}>
        {percent}%
      </button>
      <button type="button" className="mt-iconbtn" aria-label="Zoom out" title="Zoom out 20% (−)"
        disabled={zoom <= min + 0.001} onClick={() => onZoom(-1)}>
        <Minus aria-hidden="true" />
      </button>
    </div>
  )
}
