/**
 * Recently opened/saved maps, kept in the app's local storage (Electron's data
 * folder; for dev and test runs that folder is inside the project). Entries only
 * ever come from files the user successfully opened or saved.
 */
export interface RecentFile {
  path: string
  title: string
  at: number
}

const KEY = 'crtgrphr.recent.v1'
export const MAX_RECENT = 8

function read(): RecentFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((r) => r && typeof r.path === 'string' && typeof r.title === 'string' && typeof r.at === 'number')
      : []
  } catch {
    return []
  }
}

function write(list: RecentFile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: recents are a convenience, never an error */
  }
}

const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

export function getRecent(): RecentFile[] {
  return read().sort((a, b) => b.at - a.at)
}

export function addRecent(path: string, title: string): void {
  const list = read().filter((r) => !same(r.path, path))
  list.unshift({ path, title, at: Date.now() })
  write(list.slice(0, MAX_RECENT))
}

export function removeRecent(path: string): void {
  write(read().filter((r) => !same(r.path, path)))
}
