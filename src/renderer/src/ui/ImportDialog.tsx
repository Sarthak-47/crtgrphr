import { useState } from 'react'
import { useStore } from '../state/store'
import { mermaidToIR } from '../adapters/mermaid'
import { normalizeDiagram } from '@shared/serialize'
import { emptyProject } from '@shared/ir'

const MERMAID_EXAMPLE = `flowchart LR
  U[User] --> W[Web app]
  W --> A[API]
  A --> D[(Postgres)]
  A --> C[(Redis)]`

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'mermaid' | 'json'>('mermaid')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const setProject = useStore((s) => s.setProject)

  async function doImport() {
    setError(null)
    try {
      const diagram = tab === 'mermaid' ? mermaidToIR(text) : normalizeDiagram(JSON.parse(text))
      if (diagram.nodes.length === 0) throw new Error('No nodes found')
      const p = emptyProject()
      p.diagram = diagram
      await setProject(p, { status: `Imported ${diagram.nodes.length} nodes from ${tab === 'mermaid' ? 'Mermaid' : 'JSON'}` })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="cg-modal-scrim" onClick={onClose}>
      <div className="cg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cg-modal-head">
          <h2>Import</h2>
          <button className="cg-icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="cg-tabs">
          <button className={tab === 'mermaid' ? 'active' : ''} onClick={() => setTab('mermaid')}>Mermaid</button>
          <button className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>Agent JSON (IR)</button>
        </div>

        <p className="cg-modal-hint">
          {tab === 'mermaid'
            ? 'Paste a flowchart, sequenceDiagram, or stateDiagram. We read the topology and re-lay it out — no styling copied.'
            : 'Paste Cartographer IR (or an agent’s output): { title, type, nodes[], edges[] }. No pixel coordinates — layout is automatic.'}
        </p>

        <textarea
          className="cg-code"
          spellCheck={false}
          placeholder={tab === 'mermaid' ? MERMAID_EXAMPLE : '{\n  "title": "...",\n  "type": "architecture",\n  "nodes": [ ... ],\n  "edges": [ ... ]\n}'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {error && <div className="cg-error">{error}</div>}

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
