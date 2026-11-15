/**
 * IR → Mermaid text. Architecture, workflow and dataflow maps become flowcharts
 * (with subgraphs for groups and `class` lines that carry each node's role, so
 * re-importing keeps them); sequences become sequenceDiagram; lifecycles become
 * stateDiagram-v2, with start/end terminals written as [*].
 */
import type { Direction, IRDiagram, IREdge, IRNode, NodeRole } from '@shared/ir'

const FLOW_DIR: Record<Direction, string> = { RIGHT: 'LR', LEFT: 'RL', DOWN: 'TD', UP: 'BT' }

/** Mermaid-safe, unique identifiers for every node id. */
function idMap(nodes: IRNode[]): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const n of nodes) {
    let base = n.id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'node'
    if (/^(end|subgraph|graph|flowchart|class|style|click|state)$/i.test(base)) base = `${base}_`
    let id = base
    let i = 2
    while (used.has(id)) id = `${base}_${i++}`
    used.add(id)
    out.set(n.id, id)
  }
  return out
}

/** Message and participant text in sequence diagrams: only line breaks, ';' and '#' break it. */
const cleanText = (s: string): string => s.replace(/[;#\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || ' '

/** Text Mermaid can hold inside quotes or a label: no quotes, brackets or pipes. */
const clean = (s: string): string => s.replace(/["[\]{}()|<>#;]/g, ' ').replace(/\s+/g, ' ').trim() || ' '

const SHAPE: Partial<Record<NodeRole, [string, string]>> = {
  decision: ['{', '}'],
  database: ['[(', ')]'],
  cache: ['[(', ')]'],
  terminal: ['([', '])'],
  state: ['([', '])'],
}

function arrow(e: IREdge): string {
  switch (e.variant) {
    case 'emphasis':
      return '==>'
    case 'dashed':
      return '-.->'
    case 'weak':
      return '---'
    default:
      return '-->'
  }
}

export type DriftKind = 'added' | 'removed' | 'changed'

function flowchart(d: IRDiagram, highlight?: Map<string, DriftKind>): string {
  const ids = idMap(d.nodes)
  const lines = [`flowchart ${FLOW_DIR[d.direction ?? 'RIGHT']}`]
  const nodeLine = (n: IRNode, indent: string) => {
    const [open, close] = SHAPE[n.role] ?? ['[', ']']
    const text = n.sublabel ? `${clean(n.label)} - ${clean(n.sublabel)}` : clean(n.label)
    return `${indent}${ids.get(n.id)}${open}"${text}"${close}`
  }
  const groups = d.nodes.filter((n) => n.role === 'group')
  const groupIds = new Set(groups.map((g) => g.id))
  for (const g of groups) {
    const members = d.nodes.filter((n) => n.parent === g.id && n.role !== 'group')
    if (!members.length) continue
    lines.push(`  subgraph ${ids.get(g.id)} ["${clean(g.label)}"]`)
    for (const m of members) lines.push(nodeLine(m, '    '))
    lines.push('  end')
  }
  for (const n of d.nodes) {
    if (n.role === 'group' || (n.parent && groupIds.has(n.parent))) continue
    lines.push(nodeLine(n, '  '))
  }
  const linkIndex = new Map<string, number>() // edge id → Mermaid link number, for linkStyle
  for (const e of d.edges) {
    const s = ids.get(e.source)
    const t = ids.get(e.target)
    if (!s || !t || groupIds.has(e.source) || groupIds.has(e.target)) continue
    linkIndex.set(e.id, linkIndex.size)
    lines.push(`  ${s} ${arrow(e)}${e.label ? `|"${clean(e.label)}"|` : ''} ${t}`)
  }
  if (highlight) {
    // Drift: colour what was added, removed or changed (GitHub renders this in PRs).
    lines.push(
      '  classDef added fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d',
      '  classDef removed fill:#fee2e2,stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 4,color:#7f1d1d',
      '  classDef changed fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f',
    )
    for (const kind of ['added', 'removed', 'changed'] as const) {
      const marked = d.nodes.filter((n) => n.role !== 'group' && highlight.get(n.id) === kind).map((n) => ids.get(n.id)!)
      if (marked.length) lines.push(`  class ${marked.join(',')} ${kind}`)
    }
    const LINK = {
      added: 'stroke:#16a34a,stroke-width:2.5px',
      removed: 'stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 4',
      changed: 'stroke:#d97706,stroke-width:2.5px',
    }
    for (const [id, n] of linkIndex) {
      const kind = highlight.get(id)
      if (kind) lines.push(`  linkStyle ${n} ${LINK[kind]}`)
    }
  }
  // Roles, so re-importing into Cartographer keeps them (Mermaid ignores unknown classes).
  const byRole = new Map<NodeRole, string[]>()
  for (const n of d.nodes) {
    if (n.role === 'group') continue
    const list = byRole.get(n.role) ?? []
    list.push(ids.get(n.id)!)
    byRole.set(n.role, list)
  }
  if (!highlight) for (const [role, list] of byRole) lines.push(`  class ${list.join(',')} ${role}`)
  return lines.join('\n') + '\n'
}

/**
 * A flowchart of a map with what changed highlighted: added in green, removed in
 * red (dashed), changed in amber. Used for drift reports in pull requests.
 */
export function driftToMermaid(d: IRDiagram, highlight: Map<string, DriftKind>): string {
  return flowchart(d, highlight)
}

function sequence(d: IRDiagram): string {
  const ids = idMap(d.nodes)
  const lines = ['sequenceDiagram']
  for (const n of d.nodes) {
    if (n.role === 'group') continue
    lines.push(`  ${n.role === 'external' ? 'actor' : 'participant'} ${ids.get(n.id)} as ${cleanText(n.label)}`)
  }
  for (const e of d.edges) {
    const a = e.variant === 'dashed' ? '-->>' : '->>'
    lines.push(`  ${ids.get(e.source)}${a}${ids.get(e.target)}: ${e.label ? cleanText(e.label) : ' '}`)
  }
  return lines.join('\n') + '\n'
}

function lifecycle(d: IRDiagram): string {
  const ids = idMap(d.nodes)
  const indeg = new Map<string, number>()
  const outdeg = new Map<string, number>()
  for (const e of d.edges) {
    outdeg.set(e.source, (outdeg.get(e.source) ?? 0) + 1)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  // Terminals with no way in are start points, with no way out are end points: both are [*].
  const star = (n: IRNode | undefined, asTarget: boolean) =>
    n?.role === 'terminal' && (asTarget ? !outdeg.get(n.id) : !indeg.get(n.id)) ? '[*]' : undefined
  const lines = ['stateDiagram-v2']
  if (d.direction === 'RIGHT' || d.direction === 'LEFT') lines.push('  direction LR')
  for (const n of d.nodes) {
    if (n.role === 'group') continue
    if (n.role === 'terminal' && (!indeg.get(n.id) || !outdeg.get(n.id))) continue
    lines.push(`  state "${clean(n.label)}" as ${ids.get(n.id)}`)
  }
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  for (const e of d.edges) {
    const s = star(byId.get(e.source), false) ?? ids.get(e.source)
    const t = star(byId.get(e.target), true) ?? ids.get(e.target)
    lines.push(`  ${s} --> ${t}${e.label ? ` : ${clean(e.label)}` : ''}`)
  }
  return lines.join('\n') + '\n'
}

export function diagramToMermaid(d: IRDiagram): string {
  if (d.type === 'sequence') return sequence(d)
  if (d.type === 'lifecycle') return lifecycle(d)
  return flowchart(d)
}
