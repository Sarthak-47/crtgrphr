import { describe, expect, it } from 'vitest'
import { parseProject, sanitizeDiagram, serializeProject } from '../../src/shared/serialize'
import { SCHEMA_VERSION, type CartographProject } from '../../src/shared/ir'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'

const project = (): CartographProject => ({
  schema_version: SCHEMA_VERSION,
  diagram: structuredClone(SAMPLES.webapp),
  layout: { users: { x: 10.123, y: -40, pinned: true }, db: { x: 300, y: 120, pinned: false } },
})

describe('serializeProject / parseProject', () => {
  it('round-trips a project exactly, including pins', () => {
    const p = project()
    const { value, fixes } = parseProject(serializeProject(p))
    expect(fixes).toEqual([])
    expect(value.diagram).toEqual(p.diagram)
    expect(value.layout.users).toEqual({ x: 10.12, y: -40, pinned: true }) // rounded to 2 dp
    expect(value.layout.db).toEqual({ x: 300, y: 120, pinned: false })
  })

  it('round-trips every sample diagram type', () => {
    for (const d of Object.values(SAMPLES)) {
      const p: CartographProject = { schema_version: SCHEMA_VERSION, diagram: structuredClone(d), layout: {} }
      expect(parseProject(serializeProject(p)).value.diagram).toEqual(d)
    }
  })

  it('is deterministic and diff-friendly: one node per line, sorted layout', () => {
    const text = serializeProject(project())
    expect(serializeProject(project())).toBe(text)
    const lines = text.split('\n')
    for (const n of SAMPLES.webapp.nodes) expect(lines.filter((l) => l.includes(`"id":"${n.id}"`))).toHaveLength(1)
    const layoutLines = lines.filter((l) => /^ {4}"[^"]+": \{"x"/.test(l))
    expect(layoutLines.map((l) => l.trim().split('"')[1])).toEqual(['db', 'users'])
  })

  it('changing one node label changes exactly one line', () => {
    const a = project()
    const b = project()
    b.diagram.nodes[2].label = 'Renamed'
    const la = serializeProject(a).split('\n')
    const lb = serializeProject(b).split('\n')
    expect(la.length).toBe(lb.length)
    expect(la.filter((l, i) => l !== lb[i])).toHaveLength(1)
  })

  it('accepts a bare diagram (agent JSON) as a project', () => {
    const { value } = parseProject(JSON.stringify(SAMPLES.deploy))
    expect(value.diagram).toEqual(SAMPLES.deploy)
    expect(value.layout).toEqual({})
  })

  it('rejects non-JSON with a readable error', () => {
    expect(() => parseProject('not json {')).toThrow(/Not a valid JSON file/)
  })

  it('drops layout entries for nodes that no longer exist and non-finite numbers', () => {
    const text = JSON.stringify({
      diagram: { nodes: [{ id: 'a', label: 'A', role: 'backend' }], edges: [] },
      layout: { a: { x: 1, y: 2, pinned: true }, ghost: { x: 0, y: 0, pinned: true }, bad: { x: 'nope', y: 0 } },
    })
    expect(parseProject(text).value.layout).toEqual({ a: { x: 1, y: 2, pinned: true } })
  })

  it('flags files written by a newer schema', () => {
    const { fixes } = parseProject(JSON.stringify({ schema_version: SCHEMA_VERSION + 1, diagram: { nodes: [], edges: [] } }))
    expect(fixes.join()).toMatch(/newer than this app/)
  })
})

describe('sanitizeDiagram', () => {
  it('leaves a clean diagram untouched', () => {
    const { value, fixes } = sanitizeDiagram(SAMPLES.webapp)
    expect(fixes).toEqual([])
    expect(value).toEqual(SAMPLES.webapp)
  })

  it('repairs every class of malformed input without throwing', () => {
    const { value, fixes } = sanitizeDiagram({
      type: 'nonsense',
      nodes: [
        { id: 'a', label: 'A', role: 'backend' },
        { id: 'a', label: 'dupe', role: 'database' },
        { label: 'no id' },
        { id: 'b', role: 'wizard', parent: 'missing-group' },
        null,
        'garbage',
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e1', source: 'b', target: 'a', variant: 'sparkly' },
        { source: 'a', target: 'ghost' },
        { target: 'a' },
        { source: 'a-2', target: 'b' },
      ],
    })
    expect(value.type).toBe('architecture')
    expect(value.nodes.map((n) => n.id)).toEqual(['a', 'a-2', 'node-3', 'b'])
    expect(value.nodes[3]).toEqual({ id: 'b', label: 'b', role: 'backend' })
    expect(value.edges.map((e) => e.id)).toEqual(['e1', 'e1-2', 'a-2->b'])
    expect(value.edges[1].variant).toBeUndefined()
    expect(fixes).toEqual([
      'unknown diagram type "nonsense", used architecture',
      '2 node ids missing or duplicated, renamed',
      '1 unknown role, used backend',
      '1 parent reference to missing groups removed',
      '2 edges pointing at missing nodes dropped',
    ])
  })

  it('handles completely empty or non-object input', () => {
    for (const input of [undefined, null, 42, 'x', []]) {
      const { value } = sanitizeDiagram(input)
      expect(value.nodes).toEqual([])
      expect(value.edges).toEqual([])
      expect(value.title).toBe('Untitled map')
    }
  })
})

describe('origin', () => {
  const withOrigin = (root: string): CartographProject => {
    const p = project()
    p.diagram.origin = { kind: 'repo', root, scannedAt: '2026-11-04T10:00:00.000Z' }
    return p
  }

  it('is written relative to the file and resolved back on open', () => {
    const p = withOrigin('C:/code/shop')
    const text = serializeProject(p, { filePath: 'C:/code/shop/docs/arch.crtgrphr' })
    expect(text).toContain('"origin": {"kind":"repo","root":"..","scannedAt":"2026-11-04T10:00:00.000Z"},')
    const back = parseProject(text, { filePath: 'C:/code/shop/docs/arch.crtgrphr' }).value
    expect(back.diagram.origin).toEqual({ kind: 'repo', root: 'C:/code/shop', scannedAt: '2026-11-04T10:00:00.000Z' })
  })

  it('a map stored inside the repo root records "."', () => {
    const text = serializeProject(withOrigin('C:/code/shop'), { filePath: 'C:/code/shop/map.crtgrphr' })
    expect(text).toContain('"root":"."')
  })

  it('stays absolute when no relative path exists (other drive) or no file is known', () => {
    expect(serializeProject(withOrigin('D:/repo'), { filePath: 'C:/maps/a.crtgrphr' })).toContain('"root":"D:/repo"')
    expect(serializeProject(withOrigin('D:/repo'))).toContain('"root":"D:/repo"')
  })

  it('moving the project file together with the repo keeps the origin valid', () => {
    const text = serializeProject(withOrigin('C:/code/shop'), { filePath: 'C:/code/shop/map.crtgrphr' })
    const moved = parseProject(text, { filePath: 'E:/backup/shop/map.crtgrphr' }).value
    expect(moved.diagram.origin!.root).toBe('E:/backup/shop')
  })

  it('drops an unrecognized origin with a note', () => {
    const { value, fixes } = parseProject(JSON.stringify({ diagram: { nodes: [], edges: [], origin: { kind: 'ftp', root: 'x' } } }))
    expect(value.diagram.origin).toBeUndefined()
    expect(fixes).toContain('unrecognized origin dropped')
  })
})

describe('limits on what a file can contain', () => {
  it('keeps at most LIMITS.nodes nodes and LIMITS.edges edges, and says so', async () => {
    const { LIMITS } = await import('../../src/shared/serialize')
    const nodes = Array.from({ length: LIMITS.nodes + 50 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, role: 'backend' }))
    const edges = Array.from({ length: LIMITS.edges + 10 }, (_, i) => ({ source: `n${i % 100}`, target: `n${(i + 1) % 100}`, id: `e${i}` }))
    const { value, fixes } = sanitizeDiagram({ nodes, edges })
    expect(value.nodes).toHaveLength(LIMITS.nodes)
    expect(value.edges).toHaveLength(LIMITS.edges)
    expect(fixes.join(' ')).toMatch(/kept the first 5000.*kept the first 20000/)
  })

  it('shortens overlong text and drops oversized metadata', async () => {
    const { LIMITS } = await import('../../src/shared/serialize')
    const meta: Record<string, string> = {}
    for (let i = 0; i < 50; i++) meta[`k${i}`] = 'v'.repeat(5000)
    const { value, fixes } = sanitizeDiagram({ title: 't'.repeat(5000), nodes: [{ id: 'a', label: 'L'.repeat(5000), role: 'backend', meta }] })
    expect(value.title).toHaveLength(LIMITS.text)
    expect(value.nodes[0].label).toHaveLength(LIMITS.label)
    expect(Object.keys(value.nodes[0].meta!)).toHaveLength(LIMITS.metaKeys)
    expect(value.nodes[0].meta!.k0).toHaveLength(LIMITS.metaValue)
    expect(fixes).toContain('1 overlong label shortened')
  })

  it('groups never nest, and only groups can be parents or collapsed', () => {
    const { value, fixes } = sanitizeDiagram({
      nodes: [
        { id: 'g1', role: 'group', parent: 'g2' },
        { id: 'g2', role: 'group', parent: 'g1' },
        { id: 'a', role: 'backend', parent: 'b', collapsed: true },
        { id: 'b', role: 'backend' },
        { id: 'c', role: 'backend', parent: 'g1' },
      ],
    })
    expect(value.nodes.find((n) => n.id === 'g1')!.parent).toBeUndefined()
    expect(value.nodes.find((n) => n.id === 'a')!.parent).toBeUndefined()
    expect(value.nodes.find((n) => n.id === 'a')!.collapsed).toBeUndefined()
    expect(value.nodes.find((n) => n.id === 'c')!.parent).toBe('g1')
    expect(fixes).toContain('2 groups inside another group moved to the top level')
  })

  it('drops layout coordinates that are absurdly large', () => {
    const text = JSON.stringify({ diagram: { nodes: [{ id: 'a' }, { id: 'b' }] }, layout: { a: { x: 1e300, y: 0, pinned: true }, b: { x: 10, y: 20, pinned: true } } })
    const p = parseProject(text).value
    expect(p.layout.a).toBeUndefined()
    expect(p.layout.b).toEqual({ x: 10, y: 20, pinned: true })
  })
})
