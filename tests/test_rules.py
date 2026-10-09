"""Tests for chess_rules.py and connect4_rules.py (stdlib unittest only).

    python3 -m unittest tests/test_rules.py -v
    CHESS_SLOW_PERFT=1 python3 -m unittest tests/test_rules.py -v   # adds deeper perft (~30 s)

tests/rules.test.mjs runs the same cases against the JS engines and replays the
cross-check fixtures; here the fixtures are replayed through the Python engines
so a change to either side that breaks agreement is caught on both.
"""

import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import chess_rules as chess  # noqa: E402
import connect4_rules as c4  # noqa: E402
from gen_chess_fixture import expand_moves, encode_status  # noqa: E402

START = chess.START_FEN
KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'
POSITION_3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'
POSITION_4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'
POSITION_4_MIRRORED = 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1'
POSITION_5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'
POSITION_6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10'
SLOW = os.environ.get('CHESS_SLOW_PERFT') == '1'


def perft(state, depth):
    """Leaf count through the public API (bulk-counted at the last ply)."""
    moves = chess.legal_moves(state)
    if depth == 1:
        return len(moves)
    return sum(perft(chess.apply_move(state, move), depth - 1) for move in moves)


def play(fen, moves):
    """Apply UCI moves; returns (state, position keys including the start)."""
    state = chess.parse_fen(fen)
    positions = [chess.position_key(state)]
    for move in moves:
        nxt = chess.apply_move(state, move)
        assert nxt is not None, 'illegal move %s in %s' % (move, chess.to_fen(state))
        state = nxt
        positions.append(chess.position_key(state))
    return state, positions


def status(fen, positions=None):
    return chess.game_status(chess.parse_fen(fen), positions)


class ChessPerftTest(unittest.TestCase):
    def check(self, fen, counts):
        state = chess.parse_fen(fen)
        for depth, expected in enumerate(counts, 1):
            with self.subTest(fen=fen, depth=depth):
                self.assertEqual(perft(state, depth), expected)

    def test_start_position(self):
        self.check(START, [20, 400, 8902, 197281])

    def test_kiwipete(self):
        self.check(KIWIPETE, [48, 2039, 97862])

    def test_position_3(self):
        self.check(POSITION_3, [14, 191, 2812, 43238])

    def test_position_5(self):
        self.check(POSITION_5, [44, 1486, 62379])

    def test_position_4_and_its_mirror(self):
        self.check(POSITION_4, [6, 264, 9467, 422333])
        self.check(POSITION_4_MIRRORED, [6, 264, 9467, 422333])

    def test_position_6(self):
        self.check(POSITION_6, [46, 2079, 89890])

    @unittest.skipUnless(SLOW, 'set CHESS_SLOW_PERFT=1 for the deep perft runs (~30 s)')
    def test_deep_perft(self):
        self.assertEqual(perft(chess.parse_fen(START), 5), 4865609)
        self.assertEqual(perft(chess.parse_fen(KIWIPETE), 4), 4085603)
        self.assertEqual(perft(chess.parse_fen(POSITION_3), 5), 674624)
        self.assertEqual(perft(chess.parse_fen(POSITION_5), 4), 2103487)
        self.assertEqual(perft(chess.parse_fen(POSITION_6), 4), 3894594)


class ChessFenTest(unittest.TestCase):
    def test_round_trips(self):
        for fen in (START, KIWIPETE, POSITION_3, POSITION_4, POSITION_4_MIRRORED, POSITION_5, POSITION_6,
                    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
                    '8/8/8/K2pP2r/8/8/8/4k3 w - d6 0 1',
                    '4k3/8/8/8/8/8/8/4K3 b - - 99 123456'):
            with self.subTest(fen=fen):
                self.assertEqual(chess.to_fen(chess.parse_fen(fen)), fen)

    def test_state_shape(self):
        state = chess.parse_fen(START)
        self.assertEqual(len(state['board']), 64)
        self.assertEqual(state['board'][0], 'r')   # a8
        self.assertEqual(state['board'][60], 'K')  # e1
        self.assertIsNone(state['board'][36])      # e4
        self.assertEqual((state['turn'], state['castling'], state['ep'], state['halfmove'], state['fullmove']),
                         ('w', 'KQkq', None, 0, 1))

    def test_surrounding_whitespace_is_ignored(self):
        self.assertEqual(chess.to_fen(chess.parse_fen('  ' + START + '\n')), START)

    def test_invalid_fens_raise(self):
        bad = [
            None, 42, '', 'not a fen',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',          # missing counters
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 x',    # extra field
            'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',        # 7 ranks
            'rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',     # 9 squares
            'rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',       # 7 squares
            'rnbqkbnr/pppppppp/44/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',     # adjacent digits
            'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',      # bad digit
            'rnbqkbnr/pppppppp/8/8/3x4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',    # bad piece
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',      # bad side
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w QK - 0 1',        # castling order
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkqK - 0 1',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w KQkq - 0 1',      # K right without h1 rook
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1',     # ep rank wrong for side
            'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e4 0 1',   # ep not on rank 3
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq e3 0 1',     # ep without pushed pawn
            'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq e3 0 1',   # ep origin square occupied
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - -1 1',     # bad halfmove
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 01 1',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 0',      # bad fullmove
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1.5',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1BNR w kq - 0 1',        # no white king
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKKBNR w kq - 0 1',        # two white kings
            'rnbqkbnP/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQq - 0 1',       # pawn on the last rank
            '4k3/8/8/8/8/8/8/4R1K1 w - - 0 1',                               # side not to move in check
        ]
        for fen in bad:
            with self.subTest(fen=fen):
                with self.assertRaises(ValueError):
                    chess.parse_fen(fen)

    def test_piece_at_and_king_square(self):
        state = chess.parse_fen(START)
        self.assertEqual(chess.piece_at(state, 'e1'), {'color': 'w', 'type': 'k'})
        self.assertEqual(chess.piece_at(state, 'd8'), {'color': 'b', 'type': 'q'})
        self.assertEqual(chess.piece_at(state, 'g7'), {'color': 'b', 'type': 'p'})
        for square in ('e4', 'z9', 'e', '', None, 'E2'):
            self.assertIsNone(chess.piece_at(state, square))
        self.assertEqual(chess.king_square(state, 'w'), 'e1')
        self.assertEqual(chess.king_square(state, 'b'), 'e8')
        self.assertIsNone(chess.king_square(state, 'x'))
        self.assertEqual(chess.king_square(chess.parse_fen(KIWIPETE), 'b'), 'e8')

    def test_position_key_drops_counters(self):
        state, _ = play(START, ['g1f3'])
        self.assertEqual(chess.position_key(state), 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -')


class ChessMoveTest(unittest.TestCase):
    def test_start_moves_sorted(self):
        moves = chess.legal_moves(chess.parse_fen(START))
        self.assertEqual(moves, sorted(moves))
        self.assertEqual(moves[:4], ['a2a3', 'a2a4', 'b1a3', 'b1c3'])
        self.assertIn('e2e4', moves)

    def test_apply_move_rejects_garbage(self):
        state = chess.parse_fen(START)
        for move in (None, '', 'e2', 'e2e4e', 'e2e4 ', 'z9z9', 'E2E4', 'e2e5', 'e7e5', 'e2e2', 'e2e4q',
                     123, ['e2e4'], {'from': 'e2'}):
            with self.subTest(move=move):
                self.assertIsNone(chess.apply_move(state, move))
        self.assertIsNone(chess.apply_move(None, 'e2e4'))
        self.assertIsNone(chess.apply_move({}, 'e2e4'))
        self.assertIsNone(chess.apply_move('garbage', 'e2e4'))

    def test_functions_never_mutate_their_input(self):
        state = chess.parse_fen(KIWIPETE)
        snapshot = copy.deepcopy(state)
        for move in chess.legal_moves(state):
            chess.apply_move(state, move)
            chess.move_to_san(state, move)
        chess.game_status(state, [chess.position_key(state)])
        chess.to_fen(state)
        self.assertEqual(state, snapshot)

    def test_counters(self):
        state, _ = play(START, ['g1f3'])
        self.assertEqual((state['halfmove'], state['fullmove'], state['turn']), (1, 1, 'b'))
        state, _ = play(START, ['g1f3', 'g8f6'])
        self.assertEqual((state['halfmove'], state['fullmove']), (2, 2))
        state, _ = play(START, ['g1f3', 'g8f6', 'e2e4'])  # pawn move resets
        self.assertEqual(state['halfmove'], 0)
        state, _ = play(START, ['e2e4', 'd7d5', 'g1f3', 'b8c6', 'e4d5'])  # capture resets
        self.assertEqual((state['halfmove'], state['fullmove']), (0, 3))


class ChessCastlingTest(unittest.TestCase):
    def moves(self, fen):
        return chess.legal_moves(chess.parse_fen(fen))

    def test_blocked(self):
        self.assertNotIn('e1g1', self.moves(START))
        moves = self.moves('r3k2r/8/8/8/8/8/8/RN2K1NR w KQkq - 0 1')
        self.assertNotIn('e1g1', moves)  # g1 occupied
        self.assertNotIn('e1c1', moves)  # b1 occupied: it must be empty even though the king skips it
        black = self.moves('r3k2r/8/8/8/8/8/8/RN2K1NR b KQkq - 0 1')
        self.assertIn('e8g8', black)
        self.assertIn('e8c8', black)

    def test_through_and_into_check(self):
        moves = self.moves('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1')  # f1 attacked
        self.assertNotIn('e1g1', moves)
        self.assertIn('e1c1', moves)
        moves = self.moves('4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1')  # g1 attacked
        self.assertNotIn('e1g1', moves)
        self.assertIn('e1c1', moves)
        moves = self.moves('4k3/8/8/8/8/8/3r4/R3K2R w KQ - 0 1')  # d1 attacked
        self.assertIn('e1g1', moves)
        self.assertNotIn('e1c1', moves)

    def test_b1_may_be_attacked(self):
        moves = self.moves('4k3/8/8/8/8/8/1r6/R3K2R w KQ - 0 1')
        self.assertIn('e1c1', moves)
        self.assertIn('e1g1', moves)

    def test_not_out_of_check(self):
        moves = self.moves('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1')
        self.assertNotIn('e1g1', moves)
        self.assertNotIn('e1c1', moves)
        self.assertIn('e1e2', moves)

    def test_castling_moves_the_rook(self):
        fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
        state, _ = play(fen, ['e1g1'])
        self.assertEqual(chess.to_fen(state), 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1')
        state, _ = play(fen, ['e1c1', 'e8g8'])
        self.assertEqual(chess.to_fen(state), 'r4rk1/8/8/8/8/8/8/2KR3R w - - 2 2')
        state, _ = play(fen, ['e1g1', 'e8c8'])
        self.assertEqual(chess.to_fen(state), '2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2')

    def test_rights_lost_by_moves_and_captures(self):
        fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
        self.assertEqual(play(fen, ['h1h2'])[0]['castling'], 'Qkq')
        self.assertEqual(play(fen, ['a1a2', 'h8h7'])[0]['castling'], 'Kq')
        self.assertEqual(play(fen, ['e1e2'])[0]['castling'], 'kq')
        self.assertEqual(play(fen, ['a1a8'])[0]['castling'], 'Kk')  # rook takes rook: both lose a right
        # A bishop capturing the h1 rook removes White's king-side right for good.
        state, _ = play('4k3/8/8/8/8/8/6b1/R3K2R b KQ - 0 1', ['g2h1'])
        self.assertEqual(state['castling'], 'Q')
        self.assertNotIn('e1g1', chess.legal_moves(state))
        self.assertIn('e1c1', chess.legal_moves(state))

    def test_san(self):
        state = chess.parse_fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
        self.assertEqual(chess.move_to_san(state, 'e1g1'), 'O-O')
        self.assertEqual(chess.move_to_san(state, 'e1c1'), 'O-O-O')
        self.assertEqual(chess.move_to_san(chess.parse_fen('5k2/8/8/8/8/8/8/4K2R w K - 0 1'), 'e1g1'), 'O-O+')


class ChessEnPassantTest(unittest.TestCase):
    def test_capture(self):
        state, _ = play('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['e2e4'])
        self.assertEqual(chess.to_fen(state), '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1')
        self.assertIn('d4e3', chess.legal_moves(state))
        self.assertEqual(chess.move_to_san(state, 'd4e3'), 'dxe3')
        after = chess.apply_move(state, 'd4e3')
        self.assertEqual(chess.to_fen(after), '4k3/8/8/8/8/4p3/8/4K3 w - - 0 2')
        self.assertIsNone(chess.piece_at(after, 'e4'))

    def test_expiry(self):
        state, _ = play('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['e2e4', 'e8e7'])
        self.assertIsNone(state['ep'])
        state = chess.apply_move(state, 'e1d1')
        self.assertNotIn('d4e3', chess.legal_moves(state))
        self.assertIsNone(chess.apply_move(state, 'd4e3'))

    def test_ep_square_only_recorded_when_capture_is_legal(self):
        state, _ = play(START, ['e2e4'])  # no black pawn next to e4
        self.assertEqual(chess.to_fen(state), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
        # The capture would expose White's king on a5 to the rook on h5.
        state, _ = play('8/3p4/8/K3P2r/8/8/8/4k3 b - - 0 1', ['d7d5'])
        self.assertEqual(chess.to_fen(state), '8/8/8/K2pP2r/8/8/8/4k3 w - - 0 2')

    def test_capture_exposing_own_king_is_illegal(self):
        state = chess.parse_fen('8/8/8/K2pP2r/8/8/8/4k3 w - d6 0 1')  # horizontal pin through both pawns
        self.assertNotIn('e5d6', chess.legal_moves(state))
        self.assertIsNone(chess.apply_move(state, 'e5d6'))
        self.assertEqual(chess.position_key(state), '8/8/8/K2pP2r/8/8/8/4k3 w - -')
        state = chess.parse_fen('4k3/6b1/8/3pP3/8/2K5/8/8 w - d6 0 1')  # diagonal pin of the capturer
        self.assertNotIn('e5d6', chess.legal_moves(state))
        self.assertNotIn('e5e6', chess.legal_moves(state))

    def test_capture_can_remove_a_checking_pawn(self):
        state = chess.parse_fen('8/8/8/3pP3/4K3/8/8/k7 w - d6 0 1')
        self.assertTrue(chess.game_status(state)['check'])
        self.assertIn('e5d6', chess.legal_moves(state))
        self.assertEqual(chess.move_to_san(state, 'e5d6'), 'exd6')
        self.assertNotIn('e5d6', chess.legal_moves(chess.parse_fen('8/8/8/3pP3/4K3/8/8/k7 w - - 0 1')))

    def test_position_key_keeps_usable_ep(self):
        state, _ = play('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['e2e4'])
        self.assertEqual(chess.position_key(state), '4k3/8/8/8/3pP3/8/8/4K3 b - e3')
        classic = chess.parse_fen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')
        self.assertEqual(chess.position_key(classic), 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -')


class ChessPromotionTest(unittest.TestCase):
    def test_each_piece(self):
        state = chess.parse_fen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1')
        moves = chess.legal_moves(state)
        for piece, san in (('q', 'e8=Q'), ('r', 'e8=R'), ('b', 'e8=B'), ('n', 'e8=N')):
            with self.subTest(piece=piece):
                self.assertIn('e7e8' + piece, moves)
                self.assertEqual(chess.move_to_san(state, 'e7e8' + piece), san)
                self.assertEqual(chess.piece_at(chess.apply_move(state, 'e7e8' + piece), 'e8'),
                                 {'color': 'w', 'type': piece})
        self.assertNotIn('e7e8', moves)
        for move in ('e7e8', 'e7e8k', 'e7e8p', 'e7e8Q'):
            self.assertIsNone(chess.apply_move(state, move))

    def test_capture_promotion_san(self):
        state = chess.parse_fen('3r4/4Pk2/8/8/8/8/8/K7 w - - 0 1')
        self.assertEqual(chess.move_to_san(state, 'e7d8n'), 'exd8=N+')
        self.assertEqual(chess.move_to_san(state, 'e7d8q'), 'exd8=Q')
        self.assertEqual(chess.move_to_san(state, 'e7e8q'), 'e8=Q+')
        black = chess.parse_fen('4k3/8/8/8/8/8/p7/4K3 b - - 0 1')
        self.assertEqual(chess.move_to_san(black, 'a2a1q'), 'a1=Q+')
        self.assertEqual(chess.piece_at(chess.apply_move(black, 'a2a1n'), 'a1'), {'color': 'b', 'type': 'n'})


class ChessStatusTest(unittest.TestCase):
    def test_fools_mate(self):
        state, positions = play(START, ['f2f3', 'e7e5', 'g2g4'])
        self.assertEqual(chess.move_to_san(state, 'd8h4'), 'Qh4#')
        state = chess.apply_move(state, 'd8h4')
        self.assertEqual(chess.game_status(state, positions + [chess.position_key(state)]),
                         {'turn': 'w', 'check': True, 'over': True, 'result': '0-1', 'reason': 'checkmate'})
        self.assertEqual(chess.legal_moves(state), [])

    def test_white_wins_by_mate(self):
        state = chess.apply_move(chess.parse_fen('k7/8/1K6/8/8/8/8/2R5 w - - 0 1'), 'c1c8')
        self.assertEqual(chess.game_status(state)['result'], '1-0')

    def test_check_without_mate(self):
        state, _ = play(START, ['e2e4', 'd7d6'])
        self.assertEqual(chess.move_to_san(state, 'f1b5'), 'Bb5+')
        self.assertEqual(chess.game_status(chess.apply_move(state, 'f1b5')),
                         {'turn': 'b', 'check': True, 'over': False, 'result': None, 'reason': None})

    def test_stalemate(self):
        self.assertEqual(status('k7/8/1Q6/8/8/8/8/7K b - - 0 1'),
                         {'turn': 'b', 'check': False, 'over': True, 'result': '1/2-1/2', 'reason': 'stalemate'})
        state = chess.apply_move(chess.parse_fen('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1'), 'g1g6')
        self.assertEqual(chess.game_status(state)['reason'], 'stalemate')

    def test_threefold(self):
        shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
        state, positions = play(START, shuffle)
        self.assertFalse(chess.game_status(state, positions)['over'])  # start position seen twice
        state, positions = play(START, shuffle * 2)
        self.assertEqual(chess.game_status(state, positions),
                         {'turn': 'w', 'check': False, 'over': True, 'result': '1/2-1/2', 'reason': 'threefold'})
        self.assertFalse(chess.game_status(state)['over'])  # no history given: no repetition claim
        self.assertFalse(chess.game_status(state, [])['over'])

    def test_fifty_move_rule(self):
        state = chess.parse_fen('8/8/8/3k4/8/8/2R5/4K3 w - - 99 120')
        self.assertFalse(chess.game_status(state)['over'])
        after = chess.apply_move(state, 'c2c3')
        self.assertEqual(after['halfmove'], 100)
        self.assertEqual(chess.game_status(after),
                         {'turn': 'b', 'check': False, 'over': True, 'result': '1/2-1/2', 'reason': 'fifty'})

    def test_checkmate_beats_fifty_move_rule(self):
        state = chess.apply_move(chess.parse_fen('k7/8/1K6/8/8/8/8/2R5 w - - 99 80'), 'c1c8')
        self.assertEqual(state['halfmove'], 100)
        self.assertEqual(chess.game_status(state)['reason'], 'checkmate')

    def test_insufficient_material(self):
        drawn = {
            'K vs K': '8/8/4k3/8/8/4K3/8/8 w - - 0 1',
            'K+N vs K': '8/8/4k3/8/8/4K3/8/6N1 w - - 0 1',
            'K vs K+B': '8/8/4k3/8/2b5/4K3/8/8 w - - 0 1',
            'K+B vs K+B, same colour': '2b5/8/4k3/8/8/4K3/8/5B2 w - - 0 1',
            'K+2B vs K, same colour': '8/8/4k3/8/8/4K3/6B1/5B2 b - - 0 1',
        }
        playable = {
            'K+B vs K+B, opposite colours': '5b2/8/4k3/8/8/4K3/8/5B2 w - - 0 1',
            'K+N vs K+N': '8/8/4k3/8/8/4K3/8/5Nn1 w - - 0 1',
            'K+N vs K+B': '8/8/4k3/8/8/4K3/8/5Nb1 w - - 0 1',
            'K+2N vs K': '8/8/4k3/8/8/4K3/8/5NN1 w - - 0 1',
            'K+P vs K': '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1',
            'K+R vs K': '8/8/4k3/8/8/4K3/8/7R w - - 0 1',
        }
        for name, fen in drawn.items():
            with self.subTest(name):
                self.assertEqual(status(fen)['reason'], 'insufficient')
                self.assertEqual(status(fen)['result'], '1/2-1/2')
        for name, fen in playable.items():
            with self.subTest(name):
                self.assertFalse(status(fen)['over'])
        state = chess.parse_fen('4k3/8/8/3n4/8/8/6B1/4K3 w - - 0 1')
        self.assertEqual(chess.move_to_san(state, 'g2d5'), 'Bxd5')
        self.assertEqual(chess.game_status(chess.apply_move(state, 'g2d5'))['reason'], 'insufficient')


class ChessSanTest(unittest.TestCase):
    def test_disambiguation(self):
        knights = chess.parse_fen('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1')
        self.assertEqual(chess.move_to_san(knights, 'b1d2'), 'Nbd2')
        self.assertEqual(chess.move_to_san(knights, 'f3d2'), 'Nfd2')
        self.assertEqual(chess.move_to_san(knights, 'f3e5'), 'Ne5')
        rooks = chess.parse_fen('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1')
        self.assertEqual(chess.move_to_san(rooks, 'a1a3'), 'R1a3')
        self.assertEqual(chess.move_to_san(rooks, 'a5a3'), 'R5a3')
        queens = chess.parse_fen('8/8/1k6/8/4Q2Q/8/8/K6Q w - - 0 1')
        self.assertEqual(chess.move_to_san(queens, 'h4e1'), 'Qh4e1')
        self.assertEqual(chess.move_to_san(queens, 'h1e1'), 'Q1e1')
        self.assertEqual(chess.move_to_san(queens, 'e4e1'), 'Qee1')

    def test_pinned_rival_needs_no_disambiguation(self):
        self.assertEqual(chess.move_to_san(chess.parse_fen('4k3/8/8/8/8/2N5/8/4K1N1 w - - 0 1'), 'g1e2'), 'Nge2')
        self.assertEqual(chess.move_to_san(chess.parse_fen('4k3/8/8/b7/8/2N5/8/4K1N1 w - - 0 1'), 'g1e2'), 'Ne2')

    def test_basic_moves_and_illegal_input(self):
        state = chess.parse_fen(START)
        self.assertEqual(chess.move_to_san(state, 'g1f3'), 'Nf3')
        self.assertEqual(chess.move_to_san(state, 'e2e4'), 'e4')
        self.assertIsNone(chess.move_to_san(state, 'e2e5'))
        self.assertIsNone(chess.move_to_san(state, None))
        state, _ = play(START, ['e2e4', 'd7d5'])
        self.assertEqual(chess.move_to_san(state, 'e4d5'), 'exd5')
        self.assertEqual(chess.move_to_san(chess.parse_fen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'), 'e1e2'), 'Kxe2')


class Connect4Test(unittest.TestCase):
    def play(self, cols):
        state = c4.new_game()
        for col in cols:
            nxt = c4.drop(state, col)
            self.assertIsNotNone(nxt, 'column %s refused' % col)
            state = nxt
        return state

    def test_new_game(self):
        self.assertEqual(c4.new_game(), {'cells': '.' * 42, 'turn': 'r'})
        self.assertEqual((c4.COLS, c4.ROWS), (7, 6))
        self.assertEqual(c4.legal_columns(c4.new_game()), [0, 1, 2, 3, 4, 5, 6])
        self.assertEqual(c4.status(c4.new_game()), {'over': False, 'winner': None, 'draw': False, 'line': None})

    def test_drop_stacks_and_switches_turn(self):
        start = c4.new_game()
        state = c4.drop(start, 3)
        self.assertEqual(state, {'cells': '.' * 38 + 'r' + '...', 'turn': 'y'})
        state = c4.drop(state, 3)
        self.assertEqual(state['cells'][31], 'y')  # row 4, column 3
        self.assertEqual(state['turn'], 'r')
        self.assertEqual(start, c4.new_game())  # input untouched

    def test_horizontal_win(self):
        state = self.play([0, 0, 1, 1, 2, 2, 3])
        self.assertEqual(c4.status(state), {'over': True, 'winner': 'r', 'draw': False,
                                            'line': [[0, 5], [1, 5], [2, 5], [3, 5]]})

    def test_vertical_win(self):
        state = self.play([0, 1, 0, 1, 0, 1, 2, 1])
        self.assertEqual(c4.status(state), {'over': True, 'winner': 'y', 'draw': False,
                                            'line': [[1, 2], [1, 3], [1, 4], [1, 5]]})

    def test_diagonal_up_right_win(self):
        state = self.play([0, 1, 1, 2, 3, 2, 2, 3, 6, 3, 3])
        self.assertEqual(c4.status(state)['line'], [[0, 5], [1, 4], [2, 3], [3, 2]])
        self.assertEqual(c4.status(state)['winner'], 'r')

    def test_diagonal_down_right_win(self):
        state = self.play([6, 5, 5, 4, 3, 4, 4, 3, 0, 3, 3])
        self.assertEqual(c4.status(state)['line'], [[3, 2], [4, 3], [5, 4], [6, 5]])
        self.assertEqual(c4.status(state)['winner'], 'r')

    def test_no_moves_after_a_win(self):
        state = self.play([0, 0, 1, 1, 2, 2, 3])
        self.assertEqual(c4.legal_columns(state), [])
        for col in range(7):
            self.assertIsNone(c4.drop(state, col))

    def test_draw_on_full_board(self):
        draw = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3,
                3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 5]
        state = self.play(draw[:-1])
        self.assertFalse(c4.status(state)['over'])
        self.assertEqual(c4.legal_columns(state), [5])
        state = c4.drop(state, 5)
        self.assertEqual(state['cells'], 'yyrryyrrryyrryyyrryyrrryyrryyyrryyrrryyrry')
        self.assertEqual(c4.status(state), {'over': True, 'winner': None, 'draw': True, 'line': None})
        self.assertEqual(c4.legal_columns(state), [])

    def test_full_column(self):
        state = self.play([0, 0, 0, 0, 0, 0])
        self.assertIsNone(c4.drop(state, 0))
        self.assertEqual(c4.legal_columns(state), [1, 2, 3, 4, 5, 6])

    def test_bad_input(self):
        state = c4.new_game()
        for col in (-1, 7, 1.5, '3', None, True, [3]):
            with self.subTest(col=col):
                self.assertIsNone(c4.drop(state, col))
        self.assertEqual(c4.drop(state, 3.0), c4.drop(state, 3))  # JS cannot tell 3.0 from 3
        for bad in (None, {}, {'cells': 'x' * 42, 'turn': 'r'}, {'cells': '.' * 41, 'turn': 'r'},
                    {'cells': '.' * 42, 'turn': 'x'},
                    {'cells': 'r' + '.' * 41, 'turn': 'y'},              # floating disc
                    {'cells': '.' * 41 + 'r', 'turn': 'r'}):             # wrong side to move
            with self.subTest(state=bad):
                self.assertIsNone(c4.drop(bad, 0))
                self.assertEqual(c4.legal_columns(bad), [])
                with self.assertRaises(ValueError):
                    c4.status(bad)


class CrossCheckFixtureTest(unittest.TestCase):
    """The Python engines must reproduce the fixtures the JS tests compare against."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, 'fixtures', 'chess_crosscheck.json'), encoding='utf-8') as fh:
            cls.chess_fixture = json.load(fh)

    def test_states_are_plain_json(self):
        for fen, state in self.chess_fixture['states']:
            self.assertEqual(chess.parse_fen(fen), state)
            self.assertEqual(json.loads(json.dumps(chess.parse_fen(fen))), state)

    def test_chess_fixture(self):
        games = self.chess_fixture['games']
        self.assertGreaterEqual(len(games), 150)
        for g, game in enumerate(games):
            state = chess.parse_fen(game['start'])
            positions = [chess.position_key(state)]
            for p, (fen, legal, move, san, expected) in enumerate(game['plies']):
                where = 'game %d ply %d (%s)' % (g, p, fen)
                self.assertEqual(chess.to_fen(state), fen, where)
                self.assertEqual(chess.position_key(state), ' '.join(fen.split(' ')[:4]), where)
                self.assertEqual(chess.legal_moves(state), expand_moves(legal), where)
                self.assertEqual(chess.move_to_san(state, move), san, where)
                state = chess.apply_move(state, move)
                positions.append(chess.position_key(state))
                self.assertEqual(encode_status(chess.game_status(state, positions)), expected, where)
            self.assertEqual(chess.to_fen(state), game['final'])

    def test_connect4_fixture(self):
        with open(os.path.join(HERE, 'fixtures', 'connect4_crosscheck.json'), encoding='utf-8') as fh:
            games = json.load(fh)['games']
        for g, game in enumerate(games):
            state = c4.new_game()
            for p, (cells, turn, legal, col, expected) in enumerate(game['plies']):
                where = 'game %d ply %d' % (g, p)
                self.assertEqual(state, {'cells': cells, 'turn': turn}, where)
                self.assertEqual(c4.legal_columns(state), [int(ch) for ch in legal], where)
                state = c4.drop(state, col)
                st = c4.status(state)
                self.assertEqual([st['over'], st['winner'], st['draw'], st['line']], expected, where)
            self.assertEqual([state['cells'], state['turn']], game['final'])
            self.assertEqual(c4.legal_columns(state), [])


if __name__ == '__main__':
    unittest.main()
