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
  EDGE_CONFIDENCES,
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
import { sanitizeViews } from './views'

const DIRECTIONS: readonly Direction[] = ['RIGHT', 'DOWN', 'LEFT', 'UP']
const VARIANTS: readonly EdgeVariant[] = ['default', 'emphasis', 'dashed', 'weak']
const MAX_EVIDENCE = 500

/**
 * Limits for anything loaded from outside. A real map has tens to hundreds of
 * nodes; these are far above that and only stop pathological input (a huge or
 * hostile file) from freezing the layout engine or the renderer.
 */
export const LIMITS = {
  nodes: 5000,
  edges: 20000,
  id: 200,
  label: 300,
  text: 1000, // title, subtitle, sublabel
  brand: 60,
  metaKeys: 30,
  metaValue: 2000,
  coordinate: 1_000_000,
} as const

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s)

/* ------------------------------ Serialize ------------------------------- */

function nodeLine(n: IRNode): string {
  const o: Record<string, unknown> = { id: n.id, label: n.label }
  if (n.sublabel !== undefined) o.sublabel = n.sublabel
  o.role = n.role
  if (n.brand !== undefined) o.brand = n.brand
  if (n.parent !== undefined) o.parent = n.parent
  if (n.collapsed) o.collapsed = true
  if (n.meta !== undefined) o.meta = sortedObject(n.meta)
  return JSON.stringify(o)
}

function edgeLine(e: IREdge): string {
  const o: Record<string, unknown> = { id: e.id, source: e.source, target: e.target }
  if (e.label !== undefined) o.label = e.label
  if (e.variant !== undefined) o.variant = e.variant
  if (e.confidence !== undefined) o.confidence = e.confidence
  if (e.evidence !== undefined) o.evidence = e.evidence
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
  if (project.views?.length) {
    out.push('  },')
    out.push('  "views": [')
    out.push(project.views.map((v) => `    ${JSON.stringify({ name: v.name, collapsed: [...v.collapsed].sort() })}`).join(',\n'))
    out.push('  ]')
  } else out.push('  }')
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
  if (rawNodes.length > LIMITS.nodes) fixes.push(`${rawNodes.length} nodes is more than a map can show; kept the first ${LIMITS.nodes}`)
  let clipped = 0
  rawNodes.slice(0, LIMITS.nodes).forEach((rn, i) => {
    if (!rn || typeof rn !== 'object') return
    const n = rn as Record<string, unknown>
    const baseId = isStr(n.id) ? clip(n.id, LIMITS.id) : `node-${i + 1}`
    const id = uniqueId(baseId, nodeIds)
    if (id !== baseId || !isStr(n.id)) renamed++
    nodeIds.add(id)
    const role: NodeRole = NODE_ROLES.includes(n.role as never) ? (n.role as NodeRole) : 'backend'
    if (n.role !== undefined && n.role !== role) badRoles++
    const label = isStr(n.label) ? n.label : id
    if (label.length > LIMITS.label || (isStr(n.sublabel) && n.sublabel.length > LIMITS.text)) clipped++
    const node: IRNode = { id, label: clip(label, LIMITS.label), role }
    if (isStr(n.sublabel)) node.sublabel = clip(n.sublabel, LIMITS.text)
    if (isStr(n.brand)) node.brand = clip(n.brand, LIMITS.brand)
    if (isStr(n.parent)) node.parent = n.parent
    if (n.collapsed === true && role === 'group') node.collapsed = true
    if (n.meta && typeof n.meta === 'object') {
      const meta: Record<string, string> = {}
      for (const [k, v] of Object.entries(n.meta as Record<string, unknown>).slice(0, LIMITS.metaKeys)) {
        if (typeof v === 'string' && k.length <= 60) meta[k] = clip(v, LIMITS.metaValue)
      }
      if (Object.keys(meta).length) node.meta = meta
    }
    nodes.push(node)
  })
  if (renamed) fixes.push(`${renamed} node id${renamed > 1 ? 's' : ''} missing or duplicated, renamed`)
  if (badRoles) fixes.push(`${badRoles} unknown role${badRoles > 1 ? 's' : ''}, used backend`)

  if (clipped) fixes.push(`${clipped} overlong label${clipped > 1 ? 's' : ''} shortened`)

  // A parent must be a group, and groups don't nest (a group inside a group, or
  // a loop of groups, can't be laid out): such references are dropped.
  const groupIds = new Set(nodes.filter((n) => n.role === 'group').map((n) => n.id))
  let orphanParents = 0
  let nested = 0
  for (const n of nodes) {
    if (!n.parent) continue
    if (n.role === 'group') {
      delete n.parent
      nested++
    } else if (!groupIds.has(n.parent) || n.parent === n.id) {
      delete n.parent
      orphanParents++
    }
  }
  if (orphanParents) fixes.push(`${orphanParents} parent reference${orphanParents > 1 ? 's' : ''} to missing groups removed`)
  if (nested) fixes.push(`${nested} group${nested > 1 ? 's' : ''} inside another group moved to the top level`)
  for (const n of nodes) if (n.collapsed && n.role !== 'group') delete n.collapsed

  // Edges
  const edgeIds = new Set<string>()
  const edges: IREdge[] = []
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  let dangling = 0
  if (rawEdges.length > LIMITS.edges) fixes.push(`${rawEdges.length} edges is more than a map can show; kept the first ${LIMITS.edges}`)
  rawEdges.slice(0, LIMITS.edges).forEach((re) => {
    if (!re || typeof re !== 'object') return
    const e = re as Record<string, unknown>
    if (!isStr(e.source) || !isStr(e.target) || !nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      dangling++
      return
    }
    const id = uniqueId(isStr(e.id) ? clip(e.id, LIMITS.id * 2 + 2) : `${e.source}->${e.target}`, edgeIds)
    edgeIds.add(id)
    const edge: IREdge = { id, source: e.source, target: e.target }
    if (isStr(e.label)) edge.label = clip(e.label, LIMITS.label)
    if (VARIANTS.includes(e.variant as never)) edge.variant = e.variant as EdgeVariant
    if (EDGE_CONFIDENCES.includes(e.confidence as never)) edge.confidence = e.confidence as IREdge['confidence']
    if (isStr(e.evidence)) edge.evidence = e.evidence.slice(0, MAX_EVIDENCE)
    edges.push(edge)
  })
  if (dangling) fixes.push(`${dangling} edge${dangling > 1 ? 's' : ''} pointing at missing nodes dropped`)

  const diagram: IRDiagram = {
    id: isStr(raw.id) ? clip(raw.id, LIMITS.id) : 'untitled',
    title: isStr(raw.title) ? clip(raw.title, LIMITS.text) : 'Untitled map',
    type,
    direction,
    nodes,
    edges,
  }
  if (isStr(raw.subtitle)) diagram.subtitle = clip(raw.subtitle, LIMITS.text)
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
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMITS.coordinate
    if (ok(p?.x) && ok(p?.y)) {
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
  const views = sanitizeViews(isProject ? obj.views : undefined)
  return { value: { schema_version: SCHEMA_VERSION, diagram, layout, ...(views.length ? { views } : {}) }, fixes }
}
