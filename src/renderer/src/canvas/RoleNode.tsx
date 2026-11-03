import { memo, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { palette } from '@shared/roles'
import { useStore } from '../state/store'
import type { RoleNodeData } from './toReactFlow'
import type { Side } from './sides'

const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

/** A semantic, theme-aware node. Shape + color communicate role; a pin badge
 *  shows when the user has anchored it (ADR-0004). Double-click to rename. */
function RoleNodeImpl({ id, data, selected }: NodeProps) {
  const theme = useStore((s) => s.theme)
  const editing = useStore((s) => s.editingNodeId === id)
  const d = data as RoleNodeData
  const style = palette(theme)[d.role]

  const radius =
    style.shape === 'pill' || style.shape === 'stadium' ? 999 : style.shape === 'box' ? 6 : style.shape === 'diamond' ? 8 : 12
  const transform = style.shape === 'diamond' ? 'rotate(45deg)' : undefined
  const inner = style.shape === 'diamond' ? 'rotate(-45deg)' : undefined

  return (
    <div
      className={`cg-node${selected ? ' cg-node-selected' : ''}`}
      data-role={d.role}
      data-testid={`node-${id}`}
      style={{
        borderColor: style.accent,
        background: style.fill,
        borderRadius: radius,
        boxShadow: selected ? `0 0 0 2px ${style.accent}` : undefined,
        transform,
      }}
    >
      <Handle type="target" position={POS[d.targetSide]} className="cg-handle" />
      <div className="cg-node-inner" style={{ transform: inner }}>
        {d.brand && (
          <span className="cg-badge" style={{ borderColor: style.accent, color: style.accent }} aria-hidden>
            {d.brand.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="cg-node-text">
          {editing ? <InlineRename id={id} initial={d.label} /> : <div className="cg-node-label" title={d.label}>{d.label}</div>}
          {d.sublabel && !editing && <div className="cg-node-sub" title={d.sublabel}>{d.sublabel}</div>}
        </div>
      </div>
      <Handle type="source" position={POS[d.sourceSide]} className="cg-handle" />
      <span className="cg-role-tag" style={{ color: style.accent }}>{style.label}</span>
      {d.pinned && <span className="cg-pin" title="Pinned: auto-layout flows around this">📌</span>}
    </div>
  )
}

function InlineRename({ id, initial }: { id: string; initial: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const updateNode = useStore((s) => s.updateNode)
  const stopEditing = useStore((s) => s.stopEditing)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    const value = ref.current?.value.trim() ?? ''
    if (commit && value && value !== initial) updateNode(id, { label: value })
    stopEditing()
  }

  return (
    <input
      ref={ref}
      className="cg-inline-rename nodrag nopan"
      defaultValue={initial}
      aria-label="Node name"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

export const RoleNode = memo(RoleNodeImpl)
