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
import { RoleNode } from './RoleNode'
import { toReactFlow } from './toReactFlow'
import { reachEdges } from '../graph/reach'

const nodeTypes = { role: RoleNode }

export function Canvas() {
  const project = useStore((s) => s.project)
  const laid = useStore((s) => s.laid)
  const theme = useStore((s) => s.theme)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const addEdge = useStore((s) => s.addEdge)
  const pinNode = useStore((s) => s.pinNode)

  const diagram = project.diagram

  const pinnedIds = useMemo(
    () => new Set(Object.entries(project.layout).filter(([, p]) => p.pinned).map(([id]) => id)),
    [project.layout],
  )

  const highlighted = useMemo(
    () => (selection ? reachEdges(diagram, selection, 'downstream') : null),
    [diagram, selection],
  )

  const { nodes, edges } = useMemo(
    () => (laid ? toReactFlow(diagram, laid, theme, pinnedIds, highlighted) : { nodes: [], edges: [] }),
    [diagram, laid, theme, pinnedIds, highlighted],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) void addEdge(c.source, c.target)
    },
    [addEdge],
  )

  // Dragging a node pins it (ADR-0004). We update on each position change while
  // dragging so the move is smooth; the pin persists into the layout layer.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'position' && (ch as NodePositionChange).position) {
          const pc = ch as NodePositionChange
          pinNode(pc.id, pc.position!.x, pc.position!.y)
        }
      }
    },
    [pinNode],
  )

  return (
    <div className="cg-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2.5}
        colorMode={theme}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={2} />
      </ReactFlow>
      <FitOnChange />
    </div>
  )
}

/** Re-fit the view when the node set changes materially (not on every drag). */
function FitOnChange() {
  const nodeCount = useStore((s) => s.project.diagram.nodes.length)
  const title = useStore((s) => s.project.diagram.title)
  const rf = useReactFlow()
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 80)
    return () => clearTimeout(t)
  }, [nodeCount, title, rf])
  return null
}
