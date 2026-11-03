/**
 * Mermaid → IR importer. Reads topology and meaning; does NOT copy styling.
 * Supports flowchart/graph → workflow, sequenceDiagram → sequence,
 * stateDiagram[-v2] → lifecycle.
 */
import { nanoid } from 'nanoid'
import { NODE_ROLES, defaultDirection, type DiagramType, type IRDiagram, type IREdge, type IRNode, type NodeRole } from '@shared/ir'

export class MermaidParseError extends Error {}

function detect(src: string): DiagramType {
  const head = src.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (head.startsWith('sequencediagram')) return 'sequence'
  if (head.startsWith('statediagram')) return 'lifecycle'
  return 'workflow'
}

function inferRole(shape: string, label: string): NodeRole {
  if (shape === 'diamond') return 'decision'
  if (shape === 'stadium' || shape === 'round') {
    if (/start|begin|end|done|stop|success|fail/i.test(label)) return 'terminal'
    return 'process'
  }
  if (shape === 'cylinder') return 'database'
  return 'process'
}

interface RawNode {
  id: string
  label: string
  shape: string
}

const NODE_RE = /([A-Za-z0-9_]+)\s*(\(\[|\[\[|\[\(|\[|\(\(|\(|\{|>)([^\]\)\}]*?)(\]\)|\]\]|\)\]|\]|\)\)|\)|\})/

function shapeOf(open: string): string {
  if (open === '{') return 'diamond'
  if (open === '([') return 'stadium'
  if (open === '((') return 'round'
  if (open === '(') return 'round'
  if (open === '[(') return 'cylinder'
  return 'box'
}

function extractNode(chunk: string, ensure: (id: string, label?: string, shape?: string) => void): string | null {
  const trimmed = chunk.trim()
  if (!trimmed) return null
  const m = trimmed.match(NODE_RE)
  if (m) {
    const id = m[1]
    const shape = shapeOf(m[2])
    const label = (m[3] || id).replace(/["']/g, '').trim()
    ensure(id, label, shape)
    return id
  }
  const idOnly = trimmed.match(/^([A-Za-z0-9_]+)/)
  if (idOnly) {
    ensure(idOnly[1])
    return idOnly[1]
  }
  return null
}

function parseFlowchart(src: string): IRDiagram {
  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean)
  const nodes = new Map<string, RawNode>()
  const edges: IREdge[] = []
  let direction: IRDiagram['direction'] = 'DOWN'

  const ensure = (id: string, label?: string, shape = 'box'): void => {
    if (!nodes.has(id)) nodes.set(id, { id, label: label ?? id, shape })
    else if (label) {
      const n = nodes.get(id)!
      n.label = label
      n.shape = shape
    }
  }

  // subgraph blocks become groups; `class a,b role` lines carry exact roles
  // (Cartographer writes these on export so a round trip keeps them).
  const groups: { id: string; label: string }[] = []
  const parentOf = new Map<string, string>()
  const roleOf = new Map<string, NodeRole>()
  const stack: string[] = []

  for (const raw of lines) {
    if (/^(flowchart|graph)\b/i.test(raw)) {
      const d = raw.split(/\s+/)[1]?.toUpperCase()
      direction = d === 'LR' ? 'RIGHT' : d === 'RL' ? 'LEFT' : d === 'BT' ? 'UP' : 'DOWN'
      continue
    }
    const sub = raw.match(/^subgraph\s+([A-Za-z0-9_]+)?\s*(?:\[\s*"?([^"\]]*)"?\s*\]|"([^"]*)")?/i)
    if (sub) {
      const gid = sub[1] ?? `group_${groups.length + 1}`
      const label = (sub[2] ?? sub[3] ?? sub[1] ?? gid).trim()
      groups.push({ id: gid, label })
      stack.push(gid)
      continue
    }
    if (/^end\b/i.test(raw)) {
      stack.pop()
      continue
    }
    const cls = raw.match(/^class\s+([A-Za-z0-9_,\s]+?)\s+([A-Za-z]+)\s*;?$/)
    if (cls) {
      if ((NODE_ROLES as readonly string[]).includes(cls[2])) for (const id of cls[1].split(',')) roleOf.set(id.trim(), cls[2] as NodeRole)
      continue
    }
    if (/^(%%|click|classDef|style|linkStyle)\b/i.test(raw)) continue

    const edgeMatch = raw.match(/(.+?)\s*(-{2,3}>|-\.->|={2,3}>|-{3}|-\.-)\s*(?:\|([^|]*)\|)?\s*(.+)/)
    if (edgeMatch) {
      const [, lhsRaw, arrow, elabel, rhsRaw] = edgeMatch
      const lhs = extractNode(lhsRaw, ensure)
      const rhs = extractNode(rhsRaw, ensure)
      if (lhs && rhs) {
        edges.push({
          id: nanoid(6),
          source: lhs,
          target: rhs,
          label: elabel?.replace(/["']/g, '').trim() || undefined,
          variant: /\./.test(arrow) ? 'dashed' : /=/.test(arrow) ? 'emphasis' : arrow === '---' ? 'weak' : 'default',
        })
        if (stack.length) for (const id of [lhs, rhs]) if (!parentOf.has(id)) parentOf.set(id, stack[stack.length - 1])
      }
      continue
    }
    const id = extractNode(raw, ensure)
    if (id && stack.length) parentOf.set(id, stack[stack.length - 1])
  }

  const groupIds = new Set(groups.map((g) => g.id))
  const irNodes: IRNode[] = [
    ...groups.map((g) => ({ id: g.id, label: g.label, role: 'group' as const })),
    ...[...nodes.values()]
      .filter((n) => !groupIds.has(n.id))
      .map((n) => {
        const node: IRNode = { id: n.id, label: n.label, role: roleOf.get(n.id) ?? inferRole(n.shape, n.label) }
        const parent = parentOf.get(n.id)
        if (parent) node.parent = parent
        return node
      }),
  ]
  return { id: 'imported', title: 'Imported flowchart', type: 'workflow', direction, nodes: irNodes, edges }
}

function parseSequence(src: string): IRDiagram {
  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean)
  const nodes = new Map<string, IRNode>()
  const edges: IREdge[] = []
  const ensure = (id: string): void => {
    if (!nodes.has(id)) nodes.set(id, { id, label: id, role: 'backend' })
  }

  for (const raw of lines) {
    if (/^sequenceDiagram/i.test(raw)) continue
    const part = raw.match(/^(participant|actor)\s+(.+)/i)
    if (part) {
      const decl = part[2]
      const asMatch = decl.match(/(.+?)\s+as\s+(.+)/i)
      const id = (asMatch ? asMatch[1] : decl).trim()
      const label = (asMatch ? asMatch[2] : decl).trim()
      nodes.set(id, { id, label, role: /^actor/i.test(part[1]) ? 'external' : 'backend' })
      continue
    }
    const msg = raw.match(/^([A-Za-z0-9_]+)\s*(-?-?>>?|--?>>?|-[>x)])\s*([A-Za-z0-9_]+)\s*:\s*(.+)/)
    if (msg) {
      const [, from, arrow, to, label] = msg
      ensure(from)
      ensure(to)
      edges.push({ id: nanoid(6), source: from, target: to, label: label.trim(), variant: /--/.test(arrow) ? 'dashed' : 'default' })
    }
  }
  return { id: 'imported', title: 'Imported sequence', type: 'sequence', direction: 'RIGHT', nodes: [...nodes.values()], edges }
}

function parseState(src: string): IRDiagram {
  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean)
  const nodes = new Map<string, IRNode>()
  const edges: IREdge[] = []
  let endCount = 0

  const ensureState = (id: string): string => {
    if (!nodes.has(id)) nodes.set(id, { id, label: id, role: 'state' })
    return id
  }
  const ensureTerminal = (id: string, label: string): string => {
    if (!nodes.has(id)) nodes.set(id, { id, label, role: 'terminal' })
    return id
  }

  for (const raw of lines) {
    if (/^stateDiagram(-v2)?/i.test(raw) || /^direction\b/i.test(raw)) continue
    // `state "Long label" as id` names a state.
    const decl = raw.match(/^state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_]+)\s*$/)
    if (decl) {
      const id = ensureState(decl[2])
      nodes.get(id)!.label = decl[1].trim()
      continue
    }
    const t = raw.match(/(.+?)\s*-->\s*([^:]+?)(?::\s*(.+))?$/)
    if (t) {
      const from = t[1].trim()
      const to = t[2].trim()
      const elabel = t[3]?.trim()
      const sourceId = from === '[*]' ? ensureTerminal('__start', 'start') : ensureState(from)
      const targetId = to === '[*]' ? ensureTerminal(`__end${endCount++}`, 'end') : ensureState(to)
      edges.push({ id: nanoid(6), source: sourceId, target: targetId, label: elabel || undefined })
    }
  }
  return { id: 'imported', title: 'Imported state machine', type: 'lifecycle', direction: 'DOWN', nodes: [...nodes.values()], edges }
}

export function mermaidToIR(src: string): IRDiagram {
  const cleaned = src.trim()
  if (!cleaned) throw new MermaidParseError('Empty input')
  const type = detect(cleaned)
  const d = type === 'sequence' ? parseSequence(cleaned) : type === 'lifecycle' ? parseState(cleaned) : parseFlowchart(cleaned)
  if (d.nodes.length === 0) throw new MermaidParseError('No nodes found — is this valid Mermaid?')
  d.direction = d.direction ?? defaultDirection(d.type)
  return d
}
