import { describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileGitignore } from '../../src/main/scan/ignore'
import { scanRepository } from '../../src/main/repo-scan'

describe('.gitignore folders', () => {
  it('matches names anywhere, rooted paths from the root, globs and negation', () => {
    const t = compileGitignore(['# build output', 'dist/', '/local-tools', 'gen-*', 'apps/**/out', '!gen-keep', ''].join('\n'))
    expect(t('dist')).toBe(true)
    expect(t('packages/web/dist')).toBe(true)
    expect(t('local-tools')).toBe(true)
    expect(t('apps/local-tools')).toBe(false) // rooted: only at the root
    expect(t('gen-client')).toBe(true)
    expect(t('gen-keep')).toBe(false) // negated
    expect(t('apps/web/out')).toBe(true)
    expect(t('src')).toBe(false)
  })

  it('leaves out a git-ignored folder that has its own package.json', async () => {
    const dir = resolve(__dirname, '../.tmp/gitignore-scan')
    rmSync(dir, { recursive: true, force: true })
    for (const p of ['web', 'api', 'scratch/tool']) mkdirSync(join(dir, p), { recursive: true })
    writeFileSync(join(dir, '.gitignore'), 'scratch/\n')
    writeFileSync(join(dir, 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { api: '1' } }))
    writeFileSync(join(dir, 'api', 'package.json'), JSON.stringify({ name: 'api' }))
    writeFileSync(join(dir, 'scratch', 'tool', 'package.json'), JSON.stringify({ name: 'tool' }))
    const d = await scanRepository(dir)
    const labels = d.nodes.map((n) => n.label)
    expect(labels).toEqual(expect.arrayContaining(['web', 'api']))
    expect(labels).not.toContain('tool')
  })
})
