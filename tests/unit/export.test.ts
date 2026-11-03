import { describe, expect, it } from 'vitest'
import { diagramToSvg, esc, routeEdge } from '../../src/renderer/src/export/svg'
import { layout } from '../../src/renderer/src/layout/elk'
import { handleSides, anchor } from '../../src/renderer/src/canvas/sides'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import type { IRDiagram } from '../../src/shared/ir'

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no raw '<' in text. */
function assertWellFormed(xml: string): void {
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

describe('diagramToSvg', () => {
  it('produces well-formed SVG for every sample, both themes', async () => {
    for (const d of Object.values(SAMPLES)) {
      const l = await layout(d)
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
    const { svg } = diagramToSvg(d, await layout(d), 'dark')
    assertWellFormed(svg)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('<img')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('O&#39;Reilly &amp; co')
  })

  it('includes pinned nodes far outside the ELK area in its bounds', async () => {
    const d = SAMPLES.webapp
    const l = await layout(d, { users: { x: -1500, y: 2000, pinned: true } })
    const { svg, width, height } = diagramToSvg(d, l, 'dark')
    const [x, y, w, h] = nums(svg.match(/data-node="users" data-box="([^"]+)"/)![1])
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(x + w).toBeLessThanOrEqual(width)
    expect(y + h).toBeLessThanOrEqual(height)
  })

  it('draws role shapes: cylinder for stores, diamond for decisions, pill for terminals', async () => {
    const wf = SAMPLES.deploy
    const { svg } = diagramToSvg(wf, await layout(wf), 'light')
    expect(svg).toMatch(/<g data-node="gate"[^>]*><polygon/)
    expect(svg).toMatch(/<g data-node="start"[^>]*><rect[^>]*rx="30"/) // pill: rx = height / 2
    const arch = SAMPLES.webapp
    const { svg: s2 } = diagramToSvg(arch, await layout(arch), 'light')
    expect(s2).toMatch(/<g data-node="db"[^>]*><path d="M[^"]+a[^"]+"/)
  })

  it('gives each edge color its own arrow marker', async () => {
    const d = SAMPLES.webapp
    const { svg } = diagramToSvg(d, await layout(d), 'dark')
    const markers = [...svg.matchAll(/<marker id="(arrow-\d+)"[^>]*><path[^>]*fill="(#[0-9a-f]+)"/g)]
    expect(markers.length).toBeGreaterThan(1)
    for (const [, id] of markers) expect(svg).toContain(`marker-end="url(#${id})"`)
  })

  it('every edge ends exactly on its target border, on the side the flow implies', async () => {
    for (const d of [SAMPLES.webapp, SAMPLES.deploy, SAMPLES.agentRun]) {
      const { svg } = diagramToSvg(d, await layout(d), 'dark')
      const { target } = handleSides(d.direction)
      for (const e of d.edges) {
        const path = svg.match(new RegExp(`<g data-edge="${e.id}"><path d="([^"]+)"`))![1]
        const [ex, ey] = nums(path).slice(-2)
        const [x, y, width, height] = nums(svg.match(new RegExp(`data-node="${e.target}" data-box="([^"]+)"`))![1])
        const a = anchor({ x, y, width, height }, target)
        expect(ex, `${d.id} ${e.id} x`).toBeCloseTo(a.x, 0)
        expect(ey, `${d.id} ${e.id} y`).toBeCloseTo(a.y, 0)
      }
    }
  })
})

describe('routeEdge', () => {
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 50 })

  it('forward horizontal edge: 4 points, starts and ends on the right sides', () => {
    const r = routeEdge(box(0, 0), box(300, 100), 'right', 'left')
    expect(r.points).toHaveLength(4)
    expect(r.points[0]).toEqual({ x: 100, y: 25 })
    expect(r.points[3]).toEqual({ x: 300, y: 125 })
    // orthogonal: every segment is horizontal or vertical
    for (let i = 1; i < r.points.length; i++) {
      const [a, b] = [r.points[i - 1], r.points[i]]
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })

  it('back edge loops below both nodes instead of cutting through them', () => {
    const r = routeEdge(box(300, 0), box(0, 20), 'right', 'left')
    expect(r.points).toHaveLength(6)
    const lowest = Math.max(...r.points.map((p) => p.y))
    expect(lowest).toBeGreaterThan(70) // below the lower node's bottom (20 + 50)
    expect(r.points[r.points.length - 1]).toEqual({ x: 0, y: 45 })
  })

  it('vertical flows route top-to-bottom', () => {
    const r = routeEdge(box(0, 0), box(0, 200), 'bottom', 'top')
    expect(r.points[0]).toEqual({ x: 50, y: 50 })
    expect(r.points[r.points.length - 1]).toEqual({ x: 50, y: 200 })
  })
})

describe('handleSides', () => {
  it('maps each direction to matching sides', () => {
    expect(handleSides('RIGHT')).toEqual({ source: 'right', target: 'left' })
    expect(handleSides('LEFT')).toEqual({ source: 'left', target: 'right' })
    expect(handleSides('DOWN')).toEqual({ source: 'bottom', target: 'top' })
    expect(handleSides('UP')).toEqual({ source: 'top', target: 'bottom' })
  })

  it('esc', () => {
    expect(esc(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
  })
})
