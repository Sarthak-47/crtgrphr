/**
 * Property-based tests: instead of hand-picked examples, fast-check generates
 * thousands of random (often hostile) inputs and checks rules that must always
 * hold. Failing cases are shrunk to the smallest input that breaks the rule.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { LIMITS, parseProject, sanitizeDiagram, serializeProject } from '../../src/shared/serialize'
import { visibleDiagram } from '../../src/shared/collapse'
import { applyRescan, diffDiagrams, diffIsEmpty } from '../../src/shared/diff'
import { jsImportsLexed, pyImportsLexed } from '../../src/main/scan/lex'
import { NODE_ROLES, type IRDiagram } from '../../src/shared/ir'

const RUNS = { numRuns: Number(process.env.PROP_RUNS ?? 300) }

/** Loosely shaped "maps": the kind of thing a damaged or hand-edited file contains. */
// A small id pool, so random parents and edge ends usually point at real nodes
// (including groups pointing at groups, loops, and self-references).
const id = fc.oneof(
  { weight: 8, arbitrary: fc.constantFrom('a', 'b', 'c', 'g1', 'g2') },
  { weight: 1, arbitrary: fc.constantFrom('', ' ') },
  { weight: 1, arbitrary: fc.string({ maxLength: 6 }) },
)
const role = fc.oneof(
  { weight: 3, arbitrary: fc.constant('group') },
  { weight: 6, arbitrary: fc.constantFrom(...NODE_ROLES) },
  { weight: 1, arbitrary: fc.string({ maxLength: 8 }) },
)
const looseNode = fc.record(
  {
    id: fc.oneof(id, fc.integer(), fc.constant(null)),
    label: fc.oneof(fc.string({ maxLength: 20 }), fc.constant(undefined), fc.integer()),
    role,
    parent: fc.oneof(id, fc.constant(undefined)),
    collapsed: fc.oneof(fc.boolean(), fc.constant('yes')),
    meta: fc.oneof(fc.dictionary(fc.string({ maxLength: 5 }), fc.oneof(fc.string({ maxLength: 10 }), fc.integer())), fc.constant(null)),
  },
  { requiredKeys: [] },
)
const looseEdge = fc.record(
  {
    id: fc.oneof(id, fc.constant(undefined)),
    source: fc.oneof(id, fc.integer()),
    target: id,
    label: fc.oneof(fc.string({ maxLength: 10 }), fc.constant(undefined)),
    variant: fc.oneof(fc.constantFrom('default', 'dashed', 'weak', 'emphasis', 'bogus'), fc.constant(undefined)),
    confidence: fc.oneof(fc.constantFrom('declared', 'inferred', 'sure'), fc.constant(undefined)),
  },
  { requiredKeys: [] },
)
const looseDiagram = fc.record(
  {
    title: fc.oneof(fc.string({ maxLength: 20 }), fc.integer()),
    type: fc.oneof(fc.constantFrom('architecture', 'workflow', 'sequence', 'nope')),
    direction: fc.constantFrom('RIGHT', 'DOWN', 'LEFT', 'UP', 'SIDEWAYS'),
    nodes: fc.oneof(fc.array(looseNode, { maxLength: 12 }), fc.constant('not an array')),
    edges: fc.oneof(fc.array(looseEdge, { maxLength: 16 }), fc.constant(null)),
  },
  { requiredKeys: [] },
)

/** The rules every sanitized diagram must satisfy. */
function expectValid(d: IRDiagram): void {
  const ids = d.nodes.map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length) // unique node ids
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  for (const n of d.nodes) {
    expect(typeof n.label).toBe('string')
    expect(NODE_ROLES).toContain(n.role)
    if (n.parent) {
      expect(byId.get(n.parent)?.role).toBe('group') // parents are groups
      expect(n.role).not.toBe('group') // groups don't nest
    }
    if (n.collapsed) expect(n.role).toBe('group')
    expect(n.label.length).toBeLessThanOrEqual(LIMITS.label)
  }
  const eids = d.edges.map((e) => e.id)
  expect(new Set(eids).size).toBe(eids.length) // unique edge ids
  for (const e of d.edges) {
    expect(byId.has(e.source) && byId.has(e.target)).toBe(true) // no dangling edges
    if (e.confidence) expect(['declared', 'inferred']).toContain(e.confidence)
  }
}

describe('sanitizer properties', () => {
  it('never throws, and always returns a valid diagram', () => {
    fc.assert(
      fc.property(fc.oneof(looseDiagram, fc.anything()), (input) => {
        expectValid(sanitizeDiagram(input).value)
      }),
      RUNS,
    )
  })

  it('is idempotent: a sanitized diagram needs no further repair', () => {
    fc.assert(
      fc.property(looseDiagram, (input) => {
        const once = sanitizeDiagram(input).value
        const twice = sanitizeDiagram(once)
        expect(twice.fixes).toEqual([])
        expect(twice.value).toEqual(once)
      }),
      RUNS,
    )
  })

  it('save then open gives back the same map', () => {
    fc.assert(
      fc.property(looseDiagram, (input) => {
        const diagram = sanitizeDiagram(input).value
        const text = serializeProject({ schema_version: 1, diagram, layout: {} })
        const back = parseProject(text)
        expect(back.fixes).toEqual([])
        expect(back.value.diagram).toEqual(diagram)
      }),
      RUNS,
    )
  })

  it('opening arbitrary text either fails with a readable error or yields a valid map', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
        try {
          expectValid(parseProject(text).value.diagram)
        } catch (e) {
          expect((e as Error).message).toMatch(/^Not a valid JSON file/)
        }
      }),
      RUNS,
    )
  })
})

describe('drill-down and re-scan properties', () => {
  const valid = looseDiagram.map((d) => sanitizeDiagram(d).value)
  const withCollapse = fc.tuple(valid, fc.array(fc.boolean(), { maxLength: 12 })).map(([d, flags]) => ({
    ...d,
    nodes: d.nodes.map((n, i) => (n.role === 'group' && flags[i] ? { ...n, collapsed: true } : n)),
  }))

  it('the visible diagram is always valid and never shows a hidden part', () => {
    fc.assert(
      fc.property(withCollapse, (d) => {
        const v = visibleDiagram(d)
        expectValid(sanitizeDiagram(v).value)
        expect(sanitizeDiagram(v).fixes).toEqual([])
        const collapsed = new Set(d.nodes.filter((n) => n.collapsed).map((n) => n.id))
        for (const n of v.nodes) expect(n.parent === undefined || !collapsed.has(n.parent)).toBe(true)
      }),
      RUNS,
    )
  })

  it('re-scanning with the same scan changes nothing', () => {
    fc.assert(
      fc.property(valid, (scan) => {
        const scanned: IRDiagram = { ...scan, nodes: scan.nodes.map((n) => ({ ...n, meta: { ...n.meta, source: 'x' } })) }
        const applied = applyRescan({ schema_version: 1, diagram: scanned, layout: {} }, scanned)
        expect(diffIsEmpty(diffDiagrams(applied.diagram, scanned))).toBe(true)
      }),
      RUNS,
    )
  })
})

describe('import lexer properties', () => {
  it('never throws on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (code) => {
        expect(Array.isArray(jsImportsLexed(code))).toBe(true)
        expect(Array.isArray(pyImportsLexed(code))).toBe(true)
      }),
      { numRuns: 1000 },
    )
  })

  it('anything inside a comment is never an import', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }).filter((s) => !s.includes('*/') && !s.includes('\n')), (s) => {
        expect(jsImportsLexed(`/* import x from '${s}' */\n// require('${s}')`)).toEqual([])
        expect(pyImportsLexed(`# import ${s}\n"""from ${s} import y"""`)).toEqual([])
      }),
      RUNS,
    )
  })
})
