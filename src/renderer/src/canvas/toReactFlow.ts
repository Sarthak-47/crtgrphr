import type { Edge, Node } from '@xyflow/react'
import { MarkerType, Position } from '@xyflow/react'
import type { IRDiagram, NodeRole } from '@shared/ir'
import type { LaidOut } from '../layout/elk'
import { palette } from '@shared/roles'
import type { Selection } from '../state/store'
import { handleSides, type Side } from './sides'

export interface RoleNodeData extends Record<string, unknown> {
  label: string
  sublabel?: string
  role: NodeRole
  brand?: string
  pinned: boolean
  sourceSide: Side
  targetSide: Side
}

const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

export function toReactFlow(
  diagram: IRDiagram,
  laid: LaidOut,
  theme: 'light' | 'dark',
  pinnedIds: Set<string>,
  highlightEdges: Set<string> | null,
  selection: Selection | null,
): { nodes: Node[]; edges: Edge[] } {
  const pal = palette(theme)
  const sides = handleSides(diagram.direction)

  const nodes: Node[] = diagram.nodes
    .filter((n) => n.role !== 'group' && laid.positions[n.id])
    .map((n) => {
      const size = laid.sizes[n.id] ?? { width: 140, height: 60 }
      return {
        id: n.id,
        type: 'role',
        position: laid.positions[n.id],
        selected: selection?.kind === 'node' && selection.id === n.id,
        data: {
          label: n.label,
          sublabel: n.sublabel,
          role: n.role,
          brand: n.brand,
          pinned: pinnedIds.has(n.id),
          sourceSide: sides.source,
          targetSide: sides.target,
        } satisfies RoleNodeData,
        width: size.width,
        height: size.height,
        sourcePosition: POS[sides.source],
        targetPosition: POS[sides.target],
      }
    })

  const roleOf = new Map(diagram.nodes.map((n) => [n.id, n.role]))
  const edges: Edge[] = diagram.edges.map((e) => {
    const selected = selection?.kind === 'edge' && selection.id === e.id
    const dim = !selected && highlightEdges ? !highlightEdges.has(e.id) : false
    const weak = e.variant === 'weak'
    const color = weak ? (theme === 'dark' ? '#475569' : '#cbd5e1') : pal[roleOf.get(e.source) ?? 'backend'].accent
    const base = e.variant === 'emphasis' ? 2.4 : weak ? 1.2 : 1.6
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      type: 'smoothstep',
      selected,
      animated: e.variant === 'emphasis' && !dim,
      interactionWidth: 18,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: {
        stroke: color,
        strokeWidth: selected ? base + 1.6 : base,
        strokeDasharray: e.variant === 'dashed' ? '6 5' : undefined,
        opacity: dim ? 0.12 : 1,
      },
      labelStyle: { fill: theme === 'dark' ? '#cbd5e1' : '#334155', fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: theme === 'dark' ? '#0b0f19' : '#ffffff', fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
    }
  })

  return { nodes, edges }
}
