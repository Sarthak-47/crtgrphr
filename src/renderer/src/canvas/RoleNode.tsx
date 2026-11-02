import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { palette } from '@shared/roles'
import { useStore } from '../state/store'
import type { RoleNodeData } from './toReactFlow'

/** A semantic, theme-aware node. Shape + color communicate role; a pin badge
 *  shows when the user has anchored it (ADR-0004). */
function RoleNodeImpl({ data, selected }: NodeProps) {
  const theme = useStore((s) => s.theme)
  const isH = useStore((s) => {
    const dir = s.project.diagram.direction
    return dir === 'RIGHT' || dir === 'LEFT'
  })
  const d = data as RoleNodeData
  const style = palette(theme)[d.role]

  const radius =
    style.shape === 'pill' || style.shape === 'stadium'
      ? 999
      : style.shape === 'box'
        ? 6
        : style.shape === 'diamond'
          ? 8
          : 12
  const transform = style.shape === 'diamond' ? 'rotate(45deg)' : undefined
  const inner = style.shape === 'diamond' ? 'rotate(-45deg)' : undefined

  return (
    <div
      className="cg-node"
      data-role={d.role}
      style={{
        borderColor: style.accent,
        background: style.fill,
        borderRadius: radius,
        boxShadow: selected ? `0 0 0 2px ${style.accent}` : undefined,
        transform,
      }}
    >
      <Handle type="target" position={isH ? Position.Left : Position.Top} className="cg-handle" />
      <div className="cg-node-inner" style={{ transform: inner }}>
        {d.brand && (
          <span className="cg-badge" style={{ borderColor: style.accent, color: style.accent }} aria-hidden>
            {d.brand.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="cg-node-text">
          <div className="cg-node-label">{d.label}</div>
          {d.sublabel && <div className="cg-node-sub">{d.sublabel}</div>}
        </div>
      </div>
      <Handle type="source" position={isH ? Position.Right : Position.Bottom} className="cg-handle" />
      <span className="cg-role-tag" style={{ color: style.accent }}>{style.label}</span>
      {d.pinned && <span className="cg-pin" title="Pinned — auto-layout flows around this">📌</span>}
    </div>
  )
}

export const RoleNode = memo(RoleNodeImpl)
