import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore, isDirty } from '../state/store'
import { DIAGRAM_TYPES, type DiagramType, type Direction } from '@shared/ir'
import { BrandMark, CheckIcon, ChevronIcon, DescribeIcon, ImportIcon, LayoutIcon, MoonIcon, PlusIcon, RedoIcon, RescanIcon, ScanIcon, SearchIcon, SunIcon, UndoIcon } from './icons'
import { copyMermaid, exportC4, exportDrawio, exportMermaid, exportPng, exportShareCard, exportSvg, helmPreferred, loadSampleMap, newMap, openMap, rescanRepo, saveMap, saveMapAs, scanRepo, setHelmPreferred } from '../actions/files'

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
  const rescan = useStore((s) => s.rescan)
  const [helm, setHelm] = useState(helmPreferred)
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
        <BrandMark />
        <input className="cg-title-input" value={diagram.title} onChange={(e) => setTitle(e.target.value)} aria-label="Map title" />
        {dirty && <span className="cg-dirty" title="Unsaved changes" role="img" aria-label="Unsaved changes" />}
      </div>

      <div className="cg-toolbar-group">
        <Menu label="File">
            <button onClick={() => useStore.getState().setWelcomeOpen(true)}>Welcome…</button>
            <button onClick={() => void newMap()}>New map <kbd>Ctrl+N</kbd></button>
            <button onClick={() => void openMap()}>Open… <kbd>Ctrl+O</kbd></button>
            <button onClick={() => void saveMap()}>Save <kbd>Ctrl+S</kbd></button>
            <button onClick={() => void saveMapAs()}>Save as… <kbd>Ctrl+⇧+S</kbd></button>
            <hr />
            <button
              role="menuitemcheckbox"
              aria-checked={helm}
              onClick={() => {
                setHelmPreferred(!helm)
                setHelm(!helm)
              }}
              title="When scanning, run helm template (if helm is installed) so charts show the workloads they deploy. Nothing is downloaded."
            >
              <span className="cg-check-slot">{helm && <CheckIcon />}</span>Render Helm charts when scanning
            </button>
            <hr />
            <button onClick={() => void exportPng()}>Export PNG</button>
            <button onClick={() => void exportSvg()}>Export SVG</button>
            <button onClick={() => void exportShareCard()}>Export share card</button>
            <button onClick={() => void exportMermaid()}>Export Mermaid</button>
            <button onClick={() => void copyMermaid()}>Copy as Mermaid</button>
            <button onClick={() => void exportDrawio()}>Export draw.io</button>
            <button onClick={() => void exportC4()}>Export C4 (PlantUML)</button>
        </Menu>
        <button className="cg-primary cg-with-icon" onClick={run(scanRepo)} disabled={busy || !!rescan}><ScanIcon />Scan repo…</button>
        {diagram.origin && (
          <button className="cg-ghost cg-with-icon" onClick={run(rescanRepo)} disabled={busy || !!rescan} title={`Re-scan ${diagram.origin.root} and review what changed`}>
            <RescanIcon />Re-scan
          </button>
        )}
        <button className="cg-ghost cg-with-icon" onClick={() => useStore.getState().setDialog('describe')} disabled={!!rescan} title="Describe your system and let AI draft the map">
          <DescribeIcon />Describe…
        </button>
        <button className="cg-ghost cg-with-icon cg-compact" onClick={onImport} title="Import Mermaid or JSON (Ctrl+I)"><ImportIcon /><span className="cg-btn-label">Import</span></button>
      </div>

      <div className="cg-toolbar-group">
        <select className="cg-type-select" value={diagram.type} onChange={(e) => void setType(e.target.value as DiagramType)} title="Diagram type" aria-label="Diagram type">
          {DIAGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={diagram.direction ?? 'RIGHT'}
          onChange={(e) => void setDirection(e.target.value as Direction)}
          disabled={diagram.type === 'sequence'}
          title={diagram.type === 'sequence' ? 'Sequence diagrams always read left to right, top to bottom' : 'Flow direction'}
          aria-label="Flow direction"
        >
          <option value="RIGHT">Left to right</option>
          <option value="DOWN">Top to bottom</option>
          <option value="LEFT">Right to left</option>
          <option value="UP">Bottom to top</option>
        </select>
        <button className="cg-ghost cg-with-icon cg-compact" onClick={() => void reflow()} title="Auto-layout: re-flow, keeping pins"><LayoutIcon /><span className="cg-btn-label">Auto-layout</span></button>
        <button className="cg-ghost" onClick={() => void resetLayout()} title="Clear pins and lay out fresh">Reset</button>
      </div>

      <div className="cg-toolbar-group">
        <button
          className="cg-ghost cg-with-icon cg-compact"
          onClick={async () => startEditing(await addNode())}
          title="Add node (N)"
        >
          <PlusIcon /><span className="cg-btn-label">Node</span>
        </button>
        <button className="cg-ghost cg-icon-only" onClick={() => setSearchOpen(true)} title="Find node (Ctrl+F)" aria-label="Find node"><SearchIcon /></button>
        <button className="cg-ghost cg-icon-only" onClick={() => void undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><UndoIcon /></button>
        <button className="cg-ghost cg-icon-only" onClick={() => void redo()} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><RedoIcon /></button>
      </div>

      <div className="cg-toolbar-spacer" />

      <div className="cg-toolbar-group">
        <Menu label="Samples">
            <button onClick={() => void loadSampleMap('webapp')}>Architecture</button>
            <button onClick={() => void loadSampleMap('deploy')}>Workflow</button>
            <button onClick={() => void loadSampleMap('cacheMiss')}>Sequence</button>
            <button onClick={() => void loadSampleMap('analytics')}>Dataflow</button>
            <button onClick={() => void loadSampleMap('agentRun')}>Lifecycle</button>
        </Menu>
        <button className="cg-ghost cg-icon-only" onClick={toggleTheme} title="Toggle theme" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}>{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</button>
      </div>
    </header>
  )
}

/**
 * A click-to-open menu (hover menus can't be opened from the keyboard and are
 * fiddly on touchpads). Closes on choosing an item, clicking elsewhere, or Escape.
 */
function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="cg-menu" ref={ref}>
      <button className="cg-ghost cg-with-icon cg-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronIcon />
      </button>
      {open && (
        <div className="cg-menu-list" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}
