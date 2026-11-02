import { useStore } from '../state/store'
import { NODE_ROLES } from '@shared/ir'
import { palette } from '@shared/roles'
import { reachNodes } from '../graph/reach'

export function Inspector() {
  const selection = useStore((s) => s.selection)
  const project = useStore((s) => s.project)
  const theme = useStore((s) => s.theme)
  const updateNode = useStore((s) => s.updateNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const relayout = useStore((s) => s.relayout)

  const diagram = project.diagram
  const node = diagram.nodes.find((n) => n.id === selection)

  if (!node) {
    return (
      <aside className="cg-inspector">
        <div className="cg-inspector-empty">
          <h3>Nothing selected</h3>
          <p>
            Click a node to edit it. Drag from a node’s handle to another to draw an edge. Dragging a
            node <em>pins</em> it — “Auto-layout” then flows everything else around your pins.
          </p>
          <Legend theme={theme} />
        </div>
      </aside>
    )
  }

  const pinned = project.layout[node.id]?.pinned ?? false
  const down = reachNodes(diagram, node.id, 'downstream').size - 1
  const up = reachNodes(diagram, node.id, 'upstream').size - 1

  const unpin = (): void => {
    const layout = { ...project.layout }
    if (layout[node.id]) layout[node.id] = { ...layout[node.id], pinned: false }
    useStore.setState({ project: { ...project, layout } })
    void relayout()
  }

  return (
    <aside className="cg-inspector">
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">Node</span>
        <button className="cg-danger" onClick={() => void deleteNode(node.id)}>Delete</button>
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
        <select value={node.role} onChange={(e) => updateNode(node.id, { role: e.target.value as never })}>
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
          <span>📌 Pinned</span>
          <button className="cg-ghost" onClick={unpin}>Unpin</button>
        </div>
      )}

      <div className="cg-reach">
        <div><strong>{up}</strong><span>upstream</span></div>
        <div><strong>{down}</strong><span>downstream</span></div>
      </div>

      {node.meta?.source && (
        <div className="cg-provenance"><span>from</span> <code>{node.meta.source}</code></div>
      )}
    </aside>
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
