/**
 * Git-friendly (de)serialization of a `.crtgrphr` project (ADR-0003), plus the
 * sanitizer every external input goes through.
 *
 * Output goals: stable key order, one node/edge/placement per line, sorted maps,
 * so a change to one node is a one-line diff. The output is still plain JSON.
 *
 * Input goals: anything we load (files, agent JSON, scanner output) is sanitized
 * so a malformed graph can never reach the layout engine. ELK throws on dangling
 * edges and duplicate ids; we fix those here and report what we changed.
 */
import {
  SCHEMA_VERSION,
  DIAGRAM_TYPES,
  NODE_ROLES,
  defaultDirection,
  type CartographProject,
  type DiagramOrigin,
  type Direction,
  type EdgeVariant,
  type IRDiagram,
  type IREdge,
  type IRNode,
  type LayoutOverrides,
  type NodePlacement,
  type NodeRole,
} from './ir'
import { dirnamePath, isAbsolutePath, joinPath, normalizePath, relativePath } from './paths'

const DIRECTIONS: readonly Direction[] = ['RIGHT', 'DOWN', 'LEFT', 'UP']
const VARIANTS: readonly EdgeVariant[] = ['default', 'emphasis', 'dashed', 'weak']

/* ------------------------------ Serialize ------------------------------- */

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

export interface FileContext {
  /** where the project file lives (or will), to store/resolve origin.root relatively */
  filePath?: string | null
}

/** origin.root as it should be written into a file at `filePath`. */
function originForFile(origin: DiagramOrigin, filePath?: string | null): DiagramOrigin {
  if (!filePath || !isAbsolutePath(origin.root) || !isAbsolutePath(filePath)) return origin
  const rel = relativePath(dirnamePath(filePath), origin.root)
  return rel === null ? origin : { ...origin, root: rel }
}

/** Produce the canonical, diff-friendly text of a project file. */
export function serializeProject(project: CartographProject, ctx: FileContext = {}): string {
  const d = project.diagram
  const nodes = d.nodes.map((n) => '      ' + nodeLine(n)).join(',\n')
  const edges = d.edges.map((e) => '      ' + edgeLine(e)).join(',\n')
  const layoutIds = Object.keys(project.layout).sort()
  const layout = layoutIds.map((id) => '    ' + placementLine(id, project.layout[id])).join(',\n')

  const out: string[] = []
  out.push('{')
  out.push(`  "schema_version": ${project.schema_version},`)
  out.push('  "diagram": {')
  out.push(`    "id": ${JSON.stringify(d.id)},`)
  out.push(`    "title": ${JSON.stringify(d.title)},`)
  if (d.subtitle !== undefined) out.push(`    "subtitle": ${JSON.stringify(d.subtitle)},`)
  out.push(`    "type": ${JSON.stringify(d.type)},`)
  out.push(`    "direction": ${JSON.stringify(d.direction ?? defaultDirection(d.type))},`)
  if (d.origin) {
    const o = originForFile(d.origin, ctx.filePath)
    const obj: Record<string, string> = { kind: o.kind, root: o.root }
    if (o.scannedAt) obj.scannedAt = o.scannedAt
    out.push(`    "origin": ${JSON.stringify(obj)},`)
  }
  out.push('    "nodes": [')
  if (nodes) out.push(nodes)
  out.push('    ],')
  out.push('    "edges": [')
  if (edges) out.push(edges)
  out.push('    ]')
  out.push('  },')
  out.push('  "layout": {')
  if (layout) out.push(layout)
  out.push('  }')
  out.push('}')
  return out.join('\n') + '\n'
}

/* ------------------------------- Sanitize ------------------------------- */

export interface Sanitized<T> {
  value: T
  /** human-readable list of repairs, empty when the input was already clean */
  fixes: string[]
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * Turn any loosely-shaped object into a valid IRDiagram. Never throws.
 * Repairs: missing/duplicate node ids, unknown roles, edges whose endpoints don't
 * exist, duplicate/missing edge ids, unknown variants, parents that don't exist.
 */
export function sanitizeDiagram(input: unknown): Sanitized<IRDiagram> {
  const fixes: string[] = []
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const type = DIAGRAM_TYPES.includes(raw.type as never) ? (raw.type as IRDiagram['type']) : 'architecture'
  if (raw.type !== undefined && raw.type !== type) fixes.push(`unknown diagram type "${String(raw.type)}", used architecture`)

  const direction = DIRECTIONS.includes(raw.direction as never)
    ? (raw.direction as Direction)
    : defaultDirection(type)

  // Nodes
  const nodeIds = new Set<string>()
  const nodes: IRNode[] = []
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : []
  let renamed = 0
  let badRoles = 0
  rawNodes.forEach((rn, i) => {
    if (!rn || typeof rn !== 'object') return
    const n = rn as Record<string, unknown>
    const baseId = isStr(n.id) ? n.id : `node-${i + 1}`
    const id = uniqueId(baseId, nodeIds)
    if (id !== baseId || !isStr(n.id)) renamed++
    nodeIds.add(id)
    const role: NodeRole = NODE_ROLES.includes(n.role as never) ? (n.role as NodeRole) : 'backend'
    if (n.role !== undefined && n.role !== role) badRoles++
    const node: IRNode = { id, label: isStr(n.label) ? n.label : id, role }
    if (isStr(n.sublabel)) node.sublabel = n.sublabel
    if (isStr(n.brand)) node.brand = n.brand
    if (isStr(n.parent)) node.parent = n.parent
    if (n.meta && typeof n.meta === 'object') {
      const meta: Record<string, string> = {}
      for (const [k, v] of Object.entries(n.meta as Record<string, unknown>)) if (typeof v === 'string') meta[k] = v
      if (Object.keys(meta).length) node.meta = meta
    }
    nodes.push(node)
  })
  if (renamed) fixes.push(`${renamed} node id${renamed > 1 ? 's' : ''} missing or duplicated, renamed`)
  if (badRoles) fixes.push(`${badRoles} unknown role${badRoles > 1 ? 's' : ''}, used backend`)

  let orphanParents = 0
  for (const n of nodes) {
    if (n.parent && (!nodeIds.has(n.parent) || n.parent === n.id)) {
      delete n.parent
      orphanParents++
    }
  }
  if (orphanParents) fixes.push(`${orphanParents} parent reference${orphanParents > 1 ? 's' : ''} to missing groups removed`)

  // Edges
  const edgeIds = new Set<string>()
  const edges: IREdge[] = []
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  let dangling = 0
  rawEdges.forEach((re) => {
    if (!re || typeof re !== 'object') return
    const e = re as Record<string, unknown>
    if (!isStr(e.source) || !isStr(e.target) || !nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      dangling++
      return
    }
    const id = uniqueId(isStr(e.id) ? e.id : `${e.source}->${e.target}`, edgeIds)
    edgeIds.add(id)
    const edge: IREdge = { id, source: e.source, target: e.target }
    if (isStr(e.label)) edge.label = e.label
    if (VARIANTS.includes(e.variant as never)) edge.variant = e.variant as EdgeVariant
    edges.push(edge)
  })
  if (dangling) fixes.push(`${dangling} edge${dangling > 1 ? 's' : ''} pointing at missing nodes dropped`)

  const diagram: IRDiagram = {
    id: isStr(raw.id) ? raw.id : 'untitled',
    title: isStr(raw.title) ? raw.title : 'Untitled map',
    type,
    direction,
    nodes,
    edges,
  }
  if (isStr(raw.subtitle)) diagram.subtitle = raw.subtitle
  const o = raw.origin as Record<string, unknown> | undefined
  if (o && typeof o === 'object' && o.kind === 'repo' && isStr(o.root)) {
    diagram.origin = { kind: 'repo', root: o.root }
    if (isStr(o.scannedAt)) diagram.origin.scannedAt = o.scannedAt
  } else if (o !== undefined) fixes.push('unrecognized origin dropped')
  return { value: diagram, fixes }
}

/** Back-compat helper: sanitize and drop the report. */
export function normalizeDiagram(input: unknown): IRDiagram {
  return sanitizeDiagram(input).value
}

function sanitizeLayout(input: unknown, nodeIds: Set<string>): LayoutOverrides {
  const out: LayoutOverrides = {}
  if (!input || typeof input !== 'object') return out
  for (const [id, v] of Object.entries(input as Record<string, unknown>)) {
    if (!nodeIds.has(id)) continue
    const p = v as Partial<NodePlacement>
    if (typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      out[id] = { x: p.x, y: p.y, pinned: !!p.pinned }
    }
  }
  return out
}

/**
 * Parse a project file (or a bare diagram, e.g. agent JSON). Throws only when the
 * text isn't JSON at all; structural problems are repaired and reported.
 */
export function parseProject(text: string, ctx: FileContext = {}): Sanitized<CartographProject> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`Not a valid JSON file: ${e instanceof Error ? e.message : String(e)}`)
  }
  const obj = (raw ?? {}) as Record<string, unknown>
  const isProject = obj.diagram !== undefined && typeof obj.diagram === 'object'
  const { value: diagram, fixes } = sanitizeDiagram(isProject ? obj.diagram : obj)
  // A relative origin is relative to the file it was saved in.
  if (diagram.origin && !isAbsolutePath(diagram.origin.root) && ctx.filePath && isAbsolutePath(ctx.filePath)) {
    diagram.origin = { ...diagram.origin, root: joinPath(dirnamePath(ctx.filePath), diagram.origin.root) }
  } else if (diagram.origin && isAbsolutePath(diagram.origin.root)) {
    diagram.origin = { ...diagram.origin, root: normalizePath(diagram.origin.root) }
  }
  const nodeIds = new Set(diagram.nodes.map((n) => n.id))
  const layout = sanitizeLayout(isProject ? obj.layout : undefined, nodeIds)
  const version = typeof obj.schema_version === 'number' ? obj.schema_version : SCHEMA_VERSION
  if (version > SCHEMA_VERSION) {
    fixes.push(`file uses schema v${version}, newer than this app (v${SCHEMA_VERSION}); unknown fields ignored`)
  }
  return { value: { schema_version: SCHEMA_VERSION, diagram, layout }, fixes }
}
