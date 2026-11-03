import type { Edge, Node } from '@xyflow/react'
import { MarkerType, Position } from '@xyflow/react'
import type { IRDiagram, IREdge, NodeRole } from '@shared/ir'
import type { LaidOut } from '../layout/elk'
import { palette } from '@shared/roles'
import type { DiffStatus, Selection } from '../state/store'
import { handleSides, type Side } from './sides'
import { computeRoutes, pointsToPath, type Box, type Route } from '../render/geometry'
import type { RouteEdgeData } from './RouteEdge'
import { sequenceMessageRoutes } from '../render/sequence'

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
}

const DIFF_COLOR: Record<DiffStatus, string> = { added: '#22c55e', changed: '#f59e0b', removed: '#ef4444' }

const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

/** Boxes for every drawable node, from the current layout. */
export function nodeBoxes(diagram: IRDiagram, laid: LaidOut): Map<string, Box> {
  const boxes = new Map<string, Box>()
  for (const n of diagram.nodes) {
    if (n.role === 'group') continue
    const p = laid.positions[n.id]
    const s = laid.sizes[n.id]
    if (p && s) boxes.set(n.id, { x: p.x, y: p.y, width: s.width, height: s.height })
  }
  return boxes
}

/** All edge routes for a diagram: shared router for graphs, rows for sequences. */
export function diagramRoutes(diagram: IRDiagram, laid: LaidOut, boxes: Map<string, Box>, theme: 'light' | 'dark'): Map<string, Route> {
  if (diagram.type === 'sequence' && laid.sequence) return sequenceMessageRoutes(diagram, laid.sequence)
  const pal = palette(theme)
  const roleOf = new Map(diagram.nodes.map((n) => [n.id, n.role]))
  return computeRoutes(diagram, boxes, (id) => pal[roleOf.get(id) ?? 'backend'].shape, laid.routes)
}

export function edgeColor(e: IREdge, roleOf: Map<string, NodeRole>, theme: 'light' | 'dark'): string {
  if (e.variant === 'weak') return theme === 'dark' ? '#475569' : '#cbd5e1'
  return palette(theme)[roleOf.get(e.source) ?? 'backend'].accent
}

export function toReactFlow(
  diagram: IRDiagram,
  laid: LaidOut,
  theme: 'light' | 'dark',
  pinnedIds: Set<string>,
  highlightEdges: Set<string> | null,
  selection: Selection | null,
  diffStatus: Map<string, DiffStatus> | null = null,
): { nodes: Node[]; edges: Edge[] } {
  const pal = palette(theme)
  const isSequence = diagram.type === 'sequence' && !!laid.sequence
  const sides = isSequence ? { source: 'bottom' as Side, target: 'bottom' as Side } : handleSides(diagram.direction)
  const boxes = nodeBoxes(diagram, laid)

  const nodes: Node[] = []
  for (const n of diagram.nodes) {
    const b = boxes.get(n.id)
    if (!b) continue
    const shape = pal[n.role].shape
    nodes.push({
      id: n.id,
      type: 'role',
      position: { x: b.x, y: b.y },
      selected: selection?.kind === 'node' && selection.id === n.id,
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
      data: { d: pointsToPath(r.points), labelText: e.label, labelX: r.label.x, labelY: r.label.y } satisfies RouteEdgeData,
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
