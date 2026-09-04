# Vision — discussion draft

> **Status: DRAFT for discussion.** Nothing here is decided. This is a starting
> point to react to, edit, and argue with. Strike through what's wrong, add what's
> missing. Decisions that survive get promoted to an ADR.

## The problem

Engineers constantly need to *understand* and *communicate* how a system is put
together — for onboarding, design reviews, incident response, and architecture
decisions. The artifacts they use to do this are bad in predictable ways:

- **They rot.** A diagram drawn once is wrong within a sprint. Nobody updates it.
- **They're ungrounded.** Most diagrams are someone's memory of the system, not the system.
- **They're either rigid or messy.** Diagrams-as-code won't lay out nicely; freeform canvases have no structure or truth.

## Who it's for (candidate audiences — pick a primary)

1. **Individual engineers / small teams** mapping their own services to think and to onboard others.
2. **Staff/architect roles** doing design reviews and documenting target-state architecture.
3. **Devrel / educators** producing clean explanatory diagrams.

> 🗣️ **Discuss:** who is the *primary* user for v1? The tool bends a lot depending
> on this. A strong default: **working engineers mapping a repo they own.**

## Positioning — the competitive field

| Tool | Strength | Weakness we exploit |
|---|---|---|
| Mermaid | Versionable text, ubiquitous | Rigid layout, static, ungrounded |
| Excalidraw | Delightful freeform editing | No structure, no grounding, rots |
| Eraser.io | AI + diagrams-as-code, polished | Cloud-only, not grounded in *your* code |
| Lucid/Figma | Powerful canvases | Manual, expensive, ungrounded |
| Archify | Validated, interactive, typed IR | AI hand-authors coordinates; frozen HTML; can't read code |

## The wedge (what we're unmistakably better at)

Two candidates. We may pick one to lead with:

- **A) Grounded maps.** Point at a real repo → get a map derived from actual
  structure (imports, services, dependencies), that you can then refine. "Your
  architecture diagram, reverse-engineered and always re-derivable."
- **B) Auto-layout you can still edit.** The Archify pain point solved: give the
  semantic graph, get a clean layout, then drag to taste without losing the
  structure. Best-of-both vs Mermaid (rigid) and Excalidraw (chaotic).

> 🗣️ **Discuss:** A and B are complementary, but which is the *headline*? My lean:
> **B is the everyday magic; A is the acquisition hook.** Lead marketing with A,
> build B first because everything depends on it.

## Principles (proposed)

1. **Grounded over guessed** — prefer facts derived from real artifacts.
2. **Auto-layout, human-final** — the machine arranges; the human overrides and it sticks.
3. **Local-first & private** — the tool should work fully offline; nothing leaves the machine unless the user explicitly shares.
4. **One IR, many doors** — every input path produces the same typed model.
5. **Editable, not frozen** — output is always a living document.

## Explicit non-goals (proposed)

- Not a general whiteboard (no free-drawing / sticky notes).
- Not a full BPMN/UML modeling suite.
- Not (initially) a real-time multiplayer product.

> 🗣️ **Discuss:** do we agree on these non-goals? Each one we relax is a lot more scope.

## Success signals for v1

- A user can point at one of their own repos and get a map that's *recognizably their system* in < 30 seconds.
- Editing that map feels better than fighting Mermaid.
- The map exports somewhere useful (PNG/SVG for a doc/PR, and a re-openable project file).
