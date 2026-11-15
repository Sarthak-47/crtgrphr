/**
 * Group (boundary) boxes. A group's box is never stored: it is the bounding box
 * of its members plus padding, so it follows members the user drags and can't
 * drift out of sync with them. Shared by the canvas and the SVG exporter.
 */
import type { IRDiagram } from '@shared/ir'
import type { Box } from './geometry'

export const GROUP_PAD = 18
export const GROUP_HEADER = 30

export interface GroupBox extends Box {
  id: string
  label: string
  members: string[]
}

export function groupBoxes(diagram: IRDiagram, boxes: Map<string, Box>): GroupBox[] {
  if (diagram.type === 'sequence') return []
  const out: GroupBox[] = []
  for (const g of diagram.nodes) {
    if (g.role !== 'group') continue
    const members = diagram.nodes.filter((n) => n.parent === g.id && boxes.has(n.id)).map((n) => n.id)
    if (members.length === 0) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of members) {
      const b = boxes.get(id)!
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width)
      maxY = Math.max(maxY, b.y + b.height)
    }
    out.push({
      id: g.id,
      label: g.label,
      members,
      x: minX - GROUP_PAD,
      y: minY - GROUP_HEADER,
      width: maxX - minX + GROUP_PAD * 2,
      height: maxY - minY + GROUP_HEADER + GROUP_PAD,
    })
  }
  return out
}
