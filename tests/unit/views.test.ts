import { describe, expect, it } from 'vitest'
import type { CartographProject, IRDiagram } from '../../src/shared/ir'
import { applyView, currentCollapsed, findView, sameView, sanitizeViews } from '../../src/shared/views'
import { parseProject, serializeProject } from '../../src/shared/serialize'

const d: IRDiagram = {
  id: 'm',
  title: 'm',
  type: 'architecture',
  nodes: [
    { id: 'g1', label: 'apps', role: 'group' },
    { id: 'g2', label: 'libs', role: 'group', collapsed: true },
    { id: 'empty', label: 'empty', role: 'group' },
    { id: 'a', label: 'a', role: 'frontend', parent: 'g1' },
    { id: 'b', label: 'b', role: 'service', parent: 'g2' },
  ],
  edges: [],
}

describe('saved views', () => {
  it('reads the current view and applies a saved one exactly', () => {
    expect(currentCollapsed(d)).toEqual(['g2'])
    const v = applyView(d, { name: 'Apps folded', collapsed: ['g1', 'gone', 'empty'] })
    expect(currentCollapsed(v)).toEqual(['g1'])
    expect(v.nodes.find((n) => n.id === 'g2')).not.toHaveProperty('collapsed')
    expect(sameView(v, { name: 'x', collapsed: ['g1', 'gone'] })).toBe(true)
    expect(sameView(d, { name: 'x', collapsed: [] })).toBe(false)
  })

  it('finds views by name regardless of case', () => {
    expect(findView([{ name: 'Overview', collapsed: [] }], ' overview ')?.name).toBe('Overview')
  })

  it('cleans views from a file: names, duplicates, ids', () => {
    expect(
      sanitizeViews([
        { name: '  Overview ', collapsed: ['g2', 'g1', 'g1', 3] },
        { name: 'overview', collapsed: [] },
        { name: '', collapsed: [] },
        'junk',
        { name: 'Bare' },
      ]),
    ).toEqual([
      { name: 'Overview', collapsed: ['g1', 'g2'] },
      { name: 'Bare', collapsed: [] },
    ])
    expect(sanitizeViews('nope')).toEqual([])
  })

  it('round-trips through the map file, and is left out when there are none', () => {
    const project: CartographProject = { schema_version: 1, diagram: d, layout: {}, views: [{ name: 'Overview', collapsed: ['g2', 'g1'] }] }
    const text = serializeProject(project)
    expect(text).toContain('  "views": [\n    {"name":"Overview","collapsed":["g1","g2"]}\n  ]\n}')
    expect(parseProject(text).value.views).toEqual([{ name: 'Overview', collapsed: ['g1', 'g2'] }])
    const none = serializeProject({ ...project, views: [] })
    expect(none).not.toContain('views')
    expect(parseProject(none).value).not.toHaveProperty('views')
  })
})
