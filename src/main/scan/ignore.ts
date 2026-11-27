/**
 * The repository's own .gitignore, applied to folders during a scan: build output,
 * local tooling and generated code the project ignores are not parts of the system
 * (a git-ignored folder with its own package.json used to show up as a project).
 *
 * Only the root .gitignore is read, and only folders are tested. Supported: comments,
 * blank lines, negation (!), folder-only patterns (trailing /), rooted patterns
 * (leading or inner /), and the globs *, ** and ?.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

interface Rule {
  re: RegExp
  negate: boolean
  /** matched against the whole root-relative path, or else against the folder's name */
  anchored: boolean
}

function globToRegExp(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

/** A tester for root-relative folder paths ("a/b"): true when the .gitignore ignores the folder. */
export function compileGitignore(text: string): (relDir: string) => boolean {
  const rules: Rule[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, '')
    if (!line || line.startsWith('#')) continue
    const negate = line.startsWith('!')
    if (negate) line = line.slice(1)
    if (line.startsWith('\\')) line = line.slice(1)
    line = line.replace(/\/+$/, '') // folder-only marker: we only test folders anyway
    if (!line) continue
    const anchored = line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    rules.push({ re: new RegExp(`^${globToRegExp(line)}$`), negate, anchored })
  }
  return (relDir) => {
    const name = relDir.split('/').pop() ?? relDir
    let ignored = false
    for (const r of rules) if (r.re.test(r.anchored ? relDir : name)) ignored = !r.negate
    return ignored
  }
}

const current = new AsyncLocalStorage<{ root: string; test: (relDir: string) => boolean }>()

/** Run a scan of `root` with its .gitignore in effect for every folder it lists. */
export async function withGitignore<T>(root: string, fn: () => Promise<T>): Promise<T> {
  let text = ''
  try {
    text = await readFile(join(root, '.gitignore'), 'utf8')
  } catch {
    /* no .gitignore */
  }
  return current.run({ root, test: compileGitignore(text) }, fn)
}

/** Is this folder (absolute path) ignored by the scanned repository's .gitignore? */
export function isGitignoredDir(absDir: string): boolean {
  const ctx = current.getStore()
  if (!ctx) return false
  const rel = relative(ctx.root, resolve(absDir)).split(sep).join('/')
  if (!rel || rel.startsWith('..')) return false
  return ctx.test(rel)
}
