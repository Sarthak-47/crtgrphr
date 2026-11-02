/**
 * Role → visual identity. Semantic color mapping used by the canvas and the SVG
 * exporter. Two palettes keyed by the same role so theme switching preserves
 * meaning. Colors chosen for contrast and colorblind-safety.
 */
import type { NodeRole } from './ir'

export interface RoleStyle {
  label: string
  accent: string
  fill: string
  shape: 'box' | 'rounded' | 'cylinder' | 'diamond' | 'pill' | 'stadium'
}

type Palette = Record<NodeRole, RoleStyle>

export const LIGHT: Palette = {
  external: { label: 'External', accent: '#64748b', fill: '#f1f5f9', shape: 'rounded' },
  frontend: { label: 'Frontend', accent: '#0891b2', fill: '#ecfeff', shape: 'rounded' },
  backend: { label: 'Backend', accent: '#7c3aed', fill: '#f5f3ff', shape: 'rounded' },
  database: { label: 'Database', accent: '#c026d3', fill: '#fdf4ff', shape: 'cylinder' },
  cache: { label: 'Cache', accent: '#ea580c', fill: '#fff7ed', shape: 'cylinder' },
  queue: { label: 'Queue', accent: '#0d9488', fill: '#f0fdfa', shape: 'box' },
  cloud: { label: 'Cloud', accent: '#2563eb', fill: '#eff6ff', shape: 'rounded' },
  service: { label: 'Service', accent: '#d97706', fill: '#fffbeb', shape: 'rounded' },
  process: { label: 'Process', accent: '#4f46e5', fill: '#eef2ff', shape: 'box' },
  decision: { label: 'Decision', accent: '#db2777', fill: '#fdf2f8', shape: 'diamond' },
  state: { label: 'State', accent: '#0284c7', fill: '#f0f9ff', shape: 'stadium' },
  terminal: { label: 'Terminal', accent: '#16a34a', fill: '#f0fdf4', shape: 'pill' },
  group: { label: 'Group', accent: '#94a3b8', fill: 'rgba(148,163,184,0.06)', shape: 'box' },
}

export const DARK: Palette = {
  external: { label: 'External', accent: '#94a3b8', fill: '#1e293b', shape: 'rounded' },
  frontend: { label: 'Frontend', accent: '#22d3ee', fill: '#0e2a30', shape: 'rounded' },
  backend: { label: 'Backend', accent: '#a78bfa', fill: '#241b3a', shape: 'rounded' },
  database: { label: 'Database', accent: '#e879f9', fill: '#2a1533', shape: 'cylinder' },
  cache: { label: 'Cache', accent: '#fb923c', fill: '#331a0d', shape: 'cylinder' },
  queue: { label: 'Queue', accent: '#2dd4bf', fill: '#0c2c29', shape: 'box' },
  cloud: { label: 'Cloud', accent: '#60a5fa', fill: '#12233f', shape: 'rounded' },
  service: { label: 'Service', accent: '#fbbf24', fill: '#332616', shape: 'rounded' },
  process: { label: 'Process', accent: '#818cf8', fill: '#1c1f3a', shape: 'box' },
  decision: { label: 'Decision', accent: '#f472b6', fill: '#331523', shape: 'diamond' },
  state: { label: 'State', accent: '#38bdf8', fill: '#0c2233', shape: 'stadium' },
  terminal: { label: 'Terminal', accent: '#4ade80', fill: '#0d2818', shape: 'pill' },
  group: { label: 'Group', accent: '#64748b', fill: 'rgba(100,116,139,0.10)', shape: 'box' },
}

export function palette(theme: 'light' | 'dark'): Palette {
  return theme === 'dark' ? DARK : LIGHT
}
