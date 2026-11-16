import { useState } from 'react'
import { useStore } from '../state/store'
import { NODE_ROLES, type EdgeVariant, type IREdge, type IRNode } from '@shared/ir'
import { palette } from '@shared/roles'
import { reachNodes } from '../graph/reach'
import { shortestPath } from '../graph/path'
import { openInEditor, preferredEditor, revealSource, revealablePath, setPreferredEditor } from '../actions/files'
import { EDITORS, evidencePath, isEditorId, type EditorId } from '@shared/editor'
import type { RescanPreview } from '../state/store'

const VARIANTS: { value: EdgeVariant; label: string }[] = [
  { value: 'default', label: 'Normal' },
  { value: 'emphasis', label: 'Emphasis (main path)' },
  { value: 'dashed', label: 'Dashed (async / optional)' },
  { value: 'weak', label: 'Weak (structural)' },
]

export function Inspector() {
  const selection = useStore((s) => s.selection)
  const diagram = useStore((s) => s.project.diagram)

  const rescan = useStore((s) => s.rescan)
  const multi = useStore((s) => s.multi)

  const node = selection?.kind === 'node' ? diagram.nodes.find((n) => n.id === selection.id) : undefined
  const edge = selection?.kind === 'edge' ? diagram.edges.find((e) => e.id === selection.id) : undefined

  return (
    <aside className="cg-inspector" data-testid="inspector">
      {rescan ? (
        <RescanPanel rescan={rescan} />
      ) : multi.length > 1 ? (
        <MultiInspector ids={multi} />
      ) : node?.role === 'group' ? (
        <GroupInspector group={node} />
      ) : node ? (
        <NodeInspector node={node} />
      ) : edge ? (
        <EdgeInspector edge={edge} />
      ) : (
        <MapInspector />
      )}
    </aside>
  )
}

function RescanPanel({ rescan }: { rescan: RescanPreview }) {
  const { diff } = rescan
  const applyRescanPreview = useStore((s) => s.applyRescanPreview)
  const discardRescan = useStore((s) => s.discardRescan)
  const name = (id: string) => rescan.preview.nodes.find((n) => n.id === id)?.label ?? id
  const rows: { kind: 'added' | 'removed' | 'changed'; text: string }[] = [
    ...diff.addedNodes.map((n) => ({ kind: 'added' as const, text: n.label })),
    ...diff.removedNodes.map((n) => ({ kind: 'removed' as const, text: n.label })),
    ...diff.changedNodes.map((c) => ({ kind: 'changed' as const, text: `${c.after.label}: ${c.fields.join(', ')}` })),
    ...diff.addedEdges.map((e) => ({ kind: 'added' as const, text: `${name(e.source)} → ${name(e.target)}` })),
    ...diff.removedEdges.map((e) => ({ kind: 'removed' as const, text: `${name(e.source)} → ${name(e.target)}` })),
    ...diff.changedEdges.map((c) => ({ kind: 'changed' as const, text: `${name(c.after.source)} → ${name(c.after.target)}: ${c.fields.join(', ')}` })),
  ]
  return (
    <>
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">Re-scan changes</span>
      </div>
      <ul className="cg-diff-list" data-testid="rescan-list">
        {rows.map((r, i) => (
          <li key={i} className={`cg-diff-row cg-diff-text-${r.kind}`}>
            <span className="cg-diff-dot" />
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      <p className="cg-hint">
        Applying keeps your pins, the nodes and edges you added by hand, and your edits to scanned nodes. You can undo it.
      </p>
      <div className="cg-row">
        <button className="cg-primary" onClick={() => void applyRescanPreview()}>Apply</button>
        <button className="cg-ghost" onClick={() => void discardRescan()}>Discard</button>
      </div>
    </>
  )
}

/** Several nodes selected: bulk actions, and the path probe for exactly two. */
function MultiInspector({ ids }: { ids: string[] }) {
  const diagram = useStore((s) => s.project.diagram)
  const theme = useStore((s) => s.theme)
  const updateNodes = useStore((s) => s.updateNodes)
  const deleteNodes = useStore((s) => s.deleteNodes)
  const groupSelection = useStore((s) => s.groupSelection)
  const setParent = useStore((s) => s.setParent)
  const selectNodes = useStore((s) => s.selectNodes)

  const nodes = ids.map((id) => diagram.nodes.find((n) => n.id === id)).filter((n): n is IRNode => !!n)
  const label = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? id
  const sameRole = nodes.every((n) => n.role === nodes[0]?.role) ? nodes[0]?.role : undefined
  const anyGrouped = nodes.some((n) => n.parent)
  const path = ids.length === 2 ? shortestPath(diagram, ids[0], ids[1]) : undefined
  const edgeById = new Map(diagram.edges.map((e) => [e.id, e]))

  return (
    <>
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">{ids.length} nodes selected</span>
        <button className="cg-danger" onClick={() => void deleteNodes(ids)} title="Delete (Del)">Delete</button>
      </div>

      <ul className="cg-multi-list">
        {nodes.map((n) => (
          <li key={n.id}>
            <span className="cg-legend-swatch" style={{ background: palette(theme)[n.role].accent }} />
            <button className="cg-link" onClick={() => selectNodes([n.id])}>{n.label}</button>
          </li>
        ))}
      </ul>

      <label className="cg-field">
        <span>Role for all</span>
        <select value={sameRole ?? ''} onChange={(e) => e.target.value && void updateNodes(ids, { role: e.target.value as IRNode['role'] })} aria-label="Role for all">
          {!sameRole && <option value="">Mixed</option>}
          {NODE_ROLES.filter((r) => r !== 'group').map((r) => (
            <option key={r} value={r}>{palette(theme)[r].label}</option>
          ))}
        </select>
      </label>

      {diagram.type !== 'sequence' && (
        <div className="cg-row">
          <button className="cg-ghost" onClick={() => void groupSelection()} title="Group (Ctrl+G)">Group</button>
          {anyGrouped && <button className="cg-ghost" onClick={() => void setParent(ids, undefined)}>Remove from group</button>}
        </div>
      )}

      {ids.length === 2 && (
        <div className="cg-path" data-testid="path-probe">
          <span className="cg-inspector-kicker">Path</span>
          {path ? (
            <>
              <p className="cg-hint">
                {path.reversed ? `No path from ${label(ids[0])} to ${label(ids[1])}; shown the other way round.` : `Shortest path, ${path.edges.length} step${path.edges.length === 1 ? '' : 's'}.`}
              </p>
              <ol className="cg-path-steps">
                {path.nodes.map((id, i) => (
                  <li key={id}>
                    <strong>{label(id)}</strong>
                    {i < path.edges.length && edgeById.get(path.edges[i])?.label && <span> · {edgeById.get(path.edges[i])!.label}</span>}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="cg-hint">These two nodes are not connected in either direction.</p>
          )}
        </div>
      )}
      <p className="cg-hint">Shift-click adds or removes a node. Shift-drag on the canvas selects a box. Select two nodes to trace the path between them.</p>
    </>
  )
}

function GroupInspector({ group }: { group: IRNode }) {
  const diagram = useStore((s) => s.project.diagram)
  const updateNode = useStore((s) => s.updateNode)
  const ungroup = useStore((s) => s.ungroup)
  const selectNodes = useStore((s) => s.selectNodes)
  const setCollapsed = useStore((s) => s.setCollapsed)
  const members = diagram.nodes.filter((n) => n.parent === group.id)
  const collapsed = !!group.collapsed
  return (
    <>
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">Group</span>
        <button className="cg-ghost" onClick={() => void ungroup(group.id)}>Ungroup</button>
      </div>
      <label className="cg-field">
        <span>Name</span>
        <input value={group.label} autoFocus onChange={(e) => updateNode(group.id, { label: e.target.value })} aria-label="Group name" />
      </label>
      <div className="cg-stats">
        <div><strong>{members.length}</strong><span>members</span></div>
      </div>
      {members.length > 0 && (
        <button className="cg-ghost cg-block" data-testid="toggle-collapse" onClick={() => void setCollapsed(group.id, !collapsed)}>
          {collapsed ? `Expand (show ${members.length} parts)` : 'Collapse into one box'}
        </button>
      )}
      {!collapsed && <button className="cg-ghost cg-block" onClick={() => selectNodes(members.map((m) => m.id))}>Select members</button>}
      {group.meta?.source && <div className="cg-meta-row"><span>from</span> <code>{group.meta.source}</code></div>}
      <p className="cg-hint">A group is a boundary drawn around its members. Double-click it to collapse it into one box, and again to expand. Ungrouping keeps the nodes.</p>
    </>
  )
}

function NodeInspector({ node }: { node: IRNode }) {
  const project = useStore((s) => s.project)
  const setParent = useStore((s) => s.setParent)
  const theme = useStore((s) => s.theme)
  const updateNode = useStore((s) => s.updateNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const unpinNode = useStore((s) => s.unpinNode)

  const diagram = project.diagram
  const groups = diagram.type === 'sequence' ? [] : diagram.nodes.filter((n) => n.role === 'group')
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

      {groups.length > 0 && (
        <label className="cg-field">
          <span>Group</span>
          <select value={node.parent ?? ''} onChange={(e) => void setParent([node.id], e.target.value || undefined)} aria-label="Group">
            <option value="">None</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
      )}

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
      {node.meta?.source && (
        <div className="cg-meta-row">
          <span>from</span> <code>{node.meta.source}</code>
          {diagram.origin && revealablePath(node.meta.source) && (
            <span className="cg-source-actions">
              <OpenInEditor rel={revealablePath(node.meta.source)!} />
              <button className="cg-link" onClick={() => void revealSource(node.meta!.source!)} title="Show in the file manager">
                Reveal
              </button>
            </span>
          )}
        </div>
      )}
      {node.meta?.edited && <div className="cg-meta-row"><span>kept on re-scan</span> <code>{node.meta.edited}</code></div>}
      <p className="cg-hint">Double-click the node to rename it in place.</p>
    </>
  )
}

function EdgeInspector({ edge }: { edge: IREdge }) {
  const diagram = useStore((s) => s.project.diagram)
  const updateEdge = useStore((s) => s.updateEdge)
  const reverseEdge = useStore((s) => s.reverseEdge)
  const deleteEdge = useStore((s) => s.deleteEdge)
  const moveMessage = useStore((s) => s.moveMessage)
  const select = useStore((s) => s.select)
  const isSequence = diagram.type === 'sequence'
  const index = diagram.edges.findIndex((e) => e.id === edge.id)

  const label = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? id

  return (
    <>
      <div className="cg-inspector-head">
        <span className="cg-inspector-kicker">{isSequence ? `Message ${index + 1} of ${diagram.edges.length}` : 'Edge'}</span>
        <button className="cg-danger" onClick={() => void deleteEdge(edge.id)} title="Delete (Del)">Delete</button>
      </div>

      <div className="cg-edge-ends">
        <button className="cg-link" onClick={() => select({ kind: 'node', id: edge.source })}>{label(edge.source)}</button>
        <span aria-hidden>→</span>
        <button className="cg-link" onClick={() => select({ kind: 'node', id: edge.target })}>{label(edge.target)}</button>
      </div>

      {edge.confidence && (
        <p className="cg-evidence" data-testid="edge-evidence">
          <strong>{edge.confidence === 'declared' ? 'Declared' : 'Inferred'}</strong>
          {edge.confidence === 'declared' ? ': written down in the code. ' : ': worked out from hints in the code, not declared. '}
          {edge.evidence}
          {diagram.origin && edge.evidence && evidencePath(edge.evidence) && (
            <span className="cg-source-actions cg-evidence-open">
              <OpenInEditor rel={evidencePath(edge.evidence)!} />
            </span>
          )}
        </p>
      )}

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
      {isSequence && (
        <div className="cg-row">
          <button className="cg-ghost" disabled={index <= 0} onClick={() => void moveMessage(edge.id, -1)}>↑ Earlier</button>
          <button className="cg-ghost" disabled={index >= diagram.edges.length - 1} onClick={() => void moveMessage(edge.id, 1)}>↓ Later</button>
        </div>
      )}
    </>
  )
}

function MapInspector() {
  const diagram = useStore((s) => s.project.diagram)
  const pins = useStore((s) => Object.values(s.project.layout).filter((p) => p.pinned).length)
  const theme = useStore((s) => s.theme)
  const setTitle = useStore((s) => s.setTitle)
  const setSubtitle = useStore((s) => s.setSubtitle)
  const setAllCollapsed = useStore((s) => s.setAllCollapsed)
  const scanNotes = useStore((s) => s.scanNotes)
  const groups = diagram.nodes.filter((n) => n.role === 'group' && diagram.nodes.some((m) => m.parent === n.id))
  const collapsedCount = groups.filter((g) => g.collapsed).length

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
      {scanNotes.length > 0 && (
        <div className="cg-scan-notes" data-testid="scan-notes">
          <span className="cg-inspector-kicker">Scan notes</span>
          <p className="cg-hint">The last scan skipped or couldn't read these, so the map may be missing parts:</p>
          <ul>
            {scanNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {groups.length > 0 && (
        <div className="cg-row-buttons">
          <button className="cg-ghost" data-testid="collapse-all" disabled={collapsedCount === groups.length} onClick={() => void setAllCollapsed(true)}>
            Collapse all groups
          </button>
          <button className="cg-ghost" data-testid="expand-all" disabled={collapsedCount === 0} onClick={() => void setAllCollapsed(false)}>
            Expand all
          </button>
        </div>
      )}
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
  ['Shift+click', 'Add to selection'],
  ['Ctrl+G', 'Group selection'],
  ['Double-click group', 'Collapse / expand'],
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

/** "Open" for a repo-relative path, with the editor to open it in (remembered). */
function OpenInEditor({ rel }: { rel: string }) {
  const [editor, setEditor] = useState<EditorId>(preferredEditor)
  return (
    <span className="cg-open">
      <button className="cg-link" onClick={() => void openInEditor(rel, editor)} title={`Open ${rel} in ${EDITORS[editor].label}`} data-testid="open-in-editor">
        Open
      </button>
      <select
        className="cg-open-editor"
        aria-label="Editor to open files in"
        value={editor}
        onChange={(e) => {
          if (!isEditorId(e.target.value)) return
          setEditor(e.target.value)
          setPreferredEditor(e.target.value)
        }}
      >
        {(Object.keys(EDITORS) as EditorId[]).map((id) => (
          <option key={id} value={id}>{EDITORS[id].label}</option>
        ))}
      </select>
    </span>
  )
}
