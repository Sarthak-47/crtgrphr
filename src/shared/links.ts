/**
 * How a link is drawn, from what it connects. Shared by the canvas, the SVG and
 * draw.io exports and the legend so they always agree.
 *
 * - A link to or from a queue is a message, not a call: drawn dashed (async).
 * - A link into a database or cache is data access: drawn in the store's colour,
 *   so every line into Postgres reads as "Postgres" at a glance.
 * - Anything else takes the colour of the part it starts from.
 * An explicit variant on the link always wins.
 */
import type { EdgeVariant, IREdge, NodeRole } from './ir'

export function linkVariant(e: IREdge, roleOf: Map<string, NodeRole>): EdgeVariant {
  if (e.variant) return e.variant
  return roleOf.get(e.target) === 'queue' || roleOf.get(e.source) === 'queue' ? 'dashed' : 'default'
}

/** The role whose accent colours this link. */
export function linkColorRole(e: IREdge, roleOf: Map<string, NodeRole>): NodeRole {
  const target = roleOf.get(e.target)
  if (target === 'database' || target === 'cache') return target
  const source = roleOf.get(e.source)
  return source && source !== 'group' ? source : 'backend'
}
