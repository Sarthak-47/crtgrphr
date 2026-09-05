# 2. Platform: Electron with a portable core

Date: 2026-09-06

## Status

Accepted

## Context

The primary v1 user is an engineer mapping a repository they own, and the
headline acquisition hook is "point at real code, get a real map." That feature
needs to read a repository from disk. A browser sandbox cannot read a local
folder directly — it can only accept uploads or zips, which is friction that
guts the wedge. We also value working offline and keeping data on the machine.

At the same time we don't want to permanently foreclose a web version for
sharing, and we don't want the desktop shell to leak into the core so deeply
that a future web target means a rewrite.

Options considered: Electron (desktop, filesystem, heavier); web-first (instant
and shareable but no direct filesystem); Tauri (small Rust-core desktop, but a
Rust ramp we're not ready for); shared-core Electron-first.

## Decision

Ship **Electron** for v1, using **electron-vite** (main / preload / renderer),
but keep the **core portable**: the IR, layout engine, renderers, and graph
logic must not import Electron APIs. All desktop-specific capability (filesystem,
dialogs) lives behind a thin IPC boundary in the main process and a typed
preload bridge, so the same core could later run in a browser with a different
host adapter.

## Consequences

- The repo-scan wedge works with no upload and full offline support.
- A future web build is a *port of the host layer*, not a rewrite of the core — at the cost of some discipline now (no Electron imports below the host boundary).
- Larger bundle and desktop-only distribution for v1; installers are a v1.x concern (electron-builder).
- If bundle size or performance later becomes a real problem, Tauri stays reconsiderable because the core is host-agnostic.
