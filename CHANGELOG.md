# Changelog

## Unreleased

### Maps that say more than a sketch
- **How parts talk, from the config:** links are labelled with the protocol and port
  read from connection strings and well-known images ("SQL :5432", "Redis :6379",
  "AMQP :5672", "HTTP :8080") instead of "depends on". Links found in connection
  strings are drawn as the hard dependencies they are.
- **Where traffic comes in:** published compose ports, Kubernetes Ingress (with
  paths such as `/api`) and LoadBalancer/NodePort Services are drawn as traffic from
  an "Internet" node.
- **Facts on boxes:** replicas (×3), autoscaling, persistent volumes and health
  checks, read from compose and Kubernetes, shown as tags on the canvas and in SVG.
- **Real logos** for 62 technologies (Postgres, Redis, Kafka, nginx, Stripe...) from
  Simple Icons (CC0) in badges, instead of two letters.

## 1.1.0 (2026-11-16)

Team-ready: maps that stay in sync in CI, more of the stacks companies run on, and
complete maps of big repositories.

### Keep maps in sync
- **`crtgrphr` command-line tool:** `scan` writes or updates a map and its exports,
  `check` fails (exit 1) with a Markdown report when the code no longer matches a
  committed map, `export` converts a saved map. Updates keep your edits, pins and
  hand-added parts, and an unchanged repo leaves the file untouched. Download
  `crtgrphr.mjs` from the release and run it with Node 18+.
- **GitHub Action:** `uses: Sarthak-47/crtgrphr@v1.1.0` checks a committed map on
  every pull request (or updates it), with the drift report in the job summary.
  By default only structural changes count as drift; `strict: true` counts details.

### Read more of the stack
- **Kubernetes:** workloads, Services (by selector), Ingress and Gateway API
  routes, references in env vars, args and ConfigMaps, namespaces as groups;
  kustomize overlays are read once.
- **Helm:** charts and sub-charts, dependencies such as bitnami/postgresql shown as
  what they are, images from values.yaml.
- **Terraform:** AWS, Google Cloud and Azure databases, caches, queues, compute,
  gateways and storage, linked through IAM/listener/mapping plumbing; added to an
  app map as its own group.
- **JVM and .NET:** Maven multi-module builds (through aggregator POMs), Gradle
  multi-project builds, .NET solutions (test projects skipped); Spring Boot,
  Quarkus, Micronaut, Ktor, ASP.NET Core and worker services; their database,
  cache, queue and cloud dependencies, plus SQL Server and Azure Service Bus.

### Big repositories
- **Drill-down:** double-click a group to collapse it into one box, and again to
  expand; Collapse all / Expand all in the inspector. Scans with more than 80 parts
  group them by folder and start the largest groups collapsed instead of dropping
  parts.

### Export
- **draw.io** (diagrams.net, Confluence, Lucidchart) with the on-screen layout.
- **C4 container diagrams** in C4-PlantUML.

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
