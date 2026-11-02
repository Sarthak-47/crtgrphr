import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type { IRDiagram, NodeRole } from '@shared/ir'
import type { LaidOut } from '../layout/elk'
import { palette } from '@shared/roles'

export interface RoleNodeData extends Record<string, unknown> {
  label: string
  sublabel?: string
  role: NodeRole
  brand?: string
  pinned: boolean
}

const horizontal = (dir?: IRDiagram['direction']): boolean => dir === 'RIGHT' || dir === 'LEFT'

export function toReactFlow(
  diagram: IRDiagram,
  laid: LaidOut,
  theme: 'light' | 'dark',
  pinnedIds: Set<string>,
  highlightEdges: Set<string> | null,
): { nodes: Node[]; edges: Edge[] } {
  const pal = palette(theme)
  const isH = horizontal(diagram.direction)

  const nodes: Node[] = diagram.nodes
    .filter((n) => n.role !== 'group')
    .map((n) => {
      const pos = laid.positions[n.id] ?? { x: 0, y: 0 }
      const size = laid.sizes[n.id] ?? { width: 140, height: 60 }
      return {
        id: n.id,
        type: 'role',
        position: pos,
        data: { label: n.label, sublabel: n.sublabel, role: n.role, brand: n.brand, pinned: pinnedIds.has(n.id) } as RoleNodeData,
        width: size.width,
        height: size.height,
        sourcePosition: (isH ? 'right' : 'bottom') as never,
        targetPosition: (isH ? 'left' : 'top') as never,
      }
    })

  const roleOf = new Map(diagram.nodes.map((n) => [n.id, n.role]))
  const edges: Edge[] = diagram.edges.map((e) => {
    const st = pal[roleOf.get(e.source) ?? 'backend']
    const dim = highlightEdges ? !highlightEdges.has(e.id) : false
    const emphasis = e.variant === 'emphasis'
    const dashed = e.variant === 'dashed'
    const weak = e.variant === 'weak'
    const color = weak ? (theme === 'dark' ? '#475569' : '#cbd5e1') : st.accent
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      type: 'smoothstep',
      animated: emphasis && !dim,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: {
        stroke: color,
        strokeWidth: emphasis ? 2.4 : weak ? 1.2 : 1.6,
        strokeDasharray: dashed ? '6 5' : undefined,
        opacity: dim ? 0.12 : 1,
      },
      labelStyle: { fill: theme === 'dark' ? '#cbd5e1' : '#334155', fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: theme === 'dark' ? '#0b0f19' : '#ffffff', fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
    }
  })

  return { nodes, edges }
}
