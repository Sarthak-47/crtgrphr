# Cartographer (`crtgrphr`)

> Turn a codebase, a description, or a rough sketch into a **grounded, auto-laid-out, editable** system map — and keep it in sync as the system changes.

**Status: 🟢 Building, milestones M0–M3 done.** The core loop works end to end:
scan a repo (compose, monorepos, Node/Python/Go/Rust), edit the map with
pin-and-reflow auto-layout, save and reopen `.crtgrphr` files, export SVG/PNG.
All five diagram types render properly: real shapes, obstacle-avoiding edges,
flowchart-style decisions, true sequence diagrams with lifelines, and a legend.
Scans follow real imports (JS/TS and Python), maps can be re-scanned with a diff
preview, exported as 1200×630 share cards, and packaged as an installer.

## Install

Installers are built by the [Release workflow](.github/workflows/release.yml)
for Windows (`.exe`), Linux (`.AppImage`) and macOS (`.dmg`) and attached to each
GitHub Release. They are not code-signed yet, so Windows SmartScreen and macOS
Gatekeeper will warn on first launch.

To build one locally:

```bash
npm run dist       # installer for this OS, into release/
npm run package    # just the unpacked app folder
``` See [`docs/build-plan.md`](docs/build-plan.md)
for what's next.

## Run it

Requires Node.js 18+. Dependencies and caches stay inside the project folder
(see `.npmrc`).

```bash
npm install
npm run dev        # launch the app with hot reload
npm test           # unit tests (Vitest)
npm run e2e        # build, then drive the real Electron app end to end
npm run check      # typecheck + unit tests + build (what CI runs, minus E2E)
```

---

## The one-line thesis

Existing tools force a trade-off:

- **Mermaid / diagrams-as-code** — text is versionable, but layout is rigid and output is static.
- **Excalidraw / Figma / whiteboards** — infinitely editable, but nothing is grounded in the real system and it rots instantly.
- **Archify** (the project that inspired this) — validated and interactive, but an AI must hand-author pixel coordinates, output is frozen HTML, and it can't read real code.

**Cartographer's bet:** you can have *auto-layout you can still edit by hand*, fed by
*maps grounded in real code* — in one tool.

## What we're exploring

- A single typed **IR** (intermediate representation) that every input compiles to.
- **Automatic layout** (authors never write coordinates) that still allows human overrides.
- Four ways in: **AI from a description**, **parse a real repo**, **hand-edit on a canvas**, **import Mermaid**.
- Local-first and privacy-respecting where possible.

## Where to read next

| Doc | What it covers |
|---|---|
| [`docs/vision.md`](docs/vision.md) | Problem, audience, positioning, the wedge |
| [`docs/discussion.md`](docs/discussion.md) | **Working-session guide** — the agenda to decide things with |
| [`docs/features.md`](docs/features.md) | Planned feature set (tiers + effort estimates) |
| [`docs/design.md`](docs/design.md) | Architecture & data-model discussion (living) |
| [`docs/build-plan.md`](docs/build-plan.md) | Solo milestone plan (M0–M4) |
| [`docs/open-questions.md`](docs/open-questions.md) | The forks we need to settle before building |
| [`docs/decisions/`](docs/decisions/) | ADRs — decisions once they're locked |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Workflow and conventions for this repo |

## Team

Built solo by **Sarthak**. Design-first: each decision is discussed and recorded
before the code it implies is written.
