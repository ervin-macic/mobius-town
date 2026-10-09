// Connect Four rules: pure functions on plain data, no dependencies (ES module).
//
// Browser twin of connect4_rules.py (the authoritative server copy); the two must
// stay behaviourally identical (tests/rules.test.mjs replays
// tests/fixtures/connect4_crosscheck.json, recorded from the Python engine).
//
// State (a plain object; treat it as immutable):
//   cells  42-character string, row-major starting from the TOP row:
//          cells[row * 7 + col], '.' empty, 'r' red, 'y' yellow
//   turn   'r' | 'y' (red moves first)
//
// A state is valid when cells only holds '.', 'r', 'y', no disc floats above an
// empty cell, and the disc counts match the side to move (red count == yellow
// count when red is to move, one more red disc when yellow is to move).

export const COLS = 7
export const ROWS = 6

// Scan directions as [dCol, dRow], rows counted from the top: horizontal,
// vertical (downwards), diagonal down-right, diagonal up-right. Every direction
// moves rightwards or straight down, so a reported line is ordered by column
// (top to bottom for vertical lines).
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]]

/** Empty board, red to move. */
export function newGame() {
  return { cells: '.'.repeat(COLS * ROWS), turn: 'r' }
}

function isValid(state) {
  if (state === null || typeof state !== 'object') return false
  const { cells, turn } = state
  if (typeof cells !== 'string' || cells.length !== COLS * ROWS || (turn !== 'r' && turn !== 'y')) return false
  let reds = 0, yellows = 0
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    if (cell === 'r') reds++
    else if (cell === 'y') yellows++
    else if (cell !== '.') return false
    if (cell !== '.' && i + COLS < COLS * ROWS && cells[i + COLS] === '.') return false // a disc cannot float above an empty cell
  }
  return reds - yellows === (turn === 'r' ? 0 : 1)
}

/** Normalise a column argument: an integer 0..6, or null. */
function column(col) {
  return Number.isInteger(col) && col >= 0 && col < COLS ? col : null
}

/**
 * { over, winner, draw, line }; line is the 4 winning [col, row] cells.
 * Throws for a malformed state. If several four-in-a-rows exist the first one
 * found scanning rows top to bottom, columns left to right, then
 * horizontal / vertical / down-right / up-right is reported.
 */
export function status(state) {
  if (!isValid(state)) throw new Error('Invalid Connect Four state')
  const { cells } = state
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const disc = cells[row * COLS + col]
      if (disc === '.') continue
      for (const [dCol, dRow] of DIRECTIONS) {
        const endCol = col + 3 * dCol, endRow = row + 3 * dRow
        if (endCol < 0 || endCol >= COLS || endRow < 0 || endRow >= ROWS) continue
        let k = 1
        while (k < 4 && cells[(row + k * dRow) * COLS + col + k * dCol] === disc) k++
        if (k === 4) {
          const line = [0, 1, 2, 3].map(j => [col + j * dCol, row + j * dRow])
          return { over: true, winner: disc, draw: false, line }
        }
      }
    }
  }
  const full = !cells.includes('.')
  return { over: full, winner: null, draw: full, line: null }
}

/** Columns (0..6) with room, ascending; empty when the game is over or the state is invalid. */
export function legalColumns(state) {
  if (!isValid(state) || status(state).over) return []
  const cols = []
  for (let col = 0; col < COLS; col++) if (state.cells[col] === '.') cols.push(col)
  return cols
}

/**
 * New state with the side to move's disc dropped in `col` and the turn switched.
 * Returns null for a full column, a finished game, or bad input.
 */
export function drop(state, col) {
  col = column(col)
  if (col === null || !isValid(state) || state.cells[col] !== '.' || status(state).over) return null
  const { cells, turn } = state
  for (let row = ROWS - 1; row >= 0; row--) { // the lowest empty cell of the column
    const i = row * COLS + col
    if (cells[i] === '.') {
      return { cells: cells.slice(0, i) + turn + cells.slice(i + 1), turn: turn === 'r' ? 'y' : 'r' }
    }
  }
  return null // unreachable: the top cell was empty
}
