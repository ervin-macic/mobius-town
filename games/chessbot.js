// Chess bot for Mobius Town: picks a move for the side to move (ES module, no dependencies).
//
//   chooseChessMove(state, { level, positions, timeBudgetMs, random, info }) -> UCI string | null
//
// `state` is a games/chess.js state. `positions` holds positionKey() strings of
// the game so far (the same array gameStatus() takes); the bot uses it to steer
// away from draws by repetition when it is ahead and towards them when it is
// behind. The returned move is always one of legalMoves(state); null means the
// side to move has no legal move. Pass an `info` object to receive search
// statistics ({ level, depth, nodes, score, ms }).
//
// Levels
//   easy    one ply plus a capture search, noisy scores, picks among the top
//           few moves, sometimes overlooks a capture or the opponent's replies.
//   medium  alpha-beta to depth 3 + capture-only quiescence search; material
//           and piece-square tables; MVV-LVA move ordering.
//   hard    iterative deepening of the same search until the time budget is
//           spent or the next iteration would not fit (about depth 5-9 in
//           500 ms on a desktop).
// medium and hard share a transposition table, killer/history move ordering
// and check extensions; mate scores count plies, so the fastest mate and the
// slowest defeat are preferred.
//
// Everything runs synchronously on the caller's thread, so the search watches
// the clock and returns the best move found so far once timeBudgetMs is spent.
//
// Below the root the search uses its own compact board (a 10x12 mailbox of
// small integers with make/unmake and Zobrist hashing): copying chess.js's
// plain-object states at every node would be far too slow. chess.js stays the
// source of truth at the root: only moves from legalMoves(state) are searched.

import { legalMoves, applyMove, positionKey } from './chess.js'

const now = typeof performance === 'object' && performance && typeof performance.now === 'function'
  ? () => performance.now()
  : () => Date.now()

// ---------------------------------------------------------------- board representation

// A piece is a small integer: the low 3 bits are the type, bit 3 is set for Black.
const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6
const WHITE = 0, BLACK = 8
const EMPTY = 0, OFF = 16 // OFF fills the border of the 10x12 mailbox around the 8x8 board
const PIECE_OF_LETTER = { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6, p: 9, n: 10, b: 11, r: 12, q: 13, k: 14 }
const PROMO_LETTER = ['', '', 'n', 'b', 'r', 'q'] // by piece type

// Mailbox squares: 21 = a8 ... 28 = h8, 91 = a1 ... 98 = h1. chess.js board index i
// (0 = a8, 63 = h1) maps to 21 + 10 * row + col; "up the board" is -10.
const SQ120 = new Int8Array(64)
const SQ_NAME = new Array(120).fill('')
const FILE_OF = new Int8Array(120)
const ROW_OF = new Int8Array(120) // 0 = rank 8 ... 7 = rank 1
for (let i = 0; i < 64; i++) {
  const sq = 21 + (i >> 3) * 10 + (i & 7)
  SQ120[i] = sq
  SQ_NAME[sq] = 'abcdefgh'[i & 7] + String(8 - (i >> 3))
  FILE_OF[sq] = i & 7
  ROW_OF[sq] = i >> 3
}

/** 'e3' -> mailbox square, 0 for anything else. */
function squareOf(name) {
  if (typeof name !== 'string' || name.length !== 2) return 0
  const f = 'abcdefgh'.indexOf(name[0]), r = '12345678'.indexOf(name[1])
  return f < 0 || r < 0 ? 0 : 21 + (7 - r) * 10 + f
}

const KNIGHT_STEPS = [-21, -19, -12, -8, 8, 12, 19, 21]
const BISHOP_DIRS = [-11, -9, 9, 11]
const ROOK_DIRS = [-10, -1, 1, 10]
const KING_STEPS = [-11, -10, -9, -1, 1, 9, 10, 11] // also the queen's directions

// A move is one integer: from | to << 7 | promotion type << 14 | flag << 17.
const FLAG_DOUBLE = 1, FLAG_EP = 2, FLAG_CASTLE = 3

// Castling rights are bits (K = 1, Q = 2, k = 4, q = 8). A move from or to one of
// these squares keeps only the rights in its mask (king/rook moved or rook taken).
const CASTLE_KEEP = new Int8Array(120).fill(15)
CASTLE_KEEP[95] = 12; CASTLE_KEEP[98] = 14; CASTLE_KEEP[91] = 13 // e1, h1, a1
CASTLE_KEEP[25] = 3; CASTLE_KEEP[28] = 11; CASTLE_KEEP[21] = 7 // e8, h8, a8

function moveUci(m) {
  return SQ_NAME[m & 127] + SQ_NAME[(m >> 7) & 127] + PROMO_LETTER[(m >> 14) & 7]
}

// ---------------------------------------------------------------- evaluation tables

const VALUE = [0, 100, 320, 330, 500, 900, 0]
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0] // 24 = all minor and major pieces on the board

// Piece-square tables from White's point of view, a8 first ("Simplified
// Evaluation Function" by T. Michniewski). Black uses the vertical mirror.
const PST_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
]
const PST_PAWN_END = [ // endgame: passed-pawn races matter more than the centre
  0, 0, 0, 0, 0, 0, 0, 0,
  90, 90, 90, 90, 90, 90, 90, 90,
  55, 55, 55, 55, 55, 55, 55, 55,
  30, 30, 30, 30, 30, 30, 30, 30,
  15, 15, 15, 15, 15, 15, 15, 15,
  5, 5, 5, 5, 5, 5, 5, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
]
const PST_KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
]
const PST_BISHOP = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
]
const PST_ROOK = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
]
const PST_QUEEN = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
]
const PST_KING = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
]
const PST_KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
]
const PST_MID = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, PST_KING]
const PST_END = [null, PST_PAWN_END, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, PST_KING_END]

// MG / EG [piece * 120 + square]: material + square bonus, positive for White
// pieces and negative for Black ones, so make/unmake can keep running totals.
const MG = new Int16Array(16 * 120)
const EG = new Int16Array(16 * 120)
for (let type = PAWN; type <= KING; type++) {
  for (let i = 0; i < 64; i++) {
    const sq = SQ120[i]
    MG[type * 120 + sq] = VALUE[type] + PST_MID[type][i]
    EG[type * 120 + sq] = VALUE[type] + PST_END[type][i]
    MG[(type | BLACK) * 120 + sq] = -(VALUE[type] + PST_MID[type][i ^ 56])
    EG[(type | BLACK) * 120 + sq] = -(VALUE[type] + PST_END[type][i ^ 56])
  }
}

// Distance from the centre (0..6), used to drive a lone king to the edge.
const CENTRE_DISTANCE = new Int8Array(120)
for (let i = 0; i < 64; i++) {
  const f = i & 7, r = i >> 3
  CENTRE_DISTANCE[SQ120[i]] = Math.max(3 - f, f - 4) + Math.max(3 - r, r - 4)
}

// ---------------------------------------------------------------- Zobrist keys

// Two independent 32-bit halves: lo picks the hash-table slot, hi verifies it.
let zobristSeed = 0x2545f491
function zobristRandom() {
  zobristSeed ^= zobristSeed << 13
  zobristSeed ^= zobristSeed >>> 17
  zobristSeed ^= zobristSeed << 5
  return zobristSeed | 0
}
const Z_PIECE_LO = new Int32Array(16 * 120), Z_PIECE_HI = new Int32Array(16 * 120)
for (let i = 0; i < 16 * 120; i++) { Z_PIECE_LO[i] = zobristRandom(); Z_PIECE_HI[i] = zobristRandom() }
const Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16)
for (let i = 1; i < 16; i++) { Z_CASTLE_LO[i] = zobristRandom(); Z_CASTLE_HI[i] = zobristRandom() }
const Z_EP_LO = new Int32Array(120), Z_EP_HI = new Int32Array(120)
for (let i = 0; i < 120; i++) { Z_EP_LO[i] = zobristRandom(); Z_EP_HI[i] = zobristRandom() }
const Z_SIDE_LO = zobristRandom(), Z_SIDE_HI = zobristRandom()

// ---------------------------------------------------------------- engine state
// Module-level scratch, reloaded by every call (the search is synchronous).

const MAX_PLY = 64
const STRIDE = 256 // move-list slots per ply
const board = new Int8Array(120)
const count = new Int32Array(16) // pieces on the board by piece code
const kingSq = new Int32Array(2) // [white king, black king]
let side = WHITE
let castle = 0
let ep = 0 // en-passant target square, 0 when none
let halfmove = 0
let mg = 0, eg = 0, phase = 0 // running evaluation totals (White minus Black)
let hp = 0 // current ply from the root; index into the stacks below
const hashLo = new Int32Array(MAX_PLY + 2), hashHi = new Int32Array(MAX_PLY + 2)
const undoMove = new Int32Array(MAX_PLY + 2)
const undoCaptured = new Int8Array(MAX_PLY + 2)
const undoCastle = new Int8Array(MAX_PLY + 2)
const undoEp = new Int8Array(MAX_PLY + 2)
const undoHalfmove = new Int32Array(MAX_PLY + 2)
const undoMg = new Int32Array(MAX_PLY + 2), undoEg = new Int32Array(MAX_PLY + 2), undoPhase = new Int32Array(MAX_PLY + 2)
const moveBuf = new Int32Array((MAX_PLY + 1) * STRIDE)
const scoreBuf = new Int32Array((MAX_PLY + 1) * STRIDE)

function loadState(state) {
  board.fill(OFF)
  count.fill(0)
  mg = eg = phase = 0
  let lo = 0, hi = 0
  for (let i = 0; i < 64; i++) {
    const sq = SQ120[i]
    const letter = state.board[i]
    const p = letter ? PIECE_OF_LETTER[letter] : EMPTY
    board[sq] = p
    if (p === EMPTY) continue
    count[p]++
    mg += MG[p * 120 + sq]
    eg += EG[p * 120 + sq]
    phase += PHASE_WEIGHT[p & 7]
    lo ^= Z_PIECE_LO[p * 120 + sq]
    hi ^= Z_PIECE_HI[p * 120 + sq]
    if ((p & 7) === KING) kingSq[p >> 3] = sq
  }
  side = state.turn === 'b' ? BLACK : WHITE
  if (side === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI }
  castle = 0
  const rights = state.castling || ''
  if (rights.includes('K')) castle |= 1
  if (rights.includes('Q')) castle |= 2
  if (rights.includes('k')) castle |= 4
  if (rights.includes('q')) castle |= 8
  lo ^= Z_CASTLE_LO[castle]
  hi ^= Z_CASTLE_HI[castle]
  // Keep the en-passant square only when the capture is legal, like positionKey().
  ep = 0
  const epSq = squareOf(state.ep)
  if (epSq && epCaptureLegal(epSq, side)) {
    ep = epSq
    lo ^= Z_EP_LO[ep]
    hi ^= Z_EP_HI[ep]
  }
  halfmove = Number.isFinite(state.halfmove) ? state.halfmove : 0
  hp = 0
  hashLo[0] = lo
  hashHi[0] = hi
}

/** Zobrist hash of a positionKey() string ('placement turn castling ep'), or null. */
function hashOfKey(key) {
  if (typeof key !== 'string') return null
  const [placement, turn, rights, epText] = key.split(' ')
  if (!placement || (turn !== 'w' && turn !== 'b')) return null
  let lo = 0, hi = 0, i = 0
  for (const ch of placement) {
    if (ch === '/') continue
    if (ch >= '1' && ch <= '8') { i += Number(ch); continue }
    const p = PIECE_OF_LETTER[ch]
    if (!p || i > 63) return null
    lo ^= Z_PIECE_LO[p * 120 + SQ120[i]]
    hi ^= Z_PIECE_HI[p * 120 + SQ120[i]]
    i++
  }
  if (turn === 'b') { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI }
  let bits = 0
  if (rights && rights.includes('K')) bits |= 1
  if (rights && rights.includes('Q')) bits |= 2
  if (rights && rights.includes('k')) bits |= 4
  if (rights && rights.includes('q')) bits |= 8
  lo ^= Z_CASTLE_LO[bits]
  hi ^= Z_CASTLE_HI[bits]
  const epSq = squareOf(epText)
  if (epSq) { lo ^= Z_EP_LO[epSq]; hi ^= Z_EP_HI[epSq] }
  return [lo, hi]
}

// Earlier positions of the game (from `positions`) in a small open-addressing set.
const HISTORY_SIZE = 1024
const historyLo = new Int32Array(HISTORY_SIZE), historyHi = new Int32Array(HISTORY_SIZE)
const historyUsed = new Uint8Array(HISTORY_SIZE)
let historyCount = 0

function loadHistory(positions, limit) {
  historyUsed.fill(0)
  historyCount = 0
  if (!Array.isArray(positions)) return
  // Only positions since the last capture or pawn move can come back.
  const first = Math.max(0, positions.length - 1 - Math.min(limit, HISTORY_SIZE / 2 - 1))
  for (let k = first; k < positions.length; k++) {
    const h = hashOfKey(positions[k])
    if (h === null) continue
    let slot = h[0] & (HISTORY_SIZE - 1)
    while (historyUsed[slot] && !(historyLo[slot] === h[0] && historyHi[slot] === h[1])) slot = (slot + 1) & (HISTORY_SIZE - 1)
    if (!historyUsed[slot]) { historyUsed[slot] = 1; historyLo[slot] = h[0]; historyHi[slot] = h[1]; historyCount++ }
  }
}

function inGameHistory(lo, hi) {
  if (historyCount === 0) return false
  let slot = lo & (HISTORY_SIZE - 1)
  while (historyUsed[slot]) {
    if (historyLo[slot] === lo && historyHi[slot] === hi) return true
    slot = (slot + 1) & (HISTORY_SIZE - 1)
  }
  return false
}

// ---------------------------------------------------------------- attacks and moves

/** True when mailbox square `sq` is attacked by colour `by` (WHITE or BLACK). */
function attacked(sq, by) {
  if (by === WHITE) {
    if (board[sq + 9] === PAWN || board[sq + 11] === PAWN) return true
  } else if (board[sq - 9] === (PAWN | BLACK) || board[sq - 11] === (PAWN | BLACK)) {
    return true
  }
  const knight = KNIGHT | by, king = KING | by
  for (let k = 0; k < 8; k++) {
    if (board[sq + KNIGHT_STEPS[k]] === knight || board[sq + KING_STEPS[k]] === king) return true
  }
  const bishop = BISHOP | by, rook = ROOK | by, queen = QUEEN | by
  for (let k = 0; k < 4; k++) {
    let dir = BISHOP_DIRS[k], t = sq + dir
    while (board[t] === EMPTY) t += dir
    if (board[t] === bishop || board[t] === queen) return true
    dir = ROOK_DIRS[k]
    t = sq + dir
    while (board[t] === EMPTY) t += dir
    if (board[t] === rook || board[t] === queen) return true
  }
  return false
}

/**
 * Can colour `by` legally capture en passant onto `epSq` right after the
 * opponent's double push? (Same rule as chess.js, so repetition keys match.)
 */
function epCaptureLegal(epSq, by) {
  const pawn = PAWN | by
  const victimSq = by === WHITE ? epSq + 10 : epSq - 10 // the pawn that just advanced two squares
  const victim = board[victimSq]
  for (let from = victimSq - 1; from <= victimSq + 1; from += 2) {
    if (board[from] !== pawn) continue
    board[from] = EMPTY
    board[victimSq] = EMPTY
    board[epSq] = pawn
    const safe = !attacked(kingSq[by >> 3], by ^ BLACK) // e.g. both pawns leaving a rank can expose the king
    board[from] = pawn
    board[victimSq] = victim
    board[epSq] = EMPTY
    if (safe) return true
  }
  return false
}

const sideInCheck = () => attacked(kingSq[side >> 3], side ^ BLACK)
// After makeMove(): did the side that just moved leave its own king in check?
const moverInCheck = () => attacked(kingSq[(side ^ BLACK) >> 3], side)

/**
 * Pseudo-legal moves for the side to move, written to moveBuf from `start`;
 * returns the end index. capturesOnly keeps captures and queen promotions.
 */
function generate(start, capturesOnly, inCheck) {
  let n = start
  const us = side, them = side ^ BLACK
  const forward = us === WHITE ? -10 : 10
  for (let i = 0; i < 64; i++) {
    const sq = SQ120[i]
    const p = board[sq]
    if (p === EMPTY || (p & BLACK) !== us) continue
    const type = p & 7
    if (type === PAWN) {
      const to = sq + forward
      const promoting = us === WHITE ? to < 30 : to > 90
      if (board[to] === EMPTY) {
        if (promoting) {
          moveBuf[n++] = sq | (to << 7) | (QUEEN << 14)
          if (!capturesOnly) {
            moveBuf[n++] = sq | (to << 7) | (ROOK << 14)
            moveBuf[n++] = sq | (to << 7) | (BISHOP << 14)
            moveBuf[n++] = sq | (to << 7) | (KNIGHT << 14)
          }
        } else if (!capturesOnly) {
          moveBuf[n++] = sq | (to << 7)
          if (ROW_OF[sq] === (us === WHITE ? 6 : 1) && board[to + forward] === EMPTY) {
            moveBuf[n++] = sq | ((to + forward) << 7) | (FLAG_DOUBLE << 17)
          }
        }
      }
      for (let c = to - 1; c <= to + 1; c += 2) {
        const t = board[c]
        if (t === EMPTY) {
          if (c === ep) moveBuf[n++] = sq | (c << 7) | (FLAG_EP << 17)
        } else if (t !== OFF && (t & BLACK) === them) {
          if (promoting) {
            moveBuf[n++] = sq | (c << 7) | (QUEEN << 14)
            if (!capturesOnly) {
              moveBuf[n++] = sq | (c << 7) | (ROOK << 14)
              moveBuf[n++] = sq | (c << 7) | (BISHOP << 14)
              moveBuf[n++] = sq | (c << 7) | (KNIGHT << 14)
            }
          } else {
            moveBuf[n++] = sq | (c << 7)
          }
        }
      }
    } else if (type === KNIGHT || type === KING) {
      const steps = type === KNIGHT ? KNIGHT_STEPS : KING_STEPS
      for (let k = 0; k < 8; k++) {
        const to = sq + steps[k], t = board[to]
        if (t === EMPTY) {
          if (!capturesOnly) moveBuf[n++] = sq | (to << 7)
        } else if (t !== OFF && (t & BLACK) === them) {
          moveBuf[n++] = sq | (to << 7)
        }
      }
    } else {
      const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_STEPS
      for (let k = 0; k < dirs.length; k++) {
        const dir = dirs[k]
        let to = sq + dir, t = board[to]
        while (t === EMPTY) {
          if (!capturesOnly) moveBuf[n++] = sq | (to << 7)
          to += dir
          t = board[to]
        }
        if (t !== OFF && (t & BLACK) === them) moveBuf[n++] = sq | (to << 7)
      }
    }
  }
  if (!capturesOnly && !inCheck && castle !== 0) {
    // The king may not pass through or land on an attacked square (landing is
    // re-checked by the caller's legality test anyway).
    if (us === WHITE) {
      if ((castle & 1) && board[96] === EMPTY && board[97] === EMPTY && board[95] === KING && board[98] === ROOK &&
          !attacked(96, BLACK) && !attacked(97, BLACK)) moveBuf[n++] = 95 | (97 << 7) | (FLAG_CASTLE << 17)
      if ((castle & 2) && board[94] === EMPTY && board[93] === EMPTY && board[92] === EMPTY && board[95] === KING &&
          board[91] === ROOK && !attacked(94, BLACK) && !attacked(93, BLACK)) moveBuf[n++] = 95 | (93 << 7) | (FLAG_CASTLE << 17)
    } else {
      if ((castle & 4) && board[26] === EMPTY && board[27] === EMPTY && board[25] === (KING | BLACK) &&
          board[28] === (ROOK | BLACK) && !attacked(26, WHITE) && !attacked(27, WHITE)) {
        moveBuf[n++] = 25 | (27 << 7) | (FLAG_CASTLE << 17)
      }
      if ((castle & 8) && board[24] === EMPTY && board[23] === EMPTY && board[22] === EMPTY && board[25] === (KING | BLACK) &&
          board[21] === (ROOK | BLACK) && !attacked(24, WHITE) && !attacked(23, WHITE)) {
        moveBuf[n++] = 25 | (23 << 7) | (FLAG_CASTLE << 17)
      }
    }
  }
  return n
}

function removePiece(sq, p) {
  board[sq] = EMPTY
  count[p]--
  mg -= MG[p * 120 + sq]
  eg -= EG[p * 120 + sq]
  phase -= PHASE_WEIGHT[p & 7]
  hashLo[hp + 1] ^= Z_PIECE_LO[p * 120 + sq]
  hashHi[hp + 1] ^= Z_PIECE_HI[p * 120 + sq]
}

function addPiece(sq, p) {
  board[sq] = p
  count[p]++
  mg += MG[p * 120 + sq]
  eg += EG[p * 120 + sq]
  phase += PHASE_WEIGHT[p & 7]
  hashLo[hp + 1] ^= Z_PIECE_LO[p * 120 + sq]
  hashHi[hp + 1] ^= Z_PIECE_HI[p * 120 + sq]
}

/** Play a pseudo-legal move (the caller tests legality with moverInCheck()). */
function makeMove(m) {
  const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >>> 17
  const us = side
  const piece = board[from]
  undoMove[hp] = m
  undoCastle[hp] = castle
  undoEp[hp] = ep
  undoHalfmove[hp] = halfmove
  undoMg[hp] = mg
  undoEg[hp] = eg
  undoPhase[hp] = phase
  hashLo[hp + 1] = hashLo[hp] ^ Z_SIDE_LO
  hashHi[hp + 1] = hashHi[hp] ^ Z_SIDE_HI

  const capturedSq = flag === FLAG_EP ? (us === WHITE ? to + 10 : to - 10) : to
  const captured = board[capturedSq]
  undoCaptured[hp] = captured
  if (captured !== EMPTY) removePiece(capturedSq, captured)
  removePiece(from, piece)
  addPiece(to, promo ? promo | us : piece)
  if (flag === FLAG_CASTLE) {
    const rookFrom = to === 97 ? 98 : to === 93 ? 91 : to === 27 ? 28 : 21
    const rookTo = to === 97 ? 96 : to === 93 ? 94 : to === 27 ? 26 : 24
    const rook = board[rookFrom]
    removePiece(rookFrom, rook)
    addPiece(rookTo, rook)
  }
  if ((piece & 7) === KING) kingSq[us >> 3] = to

  const rights = castle & CASTLE_KEEP[from] & CASTLE_KEEP[to]
  if (rights !== castle) {
    hashLo[hp + 1] ^= Z_CASTLE_LO[castle] ^ Z_CASTLE_LO[rights]
    hashHi[hp + 1] ^= Z_CASTLE_HI[castle] ^ Z_CASTLE_HI[rights]
    castle = rights
  }
  if (ep !== 0) {
    hashLo[hp + 1] ^= Z_EP_LO[ep]
    hashHi[hp + 1] ^= Z_EP_HI[ep]
    ep = 0
  }
  if (flag === FLAG_DOUBLE) {
    // Record the en-passant square only when the opponent can really capture
    // there (chess.js does the same, so repetition keys line up).
    const enemyPawn = PAWN | (us ^ BLACK)
    if ((board[to - 1] === enemyPawn || board[to + 1] === enemyPawn) && epCaptureLegal((from + to) >> 1, us ^ BLACK)) {
      ep = (from + to) >> 1
      hashLo[hp + 1] ^= Z_EP_LO[ep]
      hashHi[hp + 1] ^= Z_EP_HI[ep]
    }
  }
  halfmove = (piece & 7) === PAWN || captured !== EMPTY ? 0 : halfmove + 1
  side = us ^ BLACK
  hp++
}

function unmakeMove() {
  hp--
  const m = undoMove[hp]
  const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >>> 17
  side ^= BLACK
  const us = side
  const moved = board[to]
  const piece = promo ? PAWN | us : moved
  board[to] = EMPTY
  board[from] = piece
  if (promo) { count[moved]--; count[piece]++ }
  const captured = undoCaptured[hp]
  if (captured !== EMPTY) {
    board[flag === FLAG_EP ? (us === WHITE ? to + 10 : to - 10) : to] = captured
    count[captured]++
  }
  if (flag === FLAG_CASTLE) {
    const rookFrom = to === 97 ? 98 : to === 93 ? 91 : to === 27 ? 28 : 21
    const rookTo = to === 97 ? 96 : to === 93 ? 94 : to === 27 ? 26 : 24
    board[rookFrom] = board[rookTo]
    board[rookTo] = EMPTY
  }
  if ((piece & 7) === KING) kingSq[us >> 3] = from
  castle = undoCastle[hp]
  ep = undoEp[hp]
  halfmove = undoHalfmove[hp]
  mg = undoMg[hp]
  eg = undoEg[hp]
  phase = undoPhase[hp]
}

// ---------------------------------------------------------------- evaluation and draws

const TEMPO = 10
const BISHOP_PAIR = 30

/** Static score in centipawns from the side to move's point of view. */
function evaluate() {
  const ph = phase < 24 ? phase : 24
  let score = ((mg * ph + eg * (24 - ph)) / 24) | 0
  if (count[BISHOP] >= 2) score += BISHOP_PAIR
  if (count[BISHOP | BLACK] >= 2) score -= BISHOP_PAIR
  if (ph <= 8) score += mopUp()
  return (side === WHITE ? score : -score) + TEMPO
}

/**
 * Endgame help for the side that is well ahead against a pawnless defender:
 * push the lone king to the edge and bring the own king closer, so that
 * K+Q v K, K+R v K and similar wins get converted instead of shuffled.
 */
function mopUp() {
  const white = 100 * count[PAWN] + 320 * count[KNIGHT] + 330 * count[BISHOP] + 500 * count[ROOK] + 900 * count[QUEEN]
  const black = 100 * count[PAWN | BLACK] + 320 * count[KNIGHT | BLACK] + 330 * count[BISHOP | BLACK] +
    500 * count[ROOK | BLACK] + 900 * count[QUEEN | BLACK]
  const wk = kingSq[0], bk = kingSq[1]
  const kingDistance = Math.abs(FILE_OF[wk] - FILE_OF[bk]) + Math.abs(ROW_OF[wk] - ROW_OF[bk])
  if (white >= black + 400 && count[PAWN | BLACK] === 0) return 10 * CENTRE_DISTANCE[bk] + 4 * (14 - kingDistance)
  if (black >= white + 400 && count[PAWN] === 0) return -(10 * CENTRE_DISTANCE[wk] + 4 * (14 - kingDistance))
  return 0
}

/** Kings plus at most one minor piece, or only bishops all on one square colour. */
function insufficientMaterial() {
  if (count[PAWN] || count[PAWN | BLACK] || count[ROOK] || count[ROOK | BLACK] || count[QUEEN] || count[QUEEN | BLACK]) return false
  const knights = count[KNIGHT] + count[KNIGHT | BLACK]
  const bishops = count[BISHOP] + count[BISHOP | BLACK]
  if (knights + bishops <= 1) return true
  if (knights > 0) return false
  let light = 0, dark = 0
  for (let i = 0; i < 64; i++) {
    if ((board[SQ120[i]] & 7) === BISHOP) {
      if ((((i >> 3) + (i & 7)) & 1) === 0) light++
      else dark++
    }
  }
  return light === 0 || dark === 0
}

/** The position repeats one earlier in this search line or in the game. */
function isRepetition() {
  const lo = hashLo[hp], hi = hashHi[hp]
  const stop = Math.max(0, hp - halfmove)
  for (let i = hp - 2; i >= stop; i -= 2) {
    if (hashLo[i] === lo && hashHi[i] === hi) return true
  }
  return inGameHistory(lo, hi)
}

// ---------------------------------------------------------------- search

const INF = 32000
const MATE = 31000 // MATE - n: the side to move mates in n plies
const MATE_BOUND = 30000 // |score| above this is a forced mate
const CONTEMPT = 20 // a draw counts as slightly bad for the bot
const TIMEOUT = new Error('chessbot: time is up')

let nodes = 0
let deadline = Infinity
let rootSide = WHITE

// Transposition table, allocated on first use (about 3 MB).
const TT_BITS = 18
const TT_SIZE = 1 << TT_BITS
const TT_MASK = TT_SIZE - 1
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3
let ttKey = null, ttMove = null, ttScore = null, ttDepth = null, ttFlag = null

function resetTables() {
  if (ttKey === null) {
    ttKey = new Int32Array(TT_SIZE)
    ttMove = new Int32Array(TT_SIZE)
    ttScore = new Int16Array(TT_SIZE)
    ttDepth = new Int8Array(TT_SIZE)
    ttFlag = new Uint8Array(TT_SIZE)
  } else {
    ttFlag.fill(0)
  }
  killers.fill(0)
  historyScore.fill(0)
}

const killers = new Int32Array((MAX_PLY + 1) * 2)
const historyScore = new Int32Array(16 * 120) // quiet-move cutoffs by piece and target square

/** Draw score from the side to move's point of view (contempt favours playing on). */
const drawScore = () => (side === rootSide ? -CONTEMPT : CONTEMPT)

/** Order the move list: hash move, captures (MVV-LVA), promotions, killers, history. */
function scoreMoves(start, end, hashMove, ply) {
  const killer1 = killers[ply * 2], killer2 = killers[ply * 2 + 1]
  for (let i = start; i < end; i++) {
    const m = moveBuf[i]
    const from = m & 127, to = (m >> 7) & 127
    let s
    if (m === hashMove) {
      s = 1 << 30
    } else {
      const victim = (m >>> 17) === FLAG_EP ? PAWN : board[to] & 7
      if (victim !== 0) s = 1000000 + VALUE[victim] * 8 - (board[from] & 7)
      else if ((m >> 14) & 7) s = 900000 + ((m >> 14) & 7)
      else if (m === killer1) s = 800000
      else if (m === killer2) s = 790000
      else s = historyScore[board[from] * 120 + to]
    }
    scoreBuf[i] = s
  }
}

/** Selection step: swap the best-scored remaining move into slot i and return it. */
function pickMove(i, end) {
  let best = i
  for (let j = i + 1; j < end; j++) if (scoreBuf[j] > scoreBuf[best]) best = j
  if (best !== i) {
    const m = moveBuf[best], s = scoreBuf[best]
    moveBuf[best] = moveBuf[i]; scoreBuf[best] = scoreBuf[i]
    moveBuf[i] = m; scoreBuf[i] = s
  }
  return moveBuf[i]
}

/** Capture-only search so that leaf scores are not taken in the middle of an exchange. */
function quiesce(alpha, beta) {
  if ((++nodes & 1023) === 0 && now() > deadline) throw TIMEOUT
  const ply = hp
  if (ply >= MAX_PLY - 1) return evaluate()
  const inCheck = sideInCheck()
  let best
  if (inCheck) {
    best = -MATE + ply // every evasion is searched; none at all means mate
  } else {
    best = evaluate()
    if (best >= beta) return best
    if (best > alpha) alpha = best
  }
  const start = ply * STRIDE
  const end = generate(start, !inCheck, inCheck)
  scoreMoves(start, end, 0, ply)
  const standPat = best
  for (let i = start; i < end; i++) {
    const m = pickMove(i, end)
    if (!inCheck && !((m >> 14) & 7)) {
      // Delta pruning: even winning this piece cannot lift the score to alpha.
      const victim = (m >>> 17) === FLAG_EP ? PAWN : board[(m >> 7) & 127] & 7
      if (standPat + VALUE[victim] + 200 < alpha) continue
    }
    makeMove(m)
    if (moverInCheck()) { unmakeMove(); continue }
    const score = -quiesce(-beta, -alpha)
    unmakeMove()
    if (score > best) {
      best = score
      if (score > alpha) {
        alpha = score
        if (score >= beta) break
      }
    }
  }
  return best
}

/** Principal-variation alpha-beta search; scores are from the side to move's view. */
function search(depth, alpha, beta, inCheck) {
  const ply = hp
  if (ply > 0) {
    if (isRepetition() || insufficientMaterial() || (halfmove >= 100 && !inCheck)) return drawScore()
    // Mate-distance pruning: no line from here can beat a mate already found nearer the root.
    if (alpha < -MATE + ply) { alpha = -MATE + ply; if (alpha >= beta) return alpha }
    if (beta > MATE - ply - 1) { beta = MATE - ply - 1; if (alpha >= beta) return beta }
  }
  if (inCheck) depth++ // check extension: never stop the search in the middle of a check
  if (depth <= 0 || ply >= MAX_PLY - 2) return quiesce(alpha, beta)
  if ((++nodes & 1023) === 0 && now() > deadline) throw TIMEOUT

  const slot = hashLo[hp] & TT_MASK, key = hashHi[hp]
  let hashMove = 0
  if (ttFlag[slot] !== 0 && ttKey[slot] === key) {
    hashMove = ttMove[slot]
    if (ttDepth[slot] >= depth) {
      let s = ttScore[slot]
      if (s > MATE_BOUND) s -= ply
      else if (s < -MATE_BOUND) s += ply
      const f = ttFlag[slot]
      if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s
    }
  }

  const start = ply * STRIDE
  const end = generate(start, false, inCheck)
  scoreMoves(start, end, hashMove, ply)
  const alphaStart = alpha
  let best = -INF, bestMove = 0, legal = 0
  for (let i = start; i < end; i++) {
    const m = pickMove(i, end)
    makeMove(m)
    if (moverInCheck()) { unmakeMove(); continue }
    legal++
    const givesCheck = sideInCheck()
    let score
    if (legal === 1) {
      score = -search(depth - 1, -beta, -alpha, givesCheck)
    } else {
      score = -search(depth - 1, -alpha - 1, -alpha, givesCheck)
      if (score > alpha && score < beta) score = -search(depth - 1, -beta, -alpha, givesCheck)
    }
    unmakeMove()
    if (score > best) {
      best = score
      bestMove = m
      if (score > alpha) {
        alpha = score
        if (score >= beta) {
          const to = (m >> 7) & 127
          if (board[to] === EMPTY && !((m >> 14) & 7) && (m >>> 17) !== FLAG_EP) { // quiet move
            if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m }
            const h = board[m & 127] * 120 + to
            historyScore[h] += depth * depth
            if (historyScore[h] > 500000) for (let k = 0; k < historyScore.length; k++) historyScore[k] >>= 1
          }
          break
        }
      }
    }
  }
  if (legal === 0) return inCheck ? -MATE + ply : drawScore()
  if (halfmove >= 100) return drawScore() // in check but not mated: still a fifty-move draw

  let stored = best
  if (stored > MATE_BOUND) stored += ply
  else if (stored < -MATE_BOUND) stored -= ply
  ttKey[slot] = key
  ttMove[slot] = bestMove
  ttScore[slot] = stored
  ttDepth[slot] = depth
  ttFlag[slot] = best <= alphaStart ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT
  return best
}

// ---------------------------------------------------------------- root

/**
 * Legal root moves as internal integers, in legalMoves() order, with flags for
 * moves that return to a position the game has already seen.
 */
function rootMoves(state, legal, positions) {
  const end = generate(0, false, sideInCheck())
  const byUci = new Map()
  for (let i = 0; i < end; i++) {
    const m = moveBuf[i]
    makeMove(m)
    const ok = !moverInCheck()
    unmakeMove()
    if (ok) byUci.set(moveUci(m), m)
  }
  const seen = new Map()
  if (Array.isArray(positions)) for (const k of positions) seen.set(k, (seen.get(k) || 0) + 1)
  const moves = []
  for (const uci of legal) {
    const m = byUci.get(uci)
    if (m === undefined) continue // never expected: the generators agree (see tests)
    // Exact repetition check with chess.js keys: a position seen twice before
    // would end the game by threefold repetition; seen once is a repetition too.
    // Captures and pawn moves can never recreate an earlier position.
    const from = m & 127, to = (m >> 7) & 127
    const reversible = board[to] === EMPTY && (board[from] & 7) !== PAWN
    let repeats = false
    if (seen.size && reversible) {
      const next = applyMove(state, uci)
      repeats = next !== null && seen.has(positionKey(next))
    }
    moves.push({ m, repeats, score: 0, order: 0 })
  }
  return moves
}

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const t = list[i]; list[i] = list[j]; list[j] = t
  }
}

/** Initial root order: captures by MVV-LVA, promotions, then piece-square gain. */
function rootOrder(m) {
  const from = m & 127, to = (m >> 7) & 127
  const piece = board[from]
  const victim = (m >>> 17) === FLAG_EP ? PAWN : board[to] & 7
  if (victim) return 1000000 + VALUE[victim] * 8 - (piece & 7)
  if ((m >> 14) & 7) return 900000
  const gain = MG[piece * 120 + to] - MG[piece * 120 + from]
  return side === WHITE ? gain : -gain
}

// Each extra ply costs roughly 3-7x the previous iteration (4x on average).
const ITERATION_GROWTH = 4

/** Iterative-deepening alpha-beta over the root moves, until maxDepth or the deadline. */
function think(moves, maxDepth, started, info) {
  let bestMove = moves[0].m, bestScore = -INF
  let iterationStart = started
  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterationMove = 0, iterationScore = -INF
    try {
      let alpha = -INF
      for (let k = 0; k < moves.length; k++) {
        const entry = moves[k]
        let score
        if (entry.repeats) {
          score = drawScore()
        } else {
          makeMove(entry.m)
          const check = sideInCheck()
          if (k === 0) {
            score = -search(depth - 1, -INF, -alpha, check)
          } else {
            score = -search(depth - 1, -alpha - 1, -alpha, check)
            if (score > alpha) score = -search(depth - 1, -INF, -alpha, check)
          }
          unmakeMove()
        }
        entry.score = score
        if (k === 0 || score > iterationScore) {
          iterationScore = score
          iterationMove = entry.m
          if (score > alpha) alpha = score
        }
      }
    } catch (error) {
      if (error !== TIMEOUT) throw error
      // The previous best is searched first, so iterationMove is either that
      // move or one that beat it at this greater depth: both are trustworthy.
      if (iterationMove !== 0) bestMove = iterationMove
      break
    }
    bestMove = iterationMove
    bestScore = iterationScore
    if (info) info.depth = depth
    // Best first, then by score (scores of non-best moves are upper bounds).
    moves.sort((a, b) => (b.m === bestMove) - (a.m === bestMove) || b.score - a.score)
    if (Math.abs(bestScore) > MATE_BOUND) break // the shortest mate (or longest defence) is found
    // Do not start an iteration that would most likely be cut off by the deadline.
    const finished = now()
    if (finished + (finished - iterationStart) * ITERATION_GROWTH > deadline) break
    iterationStart = finished
  }
  if (info && bestScore > -INF) info.score = bestScore
  return bestMove
}

/** Beginner level: one ply plus captures, with noise and deliberate blind spots. */
function thinkEasy(moves, random) {
  const careless = random() < 0.3 // this move the bot ignores the opponent's captures
  const candidates = []
  for (const entry of moves) {
    const m = entry.m
    const capture = board[(m >> 7) & 127] !== EMPTY || (m >>> 17) === FLAG_EP
    let score
    if (entry.repeats) {
      score = drawScore()
    } else {
      makeMove(m)
      if (hasNoLegalMove()) score = sideInCheck() ? MATE - 1 : -drawScore()
      else score = careless ? -evaluate() : -quiesce(-INF, INF)
      unmakeMove()
    }
    if (score > MATE_BOUND) return m // mate in one is never missed
    if (capture && random() < 0.25) continue // overlooked this capture
    candidates.push({ m, score: score + Math.round((random() * 2 - 1) * 40) })
  }
  if (candidates.length === 0) return moves[Math.floor(random() * moves.length)].m
  candidates.sort((a, b) => b.score - a.score)
  // Mostly the best-looking move, sometimes the second or third if it looks close.
  const r = random()
  let pick = r < 0.6 ? 0 : r < 0.85 ? 1 : 2
  while (pick > 0 && (pick >= candidates.length || candidates[pick].score < candidates[0].score - 120)) pick--
  return candidates[pick].m
}

function hasNoLegalMove() {
  const start = hp * STRIDE
  const end = generate(start, false, sideInCheck())
  for (let i = start; i < end; i++) {
    makeMove(moveBuf[i])
    const illegal = moverInCheck()
    unmakeMove()
    if (!illegal) return false
  }
  return true
}

// ---------------------------------------------------------------- public API

const LEVELS = {
  easy: { maxDepth: 0 }, // one ply + captures, see thinkEasy()
  medium: { maxDepth: 3 },
  hard: { maxDepth: MAX_PLY - 8 }, // in practice limited by the time budget
}

/**
 * Choose a move for the side to move in `state` (a games/chess.js state).
 * Returns a UCI string from legalMoves(state), or null when there is none.
 */
export function chooseChessMove(state, { level = 'medium', positions = [], timeBudgetMs = 500, random = Math.random, info = null } = {}) {
  const started = now()
  let legal
  try {
    legal = legalMoves(state)
  } catch {
    return null // not a chess.js state
  }
  if (legal.length === 0) return null
  const settings = LEVELS[level] || LEVELS.medium
  const budget = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0 ? timeBudgetMs : 500
  if (typeof random !== 'function') random = Math.random
  if (info) Object.assign(info, { level: LEVELS[level] ? level : 'medium', depth: 0, nodes: 0, score: 0, ms: 0 })
  if (legal.length === 1) {
    if (info) info.ms = now() - started
    return legal[0]
  }

  loadState(state)
  loadHistory(positions, halfmove)
  rootSide = side
  nodes = 0
  deadline = started + budget
  const moves = rootMoves(state, legal, positions)
  if (moves.length === 0) return legal[Math.floor(random() * legal.length)] // generator disagreement (never expected)

  shuffle(moves, random) // equal moves are then tried in a random order
  for (const entry of moves) entry.order = rootOrder(entry.m)
  moves.sort((a, b) => b.order - a.order)

  let best
  if (settings.maxDepth === 0) {
    try {
      best = thinkEasy(moves, random)
    } catch (error) {
      if (error !== TIMEOUT) throw error
      best = moves[0].m
    }
  } else {
    resetTables()
    best = think(moves, settings.maxDepth, started, info)
  }
  if (info) { info.nodes = nodes; info.ms = now() - started }
  const uci = moveUci(best)
  return legal.includes(uci) ? uci : legal[0]
}

/** Leaf count of the internal move generator (a test hook; must match chess.js perft). */
export function perft(state, depth) {
  loadState(state)
  return depth > 0 ? perftFrom(depth) : 1
}

function perftFrom(depth) {
  const start = hp * STRIDE
  const end = generate(start, false, sideInCheck())
  let total = 0
  for (let i = start; i < end; i++) {
    makeMove(moveBuf[i])
    if (!moverInCheck()) total += depth === 1 ? 1 : perftFrom(depth - 1)
    unmakeMove()
  }
  return total
}
