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
- **Sound.** Ambient town and indoor music, fireplace crackle, dance songs and
  effects through Web Audio (`av/audio.js`, CC0 files in `audio/`). Music dips
  while someone nearby talks. The speaker icon switches music and effects.

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
```

Controls: arrows/WASD (or tap) to walk, X to interact, Enter to chat, B bubble,
M/V mic/camera, 1–4 emotes, 5 dance, P people, +/− zoom. On the pitch: arrows/WASD
to run, Space (or X, E, K) to kick.

`tools/strip_preview.py` renders the Möbius strip's maths to a contact sheet for tuning
`engine/mobius.js`; `art/audio-src/build_audio.py` rebuilds the audio from its CC0 sources.

## License

MIT, see `LICENSE`. Art, fonts, music and sound effects are CC0; see `CREDITS.md`.
