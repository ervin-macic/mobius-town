"""The town's pixel-art toolkit, for builders drawing their own sprites.

    import sys; sys.path.insert(0, '/data/apps/mobius-town/forge')
    from art import *

gives the palette (OUT, GRASS, WOOD, STONE, ...), drawing helpers (new, rect, put,
hline, vline, frame, disc_mask, fill_mask, outline, shade, mix, recolor, pad),
the 3x5 pixel font (GLYPHS, draw_text_bitmap, text_width) and every prop the
town was built from (`props.tree(seed)`, `props.lamp()`, ...). Everything draws
on Pillow RGBA images at 1:1 pixel scale: no scaling, no anti-aliasing, dark
plum outlines, light from the upper left.
"""
from __future__ import annotations

import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parent.parent / 'tools'
if str(_TOOLS) not in sys.path:
  sys.path.insert(0, str(_TOOLS))

from pixel import *  # noqa: E402,F401,F403
from pixel import GLYPHS, draw_text_bitmap  # noqa: E402,F401
import props  # noqa: E402,F401


def text_width(text: str) -> int:
  """Width in pixels of `text` in the 3x5 pixel font (one pixel between letters)."""
  w = 0
  for ch in text:
    g = GLYPHS.get(ch.upper())
    w += (len(g[0]) if g else 3) + 1
  return max(0, w - 1)
