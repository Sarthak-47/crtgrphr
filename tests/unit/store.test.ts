import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore, isDirty, freshId, contentKey } from '../../src/renderer/src/state/store'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import { emptyProject, type CartographProject } from '../../src/shared/ir'

const s = () => useStore.getState()
const sample = (): CartographProject => {
  const p = emptyProject()
  p.diagram = structuredClone(SAMPLES.webapp)
  return p
}

beforeEach(async () => {
  vi.useRealTimers()
  await s().loadProject(sample(), { filePath: null })
})

describe('freshId', () => {
  it('picks the smallest unused suffix', () => {
    expect(freshId('node', [])).toBe('node-1')
    expect(freshId('node', ['node-1', 'node-2', 'node-4'])).toBe('node-3')
  })
})

describe('loading and dirty tracking', () => {
  it('a freshly loaded map is clean, with empty history and a layout', () => {
    expect(isDirty(s())).toBe(false)
    expect(s().past).toEqual([])
    expect(Object.keys(s().laid!.positions)).toHaveLength(SAMPLES.webapp.nodes.length)
  })

  it('re-layout alone never makes the document dirty', async () => {
    await s().relayout()
    await s().reflow()
    expect(isDirty(s())).toBe(false)
  })

  it('an edit makes it dirty; undoing back makes it clean again', async () => {
    s().updateNode('api', { label: 'Gateway' })
    expect(isDirty(s())).toBe(true)
    await s().undo()
    expect(s().project.diagram.nodes.find((n) => n.id === 'api')!.label).toBe('API service')
    expect(isDirty(s())).toBe(false)
  })

  it('pinning a node counts as a change', () => {
    s().beginDrag()
    s().pinNode('users', 5, 5)
    expect(isDirty(s())).toBe(true)
  })

  it('markSaved makes the current content the clean baseline', () => {
    s().setTitle('Renamed')
    expect(isDirty(s())).toBe(true)
    s().markSaved('C:/maps/x.crtgrphr')
    expect(isDirty(s())).toBe(false)
    expect(s().filePath).toBe('C:/maps/x.crtgrphr')
  })

  it('contentKey ignores unpinned (machine) positions', () => {
    const p = sample()
    const a = contentKey({ ...p, layout: { db: { x: 1, y: 1, pinned: false } } })
    const b = contentKey({ ...p, layout: { db: { x: 900, y: 900, pinned: false } } })
    expect(a).toBe(b)
  })
})

describe('history', () => {
  it('a burst of typing in one field is a single undo step', () => {
    s().updateNode('api', { label: 'A' })
    s().updateNode('api', { label: 'Ap' })
    s().updateNode('api', { label: 'Api' })
    expect(s().past).toHaveLength(1)
  })

  it('typing in a different field starts a new step', () => {
    s().updateNode('api', { label: 'X' })
    s().updateNode('api', { sublabel: 'Y' })
    expect(s().past).toHaveLength(2)
  })

  it('edits after the coalesce window are separate steps', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    s().updateNode('api', { label: 'one' })
    vi.setSystemTime(Date.now() + 2000)
    s().updateNode('api', { label: 'two' })
    expect(s().past).toHaveLength(2)
  })

  it('a whole drag is one undo step that restores the unpinned node', async () => {
    const before = { ...s().laid!.positions.users }
    s().beginDrag()
    for (let i = 1; i <= 10; i++) s().pinNode('users', before.x + i * 10, before.y)
    expect(s().past).toHaveLength(1)
    expect(s().project.layout.users.pinned).toBe(true)
    await s().undo()
    expect(s().project.layout.users.pinned).toBe(false)
    expect(s().laid!.positions.users).toEqual(before)
  })

  it('redo re-applies an undone change', async () => {
    await s().deleteNode('cache')
    await s().undo()
    await s().redo()
    expect(s().project.diagram.nodes.some((n) => n.id === 'cache')).toBe(false)
  })
})

describe('editing', () => {
  it('new node ids never collide with ids from a loaded file', async () => {
    const p = sample()
    p.diagram.nodes.push({ id: 'node-1', label: 'From file', role: 'backend' })
    await s().loadProject(p)
    const id = await s().addNode()
    expect(id).toBe('node-2')
    expect(s().selection).toEqual({ kind: 'node', id: 'node-2' })
  })

  it('deleting a node removes its edges and its layout entry; undo restores both', async () => {
    const edgesBefore = s().project.diagram.edges.length
    await s().deleteNode('api')
    const d = s().project.diagram
    expect(d.nodes.some((n) => n.id === 'api')).toBe(false)
    expect(d.edges.some((e) => e.source === 'api' || e.target === 'api')).toBe(false)
    expect(s().project.layout.api).toBeUndefined()
    await s().undo()
    expect(s().project.diagram.edges).toHaveLength(edgesBefore)
  })

  it('deleteSelection deletes a selected edge', async () => {
    s().select({ kind: 'edge', id: 'e9' })
    await s().deleteSelection()
    expect(s().project.diagram.edges.some((e) => e.id === 'e9')).toBe(false)
    expect(s().selection).toBeNull()
  })

  it('addEdge ignores self-loops and duplicates', async () => {
    const n = s().project.diagram.edges.length
    await s().addEdge('api', 'api')
    await s().addEdge('users', 'cdn')
    expect(s().project.diagram.edges).toHaveLength(n)
    await s().addEdge('db', 'users')
    expect(s().project.diagram.edges).toHaveLength(n + 1)
  })

  it('reverseEdge flips direction, but refuses to create a duplicate', async () => {
    await s().reverseEdge('e1')
    expect(s().project.diagram.edges.find((e) => e.id === 'e1')).toMatchObject({ source: 'cdn', target: 'users' })
    await s().addEdge('web', 'cdn')
    await s().reverseEdge('e2') // e2 is cdn -> web; reversing it would duplicate the web -> cdn edge just added
    expect(s().project.diagram.edges.find((e) => e.id === 'e2')).toMatchObject({ source: 'cdn', target: 'web' })
    expect(s().status).toMatch(/already exists/)
  })

  it('updateEdge sets and clears fields', () => {
    s().updateEdge('e3', { label: 'gRPC', variant: 'dashed' })
    expect(s().project.diagram.edges.find((e) => e.id === 'e3')).toMatchObject({ label: 'gRPC', variant: 'dashed' })
    s().updateEdge('e3', { label: undefined })
    expect('label' in s().project.diagram.edges.find((e) => e.id === 'e3')!).toBe(false)
  })

  it('renaming resizes the node immediately, before the debounced re-layout', () => {
    const w = s().laid!.sizes.api.width
    s().updateNode('api', { label: 'A much, much longer service name' })
    expect(s().laid!.sizes.api.width).toBeGreaterThan(w)
  })

  it('undo drops a selection that no longer exists', async () => {
    const id = await s().addNode()
    expect(s().selection?.id).toBe(id)
    await s().undo()
    expect(s().selection).toBeNull()
  })

  it('changing direction clears pins and asks the canvas to refit', async () => {
    s().beginDrag()
    s().pinNode('users', 0, 0)
    const fit = s().fitRequest
    await s().setDirection('DOWN')
    expect(Object.values(s().project.layout).some((p) => p.pinned)).toBe(false)
    expect(s().fitRequest).toBe(fit + 1)
  })
})

describe('layout concurrency', () => {
  it('overlapping layouts settle on the latest graph', async () => {
    const first = s().relayout()
    const p = s().project
    useStore.setState({
      project: { ...p, diagram: { ...p.diagram, nodes: [...p.diagram.nodes, { id: 'late', label: 'Late', role: 'backend' }] } },
    })
    const second = s().relayout()
    await Promise.all([first, second])
    expect(s().laid!.positions.late).toBeDefined()
    expect(s().laying).toBe(false)
  })
})

describe('re-scan', () => {
  const scanned = (labels: Record<string, string>): CartographProject => {
    const p = emptyProject()
    p.diagram = {
      id: 'repo',
      title: 'repo',
      type: 'architecture',
      direction: 'RIGHT',
      nodes: Object.entries(labels).map(([id, label]) => ({ id, label, role: 'backend' as const, meta: { source: `src/${id}` } })),
      edges: [{ id: 'api->db', source: 'api', target: 'db' }],
      origin: { kind: 'repo', root: 'C:/repo' },
    }
    return p
  }

  it('an unchanged scan reports "up to date" and changes nothing', async () => {
    await s().loadProject(scanned({ api: 'api', db: 'db' }))
    const ok = await s().beginRescan(scanned({ api: 'api', db: 'db' }).diagram)
    expect(ok).toBe(false)
    expect(s().rescan).toBeNull()
    expect(s().status).toMatch(/up to date/)
  })

  it('previews without touching the project, then apply is one undoable step', async () => {
    await s().loadProject(scanned({ api: 'api', db: 'db', web: 'web' }))
    const before = structuredClone(s().project.diagram)
    const next = scanned({ api: 'api', db: 'db', jobs: 'jobs' }).diagram
    expect(await s().beginRescan(next)).toBe(true)
    const r = s().rescan!
    expect(r.status.get('jobs')).toBe('added')
    expect(r.status.get('web')).toBe('removed')
    // the ghost of the removed node is still drawn in the preview, with a position
    expect(r.preview.nodes.map((n) => n.id)).toContain('web')
    expect(s().laid!.positions.web).toBeDefined()
    expect(s().project.diagram).toEqual(before) // untouched until applied

    await s().applyRescanPreview()
    expect(s().rescan).toBeNull()
    expect(s().project.diagram.nodes.map((n) => n.id).sort()).toEqual(['api', 'db', 'jobs'])
    expect(isDirty(s())).toBe(true)
    await s().undo()
    expect(s().project.diagram.nodes.map((n) => n.id).sort()).toEqual(['api', 'db', 'web'])
  })

  it('discard drops the preview', async () => {
    await s().loadProject(scanned({ api: 'api', db: 'db' }))
    await s().beginRescan(scanned({ api: 'api', db: 'db', x: 'x' }).diagram)
    await s().discardRescan()
    expect(s().rescan).toBeNull()
    expect(s().project.diagram.nodes).toHaveLength(2)
    expect(s().laid!.positions.x).toBeUndefined()
  })

  it('editing a scanned node in the inspector is kept by a later re-scan', async () => {
    await s().loadProject(scanned({ api: 'api', db: 'db' }))
    s().updateNode('api', { label: 'Public API' })
    expect(s().project.diagram.nodes[0].meta!.edited).toBe('label')
    await s().beginRescan(scanned({ api: 'api', db: 'db', q: 'q' }).diagram)
    await s().applyRescanPreview()
    expect(s().project.diagram.nodes.find((n) => n.id === 'api')!.label).toBe('Public API')
  })
})
