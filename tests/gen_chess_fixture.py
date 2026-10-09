#!/usr/bin/env python3
"""Generate the cross-check fixtures that tests/rules.test.mjs replays through
the JS engines (and tests/test_rules.py replays through the Python ones).

    python3 tests/gen_chess_fixture.py          # rewrites both fixtures
    python3 tests/gen_chess_fixture.py --check  # exit 1 if they are out of date

Chess: deterministic pseudo-random games (seeded) played with chess_rules.py,
recorded per ply as [fen, legal moves, chosen move, san, status after the move]
in tests/fixtures/chess_crosscheck.json. The policy is biased towards the rare
rules (castling, en passant, promotions, mates) and several games start from
endgames so that every game-over reason shows up.

Connect Four: the same in miniature, in tests/fixtures/connect4_crosscheck.json.
"""

import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import chess_rules as chess  # noqa: E402
import connect4_rules as c4  # noqa: E402

SEED = 20261007
CHESS_PATH = os.path.join(HERE, 'fixtures', 'chess_crosscheck.json')
C4_PATH = os.path.join(HERE, 'fixtures', 'connect4_crosscheck.json')

# (start FEN, max plies, style). Game i uses CHESS_STARTS[i % len(CHESS_STARTS)].
# style 'repeat' makes both sides often undo their own last move -> repetitions;
# style 'stalemate' often plays a move that stalemates the opponent.
CHESS_STARTS = [
    (chess.START_FEN, 160, 'random'),
    ('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 100, 'random'),  # Kiwipete
    (chess.START_FEN, 120, 'repeat'),
    ('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 100, 'random'),  # perft position 3 (en passant pins)
    (chess.START_FEN, 160, 'random'),
    ('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 100, 'random'),  # position 4
    ('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 100, 'random'),  # position 5
    (chess.START_FEN, 160, 'random'),
    ('8/2p3P1/8/8/8/8/1P3p2/3K3k w - - 0 1', 120, 'random'),  # promotion race
    ('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', 80, 'random'),  # queen vs king: mates and stalemates
    ('k7/8/1K6/8/8/8/8/2Q5 w - - 0 1', 80, 'stalemate'),  # cornered king: stalemate traps
    ('8/8/4k3/3p4/3P4/4K3/8/8 w - - 0 1', 120, 'repeat'),  # blocked pawns: repetitions
    ('8/8/8/3k4/8/8/2R5/4K3 w - - 80 90', 60, 'random'),  # rook vs king near the fifty-move limit
    ('4k3/8/8/3b4/8/8/2N5/4K3 w - - 0 1', 120, 'random'),  # minor pieces: insufficient material
    ('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 100, 'random'),  # castling rights and rook captures
    ('rnbqkbnr/ppp1p1pp/8/3P1P2/8/8/PPP1P1PP/RNBQKBNR b KQkq - 0 3', 100, 'random'),  # en passant chances
    ('8/2n5/8/3k4/8/8/5N2/4K3 w - - 70 80', 60, 'random'),  # two knights: fifty-move rule
    ('8/5k2/8/8/8/8/1Q6/K7 w - - 0 1', 100, 'stalemate'),  # queen vs king, stalemate-prone
    ('4k3/8/2b5/8/8/3P4/8/4KB2 w - - 0 1', 100, 'random'),  # same-coloured bishops once the pawn goes
]
CHESS_GAMES = 200

# Sample states stored verbatim: the Python dicts and the JS objects must be the
# same JSON, so a server can ship its state to the browser engine unchanged.
SAMPLE_STATE_FENS = [
    chess.START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1',
    '8/8/8/K2pP2r/8/8/8/4k3 w - d6 0 1',
]


def compact_moves(moves):
    """Sorted UCI moves -> compact string: moves sharing a from-square are grouped
    ('e2e3e4' = e2e3 e2e4) and the four promotions to one square are written
    'e8*' (= e8b e8n e8q e8r, in that sorted order)."""
    groups = []
    i = 0
    while i < len(moves):
        frm = moves[i][:2]
        group = frm
        while i < len(moves) and moves[i][:2] == frm:
            move = moves[i]
            if len(move) == 5:
                promos = [m[4] for m in moves[i:i + 4] if m[:4] == move[:4]]
                assert promos == ['b', 'n', 'q', 'r'], moves
                group += move[2:4] + '*'
                i += 4
            else:
                group += move[2:4]
                i += 1
        groups.append(group)
    return ' '.join(groups)


def expand_moves(text):
    """Inverse of compact_moves (kept here so the encoding is tested both ways)."""
    moves = []
    for group in text.split(' ') if text else []:
        frm, rest = group[:2], group[2:]
        j = 0
        while j < len(rest):
            to = rest[j:j + 2]
            j += 2
            if j < len(rest) and rest[j] == '*':
                moves.extend(frm + to + p for p in 'bnqr')
                j += 1
            else:
                moves.append(frm + to)
    return moves


def encode_status(st):
    """Lossless short form of game_status(): 'turn check over result reason'."""
    return ' '.join((st['turn'], '1' if st['check'] else '0', '1' if st['over'] else '0',
                     st['result'] or '-', st['reason'] or '-'))


def lands_beside_enemy_pawn(state, move):
    """A double pawn push that ends next to an enemy pawn (an en passant chance)."""
    mover = chess.piece_at(state, move[:2])
    if mover['type'] != 'p' or abs(int(move[1]) - int(move[3])) != 2:
        return False
    for file_step in (-1, 1):
        f = ord(move[2]) + file_step
        if ord('a') <= f <= ord('h'):
            neighbour = chess.piece_at(state, chr(f) + move[3])
            if neighbour and neighbour['type'] == 'p' and neighbour['color'] != mover['color']:
                return True
    return False


def choose_chess_move(rng, state, moves, style, own_last_move):
    """Random move, biased towards promotions, castling, en passant, mates and captures."""
    if style == 'repeat' and own_last_move and rng.random() < 0.6:
        undo = own_last_move[2:4] + own_last_move[:2]
        if undo in moves:
            return undo
    promotions = [m for m in moves if len(m) == 5]
    if promotions and rng.random() < 0.9:
        return rng.choice(promotions)
    special, captures, pushes = [], [], []
    for move in moves:
        mover = chess.piece_at(state, move[:2])
        target = chess.piece_at(state, move[2:4])
        if mover['type'] == 'k' and abs(ord(move[0]) - ord(move[2])) == 2:
            special.append(move)  # castling
        elif mover['type'] == 'p' and move[0] != move[2] and target is None:
            special.append(move)  # en passant
        elif target is not None:
            captures.append(move)
        elif lands_beside_enemy_pawn(state, move):
            pushes.append(move)
    if special and rng.random() < 0.7:
        return rng.choice(special)
    if pushes and rng.random() < 0.5:
        return rng.choice(pushes)
    if style == 'stalemate' and rng.random() < 0.5:
        stalemates = [m for m in moves if chess.game_status(chess.apply_move(state, m))['reason'] == 'stalemate']
        if stalemates:
            return rng.choice(stalemates)
    if rng.random() < 0.3:
        mates = [m for m in moves if chess.game_status(chess.apply_move(state, m))['reason'] == 'checkmate']
        if mates:
            return rng.choice(mates)
    if captures and rng.random() < 0.5:
        return rng.choice(captures)
    return rng.choice(moves)


def play_chess_game(rng, start, max_plies, style):
    state = chess.parse_fen(start)
    positions = [chess.position_key(state)]
    plies = []
    while len(plies) < max_plies:
        moves = chess.legal_moves(state)
        own_last_move = plies[-2][2] if len(plies) >= 2 else None
        move = choose_chess_move(rng, state, moves, style, own_last_move)
        fen = chess.to_fen(state)
        san = chess.move_to_san(state, move)
        state = chess.apply_move(state, move)
        positions.append(chess.position_key(state))
        st = chess.game_status(state, positions)
        assert st['over'] == (st['result'] is not None) and st['turn'] == state['turn']
        assert expand_moves(compact_moves(moves)) == moves
        plies.append([fen, compact_moves(moves), move, san, encode_status(st)])
        if st['over']:
            break
    return {'start': start, 'plies': plies, 'final': chess.to_fen(state)}


def plan_c4_draw(rng, state, budget):
    """Columns that fill the board without anyone completing a four (randomised
    depth-first search with a node budget), or None."""
    cols = c4.legal_columns(state)
    if not cols:
        return [] if c4.status(state)['draw'] else None
    rng.shuffle(cols)
    for col in cols:
        if budget[0] <= 0:
            return None
        budget[0] -= 1
        after = c4.drop(state, col)
        if c4.status(after)['winner']:
            continue
        rest = plan_c4_draw(rng, after, budget)
        if rest is not None:
            return [col] + rest
    return None


def play_c4_game(rng, seek_draw):
    state = c4.new_game()
    plan = None
    for _ in range(50 if seek_draw else 0):  # random restarts beat one long search
        plan = plan_c4_draw(rng, state, [300])
        if plan:
            break
    plies = []
    while True:
        cols = c4.legal_columns(state)
        if not cols:
            break
        col = plan[len(plies)] if plan else rng.choice(cols)
        before = state
        state = c4.drop(state, col)
        st = c4.status(state)
        plies.append([before['cells'], before['turn'], ''.join(map(str, cols)), col,
                      [st['over'], st['winner'], st['draw'], st['line']]])
    return {'plies': plies, 'final': [state['cells'], state['turn']]}


def dump(data, games_key):
    """JSON with one game per line: compact, yet diff-friendly."""
    head = {k: v for k, v in data.items() if k != games_key}
    lines = [json.dumps(g, separators=(',', ':')) for g in data[games_key]]
    body = json.dumps(head, separators=(',', ':'))[:-1]
    return body + ',"' + games_key + '":[\n' + ',\n'.join(lines) + '\n]}\n'


def build():
    rng = random.Random(SEED)
    chess_games = []
    for i in range(CHESS_GAMES):
        start, max_plies, style = CHESS_STARTS[i % len(CHESS_STARTS)]
        chess_games.append(play_chess_game(rng, start, max_plies, style))
    chess_data = {
        'about': 'Generated by tests/gen_chess_fixture.py from chess_rules.py; do not edit by hand.',
        'format': {
            'ply': '[fen before the move, legal moves (compact), move (UCI), SAN, status after the move]',
            'legal': "moves grouped by from-square: 'e2e3e4' = e2e3 e2e4; 'e7e8*' = e7e8b e7e8n e7e8q e7e8r",
            'status': "'turn check over result reason' with 0/1 flags and '-' for null",
            'positions': 'game_status() receives position_key() of every position since the start',
            'states': '[fen, parse_fen(fen)] pairs; the JS state objects must be identical JSON',
        },
        'seed': SEED,
        'states': [[fen, chess.parse_fen(fen)] for fen in SAMPLE_STATE_FENS],
        'games': chess_games,
    }
    c4_rng = random.Random(SEED + 4)
    c4_games = [play_c4_game(c4_rng, seek_draw=(i % 4 == 3)) for i in range(60)]
    c4_data = {
        'about': 'Generated by tests/gen_chess_fixture.py from connect4_rules.py; do not edit by hand.',
        'format': {
            'ply': '[cells before, turn before, legal columns as digits, column played, '
                   '[over, winner, draw, line] after the drop]',
            'final': '[cells, turn] after the last ply',
        },
        'seed': SEED + 4,
        'games': c4_games,
    }
    return dump(chess_data, 'games'), dump(c4_data, 'games'), chess_games, c4_games


def summary(chess_games, c4_games):
    reasons, sans = {}, {'castle': 0, 'ep': 0, 'promo': 0, 'underpromo': 0, 'check': 0, 'mate': 0}
    plies = 0
    for game in chess_games:
        plies += len(game['plies'])
        reason = game['plies'][-1][4].split(' ')[4]
        reasons[reason] = reasons.get(reason, 0) + 1
        for fen, _, move, san, _ in game['plies']:
            sans['castle'] += san.startswith('O-O')
            sans['promo'] += '=' in san
            sans['underpromo'] += '=' in san and '=Q' not in san
            sans['check'] += san.endswith('+')
            sans['mate'] += san.endswith('#')
            state = chess.parse_fen(fen)
            if chess.piece_at(state, move[:2])['type'] == 'p' and move[0] != move[2] \
                    and chess.piece_at(state, move[2:4]) is None:
                sans['ep'] += 1
    c4_results = {}
    for game in c4_games:
        st = game['plies'][-1][4]
        key = 'draw' if st[2] else ('win' if st[0] else 'open')
        c4_results[key] = c4_results.get(key, 0) + 1
    return ('chess: %d games, %d plies, endings %s, moves %s\nconnect4: %d games, %s'
            % (len(chess_games), plies, dict(sorted(reasons.items())), sans, len(c4_games), c4_results))


def main():
    chess_text, c4_text, chess_games, c4_games = build()
    if '--check' in sys.argv:
        stale = [p for p, text in ((CHESS_PATH, chess_text), (C4_PATH, c4_text))
                 if not os.path.exists(p) or open(p, encoding='utf-8').read() != text]
        if stale:
            print('out of date: ' + ', '.join(stale))
            return 1
        print('fixtures are up to date')
        return 0
    os.makedirs(os.path.dirname(CHESS_PATH), exist_ok=True)
    for path, text in ((CHESS_PATH, chess_text), (C4_PATH, c4_text)):
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(text)
        print('wrote %s (%d bytes)' % (os.path.relpath(path), len(text.encode('utf-8'))))
    print(summary(chess_games, c4_games))
    return 0


if __name__ == '__main__':
    sys.exit(main())
