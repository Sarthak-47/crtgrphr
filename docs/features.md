# Features — the Electron app

> **Status: PROPOSED for discussion.** This is the feature set we're aiming at,
> so you and your friend can see the whole shape and argue scope. Everything is
> tagged with a **tier** and a rough **effort** — see legends below. Final scope
> is decided in [`discussion.md`](discussion.md); this doc is the menu, not the order.

## Tier legend

- **v1** — first releasable version. The thing we demo and are proud of.
- **v1.x** — fast follow, shortly after v1.
- **later** — real, but not soon. Parked so we design v1 without blocking it.

## Effort legend (rough, per person)

| Tag | Meaning |
|---|---|
| **XS** | ~½–1 day |
| **S** | ~1–3 days |
| **M** | ~3–7 days (about a week) |
| **L** | ~1–2 weeks |
| **XL** | ~3+ weeks |

Estimates assume the IR + layout + canvas foundation already exists (so they're
*marginal* costs once the core is up). The foundation itself is called out first.

---

## 0. Foundation (not a user feature, but everything sits on it)

| Capability | Effort | Notes |
|---|---|---|
| Electron shell (main/preload/renderer), self-contained deps | **S** | electron-vite; proven in the spike |
| The **IR** (typed system model, no pixel coords) | **M** | the core contract — worth doing carefully |
| **Auto-layout** engine integration (ELK) | **M** | coordinate-free IR → clean layout |
| **Canvas** (React Flow) with semantic node rendering | **M** | roles → color/shape, pan/zoom, minimap |
| App state, undo/redo, theming | **S** | zustand + history |

> Realistically the foundation is the bulk of v1. The features below get cheap
> *because* of it.

---

## 1. Getting a map in — the four doors

Every input compiles to the same IR.

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **Scan a real repo** (pick a folder) | v1 | **M** | Main process reads the filesystem directly — no upload. Parses `docker-compose.yml`, `package.json`, `go.mod`, Dockerfiles → a grounded starter map. *This is the wedge.* |
| **Deeper repo analysis** (imports/monorepo graph) | v1.x–later | **L–XL** | Per-language import graphs, workspace/package topology. Higher fidelity, per-language work. |
| **Describe it to AI** | v1.x | **M** | A prompt box → the AI emits IR JSON (no coordinates), validated against the schema, then auto-laid-out. |
| **Import Mermaid** | v1 | **S** | Paste flowchart / sequenceDiagram / stateDiagram → IR. We read topology, re-lay-out, re-theme. |
| **Paste IR / agent JSON** | v1 | **XS** | For power users and coding agents that output our format. |
| **Start blank & build by hand** | v1 | **XS** | Add nodes/edges on the canvas from nothing. |

## 2. Editing on the canvas

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **Drag nodes** | v1 | **XS** | Free movement (override model decided in discussion topic 5). |
| **Drag-to-connect** edges | v1 | **XS** | Pull from a node handle to another to draw a relationship. |
| **Inspector panel** | v1 | **S** | Edit label, sublabel, semantic role, brand badge; delete; see provenance. |
| **Pin & re-flow** | v1 | **S** | Pin hand-placed nodes; "Auto-layout" flows the rest around them. Fixes Archify's core pain. |
| **Groups / boundaries** | v1.x | **M** | Draw a VPC/cluster/trust-boundary container around nodes. |
| **Inline rename** | v1 | **XS** | Double-click to edit text in place. |
| **Multi-select & bulk ops** | v1.x | **S** | Move/recolor/delete several at once. |
| **Undo / redo + shortcuts** | v1 | **S** | Full history; keyboard-driven. |

## 3. Understanding a map (interaction)

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **Reach highlighting** | v1 | **S** | Select a node → its upstream/downstream path lights up, the rest dims. |
| **Search / jump to node** | v1 | **XS** | Filter and focus by name. |
| **Legend** (roles → meaning) | v1 | **XS** | Always-available key to the semantic colors. |
| **Path / route probe** | v1.x | **M** | Trace and highlight the shortest authored path between two nodes. |
| **Saved views / focus modes** | later | **M** | Named subsets ("delivery path", "data plane") you can flip between. |
| **Guided walkthrough / stories** | later | **L** | Step through a map one chapter at a time (presentations). |

## 4. Layout & aesthetics

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **One-click auto-layout** | v1 | (in foundation) | Re-run the engine any time. |
| **Direction control** (→ ↓ ← ↑) | v1 | **XS** | Flow orientation per diagram. |
| **Dark / light themes** | v1 | **S** | Theme-aware, meaning preserved across both. |
| **Semantic node shapes** | v1 | **S** | Cylinders for stores, diamonds for decisions, etc. |
| **Visual presets / skins** | later | **M** | Alternate looks (blueprint, editorial) like Archify's presets. |

## 5. Grounding & truth (the differentiator)

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **Provenance on nodes** | v1 | **S** | Each derived node remembers where it came from (file/path). |
| **Re-scan & diff** | v1.x | **L** | Re-run the scan on a changed repo → see added / removed / changed components (Archify's "delta", but from real code). |
| **Open source at a node** | later | **M** | Jump from a node to the file/dir it represents. |
| **Drift detection** | later | **XL** | Warn when the saved map no longer matches the repo. |

## 6. Export & sharing

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **Export PNG** | v1 | **S** | High-res raster for docs/PRs/slides. |
| **Export SVG** | v1 | **S** | Clean vector, deterministic (drawn straight from IR). |
| **Export IR JSON** | v1 | **XS** | Portable, re-importable, agent-friendly. |
| **Share card (1200×630)** | v1.x | **S** | Canonical image for READMEs / social. |
| **Export Mermaid** | v1.x | **S** | Round-trip back out to Mermaid text. |
| **Standalone interactive HTML** | later | **M** | A self-contained explorable file (Archify's signature output). |

## 7. Desktop-native powers (why Electron earns its place)

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **Direct filesystem access** | v1 | (in repo scan) | Read a repo with no upload, no zip, no cloud. |
| **Fully offline** | v1 | **XS** | Everything works with no network (AI optional/local). |
| **Native file dialogs** | v1 | **XS** | Real open/save, save-as PNG/SVG. |
| **Recent projects / reopen** | v1 | **S** | Pick up where you left off. |
| **Local project files** (`.crtgrphr`) | v1 | **S** | IR + layout overrides + meta, diff-friendly, re-openable. |
| **Auto-update** | later | **M** | Ship new versions to installs. |
| **Packaged installers** (.exe/.dmg/AppImage) | v1.x | **M** | electron-builder; real distributable app. |

## 8. AI, done privately

| Feature | Tier | Effort | What it does |
|---|---|---|---|
| **Describe → IR** (as above) | v1.x | **M** | Constrained generation the schema can validate. |
| **Local model (Ollama)** | v1.x | **M** | Offline, private generation — no key, no data leaving the machine. |
| **BYO API key** (opt-in) | v1.x | **S** | Higher quality when the user explicitly opts in. |
| **AI refine / "clean this up"** | later | **M** | Ask the model to simplify or re-group an existing map. |
| **Natural-language edits** | later | **L** | "Add a Redis cache between the API and DB" applied to the IR. |

---

## Proposed v1 cut (strawman for topic 10 in the discussion)

**In:** foundation · scan a repo · Mermaid import · paste/blank · full canvas editing + inspector · pin-&-reflow · reach highlight + search + legend · auto-layout + direction + themes + semantic shapes · provenance · export PNG/SVG/JSON · offline + native dialogs + recent projects + local project file.

**Out of v1 (fast follow):** AI generation, deep import-graph parsing, groups/boundaries, re-scan diff, packaged installers, share cards, Mermaid export.

> This is a *proposal to react to*, not a plan. Decide the real cut together in
> `discussion.md` topic 10.
