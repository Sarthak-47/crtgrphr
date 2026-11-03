/**
 * Sequence diagram layout. Not a graph layout: participants are columns in IR
 * node order, messages are rows in IR edge order (top to bottom). Column spacing
 * grows so every message label fits between the lifelines it spans.
 */
import type { IRDiagram } from '@shared/ir'
import { measureNode, type LaidOut } from './elk'

export const HEADER_HEIGHT = 56
const FIRST_MESSAGE_GAP = 54
const MESSAGE_STEP = 52
const SELF_MESSAGE_STEP = 66
const TAIL = 44
const MIN_COLUMN_GAP = 70

export interface SequenceMessage {
  id: string
  y: number
  x1: number
  x2: number
  self: boolean
}

export interface SequenceLayout {
  lifelines: { id: string; x: number; top: number; bottom: number }[]
  messages: SequenceMessage[]
}

const labelWidth = (s: string | undefined): number => (s ? s.length * 6.4 + 24 : 0)

export function layoutSequence(diagram: IRDiagram): LaidOut & { sequence: SequenceLayout } {
  const parts = diagram.nodes.filter((n) => n.role !== 'group')
  const index = new Map(parts.map((n, i) => [n.id, i]))
  const widths = parts.map((n) => measureNode({ ...n, sublabel: n.sublabel }).width)
  const messages = diagram.edges.filter((e) => index.has(e.source) && index.has(e.target))

  // Minimum distance between adjacent column centers, from node widths and from
  // the widest label of any message spanning exactly that gap (wider spans share).
  const need: number[] = parts.slice(1).map((_, i) => widths[i] / 2 + widths[i + 1] / 2 + MIN_COLUMN_GAP)
  for (const m of messages) {
    const i = index.get(m.source)!
    const j = index.get(m.target)!
    if (i === j) continue
    const lo = Math.min(i, j)
    const hi = Math.max(i, j)
    const perGap = labelWidth(m.label) / (hi - lo)
    for (let g = lo; g < hi; g++) need[g] = Math.max(need[g], perGap)
  }
  // Self-message labels sit to the right of their lifeline.
  for (const m of messages) {
    if (m.source !== m.target) continue
    const i = index.get(m.source)!
    if (i < need.length) need[i] = Math.max(need[i], labelWidth(m.label) + 60)
  }

  const centers: number[] = []
  parts.forEach((_, i) => {
    centers.push(i === 0 ? widths[0] / 2 : centers[i - 1] + need[i - 1])
  })

  const positions: LaidOut['positions'] = {}
  const sizes: LaidOut['sizes'] = {}
  parts.forEach((n, i) => {
    positions[n.id] = { x: centers[i] - widths[i] / 2, y: 0 }
    sizes[n.id] = { width: widths[i], height: HEADER_HEIGHT }
  })

  let y = HEADER_HEIGHT + FIRST_MESSAGE_GAP
  const laidMessages: SequenceMessage[] = []
  for (const m of messages) {
    const i = index.get(m.source)!
    const j = index.get(m.target)!
    const self = i === j
    laidMessages.push({ id: m.id, y, x1: centers[i], x2: centers[j], self })
    y += self ? SELF_MESSAGE_STEP : MESSAGE_STEP
  }
  const bottom = y - (laidMessages.length ? MESSAGE_STEP : 0) + TAIL + (laidMessages.length ? 0 : FIRST_MESSAGE_GAP)

  const lastSelfRight = laidMessages.some((m) => m.self && m.x1 === centers[centers.length - 1]) ? 80 : 0
  const width = parts.length ? centers[centers.length - 1] + widths[widths.length - 1] / 2 + lastSelfRight : 0

  return {
    positions,
    sizes,
    width,
    height: bottom,
    sequence: {
      lifelines: parts.map((n, i) => ({ id: n.id, x: centers[i], top: HEADER_HEIGHT, bottom })),
      messages: laidMessages,
    },
  }
}
