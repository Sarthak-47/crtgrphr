import { describe, expect, it } from 'vitest'
import {
  computeRoutes,
  pointsToPath,
  portPoint,
  routeEdge,
  selfLoop,
  shapeGeometry,
  spreadOffsets,
  textArea,
  type Box,
} from '../../src/renderer/src/render/geometry'
import { handleSides } from '../../src/renderer/src/canvas/sides'
import type { IRDiagram } from '../../src/shared/ir'

const box = (x: number, y: number, w = 100, h = 50): Box => ({ x, y, width: w, height: h })
const orthogonal = (pts: { x: number; y: number }[]) => {
  for (let i = 1; i < pts.length; i++) expect(pts[i - 1].x === pts[i].x || pts[i - 1].y === pts[i].y).toBe(true)
}

describe('shapes', () => {
  it('diamond vertices sit at the side midpoints (where edges attach)', () => {
    expect(shapeGeometry('diamond', 120, 80).d).toBe('M60,0 L120,40 L60,80 L0,40 Z')
  })

  it('cylinder has a body and a front-lip overlay', () => {
    const g = shapeGeometry('cylinder', 140, 60)
    expect(g.d).toMatch(/^M0,[\d.]+ A70,/)
    expect(g.overlay).toMatch(/^M0,[\d.]+ A70,[\d.]+ 0 0 0 140,/)
  })

  it('pills are fully rounded; boxes barely', () => {
    expect(shapeGeometry('pill', 140, 60).d).toContain('A30,30')
    expect(shapeGeometry('box', 140, 60).d).toContain('A6,6')
  })

  it('text areas stay inside the shape', () => {
    for (const shape of ['diamond', 'cylinder', 'pill', 'stadium', 'box', 'rounded'] as const) {
      const a = textArea(shape, 150, 80)
      expect(a.x).toBeGreaterThan(0)
      expect(a.y).toBeGreaterThanOrEqual(0)
      expect(a.x + a.width).toBeLessThan(150)
      expect(a.y + a.height).toBeLessThanOrEqual(80)
    }
    // a diamond's text area is much narrower than its box
    expect(textArea('diamond', 150, 80).width).toBeLessThan(0.6 * 150)
  })
})

describe('ports', () => {
  it('one edge uses the middle; several fan out symmetrically within the side', () => {
    expect(spreadOffsets(1, 60)).toEqual([0])
    const o = spreadOffsets(3, 60)
    expect(o).toEqual([-18, 0, 18])
    const many = spreadOffsets(10, 60)
    expect(Math.max(...many) - Math.min(...many)).toBeLessThanOrEqual(36) // never past 12px of the corners
  })

  it('portPoint offsets along the side', () => {
    expect(portPoint(box(0, 0), 'left', 10)).toEqual({ x: 0, y: 35 })
    expect(portPoint(box(0, 0), 'bottom', -20)).toEqual({ x: 30, y: 50 })
  })

  it('edges sharing a side get distinct ports, ordered to avoid crossings', () => {
    const d: IRDiagram = {
      id: 'p',
      title: 'p',
      type: 'architecture',
      direction: 'RIGHT',
      nodes: ['hub', 'top', 'mid', 'bot'].map((id) => ({ id, label: id, role: 'backend' as const })),
      edges: [
        { id: 'e-bot', source: 'hub', target: 'bot' },
        { id: 'e-top', source: 'hub', target: 'top' },
        { id: 'e-mid', source: 'hub', target: 'mid' },
      ],
    }
    const boxes = new Map([
      ['hub', box(0, 100)],
      ['top', box(300, 0)],
      ['mid', box(300, 100)],
      ['bot', box(300, 200)],
    ])
    const r = computeRoutes(d, boxes, () => 'rounded')
    const startY = (id: string) => r.get(id)!.points[0].y
    expect(startY('e-top')).toBeLessThan(startY('e-mid'))
    expect(startY('e-mid')).toBeLessThan(startY('e-bot'))
    for (const route of r.values()) orthogonal(route.points)
  })

  it('edges fanning out the same way turn at different points, without crossing', () => {
    const d: IRDiagram = {
      id: 'f',
      title: 'f',
      type: 'architecture',
      direction: 'RIGHT',
      nodes: ['hub', 'a', 'b', 'c'].map((id) => ({ id, label: id, role: 'backend' as const })),
      edges: [
        { id: 'ha', source: 'hub', target: 'a' },
        { id: 'hb', source: 'hub', target: 'b' },
        { id: 'hc', source: 'hub', target: 'c' },
      ],
    }
    // all three targets below the hub, in one column
    const boxes = new Map([
      ['hub', box(0, 0)],
      ['a', box(300, 100)],
      ['b', box(300, 200)],
      ['c', box(300, 300)],
    ])
    const r = computeRoutes(d, boxes, () => 'rounded')
    const turnX = ['ha', 'hb', 'hc'].map((id) => r.get(id)!.points[1].x)
    expect(new Set(turnX).size).toBe(3)
    // upper port (to a) turns last, lower port (to c) turns first: nested, no crossings
    expect(turnX[0]).toBeGreaterThan(turnX[1])
    expect(turnX[1]).toBeGreaterThan(turnX[2])
    for (const x of turnX) {
      expect(x).toBeGreaterThan(100)
      expect(x).toBeLessThan(300)
    }
  })

  it('diamonds keep every edge on their vertex', () => {
    const d: IRDiagram = {
      id: 'p',
      title: 'p',
      type: 'workflow',
      direction: 'DOWN',
      nodes: [
        { id: 'g', label: 'g', role: 'decision' },
        { id: 'a', label: 'a', role: 'process' },
        { id: 'b', label: 'b', role: 'process' },
      ],
      edges: [
        { id: 'ga', source: 'g', target: 'a' },
        { id: 'gb', source: 'g', target: 'b' },
      ],
    }
    const boxes = new Map([
      ['g', box(100, 0, 120, 80)],
      ['a', box(0, 200)],
      ['b', box(250, 200)],
    ])
    const r = computeRoutes(d, boxes, (id) => (id === 'g' ? 'diamond' : 'rounded'))
    expect(r.get('ga')!.points[0]).toEqual({ x: 160, y: 80 })
    expect(r.get('gb')!.points[0]).toEqual({ x: 160, y: 80 })
  })
})

describe('routeEdge', () => {
  it('forward horizontal edge bends once in the middle', () => {
    const r = routeEdge(box(0, 0), box(300, 100), 'right', 'left')
    expect(r.points).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 125 },
      { x: 300, y: 125 },
    ])
  })

  it('aligned nodes get a single straight segment', () => {
    expect(routeEdge(box(0, 0), box(300, 0), 'right', 'left').points).toHaveLength(2)
  })

  it('back edges loop below both nodes instead of cutting through them', () => {
    const r = routeEdge(box(300, 0), box(0, 20), 'right', 'left')
    expect(r.points).toHaveLength(6)
    expect(Math.max(...r.points.map((p) => p.y))).toBeGreaterThan(70)
    orthogonal(r.points)
  })

  it('every direction routes from its source side to its target side', () => {
    for (const dir of ['RIGHT', 'LEFT', 'DOWN', 'UP'] as const) {
      const { source, target } = handleSides(dir)
      const far = dir === 'RIGHT' ? box(400, 0) : dir === 'LEFT' ? box(-400, 0) : dir === 'DOWN' ? box(0, 400) : box(0, -400)
      const r = routeEdge(box(0, 0), far, source, target)
      orthogonal(r.points)
      expect(r.points.length).toBeLessThanOrEqual(4)
    }
  })

  it('self loops leave and re-enter the same side', () => {
    const r = selfLoop(box(0, 0), 'right')
    expect(r.points[0].x).toBe(100)
    expect(r.points[r.points.length - 1].x).toBe(100)
    expect(r.points[1].x).toBeGreaterThan(100)
  })
})

describe('pointsToPath', () => {
  it('rounds corners but keeps the exact start and end', () => {
    const d = pointsToPath([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ])
    expect(d.startsWith('M0,0')).toBe(true)
    expect(d).toContain('Q50,0')
    expect(d.endsWith('L50,50')).toBe(true)
  })

  it('handles tiny segments without overshooting', () => {
    const d = pointsToPath([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ])
    expect(d).toBe('M0,0 L2,0 Q4,0 4,2 L4,4')
  })
})

describe('engine routes vs local fallback', () => {
  const d: IRDiagram = {
    id: 'r',
    title: 'r',
    type: 'architecture',
    direction: 'RIGHT',
    nodes: [
      { id: 'a', label: 'a', role: 'backend' },
      { id: 'b', label: 'b', role: 'backend' },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b' }],
  }
  const engine = {
    ab: {
      points: [
        { x: 100, y: 20 },
        { x: 200, y: 20 },
        { x: 200, y: 140 },
        { x: 300, y: 140 },
      ],
      label: { x: 200, y: 80 },
    },
  }

  it('uses the engine route while both ends still sit on their nodes', () => {
    const boxes = new Map([
      ['a', box(0, 0)],
      ['b', box(300, 120)],
    ])
    const r = computeRoutes(d, boxes, () => 'rounded', engine).get('ab')!
    expect(r.points).toEqual(engine.ab.points)
    expect(r.label).toEqual({ x: 200, y: 80 })
  })

  it('falls back to the local router once a node has moved', () => {
    const boxes = new Map([
      ['a', box(0, 0)],
      ['b', box(500, 400)], // dragged away
    ])
    const r = computeRoutes(d, boxes, () => 'rounded', engine).get('ab')!
    expect(r.points).not.toEqual(engine.ab.points)
    expect(r.points[r.points.length - 1]).toEqual({ x: 500, y: 425 })
  })

  it('rejects engine routes that touch a diamond anywhere but a vertex', () => {
    const boxes = new Map([
      ['a', box(0, 0)],
      ['b', box(300, 120)],
    ])
    // the engine route ends at (300,140): on the box border, but not a diamond vertex
    const r = computeRoutes(d, boxes, (id) => (id === 'b' ? 'diamond' : 'rounded'), engine).get('ab')!
    expect(r.points[r.points.length - 1]).toEqual({ x: 300, y: 145 })
  })

  it('accepts engine routes that end on a diamond vertex', () => {
    const boxes = new Map([
      ['a', box(0, 0)],
      ['b', box(300, 115)], // left vertex at (300, 140)
    ])
    const r = computeRoutes(d, boxes, (id) => (id === 'b' ? 'diamond' : 'rounded'), engine).get('ab')!
    expect(r.points).toEqual(engine.ab.points)
  })
})
