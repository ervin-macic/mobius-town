"""Chess rules engine: pure functions on plain data (Python 3, stdlib only).

Authoritative server twin of games/chess.js. The two implementations must stay
behaviourally identical: tests/rules.test.mjs replays games recorded from this
module (tests/fixtures/chess_crosscheck.json) through the JS engine.

State is a plain, JSON-serialisable dict. Treat it as immutable; every function
here returns new data and never mutates its arguments.

    board     list of 64 entries; index 0 = a8, 7 = h8, 56 = a1, 63 = h1.
              Each entry is a FEN piece letter ('P', 'n', ...) or None.
    turn      'w' or 'b' (side to move)
    castling  remaining castling rights: a subset of 'KQkq' in that order, '' if none
    ep        en-passant target square such as 'e3', or None
    halfmove  plies since the last capture or pawn move (fifty-move rule)
    fullmove  move number, starting at 1 and incremented after Black moves

Moves are UCI strings: 'e2e4', 'e1g1' (castling is written as the king move),
'e7e8q' (promotion piece in q, r, b, n).

En passant convention: after a double pawn push the ep square is recorded only
when the opponent really has a legal en-passant capture (python-chess's "legal"
convention). That keeps generated FENs canonical and makes position_key() --
the repetition key -- follow FIDE's "same possible moves" rule. A FEN parsed
from elsewhere keeps its ep field verbatim so FEN strings round-trip, and
position_key() still normalises it.

legal_moves()/apply_move() implement the movement rules only. Draws by rule
(fifty-move, threefold, insufficient material) are reported by game_status();
callers should stop accepting moves once game_status(...)['over'] is True.
"""

import re

__all__ = [
    'START_FEN', 'parse_fen', 'to_fen', 'position_key', 'legal_moves', 'apply_move',
    'game_status', 'move_to_san', 'piece_at', 'king_square',
]

START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

FILES = 'abcdefgh'
RANKS = '12345678'
SQUARES = tuple(FILES[i % 8] + str(8 - i // 8) for i in range(64))  # index -> 'a8' ... 'h1'

_COLOR = {
    'P': 'w', 'N': 'w', 'B': 'w', 'R': 'w', 'Q': 'w', 'K': 'w',
    'p': 'b', 'n': 'b', 'b': 'b', 'r': 'b', 'q': 'b', 'k': 'b',
}

# 10x12 mailbox: every board index has a padded twin, and stepping from a padded
# index lands on -1 when it leaves the board. One lookup replaces edge checks.
_MAILBOX = [-1] * 120
_MAILBOX64 = [0] * 64
for _sq in range(64):
    _MAILBOX64[_sq] = 21 + (_sq // 8) * 10 + _sq % 8
    _MAILBOX[_MAILBOX64[_sq]] = _sq
del _sq

# Steps in padded coordinates. Index 0 is a8, so "up the board" (towards rank 8) is -10.
_KNIGHT_STEPS = (-21, -19, -12, -8, 8, 12, 19, 21)
_BISHOP_STEPS = (-11, -9, 9, 11)
_ROOK_STEPS = (-10, -1, 1, 10)
_KING_STEPS = (-11, -10, -9, -1, 1, 9, 10, 11)  # also the queen's directions
_SLIDER_STEPS = {'b': _BISHOP_STEPS, 'r': _ROOK_STEPS, 'q': _KING_STEPS}

# Internal move: (from_index, to_index, promotion letter or '', flag)
_NORMAL, _DOUBLE_PUSH, _EN_PASSANT, _CASTLE = 0, 1, 2, 3
_PROMOTIONS = ('q', 'r', 'b', 'n')

# A king or rook leaving one of these squares (or a rook being captured on it)
# cancels the listed castling rights.
_RIGHTS_LOST = {60: 'KQ', 63: 'K', 56: 'Q', 4: 'kq', 7: 'k', 0: 'q'}
# Castling king destination -> (rook from, rook to).
_CASTLE_ROOK = {62: (63, 61), 58: (56, 59), 6: (7, 5), 2: (0, 3)}

# _ALIGNED[a * 64 + b]: squares a and b share a rank, file or diagonal. When the
# side to move is not in check, a non-king piece that is not aligned with its own
# king can never be pinned, so its moves skip the make/test legality check.
_ALIGNED = [False] * 4096
for _a in range(64):
    for _b in range(64):
        _ra, _fa, _rb, _fb = _a // 8, _a % 8, _b // 8, _b % 8
        _ALIGNED[_a * 64 + _b] = _ra == _rb or _fa == _fb or abs(_ra - _rb) == abs(_fa - _fb)
del _a, _b, _ra, _fa, _rb, _fb

_FIELD_SEPARATOR = re.compile(r'[ \t\r\n]+')
_CASTLING_FIELD = re.compile(r'K?Q?k?q?')
_HALFMOVE_FIELD = re.compile(r'0|[1-9][0-9]{0,5}')
_FULLMOVE_FIELD = re.compile(r'[1-9][0-9]{0,5}')


# ---------------------------------------------------------------- squares


def _square_index(name):
    """'a8' -> 0, 'e4' -> 36, 'h1' -> 63; -1 for anything that is not a square name."""
    if not isinstance(name, str) or len(name) != 2:
        return -1
    f = FILES.find(name[0])
    r = RANKS.find(name[1])
    if f < 0 or r < 0:
        return -1
    return (7 - r) * 8 + f


# ---------------------------------------------------------------- attacks


def _attacked(board, sq, by):
    """True when square index `sq` is attacked by side `by` ('w' or 'b')."""
    m = _MAILBOX64[sq]
    if by == 'w':
        pawn, knight, bishop, rook, queen, king = 'P', 'N', 'B', 'R', 'Q', 'K'
        pawn_steps = (9, 11)  # a white pawn attacking sq stands one rank below it
    else:
        pawn, knight, bishop, rook, queen, king = 'p', 'n', 'b', 'r', 'q', 'k'
        pawn_steps = (-9, -11)
    for step in pawn_steps:
        n = _MAILBOX[m + step]
        if n >= 0 and board[n] == pawn:
            return True
    for step in _KNIGHT_STEPS:
        n = _MAILBOX[m + step]
        if n >= 0 and board[n] == knight:
            return True
    for step in _KING_STEPS:
        n = _MAILBOX[m + step]
        if n >= 0 and board[n] == king:
            return True
    for steps, slider in ((_ROOK_STEPS, rook), (_BISHOP_STEPS, bishop)):
        for step in steps:
            t = m + step
            n = _MAILBOX[t]
            while n >= 0:
                p = board[n]
                if p is not None:
                    if p == slider or p == queen:
                        return True
                    break
                t += step
                n = _MAILBOX[t]
    return False


def _ep_capture_possible(board, ep_sq, turn):
    """True when side `turn` has a legal en-passant capture onto square index `ep_sq`."""
    white = turn == 'w'
    pawn = 'P' if white else 'p'
    victim = ep_sq + 8 if white else ep_sq - 8  # the pawn that just advanced two squares
    king = board.index('K' if white else 'k')
    them = 'b' if white else 'w'
    m = _MAILBOX64[ep_sq]
    for step in ((9, 11) if white else (-9, -11)):  # capturers stand diagonally behind ep_sq
        frm = _MAILBOX[m + step]
        if frm < 0 or board[frm] != pawn:
            continue
        b = list(board)
        b[frm] = None
        b[victim] = None
        b[ep_sq] = pawn
        if not _attacked(b, king, them):  # e.g. both pawns leaving a rank can expose the king
            return True
    return False


# ---------------------------------------------------------------- move generation


def _add_pawn_move(moves, frm, to):
    if to < 8 or to >= 56:  # reaching the last rank: one move per promotion piece
        for piece in _PROMOTIONS:
            moves.append((frm, to, piece, _NORMAL))
    else:
        moves.append((frm, to, '', _NORMAL))


def _piece_moves(board, sq, piece, turn, ep_sq, moves):
    """Append the pseudo-legal moves (castling excluded) of `piece` on `sq`."""
    m = _MAILBOX64[sq]
    kind = piece.lower()
    if kind == 'p':
        white = turn == 'w'
        forward = -10 if white else 10
        to = _MAILBOX[m + forward]  # never off-board: pawns never stand on the last rank
        if board[to] is None:
            _add_pawn_move(moves, sq, to)
            if sq // 8 == (6 if white else 1):  # still on its starting rank
                to2 = _MAILBOX[m + 2 * forward]
                if board[to2] is None:
                    moves.append((sq, to2, '', _DOUBLE_PUSH))
        for step in ((-11, -9) if white else (9, 11)):
            to = _MAILBOX[m + step]
            if to < 0:
                continue
            target = board[to]
            if target is not None:
                if _COLOR[target] != turn:
                    _add_pawn_move(moves, sq, to)
            elif to == ep_sq:
                moves.append((sq, to, '', _EN_PASSANT))
    elif kind == 'n' or kind == 'k':
        for step in (_KNIGHT_STEPS if kind == 'n' else _KING_STEPS):
            to = _MAILBOX[m + step]
            if to >= 0:
                target = board[to]
                if target is None or _COLOR[target] != turn:
                    moves.append((sq, to, '', _NORMAL))
    else:
        for step in _SLIDER_STEPS[kind]:
            t = m + step
            to = _MAILBOX[t]
            while to >= 0:
                target = board[to]
                if target is None:
                    moves.append((sq, to, '', _NORMAL))
                else:
                    if _COLOR[target] != turn:
                        moves.append((sq, to, '', _NORMAL))
                    break
                t += step
                to = _MAILBOX[t]


def _castling_moves(board, turn, castling, moves):
    """Append fully legal castling moves. The caller guarantees we are not in check."""
    if turn == 'w':
        king, rook, them, rights = 'K', 'R', 'b', ('K', 'Q')
        e, f, g, d, c, b, h, a = 60, 61, 62, 59, 58, 57, 63, 56
    else:
        king, rook, them, rights = 'k', 'r', 'w', ('k', 'q')
        e, f, g, d, c, b, h, a = 4, 5, 6, 3, 2, 1, 7, 0
    if board[e] != king:
        return
    # King side: f and g empty; the king may not pass through or land on an attacked square.
    if (rights[0] in castling and board[h] == rook and board[f] is None and board[g] is None
            and not _attacked(board, f, them) and not _attacked(board, g, them)):
        moves.append((e, g, '', _CASTLE))
    # Queen side: b, c and d empty, but only d and c (the king's path) must be safe.
    if (rights[1] in castling and board[a] == rook and board[b] is None and board[c] is None
            and board[d] is None and not _attacked(board, d, them) and not _attacked(board, c, them)):
        moves.append((e, c, '', _CASTLE))


def _king_safe_after(scratch, move, king, turn):
    """Play `move` on the scratch board, test our king, and restore the board."""
    frm, to, _, flag = move
    them = 'b' if turn == 'w' else 'w'
    piece = scratch[frm]
    captured = scratch[to]
    scratch[to] = piece
    scratch[frm] = None
    victim = -1
    if flag == _EN_PASSANT:
        victim = to + 8 if turn == 'w' else to - 8
        victim_piece = scratch[victim]
        scratch[victim] = None
    safe = not _attacked(scratch, to if frm == king else king, them)
    scratch[frm] = piece
    scratch[to] = captured
    if victim >= 0:
        scratch[victim] = victim_piece
    return safe


def _generate(state, only_from=-1, first_only=False):
    """Legal moves as internal tuples, in generation order.

    only_from  restrict to the piece on this square index (-1 = all pieces)
    first_only stop after the first legal move (mate/stalemate detection)
    """
    board = state['board']
    turn = state['turn']
    them = 'b' if turn == 'w' else 'w'
    king = board.index('K' if turn == 'w' else 'k')
    in_check = _attacked(board, king, them)
    ep_sq = _square_index(state['ep']) if state['ep'] else -1
    pseudo = []
    for sq in (range(64) if only_from < 0 else (only_from,)):
        piece = board[sq]
        if piece is not None and _COLOR[piece] == turn:
            _piece_moves(board, sq, piece, turn, ep_sq, pseudo)
    if not in_check and state['castling'] and (only_from < 0 or only_from == king):
        _castling_moves(board, turn, state['castling'], pseudo)
    legal = []
    scratch = None
    for move in pseudo:
        frm, _, _, flag = move
        # Shortcut: not in check, not the king, not en passant, and not on a line with
        # the king -> the piece cannot be pinned, so the move is legal.
        if flag == _CASTLE or (not in_check and frm != king and flag != _EN_PASSANT
                               and not _ALIGNED[frm * 64 + king]):
            legal.append(move)
        else:
            if scratch is None:
                scratch = list(board)
            if _king_safe_after(scratch, move, king, turn):
                legal.append(move)
        if first_only and legal:
            break
    return legal


def _uci(move):
    return SQUARES[move[0]] + SQUARES[move[1]] + move[2]


def _find_move(state, uci):
    """The internal legal move matching a UCI string, or None."""
    if not isinstance(uci, str) or len(uci) not in (4, 5):
        return None
    frm = _square_index(uci[0:2])
    to = _square_index(uci[2:4])
    promo = uci[4:]
    if frm < 0 or to < 0 or (promo and promo not in _PROMOTIONS):
        return None
    piece = state['board'][frm]
    if piece is None or _COLOR[piece] != state['turn']:
        return None
    for move in _generate(state, only_from=frm):
        if move[1] == to and move[2] == promo:
            return move
    return None


def _make(state, move):
    """New state after a legal internal move."""
    frm, to, promo, flag = move
    turn = state['turn']
    white = turn == 'w'
    board = list(state['board'])
    piece = board[frm]
    captured = board[to]
    board[frm] = None
    board[to] = (promo.upper() if white else promo) if promo else piece
    if flag == _EN_PASSANT:
        board[to + 8 if white else to - 8] = None
    elif flag == _CASTLE:
        rook_from, rook_to = _CASTLE_ROOK[to]
        board[rook_to] = board[rook_from]
        board[rook_from] = None
    castling = state['castling']
    for sq in (frm, to):
        for right in _RIGHTS_LOST.get(sq, ''):
            castling = castling.replace(right, '')
    next_turn = 'b' if white else 'w'
    ep = None
    if flag == _DOUBLE_PUSH:
        passed = (frm + to) // 2
        if _ep_capture_possible(board, passed, next_turn):
            ep = SQUARES[passed]
    irreversible = piece == 'P' or piece == 'p' or captured is not None  # en passant is a pawn move
    return {
        'board': board,
        'turn': next_turn,
        'castling': castling,
        'ep': ep,
        'halfmove': 0 if irreversible else state['halfmove'] + 1,
        'fullmove': state['fullmove'] if white else state['fullmove'] + 1,
    }


def _in_check(state):
    board = state['board']
    turn = state['turn']
    return _attacked(board, board.index('K' if turn == 'w' else 'k'), 'b' if turn == 'w' else 'w')


def _insufficient_material(board):
    """Kings only, plus either a single knight or any bishops all on one square colour."""
    knights = light_bishops = dark_bishops = 0
    for sq in range(64):
        piece = board[sq]
        if piece is None or piece == 'K' or piece == 'k':
            continue
        if piece == 'N' or piece == 'n':
            knights += 1
        elif piece == 'B' or piece == 'b':
            if (sq // 8 + sq % 8) % 2 == 0:  # a8 (index 0) is a light square
                light_bishops += 1
            else:
                dark_bishops += 1
        else:
            return False  # a pawn, rook or queen can always force or allow mate
    if knights == 0:
        return light_bishops == 0 or dark_bishops == 0
    return knights == 1 and light_bishops == 0 and dark_bishops == 0


# ---------------------------------------------------------------- FEN


def _placement(board):
    rows = []
    for r in range(8):
        row = ''
        empty = 0
        for piece in board[r * 8:r * 8 + 8]:
            if piece is None:
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += piece
        if empty:
            row += str(empty)
        rows.append(row)
    return '/'.join(rows)


def _parse_placement(placement):
    rows = placement.split('/')
    if len(rows) != 8:
        raise ValueError('Invalid FEN: piece placement must have 8 ranks')
    board = []
    for row in rows:
        width = 0
        previous_was_digit = False
        for ch in row:
            if '1' <= ch <= '8':
                if previous_was_digit:
                    raise ValueError('Invalid FEN: adjacent digits in a rank')
                width += int(ch)
                board.extend([None] * int(ch))
                previous_was_digit = True
            elif ch in _COLOR:
                width += 1
                board.append(ch)
                previous_was_digit = False
            else:
                raise ValueError('Invalid FEN: unexpected character in piece placement')
            if width > 8:
                break
        if width != 8:
            raise ValueError('Invalid FEN: every rank must describe 8 squares')
    return board


def parse_fen(fen):
    """Parse a FEN string into a state dict. Raises ValueError for invalid FEN or positions."""
    if not isinstance(fen, str):
        raise ValueError('Invalid FEN: expected a string')
    fields = _FIELD_SEPARATOR.split(fen.strip(' \t\r\n'))
    if len(fields) != 6:
        raise ValueError('Invalid FEN: expected 6 space-separated fields')
    placement, turn, castling, ep, halfmove, fullmove = fields
    board = _parse_placement(placement)
    if turn != 'w' and turn != 'b':
        raise ValueError('Invalid FEN: side to move must be w or b')
    if board.count('K') != 1 or board.count('k') != 1:
        raise ValueError('Invalid FEN: each side needs exactly one king')
    if any(piece in ('P', 'p') for piece in board[:8] + board[56:]):
        raise ValueError('Invalid FEN: pawns cannot stand on the first or last rank')

    if castling == '-':
        castling = ''
    elif not _CASTLING_FIELD.fullmatch(castling):
        raise ValueError('Invalid FEN: castling field must be - or a subset of KQkq in order')
    for right, king_sq, king, rook_sq, rook in (('K', 60, 'K', 63, 'R'), ('Q', 60, 'K', 56, 'R'),
                                                ('k', 4, 'k', 7, 'r'), ('q', 4, 'k', 0, 'r')):
        if right in castling and (board[king_sq] != king or board[rook_sq] != rook):
            raise ValueError('Invalid FEN: castling right ' + right + ' without king and rook at home')

    if ep == '-':
        ep = None
    else:
        sq = _square_index(ep)
        if sq < 0 or ep[1] != ('6' if turn == 'w' else '3'):
            raise ValueError('Invalid FEN: bad en passant square')
        # The pawn that just advanced two squares stands in front of the target
        # square; the target square and the pawn's starting square are empty.
        step = 8 if turn == 'w' else -8
        pushed_pawn = 'p' if turn == 'w' else 'P'
        if board[sq] is not None or board[sq - step] is not None or board[sq + step] != pushed_pawn:
            raise ValueError('Invalid FEN: en passant square does not follow a double pawn push')

    if not _HALFMOVE_FIELD.fullmatch(halfmove):
        raise ValueError('Invalid FEN: bad halfmove clock')
    if not _FULLMOVE_FIELD.fullmatch(fullmove):
        raise ValueError('Invalid FEN: bad fullmove number')

    if _attacked(board, board.index('k' if turn == 'w' else 'K'), turn):
        raise ValueError('Invalid FEN: the side not to move is in check')
    return {
        'board': board,
        'turn': turn,
        'castling': castling,
        'ep': ep,
        'halfmove': int(halfmove),
        'fullmove': int(fullmove),
    }


def to_fen(state):
    """Serialise a state to FEN (round-trips parse_fen for every valid FEN)."""
    return ' '.join((
        _placement(state['board']), state['turn'], state['castling'] or '-',
        state['ep'] or '-', str(state['halfmove']), str(state['fullmove']),
    ))


def position_key(state):
    """FEN without the move counters, for repetition detection.

    The ep square is kept only when an en-passant capture is actually legal.
    """
    ep = state['ep']
    if ep and not _ep_capture_possible(state['board'], _square_index(ep), state['turn']):
        ep = None
    return ' '.join((_placement(state['board']), state['turn'], state['castling'] or '-', ep or '-'))


# ---------------------------------------------------------------- public API


def legal_moves(state):
    """All legal moves as UCI strings, sorted ascending."""
    return sorted(_uci(move) for move in _generate(state))


def apply_move(state, uci):
    """New state after the UCI move, or None when it is malformed or illegal."""
    if not isinstance(state, dict) or not isinstance(state.get('board'), list) or len(state['board']) != 64:
        return None
    move = _find_move(state, uci)
    return None if move is None else _make(state, move)


def game_status(state, positions=None):
    """Check / game-over summary for the side to move.

    positions: position_key() of every position so far, including the current one.
    Precedence: checkmate, stalemate, insufficient material, fifty-move, threefold.
    """
    check = _in_check(state)
    result = reason = None
    if not _generate(state, first_only=True):
        if check:
            result, reason = ('0-1' if state['turn'] == 'w' else '1-0'), 'checkmate'
        else:
            result, reason = '1/2-1/2', 'stalemate'
    elif _insufficient_material(state['board']):
        result, reason = '1/2-1/2', 'insufficient'
    elif state['halfmove'] >= 100:
        result, reason = '1/2-1/2', 'fifty'
    elif positions:
        key = position_key(state)
        if sum(1 for k in positions if k == key) >= 3:
            result, reason = '1/2-1/2', 'threefold'
    return {
        'turn': state['turn'],
        'check': check,
        'over': result is not None,
        'result': result,
        'reason': reason,
    }


def move_to_san(state, uci):
    """Standard algebraic notation for a legal UCI move (None when illegal)."""
    moves = _generate(state)
    move = next((m for m in moves if _uci(m) == uci), None)
    if move is None:
        return None
    frm, to, promo, flag = move
    board = state['board']
    piece = board[frm]
    if flag == _CASTLE:
        san = 'O-O' if to % 8 == 6 else 'O-O-O'
    else:
        capture = board[to] is not None or flag == _EN_PASSANT
        if piece == 'P' or piece == 'p':
            san = (FILES[frm % 8] + 'x' if capture else '') + SQUARES[to]
            if promo:
                san += '=' + promo.upper()
        else:
            san = piece.upper() + _disambiguation(board, moves, move) + ('x' if capture else '') + SQUARES[to]
    after = _make(state, move)
    if _in_check(after):
        san += '+' if _generate(after, first_only=True) else '#'
    return san


def _disambiguation(board, moves, move):
    """File, rank or full square needed to tell `move` apart from same-piece rivals."""
    frm, to = move[0], move[1]
    piece = board[frm]
    rivals = [m[0] for m in moves if m[1] == to and m[0] != frm and board[m[0]] == piece]
    if not rivals:
        return ''
    if all(r % 8 != frm % 8 for r in rivals):
        return FILES[frm % 8]
    if all(r // 8 != frm // 8 for r in rivals):
        return SQUARES[frm][1]
    return SQUARES[frm]


def piece_at(state, square):
    """{'color': 'w'|'b', 'type': 'p'|'n'|'b'|'r'|'q'|'k'} on a square like 'e4', or None."""
    sq = _square_index(square)
    if sq < 0:
        return None
    piece = state['board'][sq]
    if piece is None:
        return None
    return {'color': _COLOR[piece], 'type': piece.lower()}


def king_square(state, color):
    """Square name of the king of `color` ('w' or 'b'), or None."""
    if color != 'w' and color != 'b':
        return None
    king = 'K' if color == 'w' else 'k'
    board = state['board']
    return SQUARES[board.index(king)] if king in board else None
