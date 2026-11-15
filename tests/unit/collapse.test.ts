import { describe, expect, it } from 'vitest'
import { HIDDEN_COUNT, visibleCount, visibleDiagram, visibleIdMap } from '../../src/shared/collapse'
import { applyRescan } from '../../src/shared/diff'
import { parseProject, serializeProject } from '../../src/shared/serialize'
import { layoutDiagram } from '../../src/renderer/src/layout'
import { mergeOverrides } from '../../src/renderer/src/layout/elk'
import type { CartographProject, IRDiagram } from '../../src/shared/ir'

const base = (): IRDiagram => ({
  id: 'm',
  title: 'm',
  type: 'architecture',
  nodes: [
    { id: 'g', label: 'libs/', role: 'group', collapsed: true, meta: { source: 'libs' } },
    { id: 'a', label: 'a', role: 'backend', parent: 'g', meta: { source: 'libs/a' } },
    { id: 'b', label: 'b', role: 'backend', parent: 'g', meta: { source: 'libs/b' } },
    { id: 'c', label: 'c', role: 'database', parent: 'g', meta: { source: 'libs/c' } },
    { id: 'app', label: 'app', role: 'frontend', meta: { source: 'app' } },
    { id: 'db', label: 'db', role: 'database' },
  ],
  edges: [
    { id: 'app->a', source: 'app', target: 'a', label: 'imports' },
    { id: 'app->b', source: 'app', target: 'b' },
    { id: 'a->b', source: 'a', target: 'b' },
    { id: 'c->db', source: 'c', target: 'db', label: 'sql' },
    { id: 'app->db', source: 'app', target: 'db' },
  ],
})

describe('visibleDiagram', () => {
  it('replaces a collapsed group with one box that stands for its members', () => {
    const v = visibleDiagram(base())
    expect(v.nodes.map((n) => n.id)).toEqual(['g', 'app', 'db'])
    const g = v.nodes[0]
    expect(g).toMatchObject({ role: 'backend', label: 'libs/', sublabel: '3 parts, collapsed' })
    expect(g.meta?.[HIDDEN_COUNT]).toBe('3')
    expect(visibleCount(base())).toBe(3)
  })

  it('re-points edges, merges duplicates and drops edges inside the group', () => {
    const v = visibleDiagram(base())
    const byId = Object.fromEntries(v.edges.map((e) => [e.id, e]))
    expect(Object.keys(byId).sort()).toEqual(['app->db', 'app=>g', 'g=>db'])
    expect(byId['app=>g'].label).toBe('2 links')
    expect(byId['g=>db'].label).toBe('sql')
  })

  it('is the identity when nothing is collapsed', () => {
    const d = base()
    d.nodes[0].collapsed = undefined
    expect(visibleDiagram(d)).toBe(d)
    expect(visibleIdMap(d).size).toBe(0)
  })

  it('lays out the visible diagram and keeps hidden nodes\' layout entries', async () => {
    const d = base()
    const laid = await layoutDiagram(visibleDiagram(d))
    expect(Object.keys(laid.positions).sort()).toEqual(['app', 'db', 'g'])
    const prev = { a: { x: 5, y: 6, pinned: true } }
    const next = mergeOverrides(laid, prev, new Set(visibleIdMap(d).keys()))
    expect(next.a).toEqual({ x: 5, y: 6, pinned: true })
    expect(next.g).toBeTruthy()
  })
})

describe('collapsed state in files and re-scans', () => {
  it('round-trips through the project file, and only on groups', () => {
    const p: CartographProject = { schema_version: 1, diagram: base(), layout: {} }
    const text = serializeProject(p)
    expect(text).toContain('"collapsed":true')
    expect(parseProject(text).value.diagram.nodes[0].collapsed).toBe(true)
    const bad = parseProject(JSON.stringify({ ...base(), nodes: [{ id: 'x', label: 'x', role: 'backend', collapsed: true }] })).value
    expect(bad.diagram.nodes[0].collapsed).toBeUndefined()
  })

  it("a re-scan keeps the viewer's choice of collapsed or expanded", () => {
    const current: CartographProject = { schema_version: 1, diagram: base(), layout: {} }
    const scanned = base()
    scanned.nodes[0].collapsed = undefined // the scanner would show it expanded now
    expect(applyRescan(current, scanned).diagram.nodes.find((n) => n.id === 'g')?.collapsed).toBe(true)
    const open = base()
    open.nodes[0].collapsed = undefined
    const scannedCollapsed = base()
    expect(applyRescan({ ...current, diagram: open }, scannedCollapsed).diagram.nodes.find((n) => n.id === 'g')?.collapsed).toBeUndefined()
  })
})
