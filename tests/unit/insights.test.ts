import { describe, expect, it } from 'vitest'
import { insights } from '../../src/shared/insights'
import type { IRDiagram, IRNode, NodeRole } from '../../src/shared/ir'

const n = (id: string, role: NodeRole, parent?: string): IRNode => ({ id, label: id, role, ...(parent ? { parent } : {}) })
const map = (nodes: IRNode[], edges: [string, string, string?][]): IRDiagram => ({
  id: 'm', title: 'm', type: 'architecture', nodes,
  edges: edges.map(([source, target, evidence], i) => ({ id: `e${i}`, source, target, ...(evidence ? { evidence } : {}) })),
})

describe('map insights', () => {
  const d = map(
    [n('internet', 'external'), n('gw', 'cloud'), n('tier', 'group'), n('a', 'backend', 'tier'), n('b', 'backend', 'tier'), n('c', 'backend', 'tier'),
      n('config', 'backend'), n('db', 'database'), n('mq', 'queue'), n('grafana', 'service')],
    [['internet', 'gw'], ['gw', 'a'], ['tier', 'config'], ['gw', 'config'], ['a', 'db'], ['b', 'db'], ['b', 'mq'], ['c', 'mq']],
  )
  const kinds = (x: IRDiagram) => insights(x).map((i) => i.kind)

  it('finds the entry point, the hub (counting a tier link for each member), the shared store, the queue and the loner', () => {
    expect(kinds(d)).toEqual(['entry', 'hub', 'shared-store', 'async', 'unlinked'])
    const [entry, hub, store, async, lone] = insights(d)
    expect(entry.title).toBe('Traffic enters at gw')
    expect(hub.title).toBe('4 parts depend on config')
    expect(hub.nodes.sort()).toEqual(['a', 'b', 'c', 'config', 'gw'])
    expect(hub.detail).toMatch(/single point of failure/)
    expect(store.title).toBe('db is shared by a and b')
    expect(store.detail).toMatch(/both/)
    expect(async.title).toBe('b and c talk through mq')
    expect(lone.nodes).toEqual(['grafana'])
  })

  it('words a code hub as a change risk, and finds import cycles', () => {
    const code = map(
      [n('ui', 'frontend'), n('core', 'backend'), n('util', 'backend'), n('cli', 'backend'), n('shared', 'backend')],
      [['ui', 'shared', '3 import statements'], ['core', 'shared', '2 import statements'], ['cli', 'shared', '1 import statement'],
        ['core', 'util', '1 import statement'], ['util', 'core', '1 import statement']],
    )
    const out = insights(code)
    expect(out.find((i) => i.kind === 'hub')!.detail).toMatch(/change to it reaches/)
    expect(out.find((i) => i.kind === 'cycle')!.nodes.sort()).toEqual(['core', 'util'])
  })

  it('says nothing about flowcharts or tiny maps', () => {
    expect(insights({ ...d, type: 'workflow' })).toEqual([])
    expect(insights(map([n('a', 'backend'), n('b', 'backend')], [['a', 'b']]))).toEqual([])
  })
})
