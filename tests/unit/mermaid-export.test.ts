import { describe, expect, it } from 'vitest'
import { diagramToMermaid } from '../../src/renderer/src/adapters/mermaid-export'
import { mermaidToIR } from '../../src/renderer/src/adapters/mermaid'
import { SAMPLES } from '../../src/renderer/src/adapters/samples'
import { shortestPath } from '../../src/renderer/src/graph/path'
import type { IRDiagram } from '../../src/shared/ir'

/** Topology by labels: which labelled nodes connect, with which edge labels. */
function topology(d: IRDiagram, opts: { dropTerminals?: boolean } = {}) {
  const label = new Map(d.nodes.map((n) => [n.id, n.role === 'terminal' && opts.dropTerminals ? '*' : n.label]))
  return d.edges.map((e) => `${label.get(e.source)} -> ${label.get(e.target)} [${e.label ?? ''}]`).sort()
}

describe('Mermaid export', () => {
  it('flowcharts keep nodes, edges, labels, edge styles, direction and roles through a round trip', () => {
    for (const d of [SAMPLES.webapp, SAMPLES.deploy, SAMPLES.analytics]) {
      const text = diagramToMermaid(d)
      expect(text.startsWith(`flowchart ${d.direction === 'DOWN' ? 'TD' : 'LR'}`)).toBe(true)
      const back = mermaidToIR(text)
      expect(back.direction).toBe(d.direction)
      expect(back.nodes).toHaveLength(d.nodes.length)
      expect(topology(back)).toEqual(topology({ ...d, nodes: d.nodes.map((n) => ({ ...n, label: n.sublabel ? `${n.label} - ${n.sublabel}` : n.label })) }))
      const role = (x: IRDiagram, l: string) => x.nodes.find((n) => n.label.startsWith(l))!.role
      for (const n of d.nodes) expect(role(back, n.label), n.label).toBe(n.role)
      const variants = (x: IRDiagram) => x.edges.map((e) => e.variant ?? 'default').sort()
      expect(variants(back)).toEqual(variants(d))
    }
  })

  it('groups become subgraphs and come back as groups with the same members', () => {
    const d: IRDiagram = {
      id: 'g',
      title: 'g',
      type: 'architecture',
      direction: 'RIGHT',
      nodes: [
        { id: 'grp-apps', label: 'apps/', role: 'group' },
        { id: 'web', label: 'web', role: 'frontend', parent: 'grp-apps' },
        { id: 'api', label: 'api', role: 'backend', parent: 'grp-apps' },
        { id: 'db', label: 'db', role: 'database' },
      ],
      edges: [
        { id: 'e1', source: 'web', target: 'api' },
        { id: 'e2', source: 'api', target: 'db' },
      ],
    }
    const text = diagramToMermaid(d)
    expect(text).toContain('subgraph grp_apps ["apps/"]')
    const back = mermaidToIR(text)
    const group = back.nodes.find((n) => n.role === 'group')!
    expect(group.label).toBe('apps/')
    expect(back.nodes.filter((n) => n.parent === group.id).map((n) => n.label).sort()).toEqual(['api', 'web'])
    expect(back.nodes.find((n) => n.label === 'db')!.parent).toBeUndefined()
  })

  it('sequences keep participant order, message order and replies', () => {
    const d = SAMPLES.cacheMiss
    const text = diagramToMermaid(d)
    expect(text.startsWith('sequenceDiagram')).toBe(true)
    const back = mermaidToIR(text)
    expect(back.nodes.map((n) => n.label)).toEqual(d.nodes.map((n) => n.label))
    expect(back.edges.map((e) => e.label)).toEqual(d.edges.map((e) => e.label))
    expect(back.edges.map((e) => e.variant === 'dashed')).toEqual(d.edges.map((e) => e.variant === 'dashed'))
  })

  it('lifecycles write start/end terminals as [*] and round-trip their transitions', () => {
    const d = SAMPLES.agentRun
    const text = diagramToMermaid(d)
    expect(text).toContain('[*] --> planning')
    expect(text).toContain('acting --> [*] : complete')
    const back = mermaidToIR(text)
    expect(topology(back, { dropTerminals: true })).toEqual(topology(d, { dropTerminals: true }))
  })

  it('makes unsafe ids and labels Mermaid-safe', () => {
    const d: IRDiagram = {
      id: 'x',
      title: 'x',
      type: 'architecture',
      direction: 'RIGHT',
      nodes: [
        { id: '1-api.v2', label: 'API "v2" [beta]', role: 'backend' },
        { id: 'end', label: 'End | stop', role: 'backend' },
      ],
      edges: [{ id: 'e', source: '1-api.v2', target: 'end', label: 'a|b' }],
    }
    const text = diagramToMermaid(d)
    expect(text).toContain('_1_api_v2["API v2 beta"]')
    expect(text).toContain('end_["End stop"]')
    expect(text).toContain('_1_api_v2 -->|"a b"| end_')
    const back = mermaidToIR(text)
    expect(back.nodes).toHaveLength(2)
    expect(back.edges).toHaveLength(1)
  })
})

describe('shortestPath', () => {
  it('finds the fewest-edges path in edge direction', () => {
    const p = shortestPath(SAMPLES.webapp, 'users', 'db')!
    expect(p.reversed).toBe(false)
    expect(p.nodes).toEqual(['users', 'cdn', 'web', 'api', 'db'])
    expect(p.edges).toEqual(['e1', 'e2', 'e3', 'e5'])
  })

  it('falls back to the reverse direction, and says so', () => {
    const p = shortestPath(SAMPLES.webapp, 'db', 'users')!
    expect(p.reversed).toBe(true)
    expect(p.nodes[0]).toBe('users')
  })

  it('returns null when the nodes are not connected', () => {
    const d: IRDiagram = { ...SAMPLES.webapp, nodes: [...SAMPLES.webapp.nodes, { id: 'lonely', label: 'L', role: 'backend' }] }
    expect(shortestPath(d, 'users', 'lonely')).toBeNull()
  })
})
