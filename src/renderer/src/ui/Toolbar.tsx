import { useState } from 'react'
import { useStore, isDirty } from '../state/store'
import { DIAGRAM_TYPES, type DiagramType, type Direction } from '@shared/ir'
import { exportPng, exportSvg, loadSampleMap, newMap, openMap, saveMap, saveMapAs, scanRepo } from '../actions/files'

export function Toolbar({ onImport }: { onImport: () => void }) {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const diagram = useStore((s) => s.project.diagram)
  const dirty = useStore(isDirty)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const setType = useStore((s) => s.setType)
  const setDirection = useStore((s) => s.setDirection)
  const reflow = useStore((s) => s.reflow)
  const resetLayout = useStore((s) => s.resetLayout)
  const addNode = useStore((s) => s.addNode)
  const startEditing = useStore((s) => s.startEditing)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const setTitle = useStore((s) => s.setTitle)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const [busy, setBusy] = useState(false)

  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="cg-toolbar">
      <div className="cg-brand">
        <span className="cg-logo" aria-hidden>◆</span>
        <input className="cg-title-input" value={diagram.title} onChange={(e) => setTitle(e.target.value)} aria-label="Map title" />
        {dirty && <span className="cg-dirty" title="Unsaved changes" aria-label="Unsaved changes">●</span>}
      </div>

      <div className="cg-toolbar-group">
        <div className="cg-menu">
          <button className="cg-ghost">File ▾</button>
          <div className="cg-menu-list" role="menu">
            <button onClick={() => void newMap()}>New map <kbd>Ctrl+N</kbd></button>
            <button onClick={() => void openMap()}>Open… <kbd>Ctrl+O</kbd></button>
            <button onClick={() => void saveMap()}>Save <kbd>Ctrl+S</kbd></button>
            <button onClick={() => void saveMapAs()}>Save as… <kbd>Ctrl+⇧+S</kbd></button>
            <hr />
            <button onClick={() => void exportPng()}>Export PNG</button>
            <button onClick={() => void exportSvg()}>Export SVG</button>
          </div>
        </div>
        <button className="cg-ghost" onClick={run(scanRepo)} disabled={busy}>Scan repo…</button>
        <button className="cg-ghost" onClick={onImport}>Import</button>
      </div>

      <div className="cg-toolbar-group">
        <select value={diagram.type} onChange={(e) => void setType(e.target.value as DiagramType)} title="Diagram type" aria-label="Diagram type">
          {DIAGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={diagram.direction ?? 'RIGHT'} onChange={(e) => void setDirection(e.target.value as Direction)} title="Flow direction" aria-label="Flow direction">
          <option value="RIGHT">→ Right</option>
          <option value="DOWN">↓ Down</option>
          <option value="LEFT">← Left</option>
          <option value="UP">↑ Up</option>
        </select>
        <button className="cg-ghost" onClick={() => void reflow()} title="Re-flow, keeping pins">Auto-layout</button>
        <button className="cg-ghost" onClick={() => void resetLayout()} title="Clear pins and lay out fresh">Reset</button>
      </div>

      <div className="cg-toolbar-group">
        <button
          className="cg-ghost"
          onClick={async () => startEditing(await addNode())}
          title="Add node (N)"
        >
          + Node
        </button>
        <button className="cg-ghost" onClick={() => setSearchOpen(true)} title="Find node (Ctrl+F)" aria-label="Find node">⌕</button>
        <button className="cg-ghost" onClick={() => void undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↺</button>
        <button className="cg-ghost" onClick={() => void redo()} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↻</button>
      </div>

      <div className="cg-toolbar-spacer" />

      <div className="cg-toolbar-group">
        <div className="cg-menu">
          <button className="cg-ghost">Samples ▾</button>
          <div className="cg-menu-list" role="menu">
            <button onClick={() => void loadSampleMap('webapp')}>Architecture</button>
            <button onClick={() => void loadSampleMap('deploy')}>Workflow</button>
            <button onClick={() => void loadSampleMap('cacheMiss')}>Sequence</button>
            <button onClick={() => void loadSampleMap('analytics')}>Dataflow</button>
            <button onClick={() => void loadSampleMap('agentRun')}>Lifecycle</button>
          </div>
        </div>
        <button className="cg-ghost" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
      </div>
    </header>
  )
}
