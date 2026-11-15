// Cartographer site. Draws the maps in data.json (real Cartographer output) and
// makes View 1 live: drag a box to pin it, then ELK re-flows the rest around it,
// with the same layout options the app uses (src/renderer/src/layout/elk.ts).

const NS = 'http://www.w3.org/2000/svg'
const REPO = 'Sarthak-47/crtgrphr'
const ELK_URL = 'https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js'
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const narrow = matchMedia('(max-width: 640px)')
const PAD = 26

const $ = (s, r = document) => r.querySelector(s)
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(e)
  return e
}
const clone = (o) => JSON.parse(JSON.stringify(o))

/* ── Shapes: drafting symbols per role ─────────────────────────── */

function shapePaths(role, w, h) {
  const r = 5
  const rect = `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`
  if (role === 'database' || role === 'cache') {
    const ry = Math.min(9, h * 0.13)
    const body = `M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}Z`
    const lines = [`M0 ${ry}A${w / 2} ${ry} 0 0 0 ${w} ${ry}`]
    if (role === 'cache') lines.push(`M0 ${ry + 7}A${w / 2} ${ry} 0 0 0 ${w} ${ry + 7}`)
    return { body, lines, textShift: ry * 0.6 }
  }
  if (role === 'decision') {
    return { body: `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`, lines: [], textShift: 0 }
  }
  if (role === 'cloud') {
    const c = 11
    return { body: `M${c} 0H${w - c}L${w} ${c}V${h - c}L${w - c} ${h}H${c}L0 ${h - c}V${c}Z`, lines: [], textShift: 0 }
  }
  if (role === 'queue') {
    return { body: rect, lines: [`M${w - 12} 0V${h}`, `M${w - 19} 0V${h}`], textShift: 0, textNudge: -10 }
  }
  if (role === 'frontend') {
    return { body: rect, lines: [`M0 11H${w}`], textShift: 4 }
  }
  return { body: rect, lines: [], textShift: 0 }
}

/* ── Geometry ──────────────────────────────────────────────────── */

const cx = (b) => b.x + b.w / 2
const cy = (b) => b.y + b.h / 2

function onBorder(p, b) {
  const t = 2
  const inOuter = p[0] >= b.x - t && p[0] <= b.x + b.w + t && p[1] >= b.y - t && p[1] <= b.y + b.h + t
  const inInner = p[0] > b.x + t && p[0] < b.x + b.w - t && p[1] > b.y + t && p[1] < b.y + b.h - t
  return inOuter && !inInner
}

/** A simple orthogonal route, used while a box is being moved and whenever the
 *  layout engine's route no longer touches both boxes. */
function route(s, t, dir) {
  const across = dir === 'DOWN' ? false : true
  const gapX = t.x - (s.x + s.w)
  const gapXBack = s.x - (t.x + t.w)
  const gapY = t.y - (s.y + s.h)
  const gapYBack = s.y - (t.y + t.h)
  const horiz = across ? Math.max(gapX, gapXBack) > 16 || Math.max(gapY, gapYBack) <= 16 : Math.max(gapY, gapYBack) <= 16 && Math.max(gapX, gapXBack) > 16
  if (horiz && Math.max(gapX, gapXBack) > 0) {
    const fwd = gapX >= gapXBack
    const sx = fwd ? s.x + s.w : s.x
    const tx = fwd ? t.x : t.x + t.w
    const sy = cy(s)
    const ty = cy(t)
    const mx = (sx + tx) / 2
    return Math.abs(sy - ty) < 1 ? [[sx, sy], [tx, ty]] : [[sx, sy], [mx, sy], [mx, ty], [tx, ty]]
  }
  const down = gapY >= gapYBack
  const sy = down ? s.y + s.h : s.y
  const ty = down ? t.y : t.y + t.h
  const sx = cx(s)
  const tx = cx(t)
  const my = (sy + ty) / 2
  return Math.abs(sx - tx) < 1 ? [[sx, sy], [tx, ty]] : [[sx, sy], [sx, my], [tx, my], [tx, ty]]
}

function longestSegmentMid(pts) {
  let best = 0
  let mid = pts[0]
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len > best) {
      best = len
      mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    }
  }
  return mid
}

/** Revision cloud: a scalloped outline around a box. */
function cloudPath(x, y, w, h) {
  const step = 15
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
  let d = `M${x} ${y}`
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]
    const [bx, by] = corners[i]
    const len = Math.hypot(bx - ax, by - ay)
    const n = Math.max(2, Math.round(len / step))
    for (let k = 1; k <= n; k++) {
      const px = ax + ((bx - ax) * k) / n
      const py = ay + ((by - ay) * k) / n
      const r = (len / n) * 0.62
      d += `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)}`
    }
  }
  return d
}

function deltaMark(parent, x, y, n) {
  const g = el('g', { class: 'delta fade', transform: `translate(${x} ${y})` }, parent)
  el('path', { d: 'M0 -12L12 9H-12Z' }, g)
  const t = el('text', { y: 6 }, g)
  t.textContent = n
  return g
}

/* ── Map renderer ──────────────────────────────────────────────── */

let mapCount = 0

class MapView {
  constructor(svg, layout, opts = {}) {
    this.svg = svg
    this.opts = opts
    this.uid = `m${++mapCount}`
    svg.textContent = ''
    const defs = el('defs', {}, svg)
    const marker = el('marker', { id: `${this.uid}-arrow`, viewBox: '0 0 10 10', refX: 9.5, refY: 5, markerWidth: 10, markerHeight: 10, markerUnits: 'userSpaceOnUse', orient: 'auto' }, defs)
    el('path', { d: 'M0 1L10 5L0 9Z', class: 'arrow' }, marker)
    this.gMarks = el('g', {}, svg)
    this.gEdges = el('g', {}, svg)
    this.gLabels = el('g', {}, svg)
    this.gNodes = el('g', {}, svg)
    this.gOver = el('g', {}, svg)
    this.load(layout)
  }

  load(layout) {
    this.layout = layout
    this.dir = layout.direction
    this.boxes = {}
    this.gNodes.textContent = ''
    for (const n of layout.nodes) {
      const b = { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, node: n }
      this.boxes[n.id] = b
      b.g = this.drawNode(n)
    }
    this.routes = {}
    for (const e of layout.edges) if (e.points) this.routes[e.id] = e.points
    this.render()
  }

  drawNode(n) {
    const g = el('g', { class: 'node', 'data-id': n.id }, this.gNodes)
    const s = shapePaths(n.role, n.w, n.h)
    el('path', { d: s.body, class: 'body draw', pathLength: 1 }, g)
    for (const d of s.lines) el('path', { d, class: 'ink draw', pathLength: 1 }, g)
    const tx = n.w / 2 + (s.textNudge || 0) / 2
    const mid = n.h / 2 + s.textShift
    const label = el('text', { x: tx, y: n.sublabel ? mid - 3 : mid + 5, 'text-anchor': 'middle', class: 'n-label' }, g)
    label.textContent = n.label
    if (n.sublabel) {
      const sub = el('text', { x: tx, y: mid + 14, 'text-anchor': 'middle', class: 'n-sub' }, g)
      sub.textContent = n.sublabel
    }
    if (this.opts.live) {
      const pin = el('g', { class: 'pin', transform: `translate(${n.w / 2} ${n.h})` }, g)
      el('path', { d: 'M0 0L-9 13H9Z', class: 'pin-tri' }, pin)
      el('path', { d: 'M-15 13H15M-13 13l-5 6M-6 13l-5 6M1 13l-5 6M8 13l-5 6M15 13l-5 6' }, pin)
    }
    return g
  }

  edgePoints(e) {
    const s = this.boxes[e.source]
    const t = this.boxes[e.target]
    const r = this.routes[e.id]
    if (r && r.length >= 2 && onBorder(r[0], s) && onBorder(r[r.length - 1], t)) return r
    return route(s, t, this.dir)
  }

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const b of Object.values(this.boxes)) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  render() {
    for (const b of Object.values(this.boxes)) b.g.setAttribute('transform', `translate(${b.x} ${b.y})`)
    this.gEdges.textContent = ''
    this.gLabels.textContent = ''
    const skip = this.opts.hideLabel
    for (const e of this.layout.edges) {
      const pts = this.edgePoints(e)
      const cls = ['edge', 'draw']
      if (e.variant === 'dashed' || e.variant === 'async') { cls.splice(1, 1, 'dashed', 'fade') }
      if (this.opts.edgeClass) cls.push(...this.opts.edgeClass(e))
      const p = el('path', { d: 'M' + pts.map((q) => q.join(' ')).join('L'), class: cls.join(' '), 'marker-end': `url(#${this.uid}-arrow)`, 'data-edge': e.id, 'data-src': e.source, 'data-tgt': e.target }, this.gEdges)
      if (!cls.includes('fade')) p.setAttribute('pathLength', 1)
      if (e.label && e.label !== skip) {
        const m = longestSegmentMid(pts)
        const t = el('text', { x: m[0], y: m[1] + 4, 'text-anchor': 'middle', class: 'e-label' }, this.gLabels)
        t.textContent = e.label
      }
    }
    let b = this.bounds()
    if (this.opts.live) {
      const x1 = Math.max(b.x + b.w, this.layout.width - 12)
      const y1 = Math.max(b.y + b.h, this.layout.height - 12)
      b = { x: Math.min(b.x, 12), y: Math.min(b.y, 12) }
      b.w = x1 - b.x
      b.h = y1 - b.y
    }
    this.svg.setAttribute('viewBox', `${b.x - PAD} ${b.y - PAD} ${b.w + PAD * 2} ${b.h + PAD * 2 + (this.opts.live ? 22 : 0)}`)
    if (this.opts.after) this.opts.after(this)
  }

  /** Pen-stroke draw-in, ordered roughly by layer. */
  drawIn() {
    if (reduced) return
    const axis = this.dir === 'DOWN' ? 'y' : 'x'
    const order = Object.values(this.boxes).sort((a, b) => a[axis] - b[axis])
    const span = Math.max(1, order[order.length - 1][axis] - order[0][axis])
    const delay = {}
    for (const b of order) {
      delay[b.id] = Math.round(((b[axis] - order[0][axis]) / span) * 700)
      b.g.style.setProperty('--d', `${delay[b.id]}ms`)
    }
    for (const p of this.gEdges.children) p.style.setProperty('--d', `${delay[p.dataset.src] + 380}ms`)
    for (const t of this.gLabels.children) t.style.setProperty('--d', '1000ms')
    for (const t of [...this.gMarks.children, ...this.gOver.children]) t.style.setProperty('--d', '1200ms')
    this.svg.classList.add('drawing')
    clearTimeout(this.drawT)
    this.drawT = setTimeout(() => this.svg.classList.remove('drawing'), 2400)
  }

  /** Animate boxes (and the edges with them) to new positions. */
  animateTo(target, routes, ms = 520) {
    const from = {}
    for (const [id, b] of Object.entries(this.boxes)) from[id] = { x: b.x, y: b.y }
    this.routes = {}
    const done = () => {
      for (const [id, p] of Object.entries(target)) Object.assign(this.boxes[id], p)
      this.routes = routes
      this.render()
    }
    if (reduced) return done()
    const t0 = performance.now()
    const ease = (t) => 1 - Math.pow(1 - t, 3)
    cancelAnimationFrame(this.raf)
    const tick = (now) => {
      const k = ease(Math.min(1, (now - t0) / ms))
      for (const [id, p] of Object.entries(target)) {
        const b = this.boxes[id]
        b.x = from[id].x + (p.x - from[id].x) * k
        b.y = from[id].y + (p.y - from[id].y) * k
      }
      if (k < 1) {
        this.render()
        this.raf = requestAnimationFrame(tick)
      } else done()
    }
    this.raf = requestAnimationFrame(tick)
  }
}

/* ── ELK, loaded only when someone moves a box ─────────────────── */

let elkPromise
function loadElk() {
  if (!elkPromise) {
    elkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = ELK_URL
      s.async = true
      s.crossOrigin = 'anonymous'
      s.onload = () => (window.ELK ? resolve(new window.ELK()) : reject(new Error('ELK missing')))
      s.onerror = () => reject(new Error('ELK failed to load'))
      document.head.appendChild(s)
    })
    elkPromise.catch(() => { elkPromise = null })
  }
  return elkPromise
}

/** A dropped box can land where the layout engine put another one. Move the
 *  unpinned box aside, across the flow, so nothing sits on top of anything. */
function resolveOverlaps(target, view, pinned) {
  const gap = 24
  const across = view.dir === 'DOWN' ? 'x' : 'y'
  const size = across === 'x' ? 'w' : 'h'
  const ids = Object.keys(target)
  const box = (id) => ({ ...target[id], w: view.boxes[id].w, h: view.boxes[id].h })
  const hit = (a, b) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  for (let pass = 0; pass < 12; pass++) {
    let moved = false
    for (const a of ids) {
      for (const b of ids) {
        if (a === b || pinned.has(b)) continue
        if (!pinned.has(a) && a > b) continue
        const A = box(a)
        const B = box(b)
        if (!hit(A, B)) continue
        const before = A[across] - B[size] - gap
        const after = A[across] + A[size] + gap
        target[b][across] = Math.abs(B[across] - before) < Math.abs(B[across] - after) ? before : after
        moved = true
      }
    }
    if (!moved) break
  }
}

async function reflow(view, pinned) {
  const elk = await loadElk()
  const layoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': view.dir,
    'elk.layered.spacing.nodeNodeBetweenLayers': '70',
    'elk.spacing.nodeNode': '48',
    'elk.layered.spacing.edgeNodeBetweenLayers': '30',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.mergeEdges': 'false',
    'elk.spacing.edgeEdge': '14',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    'elk.interactive': 'true',
  }
  const res = await elk.layout({
    id: 'root',
    layoutOptions,
    children: Object.values(view.boxes).map((b) => ({ id: b.id, width: b.w, height: b.h, x: b.x, y: b.y })),
    edges: view.layout.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  })
  const target = {}
  for (const c of res.children) target[c.id] = { x: c.x, y: c.y }
  // Pinned boxes stay exactly where they were dropped.
  for (const id of pinned) target[id] = { x: view.boxes[id].x, y: view.boxes[id].y }
  resolveOverlaps(target, view, pinned)
  const routes = {}
  for (const e of res.edges) {
    const s = e.sections && e.sections[0]
    if (s) routes[e.id] = [s.startPoint, ...(s.bendPoints || []), s.endPoint].map((p) => [p.x, p.y])
  }
  return { target, routes }
}

/* ── View 1: the live map ──────────────────────────────────────── */

function initHero(data) {
  const svg = $('#hero-map')
  const hint = $('#hero-hint')
  const reset = $('#hero-reset')
  const pick = () => (narrow.matches ? data.heroDown : data.hero)
  let base = pick()
  const pinned = new Set()
  let busy = 0

  const view = new MapView(svg, clone(base), { live: true, hideLabel: 'depends on' })
  view.drawIn()

  const label = (b) => `${b.node.label}${b.node.sublabel ? `, ${b.node.sublabel}` : ''}${pinned.has(b.id) ? ', pinned' : ''}. Drag, or use arrow keys, to move it.`
  const decorate = () => {
    for (const b of Object.values(view.boxes)) {
      b.g.setAttribute('tabindex', '0')
      b.g.setAttribute('role', 'button')
      b.g.setAttribute('aria-label', label(b))
      b.g.classList.toggle('is-pinned', pinned.has(b.id))
    }
    reset.hidden = pinned.size === 0
  }
  decorate()

  const status = document.createElement('p')
  status.className = 'sr-only'
  status.setAttribute('aria-live', 'polite')
  status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)'
  svg.parentElement.after(status)

  const touched = () => hint && hint.classList.add('is-gone')

  async function relayout() {
    const ticket = ++busy
    try {
      const { target, routes } = await reflow(view, pinned)
      if (ticket !== busy) return
      view.animateTo(target, routes)
      status.textContent = `Layout re-flowed around ${pinned.size} pinned ${pinned.size === 1 ? 'box' : 'boxes'}.`
    } catch {
      status.textContent = 'Box moved. (The layout engine could not load, so the rest stays put.)'
      view.render()
    }
  }

  function toLocal(ev) {
    const pt = svg.createSVGPoint()
    pt.x = ev.clientX
    pt.y = ev.clientY
    return pt.matrixTransform(svg.getScreenCTM().inverse())
  }

  let drag = null
  svg.addEventListener('pointerdown', (ev) => {
    const g = ev.target.closest('.node')
    if (!g || ev.button !== 0) return
    const b = view.boxes[g.dataset.id]
    const p = toLocal(ev)
    drag = { b, dx: p.x - b.x, dy: p.y - b.y, x0: b.x, y0: b.y, moved: false, vb: svg.viewBox.baseVal }
    drag.vb = { x: drag.vb.x, y: drag.vb.y, w: drag.vb.width, h: drag.vb.height }
    g.setPointerCapture(ev.pointerId)
    g.classList.add('is-dragging')
    loadElk().catch(() => {})
    ev.preventDefault()
  })
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return
    const p = toLocal(ev)
    const { b, vb } = drag
    b.x = Math.max(vb.x + 4, Math.min(vb.x + vb.w - b.w - 4, p.x - drag.dx))
    b.y = Math.max(vb.y + 4, Math.min(vb.y + vb.h - b.h - 26, p.y - drag.dy))
    if (Math.hypot(b.x - drag.x0, b.y - drag.y0) > 3) drag.moved = true
    view.render()
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`)
    for (const e of view.gEdges.children) e.classList.toggle('is-hot', e.dataset.src === b.id || e.dataset.tgt === b.id)
  })
  const end = () => {
    if (!drag) return
    const { b, moved } = drag
    b.g.classList.remove('is-dragging')
    drag = null
    if (!moved) return view.render()
    touched()
    pinned.add(b.id)
    decorate()
    relayout()
  }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)

  let keyT
  svg.addEventListener('keydown', (ev) => {
    const g = ev.target.closest('.node')
    const step = ev.shiftKey ? 48 : 12
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key]
    if (!g || !d) return
    ev.preventDefault()
    const b = view.boxes[g.dataset.id]
    b.x += d[0]
    b.y += d[1]
    touched()
    pinned.add(b.id)
    view.render()
    decorate()
    clearTimeout(keyT)
    keyT = setTimeout(relayout, 450)
  })

  reset.addEventListener('click', () => {
    pinned.clear()
    busy++
    const target = {}
    const routes = {}
    for (const n of base.nodes) target[n.id] = { x: n.x, y: n.y }
    for (const e of base.edges) if (e.points) routes[e.id] = e.points
    view.animateTo(target, routes)
    decorate()
    status.textContent = 'Map reset to the original layout.'
  })

  narrow.addEventListener('change', () => {
    base = pick()
    pinned.clear()
    busy++
    view.load(clone(base))
    decorate()
  })
}

/* ── Static maps ───────────────────────────────────────────────── */

function whenVisible(node, fn) {
  if (!('IntersectionObserver' in window)) return fn()
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect()
      fn()
    }
  }, { threshold: 0 })
  io.observe(node)
}

function staticMap(svg, layout, opts) {
  const view = new MapView(svg, layout, opts)
  // The drawing is complete from the start; it re-draws itself with the pen as
  // its first pixel scrolls into view, so nothing depends on the observer firing.
  if (!reduced) whenVisible(svg, () => view.drawIn())
  return view
}

function initRescan(data) {
  const svg = $('#rescan-map')
  const tbody = $('#revisions')
  const render = () => {
    const layout = clone(narrow.matches ? data.rescanDown : data.rescan)
    const added = new Set(layout.added)
    const removed = new Set(layout.removed)
    const nodeIds = new Set(layout.nodes.map((n) => n.id))
    // revision order matches site-data.ts: added nodes, removed nodes, added edges, removed edges
    const order = [
      ...layout.added.filter((id) => nodeIds.has(id)).map((id) => [id, 'Added']),
      ...layout.removed.filter((id) => nodeIds.has(id)).map((id) => [id, 'Removed']),
      ...layout.added.filter((id) => !nodeIds.has(id)).map((id) => [id, 'Added']),
      ...layout.removed.filter((id) => !nodeIds.has(id)).map((id) => [id, 'Removed']),
    ]
    staticMap(svg, layout, {
      hideLabel: 'depends on',
      edgeClass: (e) => (removed.has(e.id) ? ['removed'] : []),
      after: (v) => {
        v.gMarks.textContent = ''
        v.gOver.textContent = ''
        for (const n of layout.nodes) {
          if (removed.has(n.id)) {
            const b = v.boxes[n.id]
            b.g.classList.add('removed')
            el('path', { d: `M${b.x - 6} ${b.y + b.h + 6}L${b.x + b.w + 6} ${b.y - 6}`, class: 'strike fade' }, v.gOver)
          }
        }
        order.forEach(([id, kind], i) => {
          const n = i + 1
          const b = v.boxes[id]
          if (b) {
            if (kind === 'Added') el('path', { d: cloudPath(b.x - 12, b.y - 12, b.w + 24, b.h + 24), class: 'cloud fade' }, v.gMarks)
            deltaMark(v.gOver, b.x + b.w + 14, b.y - 16, n)
          } else {
            const path = v.gEdges.querySelector(`[data-edge="${CSS.escape(id)}"]`)
            if (!path) return
            const len = path.getTotalLength()
            const p = path.getPointAtLength(len * 0.5)
            deltaMark(v.gOver, p.x, p.y - 14, n)
          }
        })
      },
    })
    tbody.textContent = ''
    layout.revisions.forEach((text, i) => {
      const tr = document.createElement('tr')
      const td0 = document.createElement('td')
      const mark = el('svg', { class: 'rev-delta', viewBox: '-13 -13 26 23', 'aria-hidden': 'true' }, td0)
      el('path', { d: 'M0 -12L12 9H-12Z' }, mark)
      const t = el('text', { y: 6 }, mark)
      t.textContent = i + 1
      const sr = document.createElement('span')
      sr.textContent = `Revision ${i + 1}`
      sr.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)'
      td0.append(sr)
      const td1 = document.createElement('td')
      td1.textContent = text.replace(/ (added|removed)$/, '').replace(/ added \(/, ' (')
      const td2 = document.createElement('td')
      td2.className = 'status'
      td2.textContent = order[i] ? order[i][1] : ''
      tr.append(td0, td1, td2)
      tbody.append(tr)
    })
  }
  render()
  narrow.addEventListener('change', render)
}

/* ── Source listings ───────────────────────────────────────────── */

const COMPOSE = `services:
  proxy:
    image: nginx:1.27
    depends_on: [web, api]
  web:
    build: ./web
  api:
    build: ./api
    depends_on:
      - db
      - cache
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
      REDIS_HOST: cache
  worker:
    build: ./worker
    depends_on:
      db:
        condition: service_healthy
    links:
      - "queue:mq"
    environment:
      - AMQP_URL=amqp://guest:guest@queue:5672
      - DB_HOST=db
  db:
    image: postgres:16
  cache:
    image: redis:7-alpine
  queue:
    image: rabbitmq:3-management`

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function yamlHtml(src) {
  return src
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*-?\s*)([\w.-]+)(:)(.*)$/)
      if (!m) return esc(line)
      return `${esc(m[1])}<span class="k">${esc(m[2])}</span>${m[3]}${esc(m[4])}`
    })
    .join('\n')
}

function mermaidHtml(src) {
  return esc(src)
    .replace(/(--&gt;|-\.-&gt;)/g, '<span class="k">$1</span>')
    .replace(/\|([^|]+)\|/g, '|<span class="s">$1</span>|')
}

/* ── Sheet border zones ────────────────────────────────────────── */

function drawZones() {
  const frame = $('.frame')
  if (!frame) return
  frame.textContent = ''
  const g = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 22
  const cols = 8
  const rows = Math.max(4, Math.min(12, Math.round(frame.offsetHeight / 520)))
  for (let i = 0; i < cols; i++) {
    for (const top of [true, false]) {
      const z = document.createElement('span')
      z.className = 'zone'
      z.textContent = String(i + 1)
      z.style.left = `${((i + 0.5) / cols) * 100}%`
      z.style.top = top ? `${g / 2}px` : `calc(100% - ${g / 2}px)`
      frame.append(z)
    }
    if (i > 0) {
      for (const top of [true, false]) {
        const t = document.createElement('span')
        t.className = 'zone-tick'
        t.style.cssText = `left:${(i / cols) * 100}%;width:1px;height:${g}px;${top ? 'top:0' : 'bottom:0'}`
        frame.append(t)
      }
    }
  }
  for (let i = 0; i < rows; i++) {
    for (const left of [true, false]) {
      const z = document.createElement('span')
      z.className = 'zone'
      z.textContent = String.fromCharCode(65 + i)
      z.style.top = `${((i + 0.5) / rows) * 100}%`
      z.style.left = left ? `${g / 2}px` : `calc(100% - ${g / 2}px)`
      frame.append(z)
    }
    if (i > 0) {
      for (const left of [true, false]) {
        const t = document.createElement('span')
        t.className = 'zone-tick'
        t.style.cssText = `top:${(i / rows) * 100}%;height:1px;width:${g}px;${left ? 'left:0' : 'right:0'}`
        frame.append(t)
      }
    }
  }
}

/* ── Downloads ─────────────────────────────────────────────────── */

const DOT = ' <span class="dot" aria-hidden="true">·</span> '
const OS_NAME = { win: 'Windows', mac: 'macOS', linux: 'Linux' }
const OS_ASSET = { win: /setup.*\.exe$/i, mac: /\.dmg$/i, linux: /\.appimage$/i }
const FALLBACK_MB = { win: 79, mac: 96, linux: 105 }

function detectOS() {
  const ua = navigator.userAgent
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
  if (/android|iphone|ipad|ipod/i.test(ua)) return null
  if (/win/i.test(platform) || /windows/i.test(ua)) return 'win'
  if (/mac/i.test(platform) || /mac os x/i.test(ua)) return 'mac'
  if (/linux|x11/i.test(platform) || /linux/i.test(ua)) return 'linux'
  return null
}

function setupDownloads() {
  const os = detectOS()
  const primary = $('#dl-primary')
  const meta = $('#dl-meta')
  const cells = {}
  document.querySelectorAll('.tb-dl').forEach((a) => {
    cells[a.dataset.os] = a
    const size = document.createElement('span')
    size.className = 'tb-size'
    size.textContent = `${FALLBACK_MB[a.dataset.os]} MB`
    a.append(size)
  })

  const apply = (version) => {
    if (os && cells[os]) {
      primary.href = cells[os].href
      primary.querySelector('span').textContent = `Download for ${OS_NAME[os]}`
      const others = Object.keys(OS_NAME).filter((k) => k !== os).map((k) => OS_NAME[k])
      meta.innerHTML = [`Version ${esc(version)}`, cells[os].querySelector('.tb-size').textContent, `also for <a href="#download">${others.join(' and ')}</a>`, 'MIT licence'].join(DOT)
    } else {
      primary.href = '#download'
      primary.querySelector('span').textContent = 'Download for desktop'
      meta.innerHTML = [`Version ${esc(version)}`, 'Windows, macOS and Linux', 'MIT licence'].join(DOT)
    }
    $('#tb-version').textContent = version
  }
  apply('1.0.0')

  // Follow the latest release if GitHub answers; the v1.0.0 links stay otherwise.
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((rel) => {
      const version = String(rel.tag_name || '').replace(/^v/, '')
      if (!version) return
      for (const [k, re] of Object.entries(OS_ASSET)) {
        const asset = (rel.assets || []).find((a) => re.test(a.name))
        if (asset && cells[k]) {
          cells[k].href = asset.browser_download_url
          cells[k].querySelector('.tb-size').textContent = `${Math.round(asset.size / 1048576)} MB`
        }
      }
      apply(version)
    })
    .catch(() => {})
}

/* ── Boot ──────────────────────────────────────────────────────── */

async function boot() {
  $('#compose-src').innerHTML = yamlHtml(COMPOSE)
  setupDownloads()
  drawZones()
  let resizeT
  addEventListener('resize', () => {
    clearTimeout(resizeT)
    resizeT = setTimeout(drawZones, 200)
  })

  let data
  try {
    data = await fetch('data.json').then((r) => r.json())
  } catch {
    return
  }
  $('#describe-text').textContent = `“${data.describe.text}”`
  $('#mermaid-src').innerHTML = mermaidHtml(data.mermaid.source)
  initHero(data)
  staticMap($('#describe-map'), clone(data.describe), {})
  staticMap($('#mermaid-map'), clone(data.mermaid), {})
  initRescan(data)
  drawZones()
}

boot()
