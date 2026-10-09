import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Play, Robot, X } from '@openai/apps-sdk-ui/components/Icon'
import * as chess from '../games/chess.js'
import * as c4 from '../games/connect4.js'
import { pieceImages } from './pieces.js'
import AvatarCanvas from './AvatarCanvas.jsx'
import CpuAvatar from './CpuAvatar.jsx'

export default function Overlays({ town, state }) {
  const o = state.overlay
  if (!o) return null
  if (o.kind === 'sign') return <SignDialog title={o.title} text={o.text} onClose={() => town.closeOverlay()} />
  if (o.kind === 'tv') return <TvPanel town={town} state={state} />
  if (o.kind === 'chess') return <ChessOverlay town={town} state={state} table={o.table} waiting={o.waiting} />
  if (o.kind === 'connect4') return <Connect4Overlay town={town} state={state} table={o.table} waiting={o.waiting} />
  return null
}

function Sheet({ title, onClose, children, wide = false, label }) {
  return (
    <div className="mt-cover" role="dialog" aria-modal="true" aria-label={label || title} onClick={onClose}>
      <div className={`mt-card mt-sheet${wide ? ' is-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="mt-sheet-head">
          <h2 className="mt-pixel">{title}</h2>
          <button type="button" className="mt-iconbtn" style={{ width: 38, height: 38 }} aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SignDialog({ title, text, onClose }) {
  return (
    <Sheet title={title || 'Sign'} onClose={onClose}>
      {text && <p className="mt-sign-text">{text}</p>}
      <div className="mt-actions"><button type="button" className="mt-btn is-primary" onClick={onClose}>Close</button></div>
    </Sheet>
  )
}

// --- Table games -------------------------------------------------------------------------------

function useGame(state, table) {
  return state.world.games?.[table] || null
}

/** Nobody opposite yet: wait for a person, or play a bot right away. */
function TableWaiting({ town, table, kind }) {
  const name = kind === 'chess' ? 'chess' : 'Connect Four'
  return (
    <Sheet title={kind === 'chess' ? 'Chess Club' : 'Game Den'} onClose={() => town.closeOverlay()} label={`${name} table`}>
      <p className="mt-sign-text">
        You take a seat. When someone sits opposite (or walks in), a game of {name} starts. No one around? Play a bot:
      </p>
      <div className="mt-bot-row" role="group" aria-label="Play a bot">
        {[['easy', 'Easy', 'Plays for fun'], ['medium', 'Medium', 'A fair fight'], ['hard', 'Hard', 'Thinks ahead']].map(([level, label, note]) => (
          <button key={level} type="button" className="mt-btn mt-bot" onClick={() => town.playBot(table, level)}>
            <Robot aria-hidden="true" />
            <span><b>{label}</b><small>{note}</small></span>
          </button>
        ))}
      </div>
      <div className="mt-actions"><button type="button" className="mt-btn" onClick={() => town.closeOverlay()}>Keep waiting</button></div>
    </Sheet>
  )
}

/** The character playing each side: their town avatar, or the CPU for a bot. */
function Portrait({ town, state, pid, thinking }) {
  if (typeof pid === 'string' && pid.startsWith('bot:')) return <CpuAvatar thinking={thinking} scale={2} className="mt-portrait is-cpu" />
  const look = pid === state.pid ? town.profile?.look : (state.people.find((p) => p.pid === pid)?.look || town.peerInfo.get(pid)?.look)
  return <AvatarCanvas look={look || {}} scale={2} className="mt-portrait" />
}

function Players({ town, state, game, pid, sides, labels }) {
  return (
    <div className="mt-players">
      {sides.map((side) => {
        const p = game.players[side]
        const turn = !game.status?.over && game.turn === side
        return (
          <div key={side} className={`mt-player${turn ? ' is-turn' : ''}`}>
            <Portrait town={town} state={state} pid={p} thinking={turn && typeof p === 'string' && p.startsWith('bot:')} />
            <span className="mt-player-name"><span className={`mt-side mt-side-${side}`} aria-hidden="true" />{p === pid ? 'You' : game.names?.[p] || 'Player'}</span>
            <span className="mt-player-note">{labels[side]}{turn ? (p?.startsWith?.('bot:') ? ' · thinking…' : ' · to move') : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function outcomeText(game, pid) {
  const s = game.status || {}
  if (!s.over) return null
  const reason = {
    checkmate: 'by checkmate', resigned: 'by resignation', abandoned: '— the other player left', left: '— the other player stood up',
    four: 'with four in a row', stalemate: 'stalemate', insufficient: 'not enough material', fifty: 'fifty-move rule',
    threefold: 'threefold repetition', draw: 'board full',
  }[s.reason] || ''
  if (s.draw) return `Draw — ${reason}`
  if (s.winner === pid) return `You win ${reason}!`
  return `${game.names?.[s.winner] || 'Your opponent'} wins ${reason}`
}

function GameActions({ town, game, pid, table }) {
  const playing = Object.values(game.players).includes(pid)
  if (!playing) return <p className="mt-note">You're watching. Sit at a free table to play.</p>
  const over = game.status?.over
  const waiting = over && game.rematch?.includes(pid)
  return (
    <div className="mt-actions" style={{ justifyContent: 'flex-start' }}>
      {!over && <button type="button" className="mt-btn is-danger" onClick={() => town.act('resign', { table })}>Resign</button>}
      {over && (
        <button type="button" className="mt-btn is-primary" disabled={waiting} onClick={() => town.act('rematch', { table })}>
          {waiting ? 'Waiting for your opponent…' : 'Play again'}
        </button>
      )}
      <button type="button" className="mt-btn" onClick={() => { town.act('stand', { table }); town.closeOverlay() }}>
        Leave table
      </button>
    </div>
  )
}

function ChessOverlay({ town, state, table, waiting }) {
  const game = useGame(state, table)
  const pid = state.pid
  const [selected, setSelected] = useState(null)
  const [promo, setPromo] = useState(null)
  const [pending, setPending] = useState(null)
  const images = useMemo(() => pieceImages(), [])
  const fen = pending?.fen || game?.state?.fen || chess.START_FEN
  const board = useMemo(() => chess.parseFen(fen), [fen])
  useEffect(() => { setPending(null) }, [game?.state?.fen])
  useEffect(() => { setSelected(null) }, [fen])
  if (!game || (waiting && game.status?.over && !Object.values(game.players).includes(state.pid))) {
    return <TableWaiting town={town} table={table} kind="chess" />
  }
  const mySide = Object.entries(game.players).find(([, p]) => p === pid)?.[0] || null
  const flipped = mySide === 'b'
  const myTurn = mySide && !game.status?.over && game.turn === mySide && !pending
  const legal = myTurn ? chess.legalMoves(board) : []
  const targets = selected ? legal.filter((m) => m.startsWith(selected)).map((m) => m.slice(2, 4)) : []
  const last = game.state.moves[game.state.moves.length - 1]
  const status = chess.gameStatus(board, game.state.positions)
  const checkSquare = status.check ? chess.kingSquare(board, status.turn) : null

  const play = (uci) => {
    const after = chess.applyMove(board, uci)
    if (!after) return
    setPending({ fen: chess.toFen(after) })
    town.gameMove(table, uci).then((r) => { if (!r) setPending(null) })
  }
  const clickSquare = (sq) => {
    if (!myTurn) return
    const piece = chess.pieceAt(board, sq)
    if (selected && targets.includes(sq)) {
      const base = selected + sq
      if (legal.includes(base + 'q')) setPromo(base)
      else play(base)
      setSelected(null)
      return
    }
    if (piece && piece.color === mySide) setSelected(sq === selected ? null : sq)
    else setSelected(null)
  }
  const files = flipped ? 'hgfedcba' : 'abcdefgh'
  const ranks = flipped ? '12345678' : '87654321'
  const outcome = outcomeText(game, pid)
  return (
    <Sheet title="Chess Club" onClose={() => town.closeOverlay()} wide label="Chess game">
      <div className="mt-game">
        <div className="mt-board" role="grid" aria-label="Chess board">
          {[...ranks].map((r, ri) => [...files].map((f, fi) => {
            const sq = f + r
            const piece = chess.pieceAt(board, sq)
            const cls = ['mt-sq', chess.isLightSquare(sq) ? 'is-light' : 'is-dark']
            if (selected === sq) cls.push('is-sel')
            if (last && (last.slice(0, 2) === sq || last.slice(2, 4) === sq)) cls.push('is-last')
            if (checkSquare === sq) cls.push('is-check')
            return (
              <button
                key={sq}
                type="button"
                role="gridcell"
                className={cls.join(' ')}
                aria-label={`${sq}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : ''}`}
                onClick={() => clickSquare(sq)}
              >
                {piece && <img src={images[piece.color + piece.type]} alt="" draggable="false" />}
                {targets.includes(sq) && <span className={piece ? 'mt-cap' : 'mt-dotmove'} aria-hidden="true" />}
                {fi === 0 && <span className="mt-coord mt-coord-r" aria-hidden="true">{r}</span>}
                {ri === 7 && <span className="mt-coord mt-coord-f" aria-hidden="true">{f}</span>}
              </button>
            )
          }))}
        </div>
        <aside className="mt-game-side">
          <Players town={town} state={state} game={game} pid={pid} sides={['w', 'b']} labels={{ w: 'White', b: 'Black' }} />
          <p className={`mt-game-status${outcome ? ' is-over' : ''}`} aria-live="polite">
            {outcome || (status.check ? 'Check!' : myTurn ? 'Your move' : mySide ? 'Waiting for your opponent' : 'Watching')}
          </p>
          <ol className="mt-moves">
            {pairs(game.state.san).map(([w, b], i) => (
              <li key={i}><span>{i + 1}.</span> {w} {b || ''}</li>
            ))}
          </ol>
          <GameActions town={town} game={game} pid={pid} table={table} />
        </aside>
      </div>
      {promo && (
        <div className="mt-promo" role="dialog" aria-label="Promote to">
          {['q', 'r', 'b', 'n'].map((t) => (
            <button key={t} type="button" className="mt-btn" aria-label={NAMES[t]} onClick={() => { play(promo + t); setPromo(null) }}>
              <img src={images[mySide + t]} alt="" width="36" height="36" />
            </button>
          ))}
          <button type="button" className="mt-btn" onClick={() => setPromo(null)}>Cancel</button>
        </div>
      )}
    </Sheet>
  )
}

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

function pairs(list) {
  const out = []
  for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1]])
  return out
}

function Connect4Overlay({ town, state, table, waiting }) {
  const game = useGame(state, table)
  const pid = state.pid
  const [pending, setPending] = useState(null)
  useEffect(() => { setPending(null) }, [game?.state?.cells])
  if (!game || (waiting && game.status?.over && !Object.values(game.players).includes(state.pid))) {
    return <TableWaiting town={town} table={table} kind="connect4" />
  }
  const mySide = Object.entries(game.players).find(([, p]) => p === pid)?.[0] || null
  const cells = pending || game.state.cells
  const myTurn = mySide && !game.status?.over && game.turn === mySide && !pending
  const win = new Set((game.line || []).map(([c, r]) => `${c},${r}`))
  const drop = (col) => {
    if (!myTurn) return
    const after = c4.drop({ cells: game.state.cells, turn: game.turn }, col)
    if (!after) return
    setPending(after.cells)
    town.gameMove(table, col).then((r) => { if (!r) setPending(null) })
  }
  const outcome = outcomeText(game, pid)
  return (
    <Sheet title="Game Den" onClose={() => town.closeOverlay()} wide label="Connect Four game">
      <div className="mt-game">
        <div className="mt-c4" role="grid" aria-label="Connect Four board">
          {Array.from({ length: c4.COLS }, (_, col) => (
            <button key={col} type="button" className="mt-c4-col" disabled={!myTurn} aria-label={`Drop in column ${col + 1}`}
              onClick={() => drop(col)}>
              {Array.from({ length: c4.ROWS }, (_, row) => {
                const v = cells[row * c4.COLS + col]
                return <span key={row} className={`mt-disc${v === 'r' ? ' is-r' : v === 'y' ? ' is-y' : ''}${win.has(`${col},${row}`) ? ' is-win' : ''}`} />
              })}
            </button>
          ))}
        </div>
        <aside className="mt-game-side">
          <Players town={town} state={state} game={game} pid={pid} sides={['r', 'y']} labels={{ r: 'Red', y: 'Yellow' }} />
          <p className={`mt-game-status${outcome ? ' is-over' : ''}`} aria-live="polite">
            {outcome || (myTurn ? 'Your turn — pick a column' : mySide ? 'Waiting for your opponent' : 'Watching')}
          </p>
          <GameActions town={town} game={game} pid={pid} table={table} />
        </aside>
      </div>
    </Sheet>
  )
}

// --- Cinema TV -----------------------------------------------------------------------------

function TvPanel({ town, state }) {
  const tv = state.world.tv?.tv
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  useEffect(() => {
    // Keep the shared position ticking while the panel is open.
    const timer = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const ok = await town.setTv(link)
    setBusy(false)
    if (ok) setLink('')
  }
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const at = tv ? town.tvPosition(tv) : null
  const finished = !!tv && at === null
  return (
    <Sheet title="Cinema screen" onClose={() => town.closeOverlay()}>
      {tv ? (
        <div className="mt-tv-now">
          {state.tvThumb && <img src={state.tvThumb} alt="" className="mt-tv-thumb" />}
          <div>
            <p className="mt-tv-title">{tv.title || 'A YouTube video'}</p>
            <p className="mt-note" style={{ margin: '4px 0 0' }}>
              Put on by {tv.byName || 'someone'} · {finished
                ? 'finished'
                : `${clock(at)}${tv.length ? ` of ${clock(tv.length)}` : ''}`}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-sign-text">The screen is dark. Paste a YouTube link to put something on for everyone in the cinema.</p>
      )}
      {tv && (
        <div className="mt-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="mt-btn is-primary" onClick={() => town.openTv()}>
            <Play aria-hidden="true" /> {finished ? 'Watch from the start' : 'Watch together'} <ExternalLink aria-hidden="true" />
          </button>
          <button type="button" className="mt-btn" onClick={() => town.restartTv()}>Start again for everyone</button>
          <button type="button" className="mt-btn" onClick={() => town.clearTv()}>Turn off</button>
        </div>
      )}
      <form className="mt-field" onSubmit={submit}>
        <label htmlFor="mt-tv-link">{tv ? 'Change what is playing' : 'YouTube link'}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="mt-tv-link" className="mt-input" value={link} placeholder="https://youtube.com/watch?v=…"
            autoComplete="off" onChange={(e) => setLink(e.target.value)} />
          <button type="submit" className="mt-btn" disabled={!link.trim() || busy}>{busy ? 'Loading…' : 'Play'}</button>
        </div>
      </form>
      <p className="mt-note">
        YouTube opens in its own tab at the moment everyone else is at. If you drift apart, start it again for everyone.
      </p>
    </Sheet>
  )
}
