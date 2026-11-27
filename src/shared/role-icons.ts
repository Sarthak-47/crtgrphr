/**
 * A drawn icon for each architecture role, shown in a part's badge when no brand
 * logo is known, so every part of a map carries a glyph. Stroke paths on a 24×24
 * grid, drawn with round caps and joins; dots are zero-length segments. Flowchart
 * roles (process, decision, state, terminal) and groups have none.
 */
import type { NodeRole } from './ir'

export const ROLE_ICONS: Partial<Record<NodeRole, string>> = {
  external: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Z M3.5 12h17 M12 3c-2.6 2.6-3.6 5.6-3.6 9s1 6.4 3.6 9 M12 3c2.6 2.6 3.6 5.6 3.6 9s-1 6.4-3.6 9',
  frontend: 'M3 5h18v14H3Z M3 9h18 M6 7h0 M8.5 7h0',
  backend: 'M4 4h16v6H4Z M4 14h16v6H4Z M7.5 7h0 M7.5 17h0 M11 7h5 M11 17h5',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  cache: 'M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z',
  queue: 'M3 7h13 M3 12h17 M3 17h13 M17 4.5l3 2.5-3 2.5 M17 14.5l3 2.5-3 2.5',
  cloud: 'M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 8.6 5 5 0 0 1 17 18.5Z',
  service: 'M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5Z M12 12l8.5-4.75 M12 12v9.5 M12 12 3.5 7.25',
}

export function roleIcon(role: NodeRole): string | undefined {
  return ROLE_ICONS[role]
}
