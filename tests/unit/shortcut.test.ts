import { describe, expect, it } from 'vitest'
import { routeCost, shortcut } from '../../src/renderer/src/render/shortcut'

describe('route shortcut', () => {
  const s = { x: 0, y: 0, width: 100, height: 40 }
  const t = { x: 600, y: 60, width: 100, height: 40 }
  // A tall frame between them, reaching well below the ends.
  const frame = { x: 250, y: 30, width: 150, height: 400 }
  const member = { x: 270, y: 50, width: 110, height: 40 }
  const longWay = [
    { x: 100, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 460 }, { x: 500, y: 460 }, { x: 500, y: 80 }, { x: 600, y: 80 },
  ]

  it('takes the clear way over an obstacle instead of the long way under it', () => {
    const better = shortcut(longWay, s, t, [s, t, frame, member])!
    expect(better).toBeDefined()
    expect(routeCost(better)).toBeLessThan(routeCost(longWay) * 0.85)
    expect(better[0]).toEqual(longWay[0])
    expect(better[better.length - 1]).toEqual(longWay[longWay.length - 1])
    // never through the frame
    for (const p of better) expect(p.x > frame.x && p.x < frame.x + frame.width && p.y > frame.y && p.y < frame.y + frame.height).toBe(false)
  })

  it('leaves a route alone when nothing clearly shorter is clear', () => {
    // a wall reaching from far above down to just over the route under it
    const wall = { x: 250, y: -500, width: 150, height: 900 }
    expect(shortcut(longWay, s, t, [s, t, wall])).toBeUndefined()
  })

  it('reroutes a link drawn through a part, even when the clear way is longer', () => {
    const through = [{ x: 100, y: 20 }, { x: 350, y: 20 }, { x: 350, y: 80 }, { x: 600, y: 80 }]
    const blocker = { x: 300, y: 0, width: 100, height: 100 }
    const better = shortcut(through, s, t, [s, t, blocker])!
    expect(better).toBeDefined()
    for (let i = 1; i < better.length; i++) {
      const a = better[i - 1], b = better[i]
      const crosses = Math.max(a.x, b.x) > blocker.x && Math.min(a.x, b.x) < blocker.x + blocker.width && Math.max(a.y, b.y) > blocker.y && Math.min(a.y, b.y) < blocker.y + blocker.height
      expect(crosses).toBe(false)
    }
  })
})
