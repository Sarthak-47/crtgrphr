/**
 * Automatic layout via ELK's layered algorithm, with pin-and-reflow (ADR-0004).
 *
 * Pinned nodes (placed by the user) keep their exact coordinates and, through
 * ELK's interactive strategies, the unpinned nodes are arranged *around* them.
 * Unpinned nodes get fresh ELK positions on every run.
 *
 * The authored IR has no coordinates (ADR-0003); this module is the only place
 * geometry is computed, and it reads/writes the separate layout layer.
 */
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { Direction, IRDiagram, IRNode, LayoutOverrides } from '@shared/ir'
import type { SequenceLayout } from './sequence'
import { LIGHT } from '@shared/roles'

const elk = new ELK()

interface ElkExtendedEdgeResult {
  id: string
  sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[]
  labels?: { x?: number; y?: number; width?: number; height?: number }[]
}

/**
 * Estimate a node's rendered size from its text so ELK spaces things well and
 * labels fit. Accounts for the brand badge and for diamonds, whose usable text
 * width is only about half of their box.
 */
export function measureNode(node: IRNode): { width: number; height: number } {
  const labelW = node.label.length * 7.6 // 13px semibold
  const subW = (node.sublabel ?? '').length * 6.4 // 11px
  const text = Math.max(labelW, subW)
  if (node.role === 'decision') {
    return { width: Math.round(Math.min(300, Math.max(130, text * 1.6 + 30))), height: node.sublabel ? 96 : 84 }
  }
  const badge = node.brand ? 34 : 0
  // Pills/stadiums lose their rounded ends to text; rectangles only need padding.
  const shape = LIGHT[node.role]?.shape
  const pad = shape === 'pill' || shape === 'stadium' ? 52 : 36
  const width = Math.round(Math.min(280, Math.max(120, text + pad + badge)))
  return { width, height: node.sublabel ? 76 : 60 }
}

type PortSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'

/**
 * Decision diamonds connect only at their vertices, flowchart-style: input on the
 * near vertex, the first branch out of the far vertex, the second and third out
 * of the side vertices. Fixed ports make ELK route to exactly those points.
 */
const DECISION_SIDES: Record<Direction, { in: PortSide; out: PortSide[] }> = {
  DOWN: { in: 'NORTH', out: ['SOUTH', 'EAST', 'WEST'] },
  UP: { in: 'SOUTH', out: ['NORTH', 'EAST', 'WEST'] },
  RIGHT: { in: 'WEST', out: ['EAST', 'SOUTH', 'NORTH'] },
  LEFT: { in: 'EAST', out: ['WEST', 'SOUTH', 'NORTH'] },
}

function vertex(side: PortSide, w: number, h: number): { x: number; y: number } {
  switch (side) {
    case 'NORTH':
      return { x: w / 2, y: 0 }
    case 'SOUTH':
      return { x: w / 2, y: h }
    case 'EAST':
      return { x: w, y: h / 2 }
    case 'WEST':
      return { x: 0, y: h / 2 }
  }
}

/** Port ids for each edge end that attaches to a decision node. */
export function decisionPorts(diagram: IRDiagram): Map<string, { source?: string; target?: string }> {
  const decisions = new Set(diagram.nodes.filter((n) => n.role === 'decision').map((n) => n.id))
  const sides = DECISION_SIDES[diagram.direction ?? 'RIGHT']
  const outCount = new Map<string, number>()
  const out = new Map<string, { source?: string; target?: string }>()
  for (const e of diagram.edges) {
    const entry: { source?: string; target?: string } = {}
    if (decisions.has(e.source) && e.source !== e.target) {
      const i = outCount.get(e.source) ?? 0
      outCount.set(e.source, i + 1)
      entry.source = `${e.source}::${sides.out[Math.min(i, sides.out.length - 1)]}`
    }
    if (decisions.has(e.target) && e.source !== e.target) entry.target = `${e.target}::${sides.in}`
    if (entry.source || entry.target) out.set(e.id, entry)
  }
  return out
}

export interface LaidOut {
  positions: Record<string, { x: number; y: number }>
  sizes: Record<string, { width: number; height: number }>
  width: number
  height: number
  /** present only for sequence diagrams (see layout/sequence.ts) */
  sequence?: SequenceLayout
  /**
   * Obstacle-avoiding orthogonal routes computed by ELK, keyed by edge id. They
   * are valid only while both endpoints' nodes stay where ELK put them; the
   * renderer checks that and falls back to its own router otherwise.
   */
  routes?: Record<string, { points: { x: number; y: number }[]; label?: { x: number; y: number } }>
}

/** Approximate rendered size of an edge label, so ELK can reserve room for it. */
export const edgeLabelSize = (text: string): { width: number; height: number } => ({ width: Math.ceil(text.length * 6.2 + 12), height: 17 })

/**
 * Per-type layer rules. Workflows and lifecycles read as "start at the top, end
 * at the bottom", so terminals with no way in go first and terminals with no way
 * out go last. Dataflows read source → sink, so any node with no inputs starts
 * the flow and any node with no outputs ends it.
 */
export function layerConstraints(diagram: IRDiagram): Map<string, 'FIRST' | 'LAST'> {
  const out = new Map<string, 'FIRST' | 'LAST'>()
  if (diagram.type !== 'workflow' && diagram.type !== 'lifecycle' && diagram.type !== 'dataflow') return out
  const indeg = new Map<string, number>()
  const outdeg = new Map<string, number>()
  for (const e of diagram.edges) {
    if (e.source === e.target) continue
    outdeg.set(e.source, (outdeg.get(e.source) ?? 0) + 1)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  for (const n of diagram.nodes) {
    if (n.role === 'group') continue
    const eligible = diagram.type === 'dataflow' || n.role === 'terminal'
    if (!eligible) continue
    const i = indeg.get(n.id) ?? 0
    const o = outdeg.get(n.id) ?? 0
    if (i === 0 && o > 0) out.set(n.id, 'FIRST')
    else if (o === 0 && i > 0) out.set(n.id, 'LAST')
  }
  return out
}

const DIRS: Record<Direction, string> = { RIGHT: 'RIGHT', DOWN: 'DOWN', LEFT: 'LEFT', UP: 'UP' }

export async function layout(diagram: IRDiagram, overrides: LayoutOverrides = {}): Promise<LaidOut> {
  const dir = DIRS[diagram.direction ?? 'RIGHT'] ?? 'RIGHT'
  const hasPins = Object.values(overrides).some((p) => p.pinned)

  const byId = new Map(diagram.nodes.map((n) => [n.id, n]))
  const groups = diagram.nodes.filter((n) => n.role === 'group')
  const childrenOf = new Map<string | undefined, IRNode[]>()
  for (const n of diagram.nodes) {
    if (n.role === 'group') continue
    const key = n.parent && byId.has(n.parent) ? n.parent : undefined
    const arr = childrenOf.get(key) ?? []
    arr.push(n)
    childrenOf.set(key, arr)
  }

  const constraints = layerConstraints(diagram)
  const ports = decisionPorts(diagram)
  const makeLeaf = (n: IRNode): ElkNode => {
    const s = measureNode(n)
    const pin = overrides[n.id]
    const leaf: ElkNode = { id: n.id, width: s.width, height: s.height }
    const c = constraints.get(n.id)
    if (c) leaf.layoutOptions = { 'elk.layered.layering.layerConstraint': c }
    if (n.role === 'decision') {
      const sides = DECISION_SIDES[diagram.direction ?? 'RIGHT']
      leaf.layoutOptions = { ...leaf.layoutOptions, 'elk.portConstraints': 'FIXED_POS' }
      leaf.ports = [sides.in, ...sides.out].map((side) => {
        const v = vertex(side, s.width, s.height)
        return { id: `${n.id}::${side}`, x: v.x, y: v.y, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } }
      })
    }
    if (pin?.pinned) {
      leaf.x = pin.x
      leaf.y = pin.y
    }
    return leaf
  }

  const topChildren: ElkNode[] = []
  for (const g of groups) {
    const kids = (childrenOf.get(g.id) ?? []).map(makeLeaf)
    if (kids.length === 0) continue
    topChildren.push({
      id: g.id,
      children: kids,
      layoutOptions: { 'elk.padding': '[top=36,left=20,bottom=20,right=20]' },
    })
  }
  for (const n of childrenOf.get(undefined) ?? []) topChildren.push(makeLeaf(n))

  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': dir,
    'elk.layered.spacing.nodeNodeBetweenLayers': '70',
    'elk.spacing.nodeNode': '48',
    'elk.layered.spacing.edgeNodeBetweenLayers': '30',
    'elk.edgeRouting': 'ORTHOGONAL',
    // Keep every edge its own line (merging bundles edges into shared trunks).
    'elk.layered.mergeEdges': 'false',
    'elk.spacing.edgeEdge': '14',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.spacing.edgeLabel': '3',
    // Cyclic graphs (lifecycles, retries) must still start from their real source
    // node; the default greedy cycle breaker can put a mid-cycle node first.
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  }
  if (hasPins) {
    // Interactive strategies let fixed node positions steer layering + ordering,
    // so unpinned nodes reflow around the pinned ones.
    layoutOptions['elk.layered.layering.strategy'] = 'INTERACTIVE'
    layoutOptions['elk.layered.crossingMinimization.strategy'] = 'INTERACTIVE'
    layoutOptions['elk.layered.nodePlacement.strategy'] = 'INTERACTIVE'
    layoutOptions['elk.interactive'] = 'true'
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions,
    children: topChildren,
    edges: diagram.edges.map((e) => ({
      id: e.id,
      sources: [ports.get(e.id)?.source ?? e.source],
      targets: [ports.get(e.id)?.target ?? e.target],
      labels: e.label ? [{ id: `${e.id}::label`, text: e.label, ...edgeLabelSize(e.label) }] : [],
    })),
  }

  const res = await elk.layout(graph)

  const positions: LaidOut['positions'] = {}
  const sizes: LaidOut['sizes'] = {}
  const walk = (node: ElkNode, ox: number, oy: number): void => {
    for (const child of node.children ?? []) {
      const x = (child.x ?? 0) + ox
      const y = (child.y ?? 0) + oy
      positions[child.id] = { x, y }
      sizes[child.id] = { width: child.width ?? 140, height: child.height ?? 60 }
      if (child.children?.length) walk(child, x, y)
    }
  }
  walk(res, 0, 0)

  // Edge routes. Root-level edges use absolute coordinates.
  const routes: NonNullable<LaidOut['routes']> = {}
  for (const e of (res.edges ?? []) as ElkExtendedEdgeResult[]) {
    const sec = e.sections?.[0]
    if (!sec) continue
    const points = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: p.x, y: p.y }))
    const lab = e.labels?.[0]
    const label = lab && lab.x !== undefined && lab.y !== undefined ? { x: lab.x + (lab.width ?? 0) / 2, y: lab.y + (lab.height ?? 0) / 2 } : undefined
    routes[e.id] = { points, label }
  }

  // Hard-guarantee pinned nodes land exactly where the user put them. (Routes
  // touching a node that ELK placed slightly differently are rejected later.)
  for (const [id, pin] of Object.entries(overrides)) {
    if (pin.pinned && positions[id]) positions[id] = { x: pin.x, y: pin.y }
  }

  return { positions, sizes, width: res.width ?? 1200, height: res.height ?? 700, routes }
}

/** Fold a fresh layout back into the overrides map: unpinned entries updated,
 *  pinned entries preserved. This is what the store persists to the project. */
export function mergeOverrides(laid: LaidOut, prev: LayoutOverrides): LayoutOverrides {
  const next: LayoutOverrides = {}
  for (const [id, pos] of Object.entries(laid.positions)) {
    const wasPinned = prev[id]?.pinned ?? false
    next[id] = wasPinned ? prev[id] : { x: pos.x, y: pos.y, pinned: false }
  }
  return next
}
