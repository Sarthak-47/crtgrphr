# Open questions — decision status

> Settled in the design session on **2026-09-06**. Most are now decided; the big
> ones are captured as ADRs in `docs/decisions/`. One remains open pending the
> collaborator. To change a decided item, write a new ADR that supersedes.

| # | Question | Decision | ADR | Status |
|---|---|---|---|---|
| Q1 | Who is the **primary user** for v1? | Working engineers mapping a repo they own | — | ✅ decided |
| Q2 | What's the **headline wedge**? | Build auto-layout-you-can-edit first; market grounded maps | — | ✅ decided |
| Q3 | Diagram **types** in v1? | **All 5**, all rendered at launch | [0003](decisions/0003-ir-and-data-model.md) | ✅ decided |
| Q4 | Layout **override model**? | Pin-and-reflow | [0004](decisions/0004-layout-and-override-model.md) | ✅ decided |
| Q5 | **Repo-parser depth** for v1? | Manifests + monorepo topology (rungs 1–2); design for import-graphs later | — | ✅ decided |
| Q6 | **AI**: API / local / hybrid? | Hybrid — local (Ollama) default, API opt-in; ships v1.x | — | ✅ decided |
| Q7 | **Platform**? | Electron, core kept portable | [0002](decisions/0002-platform-electron.md) | ✅ decided |
| Q8 | **Stack**? | Electron + electron-vite + React + TS + @xyflow/react + elkjs + zustand | [0005](decisions/0005-tech-stack.md) | ✅ decided |
| Q9 | **Project file format**? | JSON project file (`.crtgrphr`), git-friendly & diffable; `schema_version` from day one, migrations when first needed | [0003](decisions/0003-ir-and-data-model.md) | ✅ decided |
| Q10 | **Two-person split** — engine vs UI? | Deferred — decide once collaborator weighs in on strengths/preferences | — | ⏳ open |
| Q11 | **Fork/credit Archify** or clean-room? | Clean-room; credit in `NOTICE` | [0006](decisions/0006-licensing-clean-room.md) | ✅ decided |
| Q12 | **v1 definition of done**? | Full core loop + all 5 renderers (see below) | — | ✅ decided |

## v1 definition of done (Q12)

**Ships in v1:** repo-scan (manifests + monorepo) → auto-laid-out, editable map
with pin-and-reflow → **all 5 diagram types rendered** → Mermaid import + paste/blank
input → inspector, reach highlighting, search, legend → dark/light + semantic shapes
→ export PNG/SVG/JSON → offline, native dialogs, recent projects, `.crtgrphr` project files.

**Deferred to v1.x:** AI generation (hybrid local/API), deep import-graph parsing,
packaged installers, share cards, Mermaid export, groups/boundaries, re-scan diff.

**Rough size:** ~9–14 person-weeks (all-5-renderers is the main driver over the
architecture-only baseline). ~5–7 calendar weeks split two ways once the ownership
seam (Q10) is set.

## Still open

- **Q10 — ownership split.** Bring the collaborator in; decide who owns the
  **engine** (IR, layout, parser, AI adapter) vs the **experience** (canvas, editor,
  inspector, export). The IR is the seam that lets both proceed in parallel.
