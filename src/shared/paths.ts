/**
 * Small, dependency-free path helpers usable in every process (the renderer has
 * no Node `path`). Handle both Windows (C:\…, \\server\share) and POSIX paths.
 * Results use forward slashes; Windows accepts them everywhere we use paths.
 */

const DRIVE = /^[A-Za-z]:/

/** Root of an absolute path ("C:/", "/" or "//server/share/"), or "" if relative. */
function rootOf(p: string): string {
  if (DRIVE.test(p)) return p.slice(0, 2).toUpperCase() + '/'
  if (p.startsWith('//')) {
    const parts = p.slice(2).split('/')
    return parts.length >= 2 ? `//${parts[0]}/${parts[1]}/` : '//'
  }
  if (p.startsWith('/')) return '/'
  return ''
}

export function isAbsolutePath(p: string): boolean {
  return rootOf(p.replace(/\\/g, '/')) !== ''
}

/** Forward slashes, no "." segments, ".." resolved, no trailing slash (except roots). */
export function normalizePath(p: string): string {
  const s = p.replace(/\\/g, '/')
  const root = rootOf(s)
  const rest = s.slice(root === '' ? 0 : root.startsWith('//') ? root.length : root.length).split('/')
  const out: string[] = []
  for (const seg of rest) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!root) out.push('..')
    } else out.push(seg)
  }
  const body = out.join('/')
  if (root) return root + body || root
  return body || '.'
}

export function dirnamePath(p: string): string {
  const n = normalizePath(p)
  const root = rootOf(n)
  const i = n.lastIndexOf('/')
  if (i < 0) return '.'
  if (i < root.length) return root
  return n.slice(0, i)
}

export function joinPath(base: string, rel: string): string {
  if (isAbsolutePath(rel)) return normalizePath(rel)
  return normalizePath(`${base}/${rel}`)
}

const segs = (p: string, root: string): string[] => p.slice(root.length).split('/').filter(Boolean)

/**
 * Relative path from directory `from` to `to` (both absolute). Returns null when
 * they share no root (different drives or shares), since no relative path exists.
 */
export function relativePath(from: string, to: string): string | null {
  const a = normalizePath(from)
  const b = normalizePath(to)
  const ra = rootOf(a)
  const rb = rootOf(b)
  if (!ra || !rb || ra.toLowerCase() !== rb.toLowerCase()) return null
  const sa = segs(a, ra)
  const sb = segs(b, rb)
  // Windows paths compare case-insensitively.
  const eq = (x: string, y: string) => (DRIVE.test(ra) || ra.startsWith('//') ? x.toLowerCase() === y.toLowerCase() : x === y)
  let i = 0
  while (i < sa.length && i < sb.length && eq(sa[i], sb[i])) i++
  const up = sa.slice(i).map(() => '..')
  const rel = [...up, ...sb.slice(i)].join('/')
  return rel || '.'
}

/** Is `child` the same as, or inside, `parent`? */
export function isInside(parent: string, child: string): boolean {
  const rel = relativePath(parent, child)
  return rel !== null && rel !== '..' && !rel.startsWith('../')
}
