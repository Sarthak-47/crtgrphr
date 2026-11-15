# Changelog

## 1.0.0 (2026-11-15)

The first release: the full v1 scope from the design decisions (`docs/open-questions.md`
Q12), including everything planned for v1.x.

### Get a map in
- **Scan a repository** from disk, with no upload: docker-compose services and their
  dependencies, npm/yarn/pnpm monorepos (packages grouped by workspace folder),
  side-by-side projects, and the real import graph of JavaScript/TypeScript and
  Python code. Node, Python, Go and Rust manifests are recognised, and notable
  infrastructure (Postgres, Redis, Kafka, Stripe...) is attached to the part that uses it.
- **Describe your system** and let AI draft the map: local Ollama by default, so
  nothing leaves your machine, or the Anthropic API with your own key (encrypted with
  your system keychain).
- **Import** Mermaid (flowchart, sequenceDiagram, stateDiagram) or Cartographer/agent JSON.
- **Start blank**, or from one of five samples.

### Work with it
- Automatic layout with ELK, coordinate-free maps, and pin-and-reflow: drag a node
  to pin it, Auto-layout flows everything else around your pins.
- All five diagram types render properly: architecture, workflow (flowchart-style
  decisions), sequence (lifelines, ordered messages), dataflow and lifecycle.
- Real role shapes, edges that route around nodes, and a legend.
- Groups and boundaries (Ctrl+G), multi-select (Shift-click, Shift-drag, Ctrl+A) with
  bulk delete and role changes, a path probe between two nodes, reach highlighting,
  search (Ctrl+F), inline rename, and full undo/redo.
- Re-scan a mapped folder and review the diff before applying; your pins, hand-made
  nodes and edits are kept.

### Share it
- Save and reopen `.crtgrphr` files: diff-friendly JSON that stores the scanned
  folder relative to the file.
- Export SVG, PNG, 1200×630 share cards and Mermaid; copy as Mermaid.
- Installers for Windows, Linux (AppImage) and macOS (dmg). They are not code-signed
  yet, so Windows SmartScreen and macOS Gatekeeper warn on first launch.
