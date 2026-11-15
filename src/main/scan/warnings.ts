/**
 * Scan warnings: things a scan skipped or couldn't read (a malformed compose
 * file, YAML that doesn't parse, files too large to read, the file limit), so a
 * map is never quietly incomplete. Collected per scan through AsyncLocalStorage,
 * so concurrent scans keep their own lists and no scanner signature changes.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<Map<string, number>>()

/** Record a warning. The same message is counted once per scan, not repeated. */
export function warn(message: string): void {
  const m = store.getStore()
  if (m) m.set(message, (m.get(message) ?? 0) + 1)
}

/** Record one of many similar problems: reported as "N <what>, e.g. <example>". */
export function warnMany(kind: string, example: string): void {
  const m = store.getStore()
  if (!m) return
  const key = `\u0000${kind}`
  m.set(key, (m.get(key) ?? 0) + 1)
  if (!m.has(`\u0001${kind}`)) m.set(`\u0001${kind}\u0002${example}`, 0)
  m.set(`\u0001${kind}`, 0)
}

/** Run `fn` collecting the warnings it records. */
export async function collectWarnings<T>(fn: () => Promise<T>): Promise<{ value: T; warnings: string[] }> {
  const m = new Map<string, number>()
  const value = await store.run(m, fn)
  const warnings: string[] = []
  for (const [key, count] of m) {
    if (key.startsWith('\u0001')) continue
    if (key.startsWith('\u0000')) {
      const kind = key.slice(1)
      const ex = [...m.keys()].find((k) => k.startsWith(`\u0001${kind}\u0002`))?.split('\u0002')[1]
      warnings.push(`${count} ${kind}${ex ? `, e.g. ${ex}` : ''}`)
    } else warnings.push(message(key, count))
  }
  return { value, warnings }
}

const message = (key: string, count: number): string => (count > 1 ? `${key} (×${count})` : key)
