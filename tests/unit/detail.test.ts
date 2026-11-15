import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { scanRepository } from '../../src/main/repo-scan'
import { publishedPorts, wireLabel, wireTo } from '../../src/main/scan/wire'
import { nodeFacts } from '../../src/shared/facts'
import { brandIcon } from '../../src/shared/brand-icons'
import { diagramToSvg } from '../../src/renderer/src/export/svg'
import { layoutDiagram } from '../../src/renderer/src/layout'
import type { IRDiagram } from '../../src/shared/ir'

const FIX = resolve(__dirname, '../fixtures/repos')
const scan = (name: string): Promise<IRDiagram> => scanRepository(join(FIX, name))
const label = (d: IRDiagram, s: string, t: string) => d.edges.find((e) => e.source === s && e.target === t)?.label
const facts = (d: IRDiagram, id: string) => nodeFacts(d.nodes.find((n) => n.id === id)!)

describe('how parts talk: protocols and ports from the configuration', () => {
  it('reads scheme and port from connection strings', () => {
    expect(wireTo('postgres://app:secret@db:5432/app', 'db')).toEqual({ proto: 'SQL', port: 5432 })
    expect(wireTo('jdbc:postgresql://db/app', 'db')).toEqual({ proto: 'SQL' })
    expect(wireTo('http://api.default.svc.cluster.local:8080/v1', 'api')).toEqual({ proto: 'HTTP', port: 8080 })
    expect(wireTo('amqp://guest:guest@queue:5672', 'queue')).toEqual({ proto: 'AMQP', port: 5672 })
    expect(wireTo('cache', 'cache')).toEqual({})
    expect(wireTo('redis_url_unset', 'redis')).toBeNull()
    expect(wireTo('http://myapi:80', 'api')).toBeNull()
  })

  it('labels a link with what it knows, most specific first', () => {
    expect(wireLabel({ proto: 'HTTP', port: 8080 }, undefined, 'uses')).toBe('HTTP :8080')
    expect(wireLabel({}, 'redis', 'uses')).toBe('Redis :6379')
    expect(wireLabel({ port: 6380 }, 'redis', 'uses')).toBe('Redis :6380')
    expect(wireLabel(null, undefined, 'depends on')).toBe('depends on')
  })

  it('reads published compose ports in every syntax', () => {
    expect(publishedPorts(['8080:80', '443', '127.0.0.1:9000:9000/tcp', { target: 3000, published: 3001 }])).toEqual([8080, 443, 9000, 3001])
    expect(publishedPorts(undefined)).toEqual([])
  })

  it('compose: traffic from the Internet, protocols on links, facts on boxes', async () => {
    const d = await scan('compose-rich')
    expect(d.nodes.find((n) => n.id === 'internet')).toMatchObject({ role: 'external', label: 'Internet' })
    expect(label(d, 'internet', 'gateway')).toBe('HTTPS :443')
    expect(label(d, 'internet', 'web')).toBe('HTTP :3000')
    expect(label(d, 'internet', 'db')).toBeUndefined() // a database's dev port isn't a public entry
    expect(label(d, 'web', 'api')).toBe('HTTP :8080')
    expect(label(d, 'api', 'db')).toBe('SQL :5432')
    expect(label(d, 'api', 'search')).toBe('HTTP :9200')
    expect(label(d, 'api', 'events')).toBe('Kafka :9092')
    expect(facts(d, 'api')).toEqual(['×3', 'health check'])
    expect(facts(d, 'db')).toEqual(['persistent', 'health check']) // named volume; ./api:/app is not
  })

  it('Kubernetes: replicas, autoscaling, persistent volumes and probes', async () => {
    const d = await scan('k8s-basic')
    expect(facts(d, 'api-server')).toEqual(['×3', 'autoscaled', 'health check'])
    expect(facts(d, 'postgres')).toEqual(['persistent'])
    expect(facts(d, 'web')).toEqual([])
  })
})

describe('drawing the detail', () => {
  it('SVG export draws fact tags and real brand logos', async () => {
    const d = await scan('compose-rich')
    const { svg } = diagramToSvg(d, await layoutDiagram(d), 'light')
    expect(svg).toContain('data-fact="×3"')
    expect(svg).toContain('data-fact="persistent"')
    expect(svg).toContain(`data-brand="postgresql" d="${brandIcon('postgresql')!.path}"`)
    expect(svg).toContain('data-brand="traefikproxy"')
  })

  it('has logos for the infrastructure the scanner recognises', () => {
    for (const b of ['postgresql', 'mysql', 'mongodb', 'redis', 'apachekafka', 'rabbitmq', 'elasticsearch', 'nginx', 'stripe']) {
      expect(brandIcon(b)?.path, b).toMatch(/^M/)
    }
    expect(brandIcon('not-a-brand')).toBeUndefined()
  })
})

describe('edge confidence and evidence', () => {
  const e = (d: IRDiagram, s: string, t: string) => d.edges.find((x) => x.source === s && x.target === t)!

  it('compose: depends_on is declared (with the env var that also names it); env-only links are inferred', async () => {
    const basic = await scan('compose-basic')
    expect(e(basic, 'api', 'db')).toMatchObject({ confidence: 'declared', evidence: 'docker-compose.yml: services.api.depends_on; DATABASE_URL names db' })
    expect(e(basic, 'worker', 'queue')).toMatchObject({ confidence: 'declared', evidence: 'docker-compose.yml: services.worker.links; AMQP_URL names queue' })
    const rich = await scan('compose-rich')
    expect(e(rich, 'api', 'db')).toMatchObject({ confidence: 'inferred', evidence: 'docker-compose.yml: DATABASE_URL names db in services.api' })
    expect(e(rich, 'internet', 'gateway')).toMatchObject({ confidence: 'declared', evidence: 'docker-compose.yml: services.gateway.ports publishes 443, 80' })
  })

  it('Kubernetes: Ingress routes are declared, env and ConfigMap references inferred', async () => {
    const d = await scan('k8s-basic')
    expect(e(d, 'ingress-public', 'api-server')).toMatchObject({ confidence: 'declared', evidence: 'k8s/base/ingress.yaml: Ingress public sends /api to Service api' })
    expect(e(d, 'api-server', 'postgres')).toMatchObject({ confidence: 'inferred' })
    expect(e(d, 'api-server', 'postgres').evidence).toContain('ConfigMap api-config')
  })

  it('manifests and imports: module links declared, libraries implying infrastructure inferred', async () => {
    const mono = await scan('npm-workspaces')
    expect(e(mono, 'acme-api', 'acme-db')).toMatchObject({ confidence: 'declared', evidence: 'apps/api/package.json depends on @acme/db' })
    expect(e(mono, 'acme-api', 'redis')).toMatchObject({ confidence: 'inferred', evidence: 'apps/api/package.json has a Redis client library' })
    const ts = await scan('ts-components')
    const imp = ts.edges.find((x) => x.label?.endsWith('import') || x.label?.endsWith('imports'))
    if (imp) expect(imp.evidence).toMatch(/import statements?, e\.g\. src\/.+ imports src\//)
  })

  it('Terraform: direct references declared, connectors named in the evidence', async () => {
    const d = await scan('terraform-aws')
    expect(e(d, 'orders-lambda', 'orders-dynamodb')).toMatchObject({ confidence: 'declared', evidence: 'main.tf: aws_lambda_function.orders references aws_dynamodb_table.orders' })
    expect(e(d, 'orders-lambda', 'orders-dynamodb').variant).toBeUndefined()
    expect(e(d, 'events-sqs-queue', 'mailer-lambda').evidence).toBe('data.tf: aws_lambda_event_source_mapping.mailer connects them')
  })

  it('survives a save and reload; invalid values are dropped', async () => {
    const { parseProject, serializeProject } = await import('../../src/shared/serialize')
    const d = await scan('compose-rich')
    const back = parseProject(serializeProject({ schema_version: 1, diagram: d, layout: {} })).value.diagram
    expect(back.edges).toEqual(d.edges)
    const bad = parseProject(JSON.stringify({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b', confidence: 'certain', evidence: 'x'.repeat(5000) }] })).value.diagram
    expect(bad.edges[0].confidence).toBeUndefined()
    expect(bad.edges[0].evidence).toHaveLength(500)
  })

  it('the SVG marks inferred labels italic and carries the evidence', async () => {
    const d = await scan('compose-rich')
    const { svg } = diagramToSvg(d, await layoutDiagram(d), 'light')
    expect(svg).toContain('font-style="italic"')
    expect(svg).toContain('<title>docker-compose.yml: DATABASE_URL names db in services.api</title>')
    expect(svg).toContain('italic label: inferred, not declared')
  })
})
