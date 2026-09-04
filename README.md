# Cartographer (`crtgrphr`)

> Turn a codebase, a description, or a rough sketch into a **grounded, auto-laid-out, editable** system map — and keep it in sync as the system changes.

**Status: 🟡 Planning.** No implementation yet. This repository currently holds
design and planning documents only. Code lands after the design discussion is
settled and the core decisions are recorded as ADRs.

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
| [`docs/open-questions.md`](docs/open-questions.md) | The forks we need to settle before building |
| [`docs/decisions/`](docs/decisions/) | ADRs — decisions once they're locked |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How the two of us work in this repo |

## Team

Built by **Sarthak** and a collaborator. Design-first: we discuss and record a
decision before we write the code it implies.
