// Chess rules engine: pure functions on plain data, no dependencies (ES module).
//
// Browser twin of chess_rules.py (the authoritative server copy). The two must
// stay behaviourally identical: tests/rules.test.mjs replays games recorded
// from the Python engine (tests/fixtures/chess_crosscheck.json) through this one.
//
// State is a plain, JSON-serialisable object. Treat it as immutable; every
// function returns new data and never mutates its arguments.
//   board     array of 64 entries; index 0 = a8, 7 = h8, 56 = a1, 63 = h1.
//             Each entry is a FEN piece letter ('P', 'n', ...) or null.
//   turn      'w' | 'b' (side to move)
//   castling  remaining castling rights: a subset of 'KQkq' in that order, '' if none
//   ep        en-passant target square such as 'e3', or null
//   halfmove  plies since the last capture or pawn move (fifty-move rule)
//   fullmove  move number, starting at 1 and incremented after Black moves
//
// Moves are UCI strings: 'e2e4', 'e1g1' (castling is written as the king move),
// 'e7e8q' (promotion piece in q, r, b, n).
//
// En passant convention: after a double pawn push the ep square is recorded only
// when the opponent really has a legal en-passant capture. That keeps generated
// FENs canonical and makes positionKey() -- the repetition key -- follow FIDE's
// "same possible moves" rule. A FEN parsed from elsewhere keeps its ep field
// verbatim so FEN strings round-trip, and positionKey() still normalises it.
//
// legalMoves()/applyMove() implement the movement rules only. Draws by rule
// (fifty-move, threefold, insufficient material) are reported by gameStatus();
// callers should stop accepting moves once gameStatus(...).over is true.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const FILES = 'abcdefgh'
const RANKS = '12345678'
const SQUARES = Array.from({ length: 64 }, (_, i) => FILES[i % 8] + String(8 - Math.floor(i / 8))) // index -> 'a8' ... 'h1'

const COLOR = {
  P: 'w', N: 'w', B: 'w', R: 'w', Q: 'w', K: 'w',
  p: 'b', n: 'b', b: 'b', r: 'b', q: 'b', k: 'b',
}

// 10x12 mailbox: every board index has a padded twin, and stepping from a padded
// index lands on -1 when it leaves the board. One lookup replaces edge checks.
const MAILBOX = new Array(120).fill(-1)
const MAILBOX64 = new Array(64).fill(0)
for (let sq = 0; sq < 64; sq++) {
  MAILBOX64[sq] = 21 + Math.floor(sq / 8) * 10 + (sq % 8)
  MAILBOX[MAILBOX64[sq]] = sq
}

// Steps in padded coordinates. Index 0 is a8, so "up the board" (towards rank 8) is -10.
const KNIGHT_STEPS = [-21, -19, -12, -8, 8, 12, 19, 21]
const BISHOP_STEPS = [-11, -9, 9, 11]
const ROOK_STEPS = [-10, -1, 1, 10]
const KING_STEPS = [-11, -10, -9, -1, 1, 9, 10, 11] // also the queen's directions
const SLIDER_STEPS = { b: BISHOP_STEPS, r: ROOK_STEPS, q: KING_STEPS }

// Internal move: { from, to, promo: letter or '', flag }
const NORMAL = 0, DOUBLE_PUSH = 1, EN_PASSANT = 2, CASTLE = 3
const PROMOTIONS = ['q', 'r', 'b', 'n']

// A king or rook leaving one of these squares (or a rook being captured on it)
// cancels the listed castling rights.
const RIGHTS_LOST = { 60: 'KQ', 63: 'K', 56: 'Q', 4: 'kq', 7: 'k', 0: 'q' }
// Castling king destination -> [rook from, rook to].
const CASTLE_ROOK = { 62: [63, 61], 58: [56, 59], 6: [7, 5], 2: [0, 3] }

// ALIGNED[a * 64 + b]: squares a and b share a rank, file or diagonal. When the
// side to move is not in check, a non-king piece that is not aligned with its own
// king can never be pinned, so its moves skip the make/test legality check.
const ALIGNED = new Array(4096).fill(false)
for (let a = 0; a < 64; a++) {
  for (let b = 0; b < 64; b++) {
    const ra = Math.floor(a / 8), fa = a % 8, rb = Math.floor(b / 8), fb = b % 8
    ALIGNED[a * 64 + b] = ra === rb || fa === fb || Math.abs(ra - rb) === Math.abs(fa - fb)
  }
}

const FIELD_SEPARATOR = /[ \t\r\n]+/
const CASTLING_FIELD = /^K?Q?k?q?$/
const HALFMOVE_FIELD = /^(?:0|[1-9][0-9]{0,5})$/
const FULLMOVE_FIELD = /^[1-9][0-9]{0,5}$/

// ---------------------------------------------------------------- squares

/** 'a8' -> 0, 'e4' -> 36, 'h1' -> 63; -1 for anything that is not a square name. */
function squareIndex(name) {
  if (typeof name !== 'string' || name.length !== 2) return -1
  const f = FILES.indexOf(name[0])
  const r = RANKS.indexOf(name[1])
  if (f < 0 || r < 0) return -1
  return (7 - r) * 8 + f
}

/** a8 (index 0) is a light square, and so is h1: each player has a light square at their right hand. */
function isLightIndex(sq) {
  return (Math.floor(sq / 8) + (sq % 8)) % 2 === 0
}

// ---------------------------------------------------------------- attacks

/** True when square index `sq` is attacked by side `by` ('w' or 'b'). */
function attacked(board, sq, by) {
  const m = MAILBOX64[sq]
  let pawn, knight, bishop, rook, queen, king, pawnSteps
  if (by === 'w') {
    pawn = 'P'; knight = 'N'; bishop = 'B'; rook = 'R'; queen = 'Q'; king = 'K'
    pawnSteps = [9, 11] // a white pawn attacking sq stands one rank below it
  } else {
    pawn = 'p'; knight = 'n'; bishop = 'b'; rook = 'r'; queen = 'q'; king = 'k'
    pawnSteps = [-9, -11]
  }
  for (const step of pawnSteps) {
    const n = MAILBOX[m + step]
    if (n >= 0 && board[n] === pawn) return true
  }
  for (const step of KNIGHT_STEPS) {
    const n = MAILBOX[m + step]
    if (n >= 0 && board[n] === knight) return true
  }
  for (const step of KING_STEPS) {
    const n = MAILBOX[m + step]
    if (n >= 0 && board[n] === king) return true
  }
  for (const [steps, slider] of [[ROOK_STEPS, rook], [BISHOP_STEPS, bishop]]) {
    for (const step of steps) {
      let t = m + step
      let n = MAILBOX[t]
      while (n >= 0) {
        const p = board[n]
        if (p !== null) {
          if (p === slider || p === queen) return true
          break
        }
        t += step
        n = MAILBOX[t]
      }
    }
  }
  return false
}

/** True when side `turn` has a legal en-passant capture onto square index `epSq`. */
function epCapturePossible(board, epSq, turn) {
  const white = turn === 'w'
  const pawn = white ? 'P' : 'p'
  const victim = white ? epSq + 8 : epSq - 8 // the pawn that just advanced two squares
  const king = board.indexOf(white ? 'K' : 'k')
  const them = white ? 'b' : 'w'
  const m = MAILBOX64[epSq]
  for (const step of white ? [9, 11] : [-9, -11]) { // capturers stand diagonally behind epSq
    const from = MAILBOX[m + step]
    if (from < 0 || board[from] !== pawn) continue
    const b = board.slice()
    b[from] = null
    b[victim] = null
    b[epSq] = pawn
    if (!attacked(b, king, them)) return true // e.g. both pawns leaving a rank can expose the king
  }
  return false
}

// ---------------------------------------------------------------- move generation

function addPawnMove(moves, from, to) {
  if (to < 8 || to >= 56) { // reaching the last rank: one move per promotion piece
    for (const piece of PROMOTIONS) moves.push({ from, to, promo: piece, flag: NORMAL })
  } else {
    moves.push({ from, to, promo: '', flag: NORMAL })
  }
}

/** Append the pseudo-legal moves (castling excluded) of `piece` on `sq`. */
function pieceMoves(board, sq, piece, turn, epSq, moves) {
  const m = MAILBOX64[sq]
  const kind = piece.toLowerCase()
  if (kind === 'p') {
    const white = turn === 'w'
    const forward = white ? -10 : 10
    const to = MAILBOX[m + forward] // never off-board: pawns never stand on the last rank
    if (board[to] === null) {
      addPawnMove(moves, sq, to)
      if (Math.floor(sq / 8) === (white ? 6 : 1)) { // still on its starting rank
        const to2 = MAILBOX[m + 2 * forward]
        if (board[to2] === null) moves.push({ from: sq, to: to2, promo: '', flag: DOUBLE_PUSH })
      }
    }
    for (const step of white ? [-11, -9] : [9, 11]) {
      const to = MAILBOX[m + step]
      if (to < 0) continue
      const target = board[to]
      if (target !== null) {
        if (COLOR[target] !== turn) addPawnMove(moves, sq, to)
      } else if (to === epSq) {
        moves.push({ from: sq, to, promo: '', flag: EN_PASSANT })
      }
    }
  } else if (kind === 'n' || kind === 'k') {
    for (const step of kind === 'n' ? KNIGHT_STEPS : KING_STEPS) {
      const to = MAILBOX[m + step]
      if (to >= 0) {
        const target = board[to]
        if (target === null || COLOR[target] !== turn) moves.push({ from: sq, to, promo: '', flag: NORMAL })
      }
    }
  } else {
    for (const step of SLIDER_STEPS[kind]) {
      let t = m + step
      let to = MAILBOX[t]
      while (to >= 0) {
        const target = board[to]
        if (target === null) {
          moves.push({ from: sq, to, promo: '', flag: NORMAL })
        } else {
          if (COLOR[target] !== turn) moves.push({ from: sq, to, promo: '', flag: NORMAL })
          break
        }
        t += step
        to = MAILBOX[t]
      }
    }
  }
}

/** Append fully legal castling moves. The caller guarantees we are not in check. */
function castlingMoves(board, turn, castling, moves) {
  let king, rook, them, rights, e, f, g, d, c, b, h, a
  if (turn === 'w') {
    king = 'K'; rook = 'R'; them = 'b'; rights = ['K', 'Q'];
    [e, f, g, d, c, b, h, a] = [60, 61, 62, 59, 58, 57, 63, 56]
  } else {
    king = 'k'; rook = 'r'; them = 'w'; rights = ['k', 'q'];
    [e, f, g, d, c, b, h, a] = [4, 5, 6, 3, 2, 1, 7, 0]
  }
  if (board[e] !== king) return
  // King side: f and g empty; the king may not pass through or land on an attacked square.
  if (castling.includes(rights[0]) && board[h] === rook && board[f] === null && board[g] === null &&
      !attacked(board, f, them) && !attacked(board, g, them)) {
    moves.push({ from: e, to: g, promo: '', flag: CASTLE })
  }
  // Queen side: b, c and d empty, but only d and c (the king's path) must be safe.
  if (castling.includes(rights[1]) && board[a] === rook && board[b] === null && board[c] === null &&
      board[d] === null && !attacked(board, d, them) && !attacked(board, c, them)) {
    moves.push({ from: e, to: c, promo: '', flag: CASTLE })
  }
}

/** Play `move` on the scratch board, test our king, and restore the board. */
function kingSafeAfter(scratch, move, king, turn) {
  const { from, to, flag } = move
  const them = turn === 'w' ? 'b' : 'w'
  const piece = scratch[from]
  const captured = scratch[to]
  scratch[to] = piece
  scratch[from] = null
  let victim = -1, victimPiece = null
  if (flag === EN_PASSANT) {
    victim = turn === 'w' ? to + 8 : to - 8
    victimPiece = scratch[victim]
    scratch[victim] = null
  }
  const safe = !attacked(scratch, from === king ? to : king, them)
  scratch[from] = piece
  scratch[to] = captured
  if (victim >= 0) scratch[victim] = victimPiece
  return safe
}

/**
 * Legal moves as internal objects, in generation order.
 * onlyFrom: restrict to the piece on this square index (-1 = all pieces)
 * firstOnly: stop after the first legal move (mate/stalemate detection)
 */
function generate(state, onlyFrom = -1, firstOnly = false) {
  const { board, turn, castling } = state
  const them = turn === 'w' ? 'b' : 'w'
  const king = board.indexOf(turn === 'w' ? 'K' : 'k')
  const inCheck = attacked(board, king, them)
  const epSq = state.ep ? squareIndex(state.ep) : -1
  const pseudo = []
  const first = onlyFrom < 0 ? 0 : onlyFrom
  const last = onlyFrom < 0 ? 63 : onlyFrom
  for (let sq = first; sq <= last; sq++) {
    const piece = board[sq]
    if (piece !== null && COLOR[piece] === turn) pieceMoves(board, sq, piece, turn, epSq, pseudo)
  }
  if (!inCheck && castling && (onlyFrom < 0 || onlyFrom === king)) castlingMoves(board, turn, castling, pseudo)
  const legal = []
  let scratch = null
  for (const move of pseudo) {
    // Shortcut: not in check, not the king, not en passant, and not on a line with
    // the king -> the piece cannot be pinned, so the move is legal.
    if (move.flag === CASTLE || (!inCheck && move.from !== king && move.flag !== EN_PASSANT &&
                                 !ALIGNED[move.from * 64 + king])) {
      legal.push(move)
    } else {
      if (scratch === null) scratch = board.slice()
      if (kingSafeAfter(scratch, move, king, turn)) legal.push(move)
    }
    if (firstOnly && legal.length) break
  }
  return legal
}

function uciOf(move) {
  return SQUARES[move.from] + SQUARES[move.to] + move.promo
}

/** The internal legal move matching a UCI string, or null. */
function findMove(state, uci) {
  if (typeof uci !== 'string' || (uci.length !== 4 && uci.length !== 5)) return null
  const from = squareIndex(uci.slice(0, 2))
  const to = squareIndex(uci.slice(2, 4))
  const promo = uci.slice(4)
  if (from < 0 || to < 0 || (promo && !PROMOTIONS.includes(promo))) return null
  const piece = state.board[from]
  if (piece === null || COLOR[piece] !== state.turn) return null
  for (const move of generate(state, from)) {
    if (move.to === to && move.promo === promo) return move
  }
  return null
}

/** New state after a legal internal move. */
function make(state, move) {
  const { from, to, promo, flag } = move
  const white = state.turn === 'w'
  const board = state.board.slice()
  const piece = board[from]
  const captured = board[to]
  board[from] = null
  board[to] = promo ? (white ? promo.toUpperCase() : promo) : piece
  if (flag === EN_PASSANT) {
    board[white ? to + 8 : to - 8] = null
  } else if (flag === CASTLE) {
    const [rookFrom, rookTo] = CASTLE_ROOK[to]
    board[rookTo] = board[rookFrom]
    board[rookFrom] = null
  }
  let castling = state.castling
  for (const sq of [from, to]) {
    for (const right of RIGHTS_LOST[sq] || '') castling = castling.replace(right, '')
  }
  const nextTurn = white ? 'b' : 'w'
  let ep = null
  if (flag === DOUBLE_PUSH) {
    const passed = (from + to) / 2
    if (epCapturePossible(board, passed, nextTurn)) ep = SQUARES[passed]
  }
  const irreversible = piece === 'P' || piece === 'p' || captured !== null // en passant is a pawn move
  return {
    board,
    turn: nextTurn,
    castling,
    ep,
    halfmove: irreversible ? 0 : state.halfmove + 1,
    fullmove: white ? state.fullmove : state.fullmove + 1,
  }
}

function inCheckNow(state) {
  const { board, turn } = state
  return attacked(board, board.indexOf(turn === 'w' ? 'K' : 'k'), turn === 'w' ? 'b' : 'w')
}

/** Kings only, plus either a single knight or any bishops all on one square colour. */
function insufficientMaterial(board) {
  let knights = 0, lightBishops = 0, darkBishops = 0
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq]
    if (piece === null || piece === 'K' || piece === 'k') continue
    if (piece === 'N' || piece === 'n') {
      knights++
    } else if (piece === 'B' || piece === 'b') {
      if (isLightIndex(sq)) lightBishops++
      else darkBishops++
    } else {
      return false // a pawn, rook or queen can always force or allow mate
    }
  }
  if (knights === 0) return lightBishops === 0 || darkBishops === 0
  return knights === 1 && lightBishops === 0 && darkBishops === 0
}

// ---------------------------------------------------------------- FEN

function placement(board) {
  const rows = []
  for (let r = 0; r < 8; r++) {
    let row = ''
    let empty = 0
    for (let i = r * 8; i < r * 8 + 8; i++) {
      const piece = board[i]
      if (piece === null) {
        empty++
      } else {
        if (empty) { row += String(empty); empty = 0 }
        row += piece
      }
    }
    if (empty) row += String(empty)
    rows.push(row)
  }
  return rows.join('/')
}

function parsePlacement(text) {
  const rows = text.split('/')
  if (rows.length !== 8) throw new Error('Invalid FEN: piece placement must have 8 ranks')
  const board = []
  for (const row of rows) {
    let width = 0
    let previousWasDigit = false
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        if (previousWasDigit) throw new Error('Invalid FEN: adjacent digits in a rank')
        width += Number(ch)
        for (let k = 0; k < Number(ch); k++) board.push(null)
        previousWasDigit = true
      } else if (Object.prototype.hasOwnProperty.call(COLOR, ch)) {
        width++
        board.push(ch)
        previousWasDigit = false
      } else {
        throw new Error('Invalid FEN: unexpected character in piece placement')
      }
      if (width > 8) break
    }
    if (width !== 8) throw new Error('Invalid FEN: every rank must describe 8 squares')
  }
  return board
}

/** Parse a FEN string into a state object. Throws Error for invalid FEN or positions. */
export function parseFen(fen) {
  if (typeof fen !== 'string') throw new Error('Invalid FEN: expected a string')
  const fields = fen.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').split(FIELD_SEPARATOR)
  if (fields.length !== 6) throw new Error('Invalid FEN: expected 6 space-separated fields')
  const [placementText, turn, castlingText, epText, halfmove, fullmove] = fields
  const board = parsePlacement(placementText)
  if (turn !== 'w' && turn !== 'b') throw new Error('Invalid FEN: side to move must be w or b')
  if (board.filter(p => p === 'K').length !== 1 || board.filter(p => p === 'k').length !== 1) {
    throw new Error('Invalid FEN: each side needs exactly one king')
  }
  for (let i = 0; i < 64; i++) {
    if ((i < 8 || i >= 56) && (board[i] === 'P' || board[i] === 'p')) {
      throw new Error('Invalid FEN: pawns cannot stand on the first or last rank')
    }
  }

  let castling = castlingText
  if (castling === '-') {
    castling = ''
  } else if (!CASTLING_FIELD.test(castling)) {
    throw new Error('Invalid FEN: castling field must be - or a subset of KQkq in order')
  }
  for (const [right, kingSq, king, rookSq, rook] of [['K', 60, 'K', 63, 'R'], ['Q', 60, 'K', 56, 'R'],
    ['k', 4, 'k', 7, 'r'], ['q', 4, 'k', 0, 'r']]) {
    if (castling.includes(right) && (board[kingSq] !== king || board[rookSq] !== rook)) {
      throw new Error('Invalid FEN: castling right ' + right + ' without king and rook at home')
    }
  }

  let ep = null
  if (epText !== '-') {
    const sq = squareIndex(epText)
    if (sq < 0 || epText[1] !== (turn === 'w' ? '6' : '3')) throw new Error('Invalid FEN: bad en passant square')
    // The pawn that just advanced two squares stands in front of the target
    // square; the target square and the pawn's starting square are empty.
    const step = turn === 'w' ? 8 : -8
    const pushedPawn = turn === 'w' ? 'p' : 'P'
    if (board[sq] !== null || board[sq - step] !== null || board[sq + step] !== pushedPawn) {
      throw new Error('Invalid FEN: en passant square does not follow a double pawn push')
    }
    ep = epText
  }

  if (!HALFMOVE_FIELD.test(halfmove)) throw new Error('Invalid FEN: bad halfmove clock')
  if (!FULLMOVE_FIELD.test(fullmove)) throw new Error('Invalid FEN: bad fullmove number')

  if (attacked(board, board.indexOf(turn === 'w' ? 'k' : 'K'), turn)) {
    throw new Error('Invalid FEN: the side not to move is in check')
  }
  return { board, turn, castling, ep, halfmove: Number(halfmove), fullmove: Number(fullmove) }
}

/** Serialise a state to FEN (round-trips parseFen for every valid FEN). */
export function toFen(state) {
  return [placement(state.board), state.turn, state.castling || '-', state.ep || '-',
    String(state.halfmove), String(state.fullmove)].join(' ')
}

/**
 * FEN without the move counters, for repetition detection.
 * The ep square is kept only when an en-passant capture is actually legal.
 */
export function positionKey(state) {
  let ep = state.ep
  if (ep && !epCapturePossible(state.board, squareIndex(ep), state.turn)) ep = null
  return [placement(state.board), state.turn, state.castling || '-', ep || '-'].join(' ')
}

// ---------------------------------------------------------------- public API

/** All legal moves as UCI strings, sorted ascending. */
export function legalMoves(state) {
  return generate(state).map(uciOf).sort()
}

/** New state after the UCI move, or null when it is malformed or illegal. */
export function applyMove(state, uci) {
  if (state === null || typeof state !== 'object' || !Array.isArray(state.board) || state.board.length !== 64) return null
  const move = findMove(state, uci)
  return move === null ? null : make(state, move)
}

/**
 * Check / game-over summary for the side to move.
 * positions: positionKey() of every position so far, including the current one.
 * Precedence: checkmate, stalemate, insufficient material, fifty-move, threefold.
 */
export function gameStatus(state, positions = []) {
  const check = inCheckNow(state)
  let result = null, reason = null
  if (generate(state, -1, true).length === 0) {
    if (check) { result = state.turn === 'w' ? '0-1' : '1-0'; reason = 'checkmate' }
    else { result = '1/2-1/2'; reason = 'stalemate' }
  } else if (insufficientMaterial(state.board)) {
    result = '1/2-1/2'; reason = 'insufficient'
  } else if (state.halfmove >= 100) {
    result = '1/2-1/2'; reason = 'fifty'
  } else if (Array.isArray(positions) && positions.length) {
    const key = positionKey(state)
    let count = 0
    for (const k of positions) if (k === key) count++
    if (count >= 3) { result = '1/2-1/2'; reason = 'threefold' }
  }
  return { turn: state.turn, check, over: result !== null, result, reason }
}

/** Standard algebraic notation for a legal UCI move (null when illegal). */
export function moveToSan(state, uci) {
  const moves = generate(state)
  const move = moves.find(m => uciOf(m) === uci)
  if (!move) return null
  const { from, to, promo, flag } = move
  const board = state.board
  const piece = board[from]
  let san
  if (flag === CASTLE) {
    san = to % 8 === 6 ? 'O-O' : 'O-O-O'
  } else {
    const capture = board[to] !== null || flag === EN_PASSANT
    if (piece === 'P' || piece === 'p') {
      san = (capture ? FILES[from % 8] + 'x' : '') + SQUARES[to]
      if (promo) san += '=' + promo.toUpperCase()
    } else {
      san = piece.toUpperCase() + disambiguation(board, moves, move) + (capture ? 'x' : '') + SQUARES[to]
    }
  }
  const after = make(state, move)
  if (inCheckNow(after)) san += generate(after, -1, true).length ? '+' : '#'
  return san
}

/** File, rank or full square needed to tell `move` apart from same-piece rivals. */
function disambiguation(board, moves, move) {
  const { from, to } = move
  const piece = board[from]
  const rivals = moves.filter(m => m.to === to && m.from !== from && board[m.from] === piece).map(m => m.from)
  if (!rivals.length) return ''
  if (rivals.every(r => r % 8 !== from % 8)) return FILES[from % 8]
  if (rivals.every(r => Math.floor(r / 8) !== Math.floor(from / 8))) return SQUARES[from][1]
  return SQUARES[from]
}

/** { color: 'w'|'b', type: 'p'|'n'|'b'|'r'|'q'|'k' } on a square like 'e4', or null. */
export function pieceAt(state, square) {
  const sq = squareIndex(square)
  if (sq < 0) return null
  const piece = state.board[sq]
  if (piece === null) return null
  return { color: COLOR[piece], type: piece.toLowerCase() }
}

/** Square name of the king of `color` ('w' or 'b'), or null. */
export function kingSquare(state, color) {
  if (color !== 'w' && color !== 'b') return null
  const sq = state.board.indexOf(color === 'w' ? 'K' : 'k')
  return sq < 0 ? null : SQUARES[sq]
}

/** True for a light square ('a8', 'h1', 'e4'), false for a dark one ('a1', 'h8', 'd4'): how to paint the board. */
export function isLightSquare(square) {
  const sq = squareIndex(square)
  if (sq < 0) throw new Error(`Not a square: ${square}`)
  return isLightIndex(sq)
}
