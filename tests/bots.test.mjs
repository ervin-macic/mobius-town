// Tests for the game bots games/chessbot.js and games/c4bot.js (node --test, no packages).
//
//   node --test tests/bots.test.mjs
//
// Positions come from seeded random playouts, so every run sees the same ones.
// Timing checks are deliberately loose (budget * 2 + 100 ms): a busy or
// CPU-throttled machine can pause the process for a whole scheduler period.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, parseFen, toFen, positionKey, legalMoves, applyMove, gameStatus } from '../games/chess.js'
import { newGame, drop, legalColumns, status as c4Status } from '../games/connect4.js'
import { chooseChessMove, perft } from '../games/chessbot.js'
import { chooseConnect4Column } from '../games/c4bot.js'

const LEVELS = ['easy', 'medium', 'hard']
const timeLimit = budget => budget * 2 + 100

/** Seeded PRNG (mulberry32): floats in [0, 1). */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function timed(fn) {
  const start = performance.now()
  const value = fn()
  return [value, performance.now() - start]
}

// ------------------------------------------------------------------ chess helpers

/** Unfinished positions reached by random play from the start, with their repetition keys. */
function randomChessPositions(count, seed) {
  const random = seeded(seed)
  const found = []
  while (found.length < count) {
    let state = parseFen(START_FEN)
    const positions = [positionKey(state)]
    const plies = Math.floor(random() * 90)
    for (let i = 0; i < plies; i++) {
      const moves = legalMoves(state)
      if (moves.length === 0) break
      state = applyMove(state, moves[Math.floor(random() * moves.length)])
      positions.push(positionKey(state))
    }
    if (!gameStatus(state, positions).over) found.push({ state, positions })
  }
  return found
}

/** Leaf count through the public chess.js API. */
function rulesPerft(state, depth) {
  const moves = legalMoves(state)
  if (depth === 1) return moves.length
  let total = 0
  for (const move of moves) total += rulesPerft(applyMove(state, move), depth - 1)
  return total
}

/** Square name of the first `letter` piece on the board ('Q' -> 'd1'), or null. */
function squareOfPiece(state, letter) {
  const i = state.board.indexOf(letter)
  return i < 0 ? null : 'abcdefgh'[i % 8] + String(8 - Math.floor(i / 8))
}

const isMate = (state, move) => gameStatus(applyMove(state, move)).reason === 'checkmate'

// ------------------------------------------------------------------ chess

test('chess: the internal move generator agrees with chess.js (perft)', () => {
  const known = [
    [START_FEN, 3, 8902],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 3, 2812],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
  ]
  for (const [fen, depth, nodes] of known) assert.equal(perft(parseFen(fen), depth), nodes, fen)
  for (const { state } of randomChessPositions(20, 11)) {
    assert.equal(perft(state, 2), rulesPerft(state, 2), toFen(state))
  }
})

test('chess: every level returns a legal move within the time budget', () => {
  const budget = 120
  for (const { state, positions } of randomChessPositions(12, 1)) {
    const legal = legalMoves(state)
    for (const level of LEVELS) {
      const [move, ms] = timed(() => chooseChessMove(state, { level, positions, timeBudgetMs: budget, random: seeded(2) }))
      assert.ok(legal.includes(move), `${level} played ${move} in ${toFen(state)}`)
      assert.ok(ms <= timeLimit(budget), `${level} took ${ms.toFixed(0)} ms in ${toFen(state)}`)
    }
  }
})

test('chess: the default budget (500 ms) is respected', () => {
  const state = parseFen('r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10')
  const info = {}
  const [move, ms] = timed(() => chooseChessMove(state, { level: 'hard', info }))
  assert.ok(legalMoves(state).includes(move))
  assert.ok(ms <= timeLimit(500), `hard took ${ms.toFixed(0)} ms`)
  assert.equal(info.level, 'hard')
  assert.ok(info.depth >= 2, `searched to depth ${info.depth}`)
})

test('chess: null without a legal move; the only move straight away', () => {
  const foolsMate = parseFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')
  const stalemate = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
  const forced = parseFen('k7/8/2K5/8/8/8/8/1R6 b - - 0 1')
  for (const level of LEVELS) {
    assert.equal(chooseChessMove(foolsMate, { level }), null)
    assert.equal(chooseChessMove(stalemate, { level }), null)
    assert.equal(chooseChessMove(forced, { level }), 'a8a7')
  }
})

test('bots: tolerate junk options and states', () => {
  const state = parseFen(START_FEN)
  const info = {}
  const move = chooseChessMove(state, { level: 'grandmaster', positions: [42, 'junk', null, 'x y z w'], timeBudgetMs: -5, random: 'nope', info })
  assert.ok(legalMoves(state).includes(move))
  assert.equal(info.level, 'medium') // unknown levels play as medium
  assert.equal(chooseChessMove(null), null)
  assert.equal(chooseChessMove({ board: [] }), null)
  assert.ok(legalColumns(newGame()).includes(chooseConnect4Column(newGame(), { level: 'grandmaster', timeBudgetMs: NaN })))
})

test('chess: every level mates in one, and medium/hard prefer it to slower wins', () => {
  const cases = [
    ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'd1d8'],
    ['3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', 'd8d1'],
    ['7k/8/6K1/8/8/8/8/1Q6 w - - 0 1', null], // Qb8# now; many other moves mate later
  ]
  for (const [fen, expected] of cases) {
    const state = parseFen(fen)
    for (const level of LEVELS) {
      const move = chooseChessMove(state, { level, timeBudgetMs: 300, random: seeded(4) })
      if (expected) assert.equal(move, expected, `${level} in ${fen}`)
      assert.ok(isMate(state, move), `${level} played ${move} in ${fen}`)
    }
  }
})

test('chess: medium and hard take a hanging queen', () => {
  const cases = [
    ['rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'f3h4'], // 2...Qh4?? 3.Nxh4
    ['rnbqkbnr/ppppppp1/7p/6Q1/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 3', 'h6g5'],
  ]
  for (const [fen, expected] of cases) {
    for (const level of ['medium', 'hard']) {
      assert.equal(chooseChessMove(parseFen(fen), { level, timeBudgetMs: 300, random: seeded(5) }), expected, `${level} in ${fen}`)
    }
  }
})

test('chess: hard does not hang its own queen', () => {
  const cases = [
    '6k1/5ppp/4p3/3p4/8/8/5PPP/3Q2K1 w - - 0 1', // Qxd5?? exd5
    '6k1/5ppp/8/8/1p6/2Q5/5PPP/6K1 w - - 0 1', // the queen is attacked by the b4 pawn
  ]
  for (const fen of cases) {
    const state = parseFen(fen)
    const move = chooseChessMove(state, { level: 'hard', timeBudgetMs: 300, random: seeded(6) })
    const after = applyMove(state, move)
    const queen = squareOfPiece(after, 'Q')
    assert.ok(queen, `${move} lost the queen in ${fen}`)
    assert.ok(!legalMoves(after).some(reply => reply.slice(2, 4) === queen), `${move} leaves the queen en prise in ${fen}`)
  }
})

test('chess: medium and hard parry a mate-in-one threat', () => {
  const state = parseFen('6k1/5ppp/8/8/8/8/r4PPP/3R2K1 b - - 0 1') // White threatens Rd8#
  for (const level of ['medium', 'hard']) {
    const move = chooseChessMove(state, { level, timeBudgetMs: 300, random: seeded(7) })
    const after = applyMove(state, move)
    assert.ok(!legalMoves(after).some(reply => isMate(after, reply)), `${level} played ${move} and allows mate`)
  }
})

test('chess: avoids threefold repetition when ahead, heads for it when behind', () => {
  const options = { level: 'medium', timeBudgetMs: 2000 }
  // White is a rook up. Once its preferred move would repeat a position for the
  // third time (a draw), it must play something else.
  const ahead = parseFen('8/8/4k3/8/8/8/3K4/R7 w - - 0 1')
  const planned = chooseChessMove(ahead, { ...options, positions: [positionKey(ahead)], random: seeded(8) })
  const repeated = positionKey(applyMove(ahead, planned))
  const history = [repeated, positionKey(ahead), repeated, positionKey(ahead)]
  const move = chooseChessMove(ahead, { ...options, positions: history, random: seeded(8) })
  assert.notEqual(move, planned)
  const after = applyMove(ahead, move)
  assert.equal(gameStatus(after, [...history, positionKey(after)]).over, false)

  // White is a rook down: a move that ends the game by repetition is welcome.
  const behind = parseFen('8/8/4k3/8/8/8/3K4/r7 w - - 0 1')
  const drawing = positionKey(applyMove(behind, 'd2e2'))
  const drawHistory = [drawing, positionKey(behind), drawing, positionKey(behind)]
  const choice = chooseChessMove(behind, { ...options, positions: drawHistory, random: seeded(9) })
  assert.equal(choice, 'd2e2')
  const end = applyMove(behind, choice)
  assert.equal(gameStatus(end, [...drawHistory, positionKey(end)]).reason, 'threefold')
})

test('chess: easy plays legal, varied moves', () => {
  const start = parseFen(START_FEN)
  const openings = new Set()
  for (let seed = 0; seed < 12; seed++) {
    const move = chooseChessMove(start, { level: 'easy', random: seeded(seed) })
    assert.ok(legalMoves(start).includes(move))
    openings.add(move)
  }
  assert.ok(openings.size >= 3, `only ${[...openings]}`)
  // A short self-play game: every move legal, each one quick.
  const random = seeded(10)
  let state = start
  const positions = [positionKey(state)]
  for (let ply = 0; ply < 60 && !gameStatus(state, positions).over; ply++) {
    const [move, ms] = timed(() => chooseChessMove(state, { level: 'easy', positions, random, timeBudgetMs: 100 }))
    assert.ok(legalMoves(state).includes(move), `easy played ${move} in ${toFen(state)}`)
    assert.ok(ms <= timeLimit(100))
    state = applyMove(state, move)
    positions.push(positionKey(state))
  }
})

// ------------------------------------------------------------------ connect four helpers

const play = columns => columns.reduce((state, col) => drop(state, col), newGame())

/** Unfinished positions reached by random play from the empty board. */
function randomConnect4Positions(count, seed) {
  const random = seeded(seed)
  const found = []
  while (found.length < count) {
    let state = newGame()
    const plies = Math.floor(random() * 36)
    for (let i = 0; i < plies && !c4Status(state).over; i++) {
      const cols = legalColumns(state)
      state = drop(state, cols[Math.floor(random() * cols.length)])
    }
    if (!c4Status(state).over) found.push(state)
  }
  return found
}

/** Columns that win on the spot for the side to move. */
const winningColumns = state => legalColumns(state).filter(col => c4Status(drop(state, col)).winner === state.turn)
/** After dropping in `col`, can the opponent win with their next disc? */
const handsOverWin = (state, col) => winningColumns(drop(state, col)).length > 0

// ------------------------------------------------------------------ connect four

test('connect4: every level returns a legal column within the time budget', () => {
  const budget = 100
  for (const state of randomConnect4Positions(16, 21)) {
    const legal = legalColumns(state)
    for (const level of LEVELS) {
      const [col, ms] = timed(() => chooseConnect4Column(state, { level, timeBudgetMs: budget, random: seeded(22) }))
      assert.ok(legal.includes(col), `${level} chose ${col} for ${state.cells}`)
      assert.ok(ms <= timeLimit(budget), `${level} took ${ms.toFixed(0)} ms for ${state.cells}`)
    }
  }
  const info = {}
  const [col, ms] = timed(() => chooseConnect4Column(newGame(), { level: 'hard', info })) // default budget 300 ms
  assert.ok(legalColumns(newGame()).includes(col))
  assert.ok(ms <= timeLimit(300), `hard took ${ms.toFixed(0)} ms on the empty board`)
  assert.ok(info.depth >= 5, `searched to depth ${info.depth}`)
})

test('connect4: null when the game is over or the state is invalid', () => {
  const won = play([0, 1, 0, 1, 0, 1, 0]) // red four in column 0
  const full = { cells: 'ryyyrryyyrryyryryyyrryyyrrryrrryryryyryrrr', turn: 'r' } // drawn, board full
  assert.equal(c4Status(won).winner, 'r')
  assert.equal(c4Status(full).draw, true)
  for (const level of LEVELS) {
    assert.equal(chooseConnect4Column(won, { level }), null)
    assert.equal(chooseConnect4Column(full, { level }), null)
    assert.equal(chooseConnect4Column({ cells: 'nonsense', turn: 'r' }, { level }), null)
    assert.equal(chooseConnect4Column(null, { level }), null)
  }
})

test('connect4: every level takes an immediate win; medium and hard block an immediate loss', () => {
  const wins = [
    [play([0, 0, 1, 1, 2, 6]), 3], // red: bottom row, columns 0-2
    [play([6, 0, 6, 1, 6, 2, 5]), 3], // yellow: bottom row 0-2; winning beats blocking red's column 6
    [play([0, 1, 0, 1, 0, 6]), 0], // red: three in column 0
    [play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6]), 3], // red: rising diagonal from column 0; yellow threatens column 4
  ]
  for (const [state, col] of wins) {
    assert.deepEqual(winningColumns(state), [col], state.cells) // the fixture is what it claims
    for (const level of LEVELS) assert.equal(chooseConnect4Column(state, { level, random: seeded(23) }), col, `${level}: ${state.cells}`)
  }
  const blocks = [
    [play([0, 6, 1, 6, 2]), 3], // yellow must stop red's bottom row
    [play([0, 6, 0, 6, 1, 6]), 6], // red must stop yellow's three in column 6
  ]
  for (const [state, col] of blocks) {
    assert.deepEqual(winningColumns(state), [], state.cells)
    for (const level of ['medium', 'hard']) assert.equal(chooseConnect4Column(state, { level, random: seeded(24) }), col, `${level}: ${state.cells}`)
  }
})

test('connect4: medium and hard never miss a win or a possible block (random positions)', () => {
  for (const state of randomConnect4Positions(40, 31)) {
    const wins = winningColumns(state)
    const safe = legalColumns(state).filter(col => !handsOverWin(state, col))
    for (const level of ['medium', 'hard']) {
      const col = chooseConnect4Column(state, { level, timeBudgetMs: 60, random: seeded(32) })
      if (wins.length) assert.ok(wins.includes(col), `${level} missed a win in ${state.cells}`)
      else if (safe.length) assert.ok(safe.includes(col), `${level} let the opponent win in ${state.cells}`)
    }
  }
})

test('connect4: medium and hard set up a double threat', () => {
  // Red has 2-3 on the bottom row: 4 makes an open three that cannot be stopped.
  const state = play([2, 0, 3, 6])
  for (const level of ['medium', 'hard']) {
    const info = {}
    assert.equal(chooseConnect4Column(state, { level, random: seeded(33), info }), 4, level)
    assert.ok(info.score > 90000, `${level} should see the forced win (score ${info.score})`)
  }
})

test('connect4: hard beats easy in a seeded match', () => {
  let hardWins = 0
  for (let game = 0; game < 6; game++) {
    const random = seeded(40 + game)
    const hardPlays = game % 2 === 0 ? 'r' : 'y' // alternate who starts
    let state = newGame()
    while (!c4Status(state).over) {
      const level = state.turn === hardPlays ? 'hard' : 'easy'
      const col = chooseConnect4Column(state, { level, random, timeBudgetMs: 60 })
      assert.ok(legalColumns(state).includes(col))
      state = drop(state, col)
    }
    if (c4Status(state).winner === hardPlays) hardWins++
  }
  assert.ok(hardWins >= 4, `hard won only ${hardWins} of 6`)
})
