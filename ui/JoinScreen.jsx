import { useState } from 'react'
import { ArrowRotateCw, Mic, MicOff, Sparkles, Video, VideoFilledOff } from '@openai/apps-sdk-ui/components/Icon'
import { BODIES, PALETTES, randomLook } from '../engine/assets.js'
import AvatarCanvas from './AvatarCanvas.jsx'

const PARTS = [
  { key: 'skin', label: 'Skin' },
  { key: 'hair', label: 'Hair' },
  { key: 'shirt', label: 'Shirt' },
  // The female character wears a skirt in the same colours.
  { key: 'pants', label: 'Trousers', female: 'Skirt' },
]
const DIRS = ['down', 'left', 'up', 'right']

/**
 * First-run welcome and the avatar editor. `mode` is 'join' (enter the town)
 * or 'edit' (change look mid-game).
 */
export default function JoinScreen({
  mode = 'join', initial, identity, callAvailable, callNote, onDone, onCancel,
}) {
  const [look, setLook] = useState(initial.look)
  const [name, setName] = useState(initial.name)
  const [dirIndex, setDirIndex] = useState(0)
  const [audio, setAudio] = useState(initial.audio ?? true)
  const [video, setVideo] = useState(initial.video ?? true)
  const trimmed = name.trim().slice(0, 24)

  const submit = (event) => {
    event.preventDefault()
    if (!trimmed) return
    onDone({ look, name: trimmed, audio, video })
  }

  return (
    <div className="mt-cover" role="dialog" aria-modal="true" aria-labelledby="mt-join-title">
      <form className="mt-card" onSubmit={submit}>
        {mode === 'join' ? (
          <>
            <h1 id="mt-join-title" className="mt-title">MÖBIUS TOWN</h1>
            <p className="mt-lede">
              A shared pixel town where everyone is a Möbian. Walk up to others to talk, wander
              into houses to play games together, and step on stage to speak to a whole room.
            </p>
          </>
        ) : (
          <h1 id="mt-join-title" className="mt-title" style={{ fontSize: 28, marginBottom: 16 }}>YOUR LOOK</h1>
        )}
        <div className="mt-editor">
          <div className="mt-stage">
            {/* Both characters, in your colours: pick one. */}
            <div className="mt-picks" role="radiogroup" aria-label="Character">
              {BODIES.map((label, body) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={look.body === body}
                  className={`mt-pick${look.body === body ? ' is-on' : ''}`}
                  onClick={() => setLook((l) => ({ ...l, body }))}
                >
                  <AvatarCanvas look={{ ...look, body }} dir={DIRS[dirIndex]} walk={look.body === body} scale={5} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-iconbtn mt-stage-turn"
              aria-label="Turn around"
              title="Turn around"
              onClick={() => setDirIndex((i) => (i + 1) % 4)}
            >
              <ArrowRotateCw aria-hidden="true" />
            </button>
          </div>
          <div className="mt-swatches">
            {PARTS.map(({ key, label: plain, female }) => {
              const label = look.body === 1 && female ? female : plain
              return (
                <div className="mt-swatch-row" key={key}>
                  <h3>{label}</h3>
                  <div className="mt-swatch-list" role="radiogroup" aria-label={label}>
                    {PALETTES[key].map((colours, i) => (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={look[key] === i}
                        aria-label={`${label} ${i + 1}`}
                        className={`mt-swatch${look[key] === i ? ' is-on' : ''}`}
                        style={{ background: `linear-gradient(135deg, ${colours[0]} 55%, ${colours[1]} 55%)` }}
                        onClick={() => setLook((l) => ({ ...l, [key]: i }))}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            <div>
              <button type="button" className="mt-btn" onClick={() => setLook((l) => randomLook(l.body))}>
                <Sparkles aria-hidden="true" /> Surprise me
              </button>
            </div>
          </div>
        </div>
        <div className="mt-field">
          <label htmlFor="mt-name">Name shown above your head</label>
          <input
            id="mt-name"
            className="mt-input"
            value={name}
            maxLength={24}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {mode === 'join' && (
          <>
            {/* Without voice and video on this Möbius there is nothing to switch on. */}
            {callAvailable && <div className="mt-toggle-row" role="group" aria-label="Voice and video">
              <button
                type="button"
                className={`mt-toggle${audio && callAvailable ? ' is-on' : ''}`}
                aria-pressed={audio && !!callAvailable}
                disabled={!callAvailable}
                onClick={() => setAudio((v) => !v)}
              >
                {audio && callAvailable ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
                {!callAvailable ? 'Microphone unavailable' : audio ? 'Microphone on' : 'Microphone off'}
              </button>
              <button
                type="button"
                className={`mt-toggle${video && callAvailable ? ' is-on' : ''}`}
                aria-pressed={video && !!callAvailable}
                disabled={!callAvailable}
                onClick={() => setVideo((v) => !v)}
              >
                {video && callAvailable ? <Video aria-hidden="true" /> : <VideoFilledOff aria-hidden="true" />}
                {!callAvailable ? 'Camera unavailable' : video ? 'Camera on' : 'Camera off'}
              </button>
            </div>}
            <p className="mt-note">
              {callNote || (identity?.handle
                ? `You'll appear as @${identity.handle}'s avatar. Voice and video only connect with Möbians near you.`
                : 'Voice and video only connect with Möbians near you.')}
            </p>
          </>
        )}
        <div className="mt-actions">
          {onCancel && <button type="button" className="mt-btn" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="mt-btn is-primary" disabled={!trimmed}>
            {mode === 'join' ? 'Enter the town' : 'Save look'}
          </button>
        </div>
      </form>
    </div>
  )
}
