/**
 * Re-scan diffing: compare the current map with a fresh scan of the same folder,
 * and merge the scan in without losing the user's work.
 *
 * What belongs to whom:
 * - a node with `meta.source` came from a scan; any other node was added by hand
 * - an edge whose id is the scanner's `source->target` came from a scan (ids are
 *   deterministic, ADR-0003/M1); any other edge was added by hand
 * - fields the user changed on a scanned node are listed in `meta.edited`, and a
 *   re-scan never overwrites them
 *
 * Hand-made nodes and edges always survive a re-scan. Pins survive for every node
 * that still exists.
 */
import type { CartographProject, IRDiagram, IREdge, IRNode } from './ir'

export const NODE_FIELDS = ['label', 'sublabel', 'role', 'brand'] as const
export type NodeField = (typeof NODE_FIELDS)[number]
const EDGE_FIELDS = ['label', 'variant'] as const

export const isScannedNode = (n: IRNode): boolean => !!n.meta?.source
export const isScannedEdge = (e: IREdge): boolean => e.id === `${e.source}->${e.target}`

export function editedFields(n: IRNode): Set<NodeField> {
  return new Set((n.meta?.edited ?? '').split(',').filter(Boolean) as NodeField[])
}

/** Record that the user changed `fields` on a scanned node (no-op for hand-made nodes). */
export function markEdited(n: IRNode, fields: string[]): IRNode {
  if (!isScannedNode(n)) return n
  const set = editedFields(n)
  for (const f of fields) if ((NODE_FIELDS as readonly string[]).includes(f)) set.add(f as NodeField)
  if (set.size === 0) return n
  return { ...n, meta: { ...n.meta, edited: [...set].sort().join(',') } }
}

export interface Change<T> {
  before: T
  after: T
  fields: string[]
}

export interface DiagramDiff {
  addedNodes: IRNode[]
  removedNodes: IRNode[]
  changedNodes: Change<IRNode>[]
  addedEdges: IREdge[]
  removedEdges: IREdge[]
  changedEdges: Change<IREdge>[]
}

export const diffIsEmpty = (d: DiagramDiff): boolean =>
  !d.addedNodes.length && !d.removedNodes.length && !d.changedNodes.length && !d.addedEdges.length && !d.removedEdges.length && !d.changedEdges.length

export function diffSummary(d: DiagramDiff): string {
  const parts: string[] = []
  const n = (k: number, w: string) => k && parts.push(`${k} ${w}`)
  n(d.addedNodes.length + d.addedEdges.length, 'added')
  n(d.removedNodes.length + d.removedEdges.length, 'removed')
  n(d.changedNodes.length + d.changedEdges.length, 'changed')
  return parts.length ? parts.join(', ') : 'no changes'
}

/** What a re-scan would change. Only scanned content is compared. */
export function diffDiagrams(current: IRDiagram, scanned: IRDiagram): DiagramDiff {
  const cur = new Map(current.nodes.filter(isScannedNode).map((n) => [n.id, n]))
  const handMade = new Set(current.nodes.filter((n) => !isScannedNode(n)).map((n) => n.id))
  const next = new Map(scanned.nodes.map((n) => [n.id, n]))

  const addedNodes = scanned.nodes.filter((n) => !cur.has(n.id) && !handMade.has(n.id))
  const removedNodes = [...cur.values()].filter((n) => !next.has(n.id))
  const changedNodes: Change<IRNode>[] = []
  for (const [id, before] of cur) {
    const after = next.get(id)
    if (!after) continue
    const edited = editedFields(before)
    const fields = NODE_FIELDS.filter((f) => !edited.has(f) && (before[f] ?? '') !== (after[f] ?? ''))
    if (fields.length) changedNodes.push({ before, after, fields })
  }

  const curE = new Map(current.edges.filter(isScannedEdge).map((e) => [e.id, e]))
  const nextE = new Map(scanned.edges.map((e) => [e.id, e]))
  const addedEdges = scanned.edges.filter((e) => !curE.has(e.id) && !current.edges.some((x) => x.id === e.id))
  const removedEdges = [...curE.values()].filter((e) => !nextE.has(e.id))
  const changedEdges: Change<IREdge>[] = []
  for (const [id, before] of curE) {
    const after = nextE.get(id)
    if (!after) continue
    const fields = EDGE_FIELDS.filter((f) => (before[f] ?? '') !== (after[f] ?? ''))
    if (fields.length) changedEdges.push({ before, after, fields })
  }

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, changedEdges }
}

/**
 * Merge a scan into the current project: scanned content is replaced by the new
 * scan, except fields the user edited; hand-made nodes/edges and pins are kept.
 */
export function applyRescan(current: CartographProject, scanned: IRDiagram): CartographProject {
  const d = current.diagram
  const curById = new Map(d.nodes.map((n) => [n.id, n]))
  const scannedIds = new Set(scanned.nodes.map((n) => n.id))

  const nodes: IRNode[] = []
  for (const s of scanned.nodes) {
    const before = curById.get(s.id)
    if (before && !isScannedNode(before)) {
      nodes.push(before) // a hand-made node owns this id; keep the user's
      continue
    }
    if (!before) {
      nodes.push(s)
      continue
    }
    const edited = editedFields(before)
    const merged: IRNode = { ...s, meta: { ...s.meta } }
    for (const f of edited) {
      if (before[f] === undefined) delete merged[f]
      else (merged as unknown as Record<string, unknown>)[f] = before[f]
    }
    if (edited.size) merged.meta!.edited = [...edited].sort().join(',')
    if (before.parent && !merged.parent) merged.parent = before.parent
    nodes.push(merged)
  }
  for (const n of d.nodes) if (!isScannedNode(n) && !scannedIds.has(n.id)) nodes.push(n)

  const alive = new Set(nodes.map((n) => n.id))
  const edges: IREdge[] = [...scanned.edges]
  const taken = new Set(edges.map((e) => e.id))
  for (const e of d.edges) {
    if (isScannedEdge(e) || taken.has(e.id)) continue
    if (alive.has(e.source) && alive.has(e.target)) edges.push(e)
  }

  const layout: CartographProject['layout'] = {}
  for (const [id, p] of Object.entries(current.layout)) if (alive.has(id) && p.pinned) layout[id] = p

  return {
    ...current,
    diagram: {
      ...d,
      nodes,
      edges: edges.filter((e) => alive.has(e.source) && alive.has(e.target)),
      origin: scanned.origin ?? d.origin,
    },
    layout,
  }
}
