import type { Edge, Node } from '@xyflow/react'
import { MarkerType, Position } from '@xyflow/react'
import type { IRDiagram, NodeRole } from '@shared/ir'
import type { LaidOut } from '../layout/elk'
import { palette } from '@shared/roles'
import type { DiffStatus, Selection } from '../state/store'
import { handleSides, type Side } from './sides'
import { pointsToPath } from '../render/geometry'
import { diagramRoutes, edgeColor, nodeBoxes } from '../render/boxes'

export { diagramRoutes, edgeColor, nodeBoxes }
import type { RouteEdgeData } from './RouteEdge'
import { groupBoxes } from '../render/groups'
import { HIDDEN_COUNT } from '@shared/collapse'
import { nodeFacts } from '@shared/facts'

export interface BoundaryNodeData extends Record<string, unknown> {
  label: string
  w: number
  h: number
  selected: boolean
}

export interface RoleNodeData extends Record<string, unknown> {
  label: string
  sublabel?: string
  role: NodeRole
  brand?: string
  pinned: boolean
  sourceSide: Side
  targetSide: Side
  w: number
  h: number
  showRoleTag: boolean
  diff?: DiffStatus
  /** a collapsed group standing in for this many hidden parts */
  stacked?: number
  /** facts the scan found: replicas, persistent storage, health checks... */
  facts?: string[]
}

const DIFF_COLOR: Record<DiffStatus, string> = { added: '#22c55e', changed: '#f59e0b', removed: '#ef4444' }

const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

export function toReactFlow(
  diagram: IRDiagram,
  laid: LaidOut,
  theme: 'light' | 'dark',
  pinnedIds: Set<string>,
  highlightEdges: Set<string> | null,
  selection: Selection | null,
  diffStatus: Map<string, DiffStatus> | null = null,
  multi: string[] = [],
): { nodes: Node[]; edges: Edge[] } {
  const pal = palette(theme)
  const selectedIds = new Set(multi.length ? multi : selection?.kind === 'node' ? [selection.id] : [])
  const isSequence = diagram.type === 'sequence' && !!laid.sequence
  const sides = isSequence ? { source: 'bottom' as Side, target: 'bottom' as Side } : handleSides(diagram.direction)
  const boxes = nodeBoxes(diagram, laid)

  const nodes: Node[] = []
  // Group boundaries first, behind everything; only their label takes clicks.
  for (const g of groupBoxes(diagram, boxes)) {
    nodes.push({
      id: g.id,
      type: 'boundary',
      position: { x: g.x, y: g.y },
      data: { label: g.label, w: g.width, h: g.height, selected: selectedIds.has(g.id) } satisfies BoundaryNodeData,
      width: g.width,
      height: g.height,
      draggable: false,
      connectable: false,
      focusable: false,
      zIndex: -2,
      className: 'cg-boundary-node',
    })
  }
  for (const n of diagram.nodes) {
    const b = boxes.get(n.id)
    if (!b) continue
    const shape = pal[n.role].shape
    nodes.push({
      id: n.id,
      type: 'role',
      position: { x: b.x, y: b.y },
      selected: selectedIds.has(n.id),
      data: {
        label: n.label,
        sublabel: n.sublabel,
        role: n.role,
        brand: n.brand,
        pinned: pinnedIds.has(n.id),
        sourceSide: sides.source,
        targetSide: sides.target,
        w: b.width,
        h: b.height,
        showRoleTag: !isSequence && shape !== 'diamond',
        diff: diffStatus?.get(n.id),
        ...(n.meta?.[HIDDEN_COUNT] ? { stacked: Number(n.meta[HIDDEN_COUNT]) } : {}),
        ...(nodeFacts(n).length ? { facts: nodeFacts(n) } : {}),
      } satisfies RoleNodeData,
      width: b.width,
      height: b.height,
      sourcePosition: POS[sides.source],
      targetPosition: POS[sides.target],
    })
  }

  if (isSequence) {
    for (const l of laid.sequence!.lifelines) {
      const role = diagram.nodes.find((n) => n.id === l.id)?.role ?? 'backend'
      nodes.push({
        id: `__lifeline:${l.id}`,
        type: 'lifeline',
        position: { x: l.x - 1, y: l.top },
        data: { h: l.bottom - l.top, color: pal[role].accent },
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
        className: 'cg-lifeline-node',
        zIndex: -1,
      })
    }
  }

  const routes = diagramRoutes(diagram, laid, boxes, theme)
  const roleOf = new Map(diagram.nodes.map((n) => [n.id, n.role]))
  const edges: Edge[] = []
  for (const e of diagram.edges) {
    const r = routes.get(e.id)
    if (!r) continue
    const selected = selection?.kind === 'edge' && selection.id === e.id
    const dim = !selected && highlightEdges ? !highlightEdges.has(e.id) : false
    const diff = diffStatus?.get(e.id)
    const color = diff ? DIFF_COLOR[diff] : edgeColor(e, roleOf, theme)
    const base = diff ? 2.4 : e.variant === 'emphasis' ? 2.4 : e.variant === 'weak' ? 1.2 : 1.6
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'route',
      selected,
      interactionWidth: 18,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      data: {
        d: pointsToPath(r.points),
        labelText: e.label,
        labelX: r.label.x,
        labelY: r.label.y,
        ...(e.confidence === 'inferred' ? { inferred: true } : {}),
        ...(e.evidence ? { evidence: e.evidence } : {}),
      } satisfies RouteEdgeData,
      style: {
        stroke: color,
        strokeWidth: selected ? base + 1.6 : base,
        strokeDasharray: diff === 'removed' || e.variant === 'dashed' ? '6 5' : undefined,
        opacity: dim ? 0.12 : diff === 'removed' ? 0.7 : 1,
      },
    })
  }

  return { nodes, edges }
}
