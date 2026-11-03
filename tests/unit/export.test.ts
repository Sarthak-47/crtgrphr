import { describe, expect, it } from 'vitest'
import { diagramToSvg, esc } from '../../src/renderer/src/export/svg'
import { layoutDiagram } from '../../src/renderer/src/layout'
import { handleSides, anchor } from '../../src/renderer/src/canvas/sides'
import { palette } from '../../src/shared/roles'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import type { IRDiagram } from '../../src/shared/ir'

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no raw '<' in text. */
export function assertWellFormed(xml: string): void {
  const stack: string[] = []
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml))) {
    const between = xml.slice(last, m.index)
    expect(between, 'stray markup between tags').not.toMatch(/[<>]/)
    const [, close, name, , selfClose] = m
    if (close) expect(stack.pop(), `closing </${name}>`).toBe(name)
    else if (!selfClose) stack.push(name)
    last = tagRe.lastIndex
  }
  expect(xml.slice(last).trim()).toBe('')
  expect(stack).toEqual([])
}

const nums = (s: string) => s.match(/-?\d+(\.\d+)?/g)!.map(Number)
const boxOf = (svg: string, id: string) => {
  const [x, y, width, height] = nums(svg.match(new RegExp(`data-node="${id}"[^>]*data-box="([^"]+)"`))![1])
  return { x, y, width, height }
}

describe('diagramToSvg', () => {
  it('produces well-formed SVG for every sample, both themes', async () => {
    for (const d of Object.values(SAMPLES)) {
      const l = await layoutDiagram(d)
      for (const theme of ['dark', 'light'] as const) {
        const { svg, width, height } = diagramToSvg(d, l, theme)
        assertWellFormed(svg)
        expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`)
        for (const n of d.nodes) expect(svg).toContain(`data-node="${n.id}"`)
        expect(svg.match(/data-edge=/g)?.length).toBe(d.edges.length)
      }
    }
  })

  it('escapes hostile text everywhere', async () => {
    const d: IRDiagram = {
      id: 'x',
      title: '<script>alert(1)</script>',
      subtitle: 'a & b "c"',
      type: 'architecture',
      direction: 'RIGHT',
      nodes: [
        { id: 'a"b', label: '<img onerror=x>', role: 'backend', brand: '<>' },
        { id: 'c', label: "O'Reilly & co", sublabel: '</text>', role: 'database' },
      ],
      edges: [{ id: 'e', source: 'a"b', target: 'c', label: '<b>bold</b>' }],
    }
    const { svg } = diagramToSvg(d, await layoutDiagram(d), 'dark')
    assertWellFormed(svg)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('<img')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('O&#39;Reilly &amp; co')
  })

  it('includes pinned nodes far outside the ELK area in its bounds', async () => {
    const d = SAMPLES.webapp
    const l = await layoutDiagram(d, { users: { x: -1500, y: 2000, pinned: true } })
    const { svg, width, height } = diagramToSvg(d, l, 'dark')
    const b = boxOf(svg, 'users')
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(width)
    expect(b.y + b.height).toBeLessThanOrEqual(height)
  })

  it('tags every node with the shape its role implies', async () => {
    for (const d of [SAMPLES.webapp, SAMPLES.deploy, SAMPLES.agentRun]) {
      const { svg } = diagramToSvg(d, await layoutDiagram(d), 'light')
      for (const n of d.nodes) {
        expect(svg).toMatch(new RegExp(`data-node="${n.id}" data-shape="${palette('light')[n.role].shape}"`))
      }
    }
    const { svg } = diagramToSvg(SAMPLES.deploy, await layoutDiagram(SAMPLES.deploy), 'light')
    expect(svg).toMatch(/data-node="gate" data-shape="diamond"[^>]*><path d="M[\d.]+,0 L/)
  })

  it('gives each edge color its own arrow marker', async () => {
    const d = SAMPLES.webapp
    const { svg } = diagramToSvg(d, await layoutDiagram(d), 'dark')
    const markers = [...svg.matchAll(/<marker id="(arrow-\d+)"[^>]*><path[^>]*fill="(#[0-9a-f]+)"/g)]
    expect(markers.length).toBeGreaterThan(1)
    for (const [, id] of markers) expect(svg).toContain(`marker-end="url(#${id})"`)
  })

  it('every edge ends on its target border (any side: back edges may enter from behind)', async () => {
    for (const d of [SAMPLES.webapp, SAMPLES.deploy, SAMPLES.agentRun, SAMPLES.analytics]) {
      const { svg } = diagramToSvg(d, await layoutDiagram(d), 'dark')
      for (const e of d.edges) {
        const path = svg.match(new RegExp(`<g data-edge="${e.id}"><path d="([^"]+)"`))![1]
        const [ex, ey] = nums(path).slice(-2)
        const b = boxOf(svg, e.target)
        const onV = Math.abs(ex - b.x) < 1 || Math.abs(ex - (b.x + b.width)) < 1
        const onH = Math.abs(ey - b.y) < 1 || Math.abs(ey - (b.y + b.height)) < 1
        const inX = ex >= b.x - 1 && ex <= b.x + b.width + 1
        const inY = ey >= b.y - 1 && ey <= b.y + b.height + 1
        expect((onV && inY) || (onH && inX), `${d.id} ${e.id} ends on ${e.target}'s border`).toBe(true)
      }
    }
  })

  it('in acyclic maps, edges enter on the side the flow implies; diamonds on their vertex', async () => {
    for (const d of [SAMPLES.webapp, SAMPLES.deploy, SAMPLES.analytics]) {
      const { svg } = diagramToSvg(d, await layoutDiagram(d), 'dark')
      const { target } = handleSides(d.direction)
      for (const e of d.edges) {
        const path = svg.match(new RegExp(`<g data-edge="${e.id}"><path d="([^"]+)"`))![1]
        const [ex, ey] = nums(path).slice(-2)
        const b = boxOf(svg, e.target)
        const role = d.nodes.find((n) => n.id === e.target)!.role
        if (palette('dark')[role].shape === 'diamond') {
          const a = anchor(b, target)
          expect(ex, `${d.id} ${e.id} x`).toBeCloseTo(a.x, 0)
          expect(ey, `${d.id} ${e.id} y`).toBeCloseTo(a.y, 0)
        } else if (target === 'left' || target === 'right') {
          expect(ex, `${d.id} ${e.id}`).toBeCloseTo(target === 'left' ? b.x : b.x + b.width, 0)
        } else {
          expect(ey, `${d.id} ${e.id}`).toBeCloseTo(target === 'top' ? b.y : b.y + b.height, 0)
        }
      }
    }
  })

  it('draws sequence diagrams with lifelines and one horizontal row per message', async () => {
    const d = SAMPLES.cacheMiss
    const { svg } = diagramToSvg(d, await layoutDiagram(d), 'dark')
    assertWellFormed(svg)
    expect(svg.match(/data-lifeline=/g)).toHaveLength(d.nodes.length)
    const ys = d.edges.map((e) => {
      const p = nums(svg.match(new RegExp(`<g data-edge="${e.id}"><path d="([^"]+)"`))![1])
      expect(p[1], `${e.id} is horizontal`).toBeCloseTo(p[p.length - 1], 5)
      return p[1]
    })
    expect([...ys].sort((a, b) => a - b)).toEqual(ys) // in IR order, top to bottom
  })

  it('includes a legend of only the roles used, unless disabled', async () => {
    const d = SAMPLES.deploy
    const l = await layoutDiagram(d)
    const { svg } = diagramToSvg(d, l, 'light')
    const legend = svg.match(/<g data-legend="">(.*?)<\/g>/)![1]
    expect(legend).toContain('Process')
    expect(legend).toContain('Decision')
    expect(legend).toContain('Terminal')
    expect(legend).not.toContain('Database')
    expect(legend).toContain('main path') // emphasis edges are used
    expect(diagramToSvg(d, l, 'light', { legend: false }).svg).not.toContain('data-legend')
  })

  it('esc', () => {
    expect(esc(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
  })
})
