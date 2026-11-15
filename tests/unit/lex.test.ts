import { describe, expect, it } from 'vitest'
import { jsImportsLexed, jsTokens, pyImportsLexed, pyLogicalLines } from '../../src/main/scan/lex'

describe('JavaScript / TypeScript import extraction', () => {
  it('ignores imports in comments, strings and JSDoc', () => {
    const code = `
      // import a from './commented'
      /* const b = require('./block-comment') */
      /**
       * {@link import('../internal/headers').buildHeaders}
       * import { Client } from "@modelcontextprotocol/sdk/client/index.js";
       */
      const msg = "set globalThis.File to import('node:buffer').File"
      const tpl = \`require('./in-template')\`
      import real from './real'
    `
    expect(jsImportsLexed(code)).toEqual(['./real'])
  })

  it('reads TypeScript forms the regex missed', () => {
    const code = `
      import fs = require('fs')
      import type {
        A,
        B,
      } from './types'
      export type { C } from './c'
      const lazy = await import(\`./lazy\`)
      const notLiteral = await import(\`./pages/\${name}\`)
    `
    expect(jsImportsLexed(code)).toEqual(['fs', './types', './c', './lazy'])
  })

  it('does not mistake other uses of the keywords', () => {
    const code = `
      const url = import.meta.url
      obj.import('nope'); obj.require('nope')
      export const x = 1
      export default function f() { return 2 }
      const re = /import x from 'y'/g
      const d = a / b / c
      import last from './last'
    `
    expect(jsImportsLexed(code)).toEqual(['./last'])
  })

  it('survives unterminated strings and odd input without throwing', () => {
    for (const code of ['import x from "unterminated', '`${', '/* never closed', "require('", '', '\u0000 ']) {
      expect(() => jsImportsLexed(code)).not.toThrow()
    }
  })

  it('tokenizes regex literals as one token', () => {
    expect(jsTokens("x = /a'b/g; y").map((t) => t.v)).toEqual(['x', '=', 'regex', ';', 'y'])
  })
})

describe('Python import extraction', () => {
  it('ignores imports in docstrings, strings and comments', () => {
    const code = `"""Module docs.

import not_real
from fake import thing
"""
x = "import nope"  # import also_nope
s = r'from raw import str'
import real
`
    expect(pyImportsLexed(code)).toEqual([{ module: 'real', names: [] }])
  })

  it('reads continued, multi-statement and dynamic imports', () => {
    const code = `import a, \\
    b
from pkg.sub import (x,  # comment inside
                     y as z)
import c; import d
mod = importlib.import_module("plugins.mail")
legacy = __import__('legacy_mod')
name = importlib.import_module(variable)
`
    expect(pyImportsLexed(code)).toEqual([
      { module: 'a', names: [] },
      { module: 'b', names: [] },
      { module: 'pkg.sub', names: ['x', 'y'] },
      { module: 'c', names: [] },
      { module: 'd', names: [] },
      { module: 'plugins.mail', names: [] },
      { module: 'legacy_mod', names: [] },
    ])
  })

  it('joins bracketed lines into one logical line', () => {
    expect(pyLogicalLines('f(1,\n  2)\ny = 3').map((l) => l.line.replace(/\s+/g, ' ').trim())).toEqual(['f(1, 2)', 'y = 3'])
  })

  it('survives unterminated strings without throwing', () => {
    for (const code of ['"""never closed', "x = 'open", 'from', 'import', '']) expect(() => pyImportsLexed(code)).not.toThrow()
  })
})
