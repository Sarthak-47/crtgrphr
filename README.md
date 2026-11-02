# Cartographer (`crtgrphr`)

> Turn a codebase, a description, or a rough sketch into a **grounded, auto-laid-out, editable** system map — and keep it in sync as the system changes.

**Status: 🟢 Building, milestone M0 done.** The Electron app runs: a coordinate-free
IR, ELK auto-layout with pin-and-reflow, repo scanning, Mermaid/JSON import,
an editable canvas, and PNG/SVG export. See [`docs/build-plan.md`](docs/build-plan.md)
for what's next.

## Run it

Requires Node.js 18+. Dependencies and caches stay inside the project folder
(see `.npmrc`).

```bash
npm install
npm run dev        # launch the app with hot reload
npm run typecheck  # type-check main + renderer
npm run build      # production build into out/
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
