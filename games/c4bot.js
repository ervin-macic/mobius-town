// Connect Four bot for Mobius Town (ES module, no dependencies).
//
//   chooseConnect4Column(state, { level, random, timeBudgetMs, info }) -> column 0..6 | null
//
// `state` is a games/connect4.js state. Returns a column from
// legalColumns(state), or null when the game is over or no column is free.
// Pass an `info` object to receive search statistics ({ level, depth, nodes, score, ms }).
//
// Levels
//   easy    takes an immediate win, blocks the opponent's immediate win only
//           some of the time, otherwise plays a centre-weighted random column.
//   medium  negamax alpha-beta to depth 5 with a "lines of four" heuristic;
//           picks at random among equally scored best columns.
//   hard    iterative-deepening alpha-beta within the time budget (centre-first
//           ordering, transposition table, forced-move extensions).
//
// The search keeps, for each of the 69 lines of four, how many discs each
// player has in it. Placing a disc updates only the lines through that cell,
// which gives the evaluation and the "does this drop win?" test for free.

import { COLS, ROWS, legalColumns } from './connect4.js'

const now = typeof performance === 'object' && performance && typeof performance.now === 'function'
  ? () => performance.now()
  : () => Date.now()

const CELLS = COLS * ROWS
const RED = 1, YELLOW = 2

// ---------------------------------------------------------------- lines of four

const LINES = [] // each line: 4 cell indices (cells are row * COLS + col, row 0 on top)
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    for (const [dCol, dRow] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const endCol = col + 3 * dCol, endRow = row + 3 * dRow
      if (endCol < 0 || endCol >= COLS || endRow < 0 || endRow >= ROWS) continue
      LINES.push([0, 1, 2, 3].map(k => (row + k * dRow) * COLS + col + k * dCol))
    }
  }
}

// Lines through each cell, as one flat list: LINES_OF[LINES_START[c] .. LINES_START[c + 1]).
const LINES_START = new Int32Array(CELLS + 1)
const LINES_OF = new Int32Array(LINES.length * 4)
{
  let n = 0
  for (let cell = 0; cell < CELLS; cell++) {
    LINES_START[cell] = n
    LINES.forEach((line, index) => { if (line.includes(cell)) LINES_OF[n++] = index })
  }
  LINES_START[CELLS] = n
}

// Value of a line holding r red and y yellow discs, from Red's point of view:
// only lines still open to one player count. Four in a line is a win and is
// detected separately.
const LINE_VALUE = [0, 1, 5, 40, 0]
const VALUE_OF = new Int32Array(25) // [r * 5 + y]
for (let r = 0; r <= 4; r++) {
  for (let y = 0; y <= 4; y++) VALUE_OF[r * 5 + y] = r > 0 && y > 0 ? 0 : r > 0 ? LINE_VALUE[r] : -LINE_VALUE[y]
}

const CENTRE_FIRST = [3, 2, 4, 1, 5, 0, 6]
const CENTRE_WEIGHT = [1, 2, 3, 4, 3, 2, 1]

// Zobrist keys per (cell, player): lo picks the hash-table slot, hi verifies it.
let zobristSeed = 0x6d2b79f5
function zobristRandom() {
  zobristSeed ^= zobristSeed << 13
  zobristSeed ^= zobristSeed >>> 17
  zobristSeed ^= zobristSeed << 5
  return zobristSeed | 0
}
const Z_LO = new Int32Array(CELLS * 2), Z_HI = new Int32Array(CELLS * 2)
for (let i = 0; i < CELLS * 2; i++) { Z_LO[i] = zobristRandom(); Z_HI[i] = zobristRandom() }

// ---------------------------------------------------------------- position (module scratch)

const heights = new Int8Array(COLS) // discs per column
const lineCount = new Int8Array(LINES.length * 2) // [red, yellow] discs in each line
let toMove = RED
let filled = 0
let lineScore = 0 // sum of VALUE_OF over all lines, Red minus Yellow
let hashLo = 0, hashHi = 0

function loadState(state) {
  heights.fill(0)
  lineCount.fill(0)
  filled = 0
  lineScore = 0
  hashLo = hashHi = 0
  // Replay the discs bottom-up so each one lands where the state has it.
  toMove = RED
  for (let row = ROWS - 1; row >= 0; row--) {
    for (let col = 0; col < COLS; col++) {
      const cell = state.cells[row * COLS + col]
      if (cell === '.') continue
      toMove = cell === 'r' ? RED : YELLOW
      place(col)
    }
  }
  toMove = state.turn === 'y' ? YELLOW : RED
}

/** Drop a disc for the side to move into `col` (which must have room). */
function place(col) {
  const off = toMove - 1
  const cell = (ROWS - 1 - heights[col]) * COLS + col
  heights[col]++
  filled++
  hashLo ^= Z_LO[cell * 2 + off]
  hashHi ^= Z_HI[cell * 2 + off]
  for (let k = LINES_START[cell]; k < LINES_START[cell + 1]; k++) {
    const i = LINES_OF[k] * 2
    const before = VALUE_OF[lineCount[i] * 5 + lineCount[i + 1]]
    lineCount[i + off]++
    lineScore += VALUE_OF[lineCount[i] * 5 + lineCount[i + 1]] - before
  }
  toMove = 3 - toMove
}

function unplace(col) {
  toMove = 3 - toMove
  const off = toMove - 1
  heights[col]--
  filled--
  const cell = (ROWS - 1 - heights[col]) * COLS + col
  hashLo ^= Z_LO[cell * 2 + off]
  hashHi ^= Z_HI[cell * 2 + off]
  for (let k = LINES_START[cell]; k < LINES_START[cell + 1]; k++) {
    const i = LINES_OF[k] * 2
    const before = VALUE_OF[lineCount[i] * 5 + lineCount[i + 1]]
    lineCount[i + off]--
    lineScore += VALUE_OF[lineCount[i] * 5 + lineCount[i + 1]] - before
  }
}

/** Would a disc of `player` dropped in `col` complete four? (No state change.) */
function winsAt(col, player) {
  if (heights[col] >= ROWS) return false
  const cell = (ROWS - 1 - heights[col]) * COLS + col
  const off = player - 1
  // The cell is empty, so a line through it with 3 of the player's discs is completed by it.
  for (let k = LINES_START[cell]; k < LINES_START[cell + 1]; k++) {
    if (lineCount[LINES_OF[k] * 2 + off] === 3) return true
  }
  return false
}

// ---------------------------------------------------------------- search

const INF = 1000000
const WIN = 100000 // WIN - n: the side to move connects four on its n-th ply from the root
const WIN_BOUND = 90000
const TIMEOUT = new Error('c4bot: time is up')

let nodes = 0
let deadline = Infinity

const TT_SIZE = 1 << 18
const TT_MASK = TT_SIZE - 1
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3
let ttKey = null, ttScore = null, ttDepth = null, ttFlag = null, ttMove = null

function resetTable() {
  if (ttKey === null) {
    ttKey = new Int32Array(TT_SIZE)
    ttScore = new Int32Array(TT_SIZE)
    ttDepth = new Int8Array(TT_SIZE)
    ttFlag = new Uint8Array(TT_SIZE)
    ttMove = new Int8Array(TT_SIZE)
  } else {
    ttFlag.fill(0)
  }
}

/** Negamax alpha-beta; scores are from the side to move's point of view. */
function negamax(depth, alpha, beta, ply) {
  if ((++nodes & 1023) === 0 && now() > deadline) throw TIMEOUT
  if (filled === CELLS) return 0 // full board: draw
  const me = toMove, opponent = 3 - me
  for (let col = 0; col < COLS; col++) if (winsAt(col, me)) return WIN - ply
  // An opponent threat must be blocked at once; two threats cannot both be blocked.
  let forced = -1
  for (let col = 0; col < COLS; col++) {
    if (winsAt(col, opponent)) {
      if (forced >= 0) return -(WIN - ply - 1)
      forced = col
    }
  }
  if (forced >= 0) { // a forced reply costs no depth
    place(forced)
    const score = -negamax(depth, -beta, -alpha, ply + 1)
    unplace(forced)
    return score
  }
  if (depth <= 0) return me === RED ? lineScore : -lineScore

  const slot = hashLo & TT_MASK
  let hashMove = -1
  if (ttFlag[slot] !== 0 && ttKey[slot] === hashHi) {
    hashMove = ttMove[slot]
    if (ttDepth[slot] >= depth) {
      let s = ttScore[slot]
      if (s > WIN_BOUND) s -= ply
      else if (s < -WIN_BOUND) s += ply
      const f = ttFlag[slot]
      if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s
    }
  }

  const alphaStart = alpha
  let best = -INF, bestCol = -1
  for (let i = -1; i < COLS; i++) {
    const col = i < 0 ? hashMove : CENTRE_FIRST[i]
    if (col < 0 || (i >= 0 && col === hashMove) || heights[col] >= ROWS) continue
    place(col)
    const score = -negamax(depth - 1, -beta, -alpha, ply + 1)
    unplace(col)
    if (score > best) {
      best = score
      bestCol = col
      if (score > alpha) {
        alpha = score
        if (alpha >= beta) break
      }
    }
  }

  let stored = best
  if (stored > WIN_BOUND) stored += ply
  else if (stored < -WIN_BOUND) stored -= ply
  ttKey[slot] = hashHi
  ttScore[slot] = stored
  ttDepth[slot] = depth
  ttFlag[slot] = best <= alphaStart ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT
  ttMove[slot] = bestCol
  return best
}

/**
 * Score every root column at `depth`. Columns after the first are searched with
 * the window (best - 1, INF), so a column that ties the best gets an exact score.
 */
function scoreRoot(columns, depth) {
  const scores = []
  let alpha = -INF
  for (const col of columns) {
    place(col)
    const score = -negamax(depth - 1, -INF, -(alpha - 1), 1)
    unplace(col)
    scores.push(score)
    if (score > alpha) alpha = score
  }
  return scores
}

// Each extra ply costs a small multiple of the previous iteration.
const ITERATION_GROWTH = 3

/** Iterative deepening up to maxDepth; returns the columns tied for best at the last finished depth. */
function think(columns, maxDepth, started, info) {
  let order = columns.slice()
  let bestColumns = [order[0]], bestScore = 0
  let iterationStart = started
  const limit = Math.min(maxDepth, CELLS - filled)
  for (let depth = 1; depth <= limit; depth++) {
    let scores
    try {
      scores = scoreRoot(order, depth)
    } catch (error) {
      if (error !== TIMEOUT) throw error
      break
    }
    bestScore = Math.max(...scores)
    bestColumns = order.filter((_, i) => scores[i] === bestScore)
    if (info) { info.depth = depth; info.score = bestScore }
    // Next iteration: best columns first (stable, so centre-first among equals).
    const ranked = order.map((col, i) => ({ col, score: scores[i] }))
    ranked.sort((a, b) => b.score - a.score)
    order = ranked.map(entry => entry.col)
    if (Math.abs(bestScore) > WIN_BOUND) break // forced result found: the fastest win or slowest loss
    // Do not start an iteration that would most likely be cut off by the deadline.
    const finished = now()
    if (finished + (finished - iterationStart) * ITERATION_GROWTH > deadline) break
    iterationStart = finished
  }
  return bestColumns
}

function weightedPick(columns, random) {
  let total = 0
  for (const col of columns) total += CENTRE_WEIGHT[col]
  let r = random() * total
  for (const col of columns) {
    r -= CENTRE_WEIGHT[col]
    if (r < 0) return col
  }
  return columns[columns.length - 1]
}

// ---------------------------------------------------------------- public API

const LEVELS = {
  easy: { maxDepth: 0 }, // no search, see chooseConnect4Column()
  medium: { maxDepth: 5 },
  hard: { maxDepth: CELLS }, // in practice limited by the time budget
}

/**
 * Choose a column (0..6) for the side to move in `state` (a games/connect4.js
 * state), or null when the game is over or the state is invalid.
 */
export function chooseConnect4Column(state, { level = 'medium', random = Math.random, timeBudgetMs = 300, info = null } = {}) {
  const started = now()
  let columns
  try {
    columns = legalColumns(state)
  } catch {
    return null
  }
  if (columns.length === 0) return null
  const settings = LEVELS[level] || LEVELS.medium
  const budget = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0 ? timeBudgetMs : 300
  if (typeof random !== 'function') random = Math.random
  if (info) Object.assign(info, { level: LEVELS[level] ? level : 'medium', depth: 0, nodes: 0, score: 0, ms: 0 })
  const finish = col => {
    if (info) { info.nodes = nodes; info.ms = now() - started }
    return col
  }
  nodes = 0
  if (columns.length === 1) return finish(columns[0])

  loadState(state)
  const me = toMove, opponent = 3 - me
  const winning = columns.find(col => winsAt(col, me))
  if (winning !== undefined) return finish(winning)
  const blocks = columns.filter(col => winsAt(col, opponent))

  if (settings.maxDepth === 0) { // easy
    if (blocks.length && random() < 0.6) return finish(blocks[Math.floor(random() * blocks.length)])
    return finish(weightedPick(columns, random))
  }
  if (blocks.length === 1) return finish(blocks[0]) // the only move that does not lose at once

  deadline = started + budget
  resetTable()
  const ordered = CENTRE_FIRST.filter(col => columns.includes(col))
  const best = think(ordered, settings.maxDepth, started, info)
  return finish(best[Math.floor(random() * best.length)])
}
