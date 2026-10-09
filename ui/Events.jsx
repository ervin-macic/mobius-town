import { useMemo, useState } from 'react'
import { Calendar, Check, Clock, MapPin, Plus, X } from '@openai/apps-sdk-ui/components/Icon'

const KINDS = [
  { id: 'talks', name: 'Lightning talks', note: '5-minute talks, one after another' },
  { id: 'meetup', name: 'Meetup', note: 'Hang out and chat' },
  { id: 'games', name: 'Game night', note: 'Chess, Connect Four and party games' },
]
const PLACES = [
  { id: 'stage', name: 'Auditorium stage' }, { id: 'plaza', name: 'Town square' }, { id: 'cafe', name: 'Café' },
  { id: 'cinema', name: 'Cinema' }, { id: 'garden', name: 'Möbius Garden' }, { id: 'meet-a', name: 'Meeting Room A' },
  { id: 'meet-b', name: 'Meeting Room B' },
]
const PLACE_GO = { stage: 'stage', plaza: 'plaza', cafe: 'cafe', cinema: 'cinema', garden: 'garden', 'meet-a': 'meet-a', 'meet-b': 'meet-b' }

function when(ms) {
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const tomorrow = new Date(today.getTime() + 86_400_000).toDateString() === d.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  if (tomorrow) return `Tomorrow ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

function localInputValue(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function CreateForm({ town, onDone }) {
  const [title, setTitle] = useState('Lightning talks')
  const [kind, setKind] = useState('talks')
  const [place, setPlace] = useState('stage')
  const [start, setStart] = useState(() => localInputValue(Math.ceil((Date.now() + 15 * 60_000) / 300_000) * 300_000))
  const [minutes, setMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const starts = new Date(start).getTime()
    if (!title.trim() || !Number.isFinite(starts)) return
    setBusy(true)
    const r = await town.createEvent({ title: title.trim(), kind, place, starts: Math.round(starts + town.serverOffset), minutes: Number(minutes) })
    setBusy(false)
    if (r) onDone()
  }
  return (
    <form className="mt-event-form" onSubmit={submit}>
      <label>Title<input className="mt-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
      <div className="mt-event-kinds" role="radiogroup" aria-label="Kind of event">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id}
            className={`mt-toggle${kind === k.id ? ' is-on' : ''}`}
            onClick={() => { setKind(k.id); if (k.id === 'talks') setPlace('stage') }}>
            <span><b>{k.name}</b><small>{k.note}</small></span>
          </button>
        ))}
      </div>
      <div className="mt-event-row">
        <label>Starts<input className="mt-input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>Length
          <select className="mt-input" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
          </select>
        </label>
      </div>
      <label>Where
        <select className="mt-input" value={place} onChange={(e) => setPlace(e.target.value)}>
          {PLACES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="mt-actions">
        <button type="button" className="mt-btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="mt-btn is-primary" disabled={busy || !title.trim()}>{busy ? 'Scheduling…' : 'Schedule'}</button>
      </div>
    </form>
  )
}

function EventCard({ ev, town, me, now }) {
  const [talkTitle, setTalkTitle] = useState('')
  const live = ev.starts <= now && now <= ev.starts + ev.minutes * 60_000
  // Talks can start from 15 minutes before the event (the hub allows the same window).
  const canStart = ev.starts - 15 * 60_000 <= now && now <= ev.starts + ev.minutes * 60_000
  const going = ev.going?.includes(me)
  const mySlot = ev.slots?.findIndex((s) => s.pid === me)
  const isHost = ev.host === me
  const cur = ev.current
  const kind = KINDS.find((k) => k.id === ev.kind)
  const place = PLACES.find((p) => p.id === ev.place)
  return (
    <article className={`mt-event${live ? ' is-live' : ''}`}>
      <header>
        <span className="mt-event-kind">{live ? 'Live now' : kind?.name}</span>
        <h3>{ev.title}</h3>
        <p className="mt-event-meta">
          <Clock aria-hidden="true" /> {when(ev.starts - town.serverOffset)} · {ev.minutes < 60 ? `${ev.minutes} min` : `${ev.minutes / 60} h`}
          <span aria-hidden="true"> · </span><MapPin aria-hidden="true" /> {place?.name}
        </p>
        <p className="mt-event-meta">Hosted by {isHost ? 'you' : ev.hostName} · {ev.going?.length || 0} going</p>
      </header>
      {ev.kind === 'talks' && (
        <ol className="mt-slots">
          {ev.slots.length === 0 && <li className="mt-empty-slot">No talks yet — be the first.</li>}
          {ev.slots.map((s, i) => {
            const running = cur?.slot === i
            const left = running ? Math.max(0, cur.seconds - (now - cur.started) / 1000) : null
            return (
              <li key={s.pid} className={running ? 'is-running' : ''}>
                <span className="mt-slot-num">{i + 1}</span>
                <span className="mt-slot-main"><b>{s.title}</b><small>{s.pid === me ? 'You' : s.name}</small></span>
                {running && <span className="mt-slot-clock">{`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`}</span>}
                {(isHost || s.pid === me) && canStart && !running && (
                  <button type="button" className="mt-btn" onClick={() => town.act('talk_start', { id: ev.id, slot: i })}>Start 5 min</button>
                )}
                {(isHost || s.pid === me) && running && (
                  <button type="button" className="mt-btn is-danger" onClick={() => town.act('talk_stop', { id: ev.id })}>Stop</button>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <div className="mt-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
        <button type="button" className={`mt-btn${going ? ' is-on' : ''}`} aria-pressed={going}
          onClick={() => town.act('event_rsvp', { id: ev.id, going: !going })}>
          {going ? <><Check aria-hidden="true" /> Going</> : 'I’m going'}
        </button>
        <button type="button" className="mt-btn" onClick={() => town.goTo(PLACE_GO[ev.place] || 'plaza')}>
          <MapPin aria-hidden="true" /> Walk there
        </button>
        {isHost && <button type="button" className="mt-btn is-danger" onClick={() => town.act('event_cancel', { id: ev.id })}>Cancel event</button>}
      </div>
      {ev.kind === 'talks' && (
        <form className="mt-compose" style={{ padding: '10px 0 0', borderTop: 0 }}
          onSubmit={(e) => { e.preventDefault(); if (talkTitle.trim()) town.act('event_slot', { id: ev.id, title: talkTitle.trim() }).then(() => setTalkTitle('')) }}>
          <input className="mt-input" value={talkTitle} maxLength={80} aria-label="Your talk title"
            placeholder={mySlot >= 0 ? 'Rename your talk' : 'Sign up: your talk title'} onChange={(e) => setTalkTitle(e.target.value)} />
          <button type="submit" className="mt-btn" disabled={!talkTitle.trim()}>{mySlot >= 0 ? 'Rename' : 'Sign up'}</button>
          {mySlot >= 0 && <button type="button" className="mt-btn" onClick={() => town.act('event_unslot', { id: ev.id })}>Withdraw</button>}
        </form>
      )}
    </article>
  )
}

export default function EventsPanel({ town, state, onClose }) {
  const [creating, setCreating] = useState(false)
  const now = town.serverNow()
  const events = useMemo(() => [...(state.world.events || [])].sort((a, b) => a.starts - b.starts), [state.world.events])
  return (
    <section className="mt-panel mt-events" aria-label="Events">
      <header>
        <h2>Events</h2>
        {!creating && (
          <button type="button" className="mt-btn" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Schedule</button>
        )}
        <button type="button" className="mt-iconbtn" style={{ width: 36, height: 36 }} aria-label="Close events" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="mt-scroll">
        {creating && <CreateForm town={town} onDone={() => setCreating(false)} />}
        {!creating && events.length === 0 && (
          <div className="mt-empty">
            <Calendar aria-hidden="true" style={{ width: 28, height: 28 }} />
            <p>Nothing scheduled yet. Start a lightning-talk night: everyone gets five minutes on the auditorium stage, with a countdown everyone in the room can see.</p>
          </div>
        )}
        {!creating && events.map((ev) => <EventCard key={ev.id} ev={ev} town={town} me={state.pid} now={now} />)}
      </div>
    </section>
  )
}
