/**
 * Drill-down: a group can be collapsed into one box. The IR keeps every member
 * (so re-scans, diffs and exports of the full map still work); what is drawn is
 * the *visible* diagram derived here.
 *
 * In the visible diagram a collapsed group becomes an ordinary node with the same
 * id, labelled with its member count. Edges to or from its members are re-pointed
 * at it (duplicates merged, edges inside the group dropped). Hidden members keep
 * their layout entries, so expanding a group puts them back where they were.
 */
import type { IRDiagram, IREdge, IRNode, NodeRole } from './ir'

/** meta key on a visible stand-in node: how many members it hides */
export const HIDDEN_COUNT = 'hidden'

export const isCollapsedGroup = (n: IRNode): boolean => n.role === 'group' && !!n.collapsed

/** The most common role among the members, so the box still says what it holds. */
function dominantRole(members: IRNode[]): NodeRole {
  const count = new Map<NodeRole, number>()
  for (const m of members) count.set(m.role, (count.get(m.role) ?? 0) + 1)
  let best: NodeRole = 'service'
  let max = 0
  for (const [role, k] of count) if (k > max) [best, max] = [role, k]
  return best
}

/** Members of each collapsed group, by group id (direct members only; groups don't nest). */
export function collapsedMembers(d: IRDiagram): Map<string, IRNode[]> {
  const collapsed = new Set(d.nodes.filter(isCollapsedGroup).map((n) => n.id))
  const out = new Map<string, IRNode[]>()
  for (const n of d.nodes) {
    if (n.parent && collapsed.has(n.parent)) {
      const arr = out.get(n.parent) ?? []
      arr.push(n)
      out.set(n.parent, arr)
    }
  }
  return out
}

/** Which visible node stands for `id` (itself, or the collapsed group hiding it). */
export function visibleIdMap(d: IRDiagram): Map<string, string> {
  const map = new Map<string, string>()
  for (const [g, members] of collapsedMembers(d)) for (const m of members) map.set(m.id, g)
  return map
}

export function hasCollapsed(d: IRDiagram): boolean {
  return d.nodes.some(isCollapsedGroup)
}

/** The diagram as drawn. Returns `d` itself when nothing is collapsed. */
export function visibleDiagram(d: IRDiagram): IRDiagram {
  const members = collapsedMembers(d)
  if (members.size === 0) {
    // A collapsed group with no members is just an empty frame: draw nothing special.
    return hasCollapsed(d) ? { ...d, nodes: d.nodes.map((n) => (n.collapsed ? { ...n, collapsed: undefined } : n)) } : d
  }
  const hidden = visibleIdMap(d)
  const nodes: IRNode[] = []
  for (const n of d.nodes) {
    if (hidden.has(n.id)) continue
    const ms = members.get(n.id)
    if (ms) {
      const stand: IRNode = {
        id: n.id,
        label: n.label,
        sublabel: `${ms.length} part${ms.length === 1 ? '' : 's'}, collapsed`,
        role: dominantRole(ms),
        meta: { ...(n.meta ?? {}), [HIDDEN_COUNT]: String(ms.length) },
      }
      if (n.parent) stand.parent = n.parent
      nodes.push(stand)
    } else nodes.push(n)
  }

  const edges: IREdge[] = []
  const merged = new Map<string, { edge: IREdge; count: number; labels: Set<string>; declared: boolean; inferred: boolean }>()
  for (const e of d.edges) {
    const s = hidden.get(e.source) ?? e.source
    const t = hidden.get(e.target) ?? e.target
    if (s === e.source && t === e.target) {
      edges.push(e)
      continue
    }
    if (s === t) continue // inside one collapsed group
    const key = `${s}->${t}`
    const m = merged.get(key)
    if (m) {
      m.count++
      if (e.label) m.labels.add(e.label)
      if (e.confidence === 'declared') m.declared = true
      if (e.confidence === 'inferred') m.inferred = true
    } else {
      merged.set(key, {
        edge: { id: `${s}=>${t}`, source: s, target: t, ...(e.variant ? { variant: e.variant } : {}) },
        count: 1,
        labels: new Set(e.label ? [e.label] : []),
        declared: e.confidence === 'declared',
        inferred: e.confidence === 'inferred',
      })
    }
  }
  const direct = new Set(edges.map((e) => `${e.source}->${e.target}`))
  for (const [key, { edge, count, labels, declared, inferred }] of merged) {
    if (direct.has(key)) continue
    if (count > 1) edge.label = `${count} links`
    else if (labels.size === 1) edge.label = [...labels][0]
    // One declared link is enough for the combined link to be declared.
    if (declared) edge.confidence = 'declared'
    else if (inferred) edge.confidence = 'inferred'
    if (count > 1) edge.evidence = `${count} links between parts of a collapsed group; expand it to see each`
    edges.push(edge)
  }
  return { ...d, nodes, edges }
}

/** Number of non-group nodes a viewer actually sees. */
export function visibleCount(d: IRDiagram): number {
  return visibleDiagram(d).nodes.filter((n) => n.role !== 'group').length
}
