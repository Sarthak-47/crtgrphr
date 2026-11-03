import { useStore } from '../state/store'
import { NODE_ROLES, type EdgeVariant, type IREdge, type IRNode } from '@shared/ir'
import { palette } from '@shared/roles'
import { reachNodes } from '../graph/reach'

const VARIANTS: { value: EdgeVariant; label: string }[] = [
  { value: 'default', label: 'Normal' },
  { value: 'emphasis', label: 'Emphasis (animated)' },
  { value: 'dashed', label: 'Dashed (async / optional)' },
  { value: 'weak', label: 'Weak (structural)' },
]

export function Inspector() {
  const selection = useStore((s) => s.selection)
  const diagram = useStore((s) => s.project.diagram)

  const node = selection?.kind === 'node' ? diagram.nodes.find((n) => n.id === selection.id) : undefined
  const edge = selection?.kind === 'edge' ? diagram.edges.find((e) => e.id === selection.id) : undefined

  return (
    <aside className="cg-inspector" data-testid="inspector">
      {node ? <NodeInspector node={node} /> : edge ? <EdgeInspector edge={edge} /> : <MapInspector />}
    </aside>
  )
}

function NodeInspector({ node }: { node: IRNode }) {
  const project = useStore((s) => s.project)
  const theme = useStore((s) => s.theme)
  const updateNode = useStore((s) => s.updateNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const unpinNode = useStore((s) => s.unpinNode)

  const diagram = project.diagram
  const pinned = project.layout[node.id]?.pinned ?? false
  const down = reachNodes(diagram, node.id, 'downstream').size - 1
  const up = reachNodes(diagram, node.id, 'upstream').size - 1

  return (
    <>
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">Node</span>
        <button className="cg-danger" onClick={() => void deleteNode(node.id)} title="Delete (Del)">Delete</button>
      </div>

      <label className="cg-field">
        <span>Label</span>
        <input value={node.label} onChange={(e) => updateNode(node.id, { label: e.target.value })} />
      </label>

      <label className="cg-field">
        <span>Sublabel</span>
        <input
          value={node.sublabel ?? ''}
          placeholder="optional"
          onChange={(e) => updateNode(node.id, { sublabel: e.target.value || undefined })}
        />
      </label>

      <label className="cg-field">
        <span>Role</span>
        <select value={node.role} onChange={(e) => updateNode(node.id, { role: e.target.value as IRNode['role'] })}>
          {NODE_ROLES.filter((r) => r !== 'group').map((r) => (
            <option key={r} value={r}>{palette(theme)[r].label}</option>
          ))}
        </select>
      </label>

      <label className="cg-field">
        <span>Brand badge</span>
        <input
          value={node.brand ?? ''}
          placeholder="e.g. postgresql, github"
          onChange={(e) => updateNode(node.id, { brand: e.target.value || undefined })}
        />
      </label>

      {pinned && (
        <div className="cg-pin-row">
          <span>📌 Pinned in place</span>
          <button className="cg-ghost" onClick={() => void unpinNode(node.id)}>Unpin</button>
        </div>
      )}

      <div className="cg-reach">
        <div><strong>{up}</strong><span>upstream</span></div>
        <div><strong>{down}</strong><span>downstream</span></div>
      </div>

      <div className="cg-meta-row"><span>id</span> <code>{node.id}</code></div>
      {node.meta?.source && <div className="cg-meta-row"><span>from</span> <code>{node.meta.source}</code></div>}
      <p className="cg-hint">Double-click the node to rename it in place.</p>
    </>
  )
}

function EdgeInspector({ edge }: { edge: IREdge }) {
  const diagram = useStore((s) => s.project.diagram)
  const updateEdge = useStore((s) => s.updateEdge)
  const reverseEdge = useStore((s) => s.reverseEdge)
  const deleteEdge = useStore((s) => s.deleteEdge)
  const select = useStore((s) => s.select)

  const label = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? id

  return (
    <>
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">Edge</span>
        <button className="cg-danger" onClick={() => void deleteEdge(edge.id)} title="Delete (Del)">Delete</button>
      </div>

      <div className="cg-edge-ends">
        <button className="cg-link" onClick={() => select({ kind: 'node', id: edge.source })}>{label(edge.source)}</button>
        <span aria-hidden>→</span>
        <button className="cg-link" onClick={() => select({ kind: 'node', id: edge.target })}>{label(edge.target)}</button>
      </div>

      <label className="cg-field">
        <span>Label</span>
        <input
          value={edge.label ?? ''}
          placeholder="e.g. REST, publish, SQL"
          onChange={(e) => updateEdge(edge.id, { label: e.target.value || undefined })}
        />
      </label>

      <label className="cg-field">
        <span>Style</span>
        <select
          value={edge.variant ?? 'default'}
          onChange={(e) => {
            const v = e.target.value as EdgeVariant
            updateEdge(edge.id, { variant: v === 'default' ? undefined : v })
          }}
        >
          {VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </label>

      <button className="cg-ghost cg-block" onClick={() => void reverseEdge(edge.id)}>⇄ Reverse direction</button>
    </>
  )
}

function MapInspector() {
  const diagram = useStore((s) => s.project.diagram)
  const pins = useStore((s) => Object.values(s.project.layout).filter((p) => p.pinned).length)
  const theme = useStore((s) => s.theme)
  const setTitle = useStore((s) => s.setTitle)
  const setSubtitle = useStore((s) => s.setSubtitle)

  return (
    <>
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">Map</span>
      </div>
      <label className="cg-field">
        <span>Title</span>
        <input value={diagram.title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="cg-field">
        <span>Subtitle</span>
        <input value={diagram.subtitle ?? ''} placeholder="optional" onChange={(e) => setSubtitle(e.target.value)} />
      </label>
      <div className="cg-stats">
        <div><strong>{diagram.nodes.length}</strong><span>nodes</span></div>
        <div><strong>{diagram.edges.length}</strong><span>edges</span></div>
        <div><strong>{pins}</strong><span>pinned</span></div>
      </div>
      <p className="cg-hint">
        Click a node or edge to edit it. Drag from a node’s handle to another to connect them. Dragging a node
        <em> pins</em> it; Auto-layout then flows everything else around your pins.
      </p>
      <Legend theme={theme} />
      <Shortcuts />
    </>
  )
}

function Legend({ theme }: { theme: 'light' | 'dark' }) {
  const pal = palette(theme)
  return (
    <div className="cg-legend">
      {NODE_ROLES.filter((r) => r !== 'group').map((r) => (
        <span key={r} className="cg-legend-item">
          <span className="cg-legend-swatch" style={{ background: pal[r].accent }} />
          {pal[r].label}
        </span>
      ))}
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['N', 'New node'],
  ['Del', 'Delete selection'],
  ['Ctrl+F', 'Find node'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+S', 'Save'],
  ['Ctrl+Shift+S', 'Save as'],
  ['Ctrl+O', 'Open'],
  ['Ctrl+N', 'New map'],
  ['Ctrl+I', 'Import'],
  ['Esc', 'Clear selection'],
]

function Shortcuts() {
  return (
    <div className="cg-shortcuts">
      <span className="cg-inspector-kicker">Shortcuts</span>
      {SHORTCUTS.map(([k, v]) => (
        <div key={k}><kbd>{k}</kbd><span>{v}</span></div>
      ))}
    </div>
  )
}
