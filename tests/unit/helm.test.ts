import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { scanRepositoryWithReport } from '../../src/main/repo-scan'
import { renderedDocs, type HelmRender } from '../../src/main/scan/helm'

const FIX = resolve(__dirname, '../fixtures/repos')

/** What `helm template` prints for the fixture chart: the same substitutions, the same framing. */
const fakeHelm: HelmRender = async (dir, release) => {
  const chart = yaml.load(await readFile(join(dir, 'Chart.yaml'), 'utf8')) as { name: string }
  const values = yaml.load(await readFile(join(dir, 'values.yaml'), 'utf8')) as Record<string, { image: string }>
  const parts: string[] = []
  for (const f of (await readdir(join(dir, 'templates'))).sort()) {
    const text = (await readFile(join(dir, 'templates', f), 'utf8'))
      .replace(/\{\{ \.Release\.Name \}\}/g, release)
      .replace(/\{\{ \.Values\.(\w+)\.image \}\}/g, (_, k: string) => values[k].image)
      .replace(/\{\{ "\{\{" \}\}/g, '{{')
      .replace(/\{\{ "\}\}" \}\}/g, '}}')
    for (const doc of text.split(/^---\s*$/m)) parts.push(`# Source: ${chart.name}/templates/${f}\n${doc.trim()}\n`)
  }
  return { text: `---\n${parts.join('---\n')}` }
}

const hasHelm = (() => {
  try {
    execFileSync('helm', ['version', '--short'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('Helm rendering (opt-in)', () => {
  it('splits rendered output and finds each template file', () => {
    const docs = renderedDocs('---\n# Source: shop/charts/redis/templates/svc.yaml\nkind: Service\n---\n# Source: shop/templates/web.yaml\nkind: Deployment\n')
    expect(docs.map((d) => d.source)).toEqual(['charts/redis/templates/svc.yaml', 'templates/web.yaml'])
  })

  it('draws the workloads a chart renders, linked by the services they name', async () => {
    const { diagram: d, warnings } = await scanRepositoryWithReport(join(FIX, 'helm-renderable'), { helm: fakeHelm })
    expect(warnings).toEqual([])
    const ids = d.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(expect.arrayContaining(['store-api', 'store-db', 'store-web']))
    expect(ids).not.toContain('store') // the chart box is replaced by what it renders
    const edges = d.edges.map((e) => `${e.source}->${e.target}`)
    expect(edges).toEqual(expect.arrayContaining(['store-web->store-api', 'store-api->store-db']))
    expect(d.nodes.find((n) => n.id === 'store-db')?.role).toBe('database')
    expect(d.nodes.find((n) => n.id === 'store-api')?.meta?.source).toBe('chart/templates/api.yaml#Deployment/store-api')
    expect(d.subtitle).toMatch(/1 Helm chart rendered with helm template/)
  })

  it('reads the chart as before when not asked to render', async () => {
    const d = (await scanRepositoryWithReport(join(FIX, 'helm-renderable'))).diagram
    expect(d.nodes.map((n) => n.id)).toEqual(['store'])
  })

  it('falls back to Chart.yaml, with a note, when rendering fails', async () => {
    const failing: HelmRender = async () => ({ error: 'found in Chart.yaml, but missing in charts/ directory: postgresql, redis' })
    const { diagram: d, warnings } = await scanRepositoryWithReport(join(FIX, 'helm-umbrella'), { helm: failing })
    expect(d.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['shop', 'postgresql', 'redis']))
    expect(warnings.join('\n')).toMatch(/could not be rendered.*deploy\/shop: found in Chart\.yaml, but missing/s)
  })

  it.skipIf(!hasHelm)('renders with the real helm binary', async () => {
    const { diagram: d } = await scanRepositoryWithReport(join(FIX, 'helm-renderable'), { helm: true })
    expect(d.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['store-api', 'store-db', 'store-web']))
    expect(d.edges.map((e) => `${e.source}->${e.target}`)).toEqual(expect.arrayContaining(['store-web->store-api', 'store-api->store-db']))
    // A chart whose dependencies aren't vendored can't render; it is read from Chart.yaml.
    const umbrella = await scanRepositoryWithReport(join(FIX, 'helm-umbrella'), { helm: true })
    expect(umbrella.diagram.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['shop', 'postgresql']))
    expect(umbrella.warnings.join('\n')).toMatch(/could not be rendered/)
  })
})
