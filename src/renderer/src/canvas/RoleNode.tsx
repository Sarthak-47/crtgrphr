import { memo, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { palette } from '@shared/roles'
import { useStore } from '../state/store'
import { shapeGeometry, textArea } from '../render/geometry'
import type { BoundaryNodeData, RoleNodeData } from './toReactFlow'
import type { Side } from './sides'

const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

/**
 * A semantic, theme-aware node. The outline is an SVG path from the same geometry
 * the exporter uses, so diamonds, cylinders and pills look identical on canvas and
 * in exports. Text sits inside the shape's safe text area. Double-click to rename.
 */
function RoleNodeImpl({ id, data, selected }: NodeProps) {
  const theme = useStore((s) => s.theme)
  const editing = useStore((s) => s.editingNodeId === id)
  const d = data as RoleNodeData
  const style = palette(theme)[d.role]
  const { w, h } = d
  const geom = shapeGeometry(style.shape, w, h)
  const area = textArea(style.shape, w, h)
  const showBadge = !!d.brand && style.shape !== 'diamond'

  return (
    <div
      className={`cg-node${selected ? ' cg-node-selected' : ''}${d.diff ? ` cg-diff cg-diff-${d.diff}` : ''}`}
      data-role={d.role}
      data-shape={style.shape}
      data-testid={`node-${id}`}
      data-collapsed={d.stacked ? d.stacked : undefined}
      title={d.stacked ? `Collapsed group of ${d.stacked}. Double-click to expand.` : undefined}
      style={{ width: w, height: h, ['--accent' as string]: style.accent }}
    >
      <svg className="cg-node-shape" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={d.stacked ? { overflow: 'visible' } : undefined}>
        {d.stacked && (
          <>
            <path d={geom.d} transform="translate(8 8)" fill={style.fill} stroke={style.accent} strokeWidth={1.2} opacity={0.55} />
            <path d={geom.d} transform="translate(4 4)" fill={style.fill} stroke={style.accent} strokeWidth={1.2} opacity={0.8} />
          </>
        )}
        <path className="cg-node-outline" d={geom.d} fill={style.fill} stroke={style.accent} />
        {geom.overlay && <path d={geom.overlay} fill="none" stroke={style.accent} strokeWidth={1.6} />}
      </svg>
      <Handle type="target" position={POS[d.targetSide]} className="cg-handle" />
      <div className="cg-node-inner" style={{ left: area.x, top: area.y, width: area.width, height: area.height }}>
        {showBadge && (
          <span className="cg-badge" style={{ borderColor: style.accent, color: style.accent }} aria-hidden>
            {d.brand!.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="cg-node-text">
          {editing ? <InlineRename id={id} initial={d.label} /> : <div className="cg-node-label" title={d.label}>{d.label}</div>}
          {d.sublabel && !editing && <div className="cg-node-sub" title={d.sublabel}>{d.sublabel}</div>}
        </div>
      </div>
      <Handle type="source" position={POS[d.sourceSide]} className="cg-handle" />
      {d.showRoleTag && <span className="cg-role-tag" style={{ color: style.accent }}>{style.label}</span>}
      {d.pinned && <span className="cg-pin" title="Pinned: auto-layout flows around this">📌</span>}
      {d.diff && <span className="cg-diff-tag">{d.diff === 'added' ? 'NEW' : d.diff === 'removed' ? 'REMOVED' : 'CHANGED'}</span>}
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

/** A group boundary: a labelled frame around its members. Clicks pass through
 *  the frame to what's behind it; only the label selects the group. */
function BoundaryImpl({ id, data }: NodeProps) {
  const d = data as BoundaryNodeData
  return (
    <div className={`cg-boundary${d.selected ? ' cg-boundary-selected' : ''}`} style={{ width: d.w, height: d.h }} data-testid={`group-${id}`}>
      <span className="cg-boundary-label" title="Select this group">{d.label}</span>
    </div>
  )
}

export const BoundaryNode = memo(BoundaryImpl)

/** Sequence diagrams: the dashed vertical lifeline under a participant. */
function LifelineImpl({ data }: NodeProps) {
  const { h, color } = data as { h: number; color: string }
  return (
    <svg width={2} height={h} className="cg-lifeline" aria-hidden style={{ overflow: 'visible' }}>
      <line x1={1} y1={0} x2={1} y2={h} stroke={color} strokeWidth={1.4} strokeDasharray="5 5" />
    </svg>
  )
}

export const LifelineNode = memo(LifelineImpl)
