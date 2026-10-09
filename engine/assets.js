// Image loading and avatar recolouring.
//
// Every image is a data URL from world.gen.js, so canvases stay untainted and
// avatars can be recoloured with getImageData even inside the opaque app frame.
import { WORLD } from './world.gen.js'

export const T = WORLD.tile
export const FRAME_W = 16
export const FRAME_H = 32
// Feet sit this many pixels below the top of a character frame.
export const FEET_Y = 26

const cache = new Map()

export function loadImage(src) {
  if (cache.has(src)) return cache.get(src)
  const promise = new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('An image failed to load.'))
    img.src = src
  })
  cache.set(src, promise)
  return promise
}

export const loadAtlas = () => loadImage(WORLD.atlas)
// The two characters share one layout: [male, female], indexed by `look.body`.
export const loadCharacters = () => Promise.all([loadImage(WORLD.character), loadImage(WORLD.characterFemale)])
export const loadGround = (mapId) => loadImage(WORLD.maps[mapId].ground)

// --- Appearance ------------------------------------------------------------------------

export const PALETTES = {
  skin: [
    ['#ffe1c0', '#d9ae8a'], ['#e8d4b2', '#bfa787'], ['#d0a07a', '#a77654'],
    ['#a06a48', '#7a4c32'], ['#6e4630', '#4c2f21'],
  ],
  hair: [
    ['#6a4834', '#432e27'], ['#3a3540', '#211e26'], ['#eac25e', '#b98b37'], ['#cf6436', '#913e24'],
    ['#d6d6e0', '#9a9aab'], ['#ef84b4', '#b04a80'], ['#6488e0', '#3c58a4'], ['#6cbc6a', '#3e7e42'],
  ],
  shirt: [
    ['#c43c3c', '#882e2e', '#681c1c'], ['#3c7ad6', '#2c5aa0', '#1e3e72'], ['#3fae5a', '#2c8042', '#1e5a2e'],
    ['#f0c43a', '#c0922a', '#8e6a1e'], ['#8e5ad6', '#6640a4', '#482c76'], ['#2fb5b0', '#1f8582', '#155e5c'],
    ['#f08a3a', '#c0622a', '#8e461e'], ['#eeeef2', '#b8b8c6', '#8a8a9c'], ['#3c3c48', '#2a2a34', '#1c1c24'],
    ['#ee7aa8', '#c0507c', '#8e3458'],
  ],
  pants: [
    ['#65659b', '#5586b9'], ['#4a4a56', '#6c6c7c'], ['#7a5a3c', '#9c7c56'], ['#b8a678', '#d4c49a'],
    ['#2c2c36', '#46465a'], ['#3c7a5a', '#5c9c7c'],
  ],
}

// `body` picks the character: 0 male, 1 female. Looks saved before it existed are male.
export const BODIES = ['Male', 'Female']
const LOOK_SIZES = {
  body: BODIES.length, skin: PALETTES.skin.length, hair: PALETTES.hair.length,
  shirt: PALETTES.shirt.length, pants: PALETTES.pants.length,
}

export const DEFAULT_LOOK = { body: 0, skin: 1, hair: 0, shirt: 0, pants: 0 }

export function normalizeLook(look) {
  const out = { ...DEFAULT_LOOK }
  // Whole numbers only, as the hub accepts them.
  for (const [key, size] of Object.entries(LOOK_SIZES)) {
    const value = look?.[key]
    if (Number.isInteger(value) && value >= 0 && value < size) out[key] = value
  }
  return out
}

/** Random colours; the character is random too unless `body` is given. */
export function randomLook(body) {
  const pick = (key) => Math.floor(Math.random() * LOOK_SIZES[key])
  return {
    body: Number.isInteger(body) ? body : pick('body'),
    skin: pick('skin'), hair: pick('hair'), shirt: pick('shirt'), pants: pick('pants'),
  }
}

export const lookKey = (look) => `${look.body || 0}.${look.skin}.${look.hair}.${look.shirt}.${look.pants}`

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// Source colours in character.png (see tools: the pack reuses hair browns for
// the belt and shoes, so the male sheet's hair recolours stop at the shoulders;
// the female sheet moves belt and shoes off those browns, since her hair is long).
const SRC = {
  skin: [[232, 212, 178], [191, 167, 135]],
  hair: [[106, 72, 52], [67, 46, 39]],
  shirt: [[196, 60, 60], [136, 46, 46], [104, 28, 28]],
  pants: [[101, 101, 155], [85, 134, 185]],
}
const HAIR_LIMIT_Y = [17, FRAME_H]

const sheetCache = new Map()

/** The recoloured sheet for `look`, from the loaded `[male, female]` base sheets. */
export function avatarSheet(bases, look) {
  const key = lookKey(look)
  if (sheetCache.has(key)) return sheetCache.get(key)
  const body = look.body === 1 ? 1 : 0
  const baseImage = bases[body]
  const hairLimit = HAIR_LIMIT_Y[body]
  const canvas = document.createElement('canvas')
  canvas.width = baseImage.width
  canvas.height = baseImage.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(baseImage, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  const swaps = []
  for (const part of ['skin', 'hair', 'shirt', 'pants']) {
    const target = PALETTES[part][look[part]].map(hex)
    SRC[part].forEach((src, i) => swaps.push({ part, src, dst: target[Math.min(i, target.length - 1)] }))
  }
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue
    const r = px[i], g = px[i + 1], b = px[i + 2]
    for (const swap of swaps) {
      if (swap.src[0] !== r || swap.src[1] !== g || swap.src[2] !== b) continue
      if (swap.part === 'hair') {
        const y = Math.floor(i / 4 / canvas.width) % FRAME_H
        if (y >= hairLimit) break
      }
      px[i] = swap.dst[0]; px[i + 1] = swap.dst[1]; px[i + 2] = swap.dst[2]
      break
    }
  }
  ctx.putImageData(data, 0, 0)
  sheetCache.set(key, canvas)
  return canvas
}

// Directions map to rows of the character sheet.
export const DIR_ROW = { down: 0, right: 1, up: 2, left: 3 }
// The "arms up" block (columns 9-12) doubles as a wave/celebrate emote.
export const WAVE_COL = 9

export function sprite(name) {
  return WORLD.sprites[name]
}
