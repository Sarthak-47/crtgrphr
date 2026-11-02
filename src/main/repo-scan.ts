/**
 * Real-repository → IR scanner. Runs in the Electron main process so it reads the
 * filesystem directly (no upload). Parser depth for v1 = rungs 1–2 (ADR-0005):
 *
 *   1. docker-compose — services + depends_on + images (richest single signal)
 *   2. Monorepo topology — workspace packages and their internal dependencies
 *   (+ single-package manifest/structure fallback)
 *
 * Deeper per-language import graphs are a later rung; the shape here leaves room
 * for them. This is a grounded *starting point*, then the user edits on canvas.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import yaml from 'js-yaml'
import { nanoid } from 'nanoid'
import type { IRDiagram, IREdge, IRNode, NodeRole } from '../shared/ir'

function classifyImage(image: string): { role: NodeRole; brand?: string } {
  const i = image.toLowerCase()
  if (/postgres|postgresql/.test(i)) return { role: 'database', brand: 'postgresql' }
  if (/mysql|mariadb/.test(i)) return { role: 'database', brand: 'mysql' }
  if (/mongo/.test(i)) return { role: 'database', brand: 'mongodb' }
  if (/redis/.test(i)) return { role: 'cache', brand: 'redis' }
  if (/memcached/.test(i)) return { role: 'cache' }
  if (/rabbitmq/.test(i)) return { role: 'queue', brand: 'rabbitmq' }
  if (/kafka/.test(i)) return { role: 'queue', brand: 'apachekafka' }
  if (/nats/.test(i)) return { role: 'queue' }
  if (/nginx/.test(i)) return { role: 'cloud', brand: 'nginx' }
  if (/traefik/.test(i)) return { role: 'cloud', brand: 'traefikproxy' }
  if (/elasticsearch|opensearch/.test(i)) return { role: 'database', brand: 'elasticsearch' }
  if (/minio/.test(i)) return { role: 'cloud' }
  return { role: 'backend' }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function readJson(p: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8'))
  } catch {
    return null
  }
}

/* ---------------------------- Rung 1: compose ---------------------------- */

async function fromCompose(dir: string, file: string): Promise<IRDiagram | null> {
  let doc: any
  try {
    doc = yaml.load(await readFile(join(dir, file), 'utf8'))
  } catch {
    return null
  }
  const services = doc?.services
  if (!services || typeof services !== 'object') return null

  const nodes: IRNode[] = []
  const edges: IREdge[] = []
  const ids = new Set(Object.keys(services))

  for (const [name, svcRaw] of Object.entries<any>(services)) {
    const svc = svcRaw ?? {}
    const image: string = svc.image ?? (svc.build ? 'build' : '')
    const hasBuild = !!svc.build
    const cls = image && image !== 'build' ? classifyImage(image) : { role: 'backend' as NodeRole }
    const role: NodeRole = hasBuild ? 'backend' : cls.role
    nodes.push({
      id: name,
      label: name,
      sublabel: image && image !== 'build' ? image.split(':')[0] : hasBuild ? 'built image' : undefined,
      role,
      brand: hasBuild ? undefined : cls.brand,
      meta: { source: `${file}#services.${name}` },
    })
    const dep = svc.depends_on
    const deps: string[] = Array.isArray(dep) ? dep : dep && typeof dep === 'object' ? Object.keys(dep) : []
    for (const d of deps) {
      if (ids.has(d)) edges.push({ id: nanoid(6), source: name, target: d, label: 'depends on' })
    }
  }
  if (nodes.length === 0) return null
  return {
    id: basename(dir),
    title: basename(dir),
    subtitle: `Mapped from ${file}`,
    type: 'architecture',
    direction: 'RIGHT',
    nodes,
    edges,
  }
}

/* ------------------------- Rung 2: monorepo graph ------------------------- */

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo',
  'coverage', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv',
])

/** Resolve simple workspace globs like "packages/*" or "apps/*" to directories. */
async function resolveWorkspaceGlobs(root: string, patterns: string[]): Promise<string[]> {
  const dirs: string[] = []
  for (const pat of patterns) {
    if (pat.endsWith('/*')) {
      const prefix = pat.slice(0, -2)
      const base = join(root, prefix)
      try {
        const ents = await readdir(base, { withFileTypes: true })
        for (const e of ents) if (e.isDirectory() && !IGNORE_DIRS.has(e.name)) dirs.push(join(base, e.name))
      } catch {
        /* pattern didn't resolve */
      }
    } else {
      const p = join(root, pat)
      if (await exists(join(p, 'package.json'))) dirs.push(p)
    }
  }
  return dirs
}

async function workspacePatterns(root: string, rootPkg: any): Promise<string[] | null> {
  // npm/yarn: package.json "workspaces"
  const ws = rootPkg?.workspaces
  if (Array.isArray(ws)) return ws
  if (ws && Array.isArray(ws.packages)) return ws.packages
  // pnpm: pnpm-workspace.yaml
  if (await exists(join(root, 'pnpm-workspace.yaml'))) {
    try {
      const doc: any = yaml.load(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'))
      if (Array.isArray(doc?.packages)) return doc.packages
    } catch {
      /* ignore */
    }
  }
  return null
}

function packageRole(name: string): NodeRole {
  const n = name.toLowerCase()
  if (/front|web|client|ui|app$/.test(n)) return 'frontend'
  if (/api|server|backend|service|worker|gateway/.test(n)) return 'backend'
  if (/db|data|store|schema|prisma|model/.test(n)) return 'database'
  return 'backend'
}

async function fromMonorepo(root: string, rootPkg: any, patterns: string[]): Promise<IRDiagram | null> {
  const dirs = await resolveWorkspaceGlobs(root, patterns)
  if (dirs.length === 0) return null

  interface Pkg { dir: string; name: string; deps: string[] }
  const pkgs: Pkg[] = []
  for (const d of dirs) {
    const pkg = await readJson(join(d, 'package.json'))
    if (!pkg?.name) continue
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })
    pkgs.push({ dir: d, name: pkg.name, deps })
  }
  if (pkgs.length === 0) return null

  const nameToId = new Map<string, string>()
  const nodes: IRNode[] = []
  pkgs.forEach((p, i) => {
    const id = `pkg${i}`
    nameToId.set(p.name, id)
    nodes.push({
      id,
      label: p.name,
      sublabel: basename(p.dir),
      role: packageRole(p.name),
      meta: { source: p.dir.slice(root.length + 1) },
    })
  })

  const edges: IREdge[] = []
  for (const p of pkgs) {
    const fromId = nameToId.get(p.name)!
    for (const dep of p.deps) {
      const toId = nameToId.get(dep)
      if (toId && toId !== fromId) edges.push({ id: nanoid(6), source: fromId, target: toId, variant: 'default' })
    }
  }

  return {
    id: rootPkg?.name ?? basename(root),
    title: rootPkg?.name ?? basename(root),
    subtitle: `Monorepo — ${pkgs.length} packages`,
    type: 'architecture',
    direction: 'RIGHT',
    nodes,
    edges,
  }
}

/* --------------------- Fallback: single-package view --------------------- */

const SOURCEY = new Set([
  'src', 'app', 'apps', 'packages', 'services', 'server', 'client', 'web',
  'api', 'backend', 'frontend', 'lib', 'components', 'pkg', 'cmd', 'internal',
])

function stackRole(name: string): NodeRole {
  const n = name.toLowerCase()
  if (/front|web|client|ui/.test(n)) return 'frontend'
  if (/api|server|backend|service|worker|cmd/.test(n)) return 'backend'
  if (/db|data|store|model|schema|migration/.test(n)) return 'database'
  return 'backend'
}

async function fromStructure(dir: string, pkg: any): Promise<IRDiagram> {
  const projectName: string = pkg?.name ?? basename(dir)
  const nodes: IRNode[] = []
  const edges: IREdge[] = []

  const rootId = 'app'
  let rootRole: NodeRole = 'backend'
  let rootSub = 'service'
  if (await exists(join(dir, 'index.html'))) {
    rootRole = 'frontend'
    rootSub = 'web app'
  }
  nodes.push({ id: rootId, label: projectName, sublabel: rootSub, role: rootRole, meta: { source: '.' } })

  let entries: string[] = []
  try {
    const dirents = await readdir(dir, { withFileTypes: true })
    entries = dirents
      .filter((d) => d.isDirectory() && !IGNORE_DIRS.has(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    /* ignore */
  }
  for (const name of entries.filter((e) => SOURCEY.has(e.toLowerCase())).slice(0, 10)) {
    if (name === rootId) continue
    nodes.push({ id: name, label: name, role: stackRole(name), meta: { source: name } })
    edges.push({ id: nanoid(6), source: rootId, target: name, variant: 'weak' })
  }

  const depNames = Object.keys({ ...(pkg?.dependencies ?? {}) })
  const known: Array<[RegExp, string, NodeRole, string?]> = [
    [/^pg$|^postgres/, 'PostgreSQL', 'database', 'postgresql'],
    [/^mysql/, 'MySQL', 'database', 'mysql'],
    [/mongoose|mongodb/, 'MongoDB', 'database', 'mongodb'],
    [/^redis|ioredis/, 'Redis', 'cache', 'redis'],
    [/^express|^fastify|^koa|^@nestjs/, 'HTTP API', 'backend'],
    [/^react|^vue|^svelte|^next/, 'Web client', 'frontend'],
    [/^stripe/, 'Stripe', 'service', 'stripe'],
    [/^amqplib|rabbit/, 'RabbitMQ', 'queue', 'rabbitmq'],
    [/kafkajs/, 'Kafka', 'queue', 'apachekafka'],
  ]
  const added = new Set<string>()
  for (const [re, label, role, brand] of known) {
    if (depNames.some((d) => re.test(d)) && !added.has(label)) {
      added.add(label)
      const id = label.toLowerCase().replace(/\s+/g, '-')
      nodes.push({ id, label, role, brand, meta: { source: 'package.json' } })
      edges.push({ id: nanoid(6), source: rootId, target: id })
    }
  }

  return {
    id: projectName,
    title: projectName,
    subtitle: 'Mapped from repository structure',
    type: 'architecture',
    direction: 'RIGHT',
    nodes,
    edges,
  }
}

/* -------------------------------- Entry --------------------------------- */

export async function scanRepository(dir: string): Promise<IRDiagram> {
  // Rung 1: docker-compose is the single richest signal.
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    if (await exists(join(dir, f))) {
      const d = await fromCompose(dir, f)
      if (d) return d
    }
  }
  // Rung 2: monorepo topology.
  const pkg = await readJson(join(dir, 'package.json'))
  const patterns = await workspacePatterns(dir, pkg)
  if (patterns) {
    const d = await fromMonorepo(dir, pkg, patterns)
    if (d) return d
  }
  // Fallback: single-package structure + notable deps.
  return fromStructure(dir, pkg)
}
