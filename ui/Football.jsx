import { useEffect, useRef, useState } from 'react'
import { ExitLogout, Robot } from '@openai/apps-sdk-ui/components/Icon'

const SLOTS = ['red0', 'red1', 'blue0', 'blue1']
const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]

function useNow(active, everyMs = 250) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const t = setInterval(() => setTick((n) => n + 1), everyMs)
    return () => clearInterval(t)
  }, [active, everyMs])
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`

function Team({ side, slots, names, pid }) {
  return (
    <div className={`mt-fb-team is-${side}`}>
      <b>{side === 'red' ? 'Red' : 'Blue'}</b>
      {SLOTS.filter((s) => s.startsWith(side)).map((s) => {
        const p = slots?.[s]
        return (
          <span key={s} className={p ? '' : 'is-bot'}>
            {p ? (p === pid ? 'You' : names?.[p] || 'Player') : <><Robot aria-hidden="true" /> Bot</>}
          </span>
        )
      })}
    </div>
  )
}

/** Waiting for kick-off: the line-up, a countdown, bot difficulty, switch side or leave. */
export function PitchLobby({ town, state }) {
  const fb = state.football
  const inLobby = fb.status === 'lobby' && fb.mySlot
  useNow(inLobby)
  if (!inLobby) return null
  const left = Math.max(0, Math.ceil((fb.kickoffAt - town.serverNow()) / 1000))
  const side = fb.mySlot.startsWith('red') ? 'red' : 'blue'
  return (
    <section className="mt-fb-lobby" aria-label="Football line-up">
      <header>
        <h2 className="mt-pixel">Football</h2>
        <span className="mt-fb-count" aria-live="polite">{left > 0 ? `Kick-off in ${left}` : 'Kick-off!'}</span>
      </header>
      <div className="mt-fb-teams">
        <Team side="red" slots={fb.slots} names={fb.names} pid={state.pid} />
        <span className="mt-fb-vs mt-pixel" aria-hidden="true">v</span>
        <Team side="blue" slots={fb.slots} names={fb.names} pid={state.pid} />
      </div>
      <div className="mt-fb-row" role="radiogroup" aria-label="Bot difficulty">
        <span>Bots</span>
        {LEVELS.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={fb.level === id}
            className={`mt-btn mt-fb-level${fb.level === id ? ' is-on' : ''}`} onClick={() => town.setPitchLevel(id)}>{label}</button>
        ))}
      </div>
      <p className="mt-note">Arrows or WASD to run, Space to kick. Three minutes; empty places are bots.</p>
      <div className="mt-actions">
        <button type="button" className="mt-btn" onClick={() => town.joinPitch(side === 'red' ? 'blue' : 'red')}>
          Switch to {side === 'red' ? 'blue' : 'red'}
        </button>
        <button type="button" className="mt-btn" onClick={() => town.leavePitch()}><ExitLogout aria-hidden="true" /> Leave</button>
      </div>
    </section>
  )
}

function banner(m) {
  if (!m) return null
  if (m.ended || m.phase === 'ended') {
    const { red, blue } = m.score
    if (red === blue) return `Full time: ${red}–${blue}, a draw`
    const win = red > blue ? 'Red' : 'Blue'
    const mine = m.mySlot ? (m.mySlot.startsWith('red') ? 'Red' : 'Blue') : null
    return `Full time: ${win} win${mine ? (mine === win ? ' (that’s you!)' : '') : ''} ${Math.max(red, blue)}–${Math.min(red, blue)}`
  }
  if (m.phase === 'goal' && m.lastGoal) return `GOAL! ${m.lastGoal.team === 'red' ? 'Red' : 'Blue'}${m.lastGoal.own ? ' (own goal)' : ''}`
  if (m.phase === 'kickoff') return 'Kick-off'
  return null
}

/** The score, the clock and the big moments, for players and anyone watching. */
export function Scoreboard({ town, state }) {
  const m = state.football.match
  if (!m || (!m.player && !m.connected)) return null
  const text = banner(m)
  return (
    <div className="mt-fb-board" role="status" aria-live="polite">
      <div className="mt-fb-score">
        <span className="is-red">Red <b>{m.score.red}</b></span>
        <span className="mt-fb-clock mt-pixel">{clock(m.clock)}</span>
        <span className="is-blue"><b>{m.score.blue}</b> Blue</span>
      </div>
      {text && <div className={`mt-fb-banner${m.phase === 'goal' ? ' is-goal' : ''} mt-pixel`}>{text}</div>}
      {m.player && !m.ended && !m.connected && <div className="mt-fb-note">Connecting to the match…</div>}
      {m.player && !m.ended && (
        <button type="button" className="mt-btn mt-fb-leave" onClick={() => town.leavePitch()}>
          <ExitLogout aria-hidden="true" /> Leave match
        </button>
      )}
    </div>
  )
}

/** Phones: a thumb stick on the left and a kick button on the right. */
export function TouchPad({ town, state }) {
  const m = state.football.match
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
    town.football.setStick(Math.abs(dx) < 0.18 ? 0 : dx, Math.abs(dy) < 0.18 ? 0 : dy)
  }
  const end = () => { setKnob(null); town.football.setStick(0, 0) }
  return (
    <div className="mt-fb-touch">
      <div ref={padRef} className="mt-fb-stick" aria-label="Move" role="application"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e) }}
        onPointerMove={(e) => { if (knob) move(e) }} onPointerUp={end} onPointerCancel={end}>
        <span style={knob ? { transform: `translate(${knob.dx * 34}px, ${knob.dy * 34}px)` } : undefined} />
      </div>
      <button type="button" className="mt-fb-kick mt-pixel"
        onPointerDown={(e) => { e.preventDefault(); town.football.kick(true) }}
        onPointerUp={() => town.football.kick(false)} onPointerCancel={() => town.football.kick(false)}>Kick</button>
    </div>
  )
}
