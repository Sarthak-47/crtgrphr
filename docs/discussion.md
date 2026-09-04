# Design discussion — working session guide

> **Purpose:** a structured agenda for Sarthak + collaborator to work through
> together, in order, and come out with decisions. Each topic is framed as a
> *decision to make*, with options and trade-offs, and a blank **Decision** line
> to fill in live. When you decide something, also flip its row in
> [`open-questions.md`](open-questions.md) and, for the big ones, write an ADR in
> [`decisions/`](decisions/).
>
> Suggested order matters: earlier topics frame later ones. Budget ~90 min.

---

## How to run this

- One person drives the doc, the other pushes back. Swap per section.
- For each topic: read the framing → 5 min argue → write the **Decision** (or
  "defer, need X"). Don't polish; capture the call and the *why*.
- It's fine to leave things deferred. Mark them clearly so we don't assume.

---

## Part 1 — Frame (decide these first; they cascade)

### 1. Who is this for, really? (10 min)
The primary v1 user bends every later choice.
- **Option A:** working engineers mapping a repo *they own* (dev tool).
- **Option B:** architects/staff doing design reviews & target-state docs.
- **Option C:** educators/devrel making explanatory diagrams.

Trade-off: A leans hard into repo-parsing + local/offline; C leans into polish +
export + sharing. We can't be great at all three in v1.

**Decision:** ____________________________________________
**Why:** _________________________________________________

### 2. The headline wedge (10 min)
What's the *one* thing we're unmistakably better at than Mermaid/Excalidraw/Eraser/Archify?
- **A — Grounded maps:** point at real code, get a real map.
- **B — Auto-layout you can still edit:** structure *and* freedom.

Note: not mutually exclusive. Question is which leads product + which we build first.

**Decision (headline / build-first):** _____________________
**Why:** _________________________________________________

### 3. Platform (10 min)
- **Electron** — filesystem access (repo parsing w/o upload), offline, native dialogs. Desktop-only, heavier.
- **Web** — instant, shareable, no install. No direct FS (upload/zip only).
- **Tauri** — like Electron but Rust core, tiny bundle. Steeper if we're not fluent in Rust.
- **Shared-core, Electron first** — keep IR/layout/render portable; ship desktop now, web later.

Tie-in: if the wedge (topic 2) is "grounded maps," FS access is near-mandatory → Electron/Tauri.

**Decision:** ____________________________________________
**Why:** _________________________________________________

---

## Part 2 — Core technical shape

### 4. The IR (the contract everything depends on) (15 min)
Agree on the *shape*, not the final schema.
- Nodes carry **semantic role**, not styling. **No pixel coordinates** in the authored IR.
- Layout positions live **separately** (`id → {x, y, pinned}`), so hand-tweaks don't pollute the model.
- Groups/boundaries as container nodes.

Sub-decisions:
- **Diagram types in v1:** all 5 (arch/workflow/sequence/dataflow/lifecycle), or start with **architecture only** and design for growth?
- **Schema versioning/migrations** from day one, or add when first needed?
- **Git-friendliness:** stable serialization so diagrams diff cleanly in PRs — yes/no?

**Decision (IR shape):** ___________________________________
**Decision (types in v1):** _________________________________
**Decision (versioning):** _________________________________

### 5. Layout & the override model (10 min)
The UX crux — this is the exact thing Archify got wrong.
- **Free drag:** dragged position sticks forever (can drift into a mess).
- **Pin-and-reflow:** dragged nodes become *pinned*; "Auto-layout" re-flows the rest around them. ← proposed
- **Snap-back:** auto-layout always wins; manual moves are temporary.

Engine: **ELK** (layered, orthogonal) vs **dagre** (simpler/lighter) vs custom.

**Decision (override model):** ______________________________
**Decision (engine):** _____________________________________

### 6. Repo parser depth (10 min)
How far up the ladder for v1?
1. Manifests + infra (`docker-compose`, `package.json`, `go.mod`, Dockerfile) — cheap, good.
2. Monorepo topology (workspaces/packages + inter-deps).
3. Import/dependency graph per language — real but per-language work.
4. Call/route analysis — expensive, likely post-v1.

**Decision (v1 rungs):** ___________________________________

### 7. AI generation & privacy (10 min)
The AI only emits **IR JSON** (no coordinates); we validate against the schema.
- **API, BYO key** (Anthropic/OpenAI): best quality, data leaves machine, needs key.
- **Local (Ollama):** offline, private, lower quality.
- **Hybrid:** local default, API opt-in.

Tie-in: does our privacy stance ("nothing leaves unless the user shares") apply to AI too?

**Decision:** ____________________________________________
**Why:** _________________________________________________

---

## Part 3 — Working together

### 8. Ownership split (5 min)
Roughly two halves: **(a) engine** — IR, layout, repo parser, AI adapter; **(b) experience** — canvas, editor, inspector, export.
- Who takes which? Where's the seam/interface between them (so we can work in parallel)?

**Decision:** ____________________________________________

### 9. Stack lock (5 min)
Provisional: Electron + electron-vite + React + TS + @xyflow/react + elkjs + zustand.
- Accept as-is, or swap anything (e.g. Tauri, Svelte, dagre)?

**Decision:** ____________________________________________

### 10. Definition of "v1 done" (10 min)
What's the first thing we demo to someone and feel proud of?
- Strawman: *point at a repo → editable, auto-laid-out map → export PNG/SVG + save/reopen project.*

**Decision (v1 scope):** ___________________________________
**Explicit v1 non-goals:** _________________________________

### 11. Archify licensing stance (5 min)
Archify is MIT (itself based on Cocoon-AI's generator). Ideas are free; borrowed *code* needs license + attribution.
- **Clean-room** (start fresh, credit in NOTICE) vs **fork/borrow** (carry MIT).

**Decision:** ____________________________________________

---

## Decisions log (fill in during/after the session)

| Topic | Decision | Owner | ADR? |
|---|---|---|---|
| 1. Primary user |  |  |  |
| 2. Wedge |  |  |  |
| 3. Platform |  |  | ADR-000_ |
| 4. IR shape |  |  | ADR-000_ |
| 5. Layout/override |  |  |  |
| 6. Parser depth |  |  |  |
| 7. AI/privacy |  |  |  |
| 8. Ownership split |  |  |  |
| 9. Stack |  |  | ADR-000_ |
| 10. v1 scope |  |  |  |
| 11. Licensing |  |  |  |

## Parking lot (things raised but out of scope for this session)

- _______________________________________________________
- _______________________________________________________
