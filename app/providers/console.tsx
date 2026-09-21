'use client'

import { useState, useTransition } from 'react'
import {
  disconnectProvider,
  loadProviderConnections,
  selectCodexConnection,
  type ProviderConnectionsView,
} from './actions.ts'

export function ProvidersConsole({ initial }: { initial: ProviderConnectionsView }) {
  const [view, setView] = useState(initial)
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()
  const connected = view.selected === 'codex-cli'

  function refresh(): void {
    setMessage('')
    start(async () => setView(await loadProviderConnections()))
  }

  function connect(): void {
    setMessage('')
    start(async () => {
      const result = await selectCodexConnection()
      setView(result.view)
      if (!result.ok) setMessage(result.message)
    })
  }

  function disconnect(): void {
    setMessage('')
    start(async () => {
      const result = await disconnectProvider()
      setView(result.view)
    })
  }

  return (
    <div className="stack">
      <section className="in">
        <p className="eyebrow">Models</p>
        <h1>Use a subscription you already have</h1>
        <p className="sub">FounderOS uses the authenticated local CLI. It never receives your subscription credential.</p>
      </section>

      <section className="in">
        <div className="rows">
          <div className="row">
            <span className="row__body">
              <span className="row__title">Codex</span>
              <span className="row__meta">ChatGPT subscription</span>
            </span>
            <span className="row__aside">
              {connected ? 'connected' : view.codex.ok ? 'ready' : 'needs setup'}
            </span>
          </div>
          <p className="meta" style={{ marginTop: '0.9rem' }}>
            FounderOS never sees or stores your subscription credential. It sends only the selected company context and approved Knowledge Base passages.
          </p>
          {!view.codex.ok && (
            <p className="quiet quiet--alert" style={{ marginTop: '0.9rem' }}>
              {view.codex.reason === 'Codex CLI is not signed in'
                ? 'Run `codex login` in Terminal, then verify again.'
                : view.codex.reason}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
            {connected ? (
              <button className="tag" type="button" disabled={pending} onClick={disconnect}>
                Disconnect from FounderOS
              </button>
            ) : view.codex.ok ? (
              <button className="btn" type="button" disabled={pending} onClick={connect}>
                {pending ? 'Connecting…' : 'Use for FounderOS'}
              </button>
            ) : (
              <button className="tag" type="button" disabled={pending} onClick={refresh}>
                {pending ? 'Checking…' : 'Verify again'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="in">
        <div className="rows">
          <div className="row">
            <span className="row__body">
              <span className="row__title">GitHub Copilot</span>
              <span className="row__meta">Runs Copilot models</span>
            </span>
            <span className="row__aside">Not available yet</span>
          </div>
          <div className="row">
            <span className="row__body">
              <span className="row__title">SuperGrok</span>
              <span className="row__meta">Runs Grok models</span>
            </span>
            <span className="row__aside">Not available yet</span>
          </div>
        </div>
        <p className="meta" style={{ marginTop: '1rem' }}>
          A connection appears here only after FounderOS can verify its local authentication and keep its data boundary explicit.
        </p>
      </section>

      <div aria-live="polite">{message && <p className="quiet quiet--alert">{message}</p>}</div>
    </div>
  )
}
