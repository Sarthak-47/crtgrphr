# 11. Production readiness: supported runtime, file authority, verifiable releases

Date: 2026-11-16

## Status

Accepted

## Context

A second external review (after v1.2.0) asked for an Electron upgrade, stricter
IPC sender checks, tighter file access, scanner accuracy on real code, large-repo
transparency, real-world benchmarks, supply-chain automation and better release
distribution. Each point was checked against the code first. Electron 33 was a
year out of support; the dev-server sender check was a prefix match; `openPath`
let the window open and then overwrite any `.json` file. Code signing and macOS
notarization were not adopted: they cost money and the owner decided against them.

## Decision

- **Stay on a supported Electron.** Upgrade to the newest major (45) now; Electron
  majors are upgraded deliberately (Dependabot ignores them), minors and patches
  arrive weekly. Vite stays on 7 (Rollup) rather than 8 (Rolldown) until the CLI
  bundle has a reason to move.
- **The main process owns file authority.** It keeps the list of files the user
  picked in a dialog (`src/main/file-access.ts`); the window can only reopen those.
  Writes re-check the real path; reads are bounded on the open handle.
- **Exact page identity.** IPC and navigation accept only the app's own page: the
  dev server by exact origin, the built app by the exact path of its index.html,
  with no host.
- **Measure before rewriting.** The import tokenizer is compared with TypeScript's
  scanner on real code (99.9% agreement after two fixes); a full parser is not
  justified by the evidence.
- **Verifiable, not signed.** Releases carry SHA-256 checksums, a CycloneDX SBOM
  and Sigstore build provenance, published only after a check that every installer
  is present and versioned. A manual run of the release workflow is a full dry run.

## Consequences

- Users on macOS 11 can't run new releases (Chromium dropped it).
- Recent entries saved by v1.2 or earlier must be opened once through File > Open.
- Installers still show an "unknown publisher" warning; provenance lets anyone
  confirm a download came from this repository's CI.
