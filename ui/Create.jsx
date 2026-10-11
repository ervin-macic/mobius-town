import { useEffect, useMemo, useRef, useState } from 'react'
import { Chat, MapPin, PencilSparkle, Sparkles, Trash, X } from '@openai/apps-sdk-ui/components/Icon'
import { isPrivateMap } from '../engine/maps.js'

const IDEAS = [
  'A volleyball court in front of me that we can all play on',
  'Make this room lighter, with a small courtyard and a tree',
  "Decorate this place for Sam's birthday and surprise Sam when they walk in",
  'A cosy campfire with logs to sit on',
  'A little flower garden with a bench and a lamp',
  'A market stall selling lemonade, with a sign',
]

const elapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function useTick(active, every = 1000) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const t = setInterval(() => set((n) => n + 1), every)
    return () => clearInterval(t)
  }, [active, every])
}

/** One build in progress (or just finished), with what you can do about it. */
function SiteCard({ town, site, index, onChange }) {
  const b = town.building
  const now = town.serverNow()
  const active = site.status === 'planning' || site.status === 'building'
  const creation = site.creation ? index.find((c) => c.id === site.creation) : null
  const pct = site.status === 'done' ? 100 : Math.max(4, site.pct || 0)
  const eta = site.eta ? Math.max(0, Math.round((site.eta - now) / 1000)) : null
  return (
    <article className={`mt-build is-${site.status}`}>
      <p className="mt-build-ask">“{site.text}”</p>
      {active && (
        <>
          <div className="mt-build-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
            aria-label="Build progress">
            <span style={{ width: `${pct}%` }} />
          </div>
          {site.waiting && (
            <p className="mt-build-status is-ask" role="alert">Your builder has a question for you. Answer it in the builder&apos;s chat.</p>
          )}
          {site.stopped && (
            <p className="mt-build-status is-failed">The builder stopped before finishing. Open its chat to see why, or cancel.</p>
          )}
          <p className="mt-build-status" aria-live="polite">
            {site.status === 'planning' ? 'Your builder is reading the spot…' : site.label}
            <span className="mt-time"> · {elapsed(now - site.started)}{eta ? ` · about ${eta < 60 ? `${eta}s` : `${Math.ceil(eta / 60)} min`} left` : ''}</span>
          </p>
        </>
      )}
      {site.status === 'done' && (
        <p className="mt-build-status is-done">Built: <b>{creation?.title || site.label}</b></p>
      )}
      {site.status === 'failed' && <p className="mt-build-status is-failed">{site.label}</p>}
      {site.status === 'cancelled' && <p className="mt-build-status is-failed">Cancelled.</p>}
      <div className="mt-build-actions">
        {site.chatId && (
          <button type="button" className={`mt-btn${site.waiting ? ' is-primary' : ''}`} onClick={() => b.openChat(site.chatId)}>
            <Chat aria-hidden="true" /> {site.waiting ? 'Answer the builder' : 'Builder\u2019s chat'}
          </button>
        )}
        {active && <button type="button" className="mt-btn" onClick={() => b.cancel(site.id)}>Cancel</button>}
        {site.status === 'done' && creation && (
          <>
            <button type="button" className="mt-btn" onClick={() => onChange(creation)}>
              <PencilSparkle aria-hidden="true" /> Change it
            </button>
            <button type="button" className="mt-btn" onClick={() => b.remove(creation.id)}>
              <Trash aria-hidden="true" /> Undo
            </button>
          </>
        )}
      </div>
    </article>
  )
}

/** Everything built in town: walk to it, and change or remove what is yours (the keeper: anything). */
function TownList({ town, state, onChange }) {
  const bs = state.building
  const [confirm, setConfirm] = useState(null)
  const list = [...bs.index].sort((a, b) => b.updated - a.updated)
  const mapName = (id) => ({ town: 'Town', cafe: 'Café', chess: 'Chess Club', den: 'Game Den', cinema: 'Cinema', hall: 'Town Hall' }[id] || id)
  return (
    <div className="mt-scroll">
      {bs.keeper && (
        <div className="mt-build-policy" role="radiogroup" aria-label="Who may build">
          <span>Who may build</span>
          <button type="button" role="radio" aria-checked={bs.policy === 'everyone'}
            className={`mt-btn${bs.policy === 'everyone' ? ' is-on' : ''}`} onClick={() => town.building.setPolicy('everyone')}>Everyone</button>
          <button type="button" role="radio" aria-checked={bs.policy === 'keeper'}
            className={`mt-btn${bs.policy === 'keeper' ? ' is-on' : ''}`} onClick={() => town.building.setPolicy('keeper')}>Only me</button>
        </div>
      )}
      {list.length === 0 && <p className="mt-empty">Nothing has been built yet. Be the first: switch to Build and ask for something.</p>}
      {list.map((c) => {
        const mine = bs.handle && c.by.handle === bs.handle
        return (
          <div key={c.id} className="mt-made">
            <div className="mt-made-text">
              <b>{c.title}</b>
              <span className="mt-time">{mine ? 'You' : c.by.name} · {mapName(c.map)}{c.game ? ' · game' : ''}</span>
            </div>
            <button type="button" className="mt-iconbtn" aria-label={`Walk to ${c.title}`} title="Walk there"
              onClick={() => town.building.goTo(c.id)}>
              <MapPin aria-hidden="true" />
            </button>
            {(mine || bs.keeper) && confirm !== c.id && (
              <button type="button" className="mt-iconbtn" aria-label={`Change ${c.title}`} title="Ask for a change"
                onClick={() => onChange(c)}>
                <PencilSparkle aria-hidden="true" />
              </button>
            )}
            {(mine || bs.keeper) && (confirm === c.id ? (
              <span className="mt-made-confirm">
                <button type="button" className="mt-btn is-danger" onClick={() => { town.building.remove(c.id); setConfirm(null) }}>Remove</button>
                <button type="button" className="mt-btn" onClick={() => setConfirm(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="mt-iconbtn" aria-label={`Remove ${c.title}`} title="Remove"
                onClick={() => setConfirm(c.id)}>
                <Trash aria-hidden="true" />
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function CreatePanel({ town, state, onClose }) {
  const bs = state.building
  const [tab, setTab] = useState('build')
  const [text, setText] = useState('')
  const [changing, setChanging] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const idea = useMemo(() => IDEAS[Math.floor(Math.random() * IDEAS.length)], [])
  const ui = state.ui
  const active = bs.sites.some((s) => s.status === 'planning' || s.status === 'building')
  useTick(active)

  useEffect(() => {
    town.building.showMarker(tab === 'build')
    return () => town.building.showMarker(false)
  }, [town, tab, ui?.x, ui?.y, ui?.mapId])
  useEffect(() => { if (tab === 'build') inputRef.current?.focus({ preventScroll: true }) }, [tab, changing])

  const where = ui?.mapId === 'town' || !ui?.room
    ? 'Right in front of you, in Möbius Town'
    : `Here in ${ui.room.name}`
  const paused = bs.policy === 'keeper' && !bs.keeper
  // Everyone's Agent Office is the same private map, so nothing shared is built in it.
  const office = isPrivateMap(ui?.mapId)
  const closed = paused || office

  const submit = async (e) => {
    e?.preventDefault()
    if (busy || text.trim().length < 3) return
    setBusy(true)
    const site = await town.building.start(text, { replace: changing?.id || null })
    setBusy(false)
    if (site) {
      setText('')
      setChanging(null)
    }
  }

  return (
    <section className="mt-panel mt-create" aria-label="Create">
      <header>
        <h2><Sparkles aria-hidden="true" style={{ width: 16, height: 16, verticalAlign: '-2px', marginRight: 6 }} />Create</h2>
        <button type="button" className="mt-iconbtn" style={{ width: 36, height: 36 }} aria-label="Close Create" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="mt-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'build'} className={`mt-tab${tab === 'build' ? ' is-on' : ''}`}
          onClick={() => setTab('build')}>Build</button>
        <button type="button" role="tab" aria-selected={tab === 'town'} className={`mt-tab${tab === 'town' ? ' is-on' : ''}`}
          onClick={() => setTab('town')}>In town ({bs.index.length})</button>
      </div>
      {tab === 'town' ? <TownList town={town} state={state} onChange={(c) => { setChanging(c); setText(''); setTab('build') }} /> : (
        <>
          <div className="mt-scroll">
            {bs.sites.map((s) => (
              <SiteCard key={s.id} town={town} site={s} index={bs.index}
                onChange={(c) => { setChanging(c); setText('') }} />
            ))}
            {bs.sites.length === 0 && office && (
              <p className="mt-create-lede">
                Your Agent Office is yours alone, so nothing is built in here: it would turn up in everyone&apos;s
                office. Step outside and build anywhere in town.
              </p>
            )}
            {bs.sites.length === 0 && !office && (
              <p className="mt-create-lede">
                Describe something you would like to exist here, or a change to this place. A builder works on it
                with your Möbius while everyone watches the construction site, and it appears for every Möbian.
              </p>
            )}
          </div>
          <form className="mt-create-form" onSubmit={submit}>
            <p className="mt-create-where">
              <MapPin aria-hidden="true" />
              {changing ? <>Changing <b>{changing.title}</b> <button type="button" className="mt-linkbtn" onClick={() => setChanging(null)}>new instead</button></> : where}
            </p>
            <textarea
              ref={inputRef}
              className="mt-input mt-create-input"
              rows={3}
              maxLength={600}
              value={text}
              disabled={closed}
              placeholder={office ? 'Step outside to build.' : paused ? 'The town keeper has paused building for now.' : changing ? 'What should change?' : `e.g. ${idea}`}
              aria-label={changing ? 'What should change' : 'What would you like here'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) submit(e)
                if (e.key === 'Escape') onClose()
              }}
            />
            <div className="mt-create-row">
              <span className="mt-create-hint">Tip: tap your keyboard&apos;s microphone to say it instead.</span>
              <button type="submit" className="mt-btn is-primary" disabled={closed || busy || text.trim().length < 3}>
                <Sparkles aria-hidden="true" /> {busy ? 'Starting…' : changing ? 'Change it' : 'Build it'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
