import { beforeEach, describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { layoutDiagram } from '../../src/renderer/src/layout'
import { groupBoxes, GROUP_HEADER, GROUP_PAD } from '../../src/renderer/src/render/groups'
import { nodeBoxes } from '../../src/renderer/src/canvas/toReactFlow'
import { diagramToSvg } from '../../src/renderer/src/export/svg'
import { onBorder } from '../../src/renderer/src/render/geometry'
import { useStore, pruneGroups, selectedNodeIds } from '../../src/renderer/src/state/store'
import { scanRepository } from '../../src/main/repo-scan'
import { sanitizeDiagram } from '../../src/shared/serialize'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import { emptyProject, type IRDiagram } from '../../src/shared/ir'
import { assertWellFormed } from './helpers/xml'

const grouped = (): IRDiagram => ({
  id: 'g',
  title: 'Grouped',
  type: 'architecture',
  direction: 'RIGHT',
  nodes: [
    { id: 'edge', label: 'Edge', role: 'group' },
    { id: 'core', label: 'Core', role: 'group' },
    { id: 'cdn', label: 'CDN', role: 'cloud', parent: 'edge' },
    { id: 'web', label: 'Web', role: 'frontend', parent: 'edge' },
    { id: 'api', label: 'API', role: 'backend', parent: 'core' },
    { id: 'worker', label: 'Worker', role: 'backend', parent: 'core' },
    { id: 'db', label: 'DB', role: 'database' },
  ],
  edges: [
    { id: 'e1', source: 'cdn', target: 'web' },
    { id: 'e2', source: 'web', target: 'api', label: 'REST' },
    { id: 'e3', source: 'api', target: 'worker' },
    { id: 'e4', source: 'worker', target: 'db' },
  ],
})

const inside = (outer: { x: number; y: number; width: number; height: number }, inner: typeof outer) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('group layout', () => {
  it('places every member inside its group box, and groups do not overlap each other or outsiders', async () => {
    const d = grouped()
    const l = await layoutDiagram(d)
    const boxes = nodeBoxes(d, l)
    const groups = groupBoxes(d, boxes)
    expect(groups.map((g) => g.id).sort()).toEqual(['core', 'edge'])
    for (const g of groups) for (const m of g.members) expect(inside(g, boxes.get(m)!), `${m} in ${g.id}`).toBe(true)
    expect(overlaps(groups[0], groups[1])).toBe(false)
    for (const g of groups) expect(overlaps(g, boxes.get('db')!), `db vs ${g.id}`).toBe(false)
    // group nodes themselves get no position: their box is derived
    expect(l.positions.edge).toBeUndefined()
  })

  it('edges inside and across groups get engine routes that end on their nodes', async () => {
    const d = grouped()
    const l = await layoutDiagram(d)
    const boxes = nodeBoxes(d, l)
    for (const e of d.edges) {
      const r = l.routes![e.id]
      expect(r, e.id).toBeDefined()
      expect(onBorder(boxes.get(e.source)!, r.points[0]), `${e.id} start`).toBe(true)
      expect(onBorder(boxes.get(e.target)!, r.points[r.points.length - 1]), `${e.id} end`).toBe(true)
    }
  })

  it('the group box follows a member that is dragged away', async () => {
    const d = grouped()
    const l = await layoutDiagram(d, { db: { x: 0, y: 0, pinned: false } })
    const boxes = nodeBoxes(d, l)
    const before = groupBoxes(d, boxes).find((g) => g.id === 'core')!
    boxes.set('api', { ...boxes.get('api')!, x: before.x + 2000 })
    const after = groupBoxes(d, boxes).find((g) => g.id === 'core')!
    expect(after.width).toBeGreaterThan(before.width + 1500)
    expect(after.x + after.width).toBe(boxes.get('api')!.x + boxes.get('api')!.width + GROUP_PAD)
    expect(after.y).toBe(Math.min(boxes.get('api')!.y, boxes.get('worker')!.y) - GROUP_HEADER)
  })

  it('empty groups and sequence diagrams draw no boundaries', async () => {
    const d = { ...grouped(), nodes: [...grouped().nodes, { id: 'empty', label: 'Empty', role: 'group' as const }] }
    const l = await layoutDiagram(d)
    expect(groupBoxes(d, nodeBoxes(d, l)).map((g) => g.id)).not.toContain('empty')
    const s = SAMPLES.cacheMiss
    expect(groupBoxes(s, nodeBoxes(s, await layoutDiagram(s)))).toEqual([])
  })

  it('the SVG export draws each group behind its members, labelled', async () => {
    const d = grouped()
    const { svg } = diagramToSvg(d, await layoutDiagram(d), 'dark')
    assertWellFormed(svg)
    expect(svg.match(/data-group=/g)).toHaveLength(2)
    expect(svg).toContain('>EDGE</text>')
    expect(svg.indexOf('data-group="core"')).toBeLessThan(svg.indexOf('data-node="api"'))
  })
})

describe('store: groups and multi-select', () => {
  const s = () => useStore.getState()
  beforeEach(async () => {
    const p = emptyProject()
    p.diagram = grouped()
    await s().loadProject(p)
  })

  it('selectNodes / toggleNode build a multi-selection; one node collapses to a single selection', () => {
    s().selectNodes(['api', 'db'])
    expect(s().multi).toEqual(['api', 'db'])
    expect(selectedNodeIds(s())).toEqual(['api', 'db'])
    s().toggleNode('db')
    expect(s().multi).toEqual([])
    expect(s().selection).toEqual({ kind: 'node', id: 'api' })
    s().toggleNode('web')
    expect(selectedNodeIds(s())).toEqual(['api', 'web'])
    s().select(null)
    expect(selectedNodeIds(s())).toEqual([])
  })

  it('groupSelection wraps the selection in a new group, as one undo step', async () => {
    s().selectNodes(['db'])
    const steps = s().past.length
    await s().groupSelection()
    const g = s().project.diagram.nodes.find((n) => n.role === 'group' && n.id.startsWith('group-'))!
    expect(s().project.diagram.nodes.find((n) => n.id === 'db')!.parent).toBe(g.id)
    expect(s().selection).toEqual({ kind: 'node', id: g.id })
    expect(s().past.length).toBe(steps + 1)
    await s().undo()
    expect(s().project.diagram.nodes.some((n) => n.id === g.id)).toBe(false)
  })

  it('regrouping moves nodes and removes groups left empty', async () => {
    s().selectNodes(['cdn', 'web'])
    await s().groupSelection()
    const ids = s().project.diagram.nodes.map((n) => n.id)
    expect(ids).not.toContain('edge') // its members moved, so it was pruned
  })

  it('ungroup keeps the members', async () => {
    await s().ungroup('core')
    const d = s().project.diagram
    expect(d.nodes.some((n) => n.id === 'core')).toBe(false)
    expect(d.nodes.find((n) => n.id === 'api')!.parent).toBeUndefined()
    expect(d.nodes.find((n) => n.id === 'worker')).toBeDefined()
  })

  it('setParent moves a node between groups and out of any group', async () => {
    await s().setParent(['db'], 'core')
    expect(s().project.diagram.nodes.find((n) => n.id === 'db')!.parent).toBe('core')
    await s().setParent(['cdn', 'web'], undefined)
    expect(s().project.diagram.nodes.some((n) => n.id === 'edge')).toBe(false)
    await s().setParent(['db'], 'not-a-group')
    expect(s().project.diagram.nodes.find((n) => n.id === 'db')!.parent).toBe('core')
  })

  it('bulk role change and bulk delete are single undo steps', async () => {
    const steps = s().past.length
    await s().updateNodes(['api', 'worker'], { role: 'service' })
    expect(s().project.diagram.nodes.filter((n) => n.role === 'service').map((n) => n.id).sort()).toEqual(['api', 'worker'])
    s().selectNodes(['api', 'worker'])
    await s().deleteSelection()
    const d = s().project.diagram
    expect(d.nodes.some((n) => n.id === 'core')).toBe(false) // emptied group pruned
    expect(d.edges.map((e) => e.id)).toEqual(['e1'])
    expect(s().past.length).toBe(steps + 2)
    await s().undo()
    expect(s().project.diagram.nodes.some((n) => n.id === 'api')).toBe(true)
  })

  it('pruneGroups leaves groups that still have members', () => {
    expect(pruneGroups(grouped())).toEqual(grouped())
  })
})

describe('scanner: monorepo groups', () => {
  it('puts packages in one group per workspace folder', async () => {
    const d = await scanRepository(join(resolve(__dirname, '../fixtures/repos'), 'npm-workspaces'))
    expect(sanitizeDiagram(d).fixes).toEqual([])
    const groups = d.nodes.filter((n) => n.role === 'group')
    expect(groups.map((g) => g.label).sort()).toEqual(['apps/', 'packages/'])
    const parentOf = (id: string) => d.nodes.find((n) => n.id === id)!.parent
    expect(parentOf('acme-web')).toBe('group-apps')
    expect(parentOf('acme-admin')).toBe('group-apps')
    expect(parentOf('acme-ui')).toBe('group-packages')
    expect(parentOf('postgresql')).toBeUndefined() // infra stays outside
  })

  it('a monorepo whose packages share one folder gets no groups', async () => {
    const d = await scanRepository(join(resolve(__dirname, '../fixtures/repos'), 'pnpm-workspace'))
    expect(d.nodes.some((n) => n.role === 'group')).toBe(false)
  })
})
