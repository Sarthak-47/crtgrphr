import { NODE_ROLES, type EdgeVariant, type IRDiagram, type NodeRole } from '@shared/ir'

export interface LegendContent {
  roles: NodeRole[]
  variants: EdgeVariant[]
  /** some links were worked out by the scan rather than written down: their labels are italic */
  inferred: boolean
}

export const INFERRED_LABEL = 'italic label: inferred, not declared'

export const VARIANT_LABEL: Record<EdgeVariant, string> = {
  default: 'flow',
  emphasis: 'main path',
  dashed: 'async / optional',
  weak: 'structural',
}

/** Only what this map actually uses, in a stable order. */
export function legendContent(diagram: IRDiagram): LegendContent {
  const used = new Set(diagram.nodes.map((n) => n.role))
  const roles = NODE_ROLES.filter((r) => r !== 'group' && used.has(r))
  const usedV = new Set(diagram.edges.map((e) => e.variant ?? 'default'))
  const variants = (['default', 'emphasis', 'dashed', 'weak'] as const).filter((v) => usedV.has(v))
  return { roles, variants, inferred: diagram.edges.some((e) => e.confidence === 'inferred') }
}
