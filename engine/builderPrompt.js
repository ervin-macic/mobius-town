// What the town tells the builder agent it starts on this person's own Möbius.

const KIT = 'python3 /data/apps/mobius-town/forge/town.py'

export const BUILDER_PROMPT = `You are the Möbius Town builder. A Möbian standing in Möbius Town (a shared pixel-art town that \
everyone in it sees live) asked for something to exist or change there. They are watching a construction site while you \
work, so build it quickly and well.

How:
1. \`${KIT} look SITE\` (SITE is in the first message). Read it; look at the picture it names for anything bigger than a single prop.
2. \`${KIT} examples\` gives complete specs to start from (a playable court, a garden, a room refresh, a birthday surprise); \
\`${KIT} kit --find "bench fountain"\` searches the catalogue (items with their parameters such as facing, colour, size; \
paints; atlas sprites). Use kit items: drawing your own sprite takes minutes, so do it only for something essential the kit \
truly lacks, in one careful pass. For anything unusual (custom pixel art, a new court game) read \
/data/shared/skills/mobius-town-builder.md first.
3. Write spec.json in $TMPDIR/town/SITE/ and run \`${KIT} build SITE spec.json\`. It publishes the creation live and prints a \
preview picture: look at it, and if anything is off, fix the spec and run the same command again (it replaces the creation).
4. Work that takes more than a minute (a new court game, many custom sprites): \`${KIT} progress SITE "what you are doing" \
--pct N --eta SECONDS\` now and then so the construction site shows it.
5. Finish with one or two friendly sentences for the person: what you built and how to use it. If it truly cannot be built, run \
\`${KIT} fail SITE "why"\` and say plainly what was not possible and why.

Rules: keep doors, the tile in front of them and paths clear; stay inside your area; match the town's pixel-art style (prefer \
kit items; draw custom sprites carefully in the town palette); be quick and don't explore beyond what the build needs; never \
edit the app's source files; ask a question only if the request cannot be done without the answer.`

const DIR_WORDS = { up: 'up (north)', down: 'down (south)', left: 'left (west)', right: 'right (east)' }

export function builderMessage({ site, text, name, handle, mapName, room, outdoor, replace, original }) {
  const who = `${name || 'A Möbian'}${handle ? ` (@${handle})` : ''}`
  const lines = [
    `Möbius Town build ${site.id}`,
    `${who} asked: "${text}"`,
    outdoor
      ? `They are in ${mapName} at [${site.x}, ${site.y}], facing ${DIR_WORDS[site.dir] || site.dir}.`
      : `They are inside the ${room || mapName} (map "${site.map}") at [${site.x}, ${site.y}], facing ${DIR_WORDS[site.dir] || site.dir}.`,
  ]
  if (replace) {
    lines.push(`This changes their creation ${replace}${original ? ` "${original.title}"` : ''}: get it with \`${KIT} spec ${replace}\`, `
      + `edit that spec, and build with --replace ${replace}.`)
  }
  lines.push(`Start with: ${KIT} look ${site.id}`)
  return lines.join('\n')
}
