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

const elk = new ELK()

/** Estimate a node's rendered size from its text so ELK spaces things well. */
export function measureNode(node: IRNode): { width: number; height: number } {
  const longest = Math.max(node.label.length, (node.sublabel ?? '').length)
  const width = Math.min(240, Math.max(120, longest * 8 + 40))
  const height = node.sublabel ? 76 : 60
  return { width, height }
}

export interface LaidOut {
  positions: Record<string, { x: number; y: number }>
  sizes: Record<string, { width: number; height: number }>
  width: number
  height: number
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

  const makeLeaf = (n: IRNode): ElkNode => {
    const s = measureNode(n)
    const pin = overrides[n.id]
    const leaf: ElkNode = { id: n.id, width: s.width, height: s.height }
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
    'elk.layered.spacing.nodeNodeBetweenLayers': '90',
    'elk.spacing.nodeNode': '48',
    'elk.layered.spacing.edgeNodeBetweenLayers': '30',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.mergeEdges': 'true',
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
    edges: diagram.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
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

  // Hard-guarantee pinned nodes land exactly where the user put them.
  for (const [id, pin] of Object.entries(overrides)) {
    if (pin.pinned && positions[id]) positions[id] = { x: pin.x, y: pin.y }
  }

  return { positions, sizes, width: res.width ?? 1200, height: res.height ?? 700 }
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
