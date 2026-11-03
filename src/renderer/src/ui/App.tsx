import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useStore, isDirty } from '../state/store'
import { Toolbar } from './Toolbar'
import { Inspector } from './Inspector'
import { Canvas } from '../canvas/Canvas'
import { ImportDialog } from './ImportDialog'
import { SearchBox } from './SearchBox'
import { Welcome } from './Welcome'
import { AiSettingsDialog, DescribeDialog } from './AiDialogs'
import { newMap, openMap, saveMap, saveMapAs } from '../actions/files'

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function App() {
  const theme = useStore((s) => s.theme)
  const relayout = useStore((s) => s.relayout)
  const laying = useStore((s) => s.laying)
  const status = useStore((s) => s.status)
  const filePath = useStore((s) => s.filePath)
  const title = useStore((s) => s.project.diagram.title)
  const dirty = useStore(isDirty)
  const searchOpen = useStore((s) => s.searchOpen)
  const welcomeOpen = useStore((s) => s.welcomeOpen)
  const dialog = useStore((s) => s.dialog)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    void relayout()
  }, [relayout])

  // Window title + unsaved-changes guard (the main process asks before closing).
  useEffect(() => {
    const name = filePath ? filePath.split(/[\\/]/).pop() : title
    document.title = `${dirty ? '● ' : ''}${name} · Cartographer`
    window.cartographer?.app.setDirty(dirty)
  }, [dirty, filePath, title])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // The welcome screen and dialogs own the keyboard while open.
      if (s.dialog) return
      if (s.welcomeOpen) {
        if (e.key === 'Escape') s.setWelcomeOpen(false)
        return
      }

      // File shortcuts work even while typing in a field.
      if (mod && key === 's') {
        e.preventDefault()
        void (e.shiftKey ? saveMapAs() : saveMap())
        return
      }
      if (mod && key === 'o') {
        e.preventDefault()
        void openMap()
        return
      }
      if (mod && key === 'n') {
        e.preventDefault()
        void newMap()
        return
      }
      if (mod && key === 'f') {
        e.preventDefault()
        s.setSearchOpen(true)
        return
      }
      if (mod && key === 'i') {
        e.preventDefault()
        setImportOpen(true)
        return
      }

      // Everything else would fight with text editing inside inputs.
      if (isTyping(e.target)) return

      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void s.undo()
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        void s.redo()
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (s.selection) {
          e.preventDefault()
          void s.deleteSelection()
        }
      } else if (!mod && e.key === 'Escape') {
        s.select(null)
      } else if (!mod && !e.altKey && key === 'n') {
        e.preventDefault()
        void s.addNode().then((id) => s.startEditing(id))
      } else if (!mod && e.key === 'F2' && s.selection?.kind === 'node') {
        e.preventDefault()
        s.startEditing(s.selection.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="cg-app" data-theme={theme}>
      <Toolbar onImport={() => setImportOpen(true)} />
      <div className="cg-body">
        <ReactFlowProvider>
          <Canvas />
          {searchOpen && <SearchBox />}
        </ReactFlowProvider>
        <Inspector />
      </div>
      <footer className="cg-statusbar">
        <span className={laying ? 'cg-dot cg-dot-busy' : 'cg-dot'} />
        <span data-testid="status">{laying ? 'Laying out…' : status}</span>
        <div style={{ flex: 1 }} />
        <span className="cg-muted" data-testid="file-path">{filePath ?? 'Not saved yet'}{dirty ? ' · unsaved changes' : ''}</span>
      </footer>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {welcomeOpen && <Welcome />}
      {dialog === 'describe' && <DescribeDialog />}
      {dialog === 'ai-settings' && <AiSettingsDialog />}
    </div>
  )
}
