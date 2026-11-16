/**
 * What a screen reader says for each part and link of the map. React Flow reads
 * these as the elements' accessible names (nodes and links are focusable with Tab).
 */
import type { IRDiagram, IREdge, IRNode } from '@shared/ir'
import { LIGHT } from '@shared/roles'
import { HIDDEN_COUNT } from '@shared/collapse'
import { nodeFacts } from '@shared/facts'

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

export interface Degree {
  in: Map<string, number>
  out: Map<string, number>
}

export function degrees(d: IRDiagram): Degree {
  const deg: Degree = { in: new Map(), out: new Map() }
  for (const e of d.edges) {
    deg.out.set(e.source, (deg.out.get(e.source) ?? 0) + 1)
    deg.in.set(e.target, (deg.in.get(e.target) ?? 0) + 1)
  }
  return deg
}

/** "api, Backend, Node.js · 12 files, 2 links in, 3 out" */
export function describeNode(n: IRNode, deg: Degree): string {
  const parts = [n.label || 'Unnamed part', LIGHT[n.role]?.label ?? n.role]
  if (n.sublabel) parts.push(n.sublabel)
  const hidden = Number(n.meta?.[HIDDEN_COUNT] ?? 0)
  if (hidden) parts.push(`collapsed group of ${plural(hidden, 'part')}, press Enter to expand`)
  const facts = nodeFacts(n)
  if (facts.length) parts.push(facts.join(', '))
  const i = deg.in.get(n.id) ?? 0
  const o = deg.out.get(n.id) ?? 0
  parts.push(i || o ? `${plural(i, 'link')} in, ${o} out` : 'no links')
  return parts.join(', ')
}

/** "group apps, 3 parts, press Enter to collapse" */
export function describeGroup(label: string, members: number): string {
  return `group ${label || 'unnamed'}, ${plural(members, 'part')}, press Enter to collapse`
}

/** "web to api, HTTP, inferred" */
export function describeEdge(e: IREdge, labelOf: (id: string) => string): string {
  const parts = [`${labelOf(e.source)} to ${labelOf(e.target)}`]
  if (e.label) parts.push(e.label)
  if (e.confidence === 'inferred') parts.push('inferred')
  return parts.join(', ')
}

/** Instructions React Flow reads after a focused part's or link's name. */
export const ARIA_LABELS = {
  'node.a11yDescription.default':
    'Press Enter to rename the part, or to expand or collapse a group. Arrow keys move the part and pin it. Delete removes it.',
  'node.a11yDescription.keyboardDisabled': 'Press Enter to rename the part, or to expand or collapse a group.',
  'edge.a11yDescription.default': 'Selected link. The inspector shows its label and evidence. Delete removes it.',
} as const
