/**
 * App state. Owns the CartographProject (semantic IR + the separate layout layer)
 * plus selection, history, file/dirty tracking, and UI flags.
 *
 * Pin-and-reflow (ADR-0004): dragging a node pins it; "Auto-layout" re-flows the
 * unpinned nodes around the pins.
 *
 * History: every user edit pushes a snapshot. A drag is one step; a burst of
 * typing in one field (same tag within COALESCE_MS) is one step.
 *
 * Dirty tracking compares the *content* (diagram + pins) with what was last
 * saved or loaded, so re-layouts don't count as changes and undoing back to the
 * saved state makes the document clean again.
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
import { measureNode, mergeOverrides, type LaidOut } from '../layout/elk'
import { layoutDiagram } from '../layout'
import { SAMPLES } from '../adapters/samples'
import { applyRescan, diffDiagrams, diffIsEmpty, diffSummary, markEdited, type DiagramDiff } from '@shared/diff'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string }
export type DiffStatus = 'added' | 'removed' | 'changed'

/** A re-scan waiting for the user to apply or discard it. */
export interface RescanPreview {
  diff: DiagramDiff
  /** what the project becomes if applied */
  applied: CartographProject
  /** what the canvas shows meanwhile: the applied map plus removed items as ghosts */
  preview: IRDiagram
  status: Map<string, DiffStatus>
}
type Theme = 'light' | 'dark'

const HISTORY_LIMIT = 100
const COALESCE_MS = 1500
const RELAYOUT_DEBOUNCE_MS = 500

/* ------------------------------- Helpers -------------------------------- */

/** What counts as "the document": the diagram plus where the user pinned things. */
export function contentKey(p: CartographProject): string {
  const pins = Object.keys(p.layout)
    .filter((id) => p.layout[id].pinned)
    .sort()
    .map((id) => [id, Math.round(p.layout[id].x), Math.round(p.layout[id].y)])
  return JSON.stringify([p.diagram, pins])
}

/** `${prefix}-N` for the smallest N not already used. */
export function freshId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let n = 1
  while (used.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

const snap = (p: CartographProject): CartographProject => structuredClone(p)

let layoutSeq = 0
let relayoutTimer: ReturnType<typeof setTimeout> | null = null

/* -------------------------------- State --------------------------------- */

export interface AppState {
  project: CartographProject
  laid: LaidOut | null
  theme: Theme
  laying: boolean
  selection: Selection | null
  editingNodeId: string | null
  status: string
  filePath: string | null
  savedKey: string
  past: CartographProject[]
  future: CartographProject[]
  lastRecord: { tag: string; at: number } | null
  /** bumps whenever the canvas should center on a node (search, new node) */
  focusRequest: { id: string; n: number } | null
  searchOpen: boolean
  /** bumps when the canvas should fit the whole map (new document, rebuilt layout) */
  fitRequest: number
  legendOpen: boolean
  rescan: RescanPreview | null

  // document lifecycle
  loadProject: (p: CartographProject, opts?: { filePath?: string | null; status?: string }) => Promise<void>
  newProject: (type?: DiagramType) => Promise<void>
  loadSample: (key: keyof typeof SAMPLES) => Promise<void>
  markSaved: (filePath: string) => void

  // history
  record: (tag?: string) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  beginDrag: () => void

  // layout
  relayout: () => Promise<void>
  scheduleRelayout: () => void
  reflow: () => Promise<void>
  resetLayout: () => Promise<void>
  pinNode: (id: string, x: number, y: number) => void
  unpinNode: (id: string) => Promise<void>

  // diagram edits
  setTitle: (title: string) => void
  setSubtitle: (subtitle: string) => void
  setType: (t: DiagramType) => Promise<void>
  setDirection: (dir: Direction) => Promise<void>
  addNode: (partial?: Partial<IRNode>) => Promise<string>
  updateNode: (id: string, patch: Partial<IRNode>) => void
  deleteNode: (id: string) => Promise<void>
  addEdge: (source: string, target: string) => Promise<void>
  updateEdge: (id: string, patch: Partial<IREdge>) => void
  reverseEdge: (id: string) => Promise<void>
  deleteEdge: (id: string) => Promise<void>
  deleteSelection: () => Promise<void>
  /** sequence diagrams: preview a participant being dragged sideways */
  dragParticipant: (id: string, x: number) => void
  /** sequence diagrams: reorder participants by their current x after a drag */
  dropParticipant: () => Promise<void>
  /** sequence diagrams: move a message earlier (-1) or later (+1) */
  moveMessage: (id: string, delta: -1 | 1) => Promise<void>

  // ui
  select: (sel: Selection | null) => void
  startEditing: (id: string) => void
  stopEditing: () => void
  requestFocus: (id: string) => void
  setSearchOpen: (open: boolean) => void
  toggleLegend: () => void

  // re-scan
  beginRescan: (scanned: IRDiagram) => Promise<boolean>
  applyRescanPreview: () => Promise<void>
  discardRescan: () => Promise<void>
  toggleTheme: () => void
  setStatus: (s: string) => void
  /** drop a selection that no longer exists (after undo/redo) */
  fixSelection: () => void
}

export const isDirty = (s: Pick<AppState, 'project' | 'savedKey'>): boolean => contentKey(s.project) !== s.savedKey

function initialProject(): CartographProject {
  const p = emptyProject('architecture')
  p.diagram = structuredClone(SAMPLES.webapp)
  return p
}

export const useStore = create<AppState>((set, get) => {
  /** Replace the diagram (recording history first) and optionally re-layout. */
  const commit = async (
    next: CartographProject,
    opts: { tag?: string; relayout?: boolean } = {},
  ): Promise<void> => {
    get().record(opts.tag)
    set({ project: next })
    if (opts.relayout !== false) await get().relayout()
  }

  const initial = initialProject()

  return {
    project: initial,
    laid: null,
    theme: 'dark',
    laying: false,
    selection: null,
    editingNodeId: null,
    status: 'Ready',
    filePath: null,
    savedKey: contentKey(initial),
    past: [],
    future: [],
    lastRecord: null,
    focusRequest: null,
    searchOpen: false,
    fitRequest: 0,
    legendOpen: true,
    rescan: null,

    /* ---------------------------- lifecycle ---------------------------- */

    async loadProject(p, opts = {}) {
      set({
        rescan: null,
        project: p,
        savedKey: contentKey(p),
        filePath: opts.filePath ?? null,
        past: [],
        future: [],
        lastRecord: null,
        selection: null,
        editingNodeId: null,
        laid: null,
      })
      await get().relayout()
      set((s) => ({ fitRequest: s.fitRequest + 1 }))
      if (opts.status) set({ status: opts.status })
    },

    async newProject(type = 'architecture') {
      const p = emptyProject(type)
      await get().loadProject(p, { status: 'New map. Add a node, import, or scan a repo to start.' })
    },

    async loadSample(key) {
      const p = emptyProject()
      p.diagram = structuredClone(SAMPLES[key])
      await get().loadProject(p, { status: `Loaded sample: ${SAMPLES[key].title}` })
    },

    markSaved(filePath) {
      set({ filePath, savedKey: contentKey(get().project), status: `Saved ${filePath}` })
    },

    /* ----------------------------- history ----------------------------- */

    record(tag) {
      const now = Date.now()
      const last = get().lastRecord
      if (tag && last && last.tag === tag && now - last.at < COALESCE_MS) {
        set({ lastRecord: { tag, at: now } })
        return
      }
      set((s) => ({
        past: [...s.past, snap(s.project)].slice(-HISTORY_LIMIT),
        future: [],
        lastRecord: tag ? { tag, at: now } : null,
      }))
    },

    async undo() {
      const { past, project, future } = get()
      if (past.length === 0) return
      const prev = past[past.length - 1]
      set({ past: past.slice(0, -1), future: [snap(project), ...future].slice(0, HISTORY_LIMIT), project: prev, lastRecord: null })
      get().fixSelection()
      await get().relayout()
    },

    async redo() {
      const { future, project, past } = get()
      if (future.length === 0) return
      const next = future[0]
      set({ future: future.slice(1), past: [...past, snap(project)].slice(-HISTORY_LIMIT), project: next, lastRecord: null })
      get().fixSelection()
      await get().relayout()
    },

    beginDrag() {
      get().record()
    },

    /* ------------------------------ layout ----------------------------- */

    async relayout() {
      const seq = ++layoutSeq
      if (relayoutTimer) {
        clearTimeout(relayoutTimer)
        relayoutTimer = null
      }
      set({ laying: true })
      try {
        const { project, rescan } = get()
        if (rescan) {
          // Previewing a re-scan: lay out the preview, leave the project alone.
          const laid = await layoutDiagram(rescan.preview, rescan.applied.layout)
          if (seq === layoutSeq) set({ laid })
          return
        }
        const laid = await layoutDiagram(project.diagram, project.layout)
        if (seq !== layoutSeq) return // a newer layout superseded this one
        const current = get().project
        // Sequence positions are fully derived (column/row order), so they keep no layout layer.
        const layout = current.diagram.type === 'sequence' ? {} : mergeOverrides(laid, current.layout)
        set({ laid, project: { ...current, layout } })
      } catch (e) {
        if (seq === layoutSeq) set({ status: `Layout failed: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        if (seq === layoutSeq) set({ laying: false })
      }
    },

    scheduleRelayout() {
      if (relayoutTimer) clearTimeout(relayoutTimer)
      relayoutTimer = setTimeout(() => {
        relayoutTimer = null
        void get().relayout()
      }, RELAYOUT_DEBOUNCE_MS)
    },

    async reflow() {
      await get().relayout()
      set({ status: 'Re-flowed layout (pins kept)' })
    },

    async resetLayout() {
      const { project } = get()
      const hadPins = Object.values(project.layout).some((p) => p.pinned)
      await commit({ ...project, layout: {} })
      set((s) => ({ fitRequest: s.fitRequest + 1, status: hadPins ? 'Layout reset, all pins cleared' : 'Layout reset' }))
    },

    pinNode(id, x, y) {
      const { project, laid } = get()
      set({
        project: { ...project, layout: { ...project.layout, [id]: { x, y, pinned: true } } },
        laid: laid ? { ...laid, positions: { ...laid.positions, [id]: { x, y } } } : laid,
      })
    },

    async unpinNode(id) {
      const { project } = get()
      const p = project.layout[id]
      if (!p?.pinned) return
      await commit({ ...project, layout: { ...project.layout, [id]: { ...p, pinned: false } } })
    },

    /* --------------------------- diagram edits ------------------------- */

    setTitle(title) {
      const { project } = get()
      get().record('title')
      set({ project: { ...project, diagram: { ...project.diagram, title } } })
    },

    setSubtitle(subtitle) {
      const { project } = get()
      get().record('subtitle')
      const diagram = { ...project.diagram }
      if (subtitle) diagram.subtitle = subtitle
      else delete diagram.subtitle
      set({ project: { ...project, diagram } })
    },

    async setType(t) {
      const { project } = get()
      await commit({ ...project, diagram: { ...project.diagram, type: t, direction: defaultDirection(t) }, layout: {} })
      set((s) => ({ fitRequest: s.fitRequest + 1 }))
    },

    async setDirection(dir) {
      const { project } = get()
      await commit({ ...project, diagram: { ...project.diagram, direction: dir }, layout: {} })
      set((s) => ({ fitRequest: s.fitRequest + 1 }))
    },

    async addNode(partial) {
      const { project } = get()
      const id = partial?.id ?? freshId('node', project.diagram.nodes.map((n) => n.id))
      const node: IRNode = { label: 'New node', role: 'backend', ...partial, id }
      await commit({ ...project, diagram: { ...project.diagram, nodes: [...project.diagram.nodes, node] } })
      set({ selection: { kind: 'node', id } })
      get().requestFocus(id)
      return id
    },

    updateNode(id, patch) {
      const { project, laid } = get()
      const before = project.diagram.nodes.find((n) => n.id === id)
      if (!before) return
      get().record(`node:${id}:${Object.keys(patch).sort().join(',')}`)
      let after: IRNode = { ...before, ...patch }
      for (const k of Object.keys(patch) as (keyof IRNode)[]) if (patch[k] === undefined) delete after[k]
      // Remember which scanned fields the user changed, so a re-scan keeps them.
      after = markEdited(after, Object.keys(patch))
      const nodes = project.diagram.nodes.map((n) => (n.id === id ? after : n))
      set({ project: { ...project, diagram: { ...project.diagram, nodes } } })

      // Text changes the node's size: resize now (no movement), re-layout once typing stops.
      if ('label' in patch || 'sublabel' in patch) {
        if (laid) set({ laid: { ...laid, sizes: { ...laid.sizes, [id]: measureNode(after) } } })
        get().scheduleRelayout()
      }
    },

    async deleteNode(id) {
      const { project, selection } = get()
      const diagram = project.diagram
      if (!diagram.nodes.some((n) => n.id === id)) return
      const layout: LayoutOverrides = { ...project.layout }
      delete layout[id]
      await commit({
        ...project,
        diagram: {
          ...diagram,
          nodes: diagram.nodes.filter((n) => n.id !== id).map((n) => (n.parent === id ? { ...n, parent: undefined } : n)),
          edges: diagram.edges.filter((e) => e.source !== id && e.target !== id),
        },
        layout,
      })
      if (selection?.id === id) set({ selection: null })
      set({ status: 'Node deleted (Ctrl+Z to undo)' })
    },

    async addEdge(source, target) {
      const { project } = get()
      if (source === target) return
      if (project.diagram.edges.some((e) => e.source === source && e.target === target)) return
      const id = freshId('edge', project.diagram.edges.map((e) => e.id))
      await commit({ ...project, diagram: { ...project.diagram, edges: [...project.diagram.edges, { id, source, target }] } })
      set({ selection: { kind: 'edge', id } })
    },

    updateEdge(id, patch) {
      const { project } = get()
      const before = project.diagram.edges.find((e) => e.id === id)
      if (!before) return
      get().record(`edge:${id}:${Object.keys(patch).sort().join(',')}`)
      const after: IREdge = { ...before, ...patch }
      for (const k of Object.keys(patch) as (keyof IREdge)[]) if (patch[k] === undefined) delete after[k]
      set({ project: { ...project, diagram: { ...project.diagram, edges: project.diagram.edges.map((e) => (e.id === id ? after : e)) } } })
    },

    async reverseEdge(id) {
      const { project } = get()
      const e = project.diagram.edges.find((x) => x.id === id)
      if (!e) return
      if (project.diagram.edges.some((x) => x.source === e.target && x.target === e.source)) {
        set({ status: 'An edge already exists in the other direction' })
        return
      }
      await commit({
        ...project,
        diagram: { ...project.diagram, edges: project.diagram.edges.map((x) => (x.id === id ? { ...x, source: e.target, target: e.source } : x)) },
      })
    },

    async deleteEdge(id) {
      const { project, selection } = get()
      if (!project.diagram.edges.some((e) => e.id === id)) return
      await commit({ ...project, diagram: { ...project.diagram, edges: project.diagram.edges.filter((e) => e.id !== id) } })
      if (selection?.id === id) set({ selection: null })
      set({ status: 'Edge deleted (Ctrl+Z to undo)' })
    },

    dragParticipant(id, x) {
      const { laid } = get()
      const p = laid?.positions[id]
      if (!laid || !p) return
      set({ laid: { ...laid, positions: { ...laid.positions, [id]: { x, y: p.y } } } })
    },

    async dropParticipant() {
      const { project, laid } = get()
      if (!laid) return
      const nodes = [...project.diagram.nodes]
      const order = nodes.map((n, i) => ({ n, i, x: laid.positions[n.id]?.x ?? Infinity }))
      order.sort((a, b) => a.x - b.x || a.i - b.i)
      const changed = order.some((o, i) => o.i !== i)
      if (!changed) return get().relayout() // snap back into its column
      await commit({ ...project, diagram: { ...project.diagram, nodes: order.map((o) => o.n) } })
      set({ status: 'Participants reordered' })
    },

    async moveMessage(id, delta) {
      const { project } = get()
      const edges = [...project.diagram.edges]
      const i = edges.findIndex((e) => e.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= edges.length) return
      ;[edges[i], edges[j]] = [edges[j], edges[i]]
      await commit({ ...project, diagram: { ...project.diagram, edges } })
    },

    async deleteSelection() {
      const sel = get().selection
      if (!sel) return
      if (sel.kind === 'node') await get().deleteNode(sel.id)
      else await get().deleteEdge(sel.id)
    },

    /* -------------------------------- ui -------------------------------- */

    select(sel) {
      set({ selection: sel, editingNodeId: sel?.kind === 'node' && sel.id === get().editingNodeId ? sel.id : null })
    },

    startEditing(id) {
      set({ editingNodeId: id, selection: { kind: 'node', id } })
    },

    stopEditing() {
      set({ editingNodeId: null })
    },

    requestFocus(id) {
      const n = (get().focusRequest?.n ?? 0) + 1
      set({ focusRequest: { id, n }, selection: { kind: 'node', id } })
    },

    setSearchOpen(open) {
      set({ searchOpen: open })
    },

    async beginRescan(scanned) {
      const { project } = get()
      const diff = diffDiagrams(project.diagram, scanned)
      if (diffIsEmpty(diff)) {
        set({ status: 'Re-scan: the map is up to date, no changes since the last scan' })
        return false
      }
      const applied = applyRescan(project, scanned)
      const status = new Map<string, DiffStatus>()
      for (const n of diff.addedNodes) status.set(n.id, 'added')
      for (const c of diff.changedNodes) status.set(c.after.id, 'changed')
      for (const n of diff.removedNodes) status.set(n.id, 'removed')
      for (const e of diff.addedEdges) status.set(e.id, 'added')
      for (const c of diff.changedEdges) status.set(c.after.id, 'changed')
      for (const e of diff.removedEdges) status.set(e.id, 'removed')
      // Ghosts: removed nodes, and removed edges whose ends are still drawn.
      const nodes = [...applied.diagram.nodes, ...diff.removedNodes]
      const ids = new Set(nodes.map((n) => n.id))
      const edges = [...applied.diagram.edges, ...diff.removedEdges.filter((e) => ids.has(e.source) && ids.has(e.target))]
      set({
        rescan: { diff, applied, preview: { ...applied.diagram, nodes, edges }, status },
        selection: null,
        editingNodeId: null,
        status: `Re-scan found ${diffSummary(diff)}. Review, then apply or discard.`,
      })
      await get().relayout()
      set((s) => ({ fitRequest: s.fitRequest + 1 }))
      return true
    },

    async applyRescanPreview() {
      const { rescan } = get()
      if (!rescan) return
      const summary = diffSummary(rescan.diff)
      set({ rescan: null })
      await commit(rescan.applied)
      set({ status: `Re-scan applied: ${summary} (Ctrl+Z to undo)` })
    },

    async discardRescan() {
      if (!get().rescan) return
      set({ rescan: null, status: 'Re-scan discarded' })
      await get().relayout()
    },

    toggleLegend() {
      set((s) => ({ legendOpen: !s.legendOpen }))
    },

    toggleTheme() {
      set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
    },

    setStatus(s) {
      set({ status: s })
    },

    fixSelection() {
      const { selection, project } = get()
      if (!selection) return
      const exists =
        selection.kind === 'node'
          ? project.diagram.nodes.some((n) => n.id === selection.id)
          : project.diagram.edges.some((e) => e.id === selection.id)
      if (!exists) set({ selection: null, editingNodeId: null })
    },
  }
})
