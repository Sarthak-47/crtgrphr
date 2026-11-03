import { describe, expect, it } from 'vitest'
import { dirnamePath, isAbsolutePath, isInside, joinPath, normalizePath, relativePath } from '../../src/shared/paths'

describe('paths', () => {
  it('normalizes separators, dots and drive letters', () => {
    expect(normalizePath('C:\\code\\repo\\.\\src\\..\\docs\\')).toBe('C:/code/repo/docs')
    expect(normalizePath('c:/x')).toBe('C:/x')
    expect(normalizePath('/home/u/./a/../b')).toBe('/home/u/b')
    expect(normalizePath('\\\\server\\share\\dir\\f')).toBe('//server/share/dir/f')
    expect(normalizePath('a/../../b')).toBe('../b')
    expect(normalizePath('C:/..')).toBe('C:/')
  })

  it('isAbsolutePath', () => {
    expect(isAbsolutePath('C:\\x')).toBe(true)
    expect(isAbsolutePath('/x')).toBe(true)
    expect(isAbsolutePath('\\\\srv\\share')).toBe(true)
    expect(isAbsolutePath('x/y')).toBe(false)
    expect(isAbsolutePath('../x')).toBe(false)
  })

  it('dirnamePath', () => {
    expect(dirnamePath('C:/code/repo/map.crtgrphr')).toBe('C:/code/repo')
    expect(dirnamePath('C:/map.crtgrphr')).toBe('C:/')
    expect(dirnamePath('/map')).toBe('/')
  })

  it('relativePath between folders on the same drive (case-insensitive on Windows)', () => {
    expect(relativePath('C:/code/repo/docs', 'C:/code/repo')).toBe('..')
    expect(relativePath('C:/code/repo', 'c:\\Code\\Repo')).toBe('.')
    expect(relativePath('C:/code/repo', 'C:/code/repo/src/main')).toBe('src/main')
    expect(relativePath('C:/a/b', 'C:/c/d')).toBe('../../c/d')
    expect(relativePath('/home/u/maps', '/home/u/repo')).toBe('../repo')
  })

  it('relativePath is null when no relative path exists', () => {
    expect(relativePath('C:/maps', 'D:/repo')).toBeNull()
    expect(relativePath('C:/maps', '//srv/share/repo')).toBeNull()
    expect(relativePath('relative', 'C:/x')).toBeNull()
  })

  it('joinPath resolves relative against a base and keeps absolutes', () => {
    expect(joinPath('C:/code/repo/docs', '..')).toBe('C:/code/repo')
    expect(joinPath('C:/code/repo/docs', 'D:/other')).toBe('D:/other')
    expect(joinPath('/home/u/maps', '../repo')).toBe('/home/u/repo')
  })

  it('round-trips: join(from, relative(from, to)) === to', () => {
    for (const [from, to] of [
      ['C:/code/repo/docs', 'C:/code/repo'],
      ['C:/a', 'C:/a/b/c'],
      ['/x/y/z', '/q'],
    ]) {
      expect(joinPath(from, relativePath(from, to)!)).toBe(normalizePath(to))
    }
  })

  it('isInside guards against traversal', () => {
    expect(isInside('C:/repo', 'C:/repo/src/a.ts')).toBe(true)
    expect(isInside('C:/repo', 'C:/repo')).toBe(true)
    expect(isInside('C:/repo', 'C:/repo/../etc')).toBe(false)
    expect(isInside('C:/repo', 'C:/repository')).toBe(false)
    expect(isInside('C:/repo', 'D:/repo/x')).toBe(false)
  })
})
