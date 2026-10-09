import { useEffect, useLayoutEffect, useRef } from 'react'
import { MicOff } from '@openai/apps-sdk-ui/components/Icon'
import AvatarCanvas from './AvatarCanvas.jsx'

/**
 * The strip of people you can currently see. Each card reserves a video area;
 * the shell paints the live video there (the app never receives the stream).
 * Cards fade with distance, matching how loud each person is.
 */
export default function VideoStrip({ town, tiles, self, hidden }) {
  const stripRef = useRef(null)
  const cards = []
  if (self?.video) cards.push({ pid: 'self', name: 'You', look: self.look, video: true, audio: self.audio, gain: 1, self: true })
  for (const t of tiles) cards.push(t)

  // Report video rectangles to the shell after layout, on resize, and when hidden.
  useLayoutEffect(() => {
    const report = () => {
      if (hidden || !stripRef.current) {
        town.call.setTiles([], 'strip')
        return
      }
      const rects = []
      for (const el of stripRef.current.querySelectorAll('[data-video-peer]')) {
        const r = el.getBoundingClientRect()
        if (r.width < 8 || r.height < 8) continue
        rects.push({
          peer: el.dataset.videoPeer,
          x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
          radius: 10, opacity: Number(el.dataset.opacity || 1), mirror: el.dataset.videoPeer === 'self',
        })
      }
      town.call.setTiles(rects, 'strip')
    }
    report()
    const ro = new ResizeObserver(report)
    if (stripRef.current) ro.observe(stripRef.current)
    window.addEventListener('resize', report)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
    }
  })
  useEffect(() => () => town.call.setTiles([], 'strip'), [town])

  // Speaking glow without re-rendering React at audio rate.
  useEffect(() => {
    const timer = setInterval(() => {
      const root = stripRef.current
      if (!root || !town.game) return
      for (const el of root.querySelectorAll('[data-speaker]')) {
        const pid = el.dataset.speaker
        const a = pid === 'self' ? town.game.me : town.game.others.get(pid)
        el.classList.toggle('is-speaking', (a?.speaking || 0) > 0.06)
      }
    }, 150)
    return () => clearInterval(timer)
  }, [town])

  if (!cards.length || hidden) return null
  return (
    <div className="mt-strip" ref={stripRef} aria-label="Möbians you can see and hear">
      {cards.map((c) => {
        const opacity = c.self ? 1 : Math.max(0.35, Math.min(1, 0.25 + c.gain))
        return (
          <figure key={c.pid} className={`mt-tile${c.stage ? ' is-stage' : ''}`} data-speaker={c.pid} style={{ opacity }}>
            <div className="mt-tile-video" data-video-peer={c.video ? c.pid : undefined} data-opacity={opacity}>
              <AvatarCanvas look={c.look} scale={3} className="mt-tile-avatar" />
              {c.video && c.state && c.state !== 'connected' && <span className="mt-tile-state">Connecting…</span>}
            </div>
            <figcaption>
              {c.stage && <span className="mt-stage-badge">On stage</span>}
              <span className="mt-tile-name">{c.name}</span>
              {!c.audio && <MicOff aria-label="microphone off" className="mt-tile-mute" />}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}
