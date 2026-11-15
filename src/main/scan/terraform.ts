/**
 * Terraform (.tf) → IR. Reads `resource` and `module` blocks without a full HCL
 * parser: blocks are found by matching braces (strings, comments and heredocs are
 * skipped), and references are the `TYPE.NAME` / `module.NAME` expressions inside
 * a block.
 *
 * Only resources that are parts of a system become boxes: databases, caches,
 * queues, compute, gateways, storage. Plumbing (IAM, security groups, routes,
 * policies, attachments) is left out, but references *through* it still count:
 * if a Lambda's event-source mapping references a queue and the function, the
 * map shows queue → function.
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import type { IRDiagram, IRNode, NodeRole } from '../../shared/ir'
import { warnMany } from './warnings'

const MAX_FILES = 300
const MAX_DEPTH = 5
const SKIP_DIRS = new Set(['.terraform', 'node_modules', '.git', 'examples', 'example', 'test', 'tests'])

interface Kind {
  role: NodeRole
  label: string
  brand?: string
}

/** Resource type → what it is. Prefix entries end with '*'. */
const KINDS: Record<string, Kind> = {
  // AWS
  aws_db_instance: { role: 'database', label: 'RDS', brand: 'amazonrds' },
  aws_rds_cluster: { role: 'database', label: 'Aurora', brand: 'amazonrds' },
  aws_dynamodb_table: { role: 'database', label: 'DynamoDB', brand: 'amazondynamodb' },
  aws_docdb_cluster: { role: 'database', label: 'DocumentDB' },
  aws_redshift_cluster: { role: 'database', label: 'Redshift' },
  aws_opensearch_domain: { role: 'database', label: 'OpenSearch' },
  aws_elasticsearch_domain: { role: 'database', label: 'Elasticsearch' },
  aws_s3_bucket: { role: 'database', label: 'S3 bucket', brand: 'amazons3' },
  aws_efs_file_system: { role: 'database', label: 'EFS' },
  aws_elasticache_cluster: { role: 'cache', label: 'ElastiCache', brand: 'redis' },
  aws_elasticache_replication_group: { role: 'cache', label: 'ElastiCache', brand: 'redis' },
  aws_memorydb_cluster: { role: 'cache', label: 'MemoryDB' },
  aws_sqs_queue: { role: 'queue', label: 'SQS queue', brand: 'amazonsqs' },
  aws_sns_topic: { role: 'queue', label: 'SNS topic' },
  aws_msk_cluster: { role: 'queue', label: 'MSK (Kafka)', brand: 'apachekafka' },
  aws_kinesis_stream: { role: 'queue', label: 'Kinesis stream' },
  aws_mq_broker: { role: 'queue', label: 'Amazon MQ' },
  aws_cloudwatch_event_bus: { role: 'queue', label: 'EventBridge bus' },
  aws_cloudwatch_event_rule: { role: 'queue', label: 'EventBridge rule' },
  aws_sfn_state_machine: { role: 'backend', label: 'Step Functions' },
  aws_lambda_function: { role: 'backend', label: 'Lambda', brand: 'awslambda' },
  aws_ecs_service: { role: 'backend', label: 'ECS service' },
  aws_ecs_cluster: { role: 'backend', label: 'ECS cluster' },
  aws_eks_cluster: { role: 'backend', label: 'EKS cluster' },
  aws_instance: { role: 'backend', label: 'EC2 instance' },
  aws_autoscaling_group: { role: 'backend', label: 'Auto Scaling group' },
  aws_apprunner_service: { role: 'backend', label: 'App Runner' },
  aws_elastic_beanstalk_environment: { role: 'backend', label: 'Elastic Beanstalk' },
  aws_batch_job_queue: { role: 'queue', label: 'Batch queue' },
  aws_lb: { role: 'cloud', label: 'Load balancer' },
  aws_alb: { role: 'cloud', label: 'Load balancer' },
  aws_elb: { role: 'cloud', label: 'Load balancer' },
  aws_api_gateway_rest_api: { role: 'cloud', label: 'API Gateway' },
  aws_apigatewayv2_api: { role: 'cloud', label: 'API Gateway' },
  aws_cloudfront_distribution: { role: 'cloud', label: 'CloudFront' },
  aws_cognito_user_pool: { role: 'service', label: 'Cognito' },
  aws_amplify_app: { role: 'frontend', label: 'Amplify app' },
  // Google Cloud
  google_sql_database_instance: { role: 'database', label: 'Cloud SQL' },
  google_spanner_instance: { role: 'database', label: 'Spanner' },
  google_bigquery_dataset: { role: 'database', label: 'BigQuery' },
  google_firestore_database: { role: 'database', label: 'Firestore' },
  google_bigtable_instance: { role: 'database', label: 'Bigtable' },
  google_storage_bucket: { role: 'database', label: 'Cloud Storage' },
  google_redis_instance: { role: 'cache', label: 'Memorystore', brand: 'redis' },
  google_pubsub_topic: { role: 'queue', label: 'Pub/Sub topic' },
  google_pubsub_subscription: { role: 'queue', label: 'Pub/Sub subscription' },
  google_cloud_tasks_queue: { role: 'queue', label: 'Cloud Tasks' },
  google_cloud_run_service: { role: 'backend', label: 'Cloud Run' },
  google_cloud_run_v2_service: { role: 'backend', label: 'Cloud Run' },
  google_cloud_run_v2_job: { role: 'backend', label: 'Cloud Run job' },
  google_cloudfunctions_function: { role: 'backend', label: 'Cloud Function' },
  google_cloudfunctions2_function: { role: 'backend', label: 'Cloud Function' },
  google_container_cluster: { role: 'backend', label: 'GKE cluster' },
  google_compute_instance: { role: 'backend', label: 'Compute Engine' },
  google_compute_instance_group_manager: { role: 'backend', label: 'Instance group' },
  google_app_engine_application: { role: 'backend', label: 'App Engine' },
  google_api_gateway_gateway: { role: 'cloud', label: 'API Gateway' },
  google_compute_global_forwarding_rule: { role: 'cloud', label: 'Load balancer' },
  google_compute_forwarding_rule: { role: 'cloud', label: 'Load balancer' },
  // Azure
  'azurerm_postgresql_*server': { role: 'database', label: 'Azure PostgreSQL', brand: 'postgresql' },
  'azurerm_mysql_*server': { role: 'database', label: 'Azure MySQL', brand: 'mysql' },
  azurerm_mssql_server: { role: 'database', label: 'Azure SQL' },
  azurerm_mssql_database: { role: 'database', label: 'Azure SQL database' },
  azurerm_cosmosdb_account: { role: 'database', label: 'Cosmos DB' },
  azurerm_storage_account: { role: 'database', label: 'Storage account' },
  azurerm_redis_cache: { role: 'cache', label: 'Azure Cache for Redis', brand: 'redis' },
  azurerm_servicebus_namespace: { role: 'queue', label: 'Service Bus' },
  azurerm_servicebus_queue: { role: 'queue', label: 'Service Bus queue' },
  azurerm_servicebus_topic: { role: 'queue', label: 'Service Bus topic' },
  azurerm_eventhub_namespace: { role: 'queue', label: 'Event Hubs' },
  azurerm_eventhub: { role: 'queue', label: 'Event Hub' },
  azurerm_eventgrid_topic: { role: 'queue', label: 'Event Grid topic' },
  azurerm_kubernetes_cluster: { role: 'backend', label: 'AKS cluster' },
  'azurerm_*_web_app': { role: 'backend', label: 'App Service' },
  azurerm_app_service: { role: 'backend', label: 'App Service' },
  'azurerm_*function_app': { role: 'backend', label: 'Function App' },
  azurerm_container_app: { role: 'backend', label: 'Container App' },
  azurerm_container_group: { role: 'backend', label: 'Container Instances' },
  'azurerm_*_virtual_machine': { role: 'backend', label: 'Virtual machine' },
  azurerm_application_gateway: { role: 'cloud', label: 'Application Gateway' },
  azurerm_api_management: { role: 'cloud', label: 'API Management' },
  'azurerm_cdn_frontdoor_profile': { role: 'cloud', label: 'Front Door' },
  azurerm_frontdoor: { role: 'cloud', label: 'Front Door' },
  azurerm_lb: { role: 'cloud', label: 'Load balancer' },
  azurerm_static_site: { role: 'frontend', label: 'Static Web App' },
  azurerm_static_web_app: { role: 'frontend', label: 'Static Web App' },
}

const PREFIXES = Object.entries(KINDS)
  .filter(([k]) => k.includes('*'))
  .map(([k, v]) => [new RegExp('^' + k.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9_]*') + '$'), v] as const)

export function kindOf(type: string): Kind | null {
  if (KINDS[type] && !type.includes('*')) return KINDS[type]
  for (const [re, v] of PREFIXES) if (re.test(type)) return v
  return null
}

export interface TfBlock {
  kind: 'resource' | 'module' | 'data'
  type: string // resource type, or "module"
  name: string
  body: string
  file: string
}

/** Top-level `resource "t" "n" {`, `data "t" "n" {` and `module "n" {` blocks with their bodies. */
export function parseTf(text: string, file: string, onBroken?: () => void): TfBlock[] {
  const out: TfBlock[] = []
  const header = /^[ \t]*(resource|data)[ \t]+"([^"]+)"[ \t]+"([^"]+)"[ \t]*\{|^[ \t]*(module)[ \t]+"([^"]+)"[ \t]*\{/gm
  let m: RegExpExecArray | null
  while ((m = header.exec(text))) {
    const start = m.index + m[0].length
    const end = blockEnd(text, start)
    if (end < 0) {
      onBroken?.()
      break
    }
    const body = text.slice(start, end)
    if (m[4] === 'module') out.push({ kind: 'module', type: 'module', name: m[5], body, file })
    else out.push({ kind: m[1] as 'resource' | 'data', type: m[2], name: m[3], body, file })
    header.lastIndex = end + 1
  }
  return out
}

/** Index of the `}` closing a block whose `{` is just before `from`, or -1. */
function blockEnd(text: string, from: number): number {
  let depth = 1
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      // string: skip, honouring escapes; ${...} interpolation braces are inside it
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++
        i++
      }
    } else if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close < 0 ? text.length : close + 1
    } else if (c === '<' && text[i + 1] === '<') {
      const hm = text.slice(i).match(/^<<-?([A-Za-z_][A-Za-z0-9_]*)\r?\n/)
      if (hm) {
        const close = text.slice(i + hm[0].length).search(new RegExp(`^[ \\t]*${hm[1]}[ \\t]*$`, 'm'))
        i = close < 0 ? text.length : i + hm[0].length + close + hm[1].length
      }
    } else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Resource and module addresses referenced in a block body. */
export function referencesIn(body: string): string[] {
  const refs = new Set<string>()
  for (const m of body.matchAll(/(?<![\w.])(module)\.([A-Za-z0-9_-]+)/g)) refs.add(`module.${m[2]}`)
  for (const m of body.matchAll(/(?<![\w.])((?:aws|google|azurerm|azuread|kubernetes|helm|cloudflare|digitalocean)_[a-z0-9_]+)\.([A-Za-z0-9_-]+)/g)) {
    refs.add(`${m[1]}.${m[2]}`)
  }
  return [...refs]
}

const attr = (body: string, key: string): string | undefined => body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1]

async function tfFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= MAX_FILES) return
    let ents
    try {
      ents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name) && depth < MAX_DEPTH) await walk(join(dir, e.name), depth + 1)
      } else if (e.isFile() && e.name.endsWith('.tf')) out.push(join(dir, e.name))
    }
  }
  await walk(root, 0)
  return out.sort()
}

export interface TfHelpers {
  slug: (s: string) => string
}

export async function scanTerraform(root: string, h: TfHelpers): Promise<IRDiagram | null> {
  const files = await tfFiles(root)
  if (files.length === 0) return null
  const blocks: TfBlock[] = []
  const seen = new Set<string>()
  for (const f of files) {
    let text: string
    try {
      text = await readFile(f, 'utf8')
    } catch {
      continue
    }
    for (const b of parseTf(text, f, () => warnMany('Terraform files have an unclosed block and were read only up to it', relative(root, f).split(sep).join('/')))) {
      if (b.kind === 'data') continue
      const addr = b.kind === 'module' ? `module.${b.name}` : `${b.type}.${b.name}`
      // Environments (envs/dev, envs/prod) repeat the same module calls: take each once.
      if (seen.has(addr)) continue
      seen.add(addr)
      blocks.push(b)
    }
  }
  if (blocks.length === 0) return null

  const addrOf = (b: TfBlock): string => (b.kind === 'module' ? `module.${b.name}` : `${b.type}.${b.name}`)
  const byAddr = new Map(blocks.map((b) => [addrOf(b), b]))
  const shown = (b: TfBlock): boolean => b.kind === 'module' || kindOf(b.type) !== null

  // Group by folder when the code is spread over several (modules/network, modules/data...).
  const dirOf = (b: TfBlock): string => relative(root, join(b.file, '..')).split(sep).join('/') || '.'
  const dirs = [...new Set(blocks.filter(shown).map(dirOf))].sort()

  const nodes: IRNode[] = []
  const idOf = new Map<string, string>()
  const taken = new Set<string>()
  const add = (n: IRNode): string => {
    let id = n.id
    let i = 2
    while (taken.has(id)) id = `${n.id}-${i++}`
    taken.add(id)
    nodes.push({ ...n, id })
    return id
  }
  const groupOf = new Map<string, string>()
  if (dirs.length >= 2) for (const d of dirs) groupOf.set(d, add({ id: `tf-${h.slug(d)}`, label: d === '.' ? 'root module' : `${d}/`, role: 'group', meta: { source: d } }))

  for (const b of blocks) {
    if (!shown(b)) continue
    const k = b.kind === 'module' ? null : kindOf(b.type)!
    const relFile = relative(root, b.file).split(sep).join('/')
    const parent = groupOf.get(dirOf(b))
    const source = b.kind === 'module' ? attr(b.body, 'source') : undefined
    const nice = attr(b.body, 'name') ?? attr(b.body, 'function_name') ?? attr(b.body, 'bucket') ?? attr(b.body, 'identifier') ?? attr(b.body, 'cluster_id')
    const label = nice && !nice.includes('${') ? nice : b.name
    const id = add({
      id: h.slug(b.kind === 'module' ? `module-${b.name}` : `${b.name}-${k!.label}`),
      label,
      sublabel: b.kind === 'module' ? `module${source ? ` · ${source}` : ''}` : k!.label,
      role: b.kind === 'module' ? 'service' : k!.role,
      ...(k?.brand ? { brand: k.brand } : {}),
      ...(parent ? { parent } : {}),
      meta: { source: `${relFile}#${addrOf(b)}` },
    })
    idOf.set(addrOf(b), id)
  }
  if (idOf.size === 0) return null

  /** Shown blocks reachable from `addr`, directly or through hidden plumbing (up to two hops). */
  const reach = (addr: string, depth: number, seenAddr: Set<string>, via: string[] = []): { addr: string; via: string[] }[] => {
    const b = byAddr.get(addr)
    if (!b || depth > 2) return []
    const found: { addr: string; via: string[] }[] = []
    for (const r of referencesIn(b.body)) {
      if (seenAddr.has(r)) continue
      seenAddr.add(r)
      if (idOf.has(r)) found.push({ addr: r, via })
      else found.push(...reach(r, depth + 1, seenAddr, [...via, r]))
    }
    return found
  }

  type Edge = { id: string; source: string; target: string; label?: string; variant?: 'dashed'; confidence: 'declared' | 'inferred'; evidence: string }
  const edges = new Map<string, Edge>()
  const fileOf = (addr: string): string => relative(root, byAddr.get(addr)!.file).split(sep).join('/')
  const addEdge = (from: string, to: string, label: string | undefined, variant: 'dashed' | undefined, confidence: Edge['confidence'], evidence: string): void => {
    const s = idOf.get(from)
    const t = idOf.get(to)
    if (!s || !t || s === t) return
    const id = `${s}->${t}`
    if (!edges.has(id)) edges.set(id, { id, source: s, target: t, ...(label ? { label } : {}), ...(variant ? { variant } : {}), confidence, evidence })
  }

  // Direct references are declared; references through plumbing (IAM, security
  // groups...) are inferred, and the evidence names the plumbing.
  for (const b of blocks) {
    if (!shown(b)) continue
    for (const r of reach(addrOf(b), 0, new Set([addrOf(b)]))) {
      if (r.via.length === 0) addEdge(addrOf(b), r.addr, undefined, undefined, 'declared', `${fileOf(addrOf(b))}: ${addrOf(b)} references ${r.addr}`)
      else addEdge(addrOf(b), r.addr, undefined, 'dashed', 'inferred', `${fileOf(addrOf(b))}: ${addrOf(b)} reaches ${r.addr} through ${r.via.join(', ')}`)
    }
  }
  // Connector resources that only exist to link two parts.
  for (const b of blocks) {
    if (shown(b)) continue
    const targets = reach(addrOf(b), 0, new Set([addrOf(b)])).map((r) => r.addr)
    if (targets.length < 2) continue
    const why = `${fileOf(addrOf(b))}: ${addrOf(b)} connects them`
    if (b.type === 'aws_lambda_event_source_mapping') {
      const fn = targets.find((t) => t.startsWith('aws_lambda_function.'))
      for (const t of targets) if (fn && t !== fn) addEdge(t, fn, 'triggers', undefined, 'declared', why)
    } else if (b.type === 'aws_sns_topic_subscription' || b.type === 'google_pubsub_subscription') {
      const topic = targets.find((t) => /sns_topic|pubsub_topic/.test(t))
      for (const t of targets) if (topic && t !== topic) addEdge(topic, t, 'delivers', undefined, 'declared', why)
    } else if (/^aws_lb_listener|^aws_lb_target_group_attachment|^aws_lambda_permission|^aws_api_gateway_integration|^aws_apigatewayv2_integration|^aws_cloudwatch_event_target/.test(b.type)) {
      const front = targets.find((t) => /aws_lb\.|aws_alb\.|api_gateway|apigatewayv2|cloudwatch_event_rule/.test(t))
      for (const t of targets) if (front && t !== front) addEdge(front, t, 'routes', undefined, 'declared', why)
    }
  }

  const resources = nodes.filter((n) => n.role !== 'group').length
  return {
    id: h.slug(basename(root)),
    title: basename(root),
    subtitle: `Mapped from Terraform: ${resources} resource${resources === 1 ? '' : 's'} and modules in ${files.length} file${files.length === 1 ? '' : 's'}`,
    type: 'architecture',
    direction: 'RIGHT',
    nodes,
    edges: [...edges.values()],
  }
}
