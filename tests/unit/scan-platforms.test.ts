import { describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { MAX_NODES, folderOfSource, scanRepository } from '../../src/main/repo-scan'
import { kindOf, parseTf, referencesIn } from '../../src/main/scan/terraform'
import { parseCsproj, parseGradleBuild, parseGradleSettings, parsePom, parseSln } from '../../src/main/scan/jvm-dotnet'
import { sanitizeDiagram } from '../../src/shared/serialize'
import { visibleCount, visibleDiagram } from '../../src/shared/collapse'
import type { IRDiagram } from '../../src/shared/ir'

const FIX = resolve(__dirname, '../fixtures/repos')
const scan = (name: string): Promise<IRDiagram> => scanRepository(join(FIX, name))
const node = (d: IRDiagram, id: string) => d.nodes.find((n) => n.id === id)
const edge = (d: IRDiagram, s: string, t: string) => d.edges.find((e) => e.source === s && e.target === t)

function expectClean(d: IRDiagram): void {
  expect(sanitizeDiagram(d).fixes).toEqual([])
  for (const n of d.nodes) expect(n.meta?.source, `provenance for ${n.id}`).toBeTruthy()
  for (const e of d.edges) expect(e.id).toBe(`${e.source}->${e.target}`)
}

describe('Kubernetes manifests', () => {
  it('maps workloads, services, ingress, env and ConfigMap references', async () => {
    const d = await scan('k8s-basic')
    expectClean(d)
    expect(d.subtitle).toBe('Mapped from 5 Kubernetes workloads')
    expect(node(d, 'web')).toMatchObject({ role: 'frontend', sublabel: 'Deployment · ghcr.io/acme/web' })
    expect(node(d, 'postgres')).toMatchObject({ role: 'database', brand: 'postgresql', sublabel: 'StatefulSet · postgres' })
    expect(node(d, 'redis')).toMatchObject({ role: 'cache' })
    expect(node(d, 'nightly-report')).toMatchObject({ sublabel: 'CronJob · ghcr.io/acme/report' })
    expect(node(d, 'ext-payments')).toMatchObject({ role: 'external', sublabel: 'external · api.stripe.com' })
    expect(node(d, 'ingress-public')).toMatchObject({ role: 'cloud', sublabel: 'Ingress · shop.example.com' })
    // Ingress routes to the workloads behind each Service (selector match, not name).
    expect(edge(d, 'ingress-public', 'web')?.label).toBe('routes')
    expect(edge(d, 'ingress-public', 'api-server')?.label).toBe('/api')
    expect(edge(d, 'internet', 'ingress-public')?.label).toBe('HTTP')
    expect(node(d, 'internet')).toMatchObject({ role: 'external', label: 'Internet' })
    // env value, ConfigMap value with a cluster DNS name, and args, labelled with how they talk
    expect(edge(d, 'web', 'api-server')).toMatchObject({ label: 'HTTP :8080' })
    expect(edge(d, 'api-server', 'postgres')?.label).toBe('SQL :5432')
    expect(edge(d, 'api-server', 'redis')?.label).toBe('Redis :6379')
    expect(edge(d, 'nightly-report', 'postgres')?.label).toBe('SQL :5432')
    expect(edge(d, 'nightly-report', 'ext-payments')?.label).toBe('HTTPS')
  })

  it('takes kustomize overlays once and ignores non-Kubernetes YAML', async () => {
    const d = await scan('k8s-basic')
    expect(d.nodes.filter((n) => n.label === 'web')).toHaveLength(1)
    expect(d.nodes.some((n) => n.id === 'ci')).toBe(false)
  })

  it('reads Helm charts from Chart.yaml and values.yaml, never the templates', async () => {
    const d = await scan('helm-umbrella')
    expectClean(d)
    expect(d.subtitle).toBe('Mapped from 2 Helm charts')
    expect(node(d, 'api')).toMatchObject({ sublabel: 'Helm chart · ghcr.io/acme/shop-api' })
    expect(node(d, 'postgresql')).toMatchObject({ role: 'database', sublabel: 'Helm dependency · charts.bitnami.com/bitnami' })
    expect(node(d, 'redis')).toMatchObject({ role: 'cache' })
    expect(edge(d, 'shop', 'postgresql')).toBeTruthy()
    expect(edge(d, 'shop', 'api')).toBeTruthy()
    expect(d.edges).toHaveLength(3)
  })
})

describe('Terraform', () => {
  it('maps resources that are parts of a system, with references through plumbing', async () => {
    const d = await scan('terraform-aws')
    expectClean(d)
    expect(d.subtitle).toContain('Terraform: 7 resources and modules in 3 files')
    expect(node(d, 'orders-lambda')).toMatchObject({ label: 'orders-handler', role: 'backend', sublabel: 'Lambda' })
    expect(node(d, 'orders-dynamodb')).toMatchObject({ role: 'database' })
    expect(node(d, 'events-sqs-queue')).toMatchObject({ role: 'queue', label: 'order-events' })
    expect(node(d, 'module-network')).toMatchObject({ role: 'service', sublabel: 'module · ./modules/network' })
    // IAM roles, VPCs, data sources and .terraform/ are not boxes
    expect(d.nodes.some((n) => /iam|vpc|caller|should_not/.test(n.id))).toBe(false)
    expect(edge(d, 'orders-lambda', 'orders-dynamodb')).toBeTruthy()
    expect(edge(d, 'orders-lambda', 'events-sqs-queue')).toBeTruthy()
    expect(edge(d, 'events-sqs-queue', 'mailer-lambda')?.label).toBe('triggers')
    expect(edge(d, 'http-api-gateway', 'orders-lambda')?.label).toBe('routes')
  })

  it('adds Terraform to an app map as its own group', async () => {
    const d = await scan('app-plus-terraform')
    expectClean(d)
    expect(d.subtitle).toContain('plus 1 Terraform resource')
    expect(node(d, 'infrastructure')).toMatchObject({ role: 'group', label: 'Infrastructure (Terraform)' })
    expect(node(d, 'main-rds')).toMatchObject({ parent: 'infrastructure', label: 'shop-db', role: 'database' })
    expect(node(d, 'app')).toBeTruthy()
  })

  it('finds blocks by brace matching, skipping strings, comments and heredocs', () => {
    const tf = `
# resource "aws_sqs_queue" "commented" {}
resource "aws_sqs_queue" "a" {
  name = "a-{not a brace}"
  policy = <<POLICY
{ "x": { } }
POLICY
  tags = { team = "x" } // }
}
module "m" { source = "./m" }
resource "aws_lambda_function" "f" { environment { variables = { Q = aws_sqs_queue.a.url, M = module.m.out } } }
`
    const blocks = parseTf(tf, 'main.tf')
    expect(blocks.map((b) => `${b.kind}:${b.type}.${b.name}`)).toEqual(['resource:aws_sqs_queue.a', 'module:module.m', 'resource:aws_lambda_function.f'])
    expect(referencesIn(blocks[2].body).sort()).toEqual(['aws_sqs_queue.a', 'module.m'])
  })

  it('classifies resource types, including prefix families', () => {
    expect(kindOf('aws_db_instance')?.role).toBe('database')
    expect(kindOf('azurerm_linux_web_app')?.label).toBe('App Service')
    expect(kindOf('azurerm_postgresql_flexible_server')?.role).toBe('database')
    expect(kindOf('aws_iam_role')).toBeNull()
  })
})

describe('JVM and .NET', () => {
  it('maps a Maven multi-module build, descending through aggregators', async () => {
    const d = await scan('maven-multi')
    expectClean(d)
    expect(d.nodes.map((n) => n.id).sort()).toEqual(['kafka', 'postgresql', 'redis', 'shop-api', 'shop-core', 'shop-worker'])
    expect(node(d, 'shop-api')).toMatchObject({ sublabel: 'Spring Boot · services/shop-api', role: 'backend' })
    expect(edge(d, 'shop-api', 'shop-core')).toBeTruthy()
    expect(edge(d, 'shop-worker', 'kafka')).toBeTruthy()
    expect(edge(d, 'shop-api', 'redis')).toBeTruthy()
  })

  it('maps a Gradle multi-project build with project() and type-safe accessors', async () => {
    const d = await scan('gradle-multi')
    expectClean(d)
    expect(node(d, 'app')).toMatchObject({ sublabel: 'Ktor · app' })
    // app -> domain is implied by app -> adapters:billing -> domain, so it isn't drawn
    expect(edge(d, 'app', 'domain')).toBeUndefined()
    expect(edge(d, 'adapters-billing', 'domain')).toBeTruthy()
    // nested modules keep their full path, so feature:a:api and feature:b:api can't collide
    expect(node(d, 'adapters-billing')).toMatchObject({ label: 'adapters:billing' })
    expect(edge(d, 'app', 'adapters-billing')).toBeTruthy()
    expect(edge(d, 'adapters-billing', 'stripe')).toBeTruthy()
    expect(edge(d, 'app', 'postgresql')).toBeTruthy()
  })

  it('maps a .NET solution, skipping test projects', async () => {
    const d = await scan('dotnet-sln')
    expectClean(d)
    expect(node(d, 'shop-api')).toMatchObject({ label: 'Shop.Api', sublabel: 'ASP.NET Core · src/Shop.Api' })
    expect(node(d, 'shop-worker')).toMatchObject({ sublabel: '.NET worker · src/Shop.Worker' })
    expect(d.nodes.some((n) => /tests/i.test(n.id))).toBe(false)
    expect(edge(d, 'shop-api', 'shop-core')).toBeTruthy()
    expect(edge(d, 'shop-api', 'postgresql')).toBeTruthy()
    expect(edge(d, 'shop-worker', 'rabbitmq')).toBeTruthy()
    expect(edge(d, 'shop-worker', 'aws')).toBeTruthy()
  })

  it('parses manifests', () => {
    const pom = parsePom(`<project><parent><artifactId>p</artifactId></parent><artifactId>me</artifactId><packaging>pom</packaging>
      <modules><module>a</module></modules><dependencyManagement><dependencies><dependency><groupId>g</groupId><artifactId>pinned</artifactId></dependency></dependencies></dependencyManagement></project>`)
    expect(pom).toMatchObject({ name: 'me', modules: ['a'], aggregator: true })
    expect(pom.deps.has('pinned')).toBe(false)

    const gb = parseGradleBuild(`dependencies {\n  // implementation("x:commented:1")\n  implementation 'org.a:lib-a:1.0'\n  api(platform("org.b:bom:2"))\n  implementation group: 'org.c', name: 'lib-c', version: '3'\n  implementation(project(path: ":core"))\n}`)
    expect([...gb.deps].sort()).toEqual(['bom', 'core', 'lib-a', 'lib-c', 'org.a:lib-a', 'org.b:bom', 'org.c:lib-c'])

    expect(parseGradleSettings(`rootProject.name = 'x'\ninclude 'a', ':b:c'`)).toEqual({ name: 'x', modules: ['a', 'b/c'] })
    const cs = parseCsproj(`<Project Sdk="Microsoft.NET.Sdk.Web"><PackageReference Include="Npgsql" /><ProjectReference Include="..\\Core\\Core.csproj" /></Project>`, 'Api.csproj')
    expect(cs).toMatchObject({ name: 'Api', sdk: 'Microsoft.NET.Sdk.Web', isTest: false })
    expect([...cs.deps].sort()).toEqual(['Core', 'Npgsql'])
    expect(parseCsproj('<Project Sdk="Microsoft.NET.Sdk"><PackageReference Include="xunit" /></Project>', 'Api.Tests.csproj').isTest).toBe(true)
    expect(parseSln('Project("{X}") = "Api", "src\\Api\\Api.csproj", "{1}"\nProject("{Y}") = "src", "src", "{2}"')).toEqual(['src/Api/Api.csproj'])
  })
})

describe('drill-down instead of a hard cap', () => {
  it('groups a big repo by folder and collapses the largest groups, keeping every part', async () => {
    const dir = resolve(__dirname, '../.tmp/huge-workspace')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'huge', workspaces: ['apps/*', 'libs/*', 'tools/*'] }))
    const spec: [string, number][] = [['apps', 30], ['libs', 70], ['tools', 20]]
    for (const [folder, count] of spec) {
      for (let i = 0; i < count; i++) {
        const pdir = join(dir, folder, `${folder}-${i}`)
        await mkdir(pdir, { recursive: true })
        const deps = folder === 'libs' ? {} : { [`libs-${i % 70}`]: '*' }
        await writeFile(join(pdir, 'package.json'), JSON.stringify({ name: `${folder}-${i}`, dependencies: deps }))
      }
    }
    const d = await scanRepository(dir)
    expectClean(d)
    expect(d.nodes.filter((n) => n.role !== 'group')).toHaveLength(120) // nothing dropped
    expect(visibleCount(d)).toBeLessThanOrEqual(MAX_NODES)
    expect(node(d, 'group-libs')?.collapsed).toBe(true)
    expect(d.subtitle).toMatch(/collapsed, double-click to open/)
    // the collapsed group stands in for its members' edges
    const v = visibleDiagram(d)
    expect(v.edges.some((e) => e.target === 'group-libs')).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('finds the folder a node came from', () => {
    expect(folderOfSource('services/api/package.json')).toBe('services/api')
    expect(folderOfSource('src/Shop.Api/Shop.Api.csproj')).toBe('src/Shop.Api')
    expect(folderOfSource('src/renderer/src/ui')).toBe('src/renderer/src/ui')
    expect(folderOfSource('k8s/base/web.yaml#Deployment/web')).toBe('k8s/base')
    expect(folderOfSource('package.json dependencies')).toBeNull()
    expect(folderOfSource('.')).toBeNull()
  })
})

describe('scan warnings', () => {
  it('reports a malformed compose file, unreadable workspace packages and oversized sources', async () => {
    const { scanRepositoryWithReport } = await import('../../src/main/repo-scan')
    const malformed = await scanRepositoryWithReport(join(FIX, 'compose-malformed'))
    expect(malformed.warnings.some((w) => /docker-compose\.yml isn't valid YAML .*mapped from the rest/.test(w))).toBe(true)

    const dir = resolve(__dirname, '../.tmp/warn-repo')
    await rm(dir, { recursive: true, force: true })
    await mkdir(join(dir, 'packages/ok'), { recursive: true })
    await mkdir(join(dir, 'packages/broken'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'w', workspaces: ['packages/*'] }))
    await writeFile(join(dir, 'packages/ok/package.json'), JSON.stringify({ name: 'ok' }))
    await writeFile(join(dir, 'packages/broken/package.json'), '{ not json')
    const ws = await scanRepositoryWithReport(dir)
    expect(ws.warnings).toEqual(['1 workspace packages skipped (package.json unreadable or without a name), e.g. packages/broken/package.json'])

    await rm(dir, { recursive: true, force: true })
    await mkdir(join(dir, 'src/a'), { recursive: true })
    await mkdir(join(dir, 'src/b'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'big' }))
    await writeFile(join(dir, 'src/a/index.ts'), "import { b } from '../b'\n")
    await writeFile(join(dir, 'src/b/index.ts'), 'export const b = 1\n')
    await writeFile(join(dir, 'src/b/bundle.js'), '// ' + 'x'.repeat(600 * 1024))
    const big = await scanRepositoryWithReport(dir)
    expect(big.warnings).toEqual(['1 source files over 512 KB skipped (usually generated or bundled code), e.g. src/b/bundle.js'])
    await rm(dir, { recursive: true, force: true })
  })

  it('a clean repository has no warnings, and concurrent scans keep their own', async () => {
    const { scanRepositoryWithReport } = await import('../../src/main/repo-scan')
    const [clean, bad] = await Promise.all([scanRepositoryWithReport(join(FIX, 'compose-basic')), scanRepositoryWithReport(join(FIX, 'compose-malformed'))])
    expect(clean.warnings).toEqual([])
    expect(bad.warnings.length).toBeGreaterThan(0)
  })
})

/**
 * Patterns found by scanning real open-source repositories (spring-petclinic-
 * microservices, full-stack-fastapi-template, excalidraw, nowinandroid, eShop),
 * reproduced as small fixtures so they stay fixed.
 */
describe('patterns from real repositories', () => {
  it('a dev compose that publishes every port: only the gateway is the way in; monitoring is a service', async () => {
    const d = await scan('compose-dev-ports')
    expectClean(d)
    expect(d.edges.filter((e) => e.source === 'internet').map((e) => e.target)).toEqual(['api-gateway'])
    expect(node(d, 'grafana-server')?.role).toBe('service')
    expect(node(d, 'prometheus-server')).toMatchObject({ role: 'service', brand: 'prometheus' })
  })

  it('compose: Traefik routes from labels, the override file merged, test runners left out', async () => {
    const d = await scan('compose-traefik')
    expectClean(d)
    expect(edge(d, 'proxy', 'backend')).toMatchObject({ label: 'api.localhost /api', confidence: 'declared' })
    expect(edge(d, 'proxy', 'adminer')?.label).toBe('adminer.<DOMAIN>')
    expect(edge(d, 'proxy', 'frontend')?.label).toBe('dashboard.localhost') // service from compose.override.yml
    expect(edge(d, 'internet', 'proxy')?.label).toBe('HTTP :80') // ports from the override
    expect(node(d, 'playwright')).toBeUndefined()
  })

  it('a one-service compose file does not hide a workspace monorepo; examples are not parts', async () => {
    const d = await scan('compose-single-monorepo')
    expectClean(d)
    expect(d.subtitle).toMatch(/^Monorepo, 3 packages/)
    expect(d.nodes.map((n) => n.id).sort()).toEqual(['app', 'mono-core', 'mono-utils'])
  })

  it('Gradle: modules from settings.gradle (3 levels deep), full paths, no test or tooling modules', async () => {
    const d = await scan('gradle-deep')
    expectClean(d)
    expect(d.nodes.map((n) => n.label).sort()).toEqual(['app', 'core:data', 'feature:foryou:api', 'feature:foryou:impl', 'feature:topic:api', 'feature:topic:impl'])
    expect(edge(d, 'feature-foryou-impl', 'feature-topic-api')).toBeTruthy() // api/impl names don't collide
    expect(edge(d, 'app', 'feature-foryou-impl')).toBeTruthy()
  })

  it('.NET Aspire packages count as the infrastructure they provision or connect to', async () => {
    const d = await scan('dotnet-aspire')
    expectClean(d)
    expect(edge(d, 'basket-api', 'redis')).toBeTruthy()
    expect(edge(d, 'basket-api', 'rabbitmq')).toBeTruthy()
    expect(edge(d, 'apphost', 'postgresql')).toBeTruthy()
  })
})

describe('readable code-structure maps', () => {
  async function workspace(name: string, deps: Record<string, string[]>): Promise<IRDiagram> {
    const dir = resolve(__dirname, `../.tmp/${name}`)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, workspaces: ['packages/*'] }))
    for (const [pkg, uses] of Object.entries(deps)) {
      await mkdir(join(dir, 'packages', pkg), { recursive: true })
      await writeFile(join(dir, 'packages', pkg, 'package.json'), JSON.stringify({ name: pkg, dependencies: Object.fromEntries(uses.map((u) => [u, '*'])) }))
    }
    return scanRepository(dir)
  }
  const links = (d: IRDiagram) => d.edges.map((e) => `${e.source}>${e.target}`).sort()

  it('hides links implied by others (app>core when app>feature>core), keeping reachability', async () => {
    const d = await workspace('reduce', { app: ['feature', 'core'], feature: ['core'], core: [] })
    expect(links(d)).toEqual(['app>feature', 'feature>core'])
    expect(d.subtitle).toContain('1 link implied by others hidden')
  })

  it('never disconnects parts in a cycle', async () => {
    // b and c depend on each other; a depends on both. a must still reach both.
    const d = await workspace('cycle', { a: ['b', 'c'], b: ['c'], c: ['b'] })
    const l = links(d)
    expect(l.filter((x) => x.startsWith('a>')).length).toBeGreaterThanOrEqual(1)
    expect(l).toContain('b>c')
    expect(l).toContain('c>b')
  })

  it('tags a shared library most parts use instead of drawing every link to it', async () => {
    const deps: Record<string, string[]> = { shared: [] }
    for (let i = 0; i < 9; i++) deps[`svc${i}`] = ['shared']
    const d = await workspace('hub', deps)
    expect(d.edges.filter((e) => e.target === 'shared')).toHaveLength(0)
    const { nodeFacts } = await import('../../src/shared/facts')
    expect(nodeFacts(node(d, 'shared')!)).toContain('used by 9 parts')
    expect(d.subtitle).toContain('shared is used by most parts')
  })

  it('runtime maps keep every link (compose, Kubernetes)', async () => {
    const d = await scan('compose-dev-ports')
    expect(edge(d, 'api-gateway', 'config-server')).toBeTruthy()
    expect(edge(d, 'customers-service', 'config-server')).toBeTruthy()
  })
})

describe('Go and Rust import graphs', () => {
  it('maps a Go module by package, from imports through the go.mod path', async () => {
    const d = await scan('go-layered')
    const edges = d.edges.map((e) => `${e.source}->${e.target}`).sort()
    expect(edges).toEqual([
      'dir-cmd-server->dir-internal-api',
      'dir-cmd-server->dir-pkg-logx',
      'dir-internal-api->dir-internal-auth',
      'dir-internal-api->dir-internal-store',
      'dir-internal-auth->dir-internal-store',
      'dir-internal-store->postgresql',
      'dir-internal-store->redis',
      'dir-root->dir-internal-api',
    ])
    // Comments, raw strings, _test.go files and testdata/ don't count.
    expect(d.edges.some((e) => e.source === 'dir-internal-api' && e.target === 'dir-pkg-logx')).toBe(false)
    expect(d.nodes.find((n) => n.id === 'dir-internal-api')?.sublabel).toMatch(/^Gin · internal\/api\//)
    expect(d.subtitle).toMatch(/6 components from imports/)
  })

  it('maps a Rust crate by top-level module, from crate:: and super:: paths', async () => {
    const d = await scan('rust-crate')
    const edges = d.edges.map((e) => `${e.source}->${e.target}:${e.label}`).sort()
    expect(edges).toEqual([
      'dir-src-db->dir-src-config:1 use',
      'dir-src-db->postgresql:SQL',
      'dir-src-handlers->dir-src-config:1 use',
      'dir-src-handlers->dir-src-db:1 use',
      'dir-src-report->dir-src-config:1 use', // through the root's `pub use config::Config`
    ])
    expect(d.subtitle).toMatch(/4 components from module paths/)
    expect(d.nodes.find((n) => n.id === 'dir-src-config')?.meta?.source).toBe('src/config.rs')
    expect(d.edges.find((e) => e.target === 'dir-src-db')?.evidence).toMatch(/^1 file uses crate::db, e\.g\. src\/handlers\/accounts\.rs uses src\/db\//)
  })
})
