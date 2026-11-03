import { describe, expect, it } from 'vitest'
import { applyRescan, diffDiagrams, diffIsEmpty, diffSummary, isScannedEdge, markEdited } from '../../src/shared/diff'
import { SCHEMA_VERSION, type CartographProject, type IRDiagram, type IRNode } from '../../src/shared/ir'

const scanned = (id: string, label = id, extra: Partial<IRNode> = {}): IRNode => ({ id, label, role: 'backend', meta: { source: `src/${id}` }, ...extra })
const e = (s: string, t: string, label?: string) => ({ id: `${s}->${t}`, source: s, target: t, ...(label ? { label } : {}) })

const base = (): IRDiagram => ({
  id: 'repo',
  title: 'My title',
  type: 'architecture',
  direction: 'RIGHT',
  nodes: [scanned('api'), scanned('db', 'db', { role: 'database' }), scanned('web')],
  edges: [e('api', 'db', '3 imports'), e('web', 'api')],
  origin: { kind: 'repo', root: 'C:/repo', scannedAt: '2026-01-01T00:00:00Z' },
})
const project = (d: IRDiagram): CartographProject => ({ schema_version: SCHEMA_VERSION, diagram: d, layout: {} })

describe('diffDiagrams', () => {
  it('an identical scan has no changes', () => {
    const d = diffDiagrams(base(), base())
    expect(diffIsEmpty(d)).toBe(true)
    expect(diffSummary(d)).toBe('no changes')
  })

  it('finds added, removed and changed nodes and edges', () => {
    const next = base()
    next.nodes = [scanned('api', 'api', { sublabel: 'Fastify' }), scanned('db', 'db', { role: 'database' }), scanned('jobs')]
    next.edges = [e('api', 'db', '5 imports'), e('jobs', 'db')]
    const d = diffDiagrams(base(), next)
    expect(d.addedNodes.map((n) => n.id)).toEqual(['jobs'])
    expect(d.removedNodes.map((n) => n.id)).toEqual(['web'])
    expect(d.changedNodes.map((c) => [c.after.id, c.fields])).toEqual([['api', ['sublabel']]])
    expect(d.addedEdges.map((x) => x.id)).toEqual(['jobs->db'])
    expect(d.removedEdges.map((x) => x.id)).toEqual(['web->api'])
    expect(d.changedEdges.map((c) => [c.after.id, c.fields])).toEqual([['api->db', ['label']]])
    expect(diffSummary(d)).toBe('2 added, 2 removed, 2 changed')
  })

  it('ignores hand-made nodes and edges, and fields the user edited', () => {
    const cur = base()
    cur.nodes.push({ id: 'note', label: 'My note', role: 'external' })
    cur.edges.push({ id: 'edge-1', source: 'note', target: 'api' })
    cur.nodes[0] = markEdited({ ...cur.nodes[0], label: 'Public API' }, ['label'])
    const d = diffDiagrams(cur, base())
    expect(diffIsEmpty(d)).toBe(true)
  })
})

describe('applyRescan', () => {
  it('keeps hand-made nodes/edges, user edits and surviving pins', () => {
    const cur = base()
    cur.nodes.push({ id: 'note', label: 'My note', role: 'external' })
    cur.edges.push({ id: 'edge-1', source: 'note', target: 'api' })
    cur.edges.push({ id: 'edge-2', source: 'note', target: 'web' }) // web is about to disappear
    cur.nodes[0] = markEdited({ ...cur.nodes[0], label: 'Public API' }, ['label'])
    const p = project(cur)
    p.layout = { api: { x: 1, y: 2, pinned: true }, web: { x: 3, y: 4, pinned: true }, db: { x: 9, y: 9, pinned: false } }

    const next = base()
    next.nodes = [scanned('api', 'api', { sublabel: 'Fastify' }), scanned('db', 'db', { role: 'database' }), scanned('jobs')]
    next.edges = [e('api', 'db', '5 imports'), e('jobs', 'db')]
    next.origin = { kind: 'repo', root: 'C:/repo', scannedAt: '2026-02-02T00:00:00Z' }

    const out = applyRescan(p, next)
    const ids = out.diagram.nodes.map((n) => n.id)
    expect(ids).toEqual(['api', 'db', 'jobs', 'note'])
    const api = out.diagram.nodes[0]
    expect(api.label).toBe('Public API') // user's edit survives
    expect(api.sublabel).toBe('Fastify') // scanner's new info arrives
    expect(api.meta).toEqual({ source: 'src/api', edited: 'label' })
    expect(out.diagram.edges.map((x) => x.id)).toEqual(['api->db', 'jobs->db', 'edge-1'])
    expect(out.layout).toEqual({ api: { x: 1, y: 2, pinned: true } })
    expect(out.diagram.title).toBe('My title')
    expect(out.diagram.origin!.scannedAt).toBe('2026-02-02T00:00:00Z')
  })

  it('a hand-made node whose id the scan now also produces is kept as the user made it', () => {
    const cur = base()
    cur.nodes.push({ id: 'jobs', label: 'My jobs', role: 'process' })
    const next = base()
    next.nodes.push(scanned('jobs'))
    const out = applyRescan(project(cur), next)
    expect(out.diagram.nodes.find((n) => n.id === 'jobs')).toEqual({ id: 'jobs', label: 'My jobs', role: 'process' })
  })
})

describe('helpers', () => {
  it('isScannedEdge uses the scanner id scheme', () => {
    expect(isScannedEdge(e('a', 'b'))).toBe(true)
    expect(isScannedEdge({ id: 'edge-3', source: 'a', target: 'b' })).toBe(false)
    expect(isScannedEdge({ id: 'a->b', source: 'b', target: 'a' })).toBe(false) // reversed by the user
  })

  it('markEdited only marks scanned nodes and known fields', () => {
    expect(markEdited({ id: 'x', label: 'x', role: 'backend' }, ['label']).meta).toBeUndefined()
    expect(markEdited(scanned('x'), ['label', 'bogus']).meta!.edited).toBe('label')
    expect(markEdited(markEdited(scanned('x'), ['role']), ['label']).meta!.edited).toBe('label,role')
  })
})
