/**
 * Shared drawing geometry for the canvas AND the SVG/PNG exporter, so both always
 * look identical: node shape outlines, where text may go inside each shape, edge
 * ports spread across a node side, and orthogonal edge routes.
 */
import type { IRDiagram } from '@shared/ir'
import type { RoleStyle } from '@shared/roles'
import { anchor, handleSides, type Side } from '../canvas/sides'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}
export interface Point {
  x: number
  y: number
}
export type Shape = RoleStyle['shape']

/* --------------------------------- Shapes -------------------------------- */

export interface ShapeGeometry {
  /** outline, in node-local coordinates (0,0 is the node's top-left) */
  d: string
  /** extra stroke-only detail, e.g. the front lip of a cylinder */
  overlay?: string
}

function roundedRect(w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  return (
    `M${rr},0 H${w - rr} A${rr},${rr} 0 0 1 ${w},${rr} V${h - rr} A${rr},${rr} 0 0 1 ${w - rr},${h} ` +
    `H${rr} A${rr},${rr} 0 0 1 0,${h - rr} V${rr} A${rr},${rr} 0 0 1 ${rr},0 Z`
  )
}

/** Height of a cylinder's top ellipse. */
export const cylinderCap = (h: number): number => Math.min(9, h * 0.16)

export function shapeGeometry(shape: Shape, w: number, h: number): ShapeGeometry {
  switch (shape) {
    case 'diamond':
      return { d: `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z` }
    case 'cylinder': {
      const ry = cylinderCap(h)
      const rx = w / 2
      return {
        d: `M0,${ry} A${rx},${ry} 0 0 1 ${w},${ry} V${h - ry} A${rx},${ry} 0 0 1 0,${h - ry} Z`,
        overlay: `M0,${ry} A${rx},${ry} 0 0 0 ${w},${ry}`,
      }
    }
    case 'pill':
    case 'stadium':
      return { d: roundedRect(w, h, h / 2) }
    case 'box':
      return { d: roundedRect(w, h, 6) }
    default:
      return { d: roundedRect(w, h, 12) }
  }
}

/** The rectangle inside a shape where text can safely go (node-local). */
export function textArea(shape: Shape, w: number, h: number): Box {
  switch (shape) {
    case 'diamond':
      return { x: w * 0.22, y: h * 0.2, width: w * 0.56, height: h * 0.6 }
    case 'cylinder': {
      const ry = cylinderCap(h)
      return { x: 12, y: ry * 1.6, width: w - 24, height: h - ry * 2.2 }
    }
    case 'pill':
    case 'stadium': {
      const inset = Math.min(h / 2, 22)
      return { x: inset, y: 4, width: w - inset * 2, height: h - 8 }
    }
    default:
      return { x: 12, y: 4, width: w - 24, height: h - 8 }
  }
}

/* --------------------------------- Ports --------------------------------- */

const PORT_SPACING = 22

/** A point on `side` of `box`, `offset` px from the side's middle. */
export function portPoint(box: Box, side: Side, offset: number): Point {
  const a = anchor(box, side)
  return side === 'left' || side === 'right' ? { x: a.x, y: a.y + offset } : { x: a.x + offset, y: a.y }
}

/** Offsets (from the side's middle) for `n` edges sharing one side. */
export function spreadOffsets(n: number, sideLength: number): number[] {
  if (n <= 1) return [0]
  const usable = Math.max(0, sideLength - 24)
  const step = Math.min(PORT_SPACING, usable / (n - 1))
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step)
}

/* -------------------------------- Routing -------------------------------- */

const GAP = 22 // how far edges step out from a node before turning

const isHorizontal = (s: Side): boolean => s === 'left' || s === 'right'
const out = (p: Point, side: Side, d: number): Point =>
  side === 'right' ? { x: p.x + d, y: p.y } : side === 'left' ? { x: p.x - d, y: p.y } : side === 'bottom' ? { x: p.x, y: p.y + d } : { x: p.x, y: p.y - d }

export interface Route {
  points: Point[]
  label: Point
}

/**
 * Orthogonal route from `sBox` (leaving via `sa`) to `tBox` (arriving via `sb`).
 * Forward edges bend once in the middle; back edges loop around past both nodes
 * so they never cut through them. `a`/`b` override the anchor points (ports).
 */
export function routeEdge(
  sBox: Box,
  tBox: Box,
  sa: Side,
  sb: Side,
  a: Point = anchor(sBox, sa),
  b: Point = anchor(tBox, sb),
  lane = 0,
): Route {
  // `lane` shifts where a forward edge turns, so edges fanning out from one node
  // side don't share a single vertical (or horizontal) segment. It is clamped to
  // keep the bend between the two nodes.
  const clampMid = (lo: number, hi: number, mid: number): number => {
    const min = Math.min(lo, hi) + GAP / 2
    const max = Math.max(lo, hi) - GAP / 2
    return min > max ? (lo + hi) / 2 : Math.max(min, Math.min(max, mid))
  }
  if (isHorizontal(sa)) {
    const forward = sa === 'right' ? b.x - a.x >= 2 * GAP : a.x - b.x >= 2 * GAP
    if (forward) {
      const mx = clampMid(a.x, b.x, (a.x + b.x) / 2 + lane)
      if (Math.abs(a.y - b.y) < 0.5) return { points: [a, b], label: { x: mx, y: a.y } }
      return { points: [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b], label: { x: mx, y: (a.y + b.y) / 2 } }
    }
    const a1 = out(a, sa, GAP)
    const b1 = out(b, sb, GAP)
    const ly = Math.max(sBox.y + sBox.height, tBox.y + tBox.height) + GAP
    return { points: [a, a1, { x: a1.x, y: ly }, { x: b1.x, y: ly }, b1, b], label: { x: (a1.x + b1.x) / 2, y: ly } }
  }
  const forward = sa === 'bottom' ? b.y - a.y >= 2 * GAP : a.y - b.y >= 2 * GAP
  if (forward) {
    const my = clampMid(a.y, b.y, (a.y + b.y) / 2 + lane)
    if (Math.abs(a.x - b.x) < 0.5) return { points: [a, b], label: { x: a.x, y: my } }
    return { points: [a, { x: a.x, y: my }, { x: b.x, y: my }, b], label: { x: (a.x + b.x) / 2, y: my } }
  }
  const a1 = out(a, sa, GAP)
  const b1 = out(b, sb, GAP)
  const lx = Math.max(sBox.x + sBox.width, tBox.x + tBox.width) + GAP
  return { points: [a, a1, { x: lx, y: a1.y }, { x: lx, y: b1.y }, b1, b], label: { x: lx, y: (a1.y + b1.y) / 2 } }
}

/** A small loop for an edge from a node to itself, on its source side. */
export function selfLoop(box: Box, side: Side): Route {
  const a = portPoint(box, side, -10)
  const b = portPoint(box, side, 10)
  const a1 = out(a, side, 26)
  const b1 = out(b, side, 26)
  return { points: [a, a1, b1, b], label: out(anchor(box, side), side, 34) }
}

/**
 * Routes for every edge of a diagram. Edges that share a node side get spread
 * across it, ordered by where their other end is, so they don't cross each other
 * right at the node. Diamonds keep a single port per side (their sides slope).
 */
/** Is `p` on the border of `b` (within `tol` px)? */
export function onBorder(b: Box, p: Point, tol = 1.5): boolean {
  const inX = p.x >= b.x - tol && p.x <= b.x + b.width + tol
  const inY = p.y >= b.y - tol && p.y <= b.y + b.height + tol
  const onV = Math.abs(p.x - b.x) <= tol || Math.abs(p.x - (b.x + b.width)) <= tol
  const onH = Math.abs(p.y - b.y) <= tol || Math.abs(p.y - (b.y + b.height)) <= tol
  return (onV && inY) || (onH && inX)
}

/** Is `p` one of the four vertices of the diamond inscribed in `b`? */
export function atVertex(b: Box, p: Point, tol = 1.5): boolean {
  const sides: Side[] = ['top', 'right', 'bottom', 'left']
  return sides.some((side) => {
    const v = anchor(b, side)
    return Math.abs(v.x - p.x) <= tol && Math.abs(v.y - p.y) <= tol
  })
}

/** Label anchor for a route without one: the middle of its longest segment. */
export function routeLabelPoint(points: Point[]): Point {
  let best = 0
  let at = { x: points[0].x, y: points[0].y }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > best) {
      best = len
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
  }
  return at
}

export type PrecomputedRoutes = Record<string, { points: Point[]; label?: Point }>

/**
 * Routes for every edge. Prefers the obstacle-avoiding route the layout engine
 * computed, as long as its ends still sit on both nodes' borders (on a vertex,
 * for diamonds), i.e. neither node has been dragged since. Otherwise uses the
 * local router below.
 */
export function computeRoutes(
  diagram: IRDiagram,
  boxes: Map<string, Box>,
  shapeOf: (id: string) => Shape,
  precomputed?: PrecomputedRoutes,
): Map<string, Route> {
  const fromEngine = new Map<string, Route>()
  if (precomputed) {
    for (const e of diagram.edges) {
      const r = precomputed[e.id]
      const sBox = boxes.get(e.source)
      const tBox = boxes.get(e.target)
      if (!r || !sBox || !tBox || r.points.length < 2) continue
      const start = r.points[0]
      const end = r.points[r.points.length - 1]
      // Diamonds only connect at their vertices; anywhere else on the box is empty space.
      const okStart = shapeOf(e.source) === 'diamond' ? atVertex(sBox, start) : onBorder(sBox, start)
      const okEnd = shapeOf(e.target) === 'diamond' ? atVertex(tBox, end) : onBorder(tBox, end)
      if (!okStart || !okEnd) continue
      fromEngine.set(e.id, { points: r.points, label: r.label ?? routeLabelPoint(r.points) })
    }
  }
  const local = localRoutes({ ...diagram, edges: diagram.edges.filter((e) => !fromEngine.has(e.id)) }, boxes, shapeOf)
  const out = new Map<string, Route>()
  for (const e of diagram.edges) {
    const r = fromEngine.get(e.id) ?? local.get(e.id)
    if (r) out.set(e.id, r)
  }
  return out
}

/**
 * The local router: orthogonal routes with ports spread across shared node
 * sides, ordered by where the other end is, so edges don't cross at the node.
 * Diamonds keep a single port per side (their sides slope).
 */
export function localRoutes(diagram: IRDiagram, boxes: Map<string, Box>, shapeOf: (id: string) => Shape): Map<string, Route> {
  const { source: sa, target: sb } = handleSides(diagram.direction)
  const center = (id: string): Point => {
    const b = boxes.get(id)!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const edges = diagram.edges.filter((e) => boxes.has(e.source) && boxes.has(e.target))

  // node id + side → edges using that side, with the coordinate to sort by
  const slots = new Map<string, { edgeId: string; key: number }[]>()
  const push = (nodeId: string, side: Side, edgeId: string, other: string) => {
    const c = center(other)
    const k = `${nodeId}|${side}`
    const arr = slots.get(k) ?? []
    arr.push({ edgeId, key: isHorizontal(side) ? c.y : c.x })
    slots.set(k, arr)
  }
  for (const e of edges) {
    if (e.source === e.target) continue
    push(e.source, sa, e.id, e.target)
    push(e.target, sb, e.id, e.source)
  }

  const offsets = new Map<string, number>() // `${edgeId}|${nodeId}|${side}` → offset
  for (const [k, list] of slots) {
    const [nodeId, side] = k.split('|') as [string, Side]
    const box = boxes.get(nodeId)!
    if (shapeOf(nodeId) === 'diamond') {
      for (const s of list) offsets.set(`${s.edgeId}|${k}`, 0)
      continue
    }
    list.sort((p, q) => p.key - q.key || p.edgeId.localeCompare(q.edgeId))
    const spread = spreadOffsets(list.length, isHorizontal(side) ? box.height : box.width)
    list.forEach((s, i) => offsets.set(`${s.edgeId}|${k}`, spread[i]))
  }

  const routes = new Map<string, Route>()
  for (const e of edges) {
    const sBox = boxes.get(e.source)!
    const tBox = boxes.get(e.target)!
    if (e.source === e.target) {
      routes.set(e.id, selfLoop(sBox, sa))
      continue
    }
    const aOff = offsets.get(`${e.id}|${e.source}|${sa}`) ?? 0
    const a = portPoint(sBox, sa, aOff)
    const b = portPoint(tBox, sb, offsets.get(`${e.id}|${e.target}|${sb}`) ?? 0)
    // Fan-out: of the edges heading the same way, the one leaving from the port
    // nearer that way turns first, so their bends nest instead of overlapping.
    const across = isHorizontal(sa) ? b.y - a.y : b.x - a.x
    const lane = Math.abs(across) < 1 ? 0 : -Math.sign(across) * aOff * 0.8
    routes.set(e.id, routeEdge(sBox, tBox, sa, sb, a, b, lane))
  }
  return routes
}

/** SVG path through orthogonal points with rounded corners (radius r). */
export function pointsToPath(points: Point[], r = 8, round = (n: number) => Math.round(n * 10) / 10): string {
  if (points.length === 0) return ''
  const parts = [`M${round(points[0].x)},${round(points[0].y)}`]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]
    const c = points[i]
    const n = points[i + 1]
    const d1 = Math.hypot(c.x - p.x, c.y - p.y)
    const d2 = Math.hypot(n.x - c.x, n.y - c.y)
    const rr = Math.min(r, d1 / 2, d2 / 2)
    if (rr < 0.5) {
      parts.push(`L${round(c.x)},${round(c.y)}`)
      continue
    }
    const s = { x: c.x - ((c.x - p.x) / d1) * rr, y: c.y - ((c.y - p.y) / d1) * rr }
    const t = { x: c.x + ((n.x - c.x) / d2) * rr, y: c.y + ((n.y - c.y) / d2) * rr }
    parts.push(`L${round(s.x)},${round(s.y)} Q${round(c.x)},${round(c.y)} ${round(t.x)},${round(t.y)}`)
  }
  const last = points[points.length - 1]
  parts.push(`L${round(last.x)},${round(last.y)}`)
  return parts.join(' ')
}
