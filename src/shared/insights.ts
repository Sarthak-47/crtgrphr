/**
 * What a map says, in sentences: where traffic enters, what everything leans on,
 * which stores are shared, where messages flow, dependency cycles, and parts with
 * no links. Derived from the graph alone (never stored), so it is always current
 * and the same in the app, the CLI's Markdown and tests.
 *
 * A link from or to a whole group (a tier) counts for every part inside it.
 */
import type { IRDiagram, IRNode } from './ir'

export type InsightKind = 'entry' | 'hub' | 'shared-store' | 'async' | 'cycle' | 'unlinked'

export interface Insight {
  kind: InsightKind
  /** one short sentence */
  title: string
  /** why it matters, in a sentence */
  detail: string
  /** the parts it is about, to select or highlight them */
  nodes: string[]
}

const MAX = 8

/** A link found in code or a manifest (imports, `use`, a package dependency) rather than at runtime. */
const CODE_LINK = /import statement|\bfiles? uses? |\buses crate::|\bdepends on\b/i

function list(names: string[], max = 4): string {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? ''
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

export function insights(diagram: IRDiagram): Insight[] {
  if (diagram.type !== 'architecture' && diagram.type !== 'dataflow') return []
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]))
  const parts = diagram.nodes.filter((n) => n.role !== 'group')
  if (parts.length < 3) return []
  const name = (id: string): string => byId.get(id)?.label ?? id

  // Every part inside a group, at any depth.
  const children = new Map<string, string[]>()
  for (const n of diagram.nodes) if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id])
  const expand = (id: string): string[] => {
    if (byId.get(id)?.role !== 'group') return [id]
    return (children.get(id) ?? []).flatMap(expand)
  }
  const pairs: [string, string][] = []
  const codeIn = new Map<string, number>() // target → links into it found in code
  for (const e of diagram.edges) {
    const code = CODE_LINK.test(e.evidence ?? '')
    for (const s of expand(e.source)) for (const t of expand(e.target)) {
      if (s === t) continue
      pairs.push([s, t])
      if (code) codeIn.set(t, (codeIn.get(t) ?? 0) + 1)
    }
  }
  const out = new Map<string, Set<string>>()
  const inn = new Map<string, Set<string>>()
  for (const [s, t] of pairs) {
    if (!out.has(s)) out.set(s, new Set())
    if (!inn.has(t)) inn.set(t, new Set())
    out.get(s)!.add(t)
    inn.get(t)!.add(s)
  }
  const ins = (id: string) => [...(inn.get(id) ?? [])]
  const outs = (id: string) => [...(out.get(id) ?? [])]
  const isStore = (n: IRNode) => n.role === 'database' || n.role === 'cache'
  const found: Insight[] = []

  // Entry points: what outside callers reach first.
  const outside = parts.filter((n) => n.role === 'external' && ins(n.id).length === 0)
  const entry = [...new Set(outside.flatMap((n) => outs(n.id)))].filter((id) => byId.get(id)?.role !== 'external')
  if (entry.length) {
    found.push({
      kind: 'entry',
      title: `Traffic enters at ${list(entry.map(name))}`,
      detail: entry.length === 1 ? 'Every outside request passes through it: the place for auth, rate limits and TLS.' : 'Outside requests reach the system here; each is a front door to secure.',
      nodes: entry,
    })
  }

  // Hubs: a part most of the system depends on.
  const threshold = Math.max(3, Math.ceil(parts.length * 0.3))
  const hubs = parts
    .filter((n) => !isStore(n) && n.role !== 'external' && n.role !== 'queue')
    .map((n) => ({ n, deps: ins(n.id).filter((id) => byId.get(id)?.role !== 'external') }))
    .filter((h) => h.deps.length >= threshold)
    .sort((a, b) => b.deps.length - a.deps.length)
  for (const { n, deps } of hubs.slice(0, 3)) {
    // Mostly code dependencies: the risk is change, not downtime.
    const code = (codeIn.get(n.id) ?? 0) * 2 > ins(n.id).length
    found.push({
      kind: 'hub',
      title: `${deps.length} parts depend on ${n.label}`,
      detail: code
        ? 'A change to it reaches all of them: keep its interface small and stable, and test it well.'
        : 'If it is slow or down, so are they: a likely single point of failure worth redundancy and a health check.',
      nodes: [n.id, ...deps],
    })
  }

  // Stores more than one part writes to.
  for (const s of parts.filter(isStore)) {
    const users = ins(s.id)
    if (users.length < 2) continue
    found.push({
      kind: 'shared-store',
      title: `${s.label} is shared by ${list(users.map(name))}`,
      detail: `A schema change to this ${s.role === 'cache' ? 'cache' : 'database'} touches ${users.length === 2 ? 'both' : `all ${users.length}`} of them, and they can contend for it.`,
      nodes: [s.id, ...users],
    })
  }

  // Message flows through queues.
  for (const q of parts.filter((n) => n.role === 'queue')) {
    const ends = [...new Set([...ins(q.id), ...outs(q.id)])]
    if (!ends.length) continue
    found.push({
      kind: 'async',
      title: ends.length === 1 ? `${name(ends[0])} sends or receives messages through ${q.label}` : `${list(ends.map(name))} talk through ${q.label}`,
      detail: 'Asynchronous: senders don’t wait for receivers, so failures show up as backlog rather than errors.',
      nodes: [q.id, ...ends],
    })
  }

  // Dependency cycles (strongly connected components larger than one part).
  for (const comp of cycles(parts.map((n) => n.id), outs).slice(0, 2)) {
    found.push({
      kind: 'cycle',
      title: `${list(comp.map(name))} depend on each other`,
      detail: 'A cycle: none of them can change, deploy or be tested alone. Breaking one link usually untangles it.',
      nodes: comp,
    })
  }

  // Parts with no links at all (only meaningful when the map has links).
  if (pairs.length) {
    const lonely = parts.filter((n) => !inn.has(n.id) && !out.has(n.id)).map((n) => n.id)
    if (lonely.length) {
      found.push({
        kind: 'unlinked',
        title: `No links found for ${list(lonely.map(name))}`,
        detail: 'The scan saw nothing connecting to or from these; they may connect through settings it doesn’t read. Draw the link if you know it.',
        nodes: lonely,
      })
    }
  }

  return found.slice(0, MAX)
}

/** Tarjan's strongly connected components, keeping those with more than one member. */
function cycles(ids: string[], next: (id: string) => string[]): string[][] {
  let index = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const on = new Set<string>()
  const result: string[][] = []
  const visit = (v: string): void => {
    idx.set(v, index)
    low.set(v, index++)
    stack.push(v)
    on.add(v)
    for (const w of next(v)) {
      if (!idx.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!))
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = []
      let w: string
      do {
        w = stack.pop()!
        on.delete(w)
        comp.push(w)
      } while (w !== v)
      if (comp.length > 1) result.push(comp.reverse())
    }
  }
  for (const v of ids) if (!idx.has(v)) visit(v)
  return result.sort((a, b) => b.length - a.length)
}
