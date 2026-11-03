import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { useStore } from '../state/store'

export interface RouteEdgeData extends Record<string, unknown> {
  /** precomputed SVG path (shared router, see render/geometry.ts) */
  d: string
  labelText?: string
  labelX: number
  labelY: number
}

/**
 * Draws an edge along the route computed by the shared router instead of React
 * Flow's own path, so the canvas matches exports exactly and back edges loop
 * around nodes. The label is HTML so it stays crisp and clickable.
 */
function RouteEdgeImpl({ id, data, style, markerEnd, interactionWidth }: EdgeProps) {
  const select = useStore((s) => s.select)
  const theme = useStore((s) => s.theme)
  const d = data as RouteEdgeData
  return (
    <>
      <BaseEdge id={id} path={d.d} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />
      {d.labelText && (
        <EdgeLabelRenderer>
          <div
            className="cg-edge-label nodrag nopan"
            data-testid={`edge-label-${id}`}
            data-theme={theme}
            style={{ transform: `translate(-50%, -50%) translate(${d.labelX}px, ${d.labelY}px)`, opacity: style?.opacity }}
            onClick={(e) => {
              e.stopPropagation()
              select({ kind: 'edge', id })
            }}
          >
            {d.labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const RouteEdge = memo(RouteEdgeImpl)
