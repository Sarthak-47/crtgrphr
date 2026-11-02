import { useState } from 'react'
import { useStore } from '../state/store'
import { DIAGRAM_TYPES, type DiagramType, type CartographProject } from '@shared/ir'
import { serializeProject, parseProject } from '@shared/serialize'
import { diagramToSvg, svgToPngDataUrl } from '../export/svg'

export function Toolbar({ onImport }: { onImport: () => void }) {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const project = useStore((s) => s.project)
  const setType = useStore((s) => s.setType)
  const setDirection = useStore((s) => s.setDirection)
  const reflow = useStore((s) => s.reflow)
  const resetLayout = useStore((s) => s.resetLayout)
  const addNode = useStore((s) => s.addNode)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const loadSample = useStore((s) => s.loadSample)
  const setStatus = useStore((s) => s.setStatus)
  const setProject = useStore((s) => s.setProject)
  const setTitle = useStore((s) => s.setTitle)
  const setFilePath = useStore((s) => s.setFilePath)
  const [busy, setBusy] = useState(false)

  const diagram = project.diagram
  const api = window.cartographer

  async function scanRepo() {
    if (!api) return setStatus('Repo scan needs the desktop app')
    setBusy(true)
    setStatus('Scanning repository…')
    try {
      const res = await api.repo.pickAndScan()
      if (res.canceled || !res.diagram) return setStatus('Scan canceled')
      await setProject({ schema_version: project.schema_version, diagram: res.diagram, layout: {} }, { status: `Mapped ${res.diagram.nodes.length} components from ${res.dir}` })
      setFilePath(null)
    } catch (e) {
      setStatus(`Scan failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function openProject() {
    if (!api) return
    const res = await api.file.openProject()
    if (res.canceled || !res.text) return
    try {
      const p: CartographProject = parseProject(res.text)
      await setProject(p, { status: `Opened ${res.path}` })
      setFilePath(res.path ?? null)
    } catch (e) {
      setStatus(`Open failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function saveProject() {
    const text = serializeProject(project)
    if (api) {
      const res = await api.file.save({
        defaultName: `${diagram.id}.crtgrphr`,
        text,
        filters: [{ name: 'Cartographer', extensions: ['crtgrphr'] }],
      })
      if (!res.canceled) {
        setFilePath(res.path ?? null)
        setStatus(`Saved ${res.path}`)
      }
    } else download(`${diagram.id}.crtgrphr`, text, 'application/json')
  }

  async function exportSvg() {
    const laid = useStore.getState().laid
    if (!laid) return
    const svg = diagramToSvg(diagram, laid, theme)
    if (api) {
      const res = await api.file.save({ defaultName: `${diagram.id}.svg`, text: svg, filters: [{ name: 'SVG', extensions: ['svg'] }] })
      if (!res.canceled) setStatus(`Saved ${res.path}`)
    } else download(`${diagram.id}.svg`, svg, 'image/svg+xml')
  }

  async function exportPng() {
    const laid = useStore.getState().laid
    if (!laid) return
    setStatus('Rendering PNG…')
    const dataUrl = await svgToPngDataUrl(diagramToSvg(diagram, laid, theme), 2)
    if (api) {
      const res = await api.file.savePng({ defaultName: `${diagram.id}.png`, dataUrl })
      if (!res.canceled) setStatus(`Saved ${res.path}`)
    } else {
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${diagram.id}.png`
      a.click()
    }
  }

  return (
    <header className="cg-toolbar">
      <div className="cg-brand">
        <span className="cg-logo">◆</span>
        <input className="cg-title-input" value={diagram.title} onChange={(e) => setTitle(e.target.value)} aria-label="Map title" />
      </div>

      <div className="cg-toolbar-group">
        <select value={diagram.type} onChange={(e) => void setType(e.target.value as DiagramType)} title="Diagram type">
          {DIAGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={diagram.direction ?? 'RIGHT'} onChange={(e) => void setDirection(e.target.value as never)} title="Flow direction">
          <option value="RIGHT">→ Right</option>
          <option value="DOWN">↓ Down</option>
          <option value="LEFT">← Left</option>
          <option value="UP">↑ Up</option>
        </select>
        <button className="cg-ghost" onClick={() => void reflow()} title="Re-flow, keeping pins">Auto-layout</button>
        <button className="cg-ghost" onClick={() => void resetLayout()} title="Clear pins & lay out fresh">Reset</button>
      </div>

      <div className="cg-toolbar-group">
        <button className="cg-ghost" onClick={() => void addNode()}>+ Node</button>
        <button className="cg-ghost" onClick={() => void undo()} title="Undo (Ctrl+Z)">↺</button>
        <button className="cg-ghost" onClick={() => void redo()} title="Redo (Ctrl+Y)">↻</button>
      </div>

      <div className="cg-toolbar-spacer" />

      <div className="cg-toolbar-group">
        <button className="cg-ghost" onClick={scanRepo} disabled={busy}>Scan repo…</button>
        <button className="cg-ghost" onClick={onImport}>Import</button>
        <button className="cg-ghost" onClick={openProject}>Open</button>
        <button className="cg-ghost" onClick={saveProject}>Save</button>
        <div className="cg-menu">
          <button className="cg-ghost">Export ▾</button>
          <div className="cg-menu-list">
            <button onClick={() => void exportPng()}>PNG image</button>
            <button onClick={() => void exportSvg()}>SVG vector</button>
          </div>
        </div>
      </div>

      <div className="cg-toolbar-group">
        <div className="cg-menu">
          <button className="cg-ghost">Samples ▾</button>
          <div className="cg-menu-list">
            <button onClick={() => void loadSample('webapp')}>Architecture</button>
            <button onClick={() => void loadSample('deploy')}>Workflow</button>
            <button onClick={() => void loadSample('cacheMiss')}>Sequence</button>
            <button onClick={() => void loadSample('analytics')}>Dataflow</button>
            <button onClick={() => void loadSample('agentRun')}>Lifecycle</button>
          </div>
        </div>
        <button className="cg-ghost" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
      </div>
    </header>
  )
}

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
