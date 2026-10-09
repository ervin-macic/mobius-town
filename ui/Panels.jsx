import { useEffect, useRef, useState } from 'react'
import { ArrowUp, MapPin, MicOff, TrophyTop, X } from '@openai/apps-sdk-ui/components/Icon'
import AvatarCanvas from './AvatarCanvas.jsx'

const time = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ChatPanel({ town, state, initialTab = 'nearby', onClose }) {
  const [tab, setTab] = useState(initialTab)
  const [text, setText] = useState('')
  const inputRef = useRef(null)
  const listRef = useRef(null)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    town.markRead()
  }, [town, tab])
  const messages = state.chat.filter((m) => m.scope === tab)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    town.markRead()
  }, [messages.length, town])

  const send = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    town.sendChat(text, tab)
    setText('')
  }

  return (
    <section className="mt-panel" aria-label="Chat">
      <header>
        <h2>Chat</h2>
        <button type="button" className="mt-iconbtn" style={{ width: 36, height: 36 }} aria-label="Close chat" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="mt-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'nearby'} className={`mt-tab${tab === 'nearby' ? ' is-on' : ''}`}
          onClick={() => setTab('nearby')}>Nearby</button>
        <button type="button" role="tab" aria-selected={tab === 'town'} className={`mt-tab${tab === 'town' ? ' is-on' : ''}`}
          onClick={() => setTab('town')}>Whole town</button>
      </div>
      <div className="mt-scroll" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <p className="mt-empty">
            {tab === 'nearby'
              ? 'Messages here reach whoever can hear you right now — the same people your voice would reach.'
              : 'The town board: everyone in Mobius Town sees these, wherever they are.'}
          </p>
        )}
        {messages.map((m) => (
          <p key={m.id} className={`mt-msg${m.me ? ' is-me' : ''}`}>
            <b>{m.me ? 'You' : m.name}</b>
            {m.text}
            <span className="mt-time">{time(m.at)}</span>
            {m.me && m.scope === 'nearby' && m.heardBy === 0 && <span className="mt-time"> · nobody nearby</span>}
          </p>
        ))}
      </div>
      <form className="mt-compose" onSubmit={send}>
        <input
          ref={inputRef}
          className="mt-input"
          value={text}
          maxLength={280}
          placeholder={tab === 'nearby' ? 'Say something to people near you' : 'Post to the whole town'}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        />
        <button type="submit" className="mt-iconbtn is-gold" aria-label="Send" disabled={!text.trim()}>
          <ArrowUp aria-hidden="true" />
        </button>
      </form>
    </section>
  )
}

const REASONS = { leak: 'faint, through a bubble', bubble: 'in your bubble', room: 'same meeting room', stage: 'on stage' }

export function PeoplePanel({ town, state, onClose }) {
  const near = state.people.filter((p) => p.near)
  const rest = state.people.filter((p) => !p.near)
  const partying = new Set(state.world.partying || [])
  const meBusy = partying.has(state.pid)
  const invited = new Set(Object.values(state.world.invites || {})
    .filter((i) => i.from === state.pid && i.status === 'pending').map((i) => i.to))
  const challenge = (p) => {
    if (partying.has(p.pid)) return <span className="mt-person-tag">In a party</span>
    if (invited.has(p.pid)) return <span className="mt-person-tag">Challenged</span>
    return (
      <button type="button" className="mt-btn mt-challenge" disabled={meBusy}
        title={`Challenge ${p.name} to a party: Quick Draw, Rock–Paper–Scissors and Speed Sprint`}
        aria-label={`Challenge ${p.name} to a party of three quick games`} onClick={() => town.challenge(p.pid)}>
        <TrophyTop aria-hidden="true" /> Challenge
      </button>
    )
  }
  const row = (p) => (
    <div className="mt-person" key={p.pid}>
      <AvatarCanvas look={p.look} scale={2} />
      <div className="mt-person-main">
        <div className="mt-person-name">{p.name} {p.muted && <MicOff aria-label="microphone off" style={{ width: 14, height: 14, verticalAlign: -2, opacity: 0.7 }} />}</div>
        <div className="mt-person-where">@{p.handle} · {p.where}{p.direct ? ' · direct link' : ''}</div>
      </div>
      {challenge(p)}
      {Number.isInteger(p.x) ? (
        <button type="button" className="mt-iconbtn" style={{ width: 40, height: 40 }} aria-label={`Walk to ${p.name}`}
          title={`Walk to ${p.name}`} onClick={() => town.walkToPerson(p.pid)}>
          <MapPin aria-hidden="true" />
        </button>
      ) : <span />}
      {p.near && (
        <div className="mt-hearing mt-person-hearing" aria-label={`You hear ${p.name} at ${Math.round(p.gain * 100)}%${REASONS[p.reason] ? `, ${REASONS[p.reason]}` : ''}${p.media === 'connected' ? ', voice connected' : ''}`}>
          <span className="mt-hearing-bar"><span style={{ width: `${Math.round(p.gain * 100)}%` }} /></span>
          <span className="mt-hearing-text">{Math.round(p.gain * 100)}%{REASONS[p.reason] ? ` · ${REASONS[p.reason]}` : ''}</span>
        </div>
      )}
    </div>
  )
  return (
    <section className="mt-panel" aria-label="People in town">
      <header>
        <h2>People</h2>
        <button type="button" className="mt-iconbtn" style={{ width: 36, height: 36 }} aria-label="Close people list" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="mt-scroll">
        {state.people.length === 0 && (
          <p className="mt-empty">
            {state.status === 'online'
              ? "It's just you for now. Anyone with Mobius Town on their Möbius lands in this same town."
              : state.problem || 'Connecting to the town…'}
          </p>
        )}
        {near.length > 0 && <h3 className="mt-section">Can hear you</h3>}
        {near.map(row)}
        {rest.length > 0 && <h3 className="mt-section">Around town</h3>}
        {rest.map(row)}
      </div>
    </section>
  )
}
