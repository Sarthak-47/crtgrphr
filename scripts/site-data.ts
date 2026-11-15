/**
 * Generates site/data.json: real Cartographer output for the website, produced by
 * the app's own scanner, layout engine, Mermaid importer and re-scan diff.
 *
 *   npm run site:data
 *
 * - hero:     a scan of tests/fixtures/repos/compose-basic, laid out by ELK
 * - mermaid:  a Mermaid snippet imported and laid out
 * - describe: an illustrative IR of the kind the AI returns (not model output)
 * - rescan:   the same repo after an edit (proxy removed, search added), with the
 *             real diff and the preview layout (removed nodes kept as ghosts)
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { scanRepository } from '../src/main/repo-scan'
import { layoutDiagram } from '../src/renderer/src/layout'
import { mermaidToIR } from '../src/renderer/src/adapters/mermaid'
import { diffDiagrams, applyRescan } from '../src/shared/diff'
import { sanitizeDiagram } from '../src/shared/serialize'
import { emptyProject, type IRDiagram } from '../src/shared/ir'
import type { LaidOut } from '../src/renderer/src/layout/elk'

const root = resolve(__dirname, '..')
const round = (n: number) => Math.round(n * 10) / 10

/** Only what the page draws, rounded, so the JSON stays small and stable. */
function pack(d: IRDiagram, l: LaidOut) {
  return {
    title: d.title,
    direction: d.direction,
    nodes: d.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      ...(n.sublabel ? { sublabel: n.sublabel } : {}),
      role: n.role,
      x: round(l.positions[n.id]?.x ?? 0),
      y: round(l.positions[n.id]?.y ?? 0),
      w: round(l.sizes[n.id]?.width ?? 0),
      h: round(l.sizes[n.id]?.height ?? 0),
    })),
    edges: d.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      ...(e.variant ? { variant: e.variant } : {}),
      ...(l.routes?.[e.id] ? { points: l.routes[e.id].points.map((p) => [round(p.x), round(p.y)]) } : {}),
    })),
    width: round(l.width),
    height: round(l.height),
  }
}

async function main() {
  const fixture = join(root, 'tests/fixtures/repos/compose-basic')

  // Hero: a real scan of a real compose file.
  const scanned = await scanRepository(fixture)
  scanned.title = 'compose-basic'
  const hero = pack(scanned, await layoutDiagram(scanned))

  // Mermaid import.
  const mermaidSource = `flowchart LR
  U([Push to main]) --> B[Build]
  B --> T[Run tests]
  T --> G{Tests pass?}
  G -->|yes| D[Deploy]
  G -.->|no| F([Notify])`
  const m = mermaidToIR(mermaidSource)
  const mermaid = { source: mermaidSource, ...pack(m, await layoutDiagram(m)) }

  // Describe: the IR shape the AI returns, written by hand and clearly labelled
  // on the page as an example (output depends on the model the user picks).
  const describeText =
    'A web app and a mobile app call an API gateway. Behind it, an orders service stores orders in Postgres and publishes events to Kafka for an email worker.'
  const described = sanitizeDiagram({
    title: 'Shop',
    type: 'architecture',
    direction: 'RIGHT',
    nodes: [
      { id: 'web', label: 'Web app', role: 'frontend' },
      { id: 'mobile', label: 'Mobile app', role: 'frontend' },
      { id: 'gateway', label: 'API gateway', role: 'cloud' },
      { id: 'orders', label: 'Orders', role: 'backend' },
      { id: 'db', label: 'Postgres', role: 'database' },
      { id: 'kafka', label: 'Kafka', role: 'queue' },
      { id: 'email', label: 'Email worker', role: 'backend' },
    ],
    edges: [
      { source: 'web', target: 'gateway' },
      { source: 'mobile', target: 'gateway' },
      { source: 'gateway', target: 'orders' },
      { source: 'orders', target: 'db', label: 'SQL' },
      { source: 'orders', target: 'kafka', label: 'events' },
      { source: 'kafka', target: 'email' },
    ],
  }).value
  const describe = { text: describeText, ...pack(described, await layoutDiagram(described)) }

  // Re-scan: change a copy of the repo, scan again, diff, lay out the preview.
  const tmp = join(root, 'tests/.tmp/site-rescan')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  cpSync(fixture, tmp, { recursive: true })
  const composePath = join(tmp, 'docker-compose.yml')
  const lines = readFileSync(composePath, 'utf8').split(/\r?\n/)
  const at = lines.findIndex((l) => l.trim() === 'proxy:')
  lines.splice(at, 3)
  writeFileSync(composePath, [...lines.join('\n').trimEnd().split('\n'), '  search:', '    image: opensearchproject/opensearch:2', '    depends_on: [db]', ''].join('\n'))
  const after = await scanRepository(tmp)
  after.title = scanned.title
  const before = emptyProject()
  before.diagram = scanned
  const diff = diffDiagrams(scanned, after)
  const applied = applyRescan(before, after)
  const ids = new Set([...applied.diagram.nodes, ...diff.removedNodes].map((n) => n.id))
  const preview: IRDiagram = {
    ...applied.diagram,
    nodes: [...applied.diagram.nodes, ...diff.removedNodes],
    edges: [...applied.diagram.edges, ...diff.removedEdges.filter((e) => ids.has(e.source) && ids.has(e.target))],
  }
  const rescan = {
    ...pack(preview, await layoutDiagram(preview)),
    added: [...diff.addedNodes.map((n) => n.id), ...diff.addedEdges.map((e) => e.id)],
    removed: [...diff.removedNodes.map((n) => n.id), ...diff.removedEdges.map((e) => e.id)],
    changed: [...diff.changedNodes.map((c) => c.after.id), ...diff.changedEdges.map((c) => c.after.id)],
    revisions: [
      ...diff.addedNodes.map((n) => `${n.label} added (${n.sublabel ?? n.role})`),
      ...diff.removedNodes.map((n) => `${n.label} removed`),
      ...diff.addedEdges.map((e) => `${e.source} → ${e.target} added`),
      ...diff.removedEdges.map((e) => `${e.source} → ${e.target} removed`),
    ],
  }

  // Portrait layouts of the two big maps, for narrow screens.
  const heroDownIR: IRDiagram = { ...scanned, direction: 'DOWN' }
  const heroDown = pack(heroDownIR, await layoutDiagram(heroDownIR))
  const rescanDownIR: IRDiagram = { ...preview, direction: 'DOWN' }
  const { added, removed, changed, revisions } = rescan
  const rescanDown = { ...pack(rescanDownIR, await layoutDiagram(rescanDownIR)), added, removed, changed, revisions }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const out = { version: pkg.version, generated: 'scripts/site-data.ts', hero, heroDown, mermaid, describe, rescan, rescanDown }
  mkdirSync(join(root, 'site'), { recursive: true })
  writeFileSync(join(root, 'site/data.json'), JSON.stringify(out) + '\n')
  console.log(`site/data.json: hero ${hero.nodes.length} nodes, rescan ${rescan.revisions.length} revisions`)
}

await main()
