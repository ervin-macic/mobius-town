// A rotating Möbius strip rendered as chunky pixel art.
//
// The surface is a real parametric Möbius band, rotated in 3D and painted
// back-to-front into a small offscreen canvas; the game then draws that canvas
// at world scale with nearest-neighbour sampling, so it reads as pixel art.
// tools/strip_preview.py renders the same maths to a contact sheet for tuning.

const SEG_U = 96 // segments around the loop
const SEG_V = 4 // strips across the band (smaller quads sort cleanly)
const W_HALF = 0.45 // half width of the band relative to the loop radius
const TILT = -0.4 // look down at it a little
const SPIN = 0.6 // radians per second about the vertical axis
// A Möbius band has one side, but at any moment some of it faces you and some faces away.
// Gold for the part facing you and teal for the part facing away makes the half twist obvious:
// the colours swap exactly where the band turns over.
const GOLD = [[92, 52, 24], [150, 92, 36], [214, 150, 58], [246, 204, 104], [255, 240, 186]]
const TEAL = [[22, 60, 74], [30, 100, 112], [52, 156, 160], [112, 208, 198], [196, 246, 236]]
const EDGE_FRONT = [255, 247, 214]
const EDGE_BACK = [214, 255, 246]

export class MobiusRenderer {
  constructor(size = 112) {
    this.size = size
    this.canvas = document.createElement('canvas')
    this.canvas.width = size
    this.canvas.height = size
    this.ctx = this.canvas.getContext('2d')
    this.lastDrawn = -1
  }

  /** Redraw at most ~24 times a second; returns the canvas. */
  draw(time, speed = 1) {
    const frame = Math.floor(time * 24)
    if (frame === this.lastDrawn) return this.canvas
    this.lastDrawn = frame
    const { ctx, canvas } = this
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const R = w * 0.3
    // The strip stands upright with its twist at the top, like a trophy, and spins about the
    // vertical axis, so the twist is always in view.
    const spin = time * SPIN * speed
    const cs = Math.cos(spin), sn = Math.sin(spin)
    const ct = Math.cos(TILT), st = Math.sin(TILT)
    // Light from the upper left, slightly in front.
    const L = [-0.45, -0.55, 0.7]
    const quads = []
    const point = (u, v) => {
      const r = R * (1 + W_HALF * v * Math.cos(u / 2))
      // u = pi (the twist) goes to the top of the canvas.
      let x = -r * Math.sin(u)
      let y = r * Math.cos(u)
      let z = R * W_HALF * v * Math.sin(u / 2)
      ;[x, z] = [x * cs + z * sn, -x * sn + z * cs]
      ;[y, z] = [y * ct - z * st, y * st + z * ct]
      return [x, y, z]
    }
    for (let i = 0; i < SEG_U; i++) {
      const u0 = (i / SEG_U) * Math.PI * 2
      const u1 = ((i + 1) / SEG_U) * Math.PI * 2
      for (let j = 0; j < SEG_V; j++) {
        const v0 = -1 + (2 * j) / SEG_V
        const v1 = -1 + (2 * (j + 1)) / SEG_V
        const a = point(u0, v0), b = point(u1, v0), c = point(u1, v1), d = point(u0, v1)
        // Normal from the quad's diagonals.
        const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const e2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]]
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
        const len = Math.hypot(n[0], n[1], n[2]) || 1
        const facing = n[2] / len
        const lit = Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / len)
        const shade = Math.max(0, Math.min(1, 0.22 + 0.78 * lit))
        const depth = (a[2] + b[2] + c[2] + d[2]) / 4
        quads.push({ pts: [a, b, c, d], depth, shade, facing, lo: j === 0, hi: j === SEG_V - 1 })
      }
    }
    quads.sort((p, q) => p.depth - q.depth)
    const cx = w / 2
    const cy = h / 2
    const proj = (p) => [Math.round(cx + p[0]), Math.round(cy + p[1])]
    // The band's single edge, drawn with each quad so nearer parts still cover it.
    const edge = (p, q, col) => {
      let [x0, y0] = proj(p)
      const [x1, y1] = proj(q)
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
      let err = dx + dy
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`
      for (let k = 0; k < 64; k++) {
        ctx.fillRect(x0, y0, 1, 1)
        if (x0 === x1 && y0 === y1) break
        const e2 = 2 * err
        if (e2 >= dy) { err += dy; x0 += sx }
        if (e2 <= dx) { err += dx; y0 += sy }
      }
    }
    for (const q of quads) {
      const level = Math.min(4, Math.floor(q.shade * 5))
      const front = q.facing >= 0
      const col = (front ? GOLD : TEAL)[level]
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`
      ctx.beginPath()
      q.pts.forEach((p, k) => {
        const [x, y] = proj(p)
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fill()
      // Seal hairline seams: edge-on quads are slivers that antialiasing would leave as pinholes.
      ctx.strokeStyle = ctx.fillStyle
      ctx.lineWidth = 1
      ctx.stroke()
      const ec = front ? EDGE_FRONT : EDGE_BACK
      if (q.lo) edge(q.pts[0], q.pts[1], ec)
      if (q.hi) edge(q.pts[2], q.pts[3], ec)
    }
    // Snap alpha to hard pixels and add a dark outline, like the rest of the art.
    const img = ctx.getImageData(0, 0, w, h)
    const px = img.data
    const solid = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      if (px[i * 4 + 3] >= 72) {
        solid[i] = 1
        px[i * 4 + 3] = 255
      } else {
        px[i * 4 + 3] = 0
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (solid[i]) continue
        const near = (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])
        if (near) {
          px[i * 4] = 40
          px[i * 4 + 1] = 26
          px[i * 4 + 2] = 30
          px[i * 4 + 3] = 255
        }
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }
}
