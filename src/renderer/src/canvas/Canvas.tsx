import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Connection,
  type NodeChange,
  type NodePositionChange,
  type NodeSelectionChange,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../state/store'
import { BoundaryNode, LifelineNode, RoleNode } from './RoleNode'
import { RouteEdge } from './RouteEdge'
import { Legend } from './Legend'
import { toReactFlow } from './toReactFlow'
import { ARIA_LABELS } from './a11y'
import { reachEdges } from '../graph/reach'
import { shortestPath } from '../graph/path'
import { HIDDEN_COUNT, visibleDiagram } from '@shared/collapse'

const nodeTypes = { role: RoleNode, lifeline: LifelineNode, boundary: BoundaryNode }
const edgeTypes = { route: RouteEdge }
const isLifeline = (id: string): boolean => id.startsWith('__lifeline:')
/** Fit-to-view margins: room at the top for the legend card, so it never covers a part. */
const FIT_PADDING = { top: '132px', right: '56px', bottom: '64px', left: '56px' } as const

export function Canvas() {
  const project = useStore((s) => s.project)
  const laid = useStore((s) => s.laid)
  const theme = useStore((s) => s.theme)
  const selection = useStore((s) => s.selection)
  const multi = useStore((s) => s.multi)
  const select = useStore((s) => s.select)
  const toggleNode = useStore((s) => s.toggleNode)
  const selectNodes = useStore((s) => s.selectNodes)
  const boxing = useRef(false)
  const addEdge = useStore((s) => s.addEdge)
  const pinNode = useStore((s) => s.pinNode)
  const beginDrag = useStore((s) => s.beginDrag)
  const dragParticipant = useStore((s) => s.dragParticipant)
  const dropParticipant = useStore((s) => s.dropParticipant)
  const startEditing = useStore((s) => s.startEditing)

  const rescan = useStore((s) => s.rescan)
  const applyRescanPreview = useStore((s) => s.applyRescanPreview)
  const discardRescan = useStore((s) => s.discardRescan)
  // While a re-scan is previewed the canvas shows the preview, read-only.
  const source = rescan?.preview ?? project.diagram
  // Collapsed groups are drawn as one box (drill-down); the IR keeps every member.
  const diagram = useMemo(() => visibleDiagram(source), [source])
  const standIns = useMemo(() => new Set(diagram.nodes.filter((n) => n.meta?.[HIDDEN_COUNT]).map((n) => n.id)), [diagram])
  const setCollapsed = useStore((s) => s.setCollapsed)
  const readOnly = !!rescan
  const isSequence = diagram.type === 'sequence'

  const groupIds = useMemo(() => new Set(diagram.nodes.filter((n) => n.role === 'group').map((n) => n.id)), [diagram])

  const pinnedIds = useMemo(
    () => new Set(Object.entries(project.layout).filter(([, p]) => p.pinned).map(([id]) => id)),
    [project.layout],
  )

  // One node selected: light up everything it reaches downstream.
  // Exactly two selected: light up the shortest path between them (path probe).
  const highlighted = useMemo(() => {
    if (multi.length === 2) {
      const p = shortestPath(diagram, multi[0], multi[1])
      return p ? new Set(p.edges) : null
    }
    if (multi.length > 2) return null
    if (selection?.kind !== 'node') return null
    if (diagram.nodes.find((n) => n.id === selection.id)?.role === 'group') return null
    return reachEdges(diagram, selection.id, 'downstream')
  }, [diagram, selection, multi])

  const { nodes, edges } = useMemo(
    () => (laid ? toReactFlow(diagram, laid, theme, pinnedIds, highlighted, selection, rescan?.status ?? null, multi) : { nodes: [], edges: [] }),
    [diagram, laid, theme, pinnedIds, highlighted, selection, rescan, multi],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (readOnly || !c.source || !c.target) return
      if (standIns.has(c.source) || standIns.has(c.target)) {
        useStore.getState().setStatus('Expand the group first to connect one of its parts')
        return
      }
      void addEdge(c.source, c.target)
    },
    [addEdge, readOnly, standIns],
  )

  // Graph diagrams: dragging pins a node (ADR-0004); a drag is one undo step.
  // Sequence diagrams: participants only move sideways and reorder on drop.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) return
      // Shift+drag on the canvas draws a selection box; React Flow reports what it covers.
      if (boxing.current) {
        const ids = new Set(useStore.getState().multi.length ? useStore.getState().multi : [])
        let touched = false
        for (const ch of changes) {
          if (ch.type !== 'select' || isLifeline(ch.id)) continue
          const sc = ch as NodeSelectionChange
          if (groupIds.has(sc.id)) continue
          touched = true
          if (sc.selected) ids.add(sc.id)
          else ids.delete(sc.id)
        }
        if (touched) selectNodes([...ids])
      }
      for (const ch of changes) {
        if (ch.type !== 'position' || !(ch as NodePositionChange).position || isLifeline(ch.id)) continue
        const pc = ch as NodePositionChange
        if (isSequence) dragParticipant(pc.id, pc.position!.x)
        else pinNode(pc.id, pc.position!.x, pc.position!.y)
      }
    },
    [isSequence, pinNode, dragParticipant, readOnly, selectNodes, groupIds],
  )

  const lastKeyMove = useRef(0)

  /** The node or link id behind a DOM element React Flow rendered, if any. */
  const elementId = (el: EventTarget | null): { kind: 'node' | 'edge'; id: string } | null => {
    if (!(el instanceof Element)) return null
    const hit = el.closest('[data-testid^="rf__node-"], [data-testid^="rf__edge-"]')
    const t = hit?.getAttribute('data-testid')
    if (!t) return null
    return t.startsWith('rf__node-') ? { kind: 'node', id: t.slice(9) } : { kind: 'edge', id: t.slice(9) }
  }

  /**
   * Keep keyboard focus on a part while the canvas re-renders it (collapse, expand):
   * the layout finishes later, and the part's element can be replaced more than once.
   */
  const keepFocus = useRef<{ id: string; until: number } | null>(null)
  const refocus = (id: string): void => {
    keepFocus.current = { id, until: performance.now() + 3000 }
    restoreFocus()
  }
  const restoreFocus = (): void => {
    const k = keepFocus.current
    if (!k) return
    if (performance.now() > k.until) {
      keepFocus.current = null
      return
    }
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="rf__node-${CSS.escape(k.id)}"]`) as HTMLElement | null
      if (el && document.activeElement !== el && (document.activeElement === document.body || el.closest('.cg-canvas')?.contains(document.activeElement) || !document.activeElement)) el.focus()
    })
  }
  useEffect(() => {
    restoreFocus()
  })

  return (
    <div
      className="cg-canvas"
      data-testid="canvas"
      data-type={diagram.type}
      role="region"
      aria-label="Map canvas. Tab moves between parts and links."
      // Keyboard focus selects, so the inspector follows (mouse focus is left to clicks,
      // which keeps shift-click multi-selection intact).
      onFocusCapture={(ev) => {
        const target = ev.target as Element
        // Focus moved somewhere else on purpose: stop holding it on a re-rendered part.
        if (keepFocus.current && elementId(target)?.id !== keepFocus.current.id) keepFocus.current = null
        if (!target.matches?.(':focus-visible')) return
        const hit = elementId(target)
        if (!hit || (hit.kind === 'node' && isLifeline(hit.id))) return
        const cur = useStore.getState().selection
        if (cur?.kind !== hit.kind || cur.id !== hit.id) select(hit)
      }}
      // Enter does what a double-click does: rename a part, fold or open a group.
      // Any other key or a click ends holding focus on a re-rendered part.
      onPointerDownCapture={() => {
        keepFocus.current = null
      }}
      onKeyDownCapture={(ev) => {
        if (ev.key !== 'Enter') keepFocus.current = null
        // Arrow keys move the focused part (React Flow). Record one undo step per
        // burst of presses, as a drag does, so Ctrl+Z puts it back.
        if (ev.key.startsWith('Arrow') && !readOnly && !isSequence && elementId(ev.target)?.kind === 'node') {
          const now = Date.now()
          if (now - lastKeyMove.current > 800) beginDrag()
          lastKeyMove.current = now
          return
        }
        if (ev.key !== 'Enter' || readOnly) return
        const hit = elementId(ev.target)
        if (!hit || hit.kind !== 'node' || isLifeline(hit.id) || (ev.target as Element).closest('input, textarea')) return
        ev.preventDefault()
        ev.stopPropagation()
        if (standIns.has(hit.id)) void setCollapsed(hit.id, false).then(() => refocus(hit.id))
        else if (groupIds.has(hit.id)) void setCollapsed(hit.id, true).then(() => refocus(hit.id))
        else startEditing(hit.id)
      }}
    >
      <ReactFlow
        ariaLabelConfig={ARIA_LABELS}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStart={() => {
          if (!isSequence) beginDrag()
        }}
        onNodeDragStop={() => {
          if (isSequence) void dropParticipant()
        }}
        onNodeClick={(ev, n) => {
          if (isLifeline(n.id)) return
          if (ev.shiftKey && !readOnly && !groupIds.has(n.id)) toggleNode(n.id)
          else select({ kind: 'node', id: n.id })
        }}
        onNodeDoubleClick={(_, n) => {
          if (readOnly || isLifeline(n.id)) return
          // Double-click drills into a collapsed group, or folds an open one.
          if (standIns.has(n.id)) void setCollapsed(n.id, false)
          else if (groupIds.has(n.id)) void setCollapsed(n.id, true)
          else startEditing(n.id)
        }}
        onSelectionStart={() => {
          boxing.current = true
          if (!readOnly) selectNodes([])
        }}
        onSelectionEnd={() => {
          boxing.current = false
        }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onEdgeClick={(_, e) => select({ kind: 'edge', id: e.id })}
        onPaneClick={() => select(null)}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode="Shift"
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: FIT_PADDING }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
        maxZoom={2.5}
        colorMode={theme}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={2} />
      </ReactFlow>
      <ViewportSync />
      <Legend />
      {rescan && (
        <div className="cg-rescan-banner" role="status" data-testid="rescan-banner">
          <span>
            <strong>Re-scan</strong>: <span className="cg-diff-text-added">{rescan.diff.addedNodes.length + rescan.diff.addedEdges.length} added</span>,{' '}
            <span className="cg-diff-text-removed">{rescan.diff.removedNodes.length + rescan.diff.removedEdges.length} removed</span>,{' '}
            <span className="cg-diff-text-changed">{rescan.diff.changedNodes.length + rescan.diff.changedEdges.length} changed</span>
          </span>
          <button className="cg-primary" onClick={() => void applyRescanPreview()}>Apply</button>
          <button className="cg-ghost" onClick={() => void discardRescan()}>Discard</button>
        </div>
      )}
      {diagram.nodes.length === 0 && <EmptyState />}
    </div>
  )
}

/** Fit the whole map on new documents / rebuilt layouts; center on focus requests. */
function ViewportSync() {
  const fitRequest = useStore((s) => s.fitRequest)
  const focusRequest = useStore((s) => s.focusRequest)
  const rf = useReactFlow()

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: FIT_PADDING, duration: 250 }), 60)
    return () => clearTimeout(t)
  }, [fitRequest, rf])

  useEffect(() => {
    if (!focusRequest) return
    const t = setTimeout(() => {
      const { laid } = useStore.getState()
      const p = laid?.positions[focusRequest.id]
      const s = laid?.sizes[focusRequest.id]
      if (!p || !s) return
      rf.setCenter(p.x + s.width / 2, p.y + s.height / 2, { zoom: Math.max(rf.getZoom(), 1), duration: 300 })
    }, 60)
    return () => clearTimeout(t)
  }, [focusRequest, rf])

  return null
}

function EmptyState() {
  return (
    <div className="cg-empty">
      <h2>An empty map</h2>
      <p>
        Press <kbd>N</kbd> or click <strong>+ Node</strong> to add one, <strong>Scan repo…</strong> to map a codebase,
        or <strong>Import</strong> to paste Mermaid or JSON.
      </p>
    </div>
  )
}
