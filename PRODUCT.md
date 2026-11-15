# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (the marketing site, `site/`). The product itself is an Electron desktop app for
Windows, macOS and Linux.

## Stack

Site: delegated ("whatever looks the best, unique, and eye catching"). Chosen: plain
static HTML, CSS and JavaScript in `site/`, no build step and no framework, deployed
to GitHub Pages at https://sarthak-47.github.io/crtgrphr/ by a workflow on every push.

## Users

Software engineers who need to understand or explain how a system is put together:
onboarding onto an unfamiliar codebase, explaining a project to a teammate, planning
a change, or working out what broke. They own or can open the code, and they are
tired of architecture diagrams that were drawn by hand once and went stale.

## Product Purpose

Cartographer turns a codebase, a plain-English description, or a Mermaid diagram into
a system map: boxes for the parts, arrows for which part talks to which. It lays the
map out automatically, lets the user edit it by hand, and re-scans the code later to
show what changed. Success: an engineer points it at their own repo and gets a map
that is recognisably their system within seconds, and can keep it current.

## Positioning

Auto-layout you can still edit, fed by maps grounded in real code. Diagrams-as-code
tools (Mermaid) are versionable but rigid and static; whiteboards (Excalidraw, Figma)
are editable but ungrounded and rot; Archify (the inspiration) makes an AI place every
box by coordinates, outputs frozen HTML, and cannot read code. Cartographer's mechanism:
a coordinate-free model of the system, laid out by ELK, with pin-and-reflow (drag a
box to pin it, Auto-layout flows the rest around pins), plus a scanner that reads real
repositories locally and a re-scan diff that keeps the map in sync.

## Operating Context

Desktop app, offline-first. Inputs: a local repository folder (docker-compose,
npm/yarn/pnpm monorepos, Node/Python/Go/Rust manifests, JS/TS and Python import
graphs), a typed description (local Ollama by default, Anthropic API opt-in with the
user's own key), Mermaid text, or hand editing. Outputs: `.crtgrphr` project files
(diff-friendly JSON), SVG, PNG, 1200×630 share cards, Mermaid text.

## Capabilities and Constraints

- Five diagram types: architecture, workflow, sequence, dataflow, lifecycle.
- Groups/boundaries, multi-select, path probe between two nodes, reach highlighting,
  search, undo/redo, re-scan with diff preview.
- Free and open source (MIT), solo-built by Sarthak (GitHub: Sarthak-47).
- v1.0.0 installers: Windows `.exe`, macOS `.dmg` (arm64), Linux `.AppImage`.
  Not code-signed, by decision (cost); users see an OS warning on first launch.
- Nothing is uploaded: scanning is local; AI is local unless the user opts in.

## Brand Commitments

- Name: Cartographer; repository and short name `crtgrphr`.
- Existing mark: a diamond (◆) in a cyan-to-violet gradient (`resources/icon.png`).
- The site must not look like generic AI-generated SaaS (the user's explicit ask).

## Evidence on Hand

- The app itself: real screenshots and real exported SVG/PNG can be generated from
  it, including scans of real repositories in `tests/fixtures/repos/` and of
  Cartographer's own source.
- Release: https://github.com/Sarthak-47/crtgrphr/releases/tag/v1.0.0
- Test suite numbers (185 unit tests, 24-step E2E on Windows and Linux CI).
- Absent and not to be invented: users, testimonials, download counts, stars,
  company logos, benchmarks, pricing.

## Product Principles

1. Grounded over guessed: prefer what the code says to what someone remembers.
2. The machine arranges, the human decides: automation never takes the last word away.
3. Local and private by default: nothing leaves the machine unless the user chooses.
4. Show the map, not adjectives: every claim is demonstrated by real output.
