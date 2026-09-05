# 3. The IR and data model

Date: 2026-09-06

## Status

Accepted

## Context

Every input path (repo scan, AI, hand editing, Mermaid import) must produce the
same thing, and every output (canvas, export, project file) must consume it. That
"thing" is the IR — the single most load-bearing decision in the project. Archify's
core mistake was baking pixel coordinates into its authored model, which forced a
large, brittle apparatus to keep hand-authored geometry readable. We will not
repeat that.

We also decided in this session to support **all five diagram types** (architecture,
workflow, sequence, dataflow, lifecycle) rendered at launch, and to make project
files **git-friendly** so maps review well in PRs.

## Decision

1. **Semantic, coordinate-free authored IR.** Nodes carry a semantic **role**
   (external/frontend/backend/database/cache/queue/cloud/service/process/decision/
   state/terminal/group), labels, optional brand, optional parent (grouping), and
   optional provenance. Nodes do **not** carry authored pixel coordinates.
2. **Positions are a separate layer.** Layout output and user overrides live in a
   separate `layout` map (`id → { x, y, pinned }`), never mixed into the semantic
   graph. This keeps the model clean and makes "re-derive from source" safe.
3. **One IR, five types.** A single node/edge/group model serves all five diagram
   types; the `diagram_type` field plus per-type renderers/layout defaults handle
   the differences. All five render at launch (per the v1 scope decision).
4. **Versioned from day one, migrations later.** Every file carries a
   `schema_version`. We do **not** build the migration runner until the first
   breaking change requires it.
5. **Git-friendly serialization.** The project file (`.crtgrphr`, JSON) uses stable
   key ordering and a line-oriented node/edge layout so diffs are readable in PRs.

## Consequences

- Auto-layout is always possible from the semantic graph alone; hand-tweaks never
  corrupt the model and can be discarded to re-derive a clean map.
- Supporting all five types at launch is the main driver of v1 size (~9–14 wk) —
  accepted deliberately for a more complete first release.
- The separate layout layer is what makes pin-and-reflow (ADR-0004) implementable
  cleanly.
- Deferring the migration runner risks a retrofit later, mitigated by having the
  version field present from the start.
- Stable serialization costs a little care in the writer but pays off for the
  engineers-reviewing-maps-in-PRs audience.
