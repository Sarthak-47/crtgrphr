import { describe, expect, it } from 'vitest'
import type { IRDiagram } from '../../src/shared/ir'
import { degrees, describeEdge, describeGroup, describeNode } from '../../src/renderer/src/canvas/a11y'

const d: IRDiagram = {
  id: 'm',
  title: 'm',
  type: 'architecture',
  nodes: [
    { id: 'web', label: 'web', role: 'frontend', sublabel: 'React' },
    { id: 'api', label: 'api', role: 'backend', meta: { facts: 'used by 9 parts' } },
    { id: 'db', label: 'db', role: 'database' },
    { id: 'lone', label: '', role: 'service' },
    { id: 'libs', label: 'libs', role: 'group', meta: { hidden: '4' } },
  ],
  edges: [
    { id: 'e1', source: 'web', target: 'api', label: 'HTTP' },
    { id: 'e2', source: 'api', target: 'db', confidence: 'inferred' },
  ],
}

describe('screen-reader names for the canvas', () => {
  const deg = degrees(d)
  it('names a part by label, kind, details and links', () => {
    expect(describeNode(d.nodes[0], deg)).toBe('web, Frontend, React, 0 links in, 1 out')
    expect(describeNode(d.nodes[1], deg)).toBe('api, Backend, used by 9 parts, 1 link in, 1 out')
    expect(describeNode(d.nodes[3], deg)).toBe('Unnamed part, Service, no links')
  })

  it('says a collapsed group can be expanded', () => {
    expect(describeNode(d.nodes[4], deg)).toMatch(/collapsed group of 4 parts, press Enter to expand/)
    expect(describeGroup('apps', 1)).toBe('group apps, 1 part, press Enter to collapse')
  })

  it('names a link by its ends, label and confidence', () => {
    const label = (id: string): string => d.nodes.find((n) => n.id === id)!.label
    expect(describeEdge(d.edges[0], label)).toBe('web to api, HTTP')
    expect(describeEdge(d.edges[1], label)).toBe('api to db, inferred')
  })
})
