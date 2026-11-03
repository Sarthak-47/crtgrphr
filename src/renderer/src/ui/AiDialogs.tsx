import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { DIAGRAM_TYPES } from '@shared/ir'
import { loadDiagram } from '../actions/files'
import type { AiSettingsShape, KeyStatus } from '../../../preload'

const EXAMPLE =
  'An online shop: a React web app and a mobile app call an API gateway. Behind it, an orders service and a catalog service. Orders are stored in Postgres, the catalog is cached in Redis. Payments go through Stripe, and order events are published to Kafka for an email worker.'

const api = () => window.cartographer

function useAiSettings() {
  const [state, setState] = useState<{ settings: AiSettingsShape; key: KeyStatus; encryption: boolean } | null>(null)
  const reload = async () => {
    const bridge = api()
    if (bridge) setState(await bridge.ai.getSettings())
  }
  useEffect(() => {
    void reload()
  }, [])
  return { state, reload }
}

/** Where the description goes, in plain words. */
function Destination({ settings }: { settings: AiSettingsShape }) {
  return settings.provider === 'anthropic' ? (
    <p className="cg-ai-dest cg-ai-dest-remote" data-testid="ai-destination">
      Your description will be sent to the <strong>Anthropic API</strong> ({settings.anthropicModel}) using your API key.
    </p>
  ) : (
    <p className="cg-ai-dest" data-testid="ai-destination">
      Runs on this computer with <strong>Ollama</strong> ({settings.ollamaModel}). Nothing leaves your machine.
    </p>
  )
}

export function DescribeDialog() {
  const setDialog = useStore((s) => s.setDialog)
  const { state } = useAiSettings()
  const [text, setText] = useState('')
  const [type, setType] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => () => void (alive.current = false), [])
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
    return () => clearInterval(t)
  }, [busy])

  const close = () => setDialog(null)

  async function generate() {
    const bridge = api()
    if (!bridge) return setError('AI generation needs the desktop app.')
    setError(null)
    setBusy(true)
    setElapsed(0)
    const res = await bridge.ai.generate({ description: text, type: type || undefined })
    if (!alive.current) return
    setBusy(false)
    if (res.error || !res.diagram) return setError(res.error ?? 'Nothing came back.')
    const note = res.attempts && res.attempts > 1 ? ' (after one correction)' : ''
    const ok = await loadDiagram(res.diagram, (n) => `Generated ${n} nodes with ${res.provider === 'anthropic' ? 'the Anthropic API' : 'Ollama'}${note}`, 'Generating a map')
    if (ok) close()
  }

  return (
    <div className="cg-modal-scrim" onClick={busy ? undefined : close}>
      <div className="cg-modal" role="dialog" aria-label="Describe your system" data-testid="describe" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !busy && close()}>
        <div className="cg-modal-head">
          <h2>Describe your system</h2>
          <button className="cg-icon-btn" onClick={close} disabled={busy} aria-label="Close">✕</button>
        </div>
        <p className="cg-modal-hint">Write what the system is made of and how the parts talk. The AI drafts the map; you edit it like any other.</p>
        <textarea
          className="cg-code cg-ai-text"
          autoFocus
          aria-label="System description"
          placeholder={EXAMPLE}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim() && !busy) void generate()
          }}
        />
        <div className="cg-ai-row">
          <label className="cg-field cg-ai-type">
            <span>Diagram type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} disabled={busy} aria-label="Diagram type">
              <option value="">Let the AI choose</option>
              {DIAGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {!text && (
            <button className="cg-ghost" onClick={() => setText(EXAMPLE)} disabled={busy}>Use example</button>
          )}
        </div>
        {state && <Destination settings={state.settings} />}
        {error && <div className="cg-error" role="alert" data-testid="ai-error">{error}</div>}
        <div className="cg-modal-actions">
          <button className="cg-link" onClick={() => setDialog('ai-settings')} disabled={busy}>AI settings…</button>
          <div style={{ flex: 1 }} />
          <button className="cg-ghost" onClick={close} disabled={busy}>Cancel</button>
          <button className="cg-primary" onClick={() => void generate()} disabled={busy || !text.trim()}>
            {busy ? `Generating… ${elapsed}s` : 'Generate map'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function AiSettingsDialog() {
  const setDialog = useStore((s) => s.setDialog)
  const { state, reload } = useAiSettings()
  const [draft, setDraft] = useState<AiSettingsShape | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (state && !draft) setDraft(state.settings)
  }, [state, draft])
  if (!state || !draft) return null
  const bridge = api()!

  const save = async () => {
    await bridge.ai.saveSettings(draft)
    await reload()
  }

  return (
    <div className="cg-modal-scrim" onClick={() => setDialog(null)}>
      <div className="cg-modal" role="dialog" aria-label="AI settings" data-testid="ai-settings" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setDialog(null)}>
        <div className="cg-modal-head">
          <h2>AI settings</h2>
          <button className="cg-icon-btn" onClick={() => setDialog(null)} aria-label="Close">✕</button>
        </div>

        <fieldset className="cg-ai-providers">
          <label className={draft.provider === 'ollama' ? 'active' : ''}>
            <input type="radio" name="provider" checked={draft.provider === 'ollama'} onChange={() => setDraft({ ...draft, provider: 'ollama' })} />
            <span><strong>Ollama (local)</strong> Runs a model on this computer. Private and free; quality depends on the model.</span>
          </label>
          <label className={draft.provider === 'anthropic' ? 'active' : ''}>
            <input type="radio" name="provider" checked={draft.provider === 'anthropic'} onChange={() => setDraft({ ...draft, provider: 'anthropic' })} />
            <span><strong>Anthropic API</strong> Best results. Descriptions are sent to Anthropic and billed to your API key.</span>
          </label>
        </fieldset>

        {draft.provider === 'ollama' ? (
          <div className="cg-ai-grid">
            <label className="cg-field">
              <span>Ollama URL</span>
              <input value={draft.ollamaUrl} onChange={(e) => setDraft({ ...draft, ollamaUrl: e.target.value })} aria-label="Ollama URL" />
            </label>
            <label className="cg-field">
              <span>Model</span>
              <input value={draft.ollamaModel} onChange={(e) => setDraft({ ...draft, ollamaModel: e.target.value })} aria-label="Ollama model" />
            </label>
          </div>
        ) : (
          <>
            <label className="cg-field">
              <span>Model</span>
              <input value={draft.anthropicModel} onChange={(e) => setDraft({ ...draft, anthropicModel: e.target.value })} aria-label="Anthropic model" />
            </label>
            <div className="cg-field">
              <span>
                API key{' '}
                {state.key === 'saved' ? '· saved, encrypted with your system keychain' : state.key === 'session' ? '· kept for this session only' : '· not set'}
              </span>
              <div className="cg-row">
                <input type="password" autoComplete="off" value={keyInput} placeholder={state.key === 'none' ? 'sk-ant-…' : 'Replace the saved key'} onChange={(e) => setKeyInput(e.target.value)} aria-label="Anthropic API key" />
                <button
                  className="cg-ghost"
                  disabled={!keyInput.trim()}
                  onClick={async () => {
                    const r = await bridge.ai.setKey(keyInput)
                    setKeyInput('')
                    await reload()
                    setNote({ kind: 'ok', text: r.persisted ? 'Key saved.' : "Key kept for this session only: this system can't encrypt it for storage." })
                  }}
                >
                  Save key
                </button>
                {state.key !== 'none' && (
                  <button
                    className="cg-danger"
                    onClick={async () => {
                      await bridge.ai.setKey(null)
                      await reload()
                      setNote({ kind: 'ok', text: 'Key removed.' })
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {note && <div className={note.kind === 'error' ? 'cg-error' : 'cg-ok'} role="status" data-testid="ai-note">{note.text}</div>}

        <div className="cg-modal-actions">
          <button
            className="cg-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await save()
              const r = await bridge.ai.test()
              setBusy(false)
              setNote(r.error ? { kind: 'error', text: r.error } : { kind: 'ok', text: r.message ?? 'Connected.' })
            }}
          >
            {busy ? 'Testing…' : 'Test connection'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="cg-ghost" onClick={() => setDialog(null)}>Cancel</button>
          <button
            className="cg-primary"
            onClick={async () => {
              await save()
              setDialog('describe')
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
