import { useEffect, useRef } from 'react'

// A little retro computer that plays for the bots: a CRT with a face on its screen, on a stand
// with a keyboard. While it is the bot's move the face gives way to "thinking" dots.
const BODY = [
  '..##############..',
  '.#pppppppppppppp#.',
  '.#pssssssssssssp#.',
  '.#pssssssssssssp#.',
  '.#pssssssssssssp#.',
  '.#pssssssssssssp#.',
  '.#pssssssssssssp#.',
  '.#pssssssssssssp#.',
  '.#pssssssssssssp#.',
  '.#pppppppppppppp#.',
  '.#pppppppppgprpp#.',
  '..##############..',
  '.......#hh#.......',
  '.....########.....',
  '..##############..',
  '.#kKkKkKkKkKkKkk#.',
  '.#KkKkKkKkKkKkKk#.',
  '..##############..',
]
const FACE = ['............', '..ee....ee..', '..ee....ee..', '............', '..m......m..', '...mmmmmm...', '............']
const DOTS = [
  ['............', '............', '............', '..d..d..d...', '............', '............', '............'],
]
const COLOURS = {
  '#': '#2a1d33', p: '#d8d0c2', s: '#16302b', h: '#9c9486', k: '#bdb4a6', K: '#a39b8d',
  g: '#5cf08c', r: '#ff6b74', e: '#7cf0a0', m: '#7cf0a0', d: '#7cf0a0',
}

export default function CpuAvatar({ thinking = false, scale = 2, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const put = (x, y, c) => {
        ctx.fillStyle = COLOURS[c]
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
      BODY.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') put(x, y, c) }))
      const screen = thinking ? DOTS[0] : FACE
      screen.forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '.') return
        // Thinking dots light up one after another.
        if (c === 'd' && !reduce && Math.floor(x / 3) !== frame % 4) return
        put(x + 3, y + 2, c)
      }))
      // The power light blinks while thinking.
      if (thinking && !reduce && frame % 2) put(11, 10, 'p')
      frame++
    }
    draw()
    if (!thinking || reduce) return undefined
    const timer = setInterval(draw, 280)
    return () => clearInterval(timer)
  }, [thinking, scale])
  return <canvas ref={ref} className={className} width={18 * scale} height={18 * scale} aria-hidden="true" />
}
