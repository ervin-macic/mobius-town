# Möbius Town

A shared pixel-art town for everyone on Möbius, in the spirit of Gather Town;
everyone in it is a Möbian. Walk your avatar around a common map; Möbians'
voices (and video) fade in as you approach and fade out as you leave. Houses hold games, the Town Hall has
lockable meeting rooms and an auditorium with a spotlight, the Cinema's
screen puts on a YouTube video for everyone, and the Football Ground hosts
2 v 2 matches.

## What's in town

| Place | What happens |
|---|---|
| Plaza | Fountain, benches, market stall, town notice board (town-wide chat) |
| Chess Club | Two people inside → a chess game starts at a free table. Others watch. |
| Game Den | Same for Connect Four. Arcade cabinets for decoration. |
| Cinema | Walk to the screen, press X, paste a YouTube link. "Watch together" opens YouTube at the shared moment. |
| Café | Tables for small conversations. |
| Town Hall | Meeting Rooms A and B: everyone inside hears and sees each other, nobody outside does; lockable from inside, with knocking. Auditorium: whoever stands in the stage spotlight is heard and seen by the whole room and can share their screen; people in the room join as listeners automatically, without a microphone prompt. |
| Football Ground | Walk onto the pitch to join a 2 v 2 match; bots (easy, medium or hard) fill empty places. Three-minute matches, arrows/WASD to run, Space to kick, a thumb stick on phones. |
| Agent Office | Your own Möbius agents at work: the eight most recently active chats on your Möbius sit at the desks, typing if they were active in the last few minutes, otherwise drifting to the coffee machine, the window, the meeting table or the sofa. Walk up to one and press X to see what it was asked and its latest message, and to open its chat in Möbius (with a new prompt ready to send, if you write one) to stop it or reply. The directory by the door lists everyone. Private: everyone who walks in gets an office of their own. |

Conversation **bubbles** (B): wrap yourself and everyone within a few steps.
Inside the bubble you hear each other clearly; people outside still hear you
faintly. Rules live in `av/proximity.js`.

Also in town:

- **Characters.** Pick a male or a female character on the first screen, then skin,
  hair, shirt and trousers (a skirt for the female character) colours.
- **Seats.** Walk onto any chair, sofa or bench to sit; a direction key stands you up.
- **Bots.** At a chess or Connect Four table with nobody opposite, play an easy,
  medium or hard bot (`games/chessbot.js`, `games/c4bot.js`).
- **Party challenge.** From the People list, challenge anyone to three quick games:
  Quick Draw, Rock–Paper–Scissors and Speed Sprint (`party.py`, `ui/Party.jsx`).
  The hub keeps each party's secrets and sends every player only their own view.
- **Events.** The calendar schedules lightning-talk nights, meetups and game nights;
  a running 5-minute talk counts down on the auditorium stage board.
- **Cats.** Five cats wander, nap and sit around town on a shared clock, so everyone
  sees the same cat in the same place; walk up and pet one (`engine/cats.js`).
- **Little moments.** View the statue, toss a coin in the fountain, admire the
  rotating Möbius strip in the Möbius Garden; dance (5) to a song you pick.
- **Map and teleport.** A minimap in the corner shows the place you are in, with a
  dot for every Möbian there. Click it (or press N) for the town map: everyone online,
  outdoors where they stand and indoors as a count on their building, each with a
  Teleport button. You leave in a column of light and beam down beside them, and the
  people at both ends see it. A meeting room locked without you stops you at its door
  (knock to be let in); someone in their private office, outside its building. The
  rules live in `engine/teleport.js`, the light in `engine/beam.js`.
- **The Agent Office** (`agentOffice.js`, `engine/office.js`, `net/agents.js`,
  `ui/Office.jsx`). Its map is flagged `private`: a player inside it is not in
  anyone else's world (`Town.leaveWorld`), so nobody is drawn, heard or linked
  across offices, while the People list and the town map show them at the
  office door. Agents are read from the player's own Möbius through the
  chat-history permission (titles, what each was asked, latest messages and
  when each was last active) and never sent to the hub. Möbius gives apps no
  live "working" or "waiting for you" status, so the office shows recency,
  never a guessed state; stopping an agent or sending it a prompt happens in
  Möbius's own chat, which the office opens.
- **Sound.** Ambient town and indoor music, fireplace crackle, dance songs and
  effects through Web Audio (`av/audio.js`, CC0 files in `audio/`). Music dips
  while someone nearby talks. The speaker icon switches music and effects.

## Building: change the town by asking

Walk somewhere and press **Create** (the sparkle button, or C). Say what you
would like to exist or change: "a volleyball court in front of me that we can
all play on", "make this room lighter, with a small courtyard and a tree",
"decorate the café for Sam's birthday and surprise Sam when they walk in".
A builder agent starts on *your own* Möbius (your AI subscription), a
construction site with progress appears on the spot for every Möbian, and the
result appears for everyone in town, live, without a reload. Simple things
take under a minute; something new, like a game nobody has played here yet, a
few minutes. Ask for changes or undo it from the same panel.

- **What can be built**: ground art (materials, court lines), props from a kit
  of parametric pixel-art items drawn in the town's own palette, the town's
  sprites, custom sprites the builder draws, walls and fences, seats, room
  light and glows, labels, music, things to press X at, effects (confetti,
  fireworks, banners, party lights), triggers ("when Sam walks in…"), surprises
  hidden from the person they are for until they happen, and **court games**.
- **Court games** work like the Football Ground: walk onto the court and press
  X to join, bots fill empty places, one player's browser runs the match.
  Volleyball ships ready-made; builders write new games as JavaScript
  *cartridges* (`games/cartridges/`, contract in `games/court-sdk.js`). A
  cartridge runs in every player's browser inside a sealed Web Worker with no
  access to their account, the page or the network.
- **Rules**: anyone in town may build (the town keeper, whose Möbius hosts the
  town, can switch building to keeper-only); a creation shows who made it;
  its builder or the keeper can change or remove it. Nothing may block a door,
  a game table or the stage, and creations don't overlap other people's.
- **How**: the town opens a *build site* on the hub, then starts an
  owner-visible builder chat. The builder runs `forge/town.py`: `look` prints
  the surroundings (an ASCII map with coordinates, free spots, furniture,
  people) and a picture; it writes a small JSON spec; `build` draws it with the
  kit (`forge/kit*.py`, Pillow), checks it, renders a preview, and publishes it.
  The hub (`creations.py`) checks everything again (every picture is decoded)
  and bumps a creations version that every town sees on its next sync; towns
  fetch the bodies they need and lay them over the maps (`engine/creations.js`,
  `engine/building.js`). The agent-facing guide is `mobius-town-builder.md`
  (installed as a Möbius skill).

## How it works

- **Hub.** One installation (`HUB_HOST` in `service.py`) keeps the shared world
  in SQLite (`hub.py`): presence, a signalling mailbox, and a versioned world
  document (room locks, bubbles, the TV, table games with server-validated
  rules, town chat, events, party challenges). Every other installation's service forwards its player's
  requests there after a one-time identity proof (the same federation pattern
  as Ball Game's leaderboard), so nobody can join under someone else's handle.
- **Movement** flows directly between browsers over WebRTC data channels
  (`net/mesh.js`); the hub's sync (every 1.1–3 s) is the fallback for pairs that
  cannot connect directly. The platform allows an app service about 120 requests
  a minute per address (60 on the public route other installations use), so the
  client polls gently and peers nudge each other over the direct link when
  something changes; a 429 answer means "wait a moment", not "offline".
- **Voice and video** use the Möbius `media.call` host capability: the shell
  owns the microphone, camera, peer connections, playback and video painting;
  the app relays signalling and sets per-person volume and tile positions. The
  app never touches a media stream. When presenting, the shared screen takes
  your camera's place; the browser's own picker chooses what is shared.
- **Football** is host-authoritative over the same peer-to-peer links: the first
  player in the line-up simulates the match (`games/football.js`, a fixed 60 Hz
  step) and sends snapshots; others send their stick and kick. The hub keeps the
  line-up, the host (handed on if they leave) and the result (`engine/match.js`).
- **Art** is the CC0 "Zelda-like tilesets and sprites" pack by ArMM1998 plus
  procedural props drawn in its palette and a female character drawn from the
  pack's hero (`tools/female.py`), composed by `tools/build_world.py`
  into `engine/world.gen.js` (maps, sprite atlas) and `world_meta.py` (facts
  the hub needs). Fonts: Kenney Fonts (CC0). See `CREDITS.md`.

## Requirements

Any Möbius. Voice, video and screen sharing use the Möbius `media.call`
capability, which is under review upstream
([mobius-os/mobius#1774](https://github.com/mobius-os/mobius/pull/1774)). Until
a Möbius release includes it, this version leaves `media.call` out of
`mobius.json`, so the town installs everywhere and runs without voice and
video; walking, chat, games, football and everything else work. The call code
is already in the town and turns on as soon as the manifest declares
`"media.call": {"version": 1, "limits": {"max_peers": 12}}` on a Möbius that
provides it.

The Agent Office reads your chats with the `chat_log_access: "summary"`
permission (titles, short excerpts and recent messages, server-side redacted).
Möbius asks you to allow it when installing from the Store; for a local
install, grant it in the app's settings. Without it, the office stays empty
and says why; everything else works.

## Hosting

Everyone who installs this package joins the same town, kept by the installation
named `HUB_HOST` in `service.py`. To run a separate town of your own, change
`HUB_HOST` to your Möbius's address before installing; your players then join
your hub instead. The hub's service is public (`"access": "public"`) so other
installations can reach it, and every request from another installation first
proves which Möbius user it acts for.

## Developing

```bash
python3 tools/build_world.py --preview /tmp/town   # rebuild maps; PNG previews in /tmp/town
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.mjs
python3 forge/kit_preview.py /tmp/kit.png          # contact sheet of the builder's art kit
node forge/cartridge_test.mjs games/cartridges/volleyball.js   # test a court game
```

Controls: arrows/WASD (or tap) to walk, X to interact, Enter to chat, B bubble,
M/V mic/camera, 1–4 emotes, 5 dance, P people, N town map (teleport), C create, +/− zoom.
On the pitch: arrows/WASD to run, Space (or X, E, K) to kick.

`tools/strip_preview.py` renders the Möbius strip's maths to a contact sheet for tuning
`engine/mobius.js`; `art/audio-src/build_audio.py` rebuilds the audio from its CC0 sources.

## License

MIT, see `LICENSE`. Art, fonts, music and sound effects are CC0; see `CREDITS.md`.
