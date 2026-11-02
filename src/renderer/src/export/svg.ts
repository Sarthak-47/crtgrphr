/** Deterministic IR → SVG exporter (independent of React Flow), and a PNG
 *  rasterizer. Basis for clean, reproducible exports and share cards. */
import type { IRDiagram } from '@shared/ir'
import type { LaidOut } from '../layout/elk'
import { palette } from '@shared/roles'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function diagramToSvg(diagram: IRDiagram, laid: LaidOut, theme: 'light' | 'dark'): string {
  const pal = palette(theme)
  const pad = 48
  const w = Math.ceil(laid.width + pad * 2)
  const h = Math.ceil(laid.height + pad * 2 + 40)
  const bg = theme === 'dark' ? '#0b0f19' : '#ffffff'
  const fg = theme === 'dark' ? '#e2e8f0' : '#0f172a'
  const sub = theme === 'dark' ? '#94a3b8' : '#64748b'

  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]))
  const center = (id: string) => {
    const p = laid.positions[id]
    const s = laid.sizes[id]
    if (!p || !s) return null
    return { x: p.x + s.width / 2 + pad, y: p.y + s.height / 2 + pad + 40 }
  }

  const edgesSvg = diagram.edges
    .map((e) => {
      const a = center(e.source)
      const b = center(e.target)
      if (!a || !b) return ''
      const st = pal[nodeById.get(e.source)?.role ?? 'backend']
      const weak = e.variant === 'weak'
      const color = weak ? sub : st.accent
      const dash = e.variant === 'dashed' ? 'stroke-dasharray="6 5"' : ''
      const sw = e.variant === 'emphasis' ? 2.4 : weak ? 1.2 : 1.6
      const midx = (a.x + b.x) / 2
      const midy = (a.y + b.y) / 2
      const label = e.label
        ? `<rect x="${midx - e.label.length * 3.4 - 4}" y="${midy - 9}" width="${e.label.length * 6.8 + 8}" height="16" rx="3" fill="${bg}" opacity="0.85"/><text x="${midx}" y="${midy + 3}" fill="${sub}" font-size="11" text-anchor="middle" font-family="ui-sans-serif,system-ui">${esc(e.label)}</text>`
        : ''
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${sw}" ${dash} marker-end="url(#arrow-${weak ? 'w' : 'n'})"/>${label}`
    })
    .join('\n')

  const nodesSvg = diagram.nodes
    .filter((n) => n.role !== 'group')
    .map((n) => {
      const p = laid.positions[n.id]
      const s = laid.sizes[n.id]
      if (!p || !s) return ''
      const st = pal[n.role]
      const x = p.x + pad
      const y = p.y + pad + 40
      const rx = st.shape === 'pill' || st.shape === 'stadium' ? s.height / 2 : st.shape === 'box' ? 6 : 12
      const label = `<text x="${x + s.width / 2}" y="${y + (n.sublabel ? s.height / 2 - 4 : s.height / 2 + 4)}" fill="${fg}" font-size="13" font-weight="600" text-anchor="middle" font-family="ui-sans-serif,system-ui">${esc(n.label)}</text>`
      const sublabel = n.sublabel
        ? `<text x="${x + s.width / 2}" y="${y + s.height / 2 + 14}" fill="${sub}" font-size="11" text-anchor="middle" font-family="ui-sans-serif,system-ui">${esc(n.sublabel)}</text>`
        : ''
      return `<g><rect x="${x}" y="${y}" width="${s.width}" height="${s.height}" rx="${rx}" fill="${st.fill}" stroke="${st.accent}" stroke-width="1.6"/>${label}${sublabel}</g>`
    })
    .join('\n')

  const title = `<text x="${pad}" y="${pad - 6}" fill="${fg}" font-size="20" font-weight="700" font-family="ui-sans-serif,system-ui">${esc(diagram.title)}</text>`
  const subtitle = diagram.subtitle
    ? `<text x="${pad}" y="${pad + 16}" fill="${sub}" font-size="12" font-family="ui-sans-serif,system-ui">${esc(diagram.subtitle)}</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <marker id="arrow-n" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
  <marker id="arrow-w" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${sub}"/></marker>
</defs>
<rect width="${w}" height="${h}" fill="${bg}"/>
${title}${subtitle}
${edgesSvg}
${nodesSvg}
</svg>`
}

export async function svgToPngDataUrl(svg: string, scale = 2): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG rasterization failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
