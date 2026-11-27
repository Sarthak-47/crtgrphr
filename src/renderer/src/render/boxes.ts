/**
 * Node boxes, edge routes and edge colours for a laid-out diagram. Shared by the
 * canvas and the SVG exporter; free of React Flow so the CLI can use it in Node.
 */
import type { IRDiagram, IREdge, NodeRole } from '@shared/ir'
import { palette } from '@shared/roles'
import type { LaidOut } from '../layout/elk'
import { computeRoutes, type Box, type Route } from './geometry'
import { sequenceMessageRoutes } from './sequence'
import { groupBoxes } from './groups'

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
  // A link may start or end at a whole group ("every service uses config-server"):
  // its frame, derived from its members, is that end's box.
  const withGroups = new Map(boxes)
  for (const g of groupBoxes(diagram, boxes)) withGroups.set(g.id, g)
  return computeRoutes(diagram, withGroups, (id) => (roleOf.get(id) === 'group' ? 'rounded' : pal[roleOf.get(id) ?? 'backend'].shape), laid.routes)
}

export function edgeColor(e: IREdge, roleOf: Map<string, NodeRole>, theme: 'light' | 'dark'): string {
  if (e.variant === 'weak') return theme === 'dark' ? '#475569' : '#cbd5e1'
  return palette(theme)[roleOf.get(e.source) ?? 'backend'].accent
}
