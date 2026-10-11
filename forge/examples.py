"""Example specs for `town.py examples`: start from the closest one."""
from __future__ import annotations

import json

COURT = {
  'title': 'Beach volleyball court',
  'note': 'Walk onto the sand and press X to join a match. Space hits the ball, Q jumps.',
  'map': 'town',
  'area': [44, 44, 15, 10],
  'paint': [
    {'material': 'sand', 'rect': [44, 44, 15, 9], 'edge': 'soft'},
    {'lines': 'volleyball', 'rect': [45, 45, 12, 7]},
  ],
  'items': [
    {'kind': 'bench', 'at': [45, 53], 'length': 3},
    {'kind': 'umbrella', 'at': [57, 46], 'colour': 'red'},
  ],
  'labels': [{'at': [51, 44], 'text': 'Beach Volleyball'}],
  'game': {'cartridge': 'volleyball', 'court': [45, 45, 12, 7], 'options': {'points': 11}},
}

GARDEN = {
  'title': 'Rose garden',
  'note': 'A quiet garden with a bench under the trees.',
  'map': 'town',
  'area': [5, 37, 8, 6],
  'paint': [
    {'material': 'path', 'rect': [8, 37, 2, 6], 'edge': 'soft'},
    {'material': 'meadow', 'rect': [5, 37, 3, 6], 'edge': 'hedge'},
    {'material': 'meadow', 'rect': [10, 37, 3, 6], 'edge': 'hedge'},
  ],
  'items': [
    {'kind': 'tree', 'at': [6, 38], 'seed': 7, 'season': 'blossom'},
    {'kind': 'flower_bed', 'at': [10, 38], 'w': 2, 'h': 2, 'colours': ['rose', 'pink', 'white']},
    {'kind': 'bench', 'at': [10, 41], 'length': 2},
    {'kind': 'lamp', 'at': [9, 37]},
  ],
}

ROOM = {
  'title': 'A brighter café with a courtyard',
  'note': 'Lighter walls and floor, and a little courtyard with a tree in the middle.',
  'map': 'cafe',
  'area': [1, 1, 14, 9],
  'hide': ['cafe_table@141,74', 'chair_wood_right_back@128,78', 'chair_wood_right_seat@128,81',
           'chair_wood_left_back@160,78', 'chair_wood_left_seat@160,81'],
  'paint': [
    {'material': 'plaster', 'colour': 'white', 'rect': [1, 1, 14, 2], 'edge': 'none'},
    {'material': 'wood_light', 'rect': [1, 3, 14, 7], 'edge': 'none'},
    {'material': 'flagstones', 'rect': [7, 4, 4, 3], 'edge': 'curb'},
    {'material': 'grass', 'rect': [8, 5, 2, 1], 'edge': 'soft'},
  ],
  'items': [
    {'kind': 'tree', 'at': [8, 5], 'seed': 4},
    {'kind': 'flowers', 'at': [9, 5]},
    {'kind': 'plant', 'at': [7, 4], 'seed': 2},
  ],
  'mood': {'brightness': 0.4, 'warmth': 0.15},
  'glows': [{'at': [8, 4], 'radius': 3, 'colour': '#fff6d8'}],
}

SURPRISE = {
  'title': "Sam's birthday",
  'note': 'Decorations for Sam. When Sam walks in, the lights come up and everyone sings.',
  'map': 'cafe',
  'area': [1, 3, 14, 7],
  'surprise_for': ['@sam'],
  'expires': '2026-10-13T00:00:00+01:00',
  'items': [
    {'kind': 'banner', 'at': [6, 3], 'length': 4, 'text': 'HAPPY BIRTHDAY SAM', 'colour': 'pink'},
    {'kind': 'balloons', 'at': [3, 4], 'colours': ['pink', 'gold', 'sky'], 'count': 5},
    {'kind': 'balloons', 'at': [14, 4], 'colours': ['mint', 'pink', 'lilac'], 'count': 4},
    {'kind': 'gifts', 'at': [11, 7]},
    {'kind': 'bunting', 'at': [2, 3], 'length': 12, 'colours': ['pink', 'gold', 'sky', 'mint']},
  ],
  'triggers': [{
    'when': 'enter', 'where': 'room', 'who': ['@sam'], 'once': 'per_person', 'everyone_sees': True,
    'do': [
      {'lights': 'dim', 'seconds': 2},
      {'wait': 1.5},
      {'lights': 'party', 'seconds': 12},
      {'banner': 'HAPPY BIRTHDAY, SAM!', 'sub': 'From all of us in Möbius Town', 'seconds': 7},
      {'effect': 'confetti', 'seconds': 6},
      {'sound': 'fanfare'},
      {'music': 'disco', 'seconds': 90},
    ],
  }],
  'interactions': [{'at': [[11, 8], [12, 8]], 'prompt': 'Open your present',
                    'do': [{'effect': 'sparkles', 'seconds': 3}, {'sound': 'sparkle'},
                           {'say': 'A coupon for one free dance with everyone in town.', 'title': 'For Sam'}]}],
}

EXAMPLES = [('A playable court (the net is added by the game)', COURT), ('A small garden', GARDEN),
            ('Redecorating a room (hide furniture, repaint, light)', ROOM),
            ('A birthday surprise that plays when Sam walks in', SURPRISE)]


def text() -> str:
  out = []
  for title, spec in EXAMPLES:
    out.append(f'--- {title}\n{json.dumps(spec, indent=1, ensure_ascii=False)}')
  return '\n\n'.join(out)
