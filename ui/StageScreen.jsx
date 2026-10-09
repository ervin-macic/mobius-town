import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Collapse, Expand, FilePresentation, X } from '@openai/apps-sdk-ui/components/Icon'

// Screen sharing on the auditorium stage. A shared screen takes the presenter's camera place, and
// the shell paints it (letterboxed) into the rectangle we report; the app never sees its pixels.

function useTileReport(town, ref, tile, active) {
  useLayoutEffect(() => {
    const report = () => {
      const el = ref.current
      if (!active || !el) {
        town.call.setTiles([], 'screen')
        return
      }
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) {
        town.call.setTiles([], 'screen')
        return
      }
      town.call.setTiles([{
        ...tile, x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), radius: 8,
      }], 'screen')
    }
    report()
    const ro = new ResizeObserver(report)
    if (ref.current) ro.observe(ref.current)
    window.addEventListener('resize', report)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
    }
  })
  useEffect(() => () => town.call.setTiles([], 'screen'), [town])
}

/** On stage: share your screen, see a small preview while you present, stop. */
export function StageControls({ town, state }) {
  const call = state.call
  const sharing = call.screen
  const previewRef = useRef(null)
  useTileReport(town, previewRef, { peer: 'self' }, sharing && state.onStage)
  if (!state.onStage || state.ui?.mapId !== 'hall') return null
  return (
    <section className="mt-stagectl" aria-label="Stage">
      <div className="mt-stagectl-head">
        <FilePresentation aria-hidden="true" />
        <b>{sharing ? 'Presenting to the room' : 'You are on stage'}</b>
      </div>
      {sharing && <div className="mt-stagectl-preview" ref={previewRef} aria-label="Your shared screen" />}
      {call.screenError && !sharing && <p className="mt-stagectl-note">{call.screenError}</p>}
      {!sharing && <p className="mt-stagectl-note">Everyone in the auditorium hears you. Share a screen, a window or a tab to show slides.</p>}
      <button type="button" className={`mt-btn${sharing ? ' is-danger' : ' is-primary'}`} onClick={() => town.shareScreen(!sharing)}>
        {sharing ? 'Stop sharing' : 'Share your screen'}
      </button>
    </section>
  )
}

/** In the audience: the presenter's screen, large, with a minimise toggle. */
export function StageScreen({ town, state }) {
  const [small, setSmall] = useState(false)
  const [hiddenFor, setHiddenFor] = useState(null)
  const videoRef = useRef(null)
  const presenter = (state.call.presenters || []).find((pid) => town.contextOf(pid)?.onStage) || null
  const active = !!presenter && hiddenFor !== presenter && state.ui?.mapId === 'hall'
  useTileReport(town, videoRef, { peer: presenter }, active)
  useEffect(() => { if (!presenter) setHiddenFor(null) }, [presenter])
  if (!active) return null
  const name = town.peerInfo.get(presenter)?.name || 'The speaker'
  return (
    <section className={`mt-screen${small ? ' is-small' : ''}`} aria-label={`${name} is presenting`}>
      <header>
        <FilePresentation aria-hidden="true" />
        <span>{name} is presenting</span>
        <button type="button" className="mt-iconbtn" aria-label={small ? 'Enlarge the presentation' : 'Make the presentation small'}
          onClick={() => setSmall(!small)}>
          {small ? <Expand aria-hidden="true" /> : <Collapse aria-hidden="true" />}
        </button>
        <button type="button" className="mt-iconbtn" aria-label="Hide the presentation" onClick={() => setHiddenFor(presenter)}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="mt-screen-video" ref={videoRef} />
    </section>
  )
}
