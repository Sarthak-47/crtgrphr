# Changelog

## Unreleased (1.3.0)

### Security, compatibility and production readiness
- **Electron 33 → 45.** Electron 33 had been out of support for about a year (only
  the newest three majors get security fixes) and had open advisories, including an
  ASAR integrity bypass. The sandboxed preload and validated IPC carry over
  unchanged. macOS now needs version 12 or newer.
- **Build tools updated** (electron-builder 26, electron-vite 5, Vite 7, Vitest 4):
  `npm audit` goes from 25 advisories (3 critical, 14 high) to 6 moderate ones, all
  in electron-builder's build-time macOS tooling. The app's runtime dependencies
  had none before and have none now.
- **All downloads stay in the project:** `node scripts/install.mjs` keeps Electron's
  download in `.electron-cache` (Electron's installer ignores `.npmrc`).
- The packaged smoke test checks the build runs this checkout's Electron, so a
  stale `release/` folder can't pass.
- **Only files you chose can be reopened or written.** The main process now keeps
  the list of maps you opened or saved through a dialog; the window can no longer
  ask it to open (and then overwrite) any other `.json` file. Saves check the file
  still resolves to the same place it did when you chose it, map reads are size-
  limited on the open file, and "show in folder" won't follow a link out of the
  mapped folder. Recent entries from older versions ask to be opened once through
  File > Open.
- **Import scanning checked against TypeScript on real code.** On 8,003 real files
  the tokenizer agreed with TypeScript's own import scanner on 99.2% of imports; the
  two real misses (spread `...require()` and export lists of hundreds of names) are
  fixed, bringing it to 99.9%. What remains is computed paths and minified or UMD
  bundles, so a full parser isn't justified. A test keeps measuring this.
- **Nothing silently dropped on huge repos:** when a scan has to leave parts out
  (over 600, or more than the map can show and grouping can't help), a scan note
  says how many, names some, and suggests scanning a subfolder.
- **Supply chain:** Dependabot opens weekly update PRs (grouped minor/patch;
  Electron majors stay manual); CI fails on high/critical advisories in runtime
  dependencies and on critical ones anywhere; releases attach a CycloneDX SBOM
  (including Electron, which ships in the app), SHA-256 checksums, and signed
  build provenance (`gh attestation verify <file> --repo Sarthak-47/crtgrphr`),
  after a check that every installer is present and named for the version.
  Installers are still not code-signed (by decision: it costs money).
- **Exact sender checks.** Requests are accepted only from the app's own page,
  compared by exact origin (development) or exact file path (built app), not by
  prefix: lookalikes such as `localhost:51730`, `localhost:5173.evil.com`, another
  `renderer/index.html` on disk or on a network share are refused. Navigation and
  redirects use the same check.

## 1.2.0 (2026-11-16)

Richer, more trustworthy maps, and a hardened app.

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
- **Every scanned link says how sure it is, and why:** declared (written down: a
  `depends_on`, an import statement, an Ingress backend, a project reference) or
  inferred (worked out: a hostname in an environment variable, a client library that
  implies a database, a Terraform reference through IAM plumbing). Select a link to
  read the evidence; inferred labels are italic on the canvas and in SVG.
- **More accurate import scanning:** imports are read by tokenizing JS/TS and Python
  instead of matching raw text, so imports inside comments, docstrings and strings
  no longer count, and TypeScript `import x = require()`, literal-template
  `import()`, backslash-continued Python imports and `importlib.import_module("x")`
  do. On 6,000 real files, this removed 157 false imports and found one that was missed.
- **Security hardening:** the app's window is sandboxed; every request from the
  window to the app is checked (who sent it, types and sizes); PNG exports must be
  real PNGs; map files over 25 MB are refused; an Ollama server that isn't on this
  computer must be confirmed, since descriptions would leave it.
- **Drift you can see:** the drift report (CLI and GitHub Action job summary) now
  includes a Mermaid picture of the map after the change, with added parts in
  green, removed ones in red and changed ones in amber.
- **Scan notes:** what a scan skipped or couldn't read (a malformed compose file,
  YAML that doesn't parse, workspace packages without a usable package.json,
  sources over 512 KB, the file limit) is listed in the Map panel and printed by
  the CLI, so a map is never quietly incomplete.
- **Faster and smoother on big repositories:** importing scans of 3,000 files are
  about 4× faster, and layout runs in a background worker so the window doesn't
  freeze (see `docs/performance.md`, `npm run bench`).
- **More reliable CI:** fixed the GitHub Action stopping before it recorded its
  outputs when drift was found (GitHub runs its shell with `-e`), so `drifted` and
  the job-summary report now arrive on a failed check; CI runs the Action end to end on Linux and Windows; `check` asks for the
  folder when a map doesn't record one instead of guessing; releases smoke-test the
  macOS app too.
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
