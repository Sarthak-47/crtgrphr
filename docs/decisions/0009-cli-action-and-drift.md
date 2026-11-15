# 9. A command-line tool and GitHub Action to keep maps in sync

Date: 2026-11-16

## Status

Accepted

## Context

A map is only useful while it matches the code. Up to v1.0 the only way to refresh
one was to open the desktop app and click Re-scan, which nobody does on a schedule.
Teams keep docs current by checking them in CI, so the map needs to be checkable
there: without a display, without Electron, and without a network.

M6 also widens what a scan reads (Kubernetes, Helm, Terraform, Maven, Gradle, .NET)
and replaces the 80-node cut-off with drill-down, so big company repositories give
a complete map.

## Decision

- **A Node CLI, `crtgrphr`,** in `src/cli/`, built by `npm run build:cli` into one
  self-contained file, `action/dist/crtgrphr.mjs`, with every dependency bundled.
  It reuses the app's scanner, ELK layout, diff and exporters unchanged; it imports
  nothing from Electron or React. Commands: `scan` (write or update a map, plus
  exports), `check` (exit 1 on drift, Markdown report), `export`.
- **The bundle is committed,** so the Action runs with no install step and no
  network. CI rebuilds it and fails if the committed file is stale. Each release
  also attaches it as `crtgrphr.mjs`.
- **The Action is a composite action** (`action.yml` at the repository root) that
  runs the bundle with the runner's own Node. Modes: `check` (fail the job on
  drift, report in the job summary) and `update` (rewrite the map and exports for a
  later commit step). It never commits or comments by itself: what gets pushed, and
  as whom, stays the repository owner's choice.
- **Drift means structure by default:** parts or links added or removed, parts
  renamed or changing kind. Details that change with almost every commit (file
  counts in sublabels, import counts on links) don't fail a check unless `--strict`
  is set; `scan --out` refreshes them.
- **Updates are merges,** with the same rules as the app's Re-scan: hand edits,
  pins, hand-added parts and the collapsed or expanded state of groups are kept. A
  re-scan of unchanged code leaves the file byte-for-byte the same (the scan time is
  only updated when something changed), so it doesn't create noise in git.
- **Drill-down replaces the cut-off.** A scan with more than 80 parts groups them by
  folder and starts the largest groups collapsed. The IR keeps every part; a
  collapsed group is drawn as one box (`shared/collapse.ts`) and opens on
  double-click. Only past 600 parts, or when grouping can't help, are the
  least-connected parts left out, and the subtitle says so.
- **New exports for existing tooling:** draw.io (diagrams.net, also read by
  Confluence and Lucidchart) and C4-PlantUML container diagrams.

## Consequences

- Teams can commit `docs/architecture.crtgrphr` and its Mermaid/SVG next to the code
  and have pull requests fail when the architecture changes without the map.
  Cartographer does this for itself (`.github/workflows/architecture.yml`).
- The committed bundle is about 3 MB and changes whenever the CLI's sources do; it
  is marked as generated so it stays out of diffs.
- Not published to npm: installing from npm is an outward-facing step for the
  owner to decide. The release asset and the Action cover use without it.
