/**
 * Document-level actions shared by the toolbar and keyboard shortcuts: new,
 * open, save, save as, scan, samples, import, export. Each one that replaces the
 * current map first asks before discarding unsaved changes.
 *
 * In the desktop app these go through the preload bridge (native dialogs). In a
 * plain browser (the renderer dev server) they fall back to file inputs and
 * downloads, so the UI stays usable for development.
 */
import { useStore, isDirty } from '../state/store'
import { EDITORS, isEditorId, sourcePath, type EditorId } from '@shared/editor'
import { emptyProject, type DiagramType, type IRDiagram } from '@shared/ir'
import { parseProject, sanitizeDiagram, serializeProject } from '@shared/serialize'
import { diagramToSvg, svgToPngDataUrl } from '../export/svg'
import { shareCardSvg } from '../export/shareCard'
import { diagramToMermaid } from '../adapters/mermaid-export'
import { visibleDiagram } from '@shared/collapse'
import { diagramToDrawio } from '../export/drawio'
import { diagramToC4PlantUml } from '../adapters/c4-export'
import { SAMPLES } from '../adapters/samples'
import { addRecent, removeRecent } from './recent'

const api = () => (typeof window !== 'undefined' ? window.cartographer : undefined)
const store = () => useStore.getState()

/** A safe default file name from the map title. */
export function fileBase(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map'
}

/** Resolve true if it's OK to replace the current map. */
export async function confirmDiscard(action: string): Promise<boolean> {
  if (!isDirty(store())) return true
  const message = 'Discard unsaved changes?'
  const detail = `${action} will replace the current map, and its unsaved changes will be lost.`
  const bridge = api()
  if (bridge) return bridge.app.confirm({ message, detail, confirmLabel: 'Discard changes' })
  return window.confirm(`${message}\n\n${detail}`)
}

const withFixes = (base: string, fixes: string[]): string =>
  fixes.length ? `${base}. Repaired: ${fixes.join('; ')}` : base

export async function newMap(type: DiagramType = 'architecture'): Promise<void> {
  if (!(await confirmDiscard('Starting a new map'))) return
  await store().newProject(type)
}

export async function loadSampleMap(key: keyof typeof SAMPLES): Promise<void> {
  if (!(await confirmDiscard('Loading a sample'))) return
  await store().loadSample(key)
}

/** Load a diagram that came from somewhere other than a file (import, scan). */
export async function loadDiagram(input: unknown, describe: (n: number) => string, action: string): Promise<boolean> {
  const { value, fixes } = sanitizeDiagram(input)
  if (value.nodes.length === 0) {
    store().setStatus('Nothing to import: no nodes found')
    return false
  }
  if (!(await confirmDiscard(action))) return false
  const p = emptyProject(value.type)
  p.diagram = value
  await store().loadProject(p, { status: withFixes(describe(value.nodes.length), fixes) })
  return true
}

export async function openMap(): Promise<void> {
  if (!(await confirmDiscard('Opening a file'))) return
  const bridge = api()
  let text: string | undefined
  let path: string | null = null
  if (bridge) {
    const res = await bridge.file.openProject()
    if (res.error) return store().setStatus(res.error)
    if (res.canceled || res.text === undefined) return
    text = res.text
    path = res.path ?? null
  } else {
    text = await pickTextFile('.crtgrphr,.json')
    if (text === undefined) return
  }
  try {
    const { value, fixes } = parseProject(text, { filePath: path })
    await store().loadProject(value, { filePath: path, status: withFixes(`Opened ${path ?? 'file'}`, fixes) })
    if (path) addRecent(path, value.diagram.title)
  } catch (e) {
    store().setStatus(e instanceof Error ? e.message : String(e))
  }
}

/** Save to the current file, or ask where if it has never been saved. */
export async function saveMap(): Promise<boolean> {
  const { filePath, project } = store()
  const bridge = api()
  if (!filePath || !bridge) return saveMapAs()
  const res = await bridge.file.writeTo({ path: filePath, text: serializeProject(project, { filePath }) })
  if (res.error) {
    store().setStatus(res.error)
    return false
  }
  store().markSaved(res.path ?? filePath)
  addRecent(res.path ?? filePath, project.diagram.title)
  return true
}

export async function saveMapAs(): Promise<boolean> {
  const { project, filePath } = store()
  const text = serializeProject(project)
  const name = filePath?.split(/[\\/]/).pop() ?? `${fileBase(project.diagram.title)}.crtgrphr`
  const bridge = api()
  if (!bridge) {
    download(name, text, 'application/json')
    store().markSaved(name)
    return true
  }
  const res = await bridge.file.saveAs({
    defaultName: name,
    text,
    filters: [{ name: 'Cartographer map', extensions: ['crtgrphr'] }],
    remember: true,
  })
  if (res.error) {
    store().setStatus(res.error)
    return false
  }
  if (res.canceled || !res.path) return false
  // The origin is stored relative to the file, which we only know now.
  const relative = serializeProject(project, { filePath: res.path })
  if (relative !== text) {
    const again = await bridge.file.writeTo({ path: res.path, text: relative })
    if (again.error) {
      store().setStatus(again.error)
      return false
    }
  }
  store().markSaved(res.path)
  addRecent(res.path, project.diagram.title)
  return true
}

/** Open a map from the recent list; forgets entries whose file is gone. */
export async function openRecent(path: string): Promise<void> {
  const bridge = api()
  if (!bridge) return
  if (!(await confirmDiscard('Opening a file'))) return
  const res = await bridge.file.openPath(path)
  if (res.error || res.text === undefined) {
    if (res.missing) removeRecent(path)
    return store().setStatus(res.error ?? `Couldn't open ${path}`)
  }
  try {
    const { value, fixes } = parseProject(res.text, { filePath: res.path })
    await store().loadProject(value, { filePath: res.path ?? path, status: withFixes(`Opened ${res.path ?? path}`, fixes) })
    addRecent(res.path ?? path, value.diagram.title)
  } catch (e) {
    store().setStatus(e instanceof Error ? e.message : String(e))
  }
}

/** Re-scan the folder this map came from and preview what changed. */
export async function rescanRepo(): Promise<void> {
  const bridge = api()
  const origin = store().project.diagram.origin
  if (!origin) return store().setStatus('This map was not scanned from a folder')
  if (!bridge) return store().setStatus('Re-scanning needs the desktop app')
  store().setStatus(`Re-scanning ${origin.root}…`)
  const res = await bridge.repo.rescan(origin.root)
  if (res.error) return store().setStatus(res.error)
  if (res.canceled || !res.diagram) return store().setStatus('Re-scan canceled')
  store().setScanNotes(res.warnings ?? [])
  await store().beginRescan(sanitizeDiagram(res.diagram).value)
}

/** The path part of a node's provenance, if it names a file or folder. */
export const revealablePath = sourcePath

export async function revealSource(source: string): Promise<void> {
  const bridge = api()
  const origin = store().project.diagram.origin
  const rel = sourcePath(source)
  if (!bridge || !origin || !rel) return
  const res = await bridge.shell.reveal(origin.root, rel)
  store().setStatus(res.error ?? `Revealed ${res.path}`)
}

const EDITOR_KEY = 'crtgrphr.editor'

/** The editor "Open" uses, remembered per machine. */
export function preferredEditor(): EditorId {
  try {
    const v = localStorage.getItem(EDITOR_KEY)
    return isEditorId(v) ? v : 'vscode'
  } catch {
    return 'vscode'
  }
}

export function setPreferredEditor(editor: EditorId): void {
  try {
    localStorage.setItem(EDITOR_KEY, editor)
  } catch {
    /* not remembered; still used for this click */
  }
}

/** Open a repo-relative path from the map in the preferred editor. */
export async function openInEditor(rel: string | null, editor: EditorId = preferredEditor()): Promise<void> {
  const bridge = api()
  const origin = store().project.diagram.origin
  if (!bridge || !origin || !rel) return
  const res = await bridge.shell.openInEditor(origin.root, rel, editor)
  store().setStatus(res.error ?? `Opened ${res.path} in ${EDITORS[editor].label}`)
}

export async function scanRepo(): Promise<void> {
  const bridge = api()
  if (!bridge) return store().setStatus('Scanning a repository needs the desktop app')
  if (!(await confirmDiscard('Scanning a repository'))) return
  store().setStatus('Scanning repository…')
  const res = await bridge.repo.pickAndScan()
  if (res.error) return store().setStatus(res.error)
  if (res.canceled || !res.diagram) return store().setStatus('Scan canceled')
  const d: IRDiagram = res.diagram
  const { value, fixes } = sanitizeDiagram(d)
  const p = emptyProject()
  p.diagram = value
  // Already confirmed above; load directly.
  const notes = res.warnings ?? []
  const said = notes.length ? ` · ${notes.length} scan note${notes.length === 1 ? '' : 's'} in the Map panel` : ''
  await store().loadProject(p, { status: withFixes(`Mapped ${value.nodes.length} components from ${res.dir}${said}`, fixes) })
  store().setScanNotes(notes)
}

export async function exportSvg(): Promise<void> {
  const { project, laid, theme } = store()
  if (!laid) return
  const { svg } = diagramToSvg(visibleDiagram(project.diagram), laid, theme)
  const name = `${fileBase(project.diagram.title)}.svg`
  const bridge = api()
  if (!bridge) return download(name, svg, 'image/svg+xml')
  const res = await bridge.file.saveAs({ defaultName: name, text: svg, filters: [{ name: 'SVG image', extensions: ['svg'] }] })
  if (res.error) store().setStatus(res.error)
  else if (!res.canceled) store().setStatus(`Exported ${res.path}`)
}

export async function exportPng(): Promise<void> {
  const { project, laid, theme } = store()
  if (!laid) return
  store().setStatus('Rendering PNG…')
  try {
    const dataUrl = await svgToPngDataUrl(diagramToSvg(visibleDiagram(project.diagram), laid, theme).svg, 2)
    const name = `${fileBase(project.diagram.title)}.png`
    const bridge = api()
    if (!bridge) {
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = name
      a.click()
      return store().setStatus(`Downloaded ${name}`)
    }
    const res = await bridge.file.savePng({ defaultName: name, dataUrl })
    if (res.error) store().setStatus(res.error)
    else if (!res.canceled) store().setStatus(`Exported ${res.path}`)
    else store().setStatus('Export canceled')
  } catch (e) {
    store().setStatus(`PNG export failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Save the map as Mermaid text (.mmd). */
export async function exportMermaid(): Promise<void> {
  const { project } = store()
  const text = diagramToMermaid(visibleDiagram(project.diagram))
  const name = `${fileBase(project.diagram.title)}.mmd`
  const bridge = api()
  if (!bridge) return download(name, text, 'text/plain')
  const res = await bridge.file.saveAs({ defaultName: name, text, filters: [{ name: 'Mermaid', extensions: ['mmd'] }] })
  if (res.error) store().setStatus(res.error)
  else if (!res.canceled) store().setStatus(`Exported ${res.path}`)
}

async function saveText(name: string, text: string, filter: { name: string; extensions: string[] }, mime: string): Promise<void> {
  const bridge = api()
  if (!bridge) return download(name, text, mime)
  const res = await bridge.file.saveAs({ defaultName: name, text, filters: [filter] })
  if (res.error) store().setStatus(res.error)
  else if (!res.canceled) store().setStatus(`Exported ${res.path}`)
}

/** Save the map as a draw.io file, laid out as on screen and editable there. */
export async function exportDrawio(): Promise<void> {
  const { project, laid } = store()
  if (!laid) return
  const text = diagramToDrawio(visibleDiagram(project.diagram), laid)
  await saveText(`${fileBase(project.diagram.title)}.drawio`, text, { name: 'draw.io', extensions: ['drawio'] }, 'application/xml')
}

/** Save the map as a C4 container diagram in C4-PlantUML. */
export async function exportC4(): Promise<void> {
  const { project } = store()
  const text = diagramToC4PlantUml(visibleDiagram(project.diagram))
  await saveText(`${fileBase(project.diagram.title)}.puml`, text, { name: 'PlantUML', extensions: ['puml'] }, 'text/plain')
}

/** Copy the map as Mermaid text, ready to paste into a README or a PR. */
export async function copyMermaid(): Promise<void> {
  const text = diagramToMermaid(visibleDiagram(store().project.diagram))
  try {
    const bridge = api()
    if (bridge) await bridge.clipboard.writeText(text)
    else await navigator.clipboard.writeText(text)
    store().setStatus('Copied as Mermaid')
  } catch (e) {
    store().setStatus(`Couldn't copy: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** A 1200×630 PNG for READMEs, PRs and social posts. */
export async function exportShareCard(): Promise<void> {
  const { project, laid, theme } = store()
  if (!laid) return
  store().setStatus('Rendering share card…')
  try {
    const dataUrl = await svgToPngDataUrl(shareCardSvg(visibleDiagram(project.diagram), laid, theme).svg, 1)
    const name = `${fileBase(project.diagram.title)}-card.png`
    const bridge = api()
    if (!bridge) {
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = name
      a.click()
      return store().setStatus(`Downloaded ${name}`)
    }
    const res = await bridge.file.savePng({ defaultName: name, dataUrl })
    if (res.error) store().setStatus(res.error)
    else if (!res.canceled) store().setStatus(`Exported share card ${res.path}`)
    else store().setStatus('Export canceled')
  } catch (e) {
    store().setStatus(`Share card export failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function pickTextFile(accept: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(undefined)
      f.text().then(resolve, () => resolve(undefined))
    }
    input.click()
  })
}
