/**
 * Deterministic IR → SVG exporter, independent of React Flow, plus a PNG
 * rasterizer. Draws what the canvas shows: role shapes, orthogonal edges that
 * leave/enter on the same sides as the canvas, arrowheads that stop at node
 * borders, labels, and brand badges. Bounds come from the actual node positions,
 * so pinned nodes outside ELK's original area are never clipped.
 */
import type { IRDiagram, IRNode } from '@shared/ir'
import type { LaidOut } from '../layout/elk'
import { palette, type RoleStyle } from '@shared/roles'
import { anchor, handleSides, type Side } from '../canvas/sides'

const FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
const PAD = 40
const GAP = 22 // how far edges step out from a node before turning

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Rough text width for system-ui; good enough for label backgrounds and truncation. */
const textWidth = (s: string, size: number): number => s.length * size * 0.56

function truncate(s: string, maxWidth: number, size: number): string {
  if (textWidth(s, size) <= maxWidth) return s
  const max = Math.max(1, Math.floor(maxWidth / (size * 0.56)) - 1)
  return s.slice(0, max) + '…'
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function shapeSvg(style: RoleStyle, b: Box): string {
  const common = `fill="${style.fill}" stroke="${style.accent}" stroke-width="1.6"`
  switch (style.shape) {
    case 'diamond': {
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      return `<polygon points="${cx},${b.y} ${b.x + b.width},${cy} ${cx},${b.y + b.height} ${b.x},${cy}" ${common}/>`
    }
    case 'cylinder': {
      const ry = Math.min(9, b.height * 0.16)
      const rx = b.width / 2
      const body = `M${b.x},${b.y + ry} a${rx},${ry} 0 0 1 ${b.width},0 v${b.height - 2 * ry} a${rx},${ry} 0 0 1 ${-b.width},0 z`
      const lip = `M${b.x},${b.y + ry} a${rx},${ry} 0 0 0 ${b.width},0`
      return `<path d="${body}" ${common}/><path d="${lip}" fill="none" stroke="${style.accent}" stroke-width="1.6"/>`
    }
    case 'pill':
    case 'stadium':
      return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.height / 2}" ${common}/>`
    case 'box':
      return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="6" ${common}/>`
    default:
      return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="12" ${common}/>`
  }
}

function nodeSvg(n: IRNode, b: Box, style: RoleStyle, fg: string, sub: string, bg: string): string {
  const parts = [shapeSvg(style, b)]
  // Diamonds have less usable width for text.
  const inset = style.shape === 'diamond' ? b.width * 0.22 : 12
  let textLeft = b.x + inset
  const textRight = b.x + b.width - inset
  if (n.brand && style.shape !== 'diamond') {
    const s = 24
    const bx = b.x + 10
    const by = b.y + (b.height - s) / 2
    parts.push(
      `<rect x="${bx}" y="${by}" width="${s}" height="${s}" rx="5" fill="${bg}" stroke="${style.accent}" stroke-width="1.4"/>`,
      `<text x="${bx + s / 2}" y="${by + s / 2 + 3.5}" fill="${style.accent}" font-size="10" font-weight="700" text-anchor="middle" font-family="${FONT}">${esc(n.brand.slice(0, 2).toUpperCase())}</text>`,
    )
    textLeft = bx + s + 8
  }
  const cx = (textLeft + textRight) / 2
  const avail = textRight - textLeft
  const cy = b.y + b.height / 2
  const label = esc(truncate(n.label, avail, 13))
  if (n.sublabel) {
    parts.push(
      `<text x="${cx}" y="${cy - 3}" fill="${fg}" font-size="13" font-weight="600" text-anchor="middle" font-family="${FONT}">${label}</text>`,
      `<text x="${cx}" y="${cy + 13}" fill="${sub}" font-size="11" text-anchor="middle" font-family="${FONT}">${esc(truncate(n.sublabel, avail, 11))}</text>`,
    )
  } else {
    parts.push(`<text x="${cx}" y="${cy + 4.5}" fill="${fg}" font-size="13" font-weight="600" text-anchor="middle" font-family="${FONT}">${label}</text>`)
  }
  return `<g data-node="${esc(n.id)}" data-box="${round(b.x)},${round(b.y)},${b.width},${b.height}">${parts.join('')}</g>`
}

const isHorizontal = (s: Side): boolean => s === 'left' || s === 'right'
const out = (p: { x: number; y: number }, side: Side, d: number) =>
  side === 'right' ? { x: p.x + d, y: p.y } : side === 'left' ? { x: p.x - d, y: p.y } : side === 'bottom' ? { x: p.x, y: p.y + d } : { x: p.x, y: p.y - d }

/**
 * Orthogonal route from `a` (leaving via `sa`) to `b` (arriving via `sb`).
 * Forward edges get one bend in the middle; back edges loop around past both
 * nodes so they never cut through them. Returns the points and a label anchor.
 */
export function routeEdge(
  sBox: Box,
  tBox: Box,
  sa: Side,
  sb: Side,
): { points: { x: number; y: number }[]; label: { x: number; y: number } } {
  const a = anchor(sBox, sa)
  const b = anchor(tBox, sb)
  if (isHorizontal(sa)) {
    const forward = sa === 'right' ? b.x - a.x >= 2 * GAP : a.x - b.x >= 2 * GAP
    if (forward) {
      const mx = (a.x + b.x) / 2
      return { points: [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b], label: { x: mx, y: (a.y + b.y) / 2 } }
    }
    const a1 = out(a, sa, GAP)
    const b1 = out(b, sb, GAP)
    const ly = Math.max(sBox.y + sBox.height, tBox.y + tBox.height) + GAP
    return { points: [a, a1, { x: a1.x, y: ly }, { x: b1.x, y: ly }, b1, b], label: { x: (a1.x + b1.x) / 2, y: ly } }
  }
  const forward = sa === 'bottom' ? b.y - a.y >= 2 * GAP : a.y - b.y >= 2 * GAP
  if (forward) {
    const my = (a.y + b.y) / 2
    return { points: [a, { x: a.x, y: my }, { x: b.x, y: my }, b], label: { x: (a.x + b.x) / 2, y: my } }
  }
  const a1 = out(a, sa, GAP)
  const b1 = out(b, sb, GAP)
  const lx = Math.max(sBox.x + sBox.width, tBox.x + tBox.width) + GAP
  return { points: [a, a1, { x: lx, y: a1.y }, { x: lx, y: b1.y }, b1, b], label: { x: lx, y: (a1.y + b1.y) / 2 } }
}

export interface SvgExport {
  svg: string
  width: number
  height: number
}

export function diagramToSvg(diagram: IRDiagram, laid: LaidOut, theme: 'light' | 'dark'): SvgExport {
  const pal = palette(theme)
  const bg = theme === 'dark' ? '#0b0f19' : '#ffffff'
  const fg = theme === 'dark' ? '#e2e8f0' : '#0f172a'
  const sub = theme === 'dark' ? '#94a3b8' : '#64748b'
  const weak = theme === 'dark' ? '#475569' : '#cbd5e1'
  const { source: sa, target: sb } = handleSides(diagram.direction)

  const boxes = new Map<string, Box>()
  for (const n of diagram.nodes) {
    if (n.role === 'group') continue
    const p = laid.positions[n.id]
    const s = laid.sizes[n.id]
    if (p && s) boxes.set(n.id, { x: p.x, y: p.y, width: s.width, height: s.height })
  }

  // Bounds from what will actually be drawn (nodes + edge detours).
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const b of boxes.values()) {
    grow(b.x, b.y)
    grow(b.x + b.width, b.y + b.height)
  }
  const roleOf = new Map(diagram.nodes.map((n) => [n.id, n.role]))
  const routes = diagram.edges
    .filter((e) => boxes.has(e.source) && boxes.has(e.target) && e.source !== e.target)
    .map((e) => ({ e, r: routeEdge(boxes.get(e.source)!, boxes.get(e.target)!, sa, sb) }))
  for (const { r } of routes) for (const p of r.points) grow(p.x, p.y)
  if (!Number.isFinite(minX)) {
    minX = minY = 0
    maxX = 320
    maxY = 120
  }

  const header = diagram.subtitle ? 64 : 44
  const ox = PAD - minX
  const oy = PAD + header - minY
  const width = Math.ceil(maxX - minX + PAD * 2)
  const height = Math.ceil(maxY - minY + PAD * 2 + header)

  // One arrowhead marker per edge color: marker contents don't inherit the
  // referencing path's color, and Chromium has no context-stroke.
  const markerIds = new Map<string, string>()
  const markerFor = (color: string): string => {
    let id = markerIds.get(color)
    if (!id) {
      id = `arrow-${markerIds.size}`
      markerIds.set(color, id)
    }
    return id
  }

  const edgeSvg = routes
    .map(({ e, r }) => {
      const weakEdge = e.variant === 'weak'
      const color = weakEdge ? weak : pal[roleOf.get(e.source) ?? 'backend'].accent
      const sw = e.variant === 'emphasis' ? 2.4 : weakEdge ? 1.2 : 1.6
      const dash = e.variant === 'dashed' ? ' stroke-dasharray="6 5"' : ''
      const d = r.points.map((p, i) => `${i ? 'L' : 'M'}${round(p.x + ox)},${round(p.y + oy)}`).join(' ')
      let label = ''
      if (e.label) {
        const w = textWidth(e.label, 11) + 10
        const lx = r.label.x + ox
        const ly = r.label.y + oy
        label =
          `<rect x="${round(lx - w / 2)}" y="${round(ly - 9)}" width="${round(w)}" height="17" rx="4" fill="${bg}" fill-opacity="0.9"/>` +
          `<text x="${round(lx)}" y="${round(ly + 3.5)}" fill="${sub}" font-size="11" text-anchor="middle" font-family="${FONT}">${esc(e.label)}</text>`
      }
      return `<g data-edge="${esc(e.id)}"><path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"${dash} stroke-linejoin="round" marker-end="url(#${markerFor(color)})"/>${label}</g>`
    })
    .join('\n')

  const nodeSvgs = diagram.nodes
    .filter((n) => boxes.has(n.id))
    .map((n) => {
      const b = boxes.get(n.id)!
      return nodeSvg(n, { x: b.x + ox, y: b.y + oy, width: b.width, height: b.height }, pal[n.role], fg, sub, bg)
    })
    .join('\n')

  const title = `<text x="${PAD}" y="${PAD + 4}" fill="${fg}" font-size="20" font-weight="700" font-family="${FONT}">${esc(diagram.title)}</text>`
  const subtitle = diagram.subtitle
    ? `<text x="${PAD}" y="${PAD + 26}" fill="${sub}" font-size="12.5" font-family="${FONT}">${esc(diagram.subtitle)}</text>`
    : ''

  const markers = [...markerIds]
    .map(
      ([color, id]) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`,
    )
    .join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${esc(diagram.title)}</title>
<defs>
${markers}
</defs>
<rect width="${width}" height="${height}" fill="${bg}"/>
${title}${subtitle}
${edgeSvg}
${nodeSvgs}
</svg>
`
  return { svg, width, height }
}

const round = (n: number): number => Math.round(n * 10) / 10

/** Rasterize an SVG to a PNG data URL (browser only). */
export async function svgToPngDataUrl(svg: string, scale = 2): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG rasterization failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(img.width * scale)
    canvas.height = Math.ceil(img.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
