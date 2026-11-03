/**
 * Import graph (scanner rung 3): which parts of a codebase depend on which,
 * from real import statements, not folder names.
 *
 * Source files are grouped into components: the folders under `src/` (or under a
 * single Python package, or the top-level source folders). Each import is
 * resolved to a file, and every import that crosses from one component into
 * another adds to that edge's count. Bare package imports are kept per component
 * so infrastructure (Postgres, Redis...) can be attached to the component that
 * actually uses it.
 *
 * Supported: JavaScript/TypeScript (ESM, CommonJS, dynamic import, re-exports,
 * tsconfig `paths`/`baseUrl`, the ESM ".js → .ts" convention) and Python
 * (absolute and relative imports). Pure Node, no Electron imports.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const MAX_FILES = 4000
export const MAX_FILE_BYTES = 512 * 1024

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.svelte-kit',
  'coverage', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv', 'env',
  '.idea', '.vscode', 'tmp', '.tox', '.pytest_cache', '.mypy_cache', 'site-packages',
])
/** Tests, fixtures and examples import everything; they aren't architecture. */
const NON_SYSTEM_DIRS = new Set(['test', 'tests', '__tests__', 'e2e', 'fixtures', '__fixtures__', 'examples', 'example', 'docs', 'stories', '__mocks__'])
const TEST_FILE = /(\.|_)(test|spec|stories)\.[a-z]+$|^test_.*\.py$|_test\.py$|^conftest\.py$/i

const JS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const PY_EXT = ['.py']

export type Lang = 'js' | 'py'

export interface Component {
  id: string
  /** path relative to the repo root, forward slashes */
  dir: string
  label: string
  files: number
  lang: Lang
  /** bare package imports (e.g. "react", "pg", "psycopg") seen in this component */
  packages: Set<string>
}

export interface ImportEdge {
  source: string
  target: string
  count: number
}

export interface ImportGraph {
  components: Component[]
  edges: ImportEdge[]
  files: number
  truncated: boolean
}

const toPosix = (p: string): string => p.split(sep).join('/')

async function listDir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

const langOf = (file: string): Lang | null => {
  const lower = file.toLowerCase()
  // Declaration files count: a .d.ts importing another part is a real (type-level) dependency.
  if (JS_EXT.some((e) => lower.endsWith(e))) return 'js'
  if (PY_EXT.some((e) => lower.endsWith(e))) return 'py'
  return null
}

const isSourceDir = (d: Dirent): boolean =>
  d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith('.') && !IGNORE_DIRS.has(d.name) && !NON_SYSTEM_DIRS.has(d.name.toLowerCase())

/** Recursively collect source files under `dir`, respecting ignores and caps. */
async function collectFiles(dir: string, out: string[], budget: { left: number }): Promise<void> {
  for (const e of await listDir(dir)) {
    if (budget.left <= 0) return
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (isSourceDir(e)) await collectFiles(p, out, budget)
    } else if (e.isFile() && langOf(e.name) && !TEST_FILE.test(e.name)) {
      out.push(p)
      budget.left--
    }
  }
}

async function hasSource(dir: string): Promise<boolean> {
  const files: string[] = []
  await collectFiles(dir, files, { left: 1 })
  return files.length > 0
}

/* ------------------------------ Components ------------------------------- */

/**
 * Pick the folder whose sub-folders are the components:
 *   1. `src/` with at least two source sub-folders
 *   2. a single top-level Python package (or src/<pkg>) with sub-packages
 *   3. the repo root's own source folders
 */
export async function componentRoot(root: string): Promise<string | null> {
  const subdirsWithSource = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const d of await listDir(dir)) if (isSourceDir(d) && (await hasSource(join(dir, d.name)))) out.push(join(dir, d.name))
    return out
  }

  const src = join(root, 'src')
  const srcKids = await subdirsWithSource(src)
  // src/ that only holds one Python package: look inside the package.
  if (srcKids.length === 1 && (await isFile(join(srcKids[0], '__init__.py')))) {
    if ((await subdirsWithSource(srcKids[0])).length >= 2) return srcKids[0]
  }
  if (srcKids.length >= 2) return src

  const rootKids = await subdirsWithSource(root)
  const pyPackages = []
  for (const k of rootKids) if (await isFile(join(k, '__init__.py'))) pyPackages.push(k)
  if (pyPackages.length === 1 && (await subdirsWithSource(pyPackages[0])).length >= 2) return pyPackages[0]
  if (rootKids.length >= 2) return root
  return null
}

/* ------------------------------ tsconfig --------------------------------- */

interface PathAlias {
  prefix: string
  suffix: string
  wildcard: boolean
  targets: string[] // absolute, may contain one '*'
}

/** Parse JSON-with-comments (tsconfig style) leniently. */
export function parseJsonc(text: string): any {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

async function loadTsAliases(root: string): Promise<{ aliases: PathAlias[]; baseUrls: string[] }> {
  const aliases: PathAlias[] = []
  const baseUrls: string[] = []
  const names = (await listDir(root)).filter((e) => e.isFile() && /^(tsconfig|jsconfig)(\..+)?\.json$/.test(e.name)).map((e) => e.name).sort()
  for (const name of names) {
    let cfg: any
    try {
      cfg = parseJsonc(await readFile(join(root, name), 'utf8'))
    } catch {
      continue
    }
    const co = cfg?.compilerOptions ?? {}
    const base = resolve(root, typeof co.baseUrl === 'string' ? co.baseUrl : '.')
    if (typeof co.baseUrl === 'string') baseUrls.push(base)
    for (const [pattern, targets] of Object.entries<any>(co.paths ?? {})) {
      if (!Array.isArray(targets)) continue
      const star = pattern.indexOf('*')
      aliases.push({
        prefix: star >= 0 ? pattern.slice(0, star) : pattern,
        suffix: star >= 0 ? pattern.slice(star + 1) : '',
        wildcard: star >= 0,
        targets: targets.filter((t) => typeof t === 'string').map((t) => resolve(base, t)),
      })
    }
  }
  // Longest prefix first, so "@app/ui/*" beats "@app/*".
  aliases.sort((a, b) => b.prefix.length - a.prefix.length)
  return { aliases, baseUrls }
}

/* ------------------------------ JS / TS ---------------------------------- */

const STATIC_IMPORT = /(?:^|[^.\w$])(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/g
const CALL_IMPORT = /(?:^|[^.\w$])(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g

/** Module specifiers imported by a JS/TS source file. */
export function jsImports(code: string): string[] {
  const out: string[] = []
  for (const re of [STATIC_IMPORT, CALL_IMPORT]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) out.push(m[1])
  }
  return out
}

/** The npm package a bare specifier refers to ("@scope/pkg/sub" → "@scope/pkg"). */
export function packageName(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || /^[a-z]+:\/\//i.test(spec)) return null
  const parts = spec.split('/')
  return spec.startsWith('@') ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0]
}

async function resolveJsFile(base: string): Promise<string | null> {
  const candidates: string[] = [base]
  const m = base.match(/\.(m|c)?js$/)
  if (m) {
    const stem = base.slice(0, -m[0].length)
    candidates.push(`${stem}.${m[1] ?? ''}ts`, `${stem}.tsx`)
  }
  for (const e of JS_EXT) candidates.push(base + e)
  for (const e of JS_EXT) candidates.push(join(base, 'index' + e))
  for (const c of candidates) if (await isFile(c)) return c
  return null
}

/* -------------------------------- Python --------------------------------- */

const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm
// Names may span lines only inside parentheses: `from x import (\n a,\n b,\n)`.
const PY_FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm

/** Python imports as { module, names } (relative modules keep their dots). */
export function pyImports(code: string): { module: string; names: string[] }[] {
  const out: { module: string; names: string[] }[] = []
  PY_IMPORT.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PY_IMPORT.exec(code))) {
    for (const part of m[1].split(',')) out.push({ module: part.trim().split(/\s+/)[0], names: [] })
  }
  PY_FROM.lastIndex = 0
  while ((m = PY_FROM.exec(code))) {
    const names = m[2]
      .replace(/[()\\]/g, '')
      .split(',')
      .map((s) => s.trim().split(/\s+/)[0])
      .filter((s) => /^\w+$/.test(s))
    out.push({ module: m[1], names })
  }
  return out
}

/** Dotted module name → file, for every .py file under the Python source roots. */
function pythonModuleIndex(files: string[], sourceRoots: string[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const f of files) {
    if (!f.endsWith('.py')) continue
    for (const r of sourceRoots) {
      const rel = toPosix(relative(r, f))
      if (rel.startsWith('..')) continue
      const mod = rel.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/').join('.')
      if (mod && !index.has(mod)) index.set(mod, f)
    }
  }
  return index
}

/** Longest known module that `dotted` (or `dotted.name`) refers to. */
function resolvePyModule(dotted: string, names: string[], index: Map<string, string>): string | null {
  for (const n of names) {
    const hit = index.get(`${dotted}.${n}`)
    if (hit) return hit
  }
  const parts = dotted.split('.')
  for (let i = parts.length; i > 0; i--) {
    const hit = index.get(parts.slice(0, i).join('.'))
    if (hit) return hit
  }
  return null
}

/* --------------------------------- Build --------------------------------- */

/**
 * Build the component import graph for a repo, or null when the repo has no
 * component structure to speak of (fewer than two source folders).
 */
export async function buildImportGraph(root: string): Promise<ImportGraph | null> {
  const croot = await componentRoot(root)
  if (!croot) return null

  // Components and their files.
  const budget = { left: MAX_FILES }
  const comps: { comp: Component; abs: string }[] = []
  const fileComp = new Map<string, Component>()
  const allFiles: string[] = []
  for (const d of (await listDir(croot)).filter(isSourceDir).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(croot, d.name)
    const files: string[] = []
    await collectFiles(abs, files, budget)
    if (files.length === 0) continue
    const py = files.filter((f) => f.endsWith('.py')).length
    const comp: Component = {
      id: toPosix(relative(root, abs)),
      dir: toPosix(relative(root, abs)),
      label: d.name,
      files: files.length,
      lang: py > files.length / 2 ? 'py' : 'js',
      packages: new Set(),
    }
    comps.push({ comp, abs })
    for (const f of files) fileComp.set(f, comp)
    allFiles.push(...files)
  }
  if (comps.length < 2) return null
  const truncated = budget.left <= 0

  const { aliases, baseUrls } = await loadTsAliases(root)
  const pyRoots = [root, join(root, 'src'), dirname(croot)]
  const pyIndex = pythonModuleIndex(allFiles, pyRoots)

  const resolveJs = async (from: string, spec: string): Promise<string | null> => {
    if (spec.startsWith('.')) return resolveJsFile(resolve(dirname(from), spec))
    for (const a of aliases) {
      if (a.wildcard ? spec.startsWith(a.prefix) && spec.endsWith(a.suffix) : spec === a.prefix) {
        const mid = a.wildcard ? spec.slice(a.prefix.length, spec.length - a.suffix.length) : ''
        for (const t of a.targets) {
          const hit = await resolveJsFile(t.replace('*', mid))
          if (hit) return hit
        }
      }
    }
    for (const b of baseUrls) {
      const hit = await resolveJsFile(resolve(b, spec))
      if (hit) return hit
    }
    return null
  }

  const counts = new Map<string, number>()
  for (const file of allFiles) {
    const from = fileComp.get(file)!
    let code: string
    try {
      if ((await stat(file)).size > MAX_FILE_BYTES) continue
      code = await readFile(file, 'utf8')
    } catch {
      continue
    }

    const targets: string[] = []
    if (file.endsWith('.py')) {
      for (const { module, names } of pyImports(code)) {
        let dotted = module
        if (module.startsWith('.')) {
          // Relative: resolve against the importing file's package.
          const dots = module.match(/^\.+/)![0].length
          const rest = module.slice(dots)
          const pkgDir = file.endsWith('__init__.py') ? dirname(file) : dirname(file)
          let base = pkgDir
          for (let i = 1; i < dots; i++) base = dirname(base)
          const rel = pyRoots.map((r) => toPosix(relative(r, base))).find((r) => !r.startsWith('..')) ?? ''
          dotted = [rel.split('/').filter(Boolean).join('.'), rest].filter(Boolean).join('.')
        }
        const hit = resolvePyModule(dotted, names, pyIndex)
        if (hit) targets.push(hit)
        else if (!module.startsWith('.')) from.packages.add(module.split('.')[0].toLowerCase().replace(/_/g, '-'))
      }
    } else {
      for (const spec of jsImports(code)) {
        const hit = await resolveJs(file, spec)
        if (hit) targets.push(hit)
        else {
          const pkg = packageName(spec)
          if (pkg) from.packages.add(pkg)
        }
      }
    }

    for (const t of targets) {
      const to = fileComp.get(t)
      if (!to || to === from) continue
      const key = `${from.id}\u0000${to.id}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const edges: ImportEdge[] = [...counts]
    .map(([k, count]) => {
      const [source, target] = k.split('\u0000')
      return { source, target, count }
    })
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))

  return { components: comps.map((c) => c.comp), edges, files: allFiles.length, truncated }
}
