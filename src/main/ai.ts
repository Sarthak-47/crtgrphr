/**
 * AI providers for "Describe your system". Runs in the main process only, so an
 * API key never reaches the renderer. Pure Node (no Electron imports): settings
 * and key storage live in ai-settings.ts.
 *
 * - Ollama (default): a model running on this machine; nothing leaves it.
 * - Anthropic (opt-in): the official SDK with the user's own key.
 *
 * Both are constrained to GENERATION_SCHEMA; answers are parsed and sanitized,
 * and one invalid answer gets a single repair attempt with the error fed back.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  GENERATION_SCHEMA,
  GenerationError,
  SYSTEM_PROMPT,
  parseGeneration,
  userPrompt,
  type Generated,
  type GenerationRequest,
} from '../shared/ai'

export type Provider = 'ollama' | 'anthropic'

export interface AiSettings {
  provider: Provider
  ollamaUrl: string
  ollamaModel: string
  anthropicModel: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5:7b',
  anthropicModel: 'claude-opus-5-5',
}

type Turn = { role: 'user' | 'assistant'; content: string }

/** One raw completion: the provider's text answer for these turns. */
type Complete = (turns: Turn[]) => Promise<string>

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/* --------------------------------- Ollama -------------------------------- */

function ollamaComplete(s: AiSettings, timeoutMs: number): Complete {
  const base = s.ollamaUrl.replace(/\/+$/, '')
  return async (turns) => {
    let res: Response
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: s.ollamaModel,
          stream: false,
          format: GENERATION_SCHEMA,
          options: { temperature: 0.2 },
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...turns],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const why = errorText(e)
      if (/abort|timeout/i.test(why)) throw new GenerationError(`Ollama didn't answer within ${Math.round(timeoutMs / 1000)} s.`, false)
      throw new GenerationError(
        `Couldn't reach Ollama at ${base}. Install it from ollama.com, start it, and run "ollama pull ${s.ollamaModel}".`,
        false,
      )
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 404 && /model/i.test(body)) {
        throw new GenerationError(`Ollama doesn't have the model "${s.ollamaModel}". Run "ollama pull ${s.ollamaModel}", or pick another model in AI settings.`, false)
      }
      throw new GenerationError(`Ollama returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`, false)
    }
    const data = (await res.json().catch(() => null)) as { message?: { content?: unknown } } | null
    const text = data?.message?.content
    if (typeof text !== 'string') throw new GenerationError('Ollama returned an unexpected response.', false)
    return text
  }
}

/* -------------------------------- Anthropic ------------------------------ */

function anthropicComplete(s: AiSettings, apiKey: string, timeoutMs: number): Complete {
  const client = new Anthropic({
    apiKey,
    // Test hook only: E2E points this at a local mock server.
    baseURL: process.env.CRTGRPHR_ANTHROPIC_BASE_URL || undefined,
    timeout: timeoutMs,
    maxRetries: 2, // the SDK retries 408/409/429/5xx and connection errors
  })
  return async (turns) => {
    let res: Anthropic.Beta.BetaMessage
    try {
      res = await client.beta.messages.create({
        model: s.anthropicModel,
        max_tokens: 16000,
        // If the model declines, the API re-runs the request on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: GENERATION_SCHEMA as unknown as Record<string, unknown> } },
        system: SYSTEM_PROMPT,
        messages: turns,
      })
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new GenerationError('The Anthropic API key was rejected. Check it in AI settings.', false)
      if (e instanceof Anthropic.PermissionDeniedError) throw new GenerationError(`This API key can't use ${s.anthropicModel}.`, false)
      if (e instanceof Anthropic.NotFoundError) throw new GenerationError(`Unknown model "${s.anthropicModel}". Check the model in AI settings.`, false)
      if (e instanceof Anthropic.RateLimitError) throw new GenerationError('The Anthropic API is rate-limiting this key. Try again in a minute.', false)
      if (e instanceof Anthropic.BadRequestError) throw new GenerationError(`The Anthropic API rejected the request: ${e.message}`, false)
      if (e instanceof Anthropic.APIConnectionError) throw new GenerationError("Couldn't reach the Anthropic API. Check your internet connection.", false)
      if (e instanceof Anthropic.APIError) throw new GenerationError(`Anthropic API error ${e.status ?? ''}: ${e.message}`, false)
      throw new GenerationError(errorText(e), false)
    }
    if (res.stop_reason === 'refusal') {
      throw new GenerationError('The model declined to draw this description. Try rephrasing it.', false)
    }
    if (res.stop_reason === 'max_tokens') {
      throw new GenerationError('The answer was cut off. Describe a smaller part of the system.', true)
    }
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    if (!text) throw new GenerationError('The model returned no answer.', false)
    return text
  }
}

/* --------------------------------- Driver -------------------------------- */

export interface GenerateOptions {
  settings: AiSettings
  apiKey?: string | null
  timeoutMs?: number
}

/** Generate a diagram; one repair round if the first answer doesn't validate. */
export async function generateDiagram(req: GenerationRequest, opts: GenerateOptions): Promise<Generated & { attempts: number }> {
  if (!req.description.trim()) throw new GenerationError('Describe the system first.', false)
  const s = opts.settings
  const timeoutMs = opts.timeoutMs ?? 180_000
  let complete: Complete
  if (s.provider === 'anthropic') {
    if (!opts.apiKey) throw new GenerationError('Add your Anthropic API key in AI settings, or switch to the local Ollama provider.', false)
    complete = anthropicComplete(s, opts.apiKey, timeoutMs)
  } else {
    complete = ollamaComplete(s, timeoutMs)
  }

  const turns: Turn[] = [{ role: 'user', content: userPrompt(req) }]
  const first = await complete(turns)
  try {
    return { ...parseGeneration(first, req), attempts: 1 }
  } catch (e) {
    if (!(e instanceof GenerationError) || !e.repairable) throw e
    turns.push({ role: 'assistant', content: first }, { role: 'user', content: `${e.message} Return the corrected JSON object.` })
    const second = await complete(turns)
    try {
      return { ...parseGeneration(second, req), attempts: 2 }
    } catch (e2) {
      throw new GenerationError(`The model's answer still wasn't a usable diagram: ${errorText(e2)}`, false)
    }
  }
}

/** Cheap connectivity check for the settings screen. */
export async function testConnection(settings: AiSettings, apiKey?: string | null): Promise<string> {
  if (settings.provider === 'ollama') {
    const base = settings.ollamaUrl.replace(/\/+$/, '')
    let res: Response
    try {
      res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
    } catch {
      throw new GenerationError(`Couldn't reach Ollama at ${base}. Is it running?`, false)
    }
    const data = (await res.json().catch(() => null)) as { models?: { name?: string }[] } | null
    const names = (data?.models ?? []).map((m) => m.name ?? '')
    const has = names.some((n) => n === settings.ollamaModel || n.split(':')[0] === settings.ollamaModel.split(':')[0])
    if (!has) {
      throw new GenerationError(
        `Ollama is running, but "${settings.ollamaModel}" isn't installed. Run "ollama pull ${settings.ollamaModel}".${names.length ? ` Installed: ${names.join(', ')}.` : ''}`,
        false,
      )
    }
    return `Connected to Ollama; ${settings.ollamaModel} is ready.`
  }
  if (!apiKey) throw new GenerationError('No Anthropic API key set.', false)
  const client = new Anthropic({ apiKey, baseURL: process.env.CRTGRPHR_ANTHROPIC_BASE_URL || undefined, timeout: 15_000, maxRetries: 1 })
  try {
    await client.models.retrieve(settings.anthropicModel)
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new GenerationError('The API key was rejected.', false)
    if (e instanceof Anthropic.NotFoundError) throw new GenerationError(`Unknown model "${settings.anthropicModel}".`, false)
    if (e instanceof Anthropic.APIConnectionError) throw new GenerationError("Couldn't reach the Anthropic API.", false)
    throw new GenerationError(errorText(e), false)
  }
  return `Connected to the Anthropic API; ${settings.anthropicModel} is available.`
}
