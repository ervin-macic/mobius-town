// Party challenge overlay: two players, three quick mini-games, one scoreboard.
//
// Renders party.py's public_view for one player. The server decides everything;
// this file shows the state, counts down with serverNow(), and sends the
// player's actions through onAction(). Quick Draw reactions are measured here,
// from the animation frame that painted DRAW to the press, so network latency
// never decides a duel. Styles: ui/partyCss.js (PARTY_CSS).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Bolt, Check, Clock, ExitLogout, HandRaised, Scissor, Sparkles, Stopwatch, TrophyTop, X,
} from '@openai/apps-sdk-ui/components/Icon'

const GAME_INFO = {
  quickdraw: {
    title: 'Quick Draw', short: 'Quick Draw', Icon: Bolt,
    how: 'Wait for DRAW!, then press Space or tap. Too soon loses.',
  },
  rps: {
    title: 'Rock–Paper–Scissors', short: 'Rock Paper Scissors', Icon: Scissor,
    how: 'First to two round wins. Ten seconds to pick.',
  },
  sprint: {
    title: 'Speed Sprint', short: 'Speed Sprint', Icon: Stopwatch,
    how: 'Five quick sums. A wrong answer locks you out for 2 s.',
  },
}
const FALLBACK_INFO = { title: 'Mini-game', short: 'Mini-game', Icon: Sparkles, how: '' }
const CHOICES = ['rock', 'paper', 'scissors']
const CHOICE_LABEL = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' }
const BEATS_VERB = { rock: 'crushes', paper: 'covers', scissors: 'cut' }
const OP_SIGN = { '+': '+', '-': '-', '*': '×', '/': '÷' }   // Glyphs the town's pixel fonts contain.
const OP_WORD = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by' }
const CONFETTI_COLORS = ['#ffd36a', '#5ee0c1', '#ff6b74', '#4d8dff', '#5cf08c', '#fbf6ea']

const infoFor = (kind) => GAME_INFO[kind] || FALLBACK_INFO

export default function PartyOverlay({ party, me, serverNow, onAction, onClose }) {
  const now = useServerClock(serverNow)
  const reducedMotion = useReducedMotion()
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const cardRef = useRef(null)
  const titleId = useId()
  const act = useCallback(async (action) => {
    try {
      return onAction ? await onAction(action) : null
    } catch {
      return null
    }
  }, [onAction])
  const phase = party?.phase
  const stepKey = party ? `${party.id}:${phase}:${party.index}` : ''
  useEffect(() => {
    // A phase change or a closed confirmation can remove the focused control:
    // keep keyboard focus in the dialog (Space on the card still fires in Quick Draw).
    focusIfLost(cardRef.current)
  }, [stepKey, confirming])
  useEffect(() => {
    if (phase === 'final') setConfirming(false)
  }, [phase])

  if (!party) return null
  const players = Array.isArray(party.players) ? party.players : []
  const playing = players.includes(me)
  const opp = players.find((p) => p !== me) ?? null
  const names = party.names || {}
  const nameOf = (pid) => (pid === me ? 'You' : names[pid] || 'Your opponent')
  const oppName = nameOf(opp)
  const ctx = { party, me, opp, oppName, nameOf, now, act }

  const close = () => {
    if (playing && phase === 'final' && !party.closed?.includes(me)) act({ type: 'close' })
    onClose?.()
  }
  const leave = async () => {
    setLeaving(true)
    const result = await act({ type: 'forfeit' })
    setLeaving(false)
    setConfirming(false)
    if (result !== null) onClose?.()
  }

  let heading = 'Party challenge'
  let body = <p className="mt-party-note">Getting the next game ready…</p>
  const game = party.game
  if (phase === 'intro') {
    body = <Intro {...ctx} />
  } else if (phase === 'play' && game) {
    heading = infoFor(game.kind).title
    // Keys reset local state (a press, a pick, a typed answer) for every duel, round and party.
    if (game.kind === 'quickdraw') body = <QuickDraw key={`qd:${party.id}:${party.index}:${game.duel}`} {...ctx} game={game} />
    else if (game.kind === 'rps') body = <Rps key={`rps:${party.id}:${party.index}:${game.round}`} {...ctx} game={game} />
    else if (game.kind === 'sprint') body = <Sprint key={`sprint:${party.id}:${party.index}`} {...ctx} game={game} />
  } else if (phase === 'result') {
    heading = `Game ${party.index + 1} of ${party.games?.length || 3}`
    body = <Result {...ctx} />
  } else if (phase === 'final') {
    heading = 'Party over'
    body = <Final {...ctx} reducedMotion={reducedMotion} onDone={close} />
  }
  const urgent = phase === 'play' && game?.kind === 'quickdraw' && game.stage === 'draw' && !game.mine ? 'Draw!' : ''
  const lastGameDone = phase === 'result' && party.index === (party.games?.length || 3) - 1

  return (
    <div className="mt-cover mt-party" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={cardRef} className="mt-card mt-party-card" tabIndex={-1}>
        <header className="mt-party-head">
          <h2 id={titleId} className="mt-pixel">
            {(phase === 'intro' || phase === 'final') && <Sparkles aria-hidden="true" />}
            <span>{heading}</span>
          </h2>
          <Score party={party} me={me} opp={opp} nameOf={nameOf} />
          {phase === 'final' || !playing ? (
            <button type="button" className="mt-iconbtn mt-party-x" aria-label="Close" onClick={close}>
              <X aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="mt-btn mt-party-leave" aria-haspopup="dialog" aria-expanded={confirming}
              onClick={() => setConfirming(true)}>
              <ExitLogout aria-hidden="true" /> Leave
            </button>
          )}
        </header>
        <LineUp party={party} me={me} nameOf={nameOf} />
        <div className="mt-party-stage">{body}</div>
        <p className="mt-party-sr" role="status" aria-live="polite" aria-atomic="true">{announce(party, me, opp, nameOf, now)}</p>
        <p className="mt-party-sr" aria-live="assertive" aria-atomic="true">{urgent}</p>
        {confirming && phase !== 'final' && (
          <LeaveConfirm
            note={lastGameDone ? 'The scores are already in, so they stand.' : `${oppName} wins the party if you go now.`}
            busy={leaving}
            onStay={() => setConfirming(false)}
            onLeave={leave}
          />
        )}
      </div>
    </div>
  )
}

// --- Shared pieces -------------------------------------------------------------------------------

function Score({ party, me, opp, nameOf, big = false }) {
  const mine = party.scores?.[me] ?? 0
  const theirs = party.scores?.[opp] ?? 0
  return (
    <p className={`mt-party-score${big ? ' is-big' : ''}`}>
      <span className="mt-party-sr">{`Score: ${nameOf(me)} ${mine}, ${nameOf(opp)} ${theirs}`}</span>
      <span className="mt-party-score-name" aria-hidden="true">{nameOf(me)}</span>
      <b aria-hidden="true">{mine}</b>
      <span className="mt-party-score-dash" aria-hidden="true" />
      <b aria-hidden="true">{theirs}</b>
      <span className="mt-party-score-name" aria-hidden="true">{nameOf(opp)}</span>
    </p>
  )
}

function LineUp({ party, me, nameOf }) {
  return (
    <ol className="mt-party-lineup" aria-label="The three games">
      {(party.games || []).map((kind, i) => {
        const info = infoFor(kind)
        const result = party.results?.[i]
        const live = party.phase === 'play' && party.index === i
        const state = result ? (result.winner === me ? 'won' : 'lost') : live ? 'now' : 'next'
        const note = result ? `${nameOf(result.winner)} won` : live ? 'Playing now' : `Game ${i + 1}`
        return (
          <li key={kind} className={`mt-party-step is-${state}`} aria-current={live ? 'step' : undefined}>
            <info.Icon aria-hidden="true" />
            <span className="mt-party-step-name">{info.short}</span>
            <span className="mt-party-step-note">{note}</span>
          </li>
        )
      })}
    </ol>
  )
}

function LeaveConfirm({ note, busy, onStay, onLeave }) {
  const id = useId()
  return (
    <div className="mt-party-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <p id={`${id}-t`} className="mt-party-confirm-title">Leave the party?</p>
      <p id={`${id}-d`} className="mt-party-note">{note}</p>
      <div className="mt-actions">
        <button type="button" className="mt-btn" autoFocus onClick={onStay}>Keep playing</button>
        <button type="button" className="mt-btn is-danger" disabled={busy} onClick={onLeave}>
          {busy ? 'Leaving…' : 'Leave party'}
        </button>
      </div>
    </div>
  )
}

function Countdown({ until, now, label }) {
  return (
    <p className="mt-party-countdown">
      <Clock aria-hidden="true" /> {label} <b>{secondsLeft(until, now)}</b>
    </p>
  )
}

// --- Intro ------------------------------------------------------------------------------------------

function Intro({ party, me, opp, oppName, now, act }) {
  const [busy, setBusy] = useState(false)
  const ready = party.ready || []
  const meReady = ready.includes(me)
  const oppReady = ready.includes(opp)
  const onReady = async () => {
    setBusy(true)
    await act({ type: 'ready' })
    setBusy(false)
  }
  return (
    <>
      <div className="mt-party-vs">
        <Fighter name={party.names?.[me] || 'You'} note={meReady ? 'Ready' : 'You'} ready={meReady} />
        <span className="mt-title mt-party-vs-mark" aria-hidden="true">VS</span>
        <Fighter name={oppName} note={oppReady ? 'Ready' : 'Challenger'} ready={oppReady} opp />
      </div>
      <ol className="mt-party-games" aria-label="Tonight's line-up">
        {(party.games || []).map((kind, i) => {
          const info = infoFor(kind)
          return (
            <li key={kind}>
              <span className="mt-party-game-icon"><info.Icon aria-hidden="true" /></span>
              <b>{i + 1}. {info.title}</b>
              <span className="mt-party-how">{info.how}</span>
            </li>
          )
        })}
      </ol>
      <div className="mt-party-bar">
        <Countdown until={party.deadline} now={now} label="Starts in" />
        <button type="button" className="mt-btn is-primary" autoFocus disabled={meReady || busy} onClick={onReady}>
          {meReady ? <Check aria-hidden="true" /> : <HandRaised aria-hidden="true" />}
          {meReady ? `Waiting for ${oppName}…` : "I'm ready"}
        </button>
      </div>
    </>
  )
}

function Fighter({ name, note, ready, opp = false }) {
  return (
    <div className={`mt-party-fighter${opp ? ' is-opp' : ''}`}>
      <span className="mt-party-fighter-name">{name}</span>
      <span className={`mt-party-fighter-note${ready ? ' is-ready' : ''}`}>
        {ready && <Check aria-hidden="true" />}{note}
      </span>
    </div>
  )
}

// --- Quick Draw -------------------------------------------------------------------------------------

function QuickDraw({ game, opp, oppName, act }) {
  const drawn = game.stage === 'draw' && game.go_at != null
  const [local, setLocal] = useState(null)
  const mine = game.mine || local || null
  const showDraw = drawn && !mine
  const duelRef = useRef(null)
  const shownAt = useRef(null)
  const sent = useRef(Boolean(game.mine))
  const actRef = useLatest(act)
  const live = useLatest({ drawn, minMs: game.min_ms ?? 90, timeoutMs: game.timeout_ms ?? 5000 })

  // One press per duel. Before DRAW was painted it is a false start; after, the
  // reaction runs from the painted frame to the input event.
  const press = useCallback((eventTime) => {
    if (sent.current) return
    sent.current = true
    const t = sameClock(eventTime) ? eventTime : performance.now()
    const { drawn: isDrawn, minMs, timeoutMs } = live.current
    let report
    let shown
    if (isDrawn && shownAt.current != null && t >= shownAt.current) {
      const ms = Math.max(0, Math.round(t - shownAt.current))
      report = { type: 'draw', ms }
      shown = { outcome: ms < minMs ? 'false_start' : ms > timeoutMs ? 'timeout' : 'valid', ms }
    } else {
      report = { type: 'draw', falseStart: true }
      shown = { outcome: 'false_start', ms: null }
    }
    setLocal(shown)
    actRef.current(report)
  }, [actRef, live])

  // DRAW is in the DOM now; the next animation frame is the one that paints it.
  useLayoutEffect(() => {
    if (!showDraw) return undefined
    let timer = 0
    const frame = requestAnimationFrame(() => {
      if (shownAt.current == null) shownAt.current = performance.now()
      // No press at all: report it so the duel need not wait for the server's cutoff.
      timer = setTimeout(() => press(), Math.max(0, shownAt.current + live.current.timeoutMs + 150 - performance.now()))
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [showDraw, press, live])

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Spacebar') return
      const el = e.target
      if (el instanceof Element && el !== duelRef.current && el.closest('button, a[href], input, select, textarea, [role="button"]')) return
      e.preventDefault()
      press(e.timeStamp)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  const oppStatus = game.status?.[opp] || 'waiting'
  let visual = 'wait'
  let word = 'Wait for it…'
  let sub = 'Press when it says DRAW — not before.'
  if (mine?.outcome === 'valid') {
    visual = 'valid'
    word = `${mine.ms} ms`
    sub = oppStatus === 'waiting' ? `Shot fired. Waiting for ${oppName}…` : 'Shot fired!'
  } else if (mine?.outcome === 'timeout') {
    visual = 'timeout'
    word = 'Too slow!'
    sub = 'No shot within five seconds.'
  } else if (mine) {
    visual = 'false_start'
    word = 'Too soon!'
    sub = mine.ms != null ? `${mine.ms} ms is quicker than anyone can react.` : 'You jumped the gun.'
  } else if (showDraw) {
    visual = 'draw'
    word = 'DRAW!'
    sub = 'Press now!'
  }
  const chip = {
    waiting: drawn ? `${oppName} hasn't fired yet` : `${oppName} is waiting too`,
    pressed: `${oppName} fired!`,
    false_start: `${oppName} jumped the gun!`,
    too_slow: `${oppName} was too slow`,
  }[oppStatus] || `${oppName} is waiting`
  const tone = oppStatus === 'false_start' || oppStatus === 'too_slow' ? ' is-good' : oppStatus === 'pressed' ? ' is-bad' : ''
  const previous = game.duel > 1 ? game.history?.[game.history.length - 1] : null
  const banner = previous
    ? Object.values(previous.presses || {}).every((p) => p.outcome === 'false_start')
      ? 'Both jumped the gun — replay!'
      : 'Nobody drew in time — replay!'
    : null

  return (
    <>
      {banner && <p className="mt-party-banner">{banner}</p>}
      <button
        ref={duelRef}
        type="button"
        autoFocus
        className={`mt-party-duel is-${visual}`}
        aria-label={`${word} ${sub}`}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          press(e.timeStamp)
        }}
        onClick={() => press()}
      >
        <span className="mt-party-duel-word" aria-hidden="true">{word}</span>
        <span className="mt-party-duel-sub" aria-hidden="true">{sub}</span>
      </button>
      <p className="mt-party-row"><span className={`mt-party-chip${tone}`}>{chip}</span></p>
      <p className="mt-party-note">Space, Enter or a tap on the panel. Quicker than {game.min_ms ?? 90} ms counts as a false start.</p>
    </>
  )
}

// --- Rock-Paper-Scissors ----------------------------------------------------------------------------

function Rps({ game, me, opp, oppName, nameOf, now, act }) {
  const [pick, setPick] = useState(null)
  const sent = useRef(false)
  const groupRef = useRef(null)
  const actRef = useLatest(act)
  const mine = game.mine || pick
  const choosing = game.stage === 'choose'
  const canPick = choosing && !mine
  const canPickRef = useLatest(canPick)
  const oppChosen = (game.chosen || []).includes(opp)
  const last = game.rounds?.[game.rounds.length - 1]
  const revealing = game.stage === 'reveal' && last

  const choose = useCallback(async (choice) => {
    if (sent.current || !canPickRef.current) return
    sent.current = true
    setPick(choice)
    const result = await actRef.current({ type: 'rps', choice })
    if (result === null) {
      sent.current = false
      setPick(null)
    }
  }, [actRef, canPickRef])

  useEffect(() => {
    focusIfLost(groupRef.current)
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      const i = ['1', '2', '3'].indexOf(e.key)
      if (i < 0 || !canPickRef.current) return
      e.preventDefault()
      choose(CHOICES[i])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose, canPickRef])

  return (
    <>
      <div className="mt-party-rps-top">
        <p className="mt-party-round">Round {game.round}</p>
        <p className="mt-party-wins">
          <span><span className="mt-party-wins-name">You</span> <Pips n={game.wins?.[me] ?? 0} of={game.to_win ?? 2} /></span>
          <span><span className="mt-party-wins-name">{oppName}</span> <Pips n={game.wins?.[opp] ?? 0} of={game.to_win ?? 2} /></span>
        </p>
        {choosing && <Countdown until={game.deadline} now={now} label="Pick in" />}
      </div>
      {revealing ? (
        <RpsReveal round={last} decided={game.decided} me={me} opp={opp} oppName={oppName} nameOf={nameOf} />
      ) : (
        <>
          <div ref={groupRef} tabIndex={-1} className="mt-party-choices" role="group" aria-label="Pick rock, paper or scissors">
            {CHOICES.map((choice, i) => (
              <button key={choice} type="button" className={`mt-party-choice${mine === choice ? ' is-picked' : ''}`}
                aria-pressed={mine === choice} aria-keyshortcuts={String(i + 1)} disabled={!canPick}
                onClick={() => choose(choice)}>
                <PixelArt sprite={choice} />
                <span className="mt-party-choice-name">{CHOICE_LABEL[choice]}</span>
                <span className="mt-key" aria-hidden="true">{i + 1}</span>
              </button>
            ))}
          </div>
          <p className="mt-party-row">
            <span className={`mt-party-chip${oppChosen ? ' is-bad' : ''}`}>
              {oppChosen && <Check aria-hidden="true" />}
              {oppChosen ? `${oppName} has picked` : `${oppName} is picking…`}
            </span>
          </p>
          <p className="mt-party-note">
            {mine ? `You picked ${CHOICE_LABEL[mine].toLowerCase()}.` : 'Pick one, or press 1, 2 or 3.'}{' '}
            If time runs out, a pick is made for you.
          </p>
        </>
      )}
    </>
  )
}

function Pips({ n, of }) {
  return (
    <span className="mt-party-pips" role="img" aria-label={`${n} of ${of} wins`}>
      {Array.from({ length: of }, (_, i) => <span key={i} className={`mt-party-pip${i < n ? ' is-on' : ''}`} />)}
    </span>
  )
}

function RpsReveal({ round, decided, me, opp, oppName, nameOf }) {
  const a = round.choices?.[me]
  const b = round.choices?.[opp]
  const randomFor = round.random || []
  return (
    <>
      <div className="mt-party-reveal">
        <Hand choice={a} who="You" random={randomFor.includes(me)} winner={round.winner === me} />
        <span className="mt-pixel mt-party-vs-small" aria-hidden="true">VS</span>
        <Hand choice={b} who={oppName} random={randomFor.includes(opp)} winner={round.winner === opp} opp />
      </div>
      <p className="mt-party-outcome">{roundText(round, me, oppName, Boolean(decided))}</p>
      {decided && <p className="mt-party-note">{decidedText(decided, me, nameOf)}</p>}
    </>
  )
}

function Hand({ choice, who, random, winner, opp = false }) {
  return (
    <figure className={`mt-party-hand${opp ? ' is-opp' : ''}${winner ? ' is-winner' : ''}`}>
      <PixelArt sprite={choice} />
      <figcaption>
        <span>{who}</span>
        <small>{CHOICE_LABEL[choice] || '…'}{random ? ' (picked at random)' : ''}</small>
      </figcaption>
    </figure>
  )
}

function roundText(round, me, oppName, decided) {
  const mine = round.choices?.[me]
  const theirs = Object.entries(round.choices || {}).find(([pid]) => pid !== me)?.[1]
  if (!round.winner) return `Both ${CHOICE_LABEL[mine]?.toLowerCase() || 'the same'}${decided ? '.' : ' — go again!'}`
  const won = round.winner === me
  const w = won ? mine : theirs
  const l = won ? theirs : mine
  return `${CHOICE_LABEL[w]} ${BEATS_VERB[w]} ${l} — ${won ? 'you take the round!' : `${oppName} takes the round.`}`
}

function decidedText(decided, me, nameOf) {
  const mine = decided.winner === me
  const wins = mine ? 'You win the game!' : `${nameOf(decided.winner)} wins the game!`
  if (decided.reason === 'round_cap') return `Seven rounds up — ${mine ? 'you were' : `${nameOf(decided.winner)} was`} ahead. ${wins}`
  if (decided.reason === 'coin') return `Seven rounds, all square — a coin flip decides. ${wins}`
  return wins
}

// Pixel art for the three picks (12 x 12, merged into horizontal runs).
const SPRITES = {
  rock: {
    palette: { k: '#241b33', d: '#5d5775', g: '#8f8aa6', l: '#cdc8de' },
    rows: [
      '............', '............', '....kkkk....', '..kklllgkk..', '.kllllggggk.', '.klllgggggk.',
      'klllggggggdk', 'klgggggggddk', 'kgggggggdddk', '.kggggdddddk', '..kkkkkkkkk.', '............',
    ],
  },
  paper: {
    palette: { k: '#241b33', w: '#f6f1e3', b: '#8fb3f0', s: '#120d1d' },
    rows: [
      '............', '.kkkkkkkkk..', '.kwwwwwwwks.', '.kwbbbbbwks.', '.kwwwwwwwks.', '.kwbbbbwwks.',
      '.kwwwwwwwks.', '.kwbbbbbwks.', '.kwwwwwwwks.', '.kwbbbwwwks.', '.kkkkkkkkks.', '..sssssssss.',
    ],
  },
  scissors: {
    palette: { l: '#dcd8ea', w: '#ffffff', d: '#5d5775', r: '#ff6b74' },
    rows: [
      '............', 'wl........lw', '.wl......lw.', '..wl....lw..', '...wl..lw...', '....lddl....',
      '...ll..ll...', '.rrrr..rrrr.', '.r..r..r..r.', '.r..r..r..r.', '.rrrr..rrrr.', '............',
    ],
  },
}
const ART = Object.fromEntries(Object.entries(SPRITES).map(([name, sprite]) => [name, toRuns(sprite)]))

function toRuns({ rows, palette }) {
  const runs = []
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      let w = 1
      while (x + w < row.length && row[x + w] === row[x]) w++
      if (palette[row[x]]) runs.push([x, y, w, palette[row[x]]])
      x += w
    }
  })
  return runs
}

function PixelArt({ sprite }) {
  const runs = ART[sprite]
  if (!runs) return <span className="mt-party-hidden" aria-hidden="true" />
  return (
    <svg className="mt-party-art" viewBox="0 0 12 12" width="72" height="72" shapeRendering="crispEdges"
      aria-hidden="true" focusable="false">
      {runs.map(([x, y, w, fill]) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height="1" fill={fill} />)}
    </svg>
  )
}

// --- Speed Sprint -----------------------------------------------------------------------------------

function Sprint({ game, me, opp, oppName, now, act }) {
  const total = game.total || 5
  const mine = game.progress?.[me] || { solved: 0, wrong: 0, locked_until: 0 }
  const theirs = game.progress?.[opp] || { solved: 0, wrong: 0, locked_until: 0 }
  const counting = game.stage === 'countdown'
  const problem = game.problem
  const lockLeft = Math.max(0, (mine.locked_until || 0) - now)
  const locked = lockLeft > 0
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [hint, setHint] = useState('')
  const inputRef = useRef(null)
  const inputId = useId()
  const seen = useRef({ solved: mine.solved, wrong: mine.wrong })

  // The server's verdict arrives as a new view: more solved, or one more wrong.
  useEffect(() => {
    const prev = seen.current
    if (mine.solved > prev.solved) {
      setValue('')
      setFlash({ kind: 'right', key: `s${mine.solved}` })
    } else if (mine.wrong > prev.wrong) {
      setValue('')
      setFlash({ kind: 'wrong', key: `w${mine.wrong}` })
    }
    seen.current = { solved: mine.solved, wrong: mine.wrong }
  }, [mine.solved, mine.wrong])
  useEffect(() => {
    if (!flash) return undefined
    const timer = setTimeout(() => setFlash(null), 650)
    return () => clearTimeout(timer)
  }, [flash])
  useEffect(() => {
    if (problem) inputRef.current?.focus({ preventScroll: true })
  }, [problem?.index, Boolean(problem)])

  const submit = async (e) => {
    e.preventDefault()
    if (!problem || busy) return
    if (locked) return
    const text = value.trim().replace(/[−–]/g, '-')
    if (!/^-?\d{1,6}$/.test(text)) {
      setHint('Type a whole number, then press Enter.')
      return
    }
    setHint('')
    setBusy(true)
    await act({ type: 'answer', index: problem.index, value: Number.parseInt(text, 10) })
    setBusy(false)
  }

  const span = Math.max(1, (game.deadline ?? 0) - (game.starts_at ?? 0))
  const remaining = counting ? span : Math.max(0, (game.deadline ?? 0) - now)
  const count = Math.max(0, Math.ceil(((game.starts_at ?? 0) - now) / 1000))
  return (
    <>
      <div className="mt-party-sprint-top">
        <p className="mt-party-countdown"><Clock aria-hidden="true" /> <b>{Math.ceil(remaining / 1000)}</b> s left</p>
        <p className="mt-party-note">Problem {Math.min(mine.solved + 1, total)} of {total}</p>
      </div>
      <div className="mt-party-timebar" aria-hidden="true"><span style={{ width: `${(remaining / span) * 100}%` }} /></div>
      {counting ? (
        <p className="mt-party-big-count" key={count}>{count > 0 ? count : 'GO!'}</p>
      ) : problem ? (
        <>
          <p className={`mt-party-problem${flash ? ` is-${flash.kind}` : ''}`} key={flash?.key || `p${problem.index}`}>
            <span aria-hidden="true">{problem.a} {OP_SIGN[problem.op] || problem.op} {problem.b} =</span>
            <span className="mt-party-sr">{spoken(problem)} equals</span>
          </p>
          <form className="mt-party-answer" onSubmit={submit}>
            <label className="mt-party-sr" htmlFor={inputId}>{`Your answer to ${spoken(problem)}`}</label>
            <input
              id={inputId}
              ref={inputRef}
              className="mt-input"
              autoFocus
              value={value}
              onChange={(e) => { setValue(e.target.value.slice(0, 7)); setHint('') }}
              inputMode="numeric"
              enterKeyHint="go"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="?"
              size={6}
              readOnly={busy || locked}
              aria-invalid={hint ? true : undefined}
              aria-describedby={hint ? `${inputId}-hint` : undefined}
            />
            <button type="submit" className="mt-btn is-primary" disabled={busy || locked || !value.trim()}>Enter</button>
          </form>
          {locked && <p className="mt-party-lock">Wrong — locked for {(lockLeft / 1000).toFixed(1)} s</p>}
          {hint && !locked && <p id={`${inputId}-hint`} className="mt-party-note">{hint}</p>}
        </>
      ) : (
        <p className="mt-party-big-count">{mine.solved >= total ? 'Done!' : 'GO!'}</p>
      )}
      <div className="mt-party-racers">
        <Racer name="You" solved={mine.solved} total={total} locked={locked} />
        <Racer name={oppName} solved={theirs.solved} total={total} locked={(theirs.locked_until || 0) > now} opp />
      </div>
    </>
  )
}

function Racer({ name, solved, total, locked, opp = false }) {
  return (
    <div className={`mt-party-racer${opp ? ' is-opp' : ''}`}>
      <span className="mt-party-racer-name">{name}</span>
      <span className="mt-party-track" role="img" aria-label={`${name}: ${solved} of ${total} solved${locked ? ', locked out' : ''}`}>
        {Array.from({ length: total }, (_, i) => <span key={i} className={i < solved ? 'is-on' : ''} />)}
      </span>
      <span className={`mt-party-racer-note${locked ? ' is-locked' : ''}`}>{locked ? 'Locked' : `${solved}/${total}`}</span>
    </div>
  )
}

function spoken(problem) {
  return `${problem.a} ${OP_WORD[problem.op] || problem.op} ${problem.b}`
}

// --- Results and the final screen ----------------------------------------------------------------------

function Result({ party, me, opp, nameOf, now }) {
  const result = party.results?.[party.results.length - 1]
  if (!result) return null
  const info = infoFor(result.game)
  const won = result.winner === me
  const next = party.games?.[party.index + 1]
  return (
    <div className="mt-party-result">
      <span className={`mt-party-medal${won ? '' : ' is-loss'}`} aria-hidden="true">
        {won ? <TrophyTop /> : <info.Icon />}
      </span>
      <h3 className={`mt-party-headline${won ? '' : ' is-loss'}`}>{gameHeadline(result, me, nameOf)}</h3>
      <p className="mt-party-detail">{resultDetail(result, me, opp, nameOf)}</p>
      <Score party={party} me={me} opp={opp} nameOf={nameOf} big />
      <Countdown until={party.deadline} now={now} label={next ? `Next: ${infoFor(next).title} in` : 'Final scores in'} />
    </div>
  )
}

function Final({ party, me, opp, nameOf, reducedMotion, onDone }) {
  const winner = party.winner
  const iWon = Boolean(winner) && winner === me
  return (
    <div className="mt-party-final">
      {winner && !reducedMotion && <Confetti />}
      <span className={`mt-party-medal is-large${iWon || !winner ? '' : ' is-loss'}`} aria-hidden="true"><TrophyTop /></span>
      <h3 className="mt-title">{finalHeadline(party, me, nameOf)}</h3>
      <p className="mt-party-detail">{finalDetail(party, me, nameOf)}</p>
      <Score party={party} me={me} opp={opp} nameOf={nameOf} big />
      <ul className="mt-party-summary" aria-label="Game by game">
        {(party.games || []).map((kind, i) => {
          const info = infoFor(kind)
          const result = party.results?.[i]
          return (
            <li key={kind}>
              <info.Icon aria-hidden="true" />
              <span className="mt-party-summary-game">{info.title}</span>
              <span className={`mt-party-summary-who${result?.winner === me ? ' is-mine' : ''}`}>
                {result ? `${nameOf(result.winner)} won` : 'Not played'}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-actions">
        <button type="button" className="mt-btn is-primary" autoFocus onClick={onDone}>Close</button>
      </div>
    </div>
  )
}

function Confetti() {
  const bits = useMemo(() => Array.from({ length: 42 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 42 + Math.random() * 0.3
    const power = 90 + Math.random() * 130
    return {
      '--dx': `${Math.round(Math.cos(angle) * power)}px`,
      '--dy': `${Math.round(Math.sin(angle) * power * 0.8 - 70)}px`,
      '--rot': `${Math.round(Math.random() * 720 - 360)}deg`,
      '--delay': `${Math.round(Math.random() * 220)}ms`,
      '--c': CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      '--s': `${6 + (i % 3) * 2}px`,
    }
  }), [])
  return (
    <div className="mt-party-confetti" aria-hidden="true">
      {bits.map((style, i) => <span key={i} style={style} />)}
    </div>
  )
}

function gameHeadline(result, me, nameOf) {
  const title = infoFor(result.game).title
  return result.winner === me ? `You win ${title}!` : `${nameOf(result.winner)} wins ${title}`
}

function finalHeadline(party, me, nameOf) {
  if (!party.winner) return "It's a draw!"
  return party.winner === me ? 'You win the party!' : `${nameOf(party.winner)} wins the party!`
}

function finalDetail(party, me, nameOf) {
  if (party.end === 'forfeit') return party.left === me ? 'You left the party.' : `${nameOf(party.left)} left the party.`
  return 'All three games played.'
}

function resultDetail(result, me, opp, nameOf) {
  const winnerIsMe = result.winner === me
  const W = nameOf(result.winner)
  const L = nameOf(winnerIsMe ? opp : me)
  const them = winnerIsMe ? 'you' : W
  if (result.game === 'quickdraw') {
    const duel = result.duels?.[result.duels.length - 1]
    const presses = duel?.presses || {}
    const time = (pid) => (presses[pid]?.outcome === 'valid' ? `${presses[pid].ms} ms` : null)
    const winnerTime = time(result.winner) ? ` ${W}: ${time(result.winner)}.` : ''
    switch (result.reason) {
      case 'faster': return `${nameOf(me)} ${time(me)} · ${nameOf(opp)} ${time(opp)}`
      case 'earlier': return `Dead heat at ${time(result.winner)} — ${winnerIsMe ? 'your' : `${W}'s`} shot landed first.`
      case 'false_start': return `${L} jumped the gun.${winnerTime}`
      case 'timeout': return `${L} didn't draw in time.${winnerTime}`
      default: return `No clean shot twice — a coin flip picked ${them}.`
    }
  }
  if (result.game === 'rps') {
    const wins = result.wins || {}
    const score = `${wins[me] ?? 0}–${wins[opp] ?? 0}`
    const rounds = result.rounds?.length || 0
    if (result.reason === 'two_wins') return `${score} after ${rounds} round${rounds === 1 ? '' : 's'}.`
    if (result.reason === 'round_cap') return `Seven rounds up — ${winnerIsMe ? 'you were' : `${W} was`} ahead (${score}).`
    return `Seven rounds, all square — a coin flip picked ${them}.`
  }
  if (result.game === 'sprint') {
    const total = result.total || 5
    const solved = result.solved || {}
    const ms = result.times?.[result.winner]
    if (result.reason === 'finished') return `${W} solved all ${total}${ms != null ? ` in ${(ms / 1000).toFixed(1)} s` : ''}.`
    if (result.reason === 'more_correct') return `Time! ${nameOf(me)} ${solved[me] ?? 0}/${total} · ${nameOf(opp)} ${solved[opp] ?? 0}/${total}`
    if (result.reason === 'earlier') return `${solved[me] ?? 0}/${total} each — ${them} got there first.`
    return `All square — a coin flip picked ${them}.`
  }
  return ''
}

// What the polite live region says; it changes only when something happens.
function announce(party, me, opp, nameOf, now) {
  const oppName = nameOf(opp)
  if (party.phase === 'intro') {
    const games = (party.games || []).map((kind) => infoFor(kind).title).join(', then ')
    return `Party challenge with ${oppName}: ${games}.`
  }
  if (party.phase === 'play' && party.game) {
    const g = party.game
    if (g.kind === 'quickdraw') {
      return g.stage === 'draw' ? '' : `Quick Draw${g.duel > 1 ? ' replay' : ''}. Wait for it, then press Space or tap when it says Draw.`
    }
    if (g.kind === 'rps') {
      const last = g.rounds?.[g.rounds.length - 1]
      if (g.stage === 'reveal' && last) {
        const text = roundText(last, me, oppName, Boolean(g.decided))
        return g.decided ? `${text} ${decidedText(g.decided, me, nameOf)}` : text
      }
      return `Rock–Paper–Scissors, round ${g.round}. Press 1 for rock, 2 for paper, 3 for scissors.`
    }
    if (g.kind === 'sprint') {
      if (g.stage === 'countdown') return 'Speed Sprint. Get ready.'
      if ((g.progress?.[me]?.locked_until || 0) > now) return 'Wrong answer. Locked for two seconds.'
      return g.problem ? `Problem ${g.problem.index + 1} of ${g.total}: ${spoken(g.problem)}.` : ''
    }
    return ''
  }
  if (party.phase === 'result') {
    const result = party.results?.[party.results.length - 1]
    if (!result) return ''
    const score = `Score: ${nameOf(me)} ${party.scores?.[me] ?? 0}, ${oppName} ${party.scores?.[opp] ?? 0}.`
    return [gameHeadline(result, me, nameOf), resultDetail(result, me, opp, nameOf), score].map(sentence).join(' ')
  }
  if (party.phase === 'final') return `${finalHeadline(party, me, nameOf)} ${finalDetail(party, me, nameOf)}`
  return ''
}

function sentence(text) {
  return !text || /[.!?]$/.test(text) ? text : `${text}.`
}

// --- Hooks and helpers --------------------------------------------------------------------------------

function useServerClock(serverNow, everyMs = 200) {
  const source = useLatest(serverNow)
  const read = () => {
    try {
      const t = source.current?.()
      if (Number.isFinite(t)) return t
    } catch {
      /* fall back to the local clock */
    }
    return Date.now()
  }
  const [now, setNow] = useState(read)
  useEffect(() => {
    const timer = setInterval(() => setNow(read()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches))
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const update = () => setReduced(mq.matches)
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  return reduced
}

// A ref that always holds the latest value, so long-lived handlers never go stale.
function useLatest(value) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

function secondsLeft(deadline, now) {
  return deadline == null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000))
}

// Event timestamps share performance.now()'s clock in current browsers; older ones used epoch ms.
function sameClock(t) {
  return typeof t === 'number' && t > 0 && Math.abs(performance.now() - t) < 10_000
}

function isTypingTarget(el) {
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el?.isContentEditable)
}

function focusIfLost(el) {
  if (!el || typeof document === 'undefined') return
  const active = document.activeElement
  if (!active || active === document.body || !active.isConnected || !el.closest('.mt-party-card')?.contains(active)) {
    el.focus({ preventScroll: true })
  }
}
