import { useState } from 'react'
import { mermaidToIR } from '../adapters/mermaid'
import { loadDiagram } from '../actions/files'

const MERMAID_EXAMPLE = `flowchart LR
  U[User] --> W[Web app]
  W --> A[API]
  A --> D[(Postgres)]
  A --> C[(Redis)]`

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'mermaid' | 'json'>('mermaid')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function doImport() {
    setError(null)
    try {
      const input = tab === 'mermaid' ? mermaidToIR(text) : JSON.parse(text)
      const from = tab === 'mermaid' ? 'Mermaid' : 'JSON'
      const ok = await loadDiagram(input?.diagram ?? input, (n) => `Imported ${n} nodes from ${from}`, 'Importing')
      if (ok) onClose()
      else setError('Nothing imported: no nodes found.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="cg-modal-scrim" onClick={onClose}>
      <div className="cg-modal" role="dialog" aria-label="Import" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="cg-modal-head">
          <h2>Import</h2>
          <button className="cg-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cg-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'mermaid'} className={tab === 'mermaid' ? 'active' : ''} onClick={() => setTab('mermaid')}>Mermaid</button>
          <button role="tab" aria-selected={tab === 'json'} className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>Agent JSON (IR)</button>
        </div>

        <p className="cg-modal-hint">
          {tab === 'mermaid'
            ? 'Paste a flowchart, sequenceDiagram, or stateDiagram. We read the topology and re-lay it out; styling is not copied.'
            : 'Paste Cartographer IR or an agent’s output: { title, type, nodes[], edges[] }. No pixel coordinates needed; layout is automatic. Problems are repaired and reported.'}
        </p>

        <textarea
          className="cg-code"
          spellCheck={false}
          autoFocus
          aria-label="Import text"
          placeholder={tab === 'mermaid' ? MERMAID_EXAMPLE : '{\n  "title": "...",\n  "type": "architecture",\n  "nodes": [ ... ],\n  "edges": [ ... ]\n}'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {error && <div className="cg-error" role="alert">{error}</div>}

        <div className="cg-modal-actions">
          {tab === 'mermaid' && <button className="cg-ghost" onClick={() => setText(MERMAID_EXAMPLE)}>Use example</button>}
          <div style={{ flex: 1 }} />
          <button className="cg-ghost" onClick={onClose}>Cancel</button>
          <button className="cg-primary" onClick={() => void doImport()} disabled={!text.trim()}>Import & lay out</button>
        </div>
      </div>
    </div>
  )
}
