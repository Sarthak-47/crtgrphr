/**
 * The import tokenizer against real code: every JS/TS file of a few installed
 * packages and of Cartographer itself, compared with TypeScript's own import
 * scanner (ts.preProcessFile). This measures where the tokenizer falls short
 * before anyone reaches for a full parser. Measured on 8,003 files (2026-11-16):
 * 99.9% agreement after fixing spread requires and long export lists; what
 * remains are computed paths ('dir/' + name), AMD/UMD bundles and minified code
 * that TypeScript's quick scanner misreads.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { jsImportsLexed } from '../../src/main/scan/lex'

const ROOT = resolve(__dirname, '../..')
const CORPUS = ['src', 'node_modules/@anthropic-ai/sdk/src', 'node_modules/js-yaml/lib', 'node_modules/zustand', 'node_modules/@xyflow/system/dist/esm', 'node_modules/elkjs/lib']

function files(): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(m?js|cjs|ts|tsx|mts)$/.test(e.name) && !/\.d\.m?ts$/.test(e.name) && !/umd/i.test(p) && statSync(p).size < 512 * 1024) out.push(p)
    }
  }
  for (const c of CORPUS) if (existsSync(join(ROOT, c))) walk(join(ROOT, c))
  return out
}

describe('import tokenizer on real code', () => {
  it('finds what TypeScript finds in at least 99.5% of cases, and never crashes', () => {
    const list = files()
    expect(list.length).toBeGreaterThan(150)
    let agree = 0
    let missed = 0
    const misses: string[] = []
    for (const f of list) {
      const code = readFileSync(f, 'utf8')
      const theirs = ts.preProcessFile(code, true, true).importedFiles.map((x) => x.fileName)
      const ours = new Set(jsImportsLexed(code))
      for (const x of theirs) {
        if (ours.has(x)) agree++
        else if (!['module', 'exports', 'require'].includes(x)) {
          missed++
          if (misses.length < 10) misses.push(`${x} in ${f.slice(ROOT.length + 1)}`)
        }
      }
    }
    const rate = agree / (agree + missed)
    expect(rate, `missed: ${misses.join('; ')}`).toBeGreaterThanOrEqual(0.995)
  })
})
