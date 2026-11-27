/**
 * Import graphs for Go modules and Rust crates (scanner rung 3, alongside the
 * JS/TS and Python graph in import-graph.ts).
 *
 * Go: components are the packages under cmd/, internal/, pkg/ (or the top-level
 * folders), plus the module root's own files. An import of `<module>/x/y`
 * resolves to the component holding x/y; other import paths are kept so client
 * libraries (Postgres, Redis...) attach to the component that imports them.
 *
 * Rust: components are the crate's top-level modules (src/x.rs and src/x/).
 * `crate::x`, `super::x` and `use crate::{x, y}` paths resolve to them; a
 * dependency counts as used where its `name::` path appears.
 *
 * Comments and string contents are skipped, so a path in a comment doesn't count.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { IGNORE_DIRS, MAX_FILES, MAX_FILE_BYTES, NON_SYSTEM_DIRS, type Component, type ImportEdge, type ImportGraph } from '../import-graph'
import { warn, warnMany } from './warnings'
import { isGitignoredDir } from './ignore'

const toPosix = (p: string): string => p.split(sep).join('/')

async function listDir(dir: string): Promise<Dirent[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => !(e.isDirectory() && isGitignoredDir(join(dir, e.name)))).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

const isCodeDir = (d: Dirent): boolean =>
  d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith('.') && !d.name.startsWith('_') &&
  !IGNORE_DIRS.has(d.name) && !NON_SYSTEM_DIRS.has(d.name.toLowerCase()) && d.name !== 'testdata'

/** Files under `dir` passing `accept`, recursively unless `deep` is false. */
async function walk(dir: string, accept: (name: string) => boolean, out: string[], budget: { left: number }, deep = true): Promise<void> {
  for (const e of await listDir(dir)) {
    if (budget.left <= 0) return
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (deep && isCodeDir(e)) await walk(p, accept, out, budget)
    } else if (e.isFile() && accept(e.name)) {
      out.push(p)
      budget.left--
    }
  }
}

async function readSources(root: string, files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < files.length; i += 32) {
    await Promise.all(
      files.slice(i, i + 32).map(async (f) => {
        try {
          if ((await stat(f)).size > MAX_FILE_BYTES) return warnMany(`source files over ${MAX_FILE_BYTES / 1024} KB skipped (usually generated or bundled code)`, toPosix(relative(root, f)))
          out.set(f, await readFile(f, 'utf8'))
        } catch {
          warnMany('source files could not be read', toPosix(relative(root, f)))
        }
      }),
    )
  }
  return out
}

/* --------------------------------- Lexing -------------------------------- */

/**
 * Comments become spaces. With `keepStrings`, string literals are copied as they
 * are (Go import paths are strings); otherwise their contents become spaces.
 * `nested` block comments are Rust's; `raw` strings are Go's `...` and Rust's r#"..."#.
 */
export function stripComments(code: string, lang: 'go' | 'rust'): string {
  const keepStrings = lang === 'go'
  let out = ''
  let i = 0
  const n = code.length
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  while (i < n) {
    const c = code[i]
    const d = code[i + 1]
    if (c === '/' && d === '/') {
      const end = code.indexOf('\n', i)
      const stop = end < 0 ? n : end
      out += blank(code.slice(i, stop))
      i = stop
    } else if (c === '/' && d === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (lang === 'rust' && code[j] === '/' && code[j + 1] === '*') (depth++, (j += 2))
        else if (code[j] === '*' && code[j + 1] === '/') (depth--, (j += 2))
        else j++
      }
      out += blank(code.slice(i, j))
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < n && code[j] !== '"') j += code[j] === '\\' ? 2 : 1
      const s = code.slice(i, j + 1)
      out += keepStrings ? s : `"${blank(s.slice(1, -1))}"`
      i = j + 1
    } else if (lang === 'go' && c === '`') {
      const end = code.indexOf('`', i + 1)
      const stop = end < 0 ? n : end + 1
      out += blank(code.slice(i, stop))
      i = stop
    } else if (lang === 'rust' && (c === 'r' || c === 'b') && /^b?r#*"/.test(code.slice(i, i + 40)) && !/\w/.test(code[i - 1] ?? '')) {
      const m = code.slice(i).match(/^b?r(#*)"/)!
      const close = `"${m[1]}`
      const end = code.indexOf(close, i + m[0].length)
      const stop = end < 0 ? n : end + close.length
      out += blank(code.slice(i, stop))
      i = stop
    } else if (c === "'") {
      // A char/rune literal ('a', '\n', '\u{1F600}'); in Rust a lone ' starts a lifetime.
      const m = code.slice(i, i + 12).match(/^'(?:\\[^']{1,10}|[^\\'\n])'/)
      if (m) {
        out += blank(m[0])
        i += m[0].length
      } else {
        out += c
        i++
      }
    } else {
      out += c
      i++
    }
  }
  return out
}

/* ----------------------------------- Go ---------------------------------- */

/** Import paths of a Go file (comments ignored; only the file's import section is read). */
export function goImports(code: string): string[] {
  const text = stripComments(code, 'go')
  const body = text.search(/^(?:func|type|var|const)\b/m)
  const head = body < 0 ? text : text.slice(0, body)
  const out: string[] = []
  for (const m of head.matchAll(/\bimport\s*\(([^)]*)\)/g)) for (const s of m[1].matchAll(/"([^"\n]+)"/g)) out.push(s[1])
  for (const m of head.matchAll(/\bimport\s+(?:[\w.]+\s+)?"([^"\n]+)"/g)) out.push(m[1])
  return out
}

/** Folders whose sub-folders are the components (cmd/api, internal/store...). */
const GO_GROUPS = new Set(['cmd', 'internal', 'pkg', 'app', 'apps', 'services', 'modules', 'components'])
const isGoFile = (name: string): boolean => name.endsWith('.go') && !name.endsWith('_test.go')

export async function buildGoGraph(root: string, modulePath: string): Promise<ImportGraph | null> {
  const budget = { left: MAX_FILES }
  const comps: Component[] = []
  const fileComp = new Map<string, Component>()
  const dirFile = new Map<string, string>() // package dir (posix, relative) → one of its files
  const all: string[] = []
  const add = (dir: string, label: string, files: string[]): void => {
    if (files.length === 0) return
    const comp: Component = { id: dir, dir, label, files: files.length, lang: 'go', packages: new Set() }
    comps.push(comp)
    for (const f of files) {
      fileComp.set(f, comp)
      const d = toPosix(relative(root, join(f, '..'))) || '.'
      if (!dirFile.has(d)) dirFile.set(d, toPosix(relative(root, f)))
    }
    all.push(...files)
  }

  const rootFiles: string[] = []
  await walk(root, isGoFile, rootFiles, budget, false)
  add('.', modulePath.split('/').pop() || 'main', rootFiles)
  for (const d of (await listDir(root)).filter(isCodeDir)) {
    const abs = join(root, d.name)
    const subs = GO_GROUPS.has(d.name) ? (await listDir(abs)).filter(isCodeDir) : []
    const subFiles: [Dirent, string[]][] = []
    for (const s of subs) {
      const files: string[] = []
      await walk(join(abs, s.name), isGoFile, files, budget)
      if (files.length) subFiles.push([s, files])
    }
    if (subFiles.length) {
      const own: string[] = []
      await walk(abs, isGoFile, own, budget, false)
      add(d.name, d.name, own)
      for (const [s, files] of subFiles) add(`${d.name}/${s.name}`, d.name === 'cmd' ? `cmd/${s.name}` : s.name, files)
    } else {
      const files: string[] = []
      await walk(abs, isGoFile, files, budget)
      add(d.name, d.name, files)
    }
  }
  if (comps.length < 2) return null
  const truncated = budget.left <= 0
  if (truncated) warn(`only the first ${MAX_FILES} source files were read; imports in the rest are not on the map`)

  // Longest component dir first, so internal/store/sql finds internal/store before internal.
  const byDepth = [...comps].sort((a, b) => b.dir.length - a.dir.length)
  const compOfDir = (rel: string): Component | undefined =>
    rel === '' ? comps.find((c) => c.dir === '.') : byDepth.find((c) => c.dir !== '.' && (rel === c.dir || rel.startsWith(c.dir + '/')))

  const counts = new Map<string, ImportEdge>()
  const sources = await readSources(root, all)
  for (const [file, code] of sources) {
    const from = fileComp.get(file)!
    for (const path of goImports(code)) {
      if (path === modulePath || path.startsWith(modulePath + '/')) {
        const rel = path.slice(modulePath.length + 1)
        const to = compOfDir(rel)
        if (!to || to === from) continue
        const key = `${from.id}\u0000${to.id}`
        const e = counts.get(key) ?? { source: from.id, target: to.id, count: 0, example: [toPosix(relative(root, file)), dirFile.get(rel || '.') ?? `${rel}/`] }
        e.count++
        counts.set(key, e)
      } else if (path.split('/')[0].includes('.')) {
        from.packages.add(path.toLowerCase())
      }
    }
  }
  const edges = [...counts.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
  return { components: comps, edges, files: all.length, truncated }
}

/* ---------------------------------- Rust --------------------------------- */

const RUST_ROOTS = new Set(['main.rs', 'lib.rs', 'mod.rs'])
const isRsFile = (name: string): boolean => name.endsWith('.rs')

/** Module path of a file under src/: src/a/b.rs → [a, b]; src/a/mod.rs → [a]. */
const modulePathOf = (relToSrc: string): string[] => {
  const parts = relToSrc.replace(/\.rs$/, '').split('/')
  if (parts[parts.length - 1] === 'mod') parts.pop()
  return parts
}

/** Top-level modules a Rust file refers to, and every `ident::` path it uses. */
export function rustReferences(code: string, modPath: string[]): { modules: Set<string>; idents: Set<string> } {
  const text = stripComments(code, 'rust')
  const modules = new Set<string>()
  const lead = (s: string): string | null => s.trim().match(/^([A-Za-z_]\w*)/)?.[1] ?? null
  const addGroup = (names: string): void => {
    for (const part of names.split(',')) {
      const id = lead(part)
      if (id && id !== 'self') modules.add(id)
    }
  }
  for (const m of text.matchAll(/\bcrate\s*::\s*(?:\{([^}]*)\}|([A-Za-z_]\w*))/g)) m[1] !== undefined ? addGroup(m[1]) : modules.add(m[2])
  for (const m of text.matchAll(/\b((?:super\s*::\s*)+)(?:\{([^}]*)\}|([A-Za-z_]\w*))/g)) {
    const ups = (m[1].match(/super/g) ?? []).length
    const base = modPath.slice(0, Math.max(0, modPath.length - ups))
    if (base.length > 0) continue // still inside this file's own top-level module
    m[2] !== undefined ? addGroup(m[2]) : modules.add(m[3])
  }
  const idents = new Set<string>()
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*::/g)) idents.add(m[1])
  return { modules, idents }
}

export async function buildRustGraph(root: string, deps: Set<string>): Promise<ImportGraph | null> {
  const src = join(root, 'src')
  const budget = { left: MAX_FILES }
  const filesOf = new Map<string, string[]>()
  for (const e of await listDir(src)) {
    if (e.isFile() && isRsFile(e.name) && !RUST_ROOTS.has(e.name)) {
      const name = e.name.replace(/\.rs$/, '')
      filesOf.set(name, [...(filesOf.get(name) ?? []), join(src, e.name)])
      budget.left--
    } else if (isCodeDir(e) && e.name !== 'bin') {
      const files: string[] = []
      await walk(join(src, e.name), isRsFile, files, budget)
      if (files.length) filesOf.set(e.name, [...(filesOf.get(e.name) ?? []), ...files])
    }
  }
  if (filesOf.size < 2) return null
  const truncated = budget.left <= 0
  if (truncated) warn(`only the first ${MAX_FILES} source files were read; imports in the rest are not on the map`)

  const comps = new Map<string, Component>()
  const fileComp = new Map<string, Component>()
  for (const [name, files] of filesOf) {
    const own = files.length === 1 ? toPosix(relative(root, files[0])) : undefined
    const comp: Component = { id: `src/${name}`, dir: `src/${name}`, ...(own ? { source: own } : {}), label: name, files: files.length, lang: 'rust', packages: new Set() }
    comps.set(name, comp)
    for (const f of files) fileComp.set(f, comp)
  }
  const crateOf = new Map([...deps].map((d) => [d.replace(/-/g, '_'), d]))

  // Items the crate root re-exports (`pub use connection::Connection;`), so
  // `crate::Connection` elsewhere resolves to the connection module.
  const reexport = new Map<string, string>()
  for (const rootFile of ['lib.rs', 'main.rs']) {
    let text: string
    try {
      text = stripComments(await readFile(join(src, rootFile), 'utf8'), 'rust')
    } catch {
      continue
    }
    for (const m of text.matchAll(/\buse\s+(?:(?:crate|self)\s*::\s*)?([A-Za-z_]\w*)\s*::\s*([^;]+);/g)) {
      if (!comps.has(m[1])) continue
      for (const id of m[2].matchAll(/[A-Za-z_]\w*/g)) if (!['self', 'super', 'crate', 'as'].includes(id[0]) && !comps.has(id[0])) reexport.set(id[0], m[1])
    }
  }

  const counts = new Map<string, ImportEdge>()
  const all = [...fileComp.keys()]
  const sources = await readSources(root, all)
  for (const [file, code] of sources) {
    const from = fileComp.get(file)!
    const { modules, idents } = rustReferences(code, modulePathOf(toPosix(relative(src, file))))
    for (const name of modules) {
      const to = comps.get(name) ?? comps.get(reexport.get(name) ?? '')
      if (!to || to === from) continue
      const key = `${from.id}\u0000${to.id}`
      const e = counts.get(key) ?? { source: from.id, target: to.id, count: 0, example: [toPosix(relative(root, file)), to.source ?? `${to.dir}/`] }
      e.count++
      counts.set(key, e)
    }
    for (const id of idents) {
      const dep = crateOf.get(id)
      if (dep) from.packages.add(dep)
    }
  }
  const edges = [...counts.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
  return { components: [...comps.values()], edges, files: all.length, truncated, verb: 'use' }
}
