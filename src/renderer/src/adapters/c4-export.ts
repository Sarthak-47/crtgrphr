/**
 * IR → C4 model as C4-PlantUML (a container diagram). C4 is the notation many
 * architecture teams standardise on; C4-PlantUML ships with PlantUML itself
 * (`!include <C4/C4_Container>`), so the output renders offline, in IDE plugins,
 * Confluence/GitLab PlantUML integrations and docs-as-code pipelines.
 *
 * Mapping: frontend/backend/service/process/cloud → Container, database/cache →
 * ContainerDb, queue → ContainerQueue, external → System_Ext, groups →
 * System_Boundary. The sublabel becomes the technology. Edges become Rel with
 * their label (or "Uses"). Diagram types that are not architecture still export,
 * as containers and relations.
 */
import type { IRDiagram, IRNode } from '@shared/ir'

/** PlantUML aliases: letters, digits and underscores, unique, not starting with a digit. */
function aliasMaker(): (id: string) => string {
  const seen = new Map<string, string>()
  const used = new Set<string>()
  return (id: string) => {
    const known = seen.get(id)
    if (known) return known
    let a = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'node'
    let i = 2
    const baseA = a
    while (used.has(a)) a = `${baseA}_${i++}`
    used.add(a)
    seen.set(id, a)
    return a
  }
}

const q = (s: string): string => `"${s.replace(/"/g, "'").replace(/\r?\n/g, ' ')}"`

function element(n: IRNode, alias: string): string {
  const tech = n.sublabel ?? ''
  switch (n.role) {
    case 'database':
    case 'cache':
      return `ContainerDb(${alias}, ${q(n.label)}, ${q(tech)}, ${q(n.role === 'cache' ? 'Cache' : '')})`
    case 'queue':
      return `ContainerQueue(${alias}, ${q(n.label)}, ${q(tech)})`
    case 'external':
      return `System_Ext(${alias}, ${q(n.label)}, ${q(tech)})`
    case 'cloud':
      return `Container(${alias}, ${q(n.label)}, ${q(tech || 'Gateway')})`
    default:
      return `Container(${alias}, ${q(n.label)}, ${q(tech)})`
  }
}

export function diagramToC4PlantUml(d: IRDiagram): string {
  const alias = aliasMaker()
  const out: string[] = ['@startuml', '!include <C4/C4_Container>', '', `title ${d.title.replace(/\r?\n/g, ' ')}`]
  if (d.subtitle) out.push(`caption ${d.subtitle.replace(/\r?\n/g, ' ')}`)
  if (d.direction === 'RIGHT' || d.direction === 'LEFT') out.push('LAYOUT_LEFT_RIGHT()')
  else out.push('LAYOUT_TOP_DOWN()')
  out.push('')

  const groups = d.nodes.filter((n) => n.role === 'group')
  const inGroup = new Set(groups.map((g) => g.id))
  for (const g of groups) {
    const members = d.nodes.filter((n) => n.parent === g.id && n.role !== 'group')
    if (members.length === 0) continue
    out.push(`System_Boundary(${alias(g.id)}, ${q(g.label)}) {`)
    for (const m of members) out.push(`  ${element(m, alias(m.id))}`)
    out.push('}', '')
  }
  for (const n of d.nodes) {
    if (n.role === 'group' || (n.parent && inGroup.has(n.parent))) continue
    out.push(element(n, alias(n.id)))
  }
  out.push('')
  const ids = new Set(d.nodes.filter((n) => n.role !== 'group').map((n) => n.id))
  for (const e of d.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    // Dashed (async / optional) relations are drawn dashed through a C4 tag.
    const dashed = e.variant === 'dashed' || e.variant === 'weak'
    out.push(`Rel(${alias(e.source)}, ${alias(e.target)}, ${q(e.label ?? 'Uses')}${dashed ? ', $tags="async"' : ''})`)
  }
  if (d.edges.some((e) => e.variant === 'dashed' || e.variant === 'weak')) {
    out.splice(2, 0, 'AddRelTag("async", $lineStyle = DashedLine())')
  }
  out.push('', 'SHOW_LEGEND()', '@enduml', '')
  return out.join('\n')
}
