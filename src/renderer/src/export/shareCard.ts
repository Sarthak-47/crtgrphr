/**
 * Share card: a 1200×630 image (the size social sites and READMEs expect) with
 * the map's title and subtitle, the map scaled to fit, the legend, and a small
 * Cartographer mark. Built from the same exporter, so it matches the canvas.
 */
import type { IRDiagram } from '@shared/ir'
import { palette } from '@shared/roles'
import type { LaidOut } from '../layout/elk'
import { diagramToSvg, esc, type SvgExport } from './svg'
import { legendContent } from '../render/legend'

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630
const FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
const M = 56 // outer margin

function clip(s: string, maxChars: number): string {
  return s.length <= maxChars ? s : s.slice(0, Math.max(1, maxChars - 1)) + '…'
}

export function shareCardSvg(diagram: IRDiagram, laid: LaidOut, theme: 'light' | 'dark'): SvgExport {
  const dark = theme === 'dark'
  const bgA = dark ? '#0b0f19' : '#ffffff'
  const bgB = dark ? '#141b2e' : '#eef2f7'
  const fg = dark ? '#f1f5f9' : '#0f172a'
  const sub = dark ? '#94a3b8' : '#64748b'
  const accent = dark ? '#22d3ee' : '#0891b2'
  const pal = palette(theme)

  // The map, without its own background/title/legend, scaled into the card.
  const map = diagramToSvg(diagram, laid, theme, { chrome: false })
  const top = diagram.subtitle ? 150 : 124
  const bottom = CARD_HEIGHT - 72
  const box = { x: M, y: top, w: CARD_WIDTH - 2 * M, h: bottom - top }
  const nested = map.svg
    .replace(/^<svg [^>]*>/, `<svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" viewBox="0 0 ${map.width} ${map.height}" preserveAspectRatio="xMidYMid meet">`)
    .replace(/<title>[\s\S]*?<\/title>\n?/, '')
    .trim()

  const { roles } = legendContent(diagram)
  let lx = M
  const ly = CARD_HEIGHT - 34
  const legend = roles
    .map((r) => {
      const label = pal[r].label
      const item = `<rect x="${lx}" y="${ly - 10}" width="11" height="11" rx="3" fill="${pal[r].accent}"/><text x="${lx + 17}" y="${ly}" fill="${sub}" font-size="14" font-family="${FONT}">${esc(label)}</text>`
      lx += 17 + label.length * 7.6 + 22
      return lx < CARD_WIDTH - 260 ? item : ''
    })
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
<title>${esc(diagram.title)}</title>
<defs>
<linearGradient id="card-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient>
</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#card-bg)"/>
<rect x="0" y="0" width="${CARD_WIDTH}" height="6" fill="${accent}"/>
<text x="${M}" y="${M + 30}" fill="${fg}" font-size="40" font-weight="750" font-family="${FONT}">${esc(clip(diagram.title, 44))}</text>
${diagram.subtitle ? `<text x="${M}" y="${M + 64}" fill="${sub}" font-size="20" font-family="${FONT}">${esc(clip(diagram.subtitle, 90))}</text>` : ''}
<g data-card-map="">${nested}</g>
<g data-card-legend="">${legend}</g>
<text x="${CARD_WIDTH - M}" y="${ly}" fill="${sub}" font-size="14" font-weight="600" text-anchor="end" font-family="${FONT}"><tspan fill="${accent}">◆</tspan> Cartographer</text>
</svg>
`
  return { svg, width: CARD_WIDTH, height: CARD_HEIGHT }
}
