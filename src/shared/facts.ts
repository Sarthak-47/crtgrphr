/**
 * Facts a scan found about a part (replicas, persistent storage, health checks,
 * autoscaling), kept in node.meta so they need no schema change and never count
 * as drift. Drawn as small tags on the box, on the canvas and in exports.
 */
import type { IRNode } from './ir'

export const FACTS = 'facts'
export const FACT_SEP = '|'

export function nodeFacts(n: IRNode): string[] {
  const raw = n.meta?.[FACTS]
  return raw ? raw.split(FACT_SEP).filter(Boolean) : []
}
