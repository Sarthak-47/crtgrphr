import { describe, expect, it } from 'vitest'
import { shareCardSvg, CARD_WIDTH, CARD_HEIGHT } from '../../src/renderer/src/export/shareCard'
import { diagramToSvg } from '../../src/renderer/src/export/svg'
import { layoutDiagram } from '../../src/renderer/src/layout'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import { assertWellFormed } from './helpers/xml'

describe('share card', () => {
  it('is exactly 1200×630, well-formed, with title, map, legend and mark', async () => {
    for (const d of Object.values(SAMPLES)) {
      const { svg, width, height } = shareCardSvg(d, await layoutDiagram(d), 'dark')
      expect([width, height]).toEqual([CARD_WIDTH, CARD_HEIGHT])
      expect(svg).toContain('width="1200" height="630"')
      assertWellFormed(svg)
      expect(svg).toContain(`>${d.title}</text>`)
      expect(svg).toMatch(/<g data-card-map=""><svg x="56" y="\d+" width="1088" height="\d+" viewBox="0 0 [\d.]+ [\d.]+" preserveAspectRatio="xMidYMid meet">/)
      for (const n of d.nodes) expect(svg).toContain(`data-node="${n.id}"`)
      expect(svg).toContain('Cartographer</text>')
    }
  })

  it('the embedded map has no background, title or legend of its own', async () => {
    const d = SAMPLES.webapp
    const map = diagramToSvg(d, await layoutDiagram(d), 'dark', { chrome: false })
    expect(map.svg).not.toContain('data-legend')
    expect(map.svg).not.toMatch(/<rect width="\d+" height="\d+" fill=/)
    expect(map.svg).not.toContain('font-size="20"')
    const card = shareCardSvg(d, await layoutDiagram(d), 'light').svg
    expect(card.match(/<title>/g)).toHaveLength(1)
  })

  it('clips very long titles instead of overflowing', async () => {
    const d = { ...SAMPLES.webapp, title: 'A'.repeat(120) }
    const { svg } = shareCardSvg(d, await layoutDiagram(d), 'dark')
    expect(svg).toContain('A'.repeat(43) + '…')
  })
})
