import { describe, expect, it } from 'vitest'
import { layoutSequence, HEADER_HEIGHT } from '../../src/renderer/src/layout/sequence'
import { layoutDiagram } from '../../src/renderer/src/layout'
import { sequenceMessageRoutes } from '../../src/renderer/src/render/sequence'
import { layerConstraints } from '../../src/renderer/src/layout/elk'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import type { IRDiagram } from '../../src/shared/ir'

const seq = (edges: IRDiagram['edges'], labels = true): IRDiagram => ({
  id: 's',
  title: 's',
  type: 'sequence',
  direction: 'RIGHT',
  nodes: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), role: 'backend' as const })),
  edges: labels ? edges : edges.map(({ label: _l, ...e }) => e),
})

describe('sequence layout', () => {
  it('columns follow node order, left to right, all on the header row', () => {
    const l = layoutSequence(SAMPLES.cacheMiss)
    const xs = SAMPLES.cacheMiss.nodes.map((n) => l.positions[n.id].x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    for (const n of SAMPLES.cacheMiss.nodes) expect(l.positions[n.id].y).toBe(0)
  })

  it('messages are rows in edge order, below the headers, between the right lifelines', () => {
    const d = seq([
      { id: 'm1', source: 'a', target: 'b', label: 'call' },
      { id: 'm2', source: 'b', target: 'c' },
      { id: 'm3', source: 'c', target: 'a', label: 'reply', variant: 'dashed' },
    ])
    const l = layoutSequence(d)
    const m = l.sequence.messages
    expect(m.map((x) => x.id)).toEqual(['m1', 'm2', 'm3'])
    expect(m[0].y).toBeGreaterThan(HEADER_HEIGHT)
    expect(m[0].y).toBeLessThan(m[1].y)
    expect(m[1].y).toBeLessThan(m[2].y)
    const center = (id: string) => l.positions[id].x + l.sizes[id].width / 2
    expect(m[2].x1).toBe(center('c'))
    expect(m[2].x2).toBe(center('a'))
    // lifelines run past the last message
    for (const lf of l.sequence.lifelines) expect(lf.bottom).toBeGreaterThan(m[2].y)
  })

  it('columns widen so a long label fits between the lifelines it spans', () => {
    const short = layoutSequence(seq([{ id: 'm', source: 'a', target: 'b', label: 'x' }]))
    const long = layoutSequence(seq([{ id: 'm', source: 'a', target: 'b', label: 'a very long message label that needs room' }]))
    const gap = (l: typeof short) => l.sequence.lifelines[1].x - l.sequence.lifelines[0].x
    expect(gap(long)).toBeGreaterThan(gap(short))
    expect(gap(long)).toBeGreaterThan('a very long message label that needs room'.length * 6)
  })

  it('self messages loop on their own lifeline and take a taller row', () => {
    const d = seq([
      { id: 's1', source: 'b', target: 'b', label: 'retry' },
      { id: 'm2', source: 'a', target: 'b' },
    ])
    const l = layoutSequence(d)
    expect(l.sequence.messages[0].self).toBe(true)
    const r = sequenceMessageRoutes(d, l.sequence).get('s1')!
    expect(r.points[0].x).toBe(l.sequence.messages[0].x1)
    expect(r.points[1].x).toBeGreaterThan(r.points[0].x)
    expect(l.sequence.messages[1].y - l.sequence.messages[0].y).toBeGreaterThan(52)
  })

  it('the dispatcher uses the sequence layout only for sequence diagrams', async () => {
    expect((await layoutDiagram(SAMPLES.cacheMiss)).sequence).toBeDefined()
    expect((await layoutDiagram(SAMPLES.webapp)).sequence).toBeUndefined()
  })

  it('handles a sequence with no messages', () => {
    const l = layoutSequence(seq([]))
    expect(l.sequence.messages).toEqual([])
    expect(l.sequence.lifelines).toHaveLength(3)
  })
})

describe('per-type layering', () => {
  it('workflow: start terminals first, end terminals last', () => {
    const c = layerConstraints(SAMPLES.deploy)
    expect(c.get('start')).toBe('FIRST')
    expect(c.get('done')).toBe('LAST')
    expect(c.get('fail')).toBe('LAST')
    expect(c.has('gate')).toBe(false) // only terminals are constrained
  })

  it('lifecycle: the idle start state leads, done ends', () => {
    const c = layerConstraints(SAMPLES.agentRun)
    expect(c.get('idle')).toBe('FIRST')
    expect(c.get('done')).toBe('LAST')
  })

  it('dataflow: sources start the flow, sinks end it', () => {
    const c = layerConstraints(SAMPLES.analytics)
    expect(c.get('sdk')).toBe('FIRST')
    expect(c.get('bi')).toBe('LAST')
  })

  it('architecture: no layer rules', () => {
    expect(layerConstraints(SAMPLES.webapp).size).toBe(0)
  })

  it('end terminals actually land in the last layer', async () => {
    const l = await layoutDiagram(SAMPLES.deploy)
    const maxY = Math.max(...Object.values(l.positions).map((p) => p.y))
    expect(l.positions.done.y).toBe(maxY)
    expect(l.positions.fail.y).toBe(maxY)
    const minY = Math.min(...Object.values(l.positions).map((p) => p.y))
    expect(l.positions.start.y).toBe(minY)
  })
})
