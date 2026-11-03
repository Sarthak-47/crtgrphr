import { describe, expect, it } from 'vitest'
import { layout, mergeOverrides } from '../../src/renderer/src/layout/elk'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import type { IRDiagram } from '../../src/shared/ir'

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function boxes(d: IRDiagram, l: Awaited<ReturnType<typeof layout>>) {
  return d.nodes.map((n) => ({ id: n.id, x: l.positions[n.id].x, y: l.positions[n.id].y, w: l.sizes[n.id].width, h: l.sizes[n.id].height }))
}

describe('ELK layout', () => {
  it('places every node of every sample, with no overlaps', async () => {
    for (const d of Object.values(SAMPLES)) {
      const l = await layout(d)
      const b = boxes(d, l)
      expect(b).toHaveLength(d.nodes.length)
      for (let i = 0; i < b.length; i++)
        for (let j = i + 1; j < b.length; j++) expect(overlaps(b[i], b[j]), `${d.id}: ${b[i].id} vs ${b[j].id}`).toBe(false)
    }
  })

  it('flows left-to-right for RIGHT and top-to-bottom for DOWN', async () => {
    const arch = await layout(SAMPLES.webapp)
    expect(arch.positions.users.x).toBeLessThan(arch.positions.api.x)
    const wf = await layout(SAMPLES.deploy)
    expect(wf.positions.start.y).toBeLessThan(wf.positions.done.y)
  })

  it('starts cyclic lifecycles at their real source node', async () => {
    const l = await layout(SAMPLES.agentRun)
    const minY = Math.min(...Object.values(l.positions).map((p) => p.y))
    expect(l.positions.idle.y).toBe(minY)
  })

  it('keeps pinned nodes exactly where the user put them', async () => {
    const pins = { users: { x: -500, y: 900, pinned: true } }
    const l = await layout(SAMPLES.webapp, pins)
    expect(l.positions.users).toEqual({ x: -500, y: 900 })
    // other nodes still get positions
    expect(Object.keys(l.positions)).toHaveLength(SAMPLES.webapp.nodes.length)
  })

  it('mergeOverrides keeps pins and refreshes unpinned positions', async () => {
    const prev = {
      users: { x: -500, y: 900, pinned: true },
      db: { x: 99999, y: 99999, pinned: false },
    }
    const l = await layout(SAMPLES.webapp, prev)
    const merged = mergeOverrides(l, prev)
    expect(merged.users).toEqual(prev.users)
    expect(merged.db.pinned).toBe(false)
    expect(merged.db.x).toBe(l.positions.db.x)
    expect(Object.keys(merged).sort()).toEqual(SAMPLES.webapp.nodes.map((n) => n.id).sort())
  })

  it('handles an empty diagram', async () => {
    const l = await layout({ ...SAMPLES.webapp, nodes: [], edges: [] })
    expect(l.positions).toEqual({})
  })
})
