import { useEffect, useRef } from 'react'
import { avatarSheet, DIR_ROW, FRAME_H, FRAME_W, loadCharacters } from '../engine/assets.js'

// A small pixel-perfect avatar render. `walk` animates the walk cycle.
export default function AvatarCanvas({ look, dir = 'down', walk = false, scale = 2, className }) {
  const ref = useRef(null)
  useEffect(() => {
    let raf = 0
    let cancelled = false
    const canvas = ref.current
    if (!canvas) return undefined
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    loadCharacters().then((bases) => {
      if (cancelled) return
      const sheet = avatarSheet(bases, look)
      const ctx = canvas.getContext('2d')
      const start = performance.now()
      const draw = (now) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = false
        const col = walk && !reduce ? Math.floor((now - start) / 130) % 4 : 0
        ctx.drawImage(sheet, col * FRAME_W, (DIR_ROW[dir] ?? 0) * FRAME_H, FRAME_W, FRAME_H, 0, 0,
          FRAME_W * scale, FRAME_H * scale)
        if (walk && !reduce) raf = requestAnimationFrame(draw)
      }
      draw(performance.now())
    }).catch(() => {})
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [look?.body, look?.skin, look?.hair, look?.shirt, look?.pants, dir, walk, scale])
  return (
    <canvas
      ref={ref}
      className={className}
      width={FRAME_W * scale}
      height={FRAME_H * scale}
      aria-hidden="true"
      // Crop the transparent rows above the head.
      style={{ objectFit: 'cover', objectPosition: '50% 70%' }}
    />
  )
}
