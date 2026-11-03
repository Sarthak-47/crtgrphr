import type { IRDiagram } from '@shared/ir'

export interface FoundPath {
  /** node ids from start to end, inclusive */
  nodes: string[]
  /** edge ids along the path, in order */
  edges: string[]
  /** true when only a path from `to` back to `from` exists */
  reversed: boolean
}

function bfs(diagram: IRDiagram, from: string, to: string): { nodes: string[]; edges: string[] } | null {
  if (from === to) return { nodes: [from], edges: [] }
  const out = new Map<string, { edge: string; next: string }[]>()
  for (const e of diagram.edges) {
    const list = out.get(e.source) ?? []
    list.push({ edge: e.id, next: e.target })
    out.set(e.source, list)
  }
  const prev = new Map<string, { node: string; edge: string }>()
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const { edge, next } of out.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, { node: cur, edge })
      if (next === to) {
        const nodes = [to]
        const edges: string[] = []
        let at = to
        while (at !== from) {
          const p = prev.get(at)!
          edges.unshift(p.edge)
          nodes.unshift(p.node)
          at = p.node
        }
        return { nodes, edges }
      }
      queue.push(next)
    }
  }
  return null
}

/**
 * Shortest directed path from `from` to `to` (fewest edges). If there is none,
 * the shortest path the other way round, marked as reversed. Null if neither.
 */
export function shortestPath(diagram: IRDiagram, from: string, to: string): FoundPath | null {
  const fwd = bfs(diagram, from, to)
  if (fwd) return { ...fwd, reversed: false }
  const back = bfs(diagram, to, from)
  return back ? { ...back, reversed: true } : null
}
