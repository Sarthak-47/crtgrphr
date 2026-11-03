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
import { emptyProject, type DiagramType, type IRDiagram } from '@shared/ir'
import { parseProject, sanitizeDiagram, serializeProject } from '@shared/serialize'
import { diagramToSvg, svgToPngDataUrl } from '../export/svg'
import { SAMPLES } from '../adapters/samples'

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
  return true
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
  await store().beginRescan(sanitizeDiagram(res.diagram).value)
}

/** The path part of a node's provenance, if it names a file or folder. */
export function revealablePath(source: string): string | null {
  const path = source.split('#')[0].trim()
  if (!path || /\s/.test(path) || path.includes('..')) return null
  return path
}

export async function revealSource(source: string): Promise<void> {
  const bridge = api()
  const origin = store().project.diagram.origin
  const rel = revealablePath(source)
  if (!bridge || !origin || !rel) return
  const res = await bridge.shell.reveal(origin.root, rel)
  store().setStatus(res.error ?? `Revealed ${res.path}`)
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
  await store().loadProject(p, { status: withFixes(`Mapped ${value.nodes.length} components from ${res.dir}`, fixes) })
}

export async function exportSvg(): Promise<void> {
  const { project, laid, theme } = store()
  if (!laid) return
  const { svg } = diagramToSvg(project.diagram, laid, theme)
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
    const dataUrl = await svgToPngDataUrl(diagramToSvg(project.diagram, laid, theme).svg, 2)
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
