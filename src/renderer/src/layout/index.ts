/**
 * One entry point for laying out any diagram type: sequence diagrams use their
 * own column/row layout, everything else goes through ELK with pin-and-reflow.
 */
import type { IRDiagram, LayoutOverrides } from '@shared/ir'
import { layout as elkLayout, type LaidOut } from './elk'
import { layoutSequence } from './sequence'

export async function layoutDiagram(diagram: IRDiagram, overrides: LayoutOverrides = {}): Promise<LaidOut> {
  if (diagram.type === 'sequence') return layoutSequence(diagram)
  return elkLayout(diagram, overrides)
}
