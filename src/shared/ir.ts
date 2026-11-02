/**
 * Cartographer IR — the single typed contract every input path compiles to and
 * every output consumes. See docs/decisions/0003-ir-and-data-model.md.
 *
 * INVARIANT (ADR-0003): the authored IR carries NO pixel coordinates. Positions
 * are a separate concern (see `LayoutOverrides` / the layout layer). This keeps
 * the semantic model clean and makes "re-derive from source" always safe.
 */

export const SCHEMA_VERSION = 1

export const DIAGRAM_TYPES = [
  'architecture',
  'workflow',
  'sequence',
  'dataflow',
  'lifecycle',
] as const
export type DiagramType = (typeof DIAGRAM_TYPES)[number]

/** Semantic role — drives color + default shape. What a node *is*, not its brand. */
export const NODE_ROLES = [
  'external',
  'frontend',
  'backend',
  'database',
  'cache',
  'queue',
  'cloud',
  'service',
  'process',
  'decision',
  'state',
  'terminal',
  'group',
] as const
export type NodeRole = (typeof NODE_ROLES)[number]

export type EdgeVariant = 'default' | 'emphasis' | 'dashed' | 'weak'

/** A node in the semantic graph. No coordinates by design (ADR-0003). */
export interface IRNode {
  id: string
  label: string
  sublabel?: string
  role: NodeRole
  /** optional brand key (e.g. "postgresql", "github") for a badge */
  brand?: string
  /** id of a parent group node this belongs inside */
  parent?: string
  /** provenance — where this node was derived from (repo path, manifest, etc.) */
  meta?: Record<string, string>
}

export interface IREdge {
  id: string
  source: string
  target: string
  label?: string
  variant?: EdgeVariant
}

export type Direction = 'RIGHT' | 'DOWN' | 'LEFT' | 'UP'

/** The semantic diagram. Pure meaning — no geometry. */
export interface IRDiagram {
  id: string
  title: string
  subtitle?: string
  type: DiagramType
  /** ELK flow direction; a sensible default is derived from `type` when absent */
  direction?: Direction
  nodes: IRNode[]
  edges: IREdge[]
}

/* --------------------------- The layout layer --------------------------- */

/**
 * A single node's placement. `pinned` means the user positioned it by hand and
 * auto-layout must respect it and flow other nodes around it (ADR-0004).
 */
export interface NodePlacement {
  x: number
  y: number
  pinned: boolean
}

/** id → placement. Lives ALONGSIDE the IR, never inside it. */
export type LayoutOverrides = Record<string, NodePlacement>

/* ----------------------------- Project file ----------------------------- */

/**
 * The `.crtgrphr` project file: semantic IR + the layout layer + meta. Serialized
 * git-friendly (stable key order) so maps diff cleanly in PRs (ADR-0003).
 */
export interface CartographProject {
  schema_version: number
  diagram: IRDiagram
  /** user pins + last known auto positions; unpinned entries are disposable */
  layout: LayoutOverrides
}

/* ------------------------------- Helpers -------------------------------- */

export function defaultDirection(type: DiagramType): Direction {
  switch (type) {
    case 'workflow':
    case 'lifecycle':
      return 'DOWN'
    default:
      return 'RIGHT'
  }
}

export function emptyDiagram(type: DiagramType = 'architecture'): IRDiagram {
  return {
    id: 'untitled',
    title: 'Untitled map',
    type,
    direction: defaultDirection(type),
    nodes: [],
    edges: [],
  }
}

export function emptyProject(type: DiagramType = 'architecture'): CartographProject {
  return { schema_version: SCHEMA_VERSION, diagram: emptyDiagram(type), layout: {} }
}
