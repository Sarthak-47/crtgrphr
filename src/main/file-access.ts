/**
 * Which files the renderer may open or write, decided in the main process.
 *
 * A file becomes known only when the user picks it in a native Open or Save
 * dialog. Known files are remembered (by their real path, symlinks resolved) in
 * the app's data folder, so the Recent list works after a restart, but the
 * renderer can't add to the list: asking to open any other path is refused.
 *
 * Writes go only to files approved this session, and only if the path still
 * resolves to the same real file it did when approved (so a symlink swapped in
 * afterwards can't redirect a save). Reads are bounded on the open file handle,
 * so a file that grows between "how big is it" and "read it" can't slip past
 * the size limit.
 */
import { open, readFile, realpath, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { GuardError } from './guards'

export const MAX_KNOWN_FILES = 50

/** The real path of `p` (symlinks resolved); for a file that doesn't exist yet, its real folder + name. */
export async function realPath(p: string): Promise<string> {
  const abs = resolve(p)
  try {
    return await realpath(abs)
  } catch {
    try {
      return resolve(await realpath(dirname(abs)), abs.slice(dirname(abs).length + 1))
    } catch {
      return abs
    }
  }
}

const key = (p: string): string => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p)

export class FileAccess {
  /** files the user picked in a dialog, ever (persisted), by real path */
  private known: string[] = []
  /** files writable this session: requested path → real path at approval */
  private writable = new Map<string, string>()
  private loaded = false

  constructor(private storeFile: string | null) {}

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!this.storeFile) return
    try {
      const list = JSON.parse(await readFile(this.storeFile, 'utf8'))
      if (Array.isArray(list)) this.known = list.filter((p): p is string => typeof p === 'string').slice(0, MAX_KNOWN_FILES)
    } catch {
      /* first run, or unreadable: start empty */
    }
  }

  private async save(): Promise<void> {
    if (!this.storeFile) return
    try {
      await mkdir(dirname(this.storeFile), { recursive: true })
      await writeFile(this.storeFile, JSON.stringify(this.known, null, 1), 'utf8')
    } catch {
      /* the list is a convenience; failing to save it only costs Recent entries */
    }
  }

  /** The user picked `p` in a native dialog: remember it and allow writing it this session. */
  async grant(p: string): Promise<string> {
    await this.load()
    const abs = resolve(p)
    const real = await realPath(abs)
    this.writable.set(key(abs), real)
    this.known = [real, ...this.known.filter((k) => key(k) !== key(real))].slice(0, MAX_KNOWN_FILES)
    await this.save()
    return abs
  }

  /** May the renderer open `p` without a dialog (from the Recent list)? */
  async mayOpen(p: string): Promise<boolean> {
    await this.load()
    const real = await realPath(p)
    return this.known.some((k) => key(k) === key(real))
  }

  /** A file opened from Recent becomes writable for this session, like one picked in a dialog. */
  async grantKnown(p: string): Promise<string> {
    const abs = resolve(p)
    this.writable.set(key(abs), await realPath(abs))
    return abs
  }

  /** Throws unless `p` was approved this session and still points at the same real file. */
  async checkWrite(p: string): Promise<string> {
    const abs = resolve(p)
    const approved = this.writable.get(key(abs))
    if (!approved) throw new GuardError('That file was not opened or saved in this session; use Save As.')
    if (key(await realPath(abs)) !== key(approved)) throw new GuardError(`${abs} now points somewhere else (a link was changed); use Save As.`)
    return abs
  }

  /** Forget a file (e.g. it no longer exists). */
  async forget(p: string): Promise<void> {
    await this.load()
    const real = await realPath(p)
    this.known = this.known.filter((k) => key(k) !== key(real) && key(k) !== key(resolve(p)))
    await this.save()
  }
}

/**
 * Read a text file of at most `max` bytes. The size is checked on the open
 * handle while reading, not with a separate stat first, so it can't change
 * between the check and the read.
 */
export async function readBounded(p: string, max: number): Promise<string> {
  const fh = await open(p, 'r')
  try {
    const info = await fh.stat()
    if (!info.isFile()) throw new Error('not a file')
    if (info.size > max) throw new GuardError(`${p} is too large to be a map (${Math.round(info.size / 1048576)} MB)`)
    const buf = Buffer.alloc(Math.min(info.size, max) + 1)
    let n = 0
    for (;;) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n)
      if (bytesRead === 0) break
      n += bytesRead
      if (n > max) throw new GuardError(`${p} is too large to be a map`)
    }
    return buf.subarray(0, n).toString('utf8')
  } finally {
    await fh.close()
  }
}
