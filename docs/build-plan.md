# Build plan (solo)

> Cartographer is built solo by **Sarthak**. This replaces the earlier two-person
> work split (Q10). The code is still organized into two layers joined by the IR,
> because that structure keeps the core clean and portable (ADR-0002), not
> because of team boundaries.

## Code layers

- **Engine & data:** `src/shared/` (the IR, serialization, role tokens), `src/main/`
  (repo scanner, IPC), `src/renderer/src/layout/` (ELK + pin-and-reflow),
  `adapters/` (Mermaid / agent JSON), `graph/` (reach, paths).
- **Experience & UI:** `src/renderer/src/canvas/`, `ui/`, `export/`, `styles.css`,
  `index.html`.
- **The seam:** `src/shared/`. UI code reaches the engine only through its typed
  outputs (`IRDiagram`, `CartographProject`, `LaidOut`, `LayoutOverrides`).

## Milestones

**M0: Foundation running. ✅ Done (2026-11-02).** App launches with sample maps
for all five types, drag pins a node, and Auto-layout re-flows around pins.

**M1: Core loop.** Repo scanner holds up on real repos. Canvas editing, inspector,
save/open `.crtgrphr`, PNG/SVG export.

**M2: All 5 types render well.** Per-type layout rules (sequence lifelines, lifecycle
phases, dataflow left-to-right), real per-role node shapes, legend.

**M3: Grounding depth and polish.** Monorepo graph, then import-graph parsing.
Provenance, re-scan diff, share cards, onboarding, packaged installer.

**M4: AI (v1.x).** Describe→IR using local Ollama by default with opt-in API,
schema-validated, plus the "Describe your system" input.

## Sizing

The v1 scope (core loop plus all 5 renderers) was estimated at **~9–14
person-weeks**. Solo, that is also the calendar estimate.
