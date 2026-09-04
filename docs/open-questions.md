# Open questions — to settle before implementation

> The forks that actually change what we build. Each should end as an ADR in
> `docs/decisions/`. Owner = who drives the decision. Status = open / leaning / decided.

| # | Question | Leaning (not decided) | Owner | Status |
|---|---|---|---|---|
| Q1 | Who is the **primary user** for v1? | Working engineers mapping a repo they own | — | open |
| Q2 | What's the **headline wedge** — grounded maps, or auto-layout-you-can-edit? | Build B (auto-layout) first, market A (grounded) | — | open |
| Q3 | How many **diagram types** in v1? | Start with **architecture** only; design IR for more | — | open |
| Q4 | **Layout override model** — free drag / pin-and-reflow / snap-back? | Pin-and-reflow | — | open |
| Q5 | **Repo-parser depth** for v1? | Manifests + monorepo topology (rungs 1–2) | — | open |
| Q6 | **AI**: API (BYO key), local (Ollama), or hybrid? | Local-first, API opt-in | — | open |
| Q7 | **Platform**: Electron, web, or shared-core both? | Electron first, core kept portable | — | open |
| Q8 | **Stack**: Electron/React/ELK vs Tauri/Rust vs other? | Electron/React/ELK | — | open |
| Q9 | **Project file format** — JSON only, or also a text authoring format? | JSON project file for v1 | — | open |
| Q10 | **Two-person split** — who owns engine/IR vs canvas/UI? | — | — | open |
| Q11 | Do we **fork/credit Archify** (MIT) or start fully clean? | Clean-room, credit in NOTICE | — | open |
| Q12 | **Scope of v1 / definition of done** — what's the first thing we demo? | Repo → editable map → export | — | open |

## Notes / parking lot

- Archify is MIT-licensed and itself based on `Cocoon-AI/architecture-diagram-generator`. If we borrow *ideas* that's free; if we borrow *code* we must preserve license + attribution. Q11 decides our stance.
- The deleted Electron spike proved: ELK auto-layout from a coordinate-free IR works, React Flow editing works, and `docker-compose.yml` parsing gives a usable first map. Those learnings inform, but don't pre-decide, the questions above.
- Discussion cadence: bring your friend in on Q1, Q2, Q7, Q8 first — they frame everything else.
