# 10. Hardening: trust boundaries, evidence, limits, measured performance

Date: 2026-11-16

## Status

Accepted

## Context

An external review of v1.1 raised Electron security, import-detection accuracy,
validation of loaded files, CLI/Action reliability, tests and performance. Each
point was checked against the code before acting; several were real (the window
ran unsandboxed, PNG export wrote any base64, imports in comments counted,
nothing limited the size of a loaded map), some were already handled (search,
onboarding, repair of dangling edges and duplicate ids).

## Decision

- **The window is untrusted.** It runs sandboxed (CommonJS preload, no Node).
  Every IPC handler checks the sender is the app's own page and validates its
  input in one place (`src/main/guards.ts`): types, sizes, file names, dialog
  filters, PNG signature. Map files over 25 MB are refused before reading.
  Permissions, webviews and new windows are refused; links open only if http(s).
- **Data leaves the machine only with consent.** An Ollama URL that isn't on this
  computer must be confirmed in a native dialog the window can't answer.
- **Tokenize, don't parse.** Imports are read by small JS/TS and Python lexers
  (`src/main/scan/lex.ts`), not by regexes over raw text and not by full parsers
  (the TypeScript compiler would add ~20 MB; Python's ast needs Python).
- **Say how sure a link is.** Scanned edges carry `confidence` (declared /
  inferred) and `evidence`. Optional fields: older files load unchanged, and they
  never count as drift.
- **Bounded input.** The sanitizer limits node/edge counts and text sizes, keeps
  groups flat (no nesting, no loops) and drops absurd coordinates; property-based
  tests (fast-check) check its invariants on random input.
- **Say what was skipped.** Scans report what they couldn't read (scan notes),
  collected per scan with AsyncLocalStorage.
- **Measure, then optimize.** `npm run bench` times scan, layout and exports on
  generated repos. Only the measured bottlenecks were changed: import resolution
  (in-memory instead of a `stat` per candidate) and layout blocking the window
  (ELK now runs in a Web Worker in the app). Incremental re-scanning was not
  built: full scans take well under a second at the sizes measured.

## Consequences

- A compromised or buggy renderer can no longer write arbitrary files, exhaust
  memory through IPC, or send descriptions to an unconfirmed host.
- The Action and CLI are tested end to end in CI on Linux and Windows, which found
  a real bug (`bash -e` stopping the Action before it reported drift).
- Releases smoke-test the packaged app on Windows, Linux and macOS.
- Limits are generous for real maps; a file beyond them is opened with the excess
  dropped and a note saying so, never silently.
