import { describe, expect, it } from 'vitest'
import {
  GuardError,
  MAX_TEXT_BYTES,
  checkOllamaUrl,
  cleanFileName,
  cleanFilters,
  cleanText,
  decodePngDataUrl,
  hostKind,
  isSafeExternalUrl,
  isTrustedSender,
  str,
} from '../../src/main/guards'

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('IPC sender', () => {
  it("accepts only the app's own page", () => {
    expect(isTrustedSender('file:///C:/Program%20Files/Cartographer/resources/app.asar/out/renderer/index.html', undefined)).toBe(true)
    expect(isTrustedSender('file:///home/u/app/out/renderer/index.html#x', undefined)).toBe(true)
    expect(isTrustedSender('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isTrustedSender('https://evil.example/renderer/index.html', undefined)).toBe(false)
    expect(isTrustedSender('file:///tmp/evil.html', undefined)).toBe(false)
    expect(isTrustedSender('http://localhost:5173/', undefined)).toBe(false)
    expect(isTrustedSender(undefined, undefined)).toBe(false)
  })
})

describe('input checks', () => {
  it('strings must be strings, within a limit', () => {
    expect(str('ok', 'x')).toBe('ok')
    expect(() => str(5, 'Path')).toThrow(GuardError)
    expect(() => str('x'.repeat(11), 'Path', 10)).toThrow(/too long/)
  })

  it('file names lose folders and characters Windows rejects', () => {
    expect(cleanFileName('../../etc/passwd', 'f')).toBe('passwd')
    expect(cleanFileName('C:\\Users\\x\\map.svg', 'f')).toBe('map.svg')
    expect(cleanFileName('a<b>:c"|?*.png', 'f')).toBe('abc.png')
    expect(cleanFileName('...hidden', 'f')).toBe('hidden')
    expect(cleanFileName(undefined, 'map')).toBe('map')
    expect(cleanFileName('x'.repeat(500), 'f')).toHaveLength(120)
  })

  it('dialog filters keep only plain extensions', () => {
    expect(cleanFilters([{ name: 'Map', extensions: ['crtgrphr'] }])).toEqual([{ name: 'Map', extensions: ['crtgrphr'] }])
    expect(cleanFilters([{ name: 'Bad', extensions: ['*', '../x', 'exe;rm'] }])).toBeUndefined()
    expect(cleanFilters('nope')).toBeUndefined()
  })

  it('text to save must be text and not huge', () => {
    expect(cleanText('{}')).toBe('{}')
    expect(() => cleanText({})).toThrow(GuardError)
    expect(() => cleanText('x'.repeat(11), 10)).toThrow(/too large/)
    expect(MAX_TEXT_BYTES).toBeGreaterThan(1_000_000)
  })
})

describe('PNG export data', () => {
  it('accepts a real PNG', () => {
    const b = decodePngDataUrl(PNG_1PX)
    expect(b.subarray(1, 4).toString()).toBe('PNG')
  })

  it('refuses anything that is not a PNG data URL, corrupted, or oversized', () => {
    expect(() => decodePngDataUrl(42)).toThrow(/missing/)
    expect(() => decodePngDataUrl('data:image/svg+xml;base64,PHN2Zy8+')).toThrow(/not a PNG/)
    expect(() => decodePngDataUrl('data:image/png;base64,' + Buffer.from('#!/bin/sh').toString('base64'))).toThrow(/not a valid PNG/)
    expect(() => decodePngDataUrl('data:image/png;base64,@@@@')).toThrow(/corrupted/)
    expect(() => decodePngDataUrl(PNG_1PX, 10)).toThrow(/too large/)
  })
})

describe('Ollama endpoint', () => {
  it('normalises http(s) URLs and says where they point', () => {
    expect(checkOllamaUrl('http://localhost:11434/')).toEqual({ url: 'http://localhost:11434', kind: 'loopback' })
    expect(checkOllamaUrl('http://127.0.0.1:11434')?.kind).toBe('loopback')
    expect(checkOllamaUrl('http://[::1]:11434')?.kind).toBe('loopback')
    expect(checkOllamaUrl('http://192.168.1.20:11434')?.kind).toBe('private')
    expect(checkOllamaUrl('http://gpu-box:11434')?.kind).toBe('private')
    expect(checkOllamaUrl('https://ollama.example.com')?.kind).toBe('public')
  })

  it('refuses other schemes, credentials and query strings', () => {
    expect(checkOllamaUrl('file:///etc/passwd')).toBeNull()
    expect(checkOllamaUrl('javascript:alert(1)')).toBeNull()
    expect(checkOllamaUrl('http://user:pw@localhost:11434')).toBeNull()
    expect(checkOllamaUrl('http://localhost:11434/?x=1')).toBeNull()
    expect(checkOllamaUrl('not a url')).toBeNull()
    expect(checkOllamaUrl(5)).toBeNull()
  })

  it('classifies hosts', () => {
    expect(hostKind('10.0.0.5')).toBe('private')
    expect(hostKind('172.20.1.1')).toBe('private')
    expect(hostKind('172.32.1.1')).toBe('public')
    expect(hostKind('nas.local')).toBe('private')
    expect(hostKind('api.openai.com')).toBe('public')
  })
})

describe('external links', () => {
  it('only plain web pages go to the browser', () => {
    expect(isSafeExternalUrl('https://ollama.com')).toBe(true)
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isSafeExternalUrl('smb://host/share')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('https://user:pw@example.com')).toBe(false)
  })
})
