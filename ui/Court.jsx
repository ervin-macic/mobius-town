import { useEffect, useRef, useState } from 'react'
import { ExitLogout, Robot } from '@openai/apps-sdk-ui/components/Icon'

const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]
const TEAM_CLASS = ['is-red', 'is-blue', 'is-teal', 'is-gold']

function useNow(active, everyMs = 250) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const t = setInterval(() => setTick((n) => n + 1), everyMs)
    return () => clearInterval(t)
  }, [active, everyMs])
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`

function slotsOf(meta, team) {
  return Array.from({ length: meta.perTeam }, (_, i) => `${team.id}${i}`)
}

/** Waiting for the start: both teams, a countdown, bot difficulty, switch side or leave. */
export function CourtLobby({ town, state }) {
  const lobby = state.court?.lobby
  useNow(!!lobby)
  if (!lobby?.meta) return null
  const meta = lobby.meta
  const left = Math.max(0, Math.ceil((lobby.kickoffAt - town.serverNow()) / 1000))
  const mine = Object.keys(lobby.slots).find((s) => lobby.slots[s] === state.pid)
  const myTeam = meta.teams.find((t) => mine?.startsWith(t.id))
  const other = meta.teams.find((t) => t !== myTeam)
  return (
    <section className="mt-fb-lobby" aria-label={`${meta.title} line-up`}>
      <header>
        <h2 className="mt-pixel">{meta.title}</h2>
        <span className="mt-fb-count" aria-live="polite">{left > 0 ? `Starts in ${left}` : 'Go!'}</span>
      </header>
      <div className="mt-fb-teams">
        {meta.teams.map((team, ti) => (
          <div key={team.id} className={`mt-fb-team ${TEAM_CLASS[ti] || ''}`}>
            <b>{team.name}</b>
            {slotsOf(meta, team).map((s) => {
              const p = lobby.slots[s]
              return (
                <span key={s} className={p ? '' : 'is-bot'}>
                  {p ? (p === state.pid ? 'You' : lobby.names?.[p] || 'Player') : <><Robot aria-hidden="true" /> Bot</>}
                </span>
              )
            })}
          </div>
        )).reduce((acc, el, i) => (i ? [...acc, <span key={`vs${i}`} className="mt-fb-vs mt-pixel" aria-hidden="true">v</span>, el] : [el]), [])}
      </div>
      <div className="mt-fb-row" role="radiogroup" aria-label="Bot difficulty">
        <span>Bots</span>
        {LEVELS.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={lobby.level === id}
            className={`mt-btn mt-fb-level${lobby.level === id ? ' is-on' : ''}`}
            onClick={() => town.courts.setLevel(lobby.cid, id)}>{label}</button>
        ))}
      </div>
      {meta.controls && <p className="mt-note">{meta.controls}</p>}
      <div className="mt-actions">
        {other && (
          <button type="button" className="mt-btn" onClick={() => town.courts.join(lobby.cid, other.id)}>
            Switch to {other.name}
          </button>
        )}
        <button type="button" className="mt-btn" onClick={() => town.courts.leave(lobby.cid)}><ExitLogout aria-hidden="true" /> Leave</button>
      </div>
    </section>
  )
}

/** The score, the clock and the game's own messages, for players and anyone watching. */
export function CourtBoard({ town, state }) {
  const m = state.court?.match
  if (!m || !m.ready || !m.score) return null
  const teams = m.meta.teams
  const text = m.banner || m.message
  return (
    <div className="mt-fb-board" role="status" aria-live="polite">
      <div className="mt-fb-score">
        <span className={TEAM_CLASS[0]}>{teams[0].name} <b>{m.score[teams[0].id] ?? 0}</b></span>
        <span className="mt-fb-clock mt-pixel">{m.clock != null ? clock(m.clock) : m.meta.title}</span>
        <span className={TEAM_CLASS[1]}><b>{m.score[teams[1].id] ?? 0}</b> {teams[1].name}</span>
      </div>
      {text && <div className="mt-fb-banner mt-pixel">{text}</div>}
      {m.player && !m.ended && (
        <button type="button" className="mt-btn mt-fb-leave" onClick={() => town.courts.leave(m.cid)}>
          <ExitLogout aria-hidden="true" /> Leave match
        </button>
      )}
    </div>
  )
}

function HoldButton({ className, onHold, children }) {
  return (
    <button type="button" className={`${className} mt-pixel`}
      onPointerDown={(e) => { e.preventDefault(); onHold(true) }}
      onPointerUp={() => onHold(false)} onPointerCancel={() => onHold(false)}>{children}</button>
  )
}

/** Phones: a thumb stick and the game's buttons. */
export function CourtTouch({ town, state }) {
  const m = state.court?.match
  const active = !!m && m.player && !m.ended
  const padRef = useRef(null)
  const [knob, setKnob] = useState(null)
  const [coarse, setCoarse] = useState(() => window.matchMedia?.('(pointer: coarse)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)')
    if (!mq) return undefined
    const on = () => setCoarse(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  if (!active || !coarse) return null
  const move = (e) => {
    const rect = padRef.current.getBoundingClientRect()
    const r = rect.width / 2
    let dx = (e.clientX - rect.left - r) / r
    let dy = (e.clientY - rect.top - r) / r
    const len = Math.hypot(dx, dy)
    if (len > 1) { dx /= len; dy /= len }
    setKnob({ dx, dy })
    town.courts.setStick(Math.abs(dx) < 0.18 ? 0 : dx, Math.abs(dy) < 0.18 ? 0 : dy)
  }
  const end = () => { setKnob(null); town.courts.setStick(0, 0) }
  const buttons = m.meta?.buttons || []
  return (
    <div className="mt-fb-touch">
      <div ref={padRef} className="mt-fb-stick" aria-label="Move" role="application"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e) }}
        onPointerMove={(e) => { if (knob) move(e) }} onPointerUp={end} onPointerCancel={end}>
        <span style={knob ? { transform: `translate(${knob.dx * 34}px, ${knob.dy * 34}px)` } : undefined} />
      </div>
      <div className="mt-fb-buttons">
        {[...buttons].reverse().map((b) => (
          <HoldButton key={b.id} className={b.id === 'a' ? 'mt-fb-kick' : 'mt-fb-pass'} onHold={(down) => town.courts.button(b.id, down)}>
            {b.label}
          </HoldButton>
        ))}
      </div>
    </div>
  )
}
