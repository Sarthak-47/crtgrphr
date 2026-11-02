import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useStore } from '../state/store'
import { Toolbar } from './Toolbar'
import { Inspector } from './Inspector'
import { Canvas } from '../canvas/Canvas'
import { ImportDialog } from './ImportDialog'

export function App() {
  const theme = useStore((s) => s.theme)
  const relayout = useStore((s) => s.relayout)
  const laying = useStore((s) => s.laying)
  const status = useStore((s) => s.status)
  const filePath = useStore((s) => s.filePath)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    void relayout()
  }, [relayout])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void undo()
      } else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        void redo()
      } else if (mod && e.key === 'i') {
        e.preventDefault()
        setImportOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return (
    <div className="cg-app" data-theme={theme}>
      <Toolbar onImport={() => setImportOpen(true)} />
      <div className="cg-body">
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
        <Inspector />
      </div>
      <footer className="cg-statusbar">
        <span className={laying ? 'cg-dot cg-dot-busy' : 'cg-dot'} />
        <span>{laying ? 'Laying out…' : status}</span>
        {filePath && <span className="cg-muted"> · {filePath}</span>}
        <div style={{ flex: 1 }} />
        <span className="cg-muted">Cartographer · grounded, auto-laid-out system maps</span>
      </footer>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  )
}
