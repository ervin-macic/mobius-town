---
name: mobius-town-builder
description: Build or change things in Möbius Town for a Möbian — a playable court, a garden, a redecorated room, a surprise when someone walks in. Read it when a chat starts with "Möbius Town build", or when someone asks to add, change or remove something in Möbius Town.
---

# Building in Möbius Town

Möbius Town is a shared pixel-art town. A **creation** is something a Möbian
asked for: art on the ground, props, walls, light, signs, effects, surprises,
or a playable court game. You describe it as a small JSON **spec**; the town's
kit draws it in the town's own pixel-art style and it appears live for every
Möbian in town, with no reload. Speed matters: the person is standing in town
watching a construction site. Quality matters too: it must look like it always
belonged there.

The kit lives in the installed app: `KIT=/data/apps/mobius-town/forge`.
Everything below is `python3 $KIT/town.py <command>`.

## The fast path (most requests: 3–5 steps)

1. `town.py look SITE` — the request, where the person stands and faces, an
   ASCII map of the surroundings with coordinates, furniture keys, nearby
   creations, people, and a picture path (`look.png`). Look at the picture for
   anything bigger than a single prop.
2. Write the spec (below) to a file in `$TMPDIR`. Start from the closest
   example in `town.py examples`.
3. `town.py build SITE spec.json` — compiles, checks the rules, publishes it
   live, and prints a preview picture path plus warnings. Look at the preview.
   If something is off, fix the spec and run the same command again: it
   replaces the creation in place.
4. Reply in one or two sentences: what you built and how to use it. The town
   shows your `note` to everyone.

For long work (a new game, many custom sprites) send progress so the
construction site shows it: `town.py progress SITE "Writing the rules" --pct 30
--eta 180`. Don't send progress for a 30-second build.

Ask a question (a normal question card) only when the request truly can't be
done without the answer — e.g. two Möbians share the name you were given.
Otherwise pick sensible defaults and say what you chose.

## Coordinates

- Tiles are 16 px. `[x, y]` is a tile; `[x, y, w, h]` a rectangle of tiles.
- `look` prints the map with column numbers on top and row numbers on the
  left. `@` is the person. "In front of me" means the free area they face,
  starting one or two tiles ahead; its "free rectangles" are ready answers.
  `^` marks walkable tiles under tall scenery (tree canopies, masts, roofs):
  avoid building there, because things would hide under it or poke through.
- An item's `at` is the top-left tile of its footprint. Tall things (trees,
  lamps) stand on their footprint and rise above it.

## The spec

```json
{
  "title": "Beach volleyball court",
  "note": "Walk onto the sand and press X to join. Space hits the ball.",
  "map": "town",
  "area": [40, 44, 14, 9],
  "paint": [
    {"material": "sand", "rect": [41, 45, 12, 7], "edge": "soft"},
    {"lines": "volleyball", "rect": [41, 45, 12, 7]}
  ],
  "items": [
    {"kind": "net", "at": [47, 45], "length": 7, "vertical": true},
    {"kind": "bench", "at": [42, 52], "length": 3},
    {"kind": "sprite", "name": "flag", "at": [40, 44]},
    {"kind": "image", "src": "trophy.png", "at": [53, 44]}
  ],
  "labels": [{"at": [47, 44], "text": "Beach Volleyball"}],
  "game": {"cartridge": "volleyball", "court": [41, 45, 12, 7]}
}
```

Fields (all optional except `title`, `map`, `area`):

| Field | What it does |
|---|---|
| `title` | Short name (≤ 60 characters). Shown in the town's creation list and toasts. |
| `note` | One or two sentences for people: how to use it (≤ 200). |
| `map` | `town` or an interior: `cafe`, `chess`, `den`, `cinema`, `hall`. |
| `area` | The footprint you claim, in tiles. Everything you place must be inside it. Keep it tight: others build next to you. |
| `paint` | Flat ground art, drawn in order: `{"material", "rect"/"cells"/"disc", "edge"}` or `{"lines", "rect", "colour"}`. |
| `items` | Props: kit items, atlas sprites, or your own images (see Kit). |
| `walls` | Lines that block walking: `{"from": [x,y], "to": [x,y], "style": "fence_wood"}`; straight lines only. |
| `hide` | Base furniture to remove (in your area or right beside it), by the key `look` prints (`cafe_table@141,74`). Frees its tiles and seats. Game tables, doors, the TV, the stage and signs can't be hidden. For a big area, `look` suggests which trees or rocks to hide. |
| `wall_decor` | Inside, rows 1-2 are the wall band. Repainting it keeps the room's windows, pictures and menu boards (`"keep"`, the default); `"remove"` clears them. |
| `mood` | Room light: `{"brightness": -1..1, "warmth": -1..1, "tint": "#rrggbb"}`. Applies to the room/map it is in. "Lighter" ≈ brightness 0.3–0.5; "cosy evening" ≈ brightness -0.35, warmth 0.5. |
| `glows` | Soft lights: `{"at": [x,y], "radius": tiles, "colour": "#rrggbb", "flicker": false}`. |
| `labels` | Map labels like the house names: `{"at": [x,y], "text"}` (≤ 32 characters). |
| `interactions` | Walk up and press X: `{"at": [[x,y], …], "prompt": "Open the present", "do": [actions]}`. |
| `triggers` | Things that happen by themselves: see Triggers. |
| `surprise_for` | `["@handle", …]`: hidden from these people (in the world and in lists) until one of your triggers fires for them. |
| `music` | A song playing around it: `{"song": "disco", "at": [x,y], "radius": 6}`. |
| `game` | A court game: `{"cartridge": "volleyball" or "mygame.js", "court": [x,y,w,h], "options": {}}`. |
| `expires` | ISO time when it removes itself (birthday decorations, an event). |

Files (`image` items, `.js` cartridges) are paths relative to the spec file.

## Kit

`town.py kit` prints the live catalogue: every item kind with its parameters
and footprint, every paint material and line set, atlas sprite names, effects,
sounds and songs. Use it rather than guessing names.

- **Kit items** (`{"kind": "tree", "at": [x,y], …params}`) are drawn by the
  town's art kit in its palette: nature, furniture, party, sport, structures,
  lights and signs (signs take your text). Most have `colour`/`seed`/`size`.
  Every item accepts `"solid": false` (walk through it) or an explicit
  `"solid": [[x,y], …]`, `"flip": true`, and `"offset": [dx, dy]` (pixels,
  ±32) to nudge it, e.g. a picture onto a wall.
- **Atlas sprites** (`{"kind": "sprite", "name": "bench", "at": […]}`) are the
  town's existing art (houses, stalls, barrels, statues, plants…).
- **Your own images** (`{"kind": "image", "src": "x.png", "at": […]}`) for
  anything the kit lacks. Draw them with Python and the town's palette so they
  match: `import sys; sys.path.insert(0, "$KIT"); from art import *` gives the
  palette, `outline()`, `shade()`, the 3x5 pixel font and every kit item as a
  starting point. Rules: transparent PNG, 1:1 pixels (no scaling, no
  anti-aliasing), dark plum outline `OUT`, light from the upper left, at most
  256×256. Optional `"frames": n, "fps": 6` for a horizontal strip animation.
  Asset Commons (`asset_commons_search`) has CC0 pixel art; credit it in `note`.

Paint `edge`: `soft` (default: a natural, slightly irregular border), `curb`
(stone kerb), `hedge`, or `none`.

## Actions (used by interactions and triggers)

```json
{"say": "Happy birthday, Sam!", "title": "A card from your friends"}
{"banner": "HAPPY BIRTHDAY SAM!", "sub": "From all of us", "focus": [x, y], "seconds": 6}
{"effect": "confetti", "at": [x, y], "seconds": 4}
{"sound": "fanfare"}
{"music": "disco", "seconds": 60}
{"lights": "dim" | "on" | "flash" | "party", "seconds": 8}
{"reveal": true}
{"emote": "heart"}
{"wait": 1.5}
```

Effects: `confetti`, `fireworks`, `sparkles`, `hearts`, `balloons`, `bubbles`,
`snow`, `petals`, `stars`. Sounds: `fanfare`, `chime`, `win`, `sparkle`, `pop`,
`coin`, `splash`, `whoosh`, `door`, `click`. Songs: `disco`, `minstrel`,
`flowerbed`, `tropical`. Actions run in order; `wait` pauses between them.

## Triggers

```json
{"when": "enter", "where": "room", "who": ["@sam"], "once": "per_person",
 "everyone_sees": true, "do": [ … actions … ]}
```

- `when`: `enter` (walks into `where`), or `near` (comes within `radius` tiles
  of `at`).
- `where`: `room` (the room the creation is in), `map`, or `[x,y,w,h]`.
- `who`: `"anyone"` or a list of `@handle`s (preferred; `look` lists the
  Möbians the town knows) or display names.
- `once`: `per_person` (default), `ever`, or `always`.
- `everyone_sees`: Möbians in the same place see the effects too.
- `from` / `until`: optional ISO times.

A birthday surprise: decorate, set `surprise_for` to the person, and add an
`enter` trigger for them that dims the lights, waits, turns them on with a
`banner`, `confetti`, `fanfare` and a song, with `everyone_sees: true`.

## Court games

Any game played on a court by up to two teams (bots fill empty places), like
the Football Ground: walk onto the court and press X to join; a short lobby;
one player's browser runs the match and streams it to the others.

- **Ready-made**: `volleyball`. Use `"game": {"cartridge": "volleyball",
  "court": rect}`; options in `town.py kit --games`.
- **New games**: write a cartridge — a JavaScript file assigning a `game`
  object — by copying `$KIT/../games/cartridges/volleyball.js` and following
  the contract at its top (`meta`, `init`, `step`, `bot`, `snapshot`,
  `restore`, `view`). Test it with `town.py test-game mygame.js` until it
  passes: it plays bot matches at high speed and checks the contract, timing
  and snapshot size. Cartridges run in a sandbox (no network, no page, no
  storage); draw only through `view()`'s primitives.
- Paint the court and add its props (net, hoops, goals) as ordinary items;
  the cartridge draws the players and the ball.

## Quality

- Match the town: its palette, dark outlines, three-step shading, upper-left
  light. Prefer kit items; make custom images carefully.
- Leave paths walkable: never block a door, the tile in front of a door, a
  bridge or the only way between two places. `build` refuses blocked doors
  and warns when your walls cut a path.
- Keep a one-tile margin from other creations and buildings unless joining
  them is the point.
- Inside rooms there is little space: hide furniture you replace, keep seats
  usable and keep one clear walkway from the door.
- Put labels where they don't cover the thing they name (above it).
- Read the preview. Check edges, overlaps, depth (things in front of others)
  and that it looks good at a glance.

## Rules

- `look` says who may build here. Anyone in town may build unless the town
  keeper turned that off; a creation belongs to its builder, and the builder
  or the keeper can change or remove it.
- Limits: area up to 40×40 tiles, 200 items, 600 KB of art, 120 KB of game
  code. Text must be friendly; no personal data beyond names.
- Changing an existing creation: `town.py spec ID` writes its spec into
  `$TMPDIR`; edit it and run `town.py build SITE spec.json --replace ID`.
  Remove with `town.py remove ID`.

## Commands

| Command | |
|---|---|
| `look SITE` | Context for a build request (start here). |
| `kit [--games] [--kind NAME] [--find WORDS]` | The catalogue; `--find` searches items, paints and atlas sprites. |
| `examples` | Example specs (court, garden, room refresh, birthday surprise). |
| `build SITE spec.json [--draft] [--replace ID]` | Compile, check, publish (or only preview with `--draft`). |
| `progress SITE "text" [--pct N] [--eta SECONDS]` | Update the construction site. |
| `spec ID` / `remove ID` / `list` | Edit, remove, list creations. |
| `test-game file.js` | Test a court game cartridge. |
| `begin --map town --at X,Y "request"` | Start a site from an ordinary chat (the person must have visited the town recently). |
