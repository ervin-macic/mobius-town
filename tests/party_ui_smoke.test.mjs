// Static smoke test for the party challenge UI (ui/Party.jsx, ui/partyCss.js).
//
//   node --test tests/party_ui_smoke.test.mjs
//
// Node cannot load JSX without a build step and this project has no bundler, so
// nothing is rendered here: the test reads Party.jsx as text and imports the
// plain-JS stylesheet, guarding the things that drift silently (class names,
// keyframes, runtime imports, the action vocabulary shared with party.py).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PARTY_CSS } from '../ui/partyCss.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const source = read('../ui/Party.jsx')

/** Top-level [prelude, body] blocks of a stylesheet, comments removed. */
function blocks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  let depth = 0
  let mark = 0
  let prelude = ''
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '{') {
      if (depth === 0) {
        prelude = clean.slice(mark, i).trim()
        mark = i + 1
      }
      depth++
    } else if (clean[i] === '}') {
      depth--
      if (depth === 0) {
        out.push([prelude, clean.slice(mark, i)])
        mark = i + 1
      }
    }
  }
  assert.equal(depth, 0, 'balanced braces')
  return out
}

function assertScoped(prelude) {
  for (const selector of prelude.split(',')) {
    assert.ok(selector.trim().startsWith('.mt-party'), `unscoped selector: ${selector.trim()}`)
  }
}

test('every party rule is scoped to an .mt-party class', () => {
  const all = blocks(PARTY_CSS)
  assert.ok(all.length > 40)
  for (const [prelude, body] of all) {
    if (prelude.startsWith('@keyframes')) assert.match(prelude, /^@keyframes mt-party-[\w-]+$/)
    else if (prelude.startsWith('@media')) blocks(body).forEach(([inner]) => assertScoped(inner))
    else assertScoped(prelude)
  }
})

test('every mt-party class the overlay uses has a rule', () => {
  const used = new Set(source.match(/mt-party(?:-[a-z0-9_]+)*/g))
  assert.ok(used.size > 30)
  for (const cls of used) assert.match(PARTY_CSS, new RegExp(`\\.${cls}(?![\\w-])`), `no rule for .${cls}`)
})

test('every animation uses a keyframe defined beside it', () => {
  const defined = new Set([...PARTY_CSS.matchAll(/@keyframes (mt-party-[\w-]+)/g)].map((m) => m[1]))
  const used = [...PARTY_CSS.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]).filter((name) => name !== 'none')
  assert.ok(used.length > 5)
  for (const name of used) assert.ok(defined.has(name), `undefined keyframes ${name}`)
})

test('reduced motion turns the party animations off', () => {
  assert.match(PARTY_CSS, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*animation: none !important/)
  assert.match(source, /prefers-reduced-motion: reduce/)
  assert.match(source, /!reducedMotion && <Confetti \/>/)
})

test('the overlay imports only modules the app runtime provides', () => {
  const allowed = new Set(JSON.parse(read('../mobius.json')).runtime?.imports || [])
  const imports = [...source.matchAll(/^import\s[\s\S]*?\sfrom\s+'([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual([...new Set(imports)].sort(), ['@openai/apps-sdk-ui/components/Icon', 'react'])
  for (const name of imports) assert.ok(allowed.has(name), `${name} is not in mobius.json runtime.imports`)
})

test('exports PartyOverlay as the default with the agreed props', () => {
  assert.match(source, /export default function PartyOverlay\(\{ party, me, serverNow, onAction, onClose \}\)/)
})

test('no emoji, and every button declares its type', () => {
  assert.doesNotMatch(source, /\p{Extended_Pictographic}/u)
  const buttons = [...source.matchAll(/<button\b/g)]
  assert.ok(buttons.length >= 8)
  for (const m of buttons) {
    const element = source.slice(m.index, source.indexOf('</button>', m.index))
    assert.match(element, /\stype="(button|submit)"/, element.slice(0, 120))
  }
})

test('the overlay sends exactly the actions party.py accepts', () => {
  const sent = new Set([...source.matchAll(/\{ type: '([a-z]+)'/g)].map((m) => m[1]))
  const table = read('../party.py').match(/_ACTIONS = \{([\s\S]*?)\}/)
  assert.ok(table, 'party.py has an _ACTIONS table')
  const accepted = new Set([...table[1].matchAll(/'([a-z]+)':/g)].map((m) => m[1]))
  assert.deepEqual([...sent].sort(), [...accepted].sort())
})
