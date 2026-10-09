// Chess pieces drawn from vector outlines ("Chess Pieces in .svg Format" by femrek, CC0; the
// originals are kept in art/chess-svg). Each piece is rendered once into a crisp 128 px image: a
// dark (or light) outline around the whole silhouette, then the body with a soft top-to-bottom
// shade, so the pieces stay sharp however large the board is drawn.
const SHAPES = {
  p: [
    { d: 'M19 9a6 6 0 1 0 12 0a6 6 0 1 0 -12 0Z' },
    { d: 'M15 22a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z' },
    { d: 'M25 28C5 28 5 48 5 48H45C45 48 45 28 25 28Z' },
  ],
  r: [
    { d: 'M5 45C5 43.8954 5.89543 43 7 43H43C44.1046 43 45 43.8954 45 45V48H5V45Z' },
    { d: 'M7 42C7 41.4477 7.44772 41 8 41H42C42.5523 41 43 41.4477 43 42V43H7V42Z' },
    { d: 'M11 12h28v27h-28Z' },
    { d: 'M9 41C9 39.8954 9.89543 39 11 39H39C40.1046 39 41 39.8954 41 41H9Z' },
    { d: 'M11 12L7 8H43L39 12H11Z' },
    { d: 'M7 4C7 3.44772 7.44772 3 8 3H12C12.5523 3 13 3.44772 13 4V8H7V4Z' },
    { d: 'M37 4C37 3.44772 37.4477 3 38 3H42C42.5523 3 43 3.44772 43 4V8H37V4Z' },
    { d: 'M20 4C20 3.44772 20.4477 3 21 3H29C29.5523 3 30 3.44772 30 4V8H20V4Z' },
  ],
  n: [
    { d: 'M16.0506 23.7016C19.4859 21.8477 23.0655 19.9159 24 20.5C25.845 21.6531 24.744 27.7638 21.5 34C19.8129 37.2433 16.0849 40.5205 13.1643 43.088C9.85102 46.0007 7.57678 48 10.5 48H44.5C44.5 48 44.8889 21 34 7C30.8889 3 28.8462 3 25 3C23.5 3 22 3 21 3.5C20.239 3.88047 19.2604 4.71465 18 6C16.3918 7.63995 15.5083 9.48102 14.6728 11.2219C13.9121 12.8068 13.1914 14.3086 12 15.5C10.9024 16.5976 9.18564 17.2206 7.72701 17.7499C6.22702 18.2942 5 18.7395 5 19.5C5 20.6947 7 24 8 24C8.37228 24 9.16034 23.7228 10.003 23.4264C11.4239 22.9267 13 22.3723 13 23C13 23.4153 12.1375 23.8307 11.2005 24.2818C9.88165 24.9169 8.41534 25.623 9 26.5C9.49349 27.2402 12.7036 25.5079 16.0506 23.7016ZM23 8.06047C23 8.06047 20.6132 7.74362 19.5 8.56047C18.3011 9.44025 18 12.0605 18 12.0605C18 12.0605 20.909 11.4242 22 10.0605C22.5455 9.37859 23 8.06047 23 8.06047Z', evenodd: true },
    { d: 'M31 1C28.0406 0.236289 23.5 8 23.5 8L28.5 9.5C28.5 9.5 33.707 1.69859 31 1Z' },
  ],
  b: [
    { d: 'M5 48H9C13 48 16.2288 45.6955 21 45.2727C24.1139 44.9968 25.8861 44.9968 29 45.2727C33.7712 45.6955 37 48 41 48H45C45 48 40.8609 45.6142 38 44.7273C33.8508 43.441 29 43.6364 28 43.0909C26.9546 42.5207 25.9763 42 25 42C24.0237 42 23 42.5455 22 43.0909C21 43.6364 16.1492 43.441 12 44.7273C9.13913 45.6142 5 48 5 48Z' },
    { d: 'M25 42.9506C25 42.9506 16.0581 43.735 14.6192 39.0505C13.3064 34.7766 14.0965 31.861 16.8436 28.65C17.5851 27.7833 32.4149 27.7833 33.1564 28.65C35.9035 31.861 36.6936 34.7766 35.3808 39.0505C33.9419 43.735 25 42.9506 25 42.9506Z' },
    { d: 'M11.0662 22.3C9.88141 13.8894 25 8 25 8C25 8 31.5 11 31.5 12C31.5 12.8051 26 18.5 27 19C28.2225 19.6113 30 19.5 30.5 19C30.8799 18.6201 32.5 14 33.5 14C34.5 14 38.7805 18.4044 38.9338 22.3C39.0893 26.2495 32.3652 30 32.3652 30H17.5025C17.5025 30 11.5474 25.7162 11.0662 22.3Z' },
    { d: 'M21 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z' },
  ],
  q: [
    { d: 'M40 47C40 48 10 48 10 47C10 41 13 39 13 39C13 39 10 39 10 28C10 28 19.0903 26 25 26C30.9097 26 40 28 40 28C40 39 37 39 37 39C37 39 40 41 40 47Z' },
    { d: 'M22 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z' },
    { d: 'M13 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z' },
    { d: 'M21 27L25 6L29 27L34 7L34.5 28L41 10L40 28H34.5L29 27H21L15.5 28H10L9 10L15.5 28L16 7L21 27Z' },
    { d: 'M31 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z' },
    { d: 'M38 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z' },
    { d: 'M6 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z' },
  ],
  k: [
    { d: 'M10 36C10 30 40 30 40 36C40 36 39 37.7651 39 39C39 40.2349 40 40.5919 40 42C40 43.4081 39 43.7651 39 45C39 46.2349 40 48 40 48H10C10 48 11 46.2349 11 45C11 43.7651 10 43.2349 10 42C10 40.7651 11 40.2349 11 39C11 37.7651 10 36 10 36Z' },
    { d: 'M13 34C13 34 4.34636 23.9778 8 19C10.8583 15.1059 15.4965 14.2528 20 16C23.6724 17.4247 24.7356 22.928 25 27.0856C25.2644 22.928 26.3276 17.4247 30 16C34.5035 14.2528 39.1417 15.1059 42 19C45.6536 23.9778 37 34 37 34H13Z' },
    { d: 'M28 19C28 12 22 12 22 19L25 30L28 19Z' },
    { d: 'M24 3H26V8H31V10H26V15H24V10H19V8H24V3Z' },
  ],
}

const STYLE = {
  w: { outline: '#2a1d33', top: '#fffaf0', bottom: '#e9dcc0' },
  b: { outline: '#f0d9b5', top: '#56406a', bottom: '#2c1f3a' },
}

const SIZE = 128
const VIEW = 50
let cache = null

function paint(colour, type) {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  const style = STYLE[colour]
  // A 50-unit drawing with a 3-unit margin, so the outline never touches the edge.
  const scale = SIZE / (VIEW + 6)
  ctx.translate(3 * scale, 2 * scale)
  ctx.scale(scale, scale)
  const parts = SHAPES[type].map((part) => ({ path: new Path2D(part.d), rule: part.evenodd ? 'evenodd' : 'nonzero' }))
  // Outline first: every part stroked wide in the outline colour, then the bodies on top, so only
  // the silhouette's outer edge (and holes such as the knight's eye) keep the outline.
  ctx.lineJoin = 'round'
  ctx.strokeStyle = style.outline
  ctx.fillStyle = style.outline
  ctx.lineWidth = 4.2
  for (const { path, rule } of parts) {
    ctx.stroke(path)
    ctx.fill(path, rule)
  }
  const shade = ctx.createLinearGradient(0, 0, 0, VIEW)
  shade.addColorStop(0, style.top)
  shade.addColorStop(1, style.bottom)
  ctx.fillStyle = shade
  for (const { path, rule } of parts) ctx.fill(path, rule)
  return canvas.toDataURL()
}

export function pieceImages() {
  if (cache) return cache
  cache = {}
  for (const colour of ['w', 'b']) {
    for (const type of Object.keys(SHAPES)) cache[colour + type] = paint(colour, type)
  }
  return cache
}
