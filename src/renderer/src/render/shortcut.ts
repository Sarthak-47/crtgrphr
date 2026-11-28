/**
 * A post-pass over engine routes. The layout engine sometimes takes the long way
 * round an obstacle (under a tall group frame instead of over it). When a simple
 * orthogonal path with the same end points is clear of every other part and frame
 * and clearly shorter, use it instead.
 */
import type { Box, Point } from './geometry'

const GAP = 18 // how far a detour stays from what it passes
const BEND = 28 // a bend costs as much as this much extra length

type Side = 'left' | 'right' | 'top' | 'bottom'

function sideOf(b: Box, p: Point, tol = 1.5): Side | undefined {
  if (Math.abs(p.x - b.x) <= tol) return 'left'
  if (Math.abs(p.x - (b.x + b.width)) <= tol) return 'right'
  if (Math.abs(p.y - b.y) <= tol) return 'top'
  if (Math.abs(p.y - (b.y + b.height)) <= tol) return 'bottom'
  return undefined
}

export function routeCost(points: Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y)
  return len + BEND * Math.max(0, points.length - 2)
}

const contains = (outer: Box, inner: Box): boolean =>
  outer !== inner && inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5

/** Does the axis-aligned segment a→b pass through the inside of box `o` (inflated by `pad`)? */
function hits(a: Point, b: Point, o: Box, pad: number): boolean {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
  return x1 > o.x - pad && x0 < o.x + o.width + pad && y1 > o.y - pad && y0 < o.y + o.height + pad
}

/** Frame edges: does the segment cross a frame's border line (entering or leaving it)? Frames you're inside are fine to stay in. */
function crossesFrame(a: Point, b: Point, f: Box): boolean {
  const inside = (p: Point) => p.x > f.x && p.x < f.x + f.width && p.y > f.y && p.y < f.y + f.height
  return hits(a, b, f, 2) && !(inside(a) && inside(b))
}

const swap = (p: Point): Point => ({ x: p.y, y: p.x })
const swapBox = (b: Box): Box => ({ x: b.y, y: b.x, width: b.height, height: b.width })

/**
 * A shorter clear path for `points` (from box `s` to box `t`), or undefined.
 * `others` are every drawn box; the ends, and frames that hold either end, are not obstacles.
 */
export function shortcut(points: Point[], s: Box, t: Box, others: Box[]): Point[] | undefined {
  if (points.length < 2) return undefined
  const start = points[0]
  const end = points[points.length - 1]
  const ss = sideOf(s, start)
  const ts = sideOf(t, end)
  if (!ss || !ts) return undefined
  const horizontal = (x: Side) => x === 'left' || x === 'right'
  if (horizontal(ss) !== horizontal(ts)) return undefined
  // Work as if the ends leave sideways; transpose when they leave top/bottom.
  const flip = !horizontal(ss)
  const P = (p: Point) => (flip ? swap(p) : p)
  const B = (b: Box) => (flip ? swapBox(b) : b)
  const st = P(start), en = P(end)
  const sb = B(s), tb = B(t)
  const out = ss === 'right' || ss === 'bottom' ? 1 : -1 // exit direction along the main axis
  const inn = ts === 'left' || ts === 'top' ? 1 : -1 // travel direction when arriving
  const containers = others.filter((o) => contains(o, s) || contains(o, t))
  const obstacles = others.map(B).filter((_, i) => others[i] !== s && others[i] !== t && !containers.includes(others[i]))
  const isFrame = (o: Box) => obstacles.some((p) => contains(o, p))
  const clear = (path: Point[]): boolean => {
    for (let i = 1; i < path.length; i++) {
      for (const o of obstacles) {
        if (isFrame(o) ? crossesFrame(path[i - 1], path[i], o) : hits(path[i - 1], path[i], o, 6)) return false
      }
    }
    // don't run along the border of a frame an end sits in, where the line would read as the frame
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]
      for (const c of containers.map(B)) {
        const alongH = a.y === b.y && Math.max(a.x, b.x) > c.x && Math.min(a.x, b.x) < c.x + c.width && (Math.abs(a.y - c.y) < 10 || Math.abs(a.y - c.y - c.height) < 10)
        const alongV = a.x === b.x && Math.max(a.y, b.y) > c.y && Math.min(a.y, b.y) < c.y + c.height && (Math.abs(a.x - c.x) < 10 || Math.abs(a.x - c.x - c.width) < 10)
        if (alongH || alongV) return false
      }
    }
    // the first and last legs must actually leave / arrive in the right direction
    return Math.sign(path[1].x - path[0].x) === out && Math.sign(path[path.length - 1].x - path[path.length - 2].x) === inn
  }

  const candidates: Point[][] = []
  const x1 = st.x + out * GAP
  const x2 = en.x - inn * GAP
  // Z: across, along, across — the middle leg at any x between the ends.
  const xs = new Set<number>([(st.x + en.x) / 2, x1, x2])
  for (const o of obstacles) for (const x of [o.x - GAP, o.x + o.width + GAP]) xs.add(x)
  for (const x of xs) candidates.push([st, { x, y: st.y }, { x, y: en.y }, en])
  // Channel: out, over (or under) everything in the way, back in.
  const ys = new Set<number>()
  for (const o of [...obstacles, ...containers.map(B), sb, tb]) for (const y of [o.y - GAP, o.y + o.height + GAP]) ys.add(y)
  for (const y of ys) candidates.push([st, { x: x1, y: st.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: en.y }, en])

  // A route through a part (not a frame) is wrong however short it is: any clear path beats it.
  const parts = obstacles.filter((o) => !isFrame(o))
  const through = points.some((p, i) => i > 0 && parts.some((o) => hits(P(points[i - 1]), P(p), o, -2)))
  if (points.length < 4 && !through) return undefined
  const before = routeCost(points)
  let best: Point[] | undefined
  let bestCost = through ? Infinity : before * 0.85 // otherwise only a clearly shorter path is worth the change
  for (const c of candidates) {
    const path = c.filter((p, i) => i === 0 || p.x !== c[i - 1].x || p.y !== c[i - 1].y)
    const simple = path.filter((p, i) => i === 0 || i === path.length - 1 || !((path[i - 1].x === p.x && p.x === path[i + 1].x) || (path[i - 1].y === p.y && p.y === path[i + 1].y)))
    if (simple.length < 2 || !clear(simple)) continue
    const cost = routeCost(simple)
    if (cost < bestCost) {
      bestCost = cost
      best = simple
    }
  }
  return best && (flip ? best.map(swap) : best)
}

/**
 * Bundling: several links from parts of one group to the same target are drawn as
 * a bus. Each leaves its part, joins a shared trunk just outside the group's
 * frame, and the trunk enters the target at one point under one arrowhead.
 * Only the drawing changes; every link is still there (and selectable).
 *
 * `routes` are the current routes of the links (same target, sources in `frame`).
 * Returns new points per link id, or undefined when a clear bus can't be drawn.
 */
export function bundle(
  routes: { id: string; points: Point[]; source: Box }[],
  frame: Box,
  target: Box,
  others: Box[],
): Map<string, Point[]> | undefined {
  if (routes.length < 3) return undefined
  // One shared entry: the middle link's, so the bus lands where the links already aim.
  const ends = routes.map((r) => r.points[r.points.length - 1]).sort((a, b) => a.y - b.y || a.x - b.x)
  const entry = ends[Math.floor(ends.length / 2)]
  const ts = sideOf(target, entry)
  if (!ts) return undefined
  const flip = ts === 'top' || ts === 'bottom'
  const P = (p: Point) => (flip ? swap(p) : p)
  const B = (b: Box) => (flip ? swapBox(b) : b)
  const en = P(entry)
  const fr = B(frame)
  const inn = ts === 'left' || ts === 'top' ? 1 : -1
  // The trunk runs just outside the frame, on the side facing the target.
  const j = inn === 1 ? fr.x + fr.width + GAP : fr.x - GAP
  if ((en.x - j) * inn < GAP) return undefined
  const obstacles = others.filter((o) => o !== target && o !== frame && !routes.some((r) => r.source === o) && !contains(o, target) && !contains(frame, o)).map(B)
  const blocked = (a: Point, b: Point) => obstacles.some((o) => hits(a, b, o, 4))
  const out = new Map<string, Point[]>()
  for (const r of routes) {
    const st = P(r.points[0])
    const s = B(r.source)
    // must leave its part on the side facing the target
    const exits = inn === 1 ? Math.abs(st.x - (s.x + s.width)) <= 1.5 : Math.abs(st.x - s.x) <= 1.5
    if (!exits) return undefined
    const pts = [st, { x: j, y: st.y }, { x: j, y: en.y }, en].filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y)
    for (let i = 2; i < pts.length; i++) if (blocked(pts[i - 1], pts[i])) return undefined
    out.set(r.id, flip ? pts.map(swap) : pts)
  }
  return out
}
