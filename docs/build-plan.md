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

**M1: Core loop. ✅ Done (2026-11-03).** Repo scanner holds up on real repos. Canvas
editing, inspector, save/open `.crtgrphr`, PNG/SVG export. Verified by 77 unit tests,
an 11-step Electron end-to-end test, and CI on Windows and Linux.

Scanner additions beyond the original list: repos with several projects side by side
and no workspace config (`frontend/` + `backend/`, or a manifest only in a subfolder)
are mapped as multi-project repos; Electron apps are detected; `src/`-style folders
that only group sub-folders are expanded one level.

M1 was done when every item below was true:

- **Scanner**
  - docker-compose: `depends_on` (list or map), `links`, and edges inferred from
    environment values that name another service (`postgres://db:5432`,
    `REDIS_HOST=cache`). Compose files found in the root or common subfolders.
  - Monorepos: npm/yarn workspaces (array or `{packages}`), `pnpm-workspace.yaml`,
    `dir/*` and `dir/**` globs, internal deps including `workspace:*`.
  - Single-package fallback for Node, Python (`pyproject.toml`, `requirements.txt`),
    Go (`go.mod`) and Rust (`Cargo.toml`), with notable infra deps as nodes.
  - Never crashes the UI: malformed files are skipped, scan errors become a status
    message, and very large repos are capped with a note.
  - Every derived node records its provenance.
  - Covered by fixture tests and run against real repos.
- **Editing**
  - Delete/Backspace removes the selected node or edge.
  - Double-click a node to rename it in place.
  - A drag is one undo step; a burst of typing in one field is one undo step.
  - Edges can be selected and edited (label, style) in the inspector.
  - New ids never collide with ids from a loaded file.
  - Search with Ctrl+F jumps to a node.
  - "New" starts a blank map.
- **Save / open**
  - Ctrl+S saves to the current file without a dialog; Ctrl+Shift+S is Save As;
    Ctrl+O opens.
  - Unsaved changes show in the title, and you're asked before they're discarded
    (open, new, sample, scan, closing the window).
  - Opened files are sanitized (dangling edges dropped, duplicate ids fixed), so a
    bad file can't crash layout.
  - Save, then open, restores the diagram and its pins exactly.
- **Export**
  - SVG uses orthogonal edges like the canvas, arrowheads stop at node borders,
    role shapes are drawn (cylinder, diamond, pill), bounds include pinned nodes.
  - PNG is rendered from the same SVG at 2x.
- **Quality gates**
  - Unit tests (Vitest) for serialization, scanner, layout pins, Mermaid, export
    and store actions.
  - An end-to-end test that drives the real Electron app: launch, save, reopen,
    export.
  - GitHub Actions CI runs typecheck, unit tests and build on every push.

**M2: All 5 types render well. ✅ Done (2026-11-04).** Per-type layout rules
(sequence lifelines, lifecycle phases, dataflow left-to-right), real per-role node
shapes, legend. Verified by 107 unit tests and a 13-step Electron E2E test. Edge
routing design recorded in [ADR-0007](decisions/0007-edge-routing-and-shared-geometry.md).

Beyond the original list: edges now use ELK's obstacle-avoiding routes (validated
against current node positions, with a local fallback while dragging), so long
edges no longer cut through nodes; decision branches leave from the diamond's
vertices flowchart-style (first branch from the far vertex, the next from a side).

M2 was done when every item below was true:

- **Shapes:** the canvas draws real role shapes (diamond, cylinder, pill, stadium,
  box, rounded) from the same geometry the SVG export uses; no rotated-box hack.
- **Edges:** canvas and export share one router. Forward edges bend once; back edges
  loop around both nodes; edges sharing a node side fan out across it instead of
  converging on one point, ordered to avoid crossings.
- **Sequence:** participants in columns with lifelines; messages are horizontal
  arrows in IR edge order, top to bottom; replies (dashed) and self-messages render;
  dragging a participant sideways reorders the columns; the edge inspector can move a
  message earlier or later; export draws the same diagram.
- **Workflow and lifecycle:** start terminals sit in the first layer and end
  terminals in the last; decisions are true diamonds with room for their text.
- **Dataflow:** sources start the flow and sinks end it, left to right.
- **Legend:** a canvas legend lists only the roles and edge styles the map uses and
  can be collapsed; SVG/PNG exports include it.
- **Quality:** unit tests for shapes, ports, sequence layout, per-type layering and
  the export legend; the E2E test renders every sample type; CI green.

**M3: Grounding depth and polish.** Monorepo graph, then import-graph parsing.
Provenance, re-scan diff, share cards, onboarding, packaged installer.

**M4: AI (v1.x).** Describe→IR using local Ollama by default with opt-in API,
schema-validated, plus the "Describe your system" input.

## Sizing

The v1 scope (core loop plus all 5 renderers) was estimated at **~9–14
person-weeks**. Solo, that is also the calendar estimate.
