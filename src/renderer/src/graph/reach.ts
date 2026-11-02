import type { IRDiagram } from '@shared/ir'

/** Edge ids reachable from `start` following direction (downstream) or reversed. */
export function reachEdges(diagram: IRDiagram, start: string, dir: 'downstream' | 'upstream'): Set<string> {
  const adj = new Map<string, { edgeId: string; next: string }[]>()
  for (const e of diagram.edges) {
    const from = dir === 'downstream' ? e.source : e.target
    const to = dir === 'downstream' ? e.target : e.source
    const arr = adj.get(from) ?? []
    arr.push({ edgeId: e.id, next: to })
    adj.set(from, arr)
  }
  const seenEdges = new Set<string>()
  const seenNodes = new Set<string>([start])
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()!
    for (const { edgeId, next } of adj.get(cur) ?? []) {
      seenEdges.add(edgeId)
      if (!seenNodes.has(next)) {
        seenNodes.add(next)
        stack.push(next)
      }
    }
  }
  return seenEdges
}

/** Nodes reachable (inclusive of start) in a direction. */
export function reachNodes(diagram: IRDiagram, start: string, dir: 'downstream' | 'upstream'): Set<string> {
  const adj = new Map<string, string[]>()
  for (const e of diagram.edges) {
    const from = dir === 'downstream' ? e.source : e.target
    const to = dir === 'downstream' ? e.target : e.source
    const arr = adj.get(from) ?? []
    arr.push(to)
    adj.set(from, arr)
  }
  const seen = new Set<string>([start])
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()!
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return seen
}
