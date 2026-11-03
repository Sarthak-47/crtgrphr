import { describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  MAX_NODES,
  classifyImage,
  expandGlob,
  parseCargo,
  parseGoMod,
  parsePyproject,
  parseRequirements,
  referencedServices,
  scanRepository,
  slug,
} from '../../src/main/repo-scan'
import { sanitizeDiagram } from '../../src/shared/serialize'
import type { IRDiagram } from '../../src/shared/ir'

const FIX = resolve(__dirname, '../fixtures/repos')
const scan = (name: string): Promise<IRDiagram> => scanRepository(join(FIX, name))

const node = (d: IRDiagram, id: string) => d.nodes.find((n) => n.id === id)
const hasEdge = (d: IRDiagram, s: string, t: string) => d.edges.some((e) => e.source === s && e.target === t)

/** Every scan result must already be a valid, clean IR (nothing to repair). */
function expectClean(d: IRDiagram): void {
  expect(sanitizeDiagram(d).fixes).toEqual([])
  for (const n of d.nodes) expect(n.meta?.source, `provenance for ${n.id}`).toBeTruthy()
}

describe('docker-compose', () => {
  it('maps services, roles, brands and every kind of dependency', async () => {
    const d = await scan('compose-basic')
    expectClean(d)
    expect(d.subtitle).toBe('Mapped from docker-compose.yml')
    expect(d.nodes.map((n) => n.id).sort()).toEqual(['api', 'cache', 'db', 'proxy', 'queue', 'web', 'worker'])

    expect(node(d, 'db')).toMatchObject({ role: 'database', brand: 'postgresql', sublabel: 'postgres' })
    expect(node(d, 'cache')).toMatchObject({ role: 'cache', brand: 'redis' })
    expect(node(d, 'queue')).toMatchObject({ role: 'queue', brand: 'rabbitmq' })
    expect(node(d, 'proxy')).toMatchObject({ role: 'cloud', brand: 'nginx' })
    expect(node(d, 'web')).toMatchObject({ role: 'frontend', sublabel: 'built from source' })
    expect(node(d, 'api')!.role).toBe('backend')
    expect(node(d, 'api')!.meta!.source).toBe('docker-compose.yml#services.api')

    // depends_on as list and as map
    expect(hasEdge(d, 'proxy', 'web')).toBe(true)
    expect(hasEdge(d, 'api', 'db')).toBe(true)
    expect(hasEdge(d, 'worker', 'db')).toBe(true)
    // links with alias
    expect(hasEdge(d, 'worker', 'queue')).toBe(true)
    // depends_on wins over the env-inferred duplicate (single edge, labelled)
    expect(d.edges.filter((e) => e.source === 'api' && e.target === 'db')).toHaveLength(1)
    expect(d.edges.find((e) => e.source === 'api' && e.target === 'db')!.label).toBe('depends on')
  })

  it('infers edges from environment values that name another service', async () => {
    const d = await scan('compose-subdir')
    expectClean(d)
    expect(d.subtitle).toBe('Mapped from docker/compose.yaml')
    expect(hasEdge(d, 'app', 'mongo')).toBe(true)
    expect(d.edges[0]).toMatchObject({ label: 'uses', variant: 'dashed' })
  })

  it('falls back to the manifest when the compose file is malformed', async () => {
    const d = await scan('compose-malformed')
    expectClean(d)
    expect(d.title).toBe('broken-compose-app')
    expect(node(d, 'app')!.sublabel).toBe('Express')
  })

  it('produces identical output when scanned twice (stable ids)', async () => {
    expect(await scan('compose-basic')).toEqual(await scan('compose-basic'))
  })
})

describe('monorepos', () => {
  it('npm workspaces with * and ** globs, internal deps and infra', async () => {
    const d = await scan('npm-workspaces')
    expectClean(d)
    expect(d.title).toBe('acme')
    expect(d.subtitle).toBe('Monorepo, 5 packages')
    const ids = d.nodes.map((n) => n.id)
    expect(ids).toEqual(expect.arrayContaining(['acme-ui', 'acme-db', 'acme-web', 'acme-api', 'acme-admin', 'postgresql', 'redis']))
    expect(node(d, 'acme-web')).toMatchObject({ role: 'frontend', sublabel: 'Next.js · apps/web' })
    expect(node(d, 'acme-api')).toMatchObject({ role: 'backend', sublabel: 'Fastify · apps/api' })
    expect(node(d, 'acme-admin')!.sublabel).toBe('React · apps/nested/admin')
    // workspace:* and plain version ranges both count as internal deps
    expect(hasEdge(d, 'acme-web', 'acme-ui')).toBe(true)
    expect(hasEdge(d, 'acme-admin', 'acme-ui')).toBe(true)
    expect(hasEdge(d, 'acme-api', 'acme-db')).toBe(true)
    // infra shared across packages is one node
    expect(hasEdge(d, 'acme-db', 'postgresql')).toBe(true)
    expect(hasEdge(d, 'acme-api', 'redis')).toBe(true)
    expect(d.nodes.filter((n) => n.label === 'PostgreSQL')).toHaveLength(1)
  })

  it('pnpm-workspace.yaml with a negated pattern', async () => {
    const d = await scan('pnpm-workspace')
    expectClean(d)
    expect(d.nodes.map((n) => n.id).sort()).toEqual(['cli', 'core'])
    expect(hasEdge(d, 'cli', 'core')).toBe(true)
  })

  it('yarn workspaces in object form', async () => {
    const d = await scan('yarn-object-workspaces')
    expectClean(d)
    expect(hasEdge(d, 'mod-a', 'mod-b')).toBe(true)
    expect(hasEdge(d, 'mod-b', 'stripe')).toBe(true)
  })
})

describe('single-package fallback', () => {
  it('Node: framework, infra, source dirs, Docker, ignores node_modules', async () => {
    const d = await scan('node-single')
    expectClean(d)
    expect(node(d, 'app')).toMatchObject({ label: 'shop-api', role: 'backend', sublabel: 'Express · Docker' })
    expect(d.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Stripe', 'Redis', 'AWS', 'src/']))
    expect(d.nodes.some((n) => n.label.includes('node_modules'))).toBe(false)
  })

  it('Python pyproject + requirements.txt', async () => {
    const d = await scan('python-pyproject')
    expectClean(d)
    expect(node(d, 'app')).toMatchObject({ label: 'orders-service', sublabel: 'FastAPI' })
    expect(d.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['PostgreSQL', 'Redis', 'Celery']))
  })

  it('Python requirements.txt only', async () => {
    const d = await scan('python-requirements')
    expectClean(d)
    expect(node(d, 'app')!.sublabel).toBe('Flask')
    expect(d.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['MongoDB', 'AWS', 'src/']))
  })

  it('Go modules', async () => {
    const d = await scan('go-mod')
    expectClean(d)
    expect(node(d, 'app')).toMatchObject({ label: 'billing', sublabel: 'Gin' })
    expect(d.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Redis', 'PostgreSQL', 'Stripe', 'cmd/']))
  })

  it('Rust Cargo', async () => {
    const d = await scan('rust-cargo')
    expectClean(d)
    expect(node(d, 'app')).toMatchObject({ label: 'ingest', sublabel: 'Axum' })
    expect(d.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['PostgreSQL', 'Kafka']))
  })

  it('a folder with no manifest still yields a valid map', async () => {
    const d = await scan('empty')
    expectClean(d)
    expect(d.nodes).toHaveLength(1)
    expect(d.subtitle).toContain('no manifest')
  })
})

describe('robustness', () => {
  it('rejects a folder that does not exist', async () => {
    await expect(scanRepository(join(FIX, 'does-not-exist'))).rejects.toThrow()
  })

  it(`caps very large repos at ${MAX_NODES} nodes and says so`, async () => {
    const dir = resolve(__dirname, '../.tmp/huge-compose')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const services = Array.from({ length: 120 }, (_, i) => `  svc${i}:\n    image: busybox\n    depends_on: [svc${(i + 1) % 120}]`)
    await writeFile(join(dir, 'docker-compose.yml'), `services:\n${services.join('\n')}\n`)
    const d = await scanRepository(dir)
    expect(d.nodes).toHaveLength(MAX_NODES)
    expect(d.subtitle).toContain(`showing ${MAX_NODES} of 120`)
    expectClean(d)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('helpers', () => {
  it('slug', () => {
    expect(slug('@acme/web-app')).toBe('acme-web-app')
    expect(slug('Hello World!')).toBe('hello-world')
    expect(slug('***')).toBe('node')
  })

  it('referencedServices matches hostnames, not substrings', () => {
    const svcs = ['db', 'app', 'cache']
    expect(referencedServices('postgres://u:p@db:5432/x', svcs, 'app')).toEqual(['db'])
    expect(referencedServices('cache', svcs, 'app')).toEqual(['cache'])
    expect(referencedServices('my-app-db-name', svcs, 'app')).toEqual([])
    expect(referencedServices('http://app:80', svcs, 'app')).toEqual([])
  })

  it('classifyImage', () => {
    expect(classifyImage('bitnami/postgresql:16')!.role).toBe('database')
    expect(classifyImage('valkey/valkey:8')!.role).toBe('cache')
    expect(classifyImage('redpandadata/redpanda')!.role).toBe('queue')
    expect(classifyImage('mycorp/whatever:1')).toBeNull()
  })

  it('manifest parsers', () => {
    expect(parseRequirements('Django>=5\n# c\n-e .\nrequests[socks]==2\n')).toEqual(new Set(['django', 'requests']))
    expect(parsePyproject('[tool.poetry]\nname = "p"\n[tool.poetry.dependencies]\npython = "^3.11"\nSQL_Alchemy = "2"\n')).toEqual({
      name: 'p',
      deps: new Set(['sql-alchemy']),
    })
    expect(parseGoMod('module x/y\nrequire a/b v1\n').deps).toEqual(new Set(['a/b']))
    expect(parseCargo('[package]\nname="z"\n[dependencies]\nserde = "1"\n')).toEqual({ name: 'z', deps: new Set(['serde']) })
  })

  it('expandGlob handles literal, * and ** segments', async () => {
    const root = join(FIX, 'npm-workspaces')
    const names = async (p: string) => (await expandGlob(root, p)).map((d) => d.slice(root.length + 1).replace(/\\/g, '/')).sort()
    expect(await names('packages/*')).toEqual(['packages/db', 'packages/ui'])
    expect(await names('apps/web')).toEqual(['apps/web'])
    expect(await names('apps/**')).toEqual(['apps', 'apps/api', 'apps/nested', 'apps/nested/admin', 'apps/web'])
  })
})

describe('multi-project repos and structure', () => {
  it('finds side-by-side projects without a workspace config, skipping examples', async () => {
    const d = await scan('multi-project')
    expectClean(d)
    expect(d.subtitle).toBe('3 projects found in subfolders')
    expect(node(d, 'shop-web')).toMatchObject({ role: 'frontend', sublabel: 'React · frontend' })
    expect(node(d, 'shop-api')).toMatchObject({ role: 'backend', sublabel: 'FastAPI · backend' })
    expect(node(d, 'shop-sdk')!.sublabel).toBe('Node.js · packages/sdk')
    expect(hasEdge(d, 'shop-web', 'shop-sdk')).toBe(true)
    expect(hasEdge(d, 'shop-api', 'postgresql')).toBe(true)
    expect(d.nodes.some((n) => n.label.includes('demo'))).toBe(false)
  })

  it('detects Electron and expands src/ into its layers', async () => {
    const d = await scan('electron-app')
    expectClean(d)
    expect(node(d, 'app')).toMatchObject({ role: 'frontend', sublabel: 'Electron' })
    expect(node(d, 'dir-src-renderer')).toMatchObject({ label: 'src/renderer/', role: 'frontend' })
    expect(node(d, 'dir-src-main')!.role).toBe('backend')
  })
})
