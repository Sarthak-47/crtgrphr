/**
 * Performance benchmarks: scan, layout and export on generated repositories of
 * increasing size, so changes can be measured instead of guessed.
 *
 *   npm run bench            (writes docs/performance.md)
 *
 * Each case is generated into tests/.tmp/bench/, timed 3 times (median kept;
 * the first run also warms caches), and checked for a sane result.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { cpus, totalmem } from 'node:os'
import { scanRepository } from '../src/main/repo-scan'
import { layoutDiagram } from '../src/renderer/src/layout'
import { diagramToSvg } from '../src/renderer/src/export/svg'
import { diagramToMermaid } from '../src/renderer/src/adapters/mermaid-export'
import { diagramToDrawio } from '../src/renderer/src/export/drawio'
import { visibleDiagram } from '../src/shared/collapse'
import { serializeProject, parseProject } from '../src/shared/serialize'
import type { IRDiagram } from '../src/shared/ir'

const root = resolve(__dirname, '..')
const BENCH = join(root, 'tests/.tmp/bench')

const write = (p: string, text: string): void => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text)
}

/* ------------------------------ generators ------------------------------- */

function composeRepo(dir: string, services: number): void {
  const lines = ['services:']
  for (let i = 0; i < services; i++) {
    lines.push(`  svc${i}:`, `    build: ./svc${i}`, `    depends_on: [svc${(i + 1) % services}]`, '    environment:', `      - DB=postgres://db${i % 5}:5432/x`)
  }
  for (let i = 0; i < 5; i++) lines.push(`  db${i}:`, '    image: postgres:16')
  write(join(dir, 'docker-compose.yml'), lines.join('\n') + '\n')
}

function monorepo(dir: string, packages: number): void {
  write(join(dir, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*', 'libs/*', 'tools/*'] }))
  for (let i = 0; i < packages; i++) {
    const folder = ['apps', 'libs', 'tools'][i % 3]
    const deps: Record<string, string> = {}
    for (let k = 1; k <= 3; k++) deps[`pkg-${(i * 7 + k * 13) % packages}`] = '*'
    if (i % 10 === 0) deps.pg = '^8'
    if (i % 15 === 0) deps.ioredis = '^5'
    write(join(dir, folder, `pkg-${i}`, 'package.json'), JSON.stringify({ name: `pkg-${i}`, dependencies: deps }))
  }
}

function importRepo(dir: string, files: number): void {
  write(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { express: '*', pg: '*' } }))
  const comps = 12
  for (let i = 0; i < files; i++) {
    const c = i % comps
    const imports: string[] = []
    for (let k = 1; k <= 4; k++) {
      const j = (i * 31 + k * 17) % files
      imports.push(`import { f${j} } from '../c${j % comps}/f${j}'`)
    }
    if (i % 50 === 0) imports.push("import { Pool } from 'pg'")
    const body = [
      '/** A generated module. import nothing from here: this comment must not count. */',
      ...imports,
      `export function f${i}(x: number): number {`,
      '  const s = `template ${x} with import(\'./not-real\')`',
      '  return x + s.length',
      '}',
      ...Array.from({ length: 30 }, (_, n) => `// filler line ${n} to make the file realistic in size`),
    ]
    write(join(dir, 'src', `c${c}`, `f${i}.ts`), body.join('\n') + '\n')
  }
}

function k8sRepo(dir: string, workloads: number): void {
  for (let i = 0; i < workloads; i++) {
    write(
      join(dir, 'k8s', `w${i}.yaml`),
      [
        'apiVersion: apps/v1',
        'kind: Deployment',
        `metadata: { name: w${i}, namespace: ns${i % 4} }`,
        'spec:',
        '  replicas: 2',
        `  selector: { matchLabels: { app: w${i} } }`,
        '  template:',
        `    metadata: { labels: { app: w${i} } }`,
        '    spec:',
        '      containers:',
        `        - name: c`,
        `          image: ghcr.io/acme/w${i}:1`,
        '          env:',
        `            - { name: NEXT, value: "http://w${(i + 1) % workloads}:8080" }`,
        '---',
        'apiVersion: v1',
        'kind: Service',
        `metadata: { name: w${i}, namespace: ns${i % 4} }`,
        `spec: { selector: { app: w${i} } }`,
      ].join('\n') + '\n',
    )
  }
}

/* -------------------------------- timing --------------------------------- */

async function time<T>(fn: () => Promise<T> | T): Promise<{ ms: number; value: T }> {
  const runs: number[] = []
  let value!: T
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    value = await fn()
    runs.push(performance.now() - t)
  }
  runs.sort((a, b) => a - b)
  return { ms: runs[1], value }
}

interface Row {
  name: string
  input: string
  parts: number
  shown: number
  edges: number
  scan: number
  layout: number
  svg: number
  mermaid: number
  drawio: number
  save: number
}

async function bench(name: string, input: string, make: (dir: string) => void): Promise<Row> {
  const dir = join(BENCH, name.replace(/\W+/g, '-'))
  rmSync(dir, { recursive: true, force: true })
  make(dir)
  const scan = await time(() => scanRepository(dir))
  const d: IRDiagram = scan.value
  const view = visibleDiagram(d)
  const layout = await time(() => layoutDiagram(view))
  const laid = layout.value
  const svg = await time(() => diagramToSvg(view, laid, 'light'))
  const mermaid = await time(() => diagramToMermaid(view))
  const drawio = await time(() => diagramToDrawio(view, laid))
  const save = await time(() => parseProject(serializeProject({ schema_version: 1, diagram: d, layout: {} })))
  if (!svg.value.svg.startsWith('<svg') || d.nodes.length === 0) throw new Error(`${name}: bad result`)
  return {
    name,
    input,
    parts: d.nodes.filter((n) => n.role !== 'group').length,
    shown: view.nodes.filter((n) => n.role !== 'group').length,
    edges: d.edges.length,
    scan: scan.ms,
    layout: layout.ms,
    svg: svg.ms,
    mermaid: mermaid.ms,
    drawio: drawio.ms,
    save: save.ms,
  }
}

const CASES: [string, string, (dir: string) => void][] = [
  ['compose, small', '20 services', (d) => composeRepo(d, 20)],
  ['compose, large', '75 services', (d) => composeRepo(d, 75)],
  ['monorepo, medium', '60 packages', (d) => monorepo(d, 60)],
  ['monorepo, large', '300 packages', (d) => monorepo(d, 300)],
  ['imports, medium', '500 TS files', (d) => importRepo(d, 500)],
  ['imports, large', '3,000 TS files', (d) => importRepo(d, 3000)],
  ['kubernetes, large', '150 workloads', (d) => k8sRepo(d, 150)],
]

async function main(): Promise<void> {
  const only = process.argv[2]
  const rows: Row[] = []
  for (const [name, input, make] of CASES) {
    if (only && !name.includes(only)) continue
    const r = await bench(name, input, make)
    rows.push(r)
    console.log(`${name.padEnd(20)} parts ${String(r.parts).padStart(4)} shown ${String(r.shown).padStart(3)}  scan ${r.scan.toFixed(0).padStart(6)} ms  layout ${r.layout.toFixed(0).padStart(6)} ms  svg ${r.svg.toFixed(1)} ms`)
  }
  if (only) return
  const f = (n: number): string => (n < 10 ? n.toFixed(1) : n.toFixed(0))
  const md = [
    '# Performance',
    '',
    'Generated by `npm run bench` (scripts/bench.ts): generated repositories of increasing',
    'size, each step timed three times (median shown, in milliseconds). "Shown" is the',
    'number of boxes drawn after big maps start with large groups collapsed.',
    '',
    `Machine: ${cpus()[0]?.model.trim() ?? 'unknown CPU'}, ${cpus().length} threads, ${Math.round(totalmem() / 1073741824)} GB RAM, Node ${process.version}.`,
    '',
    '| Case | Input | Parts | Shown | Links | Scan | Layout | SVG | Mermaid | draw.io | Save + open |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map((r) => `| ${r.name} | ${r.input} | ${r.parts} | ${r.shown} | ${r.edges} | ${f(r.scan)} | ${f(r.layout)} | ${f(r.svg)} | ${f(r.mermaid)} | ${f(r.drawio)} | ${f(r.save)} |`),
    '',
  ]
  write(join(root, 'docs/performance.md'), md.join('\n'))
  console.log('wrote docs/performance.md')
}

await main()
