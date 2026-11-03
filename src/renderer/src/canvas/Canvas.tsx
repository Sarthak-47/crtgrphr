import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Connection,
  type NodeChange,
  type NodePositionChange,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../state/store'
import { LifelineNode, RoleNode } from './RoleNode'
import { RouteEdge } from './RouteEdge'
import { Legend } from './Legend'
import { toReactFlow } from './toReactFlow'
import { reachEdges } from '../graph/reach'

const nodeTypes = { role: RoleNode, lifeline: LifelineNode }
const edgeTypes = { route: RouteEdge }
const isLifeline = (id: string): boolean => id.startsWith('__lifeline:')

export function Canvas() {
  const project = useStore((s) => s.project)
  const laid = useStore((s) => s.laid)
  const theme = useStore((s) => s.theme)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
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
  const diagram = rescan?.preview ?? project.diagram
  const readOnly = !!rescan
  const isSequence = diagram.type === 'sequence'

  const pinnedIds = useMemo(
    () => new Set(Object.entries(project.layout).filter(([, p]) => p.pinned).map(([id]) => id)),
    [project.layout],
  )

  // Selecting a node lights up everything it reaches downstream.
  const highlighted = useMemo(
    () => (selection?.kind === 'node' ? reachEdges(diagram, selection.id, 'downstream') : null),
    [diagram, selection],
  )

  const { nodes, edges } = useMemo(
    () => (laid ? toReactFlow(diagram, laid, theme, pinnedIds, highlighted, selection, rescan?.status ?? null) : { nodes: [], edges: [] }),
    [diagram, laid, theme, pinnedIds, highlighted, selection, rescan],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!readOnly && c.source && c.target) void addEdge(c.source, c.target)
    },
    [addEdge, readOnly],
  )

  // Graph diagrams: dragging pins a node (ADR-0004); a drag is one undo step.
  // Sequence diagrams: participants only move sideways and reorder on drop.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) return
      for (const ch of changes) {
        if (ch.type !== 'position' || !(ch as NodePositionChange).position || isLifeline(ch.id)) continue
        const pc = ch as NodePositionChange
        if (isSequence) dragParticipant(pc.id, pc.position!.x)
        else pinNode(pc.id, pc.position!.x, pc.position!.y)
      }
    },
    [isSequence, pinNode, dragParticipant, readOnly],
  )

  return (
    <div className="cg-canvas" data-testid="canvas" data-type={diagram.type}>
      <ReactFlow
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
        onNodeClick={(_, n) => {
          if (!isLifeline(n.id)) select({ kind: 'node', id: n.id })
        }}
        onNodeDoubleClick={(_, n) => {
          if (!readOnly && !isLifeline(n.id)) startEditing(n.id)
        }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onEdgeClick={(_, e) => select({ kind: 'edge', id: e.id })}
        onPaneClick={() => select(null)}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
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
    const t = setTimeout(() => rf.fitView({ padding: 0.2, duration: 250 }), 60)
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
