/**
 * Input checks for everything that crosses from the renderer into the main
 * process. The renderer is treated as untrusted: a crafted project file, a bug, or
 * a compromised dependency must not be able to write outside what the user chose,
 * send data to an unexpected host, or exhaust memory. Pure functions, unit-tested.
 */

/** Largest map file we open (a real map is a few hundred KB). */
export const MAX_MAP_BYTES = 25 * 1024 * 1024
/** Largest text the renderer may ask us to save (maps, SVG, Mermaid, draw.io...). */
export const MAX_TEXT_BYTES = 50 * 1024 * 1024
/** Largest PNG export, decoded. */
export const MAX_PNG_BYTES = 64 * 1024 * 1024
/** Clipboard text and dialog strings. */
export const MAX_CLIPBOARD_BYTES = 10 * 1024 * 1024

export class GuardError extends Error {}

/** Only the app's own page may call into the main process. */
export function isTrustedSender(frameUrl: string | undefined, devUrl: string | undefined): boolean {
  if (!frameUrl) return false
  if (devUrl && frameUrl.startsWith(devUrl)) return true
  try {
    const u = new URL(frameUrl)
    return u.protocol === 'file:' && /\/renderer\/index\.html$/.test(decodeURIComponent(u.pathname))
  } catch {
    return false
  }
}

export function str(v: unknown, what: string, max = 10_000): string {
  if (typeof v !== 'string') throw new GuardError(`${what} must be text`)
  if (v.length > max) throw new GuardError(`${what} is too long`)
  return v
}

/** A suggested file name: a bare name with no folders or characters Windows rejects. */
export function cleanFileName(v: unknown, fallback: string): string {
  const raw = typeof v === 'string' ? v : ''
  const base = raw.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 120)
  return clean || fallback
}

export interface SaveFilter {
  name: string
  extensions: string[]
}

/** Dialog filters: a few named groups of plain extensions. */
export function cleanFilters(v: unknown): SaveFilter[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: SaveFilter[] = []
  for (const f of v.slice(0, 5)) {
    if (!f || typeof f !== 'object') continue
    const name = typeof (f as SaveFilter).name === 'string' ? (f as SaveFilter).name.slice(0, 40) : 'File'
    const exts = Array.isArray((f as SaveFilter).extensions) ? (f as SaveFilter).extensions : []
    const extensions = exts.filter((e): e is string => typeof e === 'string' && /^[a-z0-9]{1,10}$/i.test(e)).slice(0, 5)
    if (extensions.length) out.push({ name, extensions })
  }
  return out.length ? out : undefined
}

/** Text to write to disk: must be a string, within the size limit. */
export function cleanText(v: unknown, max = MAX_TEXT_BYTES): string {
  if (typeof v !== 'string') throw new GuardError('Nothing to save: the content was not text')
  if (Buffer.byteLength(v, 'utf8') > max) throw new GuardError(`That is too large to save (over ${Math.round(max / 1048576)} MB)`)
  return v
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A data:image/png;base64 URL → its bytes, if it really is a PNG within the limit. */
export function decodePngDataUrl(v: unknown, max = MAX_PNG_BYTES): Buffer {
  if (typeof v !== 'string') throw new GuardError('The image data is missing')
  const prefix = 'data:image/png;base64,'
  if (!v.startsWith(prefix)) throw new GuardError('The image is not a PNG')
  const b64 = v.slice(prefix.length)
  // base64 is 4 characters per 3 bytes: reject before decoding anything oversized.
  if (b64.length > Math.ceil(max / 3) * 4) throw new GuardError(`The image is too large (over ${Math.round(max / 1048576)} MB)`)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new GuardError('The image data is corrupted')
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new GuardError('The image is not a valid PNG')
  return bytes
}

export type HostKind = 'loopback' | 'private' | 'public'

/** Where an http(s) URL points: this machine, the local network, or the internet. */
export function hostKind(hostname: string): HostKind {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h) || h === '0.0.0.0') return 'loopback'
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) return 'private'
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return 'private'
  if (h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.internal') || h.endsWith('.home.arpa') || !h.includes('.')) return 'private'
  return 'public'
}

export interface CheckedUrl {
  url: string
  kind: HostKind
}

/**
 * An Ollama endpoint: http or https, no credentials, no query or fragment.
 * Returns the normalised origin + path and where it points; null if unusable.
 */
export function checkOllamaUrl(v: unknown): CheckedUrl | null {
  if (typeof v !== 'string' || v.length > 2000) return null
  let u: URL
  try {
    u = new URL(v.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password || u.search || u.hash) return null
  const path = u.pathname.replace(/\/+$/, '')
  return { url: `${u.protocol}//${u.host}${path}`, kind: hostKind(u.hostname) }
}

/** Links the app may hand to the system browser: plain web pages only. */
export function isSafeExternalUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
  } catch {
    return false
  }
}
