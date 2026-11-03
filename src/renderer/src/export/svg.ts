/**
 * Deterministic IR → SVG exporter, independent of React Flow, plus a PNG
 * rasterizer. It draws through the same geometry as the canvas (render/geometry,
 * render/sequence), so shapes, edge routes, ports and sequence rows match the
 * screen exactly. Bounds come from what is actually drawn, so pinned nodes and
 * edge detours are never clipped. A legend of the roles/styles used is included.
 */
import type { IRDiagram, IRNode } from '@shared/ir'
import type { LaidOut } from '../layout/elk'
import { palette, type RoleStyle } from '@shared/roles'
import { pointsToPath, shapeGeometry, textArea, type Box } from '../render/geometry'
import { legendContent, VARIANT_LABEL } from '../render/legend'
import { diagramRoutes, edgeColor, nodeBoxes } from '../canvas/toReactFlow'

const FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
const PAD = 40

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Rough text width for system-ui; good enough for label backgrounds and truncation. */
const textWidth = (s: string, size: number): number => s.length * size * 0.56
const round = (n: number): number => Math.round(n * 10) / 10

function truncate(s: string, maxWidth: number, size: number): string {
  if (textWidth(s, size) <= maxWidth) return s
  const max = Math.max(1, Math.floor(maxWidth / (size * 0.56)) - 1)
  return s.slice(0, max) + '…'
}

function nodeSvg(n: IRNode, b: Box, style: RoleStyle, fg: string, sub: string, bg: string): string {
  const geom = shapeGeometry(style.shape, b.width, b.height)
  const area = textArea(style.shape, b.width, b.height)
  const parts = [`<path d="${geom.d}" fill="${style.fill}" stroke="${style.accent}" stroke-width="1.6"/>`]
  if (geom.overlay) parts.push(`<path d="${geom.overlay}" fill="none" stroke="${style.accent}" stroke-width="1.6"/>`)

  let left = area.x
  if (n.brand && style.shape !== 'diamond') {
    const s = 24
    const by = area.y + (area.height - s) / 2
    parts.push(
      `<rect x="${area.x}" y="${round(by)}" width="${s}" height="${s}" rx="5" fill="${bg}" stroke="${style.accent}" stroke-width="1.4"/>`,
      `<text x="${area.x + s / 2}" y="${round(by + s / 2 + 3.5)}" fill="${style.accent}" font-size="10" font-weight="700" text-anchor="middle" font-family="${FONT}">${esc(n.brand.slice(0, 2).toUpperCase())}</text>`,
    )
    left = area.x + s + 8
  }
  const right = area.x + area.width
  const cx = round((left + right) / 2)
  const avail = right - left
  const cy = area.y + area.height / 2
  const label = esc(truncate(n.label, avail, 13))
  if (n.sublabel) {
    parts.push(
      `<text x="${cx}" y="${round(cy - 3)}" fill="${fg}" font-size="13" font-weight="600" text-anchor="middle" font-family="${FONT}">${label}</text>`,
      `<text x="${cx}" y="${round(cy + 13)}" fill="${sub}" font-size="11" text-anchor="middle" font-family="${FONT}">${esc(truncate(n.sublabel, avail, 11))}</text>`,
    )
  } else {
    parts.push(`<text x="${cx}" y="${round(cy + 4.5)}" fill="${fg}" font-size="13" font-weight="600" text-anchor="middle" font-family="${FONT}">${label}</text>`)
  }
  return (
    `<g data-node="${esc(n.id)}" data-shape="${style.shape}" data-box="${round(b.x)},${round(b.y)},${b.width},${b.height}" ` +
    `transform="translate(${round(b.x)},${round(b.y)})">${parts.join('')}</g>`
  )
}

export interface SvgExport {
  svg: string
  width: number
  height: number
}

export interface SvgOptions {
  /** include a legend of the roles and edge styles used (default true) */
  legend?: boolean
}

export function diagramToSvg(diagram: IRDiagram, laid: LaidOut, theme: 'light' | 'dark', options: SvgOptions = {}): SvgExport {
  const pal = palette(theme)
  const bg = theme === 'dark' ? '#0b0f19' : '#ffffff'
  const fg = theme === 'dark' ? '#e2e8f0' : '#0f172a'
  const sub = theme === 'dark' ? '#94a3b8' : '#64748b'

  const boxes = nodeBoxes(diagram, laid)
  const routes = diagramRoutes(diagram, laid, boxes, theme)
  const roleOf = new Map(diagram.nodes.map((n) => [n.id, n.role]))
  const seq = diagram.type === 'sequence' ? laid.sequence : undefined

  // Bounds from what will actually be drawn.
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
  for (const [id, r] of routes) {
    for (const p of r.points) grow(p.x, p.y)
    const text = diagram.edges.find((e) => e.id === id)?.label
    if (text) {
      const w = textWidth(text, 11) / 2 + 6
      grow(r.label.x - w, r.label.y - 10)
      grow(r.label.x + w, r.label.y + 10)
    }
  }
  if (seq) for (const l of seq.lifelines) grow(l.x, l.bottom)
  if (!Number.isFinite(minX)) {
    minX = minY = 0
    maxX = 320
    maxY = 120
  }

  const { roles, variants } = legendContent(diagram)
  const showLegend = options.legend !== false && roles.length > 0
  const header = diagram.subtitle ? 64 : 44
  const legendH = showLegend ? 40 : 0
  const ox = PAD - minX
  const oy = PAD + header - minY
  const contentW = maxX - minX
  const width = Math.ceil(Math.max(contentW + PAD * 2, textWidth(diagram.title, 20) + PAD * 2, 360))
  const height = Math.ceil(maxY - minY + PAD * 2 + header + legendH)

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

  const lifelines = seq
    ? seq.lifelines
        .map((l) => {
          const color = pal[roleOf.get(l.id) ?? 'backend'].accent
          return `<line data-lifeline="${esc(l.id)}" x1="${round(l.x + ox)}" y1="${round(l.top + oy)}" x2="${round(l.x + ox)}" y2="${round(l.bottom + oy)}" stroke="${color}" stroke-width="1.4" stroke-dasharray="5 5" opacity="0.8"/>`
        })
        .join('\n')
    : ''

  const edgeSvg = diagram.edges
    .filter((e) => routes.has(e.id))
    .map((e) => {
      const r = routes.get(e.id)!
      const color = edgeColor(e, roleOf, theme)
      const sw = e.variant === 'emphasis' ? 2.4 : e.variant === 'weak' ? 1.2 : 1.6
      const dash = e.variant === 'dashed' ? ' stroke-dasharray="6 5"' : ''
      const d = pointsToPath(r.points.map((p) => ({ x: p.x + ox, y: p.y + oy })))
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

  let legend = ''
  if (showLegend) {
    const items: string[] = []
    let x = PAD
    const y = height - PAD / 2 - 14
    for (const r of roles) {
      items.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" rx="3" fill="${pal[r].accent}"/>`)
      items.push(`<text x="${x + 15}" y="${y}" fill="${sub}" font-size="11" font-family="${FONT}">${esc(pal[r].label)}</text>`)
      x += 15 + textWidth(pal[r].label, 11) + 16
    }
    if (variants.length > 1) {
      x += 8
      for (const v of variants) {
        const sw = v === 'emphasis' ? 2.4 : v === 'weak' ? 1.2 : 1.6
        const dash = v === 'dashed' ? ' stroke-dasharray="4 3"' : ''
        items.push(`<line x1="${x}" y1="${y - 4}" x2="${x + 20}" y2="${y - 4}" stroke="${sub}" stroke-width="${sw}"${dash}/>`)
        items.push(`<text x="${x + 26}" y="${y}" fill="${sub}" font-size="11" font-family="${FONT}">${esc(VARIANT_LABEL[v])}</text>`)
        x += 26 + textWidth(VARIANT_LABEL[v], 11) + 16
      }
    }
    legend = `<g data-legend="">${items.join('')}</g>`
  }

  const markers = [...markerIds]
    .map(
      ([color, id]) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`,
    )
    .join('\n')

  const title = `<text x="${PAD}" y="${PAD + 4}" fill="${fg}" font-size="20" font-weight="700" font-family="${FONT}">${esc(diagram.title)}</text>`
  const subtitle = diagram.subtitle
    ? `<text x="${PAD}" y="${PAD + 26}" fill="${sub}" font-size="12.5" font-family="${FONT}">${esc(diagram.subtitle)}</text>`
    : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${esc(diagram.title)}</title>
<defs>
${markers}
</defs>
<rect width="${width}" height="${height}" fill="${bg}"/>
${title}${subtitle}
${lifelines}
${edgeSvg}
${nodeSvgs}
${legend}
</svg>
`
  return { svg, width, height }
}

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
