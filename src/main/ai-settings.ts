/**
 * AI settings and the Anthropic API key, kept in the app's data folder (which,
 * for dev and test runs, is inside the project). The key is encrypted with the
 * OS keychain via Electron safeStorage and never leaves the main process. Where
 * encryption isn't available (some Linux setups), the key is held in memory for
 * this session only rather than written in plain text.
 */
import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_AI_SETTINGS, type AiSettings } from './ai'

const settingsFile = () => join(app.getPath('userData'), 'ai-settings.json')
const keyFile = () => join(app.getPath('userData'), 'ai-key.bin')

let sessionKey: string | null = null

function clean(input: unknown): AiSettings {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof AiSettings, unknown>>
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
  const url = str(s.ollamaUrl, DEFAULT_AI_SETTINGS.ollamaUrl)
  return {
    provider: s.provider === 'anthropic' ? 'anthropic' : 'ollama',
    ollamaUrl: /^https?:\/\//i.test(url) ? url : DEFAULT_AI_SETTINGS.ollamaUrl,
    ollamaModel: str(s.ollamaModel, DEFAULT_AI_SETTINGS.ollamaModel),
    anthropicModel: str(s.anthropicModel, DEFAULT_AI_SETTINGS.anthropicModel),
  }
}

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    return clean(JSON.parse(await readFile(settingsFile(), 'utf8')))
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export async function saveAiSettings(input: unknown): Promise<AiSettings> {
  const s = clean(input)
  await writeFile(settingsFile(), JSON.stringify(s, null, 2), 'utf8')
  return s
}

export const keyEncryptionAvailable = (): boolean => safeStorage.isEncryptionAvailable()

/** Store (or, with null/empty, remove) the API key. */
export async function setApiKey(key: string | null): Promise<{ persisted: boolean }> {
  const k = key?.trim() || null
  sessionKey = null
  await rm(keyFile(), { force: true })
  if (!k) return { persisted: false }
  if (keyEncryptionAvailable()) {
    await writeFile(keyFile(), safeStorage.encryptString(k))
    return { persisted: true }
  }
  sessionKey = k
  return { persisted: false }
}

export async function getApiKey(): Promise<string | null> {
  if (sessionKey) return sessionKey
  try {
    return safeStorage.decryptString(await readFile(keyFile()))
  } catch {
    return null
  }
}

/** Where the key is, without revealing it. */
export async function keyStatus(): Promise<'saved' | 'session' | 'none'> {
  if (sessionKey) return 'session'
  return (await getApiKey()) ? 'saved' : 'none'
}
