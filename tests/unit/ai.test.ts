import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GENERATION_SCHEMA, MAX_GENERATED_NODES, SYSTEM_PROMPT, GenerationError, parseGeneration, userPrompt } from '../../src/shared/ai'
import { DEFAULT_AI_SETTINGS, generateDiagram, testConnection, type AiSettings } from '../../src/main/ai'
import { NODE_ROLES } from '../../src/shared/ir'

const GOOD = JSON.stringify({
  title: 'Shop',
  type: 'architecture',
  direction: 'RIGHT',
  nodes: [
    { id: 'web', label: 'Web app', role: 'frontend' },
    { id: 'api', label: 'API', sublabel: 'Node', role: 'backend' },
    { id: 'db', label: 'Postgres', role: 'database', brand: 'postgresql' },
  ],
  edges: [
    { source: 'web', target: 'api', label: 'REST' },
    { source: 'api', target: 'db', label: 'SQL', variant: 'emphasis' },
  ],
})

/* ------------------------------ Mock servers ------------------------------ */

interface Seen {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: any
}
let server: Server
let base = ''
let seen: Seen[] = []
let handler: (req: Seen, res: ServerResponse) => void = () => {}

beforeEach(async () => {
  seen = []
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const s: Seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null }
      seen.push(s)
      handler(s, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.CRTGRPHR_ANTHROPIC_BASE_URL = base
})
afterEach(async () => {
  delete process.env.CRTGRPHR_ANTHROPIC_BASE_URL
  await new Promise<void>((r) => server.close(() => r()))
})

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const ollama = (): AiSettings => ({ ...DEFAULT_AI_SETTINGS, provider: 'ollama', ollamaUrl: base, ollamaModel: 'test-model' })
const anthropic = (): AiSettings => ({ ...DEFAULT_AI_SETTINGS, provider: 'anthropic' })
const message = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 20 },
})

/* --------------------------------- Shared --------------------------------- */

describe('schema and prompt', () => {
  it('the schema offers exactly the IR roles (minus group) and requires the core fields', () => {
    const roles = GENERATION_SCHEMA.properties.nodes.items.properties.role.enum
    expect([...roles].sort()).toEqual(NODE_ROLES.filter((r) => r !== 'group').sort())
    expect(GENERATION_SCHEMA.required).toEqual(['title', 'type', 'nodes', 'edges'])
    expect(GENERATION_SCHEMA.additionalProperties).toBe(false)
    expect(JSON.stringify(GENERATION_SCHEMA)).not.toMatch(/"x"|"y"|position|width/) // no geometry
  })

  it('the user prompt carries the description and the requested type', () => {
    expect(userPrompt({ description: '  a shop  ', type: 'workflow' })).toBe('Make it a workflow diagram.\n\nDescription:\na shop')
    expect(userPrompt({ description: 'x' })).toMatch(/^Choose the diagram type/)
  })
})

describe('parseGeneration', () => {
  it('turns a good answer into a clean diagram with derived edge ids', () => {
    const { diagram, fixes } = parseGeneration(GOOD, { description: 'shop' })
    expect(fixes).toEqual([])
    expect(diagram.id).toBe('shop')
    expect(diagram.edges.map((e) => e.id)).toEqual(['web->api', 'api->db'])
  })

  it('accepts an answer wrapped in a code fence', () => {
    expect(parseGeneration('```json\n' + GOOD + '\n```', { description: 'x' }).diagram.nodes).toHaveLength(3)
  })

  it('reports repairable problems precisely', () => {
    const fail = (text: string) => {
      try {
        parseGeneration(text, { description: 'x' })
      } catch (e) {
        expect(e).toBeInstanceOf(GenerationError)
        expect((e as GenerationError).repairable).toBe(true)
        return (e as Error).message
      }
      throw new Error('expected a failure')
    }
    expect(fail('not json')).toMatch(/not valid JSON/)
    expect(fail(JSON.stringify({ title: 't', type: 'architecture', nodes: [], edges: [] }))).toMatch(/no nodes/)
    const many = Array.from({ length: MAX_GENERATED_NODES + 1 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, role: 'backend' }))
    expect(fail(JSON.stringify({ title: 't', type: 'architecture', nodes: many, edges: [] }))).toMatch(/at most 60/)
    const dangling = { title: 't', type: 'architecture', nodes: [{ id: 'a', label: 'a', role: 'backend' }], edges: [{ source: 'a', target: 'x' }, { source: 'y', target: 'a' }] }
    expect(fail(JSON.stringify(dangling))).toMatch(/node ids that do not exist/)
  })

  it('honours a requested type even if the model picked another', () => {
    const { diagram, fixes } = parseGeneration(GOOD, { description: 'x', type: 'dataflow' })
    expect(diagram.type).toBe('dataflow')
    expect(fixes).toContain('type set to dataflow as requested')
  })
})

/* --------------------------------- Ollama --------------------------------- */

describe('Ollama provider', () => {
  it('sends the system prompt and schema, and returns the diagram', async () => {
    handler = (_req, res) => json(res, 200, { message: { role: 'assistant', content: GOOD } })
    const out = await generateDiagram({ description: 'a shop' }, { settings: ollama() })
    expect(out.attempts).toBe(1)
    expect(out.diagram.nodes).toHaveLength(3)
    const body = seen[0].body
    expect(seen[0].url).toBe('/api/chat')
    expect(body.model).toBe('test-model')
    expect(body.stream).toBe(false)
    expect(body.format).toEqual(JSON.parse(JSON.stringify(GENERATION_SCHEMA)))
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT })
  })

  it('feeds a bad first answer back once and accepts the repair', async () => {
    let n = 0
    handler = (_req, res) => json(res, 200, { message: { content: n++ === 0 ? '{"title":"x","type":"architecture","nodes":[],"edges":[]}' : GOOD } })
    const out = await generateDiagram({ description: 'a shop' }, { settings: ollama() })
    expect(out.attempts).toBe(2)
    const turns = seen[1].body.messages
    expect(turns.map((t: any) => t.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(turns[3].content).toMatch(/no nodes.*Return the corrected JSON object/)
  })

  it('gives up after one failed repair', async () => {
    handler = (_req, res) => json(res, 200, { message: { content: 'still not json' } })
    await expect(generateDiagram({ description: 'x' }, { settings: ollama() })).rejects.toThrow(/still wasn't a usable diagram/)
    expect(seen).toHaveLength(2)
  })

  it('explains a missing model', async () => {
    handler = (_req, res) => json(res, 404, { error: "model 'test-model' not found" })
    await expect(generateDiagram({ description: 'x' }, { settings: ollama() })).rejects.toThrow(/ollama pull test-model/)
  })

  it('explains when Ollama is not running', async () => {
    const closed = { ...ollama(), ollamaUrl: 'http://127.0.0.1:1' }
    await expect(generateDiagram({ description: 'x' }, { settings: closed })).rejects.toThrow(/Couldn't reach Ollama/)
  })

  it('testConnection checks the model is installed', async () => {
    handler = (_req, res) => json(res, 200, { models: [{ name: 'test-model:latest' }, { name: 'llama3.1:8b' }] })
    await expect(testConnection(ollama())).resolves.toMatch(/test-model is ready/)
    handler = (_req, res) => json(res, 200, { models: [{ name: 'llama3.1:8b' }] })
    await expect(testConnection(ollama())).rejects.toThrow(/isn't installed.*Installed: llama3.1:8b/)
  })
})

/* -------------------------------- Anthropic ------------------------------- */

describe('Anthropic provider', () => {
  it('uses structured outputs, effort, the default model and server-side fallbacks', async () => {
    handler = (_req, res) => json(res, 200, message(GOOD))
    const out = await generateDiagram({ description: 'a shop', type: 'architecture' }, { settings: anthropic(), apiKey: 'test-key' })
    expect(out.diagram.nodes).toHaveLength(3)
    const req = seen[0]
    expect(req.url).toMatch(/^\/v1\/messages/)
    // the SDK decides the header form (x-api-key or bearer); the key must arrive either way
    expect([req.headers['x-api-key'], req.headers.authorization]).toContain(req.headers['x-api-key'] ? 'test-key' : 'Bearer test-key')
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
    expect(req.body.model).toBe('claude-opus-5-5')
    expect(req.body.fallbacks).toBe('default')
    expect(req.body.output_config.effort).toBe('medium')
    expect(req.body.output_config.format).toEqual({ type: 'json_schema', schema: JSON.parse(JSON.stringify(GENERATION_SCHEMA)) })
    expect(req.body.system).toBe(SYSTEM_PROMPT)
    expect(req.body.messages).toEqual([{ role: 'user', content: userPrompt({ description: 'a shop', type: 'architecture' }) }])
  })

  it('a refusal becomes a readable error and is not retried', async () => {
    handler = (_req, res) => json(res, 200, message('', 'refusal'))
    await expect(generateDiagram({ description: 'x' }, { settings: anthropic(), apiKey: 'k' })).rejects.toThrow(/declined/)
    expect(seen).toHaveLength(1)
  })

  it('a rejected key becomes a readable error', async () => {
    handler = (_req, res) => json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    await expect(generateDiagram({ description: 'x' }, { settings: anthropic(), apiKey: 'bad' })).rejects.toThrow(/key was rejected/)
  })

  it('asks for a key instead of calling the API without one', async () => {
    await expect(generateDiagram({ description: 'x' }, { settings: anthropic(), apiKey: null })).rejects.toThrow(/Add your Anthropic API key/)
    expect(seen).toHaveLength(0)
  })

  it('testConnection retrieves the configured model', async () => {
    handler = (_req, res) => json(res, 200, { id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' })
    await expect(testConnection(anthropic(), 'k')).resolves.toMatch(/claude-opus-5-5 is available/)
    expect(seen[0].url).toMatch(/^\/v1\/models\/claude-opus-5-5/)
  })
})
