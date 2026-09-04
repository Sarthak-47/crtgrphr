# Design & architecture — living discussion doc

> **Status: DRAFT for discussion.** This is where the technical shape gets argued
> out. It's deliberately incomplete. Sections marked 🗣️ are open. When a section
> stabilizes, extract the decision into `docs/decisions/`.

## 1. The big picture (proposed)

```
  Inputs                     Core                        Outputs
  ──────                     ────                        ───────
  AI (describe)   ┐
  Repo parser     ├──▶  [ IR: typed system model ] ──▶ [ Layout engine ] ──▶ [ Canvas / editor ]
  Hand editing    │            ▲                                                     │
  Mermaid import  ┘            └───────────── edits ─────────────────────────────────┘
                                                                             ──▶ Export (PNG/SVG/JSON)
                                                                             ──▶ Project file (re-openable)
```

Everything hinges on the **IR** in the middle. Get it right and the rest is swappable.

## 2. The IR — the core contract 🗣️

The single most important decision. Strawman:

- **Nodes** — id, label, sublabel?, semantic **role** (external/frontend/backend/database/cache/queue/cloud/service/process/decision/state/terminal), optional brand, optional parent (grouping), optional provenance (where it came from).
- **Edges** — id, source, target, label?, variant (default/emphasis/dashed/weak).
- **Groups / boundaries** — clusters (VPC, cluster, trust boundary) as container nodes.
- **No pixel coordinates in the authored IR.** Positions are a *layout output*, optionally overridden by the user and stored separately.

Open questions:
- 🗣️ Do we keep Archify's **5 diagram types** (architecture/workflow/sequence/dataflow/lifecycle) or start with **1–2** and expand?
- 🗣️ How do we store **user layout overrides** without polluting the semantic IR? (Proposal: a separate `layout` map of `id → {x,y,pinned}` alongside the graph.)
- 🗣️ Versioning: schema version field + migrations from day one? (Archify has a heavy migration system — cost vs benefit.)
- 🗣️ Is the IR file format **git-friendly** (stable key order, one-node-per-line) so diagrams diff well in PRs?

## 3. Layout engine 🗣️

- Candidate: **ELK** (elkjs) — layered/orthogonal, crossing minimization. Proven in the deleted spike; produces clean results with zero authored coordinates.
- Alternatives: dagre (simpler, lighter), custom.
- **Hybrid layout** is the key UX question: when a user drags a node, do we (a) keep it as a free override forever, (b) let them "pin" specific nodes and re-flow the rest around them, or (c) snap back on next auto-layout? Proposal: **pin model** — dragged nodes become pinned; "Auto-layout" respects pins.

## 4. Canvas / editor 🗣️

- Candidate: **React Flow (@xyflow/react)** — nodes, edges, handles, minimap, pan/zoom, drag-to-connect, out of the box.
- Needs: semantic node rendering per role, inline editing, an inspector panel, selection-driven highlighting (reach/paths).

## 5. Repo parser 🗣️ — the differentiator

Depth ladder (each rung is more work + more value):

1. **Manifests & infra** — `docker-compose.yml` (services + depends_on), `package.json`, `pyproject`, `go.mod`, Dockerfiles. Cheap, surprisingly good.
2. **Monorepo topology** — workspaces/packages and their inter-dependencies.
3. **Import/dependency graph** — parse source imports per language → module graph. Language-by-language effort.
4. **Call/route analysis** — real dispatch paths. Expensive; probably out of v1 scope.

🗣️ How far up this ladder for v1? Proposal: **rung 1 + rung 2**, designed so rung 3 can slot in per-language later.

## 6. AI generation 🗣️

- **API (BYO key)** — Anthropic/OpenAI. Best quality, but data leaves the machine and needs a key.
- **Local model (Ollama)** — aligns with local-first/privacy; lower quality, no key, offline.
- **Hybrid** — local by default, API opt-in.
- The AI's job is only to emit **IR JSON** (no coordinates) — a constrained, checkable task. We validate its output against the schema.

🗣️ Privacy stance: does "nothing leaves the machine unless the user shares" extend to AI? If yes, **local-first with explicit API opt-in**.

## 7. Platform 🗣️

- **Electron** — filesystem access (repo parsing without upload), offline, native file dialogs. Heavier, desktop-only.
- **Web** — shareable, zero-install, but no direct filesystem access (uploads/zip only).
- **Both via shared core** — renderer/IR/layout are platform-agnostic; wrap in Electron now, web later.

🗣️ Proposal: **Electron first** (the repo-parsing wedge needs the filesystem), architected so the core could later run on web.

## 8. Persistence 🗣️

- A **project file** (`.crtgrphr` / JSON) holding IR + layout overrides + meta, re-openable and diff-friendly.
- 🗣️ Do we also support a plain-text authoring format (like Mermaid) for people who prefer typing?

## 9. Stack summary (all provisional)

| Concern | Candidate | Alternatives |
|---|---|---|
| Shell | Electron + electron-vite | Tauri, web-only |
| UI | React + TypeScript | Svelte, Solid |
| Canvas | @xyflow/react | custom, konva |
| Layout | elkjs | dagre |
| State | zustand | redux, jotai |
| AI | BYO API + local Ollama | one or the other |

> None of the above is locked. Tauri (Rust) is worth a look if bundle size /
> performance matters and we're comfortable with Rust.
