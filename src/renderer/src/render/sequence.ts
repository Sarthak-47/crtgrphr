import type { IRDiagram } from '@shared/ir'
import type { SequenceLayout } from '../layout/sequence'
import type { Route } from './geometry'

const SELF_OUT = 44
const SELF_DROP = 24

/** Message paths for a sequence diagram: one horizontal row per message. */
export function sequenceMessageRoutes(diagram: IRDiagram, seq: SequenceLayout): Map<string, Route> {
  const label = new Map(diagram.edges.map((e) => [e.id, e.label ?? '']))
  const routes = new Map<string, Route>()
  for (const m of seq.messages) {
    if (m.self) {
      const w = label.get(m.id)!.length * 6.4 + 12
      routes.set(m.id, {
        points: [
          { x: m.x1, y: m.y },
          { x: m.x1 + SELF_OUT, y: m.y },
          { x: m.x1 + SELF_OUT, y: m.y + SELF_DROP },
          { x: m.x1 + 2, y: m.y + SELF_DROP },
        ],
        label: { x: m.x1 + SELF_OUT + 8 + w / 2, y: m.y + SELF_DROP / 2 },
      })
    } else {
      // Stop 1px short of the lifeline so the arrowhead tip sits on it.
      const dir = Math.sign(m.x2 - m.x1)
      routes.set(m.id, {
        points: [
          { x: m.x1, y: m.y },
          { x: m.x2 - dir, y: m.y },
        ],
        label: { x: (m.x1 + m.x2) / 2, y: m.y - 11 },
      })
    }
  }
  return routes
}
