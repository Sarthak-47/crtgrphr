/**
 * IR + layout → a draw.io (diagrams.net) file. Uncompressed mxGraph XML, so the
 * file is readable and diffs in git. Positions, sizes, group frames and edge
 * bends come from the same layout and router as the canvas, so the drawing opens
 * looking like the map; from there it is an ordinary, fully editable draw.io page.
 * Also imports into Confluence and Lucidchart (both read draw.io XML).
 */
import type { IRDiagram } from '@shared/ir'
import { LIGHT, type RoleStyle } from '@shared/roles'
import type { LaidOut } from '../layout/elk'
import { diagramRoutes, nodeBoxes } from '../render/boxes'
import { groupBoxes } from '../render/groups'

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;')
const r = (n: number): number => Math.round(n * 10) / 10
/** draw.io ids must not clash with its reserved "0" and "1" cells. */
const cid = (prefix: string, id: string): string => `${prefix}-${id.replace(/[^A-Za-z0-9_.:-]/g, '_')}`

function shapeStyle(style: RoleStyle): string {
  const common = `whiteSpace=wrap;html=1;fillColor=${style.fill};strokeColor=${style.accent};strokeWidth=1.6;fontColor=#0f172a;`
  switch (style.shape) {
    case 'cylinder':
      return `shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=8;${common}`
    case 'diamond':
      return `rhombus;${common}`
    case 'pill':
    case 'stadium':
      return `rounded=1;arcSize=50;${common}`
    case 'box':
      return `rounded=0;${common}`
    default:
      return `rounded=1;arcSize=12;${common}`
  }
}

export function diagramToDrawio(diagram: IRDiagram, laid: LaidOut): string {
  const boxes = nodeBoxes(diagram, laid)
  const routes = diagramRoutes(diagram, laid, boxes, 'light')
  const groups = groupBoxes(diagram, boxes)
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']

  // Frames first so they sit behind their members.
  for (const g of groups) {
    cells.push(
      `<mxCell id="${xml(cid('g', g.id))}" value="${xml(g.label)}" style="rounded=1;arcSize=4;dashed=1;fillColor=none;strokeColor=#94a3b8;verticalAlign=top;align=left;spacingLeft=10;spacingTop=6;fontStyle=1;fontColor=#475569;html=1;" vertex="1" parent="1">` +
        `<mxGeometry x="${r(g.x)}" y="${r(g.y)}" width="${r(g.width)}" height="${r(g.height)}" as="geometry"/></mxCell>`,
    )
  }
  for (const n of diagram.nodes) {
    const b = boxes.get(n.id)
    if (!b) continue
    const style = LIGHT[n.role]
    const label = n.sublabel ? `<b>${xml(n.label)}</b><br><font style="font-size:10px" color="#64748b">${xml(n.sublabel)}</font>` : `<b>${xml(n.label)}</b>`
    cells.push(
      `<mxCell id="${xml(cid('n', n.id))}" value="${xml(label)}" style="${shapeStyle(style)}" vertex="1" parent="1">` +
        `<mxGeometry x="${r(b.x)}" y="${r(b.y)}" width="${r(b.width)}" height="${r(b.height)}" as="geometry"/></mxCell>`,
    )
  }
  for (const e of diagram.edges) {
    if (!boxes.has(e.source) || !boxes.has(e.target)) continue
    const route = routes.get(e.id)
    const stroke = e.variant === 'weak' ? '#cbd5e1' : LIGHT[diagram.nodes.find((n) => n.id === e.source)?.role ?? 'backend'].accent
    const dash = e.variant === 'dashed' || e.variant === 'weak' ? 'dashed=1;' : ''
    const width = e.variant === 'emphasis' ? 2.6 : 1.6
    const pts = route ? route.points.slice(1, -1) : []
    const geometry = pts.length
      ? `<mxGeometry relative="1" as="geometry"><Array as="points">${pts.map((p) => `<mxPoint x="${r(p.x)}" y="${r(p.y)}"/>`).join('')}</Array></mxGeometry>`
      : '<mxGeometry relative="1" as="geometry"/>'
    cells.push(
      `<mxCell id="${xml(cid('e', e.id))}" value="${xml(e.label ?? '')}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeColor=${stroke};strokeWidth=${width};${dash}fontSize=10;fontColor=#475569;labelBackgroundColor=#ffffff;" edge="1" parent="1" source="${xml(cid('n', e.source))}" target="${xml(cid('n', e.target))}">` +
        geometry +
        '</mxCell>',
    )
  }
  const id = xml(diagram.id || 'map')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="Cartographer" type="device">',
    `  <diagram id="${id}" name="${xml(diagram.title)}">`,
    '    <mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">',
    '      <root>',
    ...cells.map((c) => `        ${c}`),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
    '',
  ].join('\n')
}
