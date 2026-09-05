# 5. Technology stack

Date: 2026-09-06

## Status

Accepted

## Context

We need to lock the implementation stack so the two of us build against the same
choices. A throwaway spike already exercised a candidate stack end-to-end: it
typechecked, built cleanly, auto-laid-out a coordinate-free IR with ELK, and
rendered an editable canvas — giving us real (not theoretical) confidence.

The platform is Electron with a portable core (ADR-0002); the layout engine is
ELK (ADR-0004).

## Decision

| Concern | Choice |
|---|---|
| Desktop shell | **Electron** + **electron-vite** |
| Language | **TypeScript** (strict) |
| UI | **React 18** |
| Canvas | **@xyflow/react** (React Flow) |
| Layout | **elkjs** |
| State | **zustand** |
| Repo parsing (YAML) | **js-yaml** |

Project structure: `src/main` (Electron main + IPC), `src/preload` (typed bridge),
`src/renderer` (React app), `src/shared` (IR types + role tokens shared across
processes). Dependencies and caches stay inside the project folder (self-contained
rule); no machine-global installs.

## Consequences

- Proven-together stack; low integration risk, fast start.
- The core (IR/layout/render/graph) stays free of Electron imports so it remains
  portable per ADR-0002 — enforced by the `src/shared` + host-boundary structure.
- React Flow gives drag, connect, minimap, and pan/zoom out of the box, saving
  significant canvas work.
- Revisit points: dagre if ELK is too heavy (ADR-0004); Tauri if bundle/perf
  demands it (ADR-0002). Neither changes the core.
