import { describe, expect, it } from 'vitest'
import { mermaidToIR, MermaidParseError } from '../../src/renderer/src/adapters/mermaid'
import { sanitizeDiagram } from '../../src/shared/serialize'

const edge = (d: ReturnType<typeof mermaidToIR>, s: string, t: string) => d.edges.find((e) => e.source === s && e.target === t)

describe('mermaidToIR', () => {
  it('flowchart: shapes become roles, arrows become variants, labels survive', () => {
    const d = mermaidToIR(`flowchart LR
      S([Start]) --> A[Build]
      A -->|ok| G{Tests pass?}
      G -.-> F[(Cache)]
      G ==> P[Deploy]
      %% a comment
      classDef x fill:#f00`)
    expect(d.type).toBe('workflow')
    expect(d.direction).toBe('RIGHT')
    expect(d.nodes.find((n) => n.id === 'S')).toMatchObject({ label: 'Start', role: 'terminal' })
    expect(d.nodes.find((n) => n.id === 'G')).toMatchObject({ label: 'Tests pass?', role: 'decision' })
    expect(d.nodes.find((n) => n.id === 'F')!.role).toBe('database')
    expect(edge(d, 'A', 'G')!.label).toBe('ok')
    expect(edge(d, 'G', 'F')!.variant).toBe('dashed')
    expect(edge(d, 'G', 'P')!.variant).toBe('emphasis')
    expect(sanitizeDiagram(d).fixes).toEqual([])
  })

  it('graph TD is top-down; later declarations refine earlier bare ids', () => {
    const d = mermaidToIR('graph TD\n  A --> B\n  B[Real label]')
    expect(d.direction).toBe('DOWN')
    expect(d.nodes.find((n) => n.id === 'B')!.label).toBe('Real label')
  })

  it('sequenceDiagram: participants, actors, aliases and dashed replies', () => {
    const d = mermaidToIR(`sequenceDiagram
      actor U as User
      participant API as Gateway
      U->>API: GET /items
      API-->>U: 200 OK`)
    expect(d.type).toBe('sequence')
    expect(d.nodes.find((n) => n.id === 'U')).toMatchObject({ label: 'User', role: 'external' })
    expect(d.nodes.find((n) => n.id === 'API')!.label).toBe('Gateway')
    expect(edge(d, 'API', 'U')).toMatchObject({ label: '200 OK', variant: 'dashed' })
  })

  it('stateDiagram: [*] becomes distinct start and end terminals', () => {
    const d = mermaidToIR(`stateDiagram-v2
      [*] --> Idle
      Idle --> Running : start
      Running --> [*]
      Idle --> [*]`)
    expect(d.type).toBe('lifecycle')
    const terminals = d.nodes.filter((n) => n.role === 'terminal')
    expect(terminals.map((n) => n.label).sort()).toEqual(['end', 'end', 'start'])
    expect(edge(d, 'Idle', 'Running')!.label).toBe('start')
    expect(sanitizeDiagram(d).fixes).toEqual([])
  })

  it('rejects empty or node-less input', () => {
    expect(() => mermaidToIR('   ')).toThrow(MermaidParseError)
    expect(() => mermaidToIR('flowchart LR\n%% nothing')).toThrow(/No nodes/)
  })
})
