/**
 * Git-friendly (de)serialization of a `.crtgrphr` project (ADR-0003).
 *
 * Goals: stable key order, one node/edge/placement per line, sorted maps — so a
 * change to one node produces a one-line diff in a PR, not a whole-file reshuffle.
 * The output is still valid JSON (parseable with JSON.parse).
 */
import {
  SCHEMA_VERSION,
  DIAGRAM_TYPES,
  defaultDirection,
  type CartographProject,
  type IRDiagram,
  type IREdge,
  type IRNode,
  type LayoutOverrides,
  type NodePlacement,
} from './ir'

/** Serialize a node as a single-line object with a fixed key order. */
function nodeLine(n: IRNode): string {
  const o: Record<string, unknown> = { id: n.id, label: n.label }
  if (n.sublabel !== undefined) o.sublabel = n.sublabel
  o.role = n.role
  if (n.brand !== undefined) o.brand = n.brand
  if (n.parent !== undefined) o.parent = n.parent
  if (n.meta !== undefined) o.meta = sortedObject(n.meta)
  return JSON.stringify(o)
}

function edgeLine(e: IREdge): string {
  const o: Record<string, unknown> = { id: e.id, source: e.source, target: e.target }
  if (e.label !== undefined) o.label = e.label
  if (e.variant !== undefined) o.variant = e.variant
  return JSON.stringify(o)
}

function placementLine(id: string, p: NodePlacement): string {
  return `${JSON.stringify(id)}: ${JSON.stringify({ x: round(p.x), y: round(p.y), pinned: p.pinned })}`
}

const round = (n: number): number => Math.round(n * 100) / 100

function sortedObject(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(o).sort()) out[k] = o[k]
  return out
}

/** Produce the canonical, diff-friendly text of a project file. */
export function serializeProject(project: CartographProject): string {
  const d = project.diagram
  const nodes = d.nodes.map((n) => '      ' + nodeLine(n)).join(',\n')
  const edges = d.edges.map((e) => '      ' + edgeLine(e)).join(',\n')

  const layoutIds = Object.keys(project.layout).sort()
  const layout = layoutIds.map((id) => '    ' + placementLine(id, project.layout[id])).join(',\n')

  const head: string[] = []
  head.push('{')
  head.push(`  "schema_version": ${project.schema_version},`)
  head.push('  "diagram": {')
  head.push(`    "id": ${JSON.stringify(d.id)},`)
  head.push(`    "title": ${JSON.stringify(d.title)},`)
  if (d.subtitle !== undefined) head.push(`    "subtitle": ${JSON.stringify(d.subtitle)},`)
  head.push(`    "type": ${JSON.stringify(d.type)},`)
  head.push(`    "direction": ${JSON.stringify(d.direction ?? defaultDirection(d.type))},`)
  head.push('    "nodes": [')
  if (nodes) head.push(nodes)
  head.push('    ],')
  head.push('    "edges": [')
  if (edges) head.push(edges)
  head.push('    ]')
  head.push('  },')
  head.push('  "layout": {')
  if (layout) head.push(layout)
  head.push('  }')
  head.push('}')
  return head.join('\n') + '\n'
}

/** Parse + normalize a project file. Tolerant of older/partial shapes. */
export function parseProject(text: string): CartographProject {
  const raw = JSON.parse(text)
  // Accept either a full project or a bare diagram (agent JSON / older files).
  const diagram: unknown = raw?.diagram ?? raw
  const d = normalizeDiagram(diagram)
  const layout = normalizeLayout(raw?.layout)
  const schema_version = typeof raw?.schema_version === 'number' ? raw.schema_version : SCHEMA_VERSION
  return { schema_version, diagram: d, layout }
}

export function normalizeDiagram(input: unknown): IRDiagram {
  const raw = (input ?? {}) as Record<string, unknown>
  const type = DIAGRAM_TYPES.includes(raw.type as never) ? (raw.type as IRDiagram['type']) : 'architecture'
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as IRNode[]) : []
  const edges = Array.isArray(raw.edges) ? (raw.edges as IREdge[]) : []
  return {
    id: typeof raw.id === 'string' ? raw.id : 'imported',
    title: typeof raw.title === 'string' ? raw.title : 'Imported map',
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : undefined,
    type,
    direction: (['RIGHT', 'DOWN', 'LEFT', 'UP'] as const).includes(raw.direction as never)
      ? (raw.direction as IRDiagram['direction'])
      : defaultDirection(type),
    nodes: nodes.map((n) => ({ ...n, role: n.role ?? 'backend' })),
    edges,
  }
}

function normalizeLayout(input: unknown): LayoutOverrides {
  const out: LayoutOverrides = {}
  if (input && typeof input === 'object') {
    for (const [id, v] of Object.entries(input as Record<string, unknown>)) {
      const p = v as Partial<NodePlacement>
      if (typeof p?.x === 'number' && typeof p?.y === 'number') {
        out[id] = { x: p.x, y: p.y, pinned: !!p.pinned }
      }
    }
  }
  return out
}
