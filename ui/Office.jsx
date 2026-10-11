import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Robot, Search, X } from '@openai/apps-sdk-ui/components/Icon'
import AvatarCanvas from './AvatarCanvas.jsx'
import { agoText } from '../net/agents.js'
import { PILLS } from '../engine/office.js'

// The Agent Office's two panels: an agent's card (walk up to someone and press X) and the
// directory by the door. Both only show what your own Möbius shares with apps: a chat's
// title, what it was asked, its latest messages and when it was last active.

export default function OfficeOverlays({ town, state }) {
  const o = state.overlay
  if (o?.kind === 'agent') return <AgentCard town={town} state={state} id={o.id} />
  if (o?.kind === 'directory') return <AgentDirectory town={town} state={state} />
  return null
}

function Sheet({ title, label, onClose, children, icon }) {
  return (
    <div className="mt-cover" role="dialog" aria-modal="true" aria-label={label || title} onClick={onClose}>
      <div className="mt-card mt-sheet mt-office-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mt-sheet-head">
          {icon}
          <h2 className="mt-pixel">{title}</h2>
          <button type="button" className="mt-iconbtn" style={{ width: 38, height: 38 }} aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function StatusDot({ activity }) {
  return <span className="mt-office-dot" style={{ background: PILLS[activity]?.dot || '#7c768f' }} aria-hidden="true" />
}

function activeText(agent, now = Date.now()) {
  if (!Number.isFinite(agent.at)) return 'No recent activity'
  return agent.activity === 'now' ? `Active ${agoText(agent.at, now)}` : `Last active ${agoText(agent.at, now)}`
}

function AgentCard({ town, state, id }) {
  const agent = useMemo(() => state.office?.agents?.find((a) => a.id === id) || null, [state.office, id])
  const [detail, setDetail] = useState({ status: 'loading' })
  const [prompt, setPrompt] = useState('')
  const close = () => town.closeOverlay()

  useEffect(() => {
    let alive = true
    setDetail({ status: 'loading' })
    town.office.detail(id).then((d) => { if (alive) setDetail(d) })
    return () => { alive = false }
  }, [town, id])

  if (!agent) {
    return (
      <Sheet title="Agent" onClose={close}>
        <p className="mt-sign-text">This agent has left the office. Its chat may have been deleted.</p>
      </Sheet>
    )
  }

  const open = (withPrompt) => {
    town.office.openChat(agent.id, withPrompt ? prompt : '')
    close()
  }
  return (
    <Sheet title={agent.helper ? 'Helper' : 'Agent'} label={`Agent: ${agent.title}`} onClose={close}>
      <div className="mt-office-who">
        <AvatarCanvas look={agent.look} scale={3} className="mt-office-face" />
        <div className="mt-office-who-text">
          <h3>{agent.title}</h3>
          <p className="mt-office-status">
            <StatusDot activity={agent.activity} />
            {activeText(agent)}
            {agent.messages ? ` · ${agent.messages} message${agent.messages === 1 ? '' : 's'}` : ''}
          </p>
        </div>
      </div>
      {agent.excerpt && (
        <section className="mt-office-quote">
          <h4>Asked to</h4>
          <p>{agent.excerpt}</p>
        </section>
      )}
      <section className="mt-office-quote" aria-live="polite">
        <h4>Latest from the agent</h4>
        {detail.status === 'loading' && <p className="is-quiet">Looking…</p>}
        {detail.status === 'ok' && <p>{detail.fromAgent || 'Nothing yet.'}</p>}
        {detail.status !== 'loading' && detail.status !== 'ok' && <p className="is-quiet">Couldn’t read this chat right now.</p>}
      </section>
      <label className="mt-field">
        <span className="mt-office-label">New prompt</span>
        <textarea
          className="mt-input mt-office-prompt"
          rows={3}
          maxLength={4000}
          placeholder={`Ask ${agent.helper ? 'this helper' : 'this agent'} something new…`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) {
              e.preventDefault()
              open(true)
            }
          }}
        />
      </label>
      <div className="mt-actions mt-office-actions">
        <button type="button" className="mt-btn" onClick={() => open(false)}>
          <ExternalLink aria-hidden="true" /> Open chat
        </button>
        <button type="button" className="mt-btn is-primary" disabled={!prompt.trim()} onClick={() => open(true)}>
          Open with this prompt
        </button>
      </div>
      <p className="mt-note">
        Möbius opens the chat{prompt.trim() ? ' with your prompt ready to send' : ''}. Stop the agent or reply from there.
        The office knows when each chat was last active, not whether it is working this second.
      </p>
    </Sheet>
  )
}

function AgentDirectory({ town, state }) {
  const office = state.office || { status: 'loading', agents: [] }
  const [query, setQuery] = useState('')
  const close = () => town.closeOverlay()
  const q = query.trim().toLowerCase()
  const agents = q ? office.agents.filter((a) => `${a.title} ${a.excerpt}`.toLowerCase().includes(q)) : office.agents
  const now = Date.now()
  return (
    <Sheet title="Agent directory" onClose={close} icon={<Robot aria-hidden="true" className="mt-office-head-icon" />}>
      <p className="mt-sign-text mt-office-lede">
        Your Möbius chats, most recently active first. The eight most recent work at the desks.
      </p>
      {office.status === 'denied' && (
        <p className="mt-office-problem">
          Möbius Town can’t see your chats yet. Allow it to read chat summaries in its app settings in Möbius.
        </p>
      )}
      {(office.status === 'offline' || office.status === 'error') && (
        <p className="mt-office-problem">Couldn’t reach your Möbius just now{office.agents.length ? '; this is the last list.' : '.'}</p>
      )}
      {office.agents.length > 6 && (
        <div className="mt-office-search">
          <Search aria-hidden="true" />
          <input className="mt-input" type="search" placeholder="Find an agent" aria-label="Find an agent"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {office.status === 'loading' && !office.agents.length && <p className="mt-empty">Looking for your agents…</p>}
      {office.status === 'ok' && !office.agents.length && (
        <p className="mt-empty">No agents yet. Start a chat in Möbius and it gets a desk here.</p>
      )}
      <ul className="mt-office-list">
        {agents.map((a, i) => (
          <li key={a.id}>
            <button type="button" className="mt-office-row" onClick={() => town.office.talkTo(a.id)}
              aria-label={`${a.title}, ${activeText(a, now)}${!q && i < 8 ? ', at a desk' : ''}`}>
              <StatusDot activity={a.activity} />
              <span className="mt-office-row-main">
                <span className="mt-office-row-title">{a.title}</span>
                <span className="mt-office-row-sub">{activeText(a, now)}{a.helper ? ' · helper' : ''}</span>
              </span>
            </button>
            <button type="button" className="mt-btn mt-office-open" aria-label={`Open ${a.title} in Möbius`}
              onClick={() => { town.office.openChat(a.id); close() }}>
              <ExternalLink aria-hidden="true" /> Open
            </button>
          </li>
        ))}
      </ul>
      {q && !agents.length && <p className="mt-empty">No agent matches “{query.trim()}”.</p>}
    </Sheet>
  )
}
