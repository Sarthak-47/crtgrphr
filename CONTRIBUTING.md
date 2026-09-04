# Contributing

Cartographer is built by two people, design-first. This doc is intentionally
light and will grow once we start writing code. Adjust freely.

## Workflow

1. **Decide before building.** Big decisions get discussed, then recorded as an
   ADR in `docs/decisions/` before the implementing code is written. Open items
   live in `docs/open-questions.md`.
2. **Branch per change.** `main` stays green. Work on `feat/<thing>` or
   `docs/<thing>` branches and open a PR.
3. **PRs get a look from the other person** before merge. Keep them small.
4. **Commits** are clear and scoped. Conventional-commit style is encouraged but
   not enforced yet: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.

## Branch naming

- `docs/<slug>` — planning & documentation
- `feat/<slug>` — new capability
- `fix/<slug>` — bug fix
- `spike/<slug>` — throwaway exploration

## Once there's code (placeholder — fill in when the stack is locked)

- Setup steps
- How to run / build
- Test + lint commands
- CI expectations

## Ground rules for this repo

- **Self-contained.** Dependencies and caches stay inside the project folder; no
  machine-global installs. (A `.npmrc`/equivalent will enforce this once we scaffold.)
- **Keep `main` releasable** once we have something runnable.
