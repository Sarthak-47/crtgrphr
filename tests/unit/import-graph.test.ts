import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import {
  buildImportGraph,
  componentRoot,
  jsImports,
  packageName,
  parseJsonc,
  pyImports,
} from '../../src/main/import-graph'
import { scanRepository } from '../../src/main/repo-scan'
import { sanitizeDiagram } from '../../src/shared/serialize'

const FIX = resolve(__dirname, '../fixtures/repos')
const ROOT = resolve(__dirname, '../..')
const edge = (g: { edges: { source: string; target: string; count: number }[] }, s: string, t: string) =>
  g.edges.find((e) => e.source === s && e.target === t)

describe('parsing', () => {
  it('jsImports finds every import form', () => {
    const code = `
      import a from 'a'
      import { b, c } from "./b"
      import * as d from '../d'
      import type { E } from '@scope/e/sub'
      import 'side-effect'
      export { f } from './f'
      export * from './g'
      import {
        multi,
        line,
      } from './h'
      const i = require('./i')
      const j = await import('./j')
      obj.import('nope')
    `
    expect(jsImports(code).sort()).toEqual(['../d', './b', './f', './g', './h', './i', './j', '@scope/e/sub', 'a', 'side-effect'])
  })

  it('packageName', () => {
    expect(packageName('react')).toBe('react')
    expect(packageName('react-dom/client')).toBe('react-dom')
    expect(packageName('@aws-sdk/client-s3/sub')).toBe('@aws-sdk/client-s3')
    expect(packageName('./local')).toBeNull()
    expect(packageName('node:fs')).toBeNull()
  })

  it('pyImports handles plain, aliased, multi, relative and parenthesised imports', () => {
    const out = pyImports(`import os, sys as s
from a.b import c, d as e
from . import x
from ..pkg import (
    y,
    z,
)
    import indented
`)
    expect(out).toEqual([
      { module: 'os', names: [] },
      { module: 'sys', names: [] },
      { module: 'indented', names: [] },
      { module: 'a.b', names: ['c', 'd'] },
      { module: '.', names: ['x'] },
      { module: '..pkg', names: ['y', 'z'] },
    ])
  })

  it('parseJsonc tolerates comments and trailing commas, but not inside strings', () => {
    expect(parseJsonc('{ // c\n "a": "http://x", /* b */ "b": [1,2,], }')).toEqual({ a: 'http://x', b: [1, 2] })
  })
})

describe('TypeScript import graph', () => {
  it('resolves relative, aliased, .js→.ts, require and dynamic imports between components', async () => {
    const g = (await buildImportGraph(join(FIX, 'ts-components')))!
    expect(g.components.map((c) => c.id)).toEqual(['src/api', 'src/core', 'src/web'])
    // server.ts: ../core/db, @core/log (alias), ../core/types.js (.js → .ts)
    expect(edge(g, 'src/api', 'src/core')!.count).toBe(3)
    // app.tsx: ../api/client.js
    expect(edge(g, 'src/web', 'src/api')!.count).toBe(1)
    // app.tsx dynamic import('../core/log') + legacy.js require('../core/log')
    expect(edge(g, 'src/web', 'src/core')!.count).toBe(2)
    // intra-component re-export (./handlers) is not an edge; tests are ignored
    expect(g.edges).toHaveLength(3)
    expect(g.files).toBe(9)
  })

  it('records bare package imports per component', async () => {
    const g = (await buildImportGraph(join(FIX, 'ts-components')))!
    const pk = (id: string) => [...g.components.find((c) => c.id === id)!.packages].sort()
    expect(pk('src/api')).toEqual(['fastify'])
    expect(pk('src/core')).toEqual(['ioredis', 'pg'])
    expect(pk('src/web')).toEqual(['react'])
  })

  it('the scanner turns it into a grounded map with infra on the right component', async () => {
    const d = await scanRepository(join(FIX, 'ts-components'))
    expect(sanitizeDiagram(d).fixes).toEqual([])
    expect(d.subtitle).toBe('Fastify + React · 3 components from imports across 9 files')
    const n = (id: string) => d.nodes.find((x) => x.id === id)!
    expect(n('dir-src-web')).toMatchObject({ label: 'web', role: 'frontend', sublabel: 'React · src/web/ · 2 files' })
    expect(n('dir-src-api')).toMatchObject({ role: 'backend', sublabel: 'Fastify · src/api/ · 3 files' })
    const e = (s: string, t: string) => d.edges.find((x) => x.source === s && x.target === t)
    expect(e('dir-src-api', 'dir-src-core')!.label).toBe('3 imports')
    expect(e('dir-src-web', 'dir-src-api')!.label).toBe('1 import')
    // Postgres and Redis hang off core (the component importing them), not off the app
    expect(e('dir-src-core', 'postgresql')).toBeDefined()
    expect(e('dir-src-core', 'redis')).toBeDefined()
    expect(e('dir-src-api', 'postgresql')).toBeUndefined()
  })
})

describe('Python import graph', () => {
  it('uses the sub-packages of the single top-level package as components', async () => {
    expect(await componentRoot(join(FIX, 'py-components'))).toBe(join(FIX, 'py-components', 'shop'))
  })

  it('resolves absolute, relative and parent-relative imports; ignores tests', async () => {
    const g = (await buildImportGraph(join(FIX, 'py-components')))!
    expect(g.components.map((c) => c.label)).toEqual(['api', 'db', 'services'])
    expect(edge(g, 'shop/api', 'shop/db')!.count).toBe(1) // from shop.db import models
    expect(edge(g, 'shop/api', 'shop/services')!.count).toBe(1) // from ..services import billing
    expect(edge(g, 'shop/services', 'shop/db')!.count).toBe(1) // from shop.db.models import (...)
    expect(g.edges).toHaveLength(3) // "from . import schemas" stays inside api
  })

  it('the scanner attaches Python infra to the importing package', async () => {
    const d = await scanRepository(join(FIX, 'py-components'))
    expect(sanitizeDiagram(d).fixes).toEqual([])
    const e = (s: string, t: string) => d.edges.some((x) => x.source === s && x.target === t)
    expect(e('dir-shop-db', 'postgresql')).toBe(true)
    expect(e('dir-shop-services', 'stripe')).toBe(true)
    expect(d.nodes.find((n) => n.id === 'dir-shop-api')!.sublabel).toMatch(/^FastAPI/)
  })
})

describe('real repository', () => {
  it('maps crtgrphr itself: main, preload and renderer depend on shared', async () => {
    const d = await scanRepository(ROOT)
    const e = (s: string, t: string) => d.edges.some((x) => x.source === s && x.target === t)
    expect(e('dir-src-main', 'dir-src-shared')).toBe(true)
    expect(e('dir-src-preload', 'dir-src-shared')).toBe(true)
    expect(e('dir-src-renderer', 'dir-src-shared')).toBe(true)
    expect(e('dir-src-renderer', 'dir-src-preload')).toBe(true) // the typed IPC bridge
    expect(e('dir-src-shared', 'dir-src-renderer')).toBe(false) // the core never imports the UI (ADR-0002)
    expect(d.nodes.find((n) => n.id === 'dir-src-renderer')!.role).toBe('frontend')
  })
})

describe('fallbacks', () => {
  it('repos without importing components keep the folder view', async () => {
    expect(await buildImportGraph(join(FIX, 'node-single'))).toBeNull()
    const d = await scanRepository(join(FIX, 'electron-app')) // two folders, no imports between them
    expect(d.nodes.some((n) => n.id === 'app')).toBe(true)
  })
})
