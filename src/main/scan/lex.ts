/**
 * Import extraction by tokenizing, not by pattern-matching raw text.
 *
 * Regexes over source text count an `import` inside a comment, a docstring or a
 * string literal as a real dependency, and miss forms that span lines. These
 * small lexers first split the code into tokens (skipping comments, keeping each
 * string literal as one token), then read import statements from the tokens. A
 * full parser (TypeScript's compiler, Python's ast) would be heavier than the
 * scanner needs: ~20 MB for TypeScript, and a Python install for Python. Syntax
 * the lexers don't understand is skipped, never fatal.
 */

/* ------------------------------ JavaScript ------------------------------ */

type JsTok = { t: 'id' | 'str' | 'tpl' | 'punct'; v: string }

const ID_START = /[A-Za-z_$ -￿]/
const ID_PART = /[\w$ -￿]/
/** After these, a `/` starts a regex literal rather than a division. */
const REGEX_AFTER_PUNCT = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>'])
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

/** Tokens of JS/TS source. String/template contents are kept only for plain strings. */
export function jsTokens(code: string): JsTok[] {
  const out: JsTok[] = []
  const n = code.length
  let i = 0
  const prevAllowsRegex = (): boolean => {
    const p = out[out.length - 1]
    if (!p) return true
    if (p.t === 'punct') return REGEX_AFTER_PUNCT.has(p.v)
    if (p.t === 'id') return REGEX_AFTER_WORD.has(p.v)
    return false
  }
  /** Skip a template literal starting after the opening backtick; returns [end, hasSubstitution, text]. */
  const template = (start: number): [number, boolean, string] => {
    let j = start
    let text = ''
    let subst = false
    while (j < n) {
      const c = code[j]
      if (c === '\\') {
        text += code[j + 1] ?? ''
        j += 2
      } else if (c === '`') return [j + 1, subst, text]
      else if (c === '$' && code[j + 1] === '{') {
        subst = true
        // skip the expression, honouring nested braces, strings and templates
        let depth = 1
        j += 2
        while (j < n && depth > 0) {
          const d = code[j]
          if (d === '{') depth++
          else if (d === '}') depth--
          else if (d === '`') {
            j = template(j + 1)[0]
            continue
          } else if (d === '"' || d === "'") {
            const q = d
            j++
            while (j < n && code[j] !== q && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
          }
          j++
        }
      } else {
        text += c
        j++
      }
    }
    return [n, subst, text]
  }

  while (i < n) {
    const c = code[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
    } else if (c === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else if (c === '"' || c === "'") {
      let j = i + 1
      let v = ''
      while (j < n && code[j] !== c && code[j] !== '\n') {
        if (code[j] === '\\') {
          v += code[j + 1] ?? ''
          j += 2
        } else v += code[j++]
      }
      out.push({ t: 'str', v })
      i = j + 1
    } else if (c === '`') {
      const [end, subst, text] = template(i + 1)
      out.push({ t: 'tpl', v: subst ? '' : text })
      i = end
    } else if (c === '/' && prevAllowsRegex()) {
      // regex literal: skip to the closing slash (character classes may contain '/')
      let j = i + 1
      let cls = false
      while (j < n && code[j] !== '\n') {
        const d = code[j]
        if (d === '\\') j++
        else if (d === '[') cls = true
        else if (d === ']') cls = false
        else if (d === '/' && !cls) break
        j++
      }
      j++
      while (j < n && /[a-z]/i.test(code[j])) j++
      out.push({ t: 'punct', v: 'regex' })
      i = j
    } else if (ID_START.test(c)) {
      let j = i + 1
      while (j < n && ID_PART.test(code[j])) j++
      out.push({ t: 'id', v: code.slice(i, j) })
      i = j
    } else if (/\d/.test(c)) {
      let j = i + 1
      while (j < n && /[\w.]/.test(code[j])) j++
      out.push({ t: 'punct', v: 'num' })
      i = j
    } else if (c === '=' && code[i + 1] === '>') {
      out.push({ t: 'punct', v: '=>' })
      i += 2
    } else {
      out.push({ t: 'punct', v: c })
      i++
    }
  }
  return out
}

/** Module specifiers a JS/TS file imports: ESM, re-exports, require, dynamic import, `import x = require()`. */
export function jsImportsLexed(code: string): string[] {
  const toks = jsTokens(code)
  const out: string[] = []
  const at = (k: number): JsTok | undefined => toks[k]
  const isDot = (k: number): boolean => at(k)?.t === 'punct' && at(k)!.v === '.'
  /** `obj.require(...)` is a method call; `...require(...)` (spread) is not. */
  const isMember = (k: number): boolean => isDot(k - 1) && !(isDot(k - 2) && isDot(k - 3))
  const literal = (k: number): string | null => {
    const t = at(k)
    if (!t) return null
    if (t.t === 'str' || (t.t === 'tpl' && t.v)) return t.v
    return null
  }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.t !== 'id' || isMember(k)) continue
    // require('x'), import('x'), require(`x`)
    if ((t.v === 'require' || t.v === 'import') && at(k + 1)?.v === '(' && at(k + 1)?.t === 'punct') {
      const s = literal(k + 2)
      if (s !== null && at(k + 3)?.v === ')') out.push(s)
      continue
    }
    if (t.v !== 'import' && t.v !== 'export') continue
    if (isDot(k + 1)) continue // import.meta
    // import 'side-effect'
    if (t.v === 'import' && at(k + 1)?.t === 'str') {
      out.push(at(k + 1)!.v)
      continue
    }
    // import x = require('y')   (TypeScript)
    if (t.v === 'import' && at(k + 1)?.t === 'id' && at(k + 2)?.v === '=' && at(k + 3)?.v === 'require' && at(k + 4)?.v === '(') {
      const s = literal(k + 5)
      if (s !== null) out.push(s)
      k += 5 // don't read the require() again
      continue
    }
    // import ... from 'x' / export ... from 'x': read the clause up to `from`
    let depth = 0
    // Export lists can be long (hundreds of names in an index file).
    for (let j = k + 1; j < Math.min(toks.length, k + 20000); j++) {
      const u = toks[j]
      if (u.t === 'punct') {
        if (u.v === '{') depth++
        else if (u.v === '}') depth--
        else if (depth === 0 && (u.v === ';' || u.v === '(' || u.v === '=' || u.v === '=>')) break
        continue
      }
      if (u.t === 'id' && u.v === 'from' && depth === 0) {
        const s = literal(j + 1)
        if (s !== null) out.push(s)
        break
      }
      if (u.t === 'str') break
      // a clause is identifiers, `type`, `*`, `as`, braces and commas only
      if (u.t === 'id' && depth === 0 && j > k + 1 && toks[j - 1].t === 'id' && !['as', 'type', 'typeof'].includes(toks[j - 1].v) && u.v !== 'as') break
    }
  }
  return out
}

/* -------------------------------- Python -------------------------------- */

/**
 * Python source as logical lines with comments removed and every string literal
 * replaced by a placeholder, keeping literal values in a side table (for
 * importlib.import_module("x")). Bracketed and backslash-continued lines join.
 */
export function pyLogicalLines(code: string): { line: string; strings: string[] }[] {
  const lines: { line: string; strings: string[] }[] = []
  let cur = ''
  let strings: string[] = []
  let depth = 0
  const n = code.length
  let i = 0
  const flush = (): void => {
    if (cur.trim()) lines.push({ line: cur, strings })
    cur = ''
    strings = []
  }
  while (i < n) {
    const c = code[i]
    if (c === '#') {
      while (i < n && code[i] !== '\n') i++
    } else if (c === '\\' && (code[i + 1] === '\n' || (code[i + 1] === '\r' && code[i + 2] === '\n'))) {
      i += code[i + 1] === '\r' ? 3 : 2
      cur += ' '
    } else if (c === '\n') {
      if (depth > 0) cur += ' '
      else flush()
      i++
    } else if (c === '"' || c === "'") {
      // prefix letters (r, b, f, u, rb...) were already appended as identifier chars: strip them
      const pm = cur.match(/(?:^|[^\w])([rbfuRBFU]{1,2})$/)
      if (pm) cur = cur.slice(0, cur.length - pm[1].length)
      const raw = !!pm && /r/i.test(pm[1])
      const triple = code.startsWith(c.repeat(3), i)
      const q = triple ? c.repeat(3) : c
      let j = i + q.length
      let v = ''
      while (j < n && !code.startsWith(q, j)) {
        if (code[j] === '\\' && !raw) {
          v += code[j + 1] ?? ''
          j += 2
        } else if (!triple && code[j] === '\n') break
        else v += code[j++]
      }
      strings.push(v)
      cur += ` __str${strings.length - 1}__ `
      i = j + q.length
    } else {
      if (c === '(' || c === '[' || c === '{') depth++
      else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--
      cur += c
      i++
    }
  }
  flush()
  return lines
}

/** Python imports as { module, names } (relative modules keep their dots), in source order. */
export function pyImportsLexed(code: string): { module: string; names: string[] }[] {
  const out: { module: string; names: string[] }[] = []
  for (const { line, strings } of pyLogicalLines(code)) {
    // Several statements on one line: `import a; import b`
    for (const stmt of line.split(';')) {
      const s = stmt.trim()
      let m = s.match(/^import\s+(.+)$/)
      if (m) {
        for (const part of m[1].split(',')) {
          const mod = part.trim().split(/\s+/)[0]
          if (/^[\w.]+$/.test(mod)) out.push({ module: mod, names: [] })
        }
        continue
      }
      m = s.match(/^from\s+(\.*[\w.]*)\s+import\s+(.+)$/)
      if (m) {
        const names = m[2]
          .replace(/[()]/g, ' ')
          .split(',')
          .map((x) => x.trim().split(/\s+/)[0])
          .filter((x) => /^\w+$/.test(x))
        out.push({ module: m[1], names })
        continue
      }
      // importlib.import_module("pkg.mod") / __import__("pkg") with a literal name
      for (const d of s.matchAll(/(?:\bimportlib\s*\.\s*import_module|\b__import__)\s*\(\s*__str(\d+)__\s*[,)]/g)) {
        const name = strings[Number(d[1])]
        if (name && /^\.*[\w.]+$/.test(name)) out.push({ module: name, names: [] })
      }
    }
  }
  return out
}
