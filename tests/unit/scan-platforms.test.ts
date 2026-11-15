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
    expect(edge(d, 'app', 'domain')).toBeTruthy()
    expect(edge(d, 'app', 'billing')).toBeTruthy()
    expect(edge(d, 'billing', 'stripe')).toBeTruthy()
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
