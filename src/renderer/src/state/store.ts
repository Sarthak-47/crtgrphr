/**
 * App state. Owns the CartographProject (semantic IR + the separate layout layer)
 * plus theme, selection, and undo/redo. Implements pin-and-reflow (ADR-0004):
 * dragging a node pins it; "Auto-layout" re-flows unpinned nodes around the pins.
 */
import { create } from 'zustand'
import {
  emptyProject,
  defaultDirection,
  type CartographProject,
  type DiagramType,
  type Direction,
  type IRDiagram,
  type IREdge,
  type IRNode,
  type LayoutOverrides,
} from '@shared/ir'
import { layout as elkLayout, mergeOverrides, type LaidOut } from '../layout/elk'
import { SAMPLES } from '../adapters/samples'

type Theme = 'light' | 'dark'
interface Snapshot {
  project: CartographProject
}

interface AppState {
  project: CartographProject
  laid: LaidOut | null
  theme: Theme
  laying: boolean
  selection: string | null
  status: string
  filePath: string | null
  past: Snapshot[]
  future: Snapshot[]

  // derived getters
  diagram: () => IRDiagram

  setProject: (p: CartographProject, opts?: { record?: boolean; status?: string }) => Promise<void>
  setDiagram: (d: IRDiagram, opts?: { record?: boolean; resetLayout?: boolean }) => Promise<void>
  relayout: () => Promise<void>
  reflow: () => Promise<void>
  resetLayout: () => Promise<void>
  pinNode: (id: string, x: number, y: number) => void

  toggleTheme: () => void
  setDirection: (dir: Direction) => Promise<void>
  setType: (t: DiagramType) => Promise<void>
  select: (id: string | null) => void
  updateNode: (id: string, patch: Partial<IRNode>) => void
  deleteNode: (id: string) => Promise<void>
  addNode: (partial?: Partial<IRNode>) => Promise<void>
  addEdge: (source: string, target: string) => Promise<void>
  setTitle: (title: string) => void
  loadSample: (key: keyof typeof SAMPLES) => Promise<void>
  setStatus: (s: string) => void
  setFilePath: (p: string | null) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
}

let seq = 1
const nextId = (p: string): string => `${p}-${seq++}`

function snap(p: CartographProject): CartographProject {
  return structuredClone(p)
}

export const useStore = create<AppState>((set, get) => ({
  project: (() => {
    const p = emptyProject('architecture')
    p.diagram = SAMPLES.webapp
    return p
  })(),
  laid: null,
  theme: 'dark',
  laying: false,
  selection: null,
  status: 'Ready',
  filePath: null,
  past: [],
  future: [],

  diagram: () => get().project.diagram,

  async setProject(p, opts = {}) {
    if (opts.record !== false) {
      const prev = get().project
      set((s) => ({ past: [...s.past, { project: snap(prev) }].slice(-50), future: [] }))
    }
    set({ project: p })
    await get().relayout()
    if (opts.status) set({ status: opts.status })
  },

  async setDiagram(d, opts = {}) {
    const prev = get().project
    if (opts.record !== false) {
      set((s) => ({ past: [...s.past, { project: snap(prev) }].slice(-50), future: [] }))
    }
    set({
      project: {
        schema_version: prev.schema_version,
        diagram: d,
        layout: opts.resetLayout ? {} : prev.layout,
      },
    })
    await get().relayout()
  },

  async relayout() {
    set({ laying: true })
    try {
      const { project } = get()
      const laid = await elkLayout(project.diagram, project.layout)
      const nextLayout = mergeOverrides(laid, project.layout)
      set({ laid, project: { ...project, layout: nextLayout } })
    } finally {
      set({ laying: false })
    }
  },

  // "Auto-layout" button: same as relayout — honors pins, reflows the rest.
  async reflow() {
    await get().relayout()
    set({ status: 'Re-flowed layout (pins kept)' })
  },

  // Clear all pins and lay out fresh.
  async resetLayout() {
    const { project } = get()
    const cleared: LayoutOverrides = {}
    set({ project: { ...project, layout: cleared } })
    await get().relayout()
    set({ status: 'Layout reset' })
  },

  // Dragging a node pins it at the given position (no full relayout during drag).
  pinNode(id, x, y) {
    const { project, laid } = get()
    const layout = { ...project.layout, [id]: { x, y, pinned: true } }
    const positions = laid ? { ...laid.positions, [id]: { x, y } } : {}
    set({
      project: { ...project, layout },
      laid: laid ? { ...laid, positions } : laid,
    })
  },

  toggleTheme() {
    set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
  },

  async setDirection(dir) {
    await get().setDiagram({ ...get().project.diagram, direction: dir }, { resetLayout: true })
  },

  async setType(t) {
    const d = get().project.diagram
    await get().setDiagram({ ...d, type: t, direction: defaultDirection(t) }, { resetLayout: true })
  },

  select(id) {
    set({ selection: id })
  },

  updateNode(id, patch) {
    const { project } = get()
    set((s) => ({ past: [...s.past, { project: snap(project) }].slice(-50), future: [] }))
    const nodes = project.diagram.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
    set({ project: { ...project, diagram: { ...project.diagram, nodes } } })
  },

  async deleteNode(id) {
    const { project } = get()
    const diagram = project.diagram
    const nodes = diagram.nodes.filter((n) => n.id !== id)
    const edges = diagram.edges.filter((e) => e.source !== id && e.target !== id)
    const layout = { ...project.layout }
    delete layout[id]
    set({ selection: null })
    await get().setProject({ ...project, diagram: { ...diagram, nodes, edges }, layout })
  },

  async addNode(partial) {
    const { project } = get()
    const id = partial?.id ?? nextId('node')
    const node: IRNode = { id, label: partial?.label ?? 'New node', role: partial?.role ?? 'backend', ...partial }
    await get().setProject({ ...project, diagram: { ...project.diagram, nodes: [...project.diagram.nodes, node] } })
    set({ selection: id })
  },

  async addEdge(source, target) {
    const { project } = get()
    if (source === target) return
    if (project.diagram.edges.some((e) => e.source === source && e.target === target)) return
    const edge: IREdge = { id: nextId('edge'), source, target }
    await get().setProject({ ...project, diagram: { ...project.diagram, edges: [...project.diagram.edges, edge] } })
  },

  setTitle(title) {
    const { project } = get()
    set({ project: { ...project, diagram: { ...project.diagram, title } } })
  },

  async loadSample(key) {
    const p = emptyProject()
    p.diagram = structuredClone(SAMPLES[key])
    await get().setProject(p, { status: `Loaded sample: ${SAMPLES[key].title}` })
    set({ selection: null, filePath: null })
  },

  setStatus(s) {
    set({ status: s })
  },

  setFilePath(p) {
    set({ filePath: p })
  },

  async undo() {
    const { past, project, future } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    set({ past: past.slice(0, -1), future: [{ project: snap(project) }, ...future].slice(0, 50), project: prev.project })
    await get().relayout()
  },

  async redo() {
    const { future, project, past } = get()
    if (future.length === 0) return
    const next = future[0]
    set({ future: future.slice(1), past: [...past, { project: snap(project) }].slice(-50), project: next.project })
    await get().relayout()
  },
}))
