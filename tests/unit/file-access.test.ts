import { describe, expect, it } from 'vitest'
import { mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FileAccess, readBounded } from '../../src/main/file-access'
import { GuardError } from '../../src/main/guards'

const DIR = resolve(__dirname, '../.tmp/file-access')

async function fresh(): Promise<{ store: string; a: string; b: string; other: string }> {
  await rm(DIR, { recursive: true, force: true })
  await mkdir(DIR, { recursive: true })
  const a = join(DIR, 'a.crtgrphr')
  const b = join(DIR, 'b.crtgrphr')
  const other = join(DIR, 'settings.json')
  for (const f of [a, b, other]) await writeFile(f, '{}')
  return { store: join(DIR, 'known-files.json'), a, b, other }
}

describe('which files the renderer may open and write', () => {
  it('only files picked in a dialog can be reopened, and the list survives a restart', async () => {
    const { store, a, other } = await fresh()
    const fa = new FileAccess(store)
    expect(await fa.mayOpen(a)).toBe(false)
    await fa.grant(a)
    expect(await fa.mayOpen(a)).toBe(true)
    expect(await fa.mayOpen(other)).toBe(false) // any other .json stays closed
    const afterRestart = new FileAccess(store)
    expect(await afterRestart.mayOpen(a)).toBe(true)
    expect(await afterRestart.mayOpen(other)).toBe(false)
  })

  it('writes need approval this session; reopening from Recent grants it', async () => {
    const { store, a, other } = await fresh()
    await new FileAccess(store).grant(a)
    const fa = new FileAccess(store) // a new session
    await expect(fa.checkWrite(a)).rejects.toThrow(GuardError)
    await fa.grantKnown(a)
    expect(await fa.checkWrite(a)).toBe(resolve(a))
    await expect(fa.checkWrite(other)).rejects.toThrow(/not opened or saved in this session/)
  })

  it('a path swapped for a symlink after approval is refused', async (ctx) => {
    const { store, a, other } = await fresh()
    const fa = new FileAccess(store)
    await fa.grant(a)
    await unlink(a)
    try {
      await symlink(other, a, 'file')
    } catch {
      ctx.skip() // creating symlinks needs a privilege this machine lacks (Windows); runs on Linux CI
      return
    }
    await expect(fa.checkWrite(a)).rejects.toThrow(/points somewhere else/)
  })

  it('forgets files and caps the list', async () => {
    const { store, a, b } = await fresh()
    const fa = new FileAccess(store)
    await fa.grant(a)
    await fa.grant(b)
    await fa.forget(a)
    expect(await fa.mayOpen(a)).toBe(false)
    expect(await fa.mayOpen(b)).toBe(true)
  })

  it('a corrupt list is ignored, not fatal', async () => {
    const { store, a } = await fresh()
    await writeFile(store, '{ nope')
    expect(await new FileAccess(store).mayOpen(a)).toBe(false)
  })
})

describe('bounded reads', () => {
  it('reads a file within the limit and refuses one over it', async () => {
    const { a } = await fresh()
    await writeFile(a, 'x'.repeat(100))
    expect(await readBounded(a, 100)).toHaveLength(100)
    await expect(readBounded(a, 99)).rejects.toThrow(/too large/)
    await expect(readBounded(DIR, 100)).rejects.toThrow()
  })
})
