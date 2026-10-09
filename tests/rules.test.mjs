// Tests for games/chess.js and games/connect4.js (node --test, no packages).
//
//   node --test tests/rules.test.mjs
//
// The same targeted cases as tests/test_rules.py, deeper perft (fast in JS), and
// the cross-check: every game recorded from the Python engines in
// tests/fixtures/*_crosscheck.json is replayed here and must match exactly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  START_FEN, parseFen, toFen, positionKey, legalMoves, applyMove, gameStatus, moveToSan, pieceAt, kingSquare,
  isLightSquare,
} from '../games/chess.js'
import { COLS, ROWS, newGame, legalColumns, drop, status as c4Status } from '../games/connect4.js'

const START = START_FEN
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'
const POSITION_3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'
const POSITION_4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'
const POSITION_4_MIRRORED = 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1'
const POSITION_5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'
const POSITION_6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10'

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

/** Leaf count through the public API (bulk-counted at the last ply). */
function perft(state, depth) {
  const moves = legalMoves(state)
  if (depth === 1) return moves.length
  let total = 0
  for (const move of moves) total += perft(applyMove(state, move), depth - 1)
  return total
}

/** Apply UCI moves; returns [state, position keys including the start]. */
function play(fen, moves) {
  let state = parseFen(fen)
  const positions = [positionKey(state)]
  for (const move of moves) {
    const next = applyMove(state, move)
    assert.notEqual(next, null, `illegal move ${move} in ${toFen(state)}`)
    state = next
    positions.push(positionKey(state))
  }
  return [state, positions]
}

const statusOf = (fen, positions) => gameStatus(parseFen(fen), positions)

// ------------------------------------------------------------------ chess: perft

const perftCases = [
  ['start position', START, [20, 400, 8902, 197281, 4865609]],
  ['kiwipete', KIWIPETE, [48, 2039, 97862, 4085603]],
  ['position 3', POSITION_3, [14, 191, 2812, 43238, 674624]],
  ['position 4', POSITION_4, [6, 264, 9467, 422333]],
  ['position 4 mirrored', POSITION_4_MIRRORED, [6, 264, 9467, 422333]],
  ['position 5', POSITION_5, [44, 1486, 62379, 2103487]],
  ['position 6', POSITION_6, [46, 2079, 89890, 3894594]],
]
for (const [name, fen, counts] of perftCases) {
  test(`perft ${name} depths 1-${counts.length}`, () => {
    const state = parseFen(fen)
    counts.forEach((expected, i) => assert.equal(perft(state, i + 1), expected, `depth ${i + 1}`))
  })
}

// ------------------------------------------------------------------ chess: FEN

test('FEN round trips', () => {
  for (const fen of [START, KIWIPETE, POSITION_3, POSITION_4, POSITION_4_MIRRORED, POSITION_5, POSITION_6,
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    '8/8/8/K2pP2r/8/8/8/4k3 w - d6 0 1',
    '4k3/8/8/8/8/8/8/4K3 b - - 99 123456']) {
    assert.equal(toFen(parseFen(fen)), fen)
  }
  assert.equal(toFen(parseFen('  ' + START + '\n')), START)
})

test('state shape', () => {
  const state = parseFen(START)
  assert.equal(state.board.length, 64)
  assert.equal(state.board[0], 'r') // a8
  assert.equal(state.board[60], 'K') // e1
  assert.equal(state.board[36], null) // e4
  assert.deepEqual([state.turn, state.castling, state.ep, state.halfmove, state.fullmove], ['w', 'KQkq', null, 0, 1])
})

test('invalid FENs throw', () => {
  const bad = [
    null, 42, '', 'not a fen',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 x',
    'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/44/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/3x4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w QK - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkqK - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1',
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e4 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq e3 0 1',
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq e3 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - -1 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 01 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 0',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1.5',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1BNR w kq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKKBNR w kq - 0 1',
    'rnbqkbnP/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQq - 0 1',
    '4k3/8/8/8/8/8/8/4R1K1 w - - 0 1',
  ]
  for (const fen of bad) assert.throws(() => parseFen(fen), Error, String(fen))
})

test('pieceAt and kingSquare', () => {
  const state = parseFen(START)
  assert.deepEqual(pieceAt(state, 'e1'), { color: 'w', type: 'k' })
  assert.deepEqual(pieceAt(state, 'd8'), { color: 'b', type: 'q' })
  assert.deepEqual(pieceAt(state, 'g7'), { color: 'b', type: 'p' })
  for (const square of ['e4', 'z9', 'e', '', null, 'E2']) assert.equal(pieceAt(state, square), null)
  assert.equal(kingSquare(state, 'w'), 'e1')
  assert.equal(kingSquare(state, 'b'), 'e8')
  assert.equal(kingSquare(state, 'x'), null)
  assert.equal(kingSquare(parseFen(KIWIPETE), 'b'), 'e8')
})

test('board colours put a light square at each player\'s right hand', () => {
  // The square colours the chess board is painted with (they were once swapped in the game).
  assert.equal(isLightSquare('h1'), true) // White's right-hand corner
  assert.equal(isLightSquare('a8'), true) // Black's right-hand corner
  assert.equal(isLightSquare('a1'), false)
  assert.equal(isLightSquare('h8'), false)
  assert.equal(isLightSquare('d1'), true) // the queen starts on her own colour
  assert.equal(isLightSquare('d8'), false)
  assert.equal(isLightSquare('e4'), true)
  assert.equal(isLightSquare('d4'), false)
  let light = 0
  for (const f of 'abcdefgh') for (const r of '12345678') if (isLightSquare(f + r)) light++
  assert.equal(light, 32)
  for (const square of ['z9', 'e', '', null]) assert.throws(() => isLightSquare(square))
})

test('positionKey drops the counters', () => {
  const [state] = play(START, ['g1f3'])
  assert.equal(positionKey(state), 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -')
})

// ------------------------------------------------------------------ chess: moves

test('legal moves are sorted UCI strings', () => {
  const moves = legalMoves(parseFen(START))
  assert.deepEqual(moves, [...moves].sort())
  assert.deepEqual(moves.slice(0, 4), ['a2a3', 'a2a4', 'b1a3', 'b1c3'])
  assert.ok(moves.includes('e2e4'))
})

test('applyMove rejects garbage', () => {
  const state = parseFen(START)
  for (const move of [null, undefined, '', 'e2', 'e2e4e', 'e2e4 ', 'z9z9', 'E2E4', 'e2e5', 'e7e5', 'e2e2', 'e2e4q',
    123, ['e2e4'], { from: 'e2' }]) {
    assert.equal(applyMove(state, move), null, String(move))
  }
  assert.equal(applyMove(null, 'e2e4'), null)
  assert.equal(applyMove({}, 'e2e4'), null)
  assert.equal(applyMove('garbage', 'e2e4'), null)
})

test('functions never mutate their input', () => {
  const state = parseFen(KIWIPETE)
  const snapshot = structuredClone(state)
  for (const move of legalMoves(state)) {
    applyMove(state, move)
    moveToSan(state, move)
  }
  gameStatus(state, [positionKey(state)])
  toFen(state)
  assert.deepEqual(state, snapshot)
})

test('move counters', () => {
  let [state] = play(START, ['g1f3'])
  assert.deepEqual([state.halfmove, state.fullmove, state.turn], [1, 1, 'b']);
  [state] = play(START, ['g1f3', 'g8f6'])
  assert.deepEqual([state.halfmove, state.fullmove], [2, 2]);
  [state] = play(START, ['g1f3', 'g8f6', 'e2e4'])
  assert.equal(state.halfmove, 0);
  [state] = play(START, ['e2e4', 'd7d5', 'g1f3', 'b8c6', 'e4d5'])
  assert.deepEqual([state.halfmove, state.fullmove], [0, 3])
})

// ------------------------------------------------------------------ chess: castling

test('castling: blocked', () => {
  assert.ok(!legalMoves(parseFen(START)).includes('e1g1'))
  const moves = legalMoves(parseFen('r3k2r/8/8/8/8/8/8/RN2K1NR w KQkq - 0 1'))
  assert.ok(!moves.includes('e1g1'))
  assert.ok(!moves.includes('e1c1'))
  const black = legalMoves(parseFen('r3k2r/8/8/8/8/8/8/RN2K1NR b KQkq - 0 1'))
  assert.ok(black.includes('e8g8') && black.includes('e8c8'))
})

test('castling: not through, into or out of check; b1 may be attacked', () => {
  let moves = legalMoves(parseFen('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1'))
  assert.ok(!moves.includes('e1g1') && moves.includes('e1c1'))
  moves = legalMoves(parseFen('4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1'))
  assert.ok(!moves.includes('e1g1') && moves.includes('e1c1'))
  moves = legalMoves(parseFen('4k3/8/8/8/8/8/3r4/R3K2R w KQ - 0 1'))
  assert.ok(moves.includes('e1g1') && !moves.includes('e1c1'))
  moves = legalMoves(parseFen('4k3/8/8/8/8/8/1r6/R3K2R w KQ - 0 1'))
  assert.ok(moves.includes('e1g1') && moves.includes('e1c1'))
  moves = legalMoves(parseFen('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1'))
  assert.ok(!moves.includes('e1g1') && !moves.includes('e1c1') && moves.includes('e1e2'))
})

test('castling moves the rook', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
  assert.equal(toFen(play(fen, ['e1g1'])[0]), 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1')
  assert.equal(toFen(play(fen, ['e1c1', 'e8g8'])[0]), 'r4rk1/8/8/8/8/8/8/2KR3R w - - 2 2')
  assert.equal(toFen(play(fen, ['e1g1', 'e8c8'])[0]), '2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2')
})

test('castling rights are lost by king/rook moves and rook captures', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
  assert.equal(play(fen, ['h1h2'])[0].castling, 'Qkq')
  assert.equal(play(fen, ['a1a2', 'h8h7'])[0].castling, 'Kq')
  assert.equal(play(fen, ['e1e2'])[0].castling, 'kq')
  assert.equal(play(fen, ['a1a8'])[0].castling, 'Kk')
  const [state] = play('4k3/8/8/8/8/8/6b1/R3K2R b KQ - 0 1', ['g2h1'])
  assert.equal(state.castling, 'Q')
  assert.ok(!legalMoves(state).includes('e1g1'))
  assert.ok(legalMoves(state).includes('e1c1'))
})

test('castling SAN', () => {
  const state = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
  assert.equal(moveToSan(state, 'e1g1'), 'O-O')
  assert.equal(moveToSan(state, 'e1c1'), 'O-O-O')
  assert.equal(moveToSan(parseFen('5k2/8/8/8/8/8/8/4K2R w K - 0 1'), 'e1g1'), 'O-O+')
})

// ------------------------------------------------------------------ chess: en passant

test('en passant capture', () => {
  const [state] = play('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['e2e4'])
  assert.equal(toFen(state), '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1')
  assert.ok(legalMoves(state).includes('d4e3'))
  assert.equal(moveToSan(state, 'd4e3'), 'dxe3')
  const after = applyMove(state, 'd4e3')
  assert.equal(toFen(after), '4k3/8/8/8/8/4p3/8/4K3 w - - 0 2')
  assert.equal(pieceAt(after, 'e4'), null)
})

test('en passant expires after one move', () => {
  let [state] = play('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['e2e4', 'e8e7'])
  assert.equal(state.ep, null)
  state = applyMove(state, 'e1d1')
  assert.ok(!legalMoves(state).includes('d4e3'))
  assert.equal(applyMove(state, 'd4e3'), null)
})

test('ep square only recorded when the capture is legal', () => {
  assert.equal(toFen(play(START, ['e2e4'])[0]), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
  assert.equal(toFen(play('8/3p4/8/K3P2r/8/8/8/4k3 b - - 0 1', ['d7d5'])[0]), '8/8/8/K2pP2r/8/8/8/4k3 w - - 0 2')
})

test('en passant exposing the own king is illegal', () => {
  let state = parseFen('8/8/8/K2pP2r/8/8/8/4k3 w - d6 0 1')
  assert.ok(!legalMoves(state).includes('e5d6'))
  assert.equal(applyMove(state, 'e5d6'), null)
  assert.equal(positionKey(state), '8/8/8/K2pP2r/8/8/8/4k3 w - -')
  state = parseFen('4k3/6b1/8/3pP3/8/2K5/8/8 w - d6 0 1')
  assert.ok(!legalMoves(state).includes('e5d6'))
  assert.ok(!legalMoves(state).includes('e5e6'))
})

test('en passant can remove a checking pawn', () => {
  const state = parseFen('8/8/8/3pP3/4K3/8/8/k7 w - d6 0 1')
  assert.equal(gameStatus(state).check, true)
  assert.ok(legalMoves(state).includes('e5d6'))
  assert.equal(moveToSan(state, 'e5d6'), 'exd6')
  assert.ok(!legalMoves(parseFen('8/8/8/3pP3/4K3/8/8/k7 w - - 0 1')).includes('e5d6'))
})

test('positionKey keeps only a usable ep square', () => {
  const [state] = play('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['e2e4'])
  assert.equal(positionKey(state), '4k3/8/8/8/3pP3/8/8/4K3 b - e3')
  const classic = parseFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')
  assert.equal(positionKey(classic), 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -')
})

// ------------------------------------------------------------------ chess: promotion

test('promotion to each piece', () => {
  const state = parseFen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1')
  const moves = legalMoves(state)
  for (const [piece, san] of [['q', 'e8=Q'], ['r', 'e8=R'], ['b', 'e8=B'], ['n', 'e8=N']]) {
    assert.ok(moves.includes('e7e8' + piece))
    assert.equal(moveToSan(state, 'e7e8' + piece), san)
    assert.deepEqual(pieceAt(applyMove(state, 'e7e8' + piece), 'e8'), { color: 'w', type: piece })
  }
  assert.ok(!moves.includes('e7e8'))
  for (const move of ['e7e8', 'e7e8k', 'e7e8p', 'e7e8Q']) assert.equal(applyMove(state, move), null)
})

test('capture promotion SAN', () => {
  const state = parseFen('3r4/4Pk2/8/8/8/8/8/K7 w - - 0 1')
  assert.equal(moveToSan(state, 'e7d8n'), 'exd8=N+')
  assert.equal(moveToSan(state, 'e7d8q'), 'exd8=Q')
  assert.equal(moveToSan(state, 'e7e8q'), 'e8=Q+')
  const black = parseFen('4k3/8/8/8/8/8/p7/4K3 b - - 0 1')
  assert.equal(moveToSan(black, 'a2a1q'), 'a1=Q+')
  assert.deepEqual(pieceAt(applyMove(black, 'a2a1n'), 'a1'), { color: 'b', type: 'n' })
})

// ------------------------------------------------------------------ chess: game status

test("fool's mate", () => {
  let [state, positions] = play(START, ['f2f3', 'e7e5', 'g2g4'])
  assert.equal(moveToSan(state, 'd8h4'), 'Qh4#')
  state = applyMove(state, 'd8h4')
  assert.deepEqual(gameStatus(state, [...positions, positionKey(state)]),
    { turn: 'w', check: true, over: true, result: '0-1', reason: 'checkmate' })
  assert.deepEqual(legalMoves(state), [])
})

test('white wins by mate; check without mate', () => {
  assert.equal(gameStatus(applyMove(parseFen('k7/8/1K6/8/8/8/8/2R5 w - - 0 1'), 'c1c8')).result, '1-0')
  const [state] = play(START, ['e2e4', 'd7d6'])
  assert.equal(moveToSan(state, 'f1b5'), 'Bb5+')
  assert.deepEqual(gameStatus(applyMove(state, 'f1b5')),
    { turn: 'b', check: true, over: false, result: null, reason: null })
})

test('stalemate', () => {
  assert.deepEqual(statusOf('k7/8/1Q6/8/8/8/8/7K b - - 0 1'),
    { turn: 'b', check: false, over: true, result: '1/2-1/2', reason: 'stalemate' })
  assert.equal(gameStatus(applyMove(parseFen('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1'), 'g1g6')).reason, 'stalemate')
})

test('threefold repetition', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
  let [state, positions] = play(START, shuffle)
  assert.equal(gameStatus(state, positions).over, false);
  [state, positions] = play(START, [...shuffle, ...shuffle])
  assert.deepEqual(gameStatus(state, positions),
    { turn: 'w', check: false, over: true, result: '1/2-1/2', reason: 'threefold' })
  assert.equal(gameStatus(state).over, false)
  assert.equal(gameStatus(state, []).over, false)
})

test('fifty-move rule, and checkmate takes precedence', () => {
  const state = parseFen('8/8/8/3k4/8/8/2R5/4K3 w - - 99 120')
  assert.equal(gameStatus(state).over, false)
  const after = applyMove(state, 'c2c3')
  assert.equal(after.halfmove, 100)
  assert.deepEqual(gameStatus(after), { turn: 'b', check: false, over: true, result: '1/2-1/2', reason: 'fifty' })
  const mate = applyMove(parseFen('k7/8/1K6/8/8/8/8/2R5 w - - 99 80'), 'c1c8')
  assert.equal(mate.halfmove, 100)
  assert.equal(gameStatus(mate).reason, 'checkmate')
})

test('insufficient material', () => {
  const drawn = {
    'K vs K': '8/8/4k3/8/8/4K3/8/8 w - - 0 1',
    'K+N vs K': '8/8/4k3/8/8/4K3/8/6N1 w - - 0 1',
    'K vs K+B': '8/8/4k3/8/2b5/4K3/8/8 w - - 0 1',
    'K+B vs K+B, same colour': '2b5/8/4k3/8/8/4K3/8/5B2 w - - 0 1',
    'K+2B vs K, same colour': '8/8/4k3/8/8/4K3/6B1/5B2 b - - 0 1',
  }
  const playable = {
    'K+B vs K+B, opposite colours': '5b2/8/4k3/8/8/4K3/8/5B2 w - - 0 1',
    'K+N vs K+N': '8/8/4k3/8/8/4K3/8/5Nn1 w - - 0 1',
    'K+N vs K+B': '8/8/4k3/8/8/4K3/8/5Nb1 w - - 0 1',
    'K+2N vs K': '8/8/4k3/8/8/4K3/8/5NN1 w - - 0 1',
    'K+P vs K': '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1',
    'K+R vs K': '8/8/4k3/8/8/4K3/8/7R w - - 0 1',
  }
  for (const [name, fen] of Object.entries(drawn)) {
    assert.equal(statusOf(fen).reason, 'insufficient', name)
    assert.equal(statusOf(fen).result, '1/2-1/2', name)
  }
  for (const [name, fen] of Object.entries(playable)) assert.equal(statusOf(fen).over, false, name)
  const state = parseFen('4k3/8/8/3n4/8/8/6B1/4K3 w - - 0 1')
  assert.equal(moveToSan(state, 'g2d5'), 'Bxd5')
  assert.equal(gameStatus(applyMove(state, 'g2d5')).reason, 'insufficient')
})

// ------------------------------------------------------------------ chess: SAN

test('SAN disambiguation', () => {
  const knights = parseFen('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1')
  assert.equal(moveToSan(knights, 'b1d2'), 'Nbd2')
  assert.equal(moveToSan(knights, 'f3d2'), 'Nfd2')
  assert.equal(moveToSan(knights, 'f3e5'), 'Ne5')
  const rooks = parseFen('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1')
  assert.equal(moveToSan(rooks, 'a1a3'), 'R1a3')
  assert.equal(moveToSan(rooks, 'a5a3'), 'R5a3')
  const queens = parseFen('8/8/1k6/8/4Q2Q/8/8/K6Q w - - 0 1')
  assert.equal(moveToSan(queens, 'h4e1'), 'Qh4e1')
  assert.equal(moveToSan(queens, 'h1e1'), 'Q1e1')
  assert.equal(moveToSan(queens, 'e4e1'), 'Qee1')
  assert.equal(moveToSan(parseFen('4k3/8/8/8/8/2N5/8/4K1N1 w - - 0 1'), 'g1e2'), 'Nge2')
  assert.equal(moveToSan(parseFen('4k3/8/8/b7/8/2N5/8/4K1N1 w - - 0 1'), 'g1e2'), 'Ne2') // c3 knight pinned
})

test('SAN basics and illegal input', () => {
  let state = parseFen(START)
  assert.equal(moveToSan(state, 'g1f3'), 'Nf3')
  assert.equal(moveToSan(state, 'e2e4'), 'e4')
  assert.equal(moveToSan(state, 'e2e5'), null)
  assert.equal(moveToSan(state, null), null);
  [state] = play(START, ['e2e4', 'd7d5'])
  assert.equal(moveToSan(state, 'e4d5'), 'exd5')
  assert.equal(moveToSan(parseFen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'), 'e1e2'), 'Kxe2')
})

// ------------------------------------------------------------------ connect four

function c4Play(cols) {
  let state = newGame()
  for (const col of cols) {
    const next = drop(state, col)
    assert.notEqual(next, null, `column ${col} refused`)
    state = next
  }
  return state
}

test('connect4: new game', () => {
  assert.deepEqual(newGame(), { cells: '.'.repeat(42), turn: 'r' })
  assert.deepEqual([COLS, ROWS], [7, 6])
  assert.deepEqual(legalColumns(newGame()), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(c4Status(newGame()), { over: false, winner: null, draw: false, line: null })
})

test('connect4: drop stacks and switches turn', () => {
  const start = newGame()
  let state = drop(start, 3)
  assert.deepEqual(state, { cells: '.'.repeat(38) + 'r' + '...', turn: 'y' })
  state = drop(state, 3)
  assert.equal(state.cells[31], 'y')
  assert.equal(state.turn, 'r')
  assert.deepEqual(start, newGame())
})

test('connect4: wins report the exact line', () => {
  assert.deepEqual(c4Status(c4Play([0, 0, 1, 1, 2, 2, 3])),
    { over: true, winner: 'r', draw: false, line: [[0, 5], [1, 5], [2, 5], [3, 5]] })
  assert.deepEqual(c4Status(c4Play([0, 1, 0, 1, 0, 1, 2, 1])),
    { over: true, winner: 'y', draw: false, line: [[1, 2], [1, 3], [1, 4], [1, 5]] })
  assert.deepEqual(c4Status(c4Play([0, 1, 1, 2, 3, 2, 2, 3, 6, 3, 3])),
    { over: true, winner: 'r', draw: false, line: [[0, 5], [1, 4], [2, 3], [3, 2]] })
  assert.deepEqual(c4Status(c4Play([6, 5, 5, 4, 3, 4, 4, 3, 0, 3, 3])),
    { over: true, winner: 'r', draw: false, line: [[3, 2], [4, 3], [5, 4], [6, 5]] })
})

test('connect4: no moves after a win', () => {
  const state = c4Play([0, 0, 1, 1, 2, 2, 3])
  assert.deepEqual(legalColumns(state), [])
  for (let col = 0; col < 7; col++) assert.equal(drop(state, col), null)
})

test('connect4: draw on a full board', () => {
  const draw = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3,
    3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 5]
  let state = c4Play(draw.slice(0, -1))
  assert.equal(c4Status(state).over, false)
  assert.deepEqual(legalColumns(state), [5])
  state = drop(state, 5)
  assert.equal(state.cells, 'yyrryyrrryyrryyyrryyrrryyrryyyrryyrrryyrry')
  assert.deepEqual(c4Status(state), { over: true, winner: null, draw: true, line: null })
  assert.deepEqual(legalColumns(state), [])
})

test('connect4: full column', () => {
  const state = c4Play([0, 0, 0, 0, 0, 0])
  assert.equal(drop(state, 0), null)
  assert.deepEqual(legalColumns(state), [1, 2, 3, 4, 5, 6])
})

test('connect4: bad input', () => {
  const state = newGame()
  for (const col of [-1, 7, 1.5, '3', null, undefined, true, [3], NaN]) assert.equal(drop(state, col), null, String(col))
  for (const bad of [null, {}, { cells: 'x'.repeat(42), turn: 'r' }, { cells: '.'.repeat(41), turn: 'r' },
    { cells: '.'.repeat(42), turn: 'x' }, { cells: 'r' + '.'.repeat(41), turn: 'y' },
    { cells: '.'.repeat(41) + 'r', turn: 'r' }]) {
    assert.equal(drop(bad, 0), null)
    assert.deepEqual(legalColumns(bad), [])
    assert.throws(() => c4Status(bad), Error)
  }
})

// ------------------------------------------------------------------ cross-check with Python

/** Decode the fixture's compact legal-move string ('e2e3e4', 'e7e8*'). */
function expandMoves(text) {
  const moves = []
  for (const group of text ? text.split(' ') : []) {
    const from = group.slice(0, 2)
    for (let j = 2; j < group.length;) {
      const to = group.slice(j, j + 2)
      j += 2
      if (group[j] === '*') {
        for (const p of 'bnqr') moves.push(from + to + p)
        j++
      } else {
        moves.push(from + to)
      }
    }
  }
  return moves
}

/** Decode 'turn check over result reason' into a gameStatus object. */
function decodeStatus(text) {
  const [turn, check, over, result, reason] = text.split(' ')
  return { turn, check: check === '1', over: over === '1', result: result === '-' ? null : result, reason: reason === '-' ? null : reason }
}

test('cross-check: JS and Python chess states are the same JSON', () => {
  const { states } = fixture('chess_crosscheck.json')
  assert.ok(states.length >= 4)
  for (const [fen, state] of states) assert.deepEqual(parseFen(fen), state, fen)
})

test('cross-check: JS chess reproduces every recorded Python game', () => {
  const { games } = fixture('chess_crosscheck.json')
  assert.ok(games.length >= 150)
  const seen = { plies: 0, ep: 0, castle: 0, underpromotion: 0, check: 0 }
  const endings = new Set()
  games.forEach((game, g) => {
    let state = parseFen(game.start)
    const positions = [positionKey(state)]
    game.plies.forEach(([fen, legal, move, san, expected], p) => {
      const where = `game ${g} ply ${p} (${fen})`
      assert.equal(toFen(state), fen, where)
      assert.equal(toFen(parseFen(fen)), fen, where)
      assert.equal(positionKey(state), fen.split(' ').slice(0, 4).join(' '), where)
      assert.deepEqual(legalMoves(state), expandMoves(legal), where)
      assert.equal(moveToSan(state, move), san, where)
      if (pieceAt(state, move.slice(0, 2)).type === 'p' && move[0] !== move[2] && !pieceAt(state, move.slice(2, 4))) seen.ep++
      state = applyMove(state, move)
      positions.push(positionKey(state))
      const st = gameStatus(state, positions)
      assert.deepEqual(st, decodeStatus(expected), where + ' ' + move)
      seen.plies++
      if (san.startsWith('O-O')) seen.castle++
      if (/=[RBN]/.test(san)) seen.underpromotion++
      if (st.check) seen.check++
      if (st.over) endings.add(st.reason)
    })
    assert.equal(toFen(state), game.final, `game ${g} final position`)
  })
  // The recorded games must actually exercise the rare rules.
  assert.ok(seen.plies > 10000, `plies ${seen.plies}`)
  assert.ok(seen.ep >= 20 && seen.castle >= 20 && seen.underpromotion >= 20 && seen.check >= 200, JSON.stringify(seen))
  assert.deepEqual([...endings].sort(), ['checkmate', 'fifty', 'insufficient', 'stalemate', 'threefold'])
})

test('cross-check: JS connect four reproduces every recorded Python game', () => {
  const { games } = fixture('connect4_crosscheck.json')
  let draws = 0, wins = 0
  games.forEach((game, g) => {
    let state = newGame()
    game.plies.forEach(([cells, turn, legal, col, [over, winner, draw, line]], p) => {
      const where = `game ${g} ply ${p}`
      assert.deepEqual(state, { cells, turn }, where)
      assert.deepEqual(legalColumns(state), [...legal].map(Number), where)
      state = drop(state, col)
      assert.deepEqual(c4Status(state), { over, winner, draw, line }, where)
    })
    assert.deepEqual([state.cells, state.turn], game.final, `game ${g} final`)
    assert.deepEqual(legalColumns(state), [])
    const st = c4Status(state)
    if (st.draw) draws++
    if (st.winner) wins++
  })
  assert.ok(draws >= 5 && wins >= 30, `draws ${draws}, wins ${wins}`)
})
