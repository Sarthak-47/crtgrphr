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
 *      Go, Rust, JVM (Maven/Gradle) and .NET manifests
 *
 * Also: Kubernetes manifests and Helm charts (scan/kubernetes.ts), Terraform
 * (scan/terraform.ts, merged in as a group when the repo also has app code), and
 * multi-module Maven/Gradle builds and .NET solutions (scan/jvm-dotnet.ts).
 *
 * Big maps are not cut off: their parts are grouped by folder and the largest
 * groups start collapsed (drill-down, shared/collapse.ts), so nothing is lost.
 *
 * Ids are derived from names (not random) so re-scanning an unchanged repo yields
 * an identical map, and a changed repo yields a minimal diff.
 */
import { readFile, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import yaml from 'js-yaml'
import type { EdgeConfidence, IRDiagram, IREdge, IRNode, NodeRole } from '../shared/ir'
import { buildImportGraph, MAX_FILES, type ImportGraph } from './import-graph'
import { scanKubernetes } from './scan/kubernetes'
import { scanTerraform } from './scan/terraform'
import { parseCsproj, parseGradleBuild, parseGradleSettings, parsePom } from './scan/jvm-dotnet'
import { visibleCount } from '../shared/collapse'
import { collectWarnings, warn, warnMany } from './scan/warnings'
import { FACTS, FACT_SEP } from '../shared/facts'
import { mergeWire, protocolOf, publishedPorts, webProto, wireLabel, wireTo, type Wire } from './scan/wire'

/** Most boxes a map shows at once; beyond this, groups start collapsed. */
export const MAX_NODES = 80
/** Hard cap on what a scan keeps at all, so a huge repo can't make a slow map. */
export const MAX_TOTAL_NODES = 600

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

/** How an edge was found: written down in the code, or worked out from it. */
interface Provenance {
  confidence: EdgeConfidence
  evidence?: string
}
const declared = (evidence: string): Provenance => ({ confidence: 'declared', evidence })
const inferred = (evidence: string): Provenance => ({ confidence: 'inferred', evidence })

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

  addEdge(source: string, target: string, label?: string, variant?: IREdge['variant'], prov?: Provenance): void {
    if (source === target) return
    const key = `${source}->${target}`
    if (this.edgeKeys.has(key)) return
    this.edgeKeys.add(key)
    const e: IREdge = { id: key, source, target }
    if (label) e.label = label
    if (variant) e.variant = variant
    if (prov) {
      e.confidence = prov.confidence
      if (prov.evidence) e.evidence = prov.evidence
    }
    this.edges.push(e)
  }
}

/** Trim a graph to `max` nodes, keeping the best-connected ones. */
function trimGraph(g: GraphBuilder, max: number): string[] {
  const real = g.nodes.filter((n) => n.role !== 'group')
  if (real.length <= max) return []
  const degree = new Map<string, number>()
  for (const e of g.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  const keep = new Set(
    [...real].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, max).map((n) => n.id),
  )
  const usedGroups = new Set(real.filter((n) => keep.has(n.id) && n.parent).map((n) => n.parent!))
  const dropped = real.filter((n) => !keep.has(n.id)).map((n) => n.label)
  g.nodes = g.nodes.filter((n) => (n.role === 'group' ? usedGroups.has(n.id) : keep.has(n.id)))
  g.edges = g.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
  return dropped
}

/** Say which parts a trim left out, and how to see them. */
function warnDropped(dropped: string[], kept: number, total: number): void {
  if (!dropped.length) return
  const ex = dropped.slice(0, 5).join(', ')
  warn(
    `${dropped.length} of ${total} parts are not on the map: only the ${kept} best-connected are kept (e.g. left out: ${ex}${dropped.length > 5 ? ', ...' : ''}). Scan a subfolder to map the rest.`,
  )
}

const MANIFEST_FILE = /\/(package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|[^/]+\.(cs|fs|vb)proj)$/

/** Folder a node came from, for drill-down grouping (null for infra and the like). */
export function folderOfSource(source: string | undefined): string | null {
  if (!source) return null
  const path = source.split('#')[0]
  if (/\s/.test(path) || path === '.' || path === '') return null
  const dir = path.replace(MANIFEST_FILE, '')
  if (dir === path && /\.[A-Za-z0-9]+$/.test(path)) return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
  return dir
}

/**
 * Make a big graph readable without dropping parts: group ungrouped nodes by
 * folder, then collapse the largest groups until at most MAX_NODES boxes show.
 * Only if that can't get there (or the graph is enormous) are nodes trimmed.
 * Returns a note for the subtitle ('' when nothing was needed).
 */
function fitGraph(g: GraphBuilder): string {
  const total = g.nodes.filter((n) => n.role !== 'group').length
  if (total <= MAX_NODES) return ''
  let note = ''
  if (total > MAX_TOTAL_NODES) {
    warnDropped(trimGraph(g, MAX_TOTAL_NODES), MAX_TOTAL_NODES, total)
    note = `; kept the ${MAX_TOTAL_NODES} best-connected of ${total} parts`
  }
  const shown = (): number => visibleCount({ id: 'x', title: '', type: 'architecture', nodes: g.nodes, edges: g.edges })

  // No groups yet: make them from folders, one level below what everything shares.
  if (!g.nodes.some((n) => n.role === 'group')) {
    const dirs = new Map<string, string[]>()
    for (const n of g.nodes) {
      const f = folderOfSource(n.meta?.source)
      if (f !== null) dirs.set(n.id, f.split('/'))
    }
    const all = [...dirs.values()]
    let common = 0
    while (all.length && all.every((p) => p.length > common + 1 && p[common] === all[0][common])) common++
    const byFolder = new Map<string, string[]>()
    for (const [id, parts] of dirs) {
      const key = parts.slice(0, common + 1).join('/')
      byFolder.set(key, [...(byFolder.get(key) ?? []), id])
    }
    const worth = [...byFolder].filter(([, ids]) => ids.length >= 2)
    if (worth.length >= 2) {
      const parentOf = new Map<string, string>()
      for (const [folder, ids] of worth) {
        const gid = g.addNode({ id: `group-${slug(folder)}`, label: `${folder}/`, role: 'group', meta: { source: folder } })
        for (const id of ids) parentOf.set(id, gid)
      }
      g.nodes = g.nodes.map((n) => (parentOf.has(n.id) ? { ...n, parent: parentOf.get(n.id) } : n))
    }
  }

  // Collapse the biggest groups first until the map fits.
  const size = new Map<string, number>()
  for (const n of g.nodes) if (n.parent) size.set(n.parent, (size.get(n.parent) ?? 0) + 1)
  const order = [...size].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)
  let collapsed = 0
  for (const gid of order) {
    if (shown() <= MAX_NODES) break
    g.nodes = g.nodes.map((n) => (n.id === gid ? { ...n, collapsed: true } : n))
    collapsed++
  }
  if (shown() > MAX_NODES) {
    // Still too many (few or no groups): keep the best-connected instead.
    g.nodes = g.nodes.map((n) => {
      if (!n.collapsed) return n
      const { collapsed: _c, ...rest } = n
      return rest
    })
    warnDropped(trimGraph(g, MAX_NODES), MAX_NODES, total)
    return `${note}; showing the ${MAX_NODES} best-connected of ${total} parts`
  }
  return `${note}; ${collapsed} large group${collapsed === 1 ? '' : 's'} collapsed, double-click to open`
}

/* ------------------------- Dependency knowledge -------------------------- */

type Eco = 'npm' | 'py' | 'go' | 'rust' | 'jvm' | 'dotnet'
interface Matcher {
  npm?: string[]
  py?: string[]
  go?: string[]
  rust?: string[]
  /** "group:artifact", "group:" (any artifact of the group), or an artifact id ("x*" = prefix) */
  jvm?: string[]
  /** NuGet package id, or "Prefix." for any package under it; "sdk:web" etc. for the project SDK */
  dotnet?: string[]
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

/** JVM and .NET package names for the infrastructure above, by label. */
const INFRA_JVM_DOTNET: Record<string, Pick<Matcher, 'jvm' | 'dotnet'>> = {
  PostgreSQL: { jvm: ['org.postgresql:postgresql', 'r2dbc-postgresql'], dotnet: ['Npgsql', 'Npgsql.EntityFrameworkCore.PostgreSQL'] },
  MySQL: { jvm: ['mysql:mysql-connector-java', 'com.mysql:mysql-connector-j', 'org.mariadb.jdbc:mariadb-java-client'], dotnet: ['MySqlConnector', 'MySql.Data', 'Pomelo.EntityFrameworkCore.MySql'] },
  MongoDB: { jvm: ['org.mongodb:', 'spring-boot-starter-data-mongodb', 'spring-boot-starter-data-mongodb-reactive'], dotnet: ['MongoDB.Driver'] },
  SQLite: { jvm: ['org.xerial:sqlite-jdbc'], dotnet: ['Microsoft.Data.Sqlite', 'Microsoft.EntityFrameworkCore.Sqlite'] },
  Redis: { jvm: ['spring-boot-starter-data-redis', 'redis.clients:jedis', 'io.lettuce:lettuce-core', 'org.redisson:redisson'], dotnet: ['StackExchange.Redis', 'Microsoft.Extensions.Caching.StackExchangeRedis'] },
  Kafka: { jvm: ['org.apache.kafka:', 'spring-kafka', 'org.springframework.kafka:spring-kafka'], dotnet: ['Confluent.Kafka'] },
  RabbitMQ: { jvm: ['spring-boot-starter-amqp', 'com.rabbitmq:amqp-client'], dotnet: ['RabbitMQ.Client', 'MassTransit.RabbitMQ', 'EasyNetQ'] },
  Elasticsearch: { jvm: ['co.elastic.clients:', 'org.elasticsearch.client:', 'spring-boot-starter-data-elasticsearch'], dotnet: ['Elastic.Clients.Elasticsearch', 'NEST'] },
  AWS: { jvm: ['software.amazon.awssdk:', 'com.amazonaws:', 'io.awspring.cloud:'], dotnet: ['AWSSDK.'] },
  Stripe: { jvm: ['com.stripe:stripe-java'], dotnet: ['Stripe.net'] },
  'OpenAI API': { jvm: ['com.openai:openai-java'], dotnet: ['OpenAI', 'Azure.AI.OpenAI'] },
  'Anthropic API': { jvm: ['com.anthropic:anthropic-java'], dotnet: ['Anthropic.SDK'] },
}
for (const d of INFRA) Object.assign(d, INFRA_JVM_DOTNET[d.label] ?? {})
INFRA.push(
  { label: 'SQL Server', role: 'database', brand: 'microsoftsqlserver', jvm: ['com.microsoft.sqlserver:mssql-jdbc'], dotnet: ['Microsoft.Data.SqlClient', 'System.Data.SqlClient', 'Microsoft.EntityFrameworkCore.SqlServer'], py: ['pyodbc', 'pymssql'], npm: ['mssql', 'tedious'] },
  { label: 'Azure Service Bus', role: 'queue', jvm: ['com.azure:azure-messaging-servicebus'], dotnet: ['Azure.Messaging.ServiceBus', 'MassTransit.Azure.ServiceBus.Core'], npm: ['@azure/service-bus'], py: ['azure-servicebus'] },
  { label: 'Azure Storage', role: 'database', jvm: ['com.azure:azure-storage-blob'], dotnet: ['Azure.Storage.Blobs', 'Azure.Storage.Queues'], npm: ['@azure/storage-blob'], py: ['azure-storage-blob'] },
  { label: 'Google Cloud', role: 'cloud', jvm: ['com.google.cloud:'], dotnet: ['Google.Cloud.'], npm: ['@google-cloud/'], py: ['google-cloud-storage', 'google-cloud-pubsub', 'google-cloud-bigquery'] },
)

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
  { label: 'Spring Boot', role: 'backend', jvm: ['spring-boot-starter-web', 'spring-boot-starter-webflux', 'spring-boot-starter-jersey'] },
  { label: 'Quarkus', role: 'backend', jvm: ['quarkus-rest*', 'quarkus-resteasy*', 'quarkus-vertx-http'] },
  { label: 'Micronaut', role: 'backend', jvm: ['micronaut-http-server*'] },
  { label: 'Ktor', role: 'backend', jvm: ['ktor-server-core*'] },
  { label: 'Dropwizard', role: 'backend', jvm: ['dropwizard-core'] },
  { label: 'Spring Boot', role: 'backend', jvm: ['spring-boot-starter'] },
  { label: 'Blazor', role: 'frontend', dotnet: ['Microsoft.AspNetCore.Components.WebAssembly', 'sdk:blazorwebassembly'] },
  { label: 'ASP.NET Core', role: 'backend', dotnet: ['sdk:web'] },
  { label: '.NET worker', role: 'backend', dotnet: ['sdk:worker'] },
]

const normPy = (n: string): string => n.toLowerCase().replace(/_/g, '-')

function matches(m: Matcher, eco: Eco, deps: Set<string>): boolean {
  const list = m[eco]
  if (!list) return false
  for (const want of list) {
    if (eco === 'go') {
      const w = want.toLowerCase()
      for (const d of deps) if (d === w || d.startsWith(w + '/') || d.startsWith(w + '.')) return true
    } else if (eco === 'jvm') {
      if (want.endsWith(':')) {
        for (const d of deps) if (d.startsWith(want)) return true
      } else if (want.endsWith('*')) {
        const w = want.slice(0, -1)
        for (const d of deps) if (!d.includes(':') && d.startsWith(w)) return true
      } else if (deps.has(want)) return true
    } else if (eco === 'dotnet') {
      const w = want.toLowerCase()
      for (const d of deps) {
        const l = d.toLowerCase()
        if (l === w || (w.endsWith('.') && l.startsWith(w))) return true
      }
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
  /** a build that only lists modules (Maven aggregator): look inside it instead */
  aggregator?: boolean
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

  const pom = await readText(join(dir, 'pom.xml'))
  if (pom !== null) {
    const p = parsePom(pom)
    return { eco: 'jvm', name: p.name, deps: p.deps, file: 'pom.xml', aggregator: p.aggregator }
  }
  for (const f of ['build.gradle.kts', 'build.gradle']) {
    const gradle = await readText(join(dir, f))
    if (gradle === null) continue
    const settings = (await readText(join(dir, 'settings.gradle.kts'))) ?? (await readText(join(dir, 'settings.gradle')))
    const name = settings ? parseGradleSettings(settings).name : null
    return { eco: 'jvm', name: name ?? basename(dir), deps: parseGradleBuild(gradle).deps, file: f }
  }

  // .NET: the (non-test) project file in this folder.
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => /\.(cs|fs|vb)proj$/i.test(f)).sort()
  } catch {
    /* unreadable */
  }
  for (const f of files) {
    const text = await readText(join(dir, f))
    if (text === null) continue
    const proj = parseCsproj(text, f)
    if (proj.isTest) continue
    const deps = new Set(proj.deps)
    const sdk = proj.sdk?.toLowerCase() ?? ''
    if (sdk.endsWith('.web')) deps.add('sdk:web')
    else if (sdk.endsWith('.worker')) deps.add('sdk:worker')
    else if (sdk.endsWith('.blazorwebassembly')) deps.add('sdk:blazorwebassembly')
    return { eco: 'dotnet', name: proj.name, deps, file: f }
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

/** [name, value] pairs of a compose `environment` block, whether list or map form. */
function envEntries(env: unknown): [string, string][] {
  if (Array.isArray(env)) return env.map((e) => { const [k, ...v] = String(e).split('='); return [k, v.join('=')] as [string, string] })
  if (env && typeof env === 'object') return Object.entries(env as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')] as [string, string])
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

/** Operational facts about a compose service, shown as tags on its box. */
function composeFacts(svc: Record<string, any>): string[] {
  const facts: string[] = []
  const replicas = Number(svc.deploy?.replicas ?? svc.scale)
  if (Number.isFinite(replicas) && replicas > 1) facts.push(`×${replicas}`)
  // Named volumes hold data that outlives the container; bind mounts of source don't count.
  const vols = Array.isArray(svc.volumes) ? svc.volumes : []
  if (vols.some((v: unknown) => {
    const src = typeof v === 'string' ? v.split(':')[0] : (v as any)?.type === 'volume' ? String((v as any).source ?? 'vol') : ''
    return !!src && !/^[./~$]/.test(src) && !/^[A-Za-z]:[\/]/.test(src)
  })) facts.push('persistent')
  if (svc.healthcheck && svc.healthcheck.disable !== true) facts.push('health check')
  return facts
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
  } catch (e) {
    const why = e instanceof Error ? e.message.split('\n')[0] : String(e)
    warn(`${rel(root, file)} isn't valid YAML (${why}); mapped from the rest of the repository instead`)
    return null
  }
  const services = doc?.services
  if (!services || typeof services !== 'object' || Array.isArray(services)) {
    warn(`${rel(root, file)} has no services; mapped from the rest of the repository instead`)
    return null
  }
  const names = Object.keys(services)
  if (names.length === 0) return null

  const relFile = rel(root, file)
  const g = new GraphBuilder()
  const idOf = new Map<string, string>()

  const brandOf = new Map<string, string | undefined>()
  const roleOf = new Map<string, NodeRole>()
  for (const name of names) {
    const svc = (services[name] ?? {}) as Record<string, any>
    const image: string = typeof svc.image === 'string' ? svc.image : ''
    const built = svc.build !== undefined
    const cls = image ? classifyImage(image) : null
    // A service built from local source is application code, not infrastructure.
    const role: NodeRole = built ? roleFromName(name) : (cls?.role ?? roleFromName(name))
    const sublabel = image ? image.split(':')[0] : built ? 'built from source' : undefined
    const facts = composeFacts(svc)
    const id = g.addNode({
      id: slug(name),
      label: name,
      sublabel,
      role,
      brand: built ? undefined : cls?.brand,
      meta: { source: `${relFile}#services.${name}`, ...(facts.length ? { [FACTS]: facts.join(FACT_SEP) } : {}) },
    })
    idOf.set(name, id)
    brandOf.set(name, cls?.brand)
    roleOf.set(name, role)
  }

  // Traffic from outside: application services and proxies that publish a port.
  for (const name of names) {
    const role = roleOf.get(name)!
    if (!['frontend', 'backend', 'cloud', 'service'].includes(role)) continue
    const ports = publishedPorts((services[name] ?? {}).ports)
    if (ports.length === 0) continue
    if (!g.has('internet')) g.addNode({ id: 'internet', label: 'Internet', sublabel: 'users and clients', role: 'external', meta: { source: `${relFile}#ports` } })
    g.addEdge('internet', idOf.get(name)!, `${webProto(ports[0])} :${ports[0]}`, undefined, declared(`${relFile}: services.${name}.ports publishes ${ports.join(', ')}`))
  }

  // How each service reaches the others: declared dependencies and links, plus
  // connection strings in its environment. The label says how, when the config does.
  for (const name of names) {
    const svc = (services[name] ?? {}) as Record<string, any>
    const from = idOf.get(name)!
    const dep = svc.depends_on
    const listedDeps = new Set<string>(Array.isArray(dep) ? dep.map(String) : dep && typeof dep === 'object' ? Object.keys(dep) : [])
    const aliases = new Map<string, string>() // links: "queue:mq" means the code says "mq"
    if (Array.isArray(svc.links)) {
      for (const l of svc.links) {
        const [target, alias] = String(l).split(':')
        listedDeps.add(target)
        if (alias) aliases.set(target, alias)
      }
    }
    const command = Array.isArray(svc.command) ? svc.command.map(String) : typeof svc.command === 'string' ? [svc.command] : []
    const values: [string, string][] = [...envEntries(svc.environment), ...command.map((c: string) => ['command', c] as [string, string])]
    const dependsOn = new Set(Array.isArray(dep) ? dep.map(String) : dep && typeof dep === 'object' ? Object.keys(dep) : [])
    for (const target of names) {
      if (target === name) continue
      let wire: Wire | null = null
      const where: string[] = []
      for (const [key, v] of values) {
        const alias = aliases.get(target)
        const hit = mergeWire(wireTo(v, target), alias ? wireTo(v, alias) : null)
        if (hit) {
          wire = mergeWire(wire, hit)
          if (where.length < 3) where.push(key)
        }
      }
      if (!listedDeps.has(target) && !wire) continue
      const label = wireLabel(wire, brandOf.get(target), listedDeps.has(target) ? 'depends on' : 'uses')
      const listed = dependsOn.has(target) ? 'depends_on' : 'links'
      const envNote = where.length ? `${where.join(', ')} names ${target}` : ''
      const prov = listedDeps.has(target)
        ? declared(`${relFile}: services.${name}.${listed}${envNote ? `; ${envNote}` : ''}`)
        : inferred(`${relFile}: ${envNote} in services.${name}`)
      // A connection string is a real, synchronous dependency: drawn solid like depends_on.
      g.addEdge(from, idOf.get(target)!, label, undefined, prov)
    }
  }

  const fit = fitGraph(g)
  return {
    id: slug(basename(root)),
    title: basename(root),
    subtitle: `Mapped from ${relFile}${fit}`,
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
    if (!pkg || typeof pkg.name !== 'string') {
      if (await fileExists(join(d, 'package.json'))) warnMany('workspace packages skipped (package.json unreadable or without a name)', `${rel(root, d)}/package.json`)
      continue
    }
    pkgs.push({ dir: d, name: pkg.name, deps: npmDeps(pkg) })
  }
  if (pkgs.length === 0) return null

  const g = new GraphBuilder()
  const idOf = new Map<string, string>()

  // Packages living under different top-level folders (apps/, packages/, ...)
  // are drawn inside a group per folder.
  const folderOf = (p: Pkg): string | null => {
    const parts = rel(root, p.dir).split('/')
    return parts.length > 1 ? parts[0] : null
  }
  const folders = [...new Set(pkgs.map(folderOf).filter((f): f is string => f !== null))].sort()
  const groupOf = new Map<string, string>()
  if (folders.length >= 2) {
    for (const f of folders) {
      groupOf.set(f, g.addNode({ id: `group-${slug(f)}`, label: `${f}/`, role: 'group', meta: { source: f } }))
    }
  }

  for (const p of pkgs) {
    const fw = detectFramework('npm', p.deps)
    const role: NodeRole = fw?.role ?? roleFromName(basename(p.dir))
    const folder = folderOf(p)
    const parent = folder ? groupOf.get(folder) : undefined
    const id = g.addNode({
      id: slug(p.name),
      label: p.name,
      sublabel: fw ? `${fw.label} · ${rel(root, p.dir)}` : rel(root, p.dir),
      role,
      ...(parent ? { parent } : {}),
      meta: { source: `${rel(root, p.dir)}/package.json` },
    })
    idOf.set(p.name, id)
  }

  const infraIds = new Map<string, string>()
  for (const p of pkgs) {
    const from = idOf.get(p.name)!
    const manifest = `${rel(root, p.dir)}/package.json`
    for (const dep of p.deps) {
      const to = idOf.get(dep)
      if (to) g.addEdge(from, to, undefined, undefined, declared(`${manifest} depends on ${dep}`))
    }
    for (const inf of detectInfra('npm', p.deps)) {
      let id = infraIds.get(inf.label)
      if (!id) {
        id = g.addNode({ id: slug(inf.label), label: inf.label, role: inf.role, brand: inf.brand, meta: { source: 'package.json dependencies' } })
        infraIds.set(inf.label, id)
      }
      g.addEdge(from, id, protocolOf(inf.brand), 'dashed', inferred(`${manifest} has a ${inf.label} client library`))
    }
  }

  const fit = fitGraph(g)
  const title = typeof rootPkg?.name === 'string' ? rootPkg.name : basename(root)
  return {
    id: slug(title),
    title,
    subtitle: `Monorepo, ${pkgs.length} package${pkgs.length === 1 ? '' : 's'}${fit}`,
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
      if (m && !m.aggregator) out.push({ dir: child, manifest: m })
      else if (depth < (m?.aggregator ? 3 : 2)) await visit(child, depth + 1)
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
    const manifest = `${rel(root, sp.dir)}/${sp.manifest.file}`
    for (const dep of sp.manifest.deps) {
      const to = idOfName.get(dep)
      if (to) g.addEdge(from, to, undefined, undefined, declared(`${manifest} depends on ${dep}`))
    }
    for (const inf of detectInfra(sp.manifest.eco, sp.manifest.deps)) {
      let id = infraIds.get(inf.label)
      if (!id) {
        id = g.addNode({ id: slug(inf.label), label: inf.label, role: inf.role, brand: inf.brand, meta: { source: manifest } })
        infraIds.set(inf.label, id)
      }
      g.addEdge(from, id, protocolOf(inf.brand), 'dashed', inferred(`${manifest} has a ${inf.label} client library`))
    }
  })

  const fit = fitGraph(g)
  return {
    id: slug(basename(root)),
    title: basename(root),
    subtitle: `${subs.length} project${subs.length === 1 ? '' : 's'} found in subfolders${fit}`,
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

/**
 * Rung 3: the components of one package and the imports between them, with
 * each infra dependency attached to the component that imports it.
 */
function fromImportGraph(root: string, title: string, m: Manifest | null, graph: ImportGraph, dockerized: boolean): IRDiagram {
  const g = new GraphBuilder()
  const eco: Eco = m?.eco ?? (graph.components.every((c) => c.lang === 'py') ? 'py' : 'npm')
  const idOf = new Map<string, string>()
  const componentFrameworks: string[] = []
  for (const c of graph.components) {
    // Per-component framework (React in the renderer, FastAPI in the api...).
    // Electron is skipped: every process imports it, it says nothing about a part.
    const fw = FRAMEWORKS.find((f) => f.label !== 'Electron' && matches(f, c.lang === 'py' ? 'py' : 'npm', c.packages))
    const role: NodeRole = fw?.role ?? roleFromName(c.label)
    if (fw) componentFrameworks.push(fw.label)
    const id = g.addNode({
      id: `dir-${slug(c.dir)}`,
      label: c.label,
      sublabel: `${fw ? fw.label + ' · ' : ''}${c.dir}/ · ${c.files} file${c.files === 1 ? '' : 's'}`,
      role,
      meta: { source: c.dir },
    })
    idOf.set(c.id, id)
  }
  for (const e of graph.edges) {
    const example = e.example ? `, e.g. ${e.example[0]} imports ${e.example[1]}` : ''
    g.addEdge(idOf.get(e.source)!, idOf.get(e.target)!, `${e.count} import${e.count === 1 ? '' : 's'}`, undefined, declared(`${e.count} import statement${e.count === 1 ? '' : 's'}${example}`))
  }
  const infraIds = new Map<string, string>()
  for (const c of graph.components) {
    for (const inf of detectInfra(c.lang === 'py' ? 'py' : 'npm', c.packages)) {
      let id = infraIds.get(inf.label)
      if (!id) {
        id = g.addNode({ id: slug(inf.label), label: inf.label, role: inf.role, brand: inf.brand, meta: { source: `imported in ${c.dir}` } })
        infraIds.set(inf.label, id)
      }
      g.addEdge(idOf.get(c.id)!, id, protocolOf(inf.brand), 'dashed', inferred(`code in ${c.dir}/ imports a ${inf.label} client library`))
    }
  }

  // Name the stack honestly: an app shell (Electron) plus each part's framework.
  const pkgFw = m ? detectFramework(m.eco, m.deps) : null
  const stack = [...new Set([...(pkgFw?.label === 'Electron' ? ['Electron'] : []), ...componentFrameworks])]
  const parts = [
    stack.length ? stack.join(' + ') : (pkgFw?.label ?? ecoLabel(eco)),
    `${graph.components.length} components from imports across ${graph.files} files${graph.truncated ? ` (first ${MAX_FILES})` : ''}`,
  ]
  if (dockerized) parts.push('Docker')
  const fit = fitGraph(g)
  return {
    id: slug(title),
    title,
    subtitle: parts.join(' · ') + fit,
    type: 'architecture',
    direction: 'RIGHT',
    nodes: g.nodes,
    edges: g.edges,
  }
}

async function fromSinglePackage(root: string): Promise<IRDiagram> {
  const m = await readManifest(root)
  const g = new GraphBuilder()
  const title = m?.name ?? basename(root)

  const fw = m ? detectFramework(m.eco, m.deps) : null
  const hasIndexHtml = await fileExists(join(root, 'index.html'))
  const dockerized = await fileExists(join(root, 'Dockerfile'))

  // Prefer real structure from imports when the code has components that import each other.
  if (!m || m.eco === 'npm' || m.eco === 'py') {
    const graph = await buildImportGraph(root)
    if (graph && graph.edges.length > 0) return fromImportGraph(root, title, m, graph, dockerized)
  }
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
        g.addEdge(appId, id, undefined, 'weak', declared(`folder ${path}/`))
      }
    } else {
      const id = g.addNode({ id: `dir-${slug(d.name)}`, label: `${d.name}/`, role: roleFromName(d.name), meta: { source: d.name } })
      g.addEdge(appId, id, undefined, 'weak', declared(`folder ${d.name}/`))
    }
  }

  if (m) {
    for (const inf of detectInfra(m.eco, m.deps)) {
      const id = g.addNode({ id: slug(inf.label), label: inf.label, role: inf.role, brand: inf.brand, meta: { source: m.file } })
      g.addEdge(appId, id, protocolOf(inf.brand), undefined, inferred(`${m.file} has a ${inf.label} client library`))
    }
  }

  const fit = fitGraph(g)
  const from = m ? `Mapped from ${m.file}` : 'Mapped from repository structure (no manifest found)'
  return {
    id: slug(title),
    title,
    subtitle: from + fit,
    type: 'architecture',
    direction: 'RIGHT',
    nodes: g.nodes,
    edges: g.edges,
  }
}

function ecoLabel(eco: Eco): string {
  return { npm: 'Node.js', py: 'Python', go: 'Go', rust: 'Rust', jvm: 'JVM', dotnet: '.NET' }[eco]
}

/* --------------------------------- Entry --------------------------------- */

const helpers = { slug, classifyImage, roleFromName }

/**
 * Add a Terraform map to an app map as its own group(s): the app's parts and the
 * cloud resources they run on, side by side. Ids can't collide (Terraform ids end
 * in the resource kind), but any that do are renamed.
 */
function mergeInfra(app: IRDiagram, tf: IRDiagram): IRDiagram {
  const taken = new Set(app.nodes.map((n) => n.id))
  const rename = new Map<string, string>()
  for (const n of tf.nodes) {
    let id = n.id
    let i = 2
    while (taken.has(id)) id = `${n.id}-${i++}`
    taken.add(id)
    rename.set(n.id, id)
  }
  const groupId = rename.has('infrastructure') ? 'infrastructure-tf' : 'infrastructure'
  const hasOwnGroups = tf.nodes.some((n) => n.role === 'group')
  const nodes: IRNode[] = [...app.nodes]
  if (!hasOwnGroups) nodes.push({ id: groupId, label: 'Infrastructure (Terraform)', role: 'group', meta: { source: 'terraform' } })
  for (const n of tf.nodes) {
    const m: IRNode = { ...n, id: rename.get(n.id)! }
    if (n.parent) m.parent = rename.get(n.parent)
    else if (!hasOwnGroups && n.role !== 'group') m.parent = groupId
    if (n.role === 'group' && !n.label.toLowerCase().includes('terraform')) m.label = `Terraform: ${n.label}`
    nodes.push(m)
  }
  const edges = [
    ...app.edges,
    ...tf.edges.map((e) => {
      const source = rename.get(e.source)!
      const target = rename.get(e.target)!
      return { ...e, id: `${source}->${target}`, source, target }
    }),
  ]
  const resources = tf.nodes.filter((n) => n.role !== 'group').length
  return { ...app, nodes, edges, subtitle: `${app.subtitle ?? ''} · plus ${resources} Terraform resource${resources === 1 ? '' : 's'}` }
}

/** The app-level map: compose, Kubernetes/Helm, workspaces, sub-projects, or one package. */
async function scanApp(dir: string): Promise<IRDiagram | null> {
  const compose = await findCompose(dir)
  if (compose) {
    const d = await fromCompose(dir, compose)
    if (d) return d
  }

  const k8s = await scanKubernetes(dir, helpers)
  if (k8s) {
    const g = new GraphBuilder()
    g.nodes = k8s.nodes
    g.edges = k8s.edges
    const fit = fitGraph(g)
    return { ...k8s, nodes: g.nodes, edges: g.edges, subtitle: `${k8s.subtitle}${fit}` }
  }

  const rootPkg = await readJson(join(dir, 'package.json'))
  const patterns = await workspacePatterns(dir, rootPkg)
  if (patterns) {
    const d = await fromMonorepo(dir, rootPkg, patterns)
    if (d) return d
  }

  // Several projects side by side (frontend/ + backend/, services/*, Maven or
  // Gradle modules, a .NET solution) without a workspace config; or a repo
  // whose only manifest lives in a subfolder.
  const rootManifest = await readManifest(dir)
  const subs = await findSubProjects(dir)
  if (subs.length >= 2 || (subs.length === 1 && (!rootManifest || rootManifest.aggregator))) return fromMultiProject(dir, subs)

  if (!rootManifest) return null
  return fromSinglePackage(dir)
}

/**
 * Scan a repository and also return what the scan skipped or couldn't read, so
 * the user knows when a map may be incomplete (see scan/warnings.ts).
 */
export async function scanRepositoryWithReport(dir: string): Promise<{ diagram: IRDiagram; warnings: string[] }> {
  const { value, warnings } = await collectWarnings(() => scanRepository(dir))
  return { diagram: value, warnings }
}

/**
 * Scan a repository folder into an IR diagram. Throws only if `dir` itself can't
 * be read; malformed files inside the repo are skipped (and reported by
 * scanRepositoryWithReport).
 */
export async function scanRepository(dir: string): Promise<IRDiagram> {
  await readdir(dir) // surface "folder not found / no permission" as a real error

  const app = await scanApp(dir)
  const tf = await scanTerraform(dir, helpers)
  if (app && tf) return mergeInfra(app, tf)
  if (tf) {
    const g = new GraphBuilder()
    g.nodes = tf.nodes
    g.edges = tf.edges
    const fit = fitGraph(g)
    return { ...tf, nodes: g.nodes, edges: g.edges, subtitle: `${tf.subtitle}${fit}` }
  }
  return app ?? fromSinglePackage(dir)
}
