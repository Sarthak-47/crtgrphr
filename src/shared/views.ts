/**
 * Saved views: named sets of collapsed groups ("Overview" with everything folded,
 * "Payments" with only that group open). Stored in the map file, so a view
 * travels with the repo and the CLI can export it.
 */
import type { IRDiagram, SavedView } from './ir'

export const MAX_VIEWS = 50
export const MAX_VIEW_NAME = 60

/** Groups that have members, i.e. the ones that can be collapsed. */
export function collapsibleGroups(d: IRDiagram): string[] {
  const withMembers = new Set(d.nodes.filter((n) => n.parent).map((n) => n.parent!))
  return d.nodes.filter((n) => n.role === 'group' && withMembers.has(n.id)).map((n) => n.id)
}

/** The current view: which groups are collapsed. */
export function currentCollapsed(d: IRDiagram): string[] {
  const can = new Set(collapsibleGroups(d))
  return d.nodes.filter((n) => n.collapsed && can.has(n.id)).map((n) => n.id).sort()
}

/** The diagram with exactly the view's groups collapsed (groups it doesn't know stay open). */
export function applyView(d: IRDiagram, view: SavedView): IRDiagram {
  const want = new Set(view.collapsed)
  const can = new Set(collapsibleGroups(d))
  const nodes = d.nodes.map((n) => {
    if (n.role !== 'group') return n
    const collapse = can.has(n.id) && want.has(n.id)
    if (collapse === !!n.collapsed) return n
    if (collapse) return { ...n, collapsed: true }
    const { collapsed: _c, ...rest } = n
    return rest
  })
  return { ...d, nodes }
}

export function sameView(d: IRDiagram, view: SavedView): boolean {
  const cur = currentCollapsed(d)
  const can = new Set(collapsibleGroups(d))
  const want = [...new Set(view.collapsed)].filter((id) => can.has(id)).sort()
  return cur.length === want.length && cur.every((id, i) => id === want[i])
}

export const findView = (views: SavedView[] | undefined, name: string): SavedView | undefined =>
  views?.find((v) => v.name.toLowerCase() === name.trim().toLowerCase())

/** Views from a file: named, unique by name, ids as strings, within limits. */
export function sanitizeViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return []
  const out: SavedView[] = []
  const names = new Set<string>()
  for (const v of raw) {
    if (out.length >= MAX_VIEWS) break
    if (!v || typeof v !== 'object') continue
    const name = typeof (v as any).name === 'string' ? (v as any).name.trim().slice(0, MAX_VIEW_NAME) : ''
    if (!name || names.has(name.toLowerCase())) continue
    const ids = Array.isArray((v as any).collapsed) ? (v as any).collapsed.filter((x: unknown): x is string => typeof x === 'string' && x.length <= 200) : []
    names.add(name.toLowerCase())
    out.push({ name, collapsed: [...new Set<string>(ids)].sort().slice(0, 2000) })
  }
  return out
}
