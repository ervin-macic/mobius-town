"""Connect Four rules: pure functions on plain data (Python 3, stdlib only).

Authoritative server twin of games/connect4.js; the two must stay behaviourally
identical (tests/rules.test.mjs replays tests/fixtures/connect4_crosscheck.json).

State (a plain dict; treat it as immutable):
    cells  42-character string, row-major starting from the TOP row:
           cells[row * 7 + col], '.' empty, 'r' red, 'y' yellow
    turn   'r' or 'y' (red moves first)

A state is valid when cells only holds '.', 'r', 'y', no disc floats above an
empty cell, and the disc counts match the side to move (red count == yellow
count when red is to move, one more red disc when yellow is to move).
"""

__all__ = ['COLS', 'ROWS', 'new_game', 'legal_columns', 'drop', 'status']

COLS = 7
ROWS = 6

# Scan directions as (d_col, d_row), rows counted from the top: horizontal,
# vertical (downwards), diagonal down-right, diagonal up-right. Every direction
# moves rightwards or straight down, so a reported line is ordered by column
# (top to bottom for vertical lines).
_DIRECTIONS = ((1, 0), (0, 1), (1, 1), (1, -1))


def new_game():
    """Empty board, red to move."""
    return {'cells': '.' * (COLS * ROWS), 'turn': 'r'}


def _is_valid(state):
    if not isinstance(state, dict):
        return False
    cells = state.get('cells')
    turn = state.get('turn')
    if not isinstance(cells, str) or len(cells) != COLS * ROWS or turn not in ('r', 'y'):
        return False
    reds = yellows = 0
    for i, cell in enumerate(cells):
        if cell == 'r':
            reds += 1
        elif cell == 'y':
            yellows += 1
        elif cell != '.':
            return False
        if cell != '.' and i + COLS < COLS * ROWS and cells[i + COLS] == '.':
            return False  # a disc cannot float above an empty cell
    return reds - yellows == (0 if turn == 'r' else 1)


def _column(col):
    """Normalise a column argument: an integer 0..6 (integral floats allowed, as in JS)."""
    if isinstance(col, bool):
        return None
    if isinstance(col, float) and col.is_integer():
        col = int(col)
    if not isinstance(col, int) or col < 0 or col >= COLS:
        return None
    return col


def status(state):
    """{'over', 'winner', 'draw', 'line'}; line is the 4 winning [col, row] cells.

    Raises ValueError for a malformed state. If several four-in-a-rows exist the
    first one found scanning rows top to bottom, columns left to right, then
    horizontal / vertical / down-right / up-right is reported.
    """
    if not _is_valid(state):
        raise ValueError('Invalid Connect Four state')
    cells = state['cells']
    for row in range(ROWS):
        for col in range(COLS):
            disc = cells[row * COLS + col]
            if disc == '.':
                continue
            for d_col, d_row in _DIRECTIONS:
                end_col, end_row = col + 3 * d_col, row + 3 * d_row
                if not (0 <= end_col < COLS and 0 <= end_row < ROWS):
                    continue
                if all(cells[(row + k * d_row) * COLS + col + k * d_col] == disc for k in (1, 2, 3)):
                    line = [[col + k * d_col, row + k * d_row] for k in range(4)]
                    return {'over': True, 'winner': disc, 'draw': False, 'line': line}
    full = '.' not in cells
    return {'over': full, 'winner': None, 'draw': full, 'line': None}


def legal_columns(state):
    """Columns (0..6) with room, ascending; empty when the game is over or the state is invalid."""
    if not _is_valid(state) or status(state)['over']:
        return []
    return [col for col in range(COLS) if state['cells'][col] == '.']


def drop(state, col):
    """New state with the side to move's disc dropped in `col` and the turn switched.

    Returns None for a full column, a finished game, or bad input.
    """
    col = _column(col)
    if col is None or not _is_valid(state) or state['cells'][col] != '.' or status(state)['over']:
        return None
    cells = state['cells']
    for row in range(ROWS - 1, -1, -1):  # the lowest empty cell of the column
        i = row * COLS + col
        if cells[i] == '.':
            return {
                'cells': cells[:i] + state['turn'] + cells[i + 1:],
                'turn': 'y' if state['turn'] == 'r' else 'r',
            }
    return None  # unreachable: the top cell was empty
