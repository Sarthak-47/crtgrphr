import type { Direction } from '@shared/ir'

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** Which side of a node edges leave from / arrive at, for a flow direction.
 *  Shared by the canvas and the SVG exporter so both look the same. */
export function handleSides(dir: Direction | undefined): { source: Side; target: Side } {
  switch (dir) {
    case 'LEFT':
      return { source: 'left', target: 'right' }
    case 'DOWN':
      return { source: 'bottom', target: 'top' }
    case 'UP':
      return { source: 'top', target: 'bottom' }
    default:
      return { source: 'right', target: 'left' }
  }
}

export function anchor(
  box: { x: number; y: number; width: number; height: number },
  side: Side,
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: box.x + box.width / 2, y: box.y }
    case 'bottom':
      return { x: box.x + box.width / 2, y: box.y + box.height }
    case 'left':
      return { x: box.x, y: box.y + box.height / 2 }
    case 'right':
      return { x: box.x + box.width, y: box.y + box.height / 2 }
  }
}
