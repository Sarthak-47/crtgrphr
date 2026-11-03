# Contributing

Cartographer is built solo, design-first. This doc is intentionally
light and will grow once we start writing code. Adjust freely.

## Workflow

1. **Decide before building.** Big decisions get discussed, then recorded as an
   ADR in `docs/decisions/` before the implementing code is written. Open items
   live in `docs/open-questions.md`.
2. **Branch per change.** `main` stays green. Work on `feat/<thing>` or
   `docs/<thing>` branches and open a PR.
3. **Self-review the PR diff** before merging. Keep changes small.
4. **Commits** are clear and scoped. Conventional-commit style is encouraged but
   not enforced yet: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.

## Branch naming

- `docs/<slug>` — planning & documentation
- `feat/<slug>` — new capability
- `fix/<slug>` — bug fix
- `spike/<slug>` — throwaway exploration

## Working on the code

- **Setup:** `npm install`. Node 18+. Dependencies and caches stay inside the
  project folder (`.npmrc`); never install anything globally.
- **Run:** `npm run dev`.
- **Before pushing:** `npm run check` (typecheck, unit tests, build) and, for
  anything touching the UI or file handling, `npm run e2e`.
- **Tests:** unit tests live in `tests/unit/`, scanner fixture repos in
  `tests/fixtures/repos/`, and the Electron end-to-end test in `tests/e2e/run.mjs`.
  Scratch output goes to `tests/.tmp/` (gitignored).
- **CI:** GitHub Actions runs all of the above, including E2E, on Windows and
  Linux for every push to `main` and every PR. Keep it green.

## Ground rules for this repo

- **Self-contained.** Dependencies and caches stay inside the project folder; no
  machine-global installs. (A `.npmrc`/equivalent will enforce this once we scaffold.)
- **Keep `main` releasable** once we have something runnable.
