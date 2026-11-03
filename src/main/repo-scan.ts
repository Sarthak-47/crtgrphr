/**
 * Real-repository → IR scanner. Runs in the Electron main process so it reads the
 * filesystem directly (no upload). Pure Node: no Electron imports, so it is
 * unit-testable and stays portable (ADR-0002). Parser depth for v1 = rungs 1–2
 * (ADR-0005):
 *
 *   1. docker-compose: services, depends_on, links, and env values that name
 *      another service (e.g. postgres://db:5432)
 *   2. Monorepo topology: workspace packages, their internal dependencies, and
 *      the notable infrastructure each package uses
 *   3. Fallback: one package, its framework and infra deps, for Node, Python,
 *      Go and Rust manifests
 *
 * Ids are derived from names (not random) so re-scanning an unchanged repo yields
 * an identical map, and a changed repo yields a minimal diff.
 */
import { readFile, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import yaml from 'js-yaml'
import type { IRDiagram, IREdge, IRNode, NodeRole } from '../shared/ir'

/** Hard cap so a huge monorepo can't produce an unreadable or slow map. */
export const MAX_NODES = 80

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.svelte-kit',
  'coverage', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv', 'env',
  '.idea', '.vscode', 'tmp', '.tox', '.pytest_cache', '.mypy_cache',
])

/* -------------------------------- Helpers -------------------------------- */

async function readText(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

async function readJson(p: string): Promise<any | null> {
  const t = await readText(p)
  if (t === null) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

async function listDirs(dir: string): Promise<Dirent[]> {
  try {
    const ents = await readdir(dir, { withFileTypes: true })
    // Never follow symlinks: avoids cycles and escaping the repo.
    return ents.filter((e) => e.isDirectory() && !e.isSymbolicLink() && !IGNORE_DIRS.has(e.name))
  } catch {
    return []
  }
}

async function fileExists(p: string): Promise<boolean> {
  return (await readText(p)) !== null
}

const rel = (root: string, p: string): string => relative(root, p).split(sep).join('/') || '.'

/** Stable, readable id from a name: "@acme/web-app" → "acme-web-app". */
export function slug(name: string): string {
  const s = name.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'node'
}

/** Accumulates nodes/edges with stable ids and no duplicates. */
class GraphBuilder {
  nodes: IRNode[] = []
  edges: IREdge[] = []
  private ids = new Set<string>()
  private edgeKeys = new Set<string>()

  addNode(n: Omit<IRNode, 'id'> & { id?: string }): string {
    let id = n.id ?? slug(n.label)
    if (this.ids.has(id)) {
      let i = 2
      while (this.ids.has(`${id}-${i}`)) i++
      id = `${id}-${i}`
    }
    this.ids.add(id)
    this.nodes.push({ ...n, id })
    return id
  }

  has(id: string): boolean {
    return this.ids.has(id)
  }

  addEdge(source: string, target: string, label?: string, variant?: IREdge['variant']): void {
    if (source === target) return
    const key = `${source}->${target}`
    if (this.edgeKeys.has(key)) return
    this.edgeKeys.add(key)
    const e: IREdge = { id: key, source, target }
    if (label) e.label = label
    if (variant) e.variant = variant
    this.edges.push(e)
  }
}

/** Trim a graph to MAX_NODES, keeping the best-connected nodes. */
function capGraph(g: GraphBuilder): { capped: boolean; total: number } {
  const total = g.nodes.length
  if (total <= MAX_NODES) return { capped: false, total }
  const degree = new Map<string, number>()
  for (const e of g.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  const keep = new Set(
    [...g.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, MAX_NODES).map((n) => n.id),
  )
  g.nodes = g.nodes.filter((n) => keep.has(n.id))
  g.edges = g.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
  return { capped: true, total }
}

/* ------------------------- Dependency knowledge -------------------------- */

type Eco = 'npm' | 'py' | 'go' | 'rust'
interface Matcher {
  npm?: string[]
  py?: string[]
  go?: string[]
  rust?: string[]
}

interface InfraDef extends Matcher {
  label: string
  role: NodeRole
  brand?: string
}

/** Notable infrastructure a codebase depends on, by ecosystem package name. */
const INFRA: InfraDef[] = [
  { label: 'PostgreSQL', role: 'database', brand: 'postgresql', npm: ['pg', 'postgres', 'pg-promise', '@neondatabase/serverless'], py: ['psycopg', 'psycopg2', 'psycopg2-binary', 'asyncpg'], go: ['github.com/lib/pq', 'github.com/jackc/pgx'], rust: ['tokio-postgres', 'postgres'] },
  { label: 'MySQL', role: 'database', brand: 'mysql', npm: ['mysql', 'mysql2'], py: ['pymysql', 'mysqlclient', 'aiomysql'], go: ['github.com/go-sql-driver/mysql'], rust: ['mysql', 'mysql_async'] },
  { label: 'MongoDB', role: 'database', brand: 'mongodb', npm: ['mongodb', 'mongoose'], py: ['pymongo', 'motor', 'mongoengine'], go: ['go.mongodb.org/mongo-driver'], rust: ['mongodb'] },
  { label: 'SQLite', role: 'database', brand: 'sqlite', npm: ['sqlite3', 'better-sqlite3'], go: ['github.com/mattn/go-sqlite3'], rust: ['rusqlite'] },
  { label: 'Redis', role: 'cache', brand: 'redis', npm: ['redis', 'ioredis', '@upstash/redis'], py: ['redis', 'aioredis'], go: ['github.com/go-redis/redis', 'github.com/redis/go-redis'], rust: ['redis'] },
  { label: 'Kafka', role: 'queue', brand: 'apachekafka', npm: ['kafkajs'], py: ['kafka-python', 'confluent-kafka', 'aiokafka'], go: ['github.com/segmentio/kafka-go', 'github.com/confluentinc/confluent-kafka-go', 'github.com/ibm/sarama', 'github.com/shopify/sarama'], rust: ['rdkafka'] },
  { label: 'RabbitMQ', role: 'queue', brand: 'rabbitmq', npm: ['amqplib', 'amqp-connection-manager'], py: ['pika', 'aio-pika'], go: ['github.com/streadway/amqp', 'github.com/rabbitmq/amqp091-go'], rust: ['lapin'] },
  { label: 'Celery', role: 'queue', py: ['celery'] },
  { label: 'BullMQ', role: 'queue', npm: ['bullmq', 'bull'] },
  { label: 'Elasticsearch', role: 'database', brand: 'elasticsearch', npm: ['@elastic/elasticsearch'], py: ['elasticsearch'], go: ['github.com/elastic/go-elasticsearch'], rust: ['elasticsearch'] },
  { label: 'AWS', role: 'cloud', brand: 'amazonaws', npm: ['aws-sdk', '@aws-sdk/'], py: ['boto3', 'aiobotocore'], go: ['github.com/aws/aws-sdk-go'], rust: ['aws-sdk-s3', 'aws-config'] },
  { label: 'Stripe', role: 'service', brand: 'stripe', npm: ['stripe'], py: ['stripe'], go: ['github.com/stripe/stripe-go'], rust: ['async-stripe'] },
  { label: 'OpenAI API', role: 'service', brand: 'openai', npm: ['openai'], py: ['openai'], go: ['github.com/sashabaranov/go-openai'] },
  { label: 'Anthropic API', role: 'service', brand: 'anthropic', npm: ['@anthropic-ai/sdk'], py: ['anthropic'] },
]

interface FrameworkDef extends Matcher {
  label: string
  role: 'frontend' | 'backend'
}

const FRAMEWORKS: FrameworkDef[] = [
  { label: 'Electron', role: 'frontend', npm: ['electron'] },
  { label: 'Next.js', role: 'frontend', npm: ['next'] },
  { label: 'Nuxt', role: 'frontend', npm: ['nuxt'] },
  { label: 'React', role: 'frontend', npm: ['react'] },
  { label: 'Vue', role: 'frontend', npm: ['vue'] },
  { label: 'Svelte', role: 'frontend', npm: ['svelte'] },
  { label: 'Angular', role: 'frontend', npm: ['@angular/core'] },
  { label: 'NestJS', role: 'backend', npm: ['@nestjs/core'] },
  { label: 'Express', role: 'backend', npm: ['express'] },
  { label: 'Fastify', role: 'backend', npm: ['fastify'] },
  { label: 'Koa', role: 'backend', npm: ['koa'] },
  { label: 'Hono', role: 'backend', npm: ['hono'] },
  { label: 'FastAPI', role: 'backend', py: ['fastapi'] },
  { label: 'Django', role: 'backend', py: ['django'] },
  { label: 'Flask', role: 'backend', py: ['flask'] },
  { label: 'Gin', role: 'backend', go: ['github.com/gin-gonic/gin'] },
  { label: 'Echo', role: 'backend', go: ['github.com/labstack/echo'] },
  { label: 'Fiber', role: 'backend', go: ['github.com/gofiber/fiber'] },
  { label: 'Actix Web', role: 'backend', rust: ['actix-web'] },
  { label: 'Axum', role: 'backend', rust: ['axum'] },
  { label: 'Rocket', role: 'backend', rust: ['rocket'] },
]

const normPy = (n: string): string => n.toLowerCase().replace(/_/g, '-')

function matches(m: Matcher, eco: Eco, deps: Set<string>): boolean {
  const list = m[eco]
  if (!list) return false
  for (const want of list) {
    if (eco === 'go') {
      const w = want.toLowerCase()
      for (const d of deps) if (d === w || d.startsWith(w + '/') || d.startsWith(w + '.')) return true
    } else if (eco === 'npm' && want.endsWith('/')) {
      for (const d of deps) if (d.startsWith(want)) return true
    } else if (deps.has(eco === 'py' ? normPy(want) : want)) return true
  }
  return false
}

export function detectInfra(eco: Eco, deps: Set<string>): InfraDef[] {
  return INFRA.filter((d) => matches(d, eco, deps))
}

export function detectFramework(eco: Eco, deps: Set<string>): FrameworkDef | null {
  // Meta-frameworks first (Next before React), which FRAMEWORKS order guarantees.
  return FRAMEWORKS.find((f) => matches(f, eco, deps)) ?? null
}

/* --------------------------- Manifest readers ---------------------------- */

interface Manifest {
  eco: Eco
  name: string | null
  deps: Set<string>
  file: string
}

function npmDeps(pkg: any): Set<string> {
  return new Set(
    Object.keys({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.peerDependencies ?? {}) }),
  )
}

/** Extract the body of a TOML table `[name]` (up to the next header). */
function tomlTable(text: string, name: string): string | null {
  const lines = text.split(/\r?\n/)
  const header = `[${name}]`
  const start = lines.findIndex((l) => l.trim() === header)
  if (start < 0) return null
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break
    body.push(lines[i])
  }
  return body.join('\n')
}

/** Keys of a TOML table, e.g. Cargo [dependencies] or Poetry deps. */
function tomlKeys(body: string | null): string[] {
  if (!body) return []
  const out: string[] = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/)
    if (m) out.push(m[1])
  }
  return out
}

function pyReqName(spec: string): string | null {
  const m = spec.trim().match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)/)
  return m ? normPy(m[1]) : null
}

/**
 * Quoted strings of the TOML array assigned to `key`. Walks characters so that
 * brackets inside strings (e.g. "psycopg[binary]>=3") don't end the array early.
 */
function tomlStringArray(body: string, key: string): string[] {
  const start = body.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[`, 'm'))
  if (!start || start.index === undefined) return []
  const out: string[] = []
  let quote: string | null = null
  let cur = ''
  for (let i = start.index + start[0].length; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      if (c === quote) {
        out.push(cur)
        cur = ''
        quote = null
      } else cur += c
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#') while (i < body.length && body[i] !== '\n') i++
    else if (c === ']') break
  }
  return out
}

export function parsePyproject(text: string): { name: string | null; deps: Set<string> } {
  const deps = new Set<string>()
  const project = tomlTable(text, 'project')
  let name: string | null = null
  if (project) {
    name = project.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] ?? null
    for (const spec of tomlStringArray(project, 'dependencies')) {
      const n = pyReqName(spec)
      if (n) deps.add(n)
    }
  }
  const poetry = tomlTable(text, 'tool.poetry.dependencies')
  for (const k of tomlKeys(poetry)) if (k.toLowerCase() !== 'python') deps.add(normPy(k))
  if (!name) name = tomlTable(text, 'tool.poetry')?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] ?? null
  return { name, deps }
}

export function parseRequirements(text: string): Set<string> {
  const deps = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/#.*/, '').trim()
    if (!t || t.startsWith('-')) continue
    const n = pyReqName(t)
    if (n) deps.add(n)
  }
  return deps
}

export function parseGoMod(text: string): { name: string | null; deps: Set<string> } {
  const name = text.match(/^module\s+(\S+)/m)?.[1] ?? null
  const deps = new Set<string>()
  const block = text.match(/require\s*\(([\s\S]*?)\)/g) ?? []
  for (const b of block) for (const line of b.split('\n').slice(1)) {
    const p = line.trim().split(/\s+/)[0]
    if (p && p !== ')' && !p.startsWith('//')) deps.add(p.toLowerCase())
  }
  for (const m of text.matchAll(/^require\s+([^\s(]+)\s+v/gm)) deps.add(m[1].toLowerCase())
  return { name, deps }
}

export function parseCargo(text: string): { name: string | null; deps: Set<string> } {
  const name = tomlTable(text, 'package')?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] ?? null
  return { name, deps: new Set(tomlKeys(tomlTable(text, 'dependencies'))) }
}

/** Read whichever manifest describes the package at `dir`. */
async function readManifest(dir: string): Promise<Manifest | null> {
  const pkg = await readJson(join(dir, 'package.json'))
  if (pkg) return { eco: 'npm', name: typeof pkg.name === 'string' ? pkg.name : null, deps: npmDeps(pkg), file: 'package.json' }

  const pyproject = await readText(join(dir, 'pyproject.toml'))
  if (pyproject !== null) {
    const { name, deps } = parsePyproject(pyproject)
    const req = await readText(join(dir, 'requirements.txt'))
    if (req !== null) for (const d of parseRequirements(req)) deps.add(d)
    return { eco: 'py', name, deps, file: 'pyproject.toml' }
  }
  const req = await readText(join(dir, 'requirements.txt'))
  if (req !== null) return { eco: 'py', name: null, deps: parseRequirements(req), file: 'requirements.txt' }

  const gomod = await readText(join(dir, 'go.mod'))
  if (gomod !== null) {
    const { name, deps } = parseGoMod(gomod)
    return { eco: 'go', name: name ? name.split('/').pop() ?? name : null, deps, file: 'go.mod' }
  }
  const cargo = await readText(join(dir, 'Cargo.toml'))
  if (cargo !== null) {
    const { name, deps } = parseCargo(cargo)
    return { eco: 'rust', name, deps, file: 'Cargo.toml' }
  }
  return null
}

/* --------------------------- Rung 1: compose ----------------------------- */

const COMPOSE_NAMES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
const COMPOSE_DIRS = ['', 'docker', 'deploy', 'deployment', 'deployments', 'infra', 'ops', '.devcontainer']

export function classifyImage(image: string): { role: NodeRole; brand?: string } | null {
  const i = image.toLowerCase().split('@')[0]
  if (/postgres|postgis|timescale/.test(i)) return { role: 'database', brand: 'postgresql' }
  if (/mysql|mariadb/.test(i)) return { role: 'database', brand: 'mysql' }
  if (/mongo/.test(i)) return { role: 'database', brand: 'mongodb' }
  if (/redis|valkey|keydb|dragonfly/.test(i)) return { role: 'cache', brand: 'redis' }
  if (/memcached/.test(i)) return { role: 'cache' }
  if (/rabbitmq/.test(i)) return { role: 'queue', brand: 'rabbitmq' }
  if (/kafka|redpanda/.test(i)) return { role: 'queue', brand: 'apachekafka' }
  if (/zookeeper/.test(i)) return { role: 'queue' }
  if (/nats/.test(i)) return { role: 'queue' }
  if (/nginx/.test(i)) return { role: 'cloud', brand: 'nginx' }
  if (/traefik/.test(i)) return { role: 'cloud', brand: 'traefikproxy' }
  if (/caddy|haproxy|envoy/.test(i)) return { role: 'cloud' }
  if (/elasticsearch|opensearch/.test(i)) return { role: 'database', brand: 'elasticsearch' }
  if (/minio|localstack/.test(i)) return { role: 'cloud' }
  if (/clickhouse|cassandra|scylla|cockroach|neo4j|influxdb/.test(i)) return { role: 'database' }
  if (/mailhog|mailpit/.test(i)) return { role: 'service' }
  return null
}

function roleFromName(name: string): NodeRole {
  const n = name.toLowerCase()
  if (/(^|[-_])(web|frontend|front|ui|client|app-web|spa|site|renderer|views?|pages|components)([-_]|$)/.test(n)) return 'frontend'
  if (/(^|[-_])(db|database|postgres|mysql|mongo|store)([-_]|$)/.test(n)) return 'database'
  if (/(^|[-_])(cache|redis)([-_]|$)/.test(n)) return 'cache'
  if (/(^|[-_])(queue|broker|mq|kafka|rabbit)([-_]|$)/.test(n)) return 'queue'
  if (/(^|[-_])(proxy|gateway|lb|ingress|nginx|edge)([-_]|$)/.test(n)) return 'cloud'
  return 'backend'
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Values of a compose `environment` block, whether list or map form. */
function envValues(env: unknown): string[] {
  if (Array.isArray(env)) return env.map((e) => String(e).split('=').slice(1).join('='))
  if (env && typeof env === 'object') return Object.values(env as Record<string, unknown>).map((v) => String(v ?? ''))
  return []
}

/** Service names that appear as a hostname inside a string value. */
export function referencedServices(value: string, services: string[], self: string): string[] {
  const out: string[] = []
  for (const s of services) {
    if (s === self) continue
    const re = new RegExp(`(^|[/@:=,\\s"'])${escapeRe(s)}($|[:/,\\s"'?])`, 'i')
    if (re.test(value)) out.push(s)
  }
  return out
}

async function findCompose(root: string): Promise<string | null> {
  for (const d of COMPOSE_DIRS) {
    for (const f of COMPOSE_NAMES) {
      const p = join(root, d, f)
      if (await fileExists(p)) return p
    }
  }
  return null
}

async function fromCompose(root: string, file: string): Promise<IRDiagram | null> {
  const text = await readText(file)
  if (text === null) return null
  let doc: any
  try {
    doc = yaml.load(text)
  } catch {
    return null
  }
  const services = doc?.services
  if (!services || typeof services !== 'object' || Array.isArray(services)) return null
  const names = Object.keys(services)
  if (names.length === 0) return null

  const relFile = rel(root, file)
  const g = new GraphBuilder()
  const idOf = new Map<string, string>()

  for (const name of names) {
    const svc = (services[name] ?? {}) as Record<string, any>
    const image: string = typeof svc.image === 'string' ? svc.image : ''
    const built = svc.build !== undefined
    const cls = image ? classifyImage(image) : null
    // A service built from local source is application code, not infrastructure.
    const role: NodeRole = built ? roleFromName(name) : (cls?.role ?? roleFromName(name))
    const sublabel = image ? image.split(':')[0] : built ? 'built from source' : undefined
    const id = g.addNode({
      id: slug(name),
      label: name,
      sublabel,
      role,
      brand: built ? undefined : cls?.brand,
      meta: { source: `${relFile}#services.${name}` },
    })
    idOf.set(name, id)
  }

  for (const name of names) {
    const svc = (services[name] ?? {}) as Record<string, any>
    const from = idOf.get(name)!
    const dep = svc.depends_on
    const deps: string[] = Array.isArray(dep) ? dep.map(String) : dep && typeof dep === 'object' ? Object.keys(dep) : []
    for (const d of deps) if (idOf.has(d)) g.addEdge(from, idOf.get(d)!, 'depends on')

    const links: string[] = Array.isArray(svc.links) ? svc.links.map((l: unknown) => String(l).split(':')[0]) : []
    for (const l of links) if (idOf.has(l)) g.addEdge(from, idOf.get(l)!, 'links')

    for (const value of envValues(svc.environment)) {
      for (const target of referencedServices(value, names, name)) g.addEdge(from, idOf.get(target)!, 'uses', 'dashed')
    }
  }

  const { capped, total } = capGraph(g)
  return {
    id: slug(basename(root)),
    title: basename(root),
    subtitle: `Mapped from ${relFile}${capped ? ` (showing ${MAX_NODES} of ${total} services)` : ''}`,
    type: 'architecture',
    direction: 'RIGHT',
    nodes: g.nodes,
    edges: g.edges,
  }
}

/* ------------------------ Rung 2: monorepo graph ------------------------- */

/** Expand one workspace glob ("packages/*", "apps/**", "tools/cli") to dirs. */
export async function expandGlob(root: string, pattern: string, maxDepth = 4): Promise<string[]> {
  const segs = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').split('/').filter(Boolean)
  const results = new Set<string>()

  const walk = async (dir: string, i: number, depth: number): Promise<void> => {
    if (i === segs.length) {
      results.add(dir)
      return
    }
    const seg = segs[i]
    if (seg === '**') {
      await walk(dir, i + 1, depth) // zero dirs
      if (depth >= maxDepth) return
      for (const d of await listDirs(dir)) await walk(join(dir, d.name), i, depth + 1)
    } else if (seg.includes('*')) {
      const re = new RegExp('^' + seg.split('*').map(escapeRe).join('.*') + '$')
      for (const d of await listDirs(dir)) if (re.test(d.name)) await walk(join(dir, d.name), i + 1, depth + 1)
    } else {
      await walk(join(dir, seg), i + 1, depth + 1)
    }
  }
  await walk(root, 0, 0)
  return [...results]
}

async function workspacePatterns(root: string, rootPkg: any): Promise<string[] | null> {
  const ws = rootPkg?.workspaces
  if (Array.isArray(ws)) return ws.map(String)
  if (ws && Array.isArray(ws.packages)) return ws.packages.map(String)
  const pnpm = await readText(join(root, 'pnpm-workspace.yaml'))
  if (pnpm !== null) {
    try {
      const doc: any = yaml.load(pnpm)
      if (Array.isArray(doc?.packages)) return doc.packages.map(String)
    } catch {
      /* malformed, ignore */
    }
  }
  return null
}

async function fromMonorepo(root: string, rootPkg: any, patterns: string[]): Promise<IRDiagram | null> {
  const include = patterns.filter((p) => !p.startsWith('!'))
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1))
  const excluded = new Set<string>()
  for (const p of exclude) for (const d of await expandGlob(root, p)) excluded.add(d)

  const dirs = new Set<string>()
  for (const p of include) for (const d of await expandGlob(root, p)) if (!excluded.has(d)) dirs.add(d)

  interface Pkg { dir: string; name: string; deps: Set<string> }
  const pkgs: Pkg[] = []
  for (const d of [...dirs].sort()) {
    const pkg = await readJson(join(d, 'package.json'))
    if (!pkg || typeof pkg.name !== 'string') continue
    pkgs.push({ dir: d, name: pkg.name, deps: npmDeps(pkg) })
  }
  if (pkgs.length === 0) return null

  const g = new GraphBuilder()
  const idOf = new Map<string, string>()
  for (const p of pkgs) {
    const fw = detectFramework('npm', p.deps)
    const role: NodeRole = fw?.role ?? roleFromName(basename(p.dir))
    const id = g.addNode({
      id: slug(p.name),
      label: p.name,
      sublabel: fw ? `${fw.label} · ${rel(root, p.dir)}` : rel(root, p.dir),
      role,
      meta: { source: `${rel(root, p.dir)}/package.json` },
    })
    idOf.set(p.name, id)
  }

  const infraIds = new Map<string, string>()
  for (const p of pkgs) {
    const from = idOf.get(p.name)!
    for (const dep of p.deps) {
      const to = idOf.get(dep)
      if (to) g.addEdge(from, to)
    }
    for (const inf of detectInfra('npm', p.deps)) {
      let id = infraIds.get(inf.label)
      if (!id) {
        id = g.addNode({ id: slug(inf.label), label: inf.label, role: inf.role, brand: inf.brand, meta: { source: 'package.json dependencies' } })
        infraIds.set(inf.label, id)
      }
      g.addEdge(from, id, undefined, 'dashed')
    }
  }

  const { capped, total } = capGraph(g)
  const title = typeof rootPkg?.name === 'string' ? rootPkg.name : basename(root)
  return {
    id: slug(title),
    title,
    subtitle: `Monorepo, ${pkgs.length} package${pkgs.length === 1 ? '' : 's'}${capped ? ` (showing ${MAX_NODES} of ${total} nodes)` : ''}`,
    type: 'architecture',
    direction: 'RIGHT',
    nodes: g.nodes,
    edges: g.edges,
  }
}

/* ------------------- Multi-project repos (no workspaces) ----------------- */

/** Folders that hold examples or test data, not parts of the system. */
const NON_SYSTEM_DIRS = new Set(['examples', 'example', 'samples', 'sample', 'fixtures', 'test', 'tests', 'docs', 'doc', 'e2e', '__tests__'])

interface SubProject {
  dir: string
  manifest: Manifest
}

/** Find manifests one or two levels below the root (frontend/, services/api/, ...). */
export async function findSubProjects(root: string): Promise<SubProject[]> {
  const out: SubProject[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    for (const d of await listDirs(dir)) {
      if (d.name.startsWith('.') || NON_SYSTEM_DIRS.has(d.name.toLowerCase())) continue
      const child = join(dir, d.name)
      const m = await readManifest(child)
      if (m) out.push({ dir: child, manifest: m })
      else if (depth < 2) await visit(child, depth + 1)
    }
  }
  await visit(root, 1)
  return out.sort((a, b) => a.dir.localeCompare(b.dir))
}

function fromMultiProject(root: string, subs: SubProject[]): IRDiagram {
  const g = new GraphBuilder()
  const idOfName = new Map<string, string>()
  const ids: string[] = []
  for (const sp of subs) {
    const m = sp.manifest
    const fw = detectFramework(m.eco, m.deps)
    const path = rel(root, sp.dir)
    const id = g.addNode({
      id: slug(m.name ?? path),
      label: m.name ?? basename(sp.dir),
      sublabel: `${fw?.label ?? ecoLabel(m.eco)} · ${path}`,
      role: fw?.role ?? roleFromName(basename(sp.dir)),
      meta: { source: `${path}/${m.file}` },
    })
    ids.push(id)
    if (m.name) idOfName.set(m.name, id)
  }

  const infraIds = new Map<string, string>()
  subs.forEach((sp, i) => {
    const from = ids[i]
    for (const dep of sp.manifest.deps) {
      const to = idOfName.get(dep)
      if (to) g.addEdge(from, to)
    }
    for (const inf of detectInfra(sp.manifest.eco, sp.manifest.deps)) {
      let id = infraIds.get(inf.label)
      if (!id) {
        id = g.addNode({ id: slug(inf.label), label: inf.label, role: inf.role, brand: inf.brand, meta: { source: `${rel(root, sp.dir)}/${sp.manifest.file}` } })
        infraIds.set(inf.label, id)
      }
      g.addEdge(from, id, undefined, 'dashed')
    }
  })

  const { capped, total } = capGraph(g)
  return {
    id: slug(basename(root)),
    title: basename(root),
    subtitle: `${subs.length} project${subs.length === 1 ? '' : 's'} found in subfolders${capped ? ` (showing ${MAX_NODES} of ${total} nodes)` : ''}`,
    type: 'architecture',
    direction: 'RIGHT',
    nodes: g.nodes,
    edges: g.edges,
  }
}

/* ------------------------ Fallback: single package ----------------------- */

const SOURCE_DIRS = new Set([
  'src', 'app', 'apps', 'services', 'server', 'client', 'web', 'api', 'backend',
  'frontend', 'lib', 'pkg', 'cmd', 'internal', 'workers', 'worker', 'functions',
])

async function fromSinglePackage(root: string): Promise<IRDiagram> {
  const m = await readManifest(root)
  const g = new GraphBuilder()
  const title = m?.name ?? basename(root)

  const fw = m ? detectFramework(m.eco, m.deps) : null
  const hasIndexHtml = await fileExists(join(root, 'index.html'))
  const dockerized = await fileExists(join(root, 'Dockerfile'))
  const role: NodeRole = fw?.role ?? (hasIndexHtml ? 'frontend' : 'backend')
  const subParts = [fw?.label ?? (hasIndexHtml ? 'web app' : m ? ecoLabel(m.eco) : 'project')]
  if (dockerized) subParts.push('Docker')
  const appId = g.addNode({
    id: 'app',
    label: title,
    sublabel: subParts.join(' · '),
    role,
    meta: { source: m?.file ?? '.' },
  })

  // Source folders become components. A folder like src/ that only groups
  // several sub-folders (src/main, src/renderer, ...) is expanded one level so
  // the map shows the real structure instead of one opaque box.
  for (const d of await listDirs(root)) {
    if (!SOURCE_DIRS.has(d.name.toLowerCase()) || d.name.startsWith('.')) continue
    const children = (await listDirs(join(root, d.name))).filter((c) => !c.name.startsWith('.'))
    if (children.length >= 2 && children.length <= 12) {
      for (const c of children) {
        const path = `${d.name}/${c.name}`
        const id = g.addNode({ id: `dir-${slug(path)}`, label: `${path}/`, role: roleFromName(c.name), meta: { source: path } })
        g.addEdge(appId, id, undefined, 'weak')
      }
    } else {
      const id = g.addNode({ id: `dir-${slug(d.name)}`, label: `${d.name}/`, role: roleFromName(d.name), meta: { source: d.name } })
      g.addEdge(appId, id, undefined, 'weak')
    }
  }

  if (m) {
    for (const inf of detectInfra(m.eco, m.deps)) {
      const id = g.addNode({ id: slug(inf.label), label: inf.label, role: inf.role, brand: inf.brand, meta: { source: m.file } })
      g.addEdge(appId, id)
    }
  }

  const { capped, total } = capGraph(g)
  const from = m ? `Mapped from ${m.file}` : 'Mapped from repository structure (no manifest found)'
  return {
    id: slug(title),
    title,
    subtitle: from + (capped ? ` (showing ${MAX_NODES} of ${total} nodes)` : ''),
    type: 'architecture',
    direction: 'RIGHT',
    nodes: g.nodes,
    edges: g.edges,
  }
}

function ecoLabel(eco: Eco): string {
  return { npm: 'Node.js', py: 'Python', go: 'Go', rust: 'Rust' }[eco]
}

/* --------------------------------- Entry --------------------------------- */

/**
 * Scan a repository folder into an IR diagram. Throws only if `dir` itself can't
 * be read; malformed files inside the repo are skipped.
 */
export async function scanRepository(dir: string): Promise<IRDiagram> {
  await readdir(dir) // surface "folder not found / no permission" as a real error

  const compose = await findCompose(dir)
  if (compose) {
    const d = await fromCompose(dir, compose)
    if (d) return d
  }

  const rootPkg = await readJson(join(dir, 'package.json'))
  const patterns = await workspacePatterns(dir, rootPkg)
  if (patterns) {
    const d = await fromMonorepo(dir, rootPkg, patterns)
    if (d) return d
  }

  // Several projects side by side (frontend/ + backend/, services/*) without a
  // workspace config; or a repo whose only manifest lives in a subfolder.
  const rootHasManifest = (await readManifest(dir)) !== null
  const subs = await findSubProjects(dir)
  if (subs.length >= 2 || (subs.length === 1 && !rootHasManifest)) return fromMultiProject(dir, subs)

  return fromSinglePackage(dir)
}
