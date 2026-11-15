/**
 * Kubernetes manifests and Helm charts → IR.
 *
 * Plain manifests: every workload (Deployment, StatefulSet, DaemonSet, Job,
 * CronJob) becomes a node, classified by its first container image (a postgres
 * StatefulSet is a database). Services are not drawn as boxes: a Service is how
 * a workload is reached, so traffic to it is drawn to the workloads its selector
 * picks. Edges come from Ingress backends, and from env values and ConfigMaps
 * that name another Service (http://api:8080, api.default.svc.cluster.local).
 * Namespaces become groups when there are several. Kustomize overlays repeat
 * resources, so each kind/name is taken once.
 *
 * Helm: template files contain Go templating and are not YAML, so a chart is read
 * from Chart.yaml (its dependencies) and values.yaml (its image). Each chart is a
 * node; a dependency like bitnami/postgresql becomes the database it is.
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import yaml from 'js-yaml'
import type { IRDiagram, IRNode, NodeRole } from '../../shared/ir'
import { FACTS, FACT_SEP } from '../../shared/facts'
import { mergeWire, webProto, wireLabel, wireTo, type Wire } from './wire'

export interface K8sHelpers {
  slug: (s: string) => string
  classifyImage: (image: string) => { role: NodeRole; brand?: string } | null
  roleFromName: (name: string) => NodeRole
}

const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Pod', 'ReplicaSet', 'DeploymentConfig'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', 'target', '.terraform', 'coverage', 'tests', 'test', 'examples', 'example', 'docs'])
const MAX_FILES = 400
const MAX_DEPTH = 5

const rel = (root: string, p: string): string => relative(root, p).split(sep).join('/') || '.'

interface Doc {
  kind: string
  name: string
  namespace?: string
  body: any
  file: string
}

/** YAML files under root that are not Helm templates or compose files. */
async function yamlFiles(root: string): Promise<{ manifests: string[]; charts: string[] }> {
  const manifests: string[] = []
  const charts: string[] = []
  const walk = async (dir: string, depth: number, inChart: boolean): Promise<void> => {
    if (manifests.length >= MAX_FILES) return
    let ents
    try {
      ents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const isChart = ents.some((e) => e.isFile() && e.name === 'Chart.yaml')
    if (isChart) charts.push(dir)
    for (const e of ents) {
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue
        // Chart templates are Go templates, not YAML; sub-charts are found on their own.
        if ((isChart || inChart) && e.name === 'templates') continue
        if (depth < MAX_DEPTH) await walk(join(dir, e.name), depth + 1, isChart || inChart)
      } else if (e.isFile() && /\.ya?ml$/i.test(e.name) && !isChart && !/^(docker-)?compose\./i.test(e.name)) {
        manifests.push(join(dir, e.name))
      }
    }
  }
  await walk(root, 0, false)
  return { manifests, charts }
}

function docsOf(text: string, file: string): Doc[] {
  if (text.includes('{{')) return [] // templated, not plain YAML
  let raw: unknown[]
  try {
    raw = yaml.loadAll(text)
  } catch {
    return []
  }
  const out: Doc[] = []
  const take = (d: any): void => {
    if (!d || typeof d !== 'object') return
    if (d.kind === 'List' && Array.isArray(d.items)) return d.items.forEach(take)
    if (typeof d.apiVersion !== 'string' || typeof d.kind !== 'string') return
    const name = d.metadata?.name
    if (typeof name !== 'string' || !name) return
    out.push({ kind: d.kind, name, namespace: typeof d.metadata?.namespace === 'string' ? d.metadata.namespace : undefined, body: d, file })
  }
  raw.forEach(take)
  return out
}

/** The pod spec of any workload kind. */
function podSpec(d: Doc): any {
  const b = d.body
  if (d.kind === 'Pod') return b.spec
  if (d.kind === 'CronJob') return b.spec?.jobTemplate?.spec?.template?.spec
  return b.spec?.template?.spec
}

function podLabels(d: Doc): Record<string, string> {
  if (d.kind === 'Pod') return d.body.metadata?.labels ?? {}
  if (d.kind === 'CronJob') return d.body.spec?.jobTemplate?.spec?.template?.metadata?.labels ?? {}
  return d.body.spec?.template?.metadata?.labels ?? {}
}

function containers(d: Doc): any[] {
  const s = podSpec(d)
  return [...(Array.isArray(s?.containers) ? s.containers : []), ...(Array.isArray(s?.initContainers) ? s.initContainers : [])]
}

const imageRepo = (image: string): string => {
  const noDigest = image.split('@')[0]
  const lastSlash = noDigest.lastIndexOf('/')
  const colon = noDigest.lastIndexOf(':')
  return colon > lastSlash ? noDigest.slice(0, colon) : noDigest
}

/** Does a string name the given Service as a host? (api, api:80, api.ns, api.ns.svc.cluster.local) */
function namesHost(value: string, svc: string): boolean {
  const esc = svc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[/@:=,\\s"'])${esc}($|[.:/,\\s"'?])`, 'i').test(value)
}

export async function scanKubernetes(root: string, h: K8sHelpers): Promise<IRDiagram | null> {
  const { manifests, charts } = await yamlFiles(root)
  const docs: Doc[] = []
  const seen = new Set<string>()
  for (const f of manifests.sort()) {
    let text: string
    try {
      text = await readFile(f, 'utf8')
    } catch {
      continue
    }
    for (const d of docsOf(text, f)) {
      const key = `${d.kind}/${d.namespace ?? ''}/${d.name}`
      // Kustomize bases and overlays define the same object; the first one wins.
      if (seen.has(key) || seen.has(`${d.kind}//${d.name}`)) continue
      seen.add(key)
      docs.push(d)
    }
  }
  const workloads = docs.filter((d) => WORKLOAD_KINDS.has(d.kind) && containers(d).length > 0)
  if (workloads.length === 0 && charts.length === 0) return null

  const nodes: IRNode[] = []
  type Edge = { source: string; target: string; label?: string; variant?: 'dashed'; confidence?: 'declared' | 'inferred'; evidence?: string }
  const edges: Edge[] = []
  const ids = new Set<string>()
  const addNode = (n: IRNode): string => {
    let id = n.id
    let i = 2
    while (ids.has(id)) id = `${n.id}-${i++}`
    ids.add(id)
    nodes.push({ ...n, id })
    return id
  }

  /* ----------------------------- workloads ------------------------------ */
  const namespaces = [...new Set(workloads.map((w) => w.namespace ?? 'default'))].sort()
  const groupOf = new Map<string, string>()
  if (namespaces.length >= 2) {
    for (const ns of namespaces) {
      groupOf.set(ns, addNode({ id: `ns-${h.slug(ns)}`, label: `namespace ${ns}`, role: 'group', meta: { source: `namespace ${ns}` } }))
    }
  }
  // HorizontalPodAutoscalers name the workload they scale.
  const autoscaled = new Set(
    docs.filter((d) => d.kind === 'HorizontalPodAutoscaler').map((d) => String(d.body.spec?.scaleTargetRef?.name ?? '')),
  )
  const facts = (w: Doc): string[] => {
    const out: string[] = []
    const replicas = Number(w.body.spec?.replicas)
    if (Number.isFinite(replicas) && replicas > 1) out.push(`×${replicas}`)
    if (autoscaled.has(w.name)) out.push('autoscaled')
    const spec = podSpec(w)
    const pvc = (Array.isArray(spec?.volumes) ? spec.volumes : []).some((v: any) => v?.persistentVolumeClaim)
    if (pvc || (Array.isArray(w.body.spec?.volumeClaimTemplates) && w.body.spec.volumeClaimTemplates.length)) out.push('persistent')
    if (containers(w).some((c) => c?.readinessProbe || c?.livenessProbe)) out.push('health check')
    return out
  }

  const idOfWorkload = new Map<Doc, string>()
  const brandOfId = new Map<string, string | undefined>()
  for (const w of workloads) {
    const image = String(containers(w)[0]?.image ?? '')
    const cls = image ? h.classifyImage(image) : null
    const role = cls?.role ?? h.roleFromName(w.name)
    const parent = groupOf.get(w.namespace ?? 'default')
    const id = addNode({
      id: h.slug(w.name),
      label: w.name,
      sublabel: image ? `${w.kind} · ${imageRepo(image)}` : w.kind,
      role,
      ...(cls?.brand ? { brand: cls.brand } : {}),
      ...(parent ? { parent } : {}),
      meta: { source: `${rel(root, w.file)}#${w.kind}/${w.name}`, ...(facts(w).length ? { [FACTS]: facts(w).join(FACT_SEP) } : {}) },
    })
    idOfWorkload.set(w, id)
    brandOfId.set(id, cls?.brand)
  }

  /* ------------------- services → the workloads they select -------------- */
  const services = docs.filter((d) => d.kind === 'Service')
  let internetId: string | null = null
  const internet = (): string =>
    (internetId ??= addNode({ id: 'internet', label: 'Internet', sublabel: 'users and clients', role: 'external', meta: { source: 'Ingress and LoadBalancer services' } }))
  const targetsOf = new Map<string, string[]>() // service name → node ids
  for (const s of services) {
    const sel: Record<string, string> = s.body.spec?.selector ?? {}
    const keys = Object.keys(sel)
    let picked: string[] = []
    if (keys.length) {
      picked = workloads
        .filter((w) => (w.namespace ?? 'default') === (s.namespace ?? 'default') || !s.namespace || !w.namespace)
        .filter((w) => keys.every((k) => podLabels(w)[k] === sel[k]))
        .map((w) => idOfWorkload.get(w)!)
    }
    if (picked.length === 0 && s.body.spec?.type === 'ExternalName') {
      const ext = String(s.body.spec.externalName ?? s.name)
      picked = [addNode({ id: h.slug(`ext-${s.name}`), label: s.name, sublabel: `external · ${ext}`, role: 'external', meta: { source: `${rel(root, s.file)}#Service/${s.name}` } })]
    }
    if (picked.length) targetsOf.set(s.name, [...(targetsOf.get(s.name) ?? []), ...picked])
    // Exposed outside the cluster without an ingress.
    const type = s.body.spec?.type
    if (picked.length && (type === 'LoadBalancer' || type === 'NodePort')) {
      const port = Number(s.body.spec?.ports?.[0]?.port)
      const label = Number.isFinite(port) && port > 0 ? `${webProto(port)} :${port}` : type
      for (const t of picked) edges.push({ source: internet(), target: t, label, confidence: 'declared', evidence: `${rel(root, s.file)}: Service ${s.name} is type ${type}` })
    }
  }

  /* -------------------------------- ingress ----------------------------- */
  for (const ing of docs.filter((d) => d.kind === 'Ingress' || d.kind === 'Route' || d.kind === 'HTTPRoute')) {
    const backends = new Map<string, string>() // service → the path it serves
    const spec = ing.body.spec ?? {}
    const collect = (b: any, path?: string): void => {
      const name = b?.service?.name ?? b?.serviceName ?? b?.name
      if (typeof name === 'string' && !backends.has(name)) backends.set(name, path ?? '')
    }
    collect(spec.defaultBackend)
    collect(spec.backend)
    for (const r of Array.isArray(spec.rules) ? spec.rules : []) {
      for (const p of Array.isArray(r?.http?.paths) ? r.http.paths : []) collect(p?.backend, typeof p?.path === 'string' ? p.path : undefined)
      const match = r?.matches?.[0]?.path?.value // Gateway API
      for (const b of Array.isArray(r?.backendRefs) ? r.backendRefs : []) collect(b, typeof match === 'string' ? match : undefined)
    }
    if (ing.kind === 'Route') collect(spec.to) // OpenShift
    const targets = [...backends].flatMap(([b, path]) => (targetsOf.get(b) ?? []).map((t) => ({ t, path, svc: b })))
    if (targets.length === 0) continue
    const tls = Array.isArray(spec.tls) && spec.tls.length > 0
    const host = Array.isArray(spec.rules) ? spec.rules.find((r: any) => typeof r?.host === 'string')?.host : undefined
    const hosts = Array.isArray(spec.hostnames) ? spec.hostnames[0] : undefined
    const parent = groupOf.get(ing.namespace ?? 'default')
    const id = addNode({
      id: h.slug(`ingress-${ing.name}`),
      label: ing.name,
      sublabel: `${ing.kind}${host ?? hosts ? ` · ${host ?? hosts}` : ''}`,
      role: 'cloud',
      ...(parent ? { parent } : {}),
      meta: { source: `${rel(root, ing.file)}#${ing.kind}/${ing.name}` },
    })
    const where = `${rel(root, ing.file)}: ${ing.kind} ${ing.name}`
    edges.push({ source: internet(), target: id, label: tls ? 'HTTPS' : 'HTTP', confidence: 'declared', evidence: `${where}${host ?? hosts ? ` serves ${host ?? hosts}` : ''}` })
    for (const { t, path, svc } of targets) {
      edges.push({ source: id, target: t, label: path && path !== '/' ? path : 'routes', confidence: 'declared', evidence: `${where} sends ${path || '/'} to Service ${svc}` })
    }
  }

  /* -------------- env / ConfigMaps naming another Service ---------------- */
  const configMaps = new Map(docs.filter((d) => d.kind === 'ConfigMap').map((d) => [d.name, Object.values(d.body.data ?? {}).map(String)]))
  for (const w of workloads) {
    const from = idOfWorkload.get(w)!
    const values: [string, string][] = [] // [where it was written, value]
    for (const c of containers(w)) {
      for (const e of Array.isArray(c.env) ? c.env : []) if (typeof e?.value === 'string') values.push([`env ${e.name}`, e.value])
      for (const ef of Array.isArray(c.envFrom) ? c.envFrom : []) {
        const cm = ef?.configMapRef?.name
        if (typeof cm === 'string') for (const v of configMaps.get(cm) ?? []) values.push([`ConfigMap ${cm}`, v])
      }
      for (const a of [...(Array.isArray(c.args) ? c.args : []), ...(Array.isArray(c.command) ? c.command : [])]) values.push(['args', String(a)])
    }
    for (const [svc, targets] of targetsOf) {
      let wire: Wire | null = null
      const where = new Set<string>()
      for (const [key, v] of values) {
        if (!namesHost(v, svc)) continue
        wire = mergeWire(wire, wireTo(v, svc) ?? {})
        where.add(key)
      }
      if (!wire) continue
      const evidence = `${rel(root, w.file)}: ${[...where].slice(0, 3).join(', ')} of ${w.kind} ${w.name} names Service ${svc}`
      for (const t of targets) if (t !== from) edges.push({ source: from, target: t, label: wireLabel(wire, brandOfId.get(t), 'uses'), confidence: 'inferred', evidence })
    }
  }

  /* --------------------------------- helm -------------------------------- */
  const chartIds = new Map<string, string>() // chart dir → node id
  const chartNames = new Map<string, string>() // chart name → node id
  for (const dir of charts.sort()) {
    let chart: any
    try {
      chart = yaml.load(await readFile(join(dir, 'Chart.yaml'), 'utf8'))
    } catch {
      continue
    }
    if (!chart || typeof chart !== 'object' || chart.type === 'library') continue
    let values: any = null
    try {
      values = yaml.load(await readFile(join(dir, 'values.yaml'), 'utf8'))
    } catch {
      /* no values */
    }
    const name = String(chart.name ?? basename(dir))
    const repo = typeof values?.image?.repository === 'string' ? values.image.repository : typeof values?.image === 'string' ? values.image : undefined
    const cls = repo ? h.classifyImage(repo) : h.classifyImage(name)
    const id = addNode({
      id: h.slug(name),
      label: name,
      sublabel: `Helm chart${repo ? ` · ${imageRepo(repo)}` : ''}`,
      role: cls?.role ?? h.roleFromName(name),
      ...(cls?.brand ? { brand: cls.brand } : {}),
      meta: { source: `${rel(root, dir)}/Chart.yaml` },
    })
    chartIds.set(dir, id)
    chartNames.set(name, id)
  }
  for (const dir of charts) {
    const from = chartIds.get(dir)
    if (!from) continue
    let chart: any
    try {
      chart = yaml.load(await readFile(join(dir, 'Chart.yaml'), 'utf8'))
    } catch {
      continue
    }
    for (const dep of Array.isArray(chart?.dependencies) ? chart.dependencies : []) {
      const depName = String(dep?.alias ?? dep?.name ?? '')
      if (!depName) continue
      let to = chartNames.get(String(dep.name)) ?? chartNames.get(depName)
      if (!to) {
        const cls = h.classifyImage(String(dep.name))
        const repo = typeof dep.repository === 'string' ? dep.repository.replace(/^https?:\/\//, '').replace(/\/$/, '') : ''
        to = addNode({
          id: h.slug(depName),
          label: depName,
          sublabel: `Helm dependency${repo && !repo.startsWith('file:') ? ` · ${repo}` : ''}`,
          role: cls?.role ?? h.roleFromName(depName),
          ...(cls?.brand ? { brand: cls.brand } : {}),
          meta: { source: `${rel(root, dir)}/Chart.yaml#dependencies.${depName}` },
        })
        chartNames.set(depName, to)
      }
      if (to !== from) edges.push({ source: from, target: to, label: 'depends on', confidence: 'declared', evidence: `${rel(root, dir)}/Chart.yaml: dependency ${depName}` })
    }
    // An umbrella chart's own sub-charts (charts/<name>/) are its parts.
    for (const [sub, subId] of chartIds) {
      if (sub !== dir && dirname(sub) === join(dir, 'charts')) {
        edges.push({ source: from, target: subId, label: 'depends on', confidence: 'declared', evidence: `${rel(root, sub)}: sub-chart of ${rel(root, dir)}` })
      }
    }
  }

  // De-duplicate edges with the scanner's deterministic ids.
  const out = new Map<string, Edge & { id: string }>()
  for (const e of edges) {
    const id = `${e.source}->${e.target}`
    if (e.source === e.target || out.has(id)) continue
    out.set(id, {
      id,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      ...(e.variant ? { variant: e.variant } : {}),
      ...(e.confidence ? { confidence: e.confidence } : {}),
      ...(e.evidence ? { evidence: e.evidence } : {}),
    })
  }

  const parts: string[] = []
  if (workloads.length) parts.push(`${workloads.length} Kubernetes workload${workloads.length === 1 ? '' : 's'}`)
  if (chartIds.size) parts.push(`${chartIds.size} Helm chart${chartIds.size === 1 ? '' : 's'}`)
  return {
    id: h.slug(basename(root)),
    title: basename(root),
    subtitle: `Mapped from ${parts.join(' and ')}`,
    type: 'architecture',
    direction: 'RIGHT',
    nodes,
    edges: [...out.values()],
  }
}
