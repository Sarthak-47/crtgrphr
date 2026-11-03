import { NODE_ROLES, type EdgeVariant, type IRDiagram, type NodeRole } from '@shared/ir'

export interface LegendContent {
  roles: NodeRole[]
  variants: EdgeVariant[]
}

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
  return { roles, variants }
}
