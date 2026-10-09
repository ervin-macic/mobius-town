"""The female town character, drawn from the same CC0 hero sheet as the male one.

Every frame keeps the hero's body, face and animation, so both characters move
and recolour identically. Three edits make the female version:

- long hair with a fringe, from per-direction pixel templates placed on each
  frame's head (the head bobs a pixel while walking, so templates follow the
  frame's top row);
- a skirt: the tunic hem and the trousers become one flared piece in the
  trousers colours, so the "trousers" choice colours the skirt;
- belt and shoes move one shade off the hair browns they share in the source
  art, so this sheet can recolour hair at any height (long hair reaches the
  shoulders, below where the male sheet must stop).

Template symbols: `.` erases old hair or outline (never body pixels), `k` keeps
the original pixel, and the letters below set a source colour.
"""
from PIL import Image

FRAME_W, FRAME_H = 16, 32
# Columns the town draws: the walk cycle and the arms-up pair (waving, dancing).
WALK_COLS = (0, 1, 2, 3)
ARMS_UP_COLS = (9, 10, 11, 12)
ROWS = {'down': 0, 'right': 1, 'up': 2, 'left': 3}

COLOURS = {
  'A': (23, 23, 23, 255),     # outline
  'h': (106, 72, 52, 255),    # hair, light
  'H': (67, 46, 39, 255),     # hair, dark
  's': (232, 212, 178, 255),  # skin, light
  'S': (191, 167, 135, 255),  # skin, dark
  'p': (101, 101, 155, 255),  # trousers (here the skirt), main
  'P': (85, 134, 185, 255),   # trousers, highlight
}
HAIR = {COLOURS['h'][:3], COLOURS['H'][:3]}
SHIRT = {(196, 60, 60), (136, 46, 46), (104, 28, 28)}
PANTS = {COLOURS['p'][:3], COLOURS['P'][:3]}
OUTLINE = COLOURS['A'][:3]
# The source art paints belts and shoes in the hair browns; nudge them aside.
FIXED_BROWN = {COLOURS['h'][:3]: (107, 73, 53), COLOURS['H'][:3]: (68, 47, 40)}

# Rows from the frame's top row (its first non-empty row).
DOWN = [
  '................',
  '.....AAAAAA.....',
  '...AAhhhhhhAA...',
  '..AhhhhhhhhhhA..',
  '.AhhhhhhhhhhhHA.',
  '.AhhhhhHhhhhhHA.',
  '.AhHHSssssSHHhA.',
  '.AhSAssssssAShA.',
  '.AhssAssssAsshA.',
  '.AhssAssssAsshA.',
  '.AhSssssssssShA.',
  '.AhASssssssSAhA.',
  '.AhkkkkkkkkkkhA.',
  '.AHkkkkkkkkkkHA.',
]
UP = [
  '................',
  '................',
  '.....AAAAAA.....',
  '...AAhhhhhhAA...',
  '..AhhhhhhhhhhA..',
  '.AhhhhhhhhhhhHA.',
  '.AhhhhhhhhhhhHA.',
  '.AhhhhhhhhhhHHA.',
  '.AhhhhhhhhhhHHA.',
  '.AhHhhhhhhhhHHA.',
  '.AhHhhhhhhhHHHA.',
  '.AhHhhhhhhhHHHA.',
  '.AhHHhhhhhHHHHA.',
  '..AHHHhhhHHHHA..',
]
RIGHT = [
  '................',
  '.....AAAAAA.....',
  '...AAhhhhhhAA...',
  '..AhhhhhhhhhhA..',
  '.AhhhhhhhhhhhHA.',
  '.Ahhhhhkkkkkkkkk',
  '.Ahhhhhkkkkkkkkk',
  '.AhhhhHkkkkkkkkk',
  '.AhhhhHkkkkkkkkk',
  '.AhhhHHkkkkkkkkk',
  '.AhhhHHkkkkkkkkk',
  '.AhhHHAkkkkkkkkk',
  '..AhHHAkkkkkkkkk',
  '..AHHAAkkkkkkkkk',
  '...AAkkkkkkkkkkk',
]
LEFT = [row[::-1] for row in RIGHT]
# The source's left-facing head outlines its fringe in black; draw that row as
# the right-facing one shows it (forehead, then the fringe).
LEFT[5] = '.AHSSSHHhhhhhhA.'
TEMPLATES = {'down': DOWN, 'up': UP, 'right': RIGHT, 'left': LEFT}


def _keep_outside(template, first_row, cols):
  """With arms raised, long hair stays clear of the hands: below `first_row`
  only the columns in `cols` are redrawn."""
  out = []
  for r, row in enumerate(template):
    if r < first_row:
      out.append(row)
    else:
      out.append(''.join(c if x in cols else 'k' for x, c in enumerate(row)))
  return out


ARMS_UP = {
  'down': _keep_outside(DOWN, 6, range(3, 13)),
  'up': _keep_outside(UP, 6, range(4, 12)),
  'right': _keep_outside(RIGHT, 6, range(0, 5)),
  'left': _keep_outside(LEFT, 6, range(11, 16)),
}


def _rgb(px):
  return px[:3] if px[3] else None


def _top_row(frame):
  for y in range(FRAME_H):
    if any(frame.getpixel((x, y))[3] for x in range(FRAME_W)):
      return y
  return 0


def _apply(frame, template, top):
  for r, row in enumerate(template):
    y = top + r
    if y >= FRAME_H:
      break
    for x, c in enumerate(row):
      if c == 'k':
        continue
      old = _rgb(frame.getpixel((x, y)))
      if c == '.':
        if old is None or old in HAIR or old == OUTLINE:
          frame.putpixel((x, y), (0, 0, 0, 0))
      else:
        frame.putpixel((x, y), COLOURS[c])


def _fix_browns(frame):
  for y in range(FRAME_H):
    for x in range(FRAME_W):
      px = frame.getpixel((x, y))
      if px[3] and px[:3] in FIXED_BROWN and y >= 17:
        frame.putpixel((x, y), (*FIXED_BROWN[px[:3]], px[3]))


def _skirt(frame):
  """Turn the tunic hem and the trousers below it into one flared skirt."""
  legs = [y for y in range(FRAME_H) if any(_rgb(frame.getpixel((x, y))) in PANTS for x in range(FRAME_W))]
  if not legs:
    return
  # A leg swung forward can reach a row higher; the hem closes the lowest leg row.
  hem = legs[-1]
  # The row above it (the tunic's hem) becomes the skirt's waist.
  waist = [x for x in range(FRAME_W) if _rgb(frame.getpixel((x, hem - 1))) in SHIRT]
  for x in waist:
    frame.putpixel((x, hem - 1), COLOURS['P'] if x == waist[0] else COLOURS['p'])
  # The legs row becomes one closed hem, a pixel wider on each side.
  solid = [x for x in range(FRAME_W) if _rgb(frame.getpixel((x, hem))) not in (None, (42, 43, 53))]
  if not solid:
    return
  left, right = min(solid), max(solid)
  left, right = max(0, left - 1), min(FRAME_W - 1, right + 1)
  for x in range(left, right + 1):
    if x in (left, right):
      frame.putpixel((x, hem), COLOURS['A'])
    else:
      # Lit from the left, like the rest of the sprite.
      frame.putpixel((x, hem), COLOURS['P'] if x - left <= 2 else COLOURS['p'])


def female_sheet(male):
  """The female sheet: same size and layout as `male`."""
  sheet = male.convert('RGBA').copy()
  for direction, row in ROWS.items():
    for col in WALK_COLS + ARMS_UP_COLS:
      box = (col * FRAME_W, row * FRAME_H, (col + 1) * FRAME_W, (row + 1) * FRAME_H)
      frame = sheet.crop(box)
      if not any(frame.getpixel((x, y))[3] for x in range(FRAME_W) for y in range(FRAME_H)):
        continue
      top = _top_row(frame)
      _fix_browns(frame)
      template = ARMS_UP[direction] if col in ARMS_UP_COLS else TEMPLATES[direction]
      _apply(frame, template, top)
      _skirt(frame)
      sheet.paste(frame, box[:2])
  return sheet
