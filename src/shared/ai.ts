/**
 * AI generation, provider-independent parts: the JSON schema both providers are
 * constrained to, the instructions, and turning a model's answer into a valid
 * IRDiagram (or a precise error that is fed back for one repair attempt).
 *
 * The model only ever produces the semantic graph: no coordinates, no styling
 * (ADR-0003). Layout is ours.
 */
import { DIAGRAM_TYPES, NODE_ROLES, type DiagramType, type IRDiagram } from './ir'
import { sanitizeDiagram } from './serialize'

export const MAX_GENERATED_NODES = 60

const ROLES = NODE_ROLES.filter((r) => r !== 'group')
const VARIANTS = ['default', 'emphasis', 'dashed', 'weak'] as const

/** JSON schema for a generated diagram (structured outputs / Ollama `format`). */
export const GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'type', 'nodes', 'edges'],
  properties: {
    title: { type: 'string', description: 'Short title for the map' },
    subtitle: { type: 'string', description: 'Optional one-line description' },
    type: { type: 'string', enum: [...DIAGRAM_TYPES] },
    direction: { type: 'string', enum: ['RIGHT', 'DOWN', 'LEFT', 'UP'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'role'],
        properties: {
          id: { type: 'string', description: 'Stable kebab-case id, unique in the map' },
          label: { type: 'string' },
          sublabel: { type: 'string', description: 'Technology or short detail' },
          role: { type: 'string', enum: ROLES },
          brand: { type: 'string', description: 'Lowercase product slug, e.g. postgresql, redis, stripe' },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'target'],
        properties: {
          source: { type: 'string', description: 'id of the source node' },
          target: { type: 'string', description: 'id of the target node' },
          label: { type: 'string' },
          variant: { type: 'string', enum: [...VARIANTS] },
        },
      },
    },
  },
} as const

export const SYSTEM_PROMPT = `You turn a description of a software system or process into a diagram for Cartographer, a system-mapping tool. Answer with one JSON object that matches the provided schema and nothing else.

What to produce
- Only the meaning of the diagram: nodes, edges, labels, roles. Never coordinates, sizes, colours or styling; the tool lays the map out itself.
- Model what the description says. Where it is vague, make the usual, simple assumption for that kind of system instead of inventing exotic parts. Prefer 5 to 20 nodes; never more than ${MAX_GENERATED_NODES}.
- Labels: short names (under 28 characters), e.g. "API gateway". Put the technology or a detail in sublabel, e.g. "Node / Fastify".
- ids: kebab-case, unique, derived from the label, e.g. "api-gateway". Every edge source and target must be one of the node ids.
- brand: only for real products, as a lowercase slug (postgresql, redis, apachekafka, stripe, nginx, cloudflare, github, docker, mongodb, rabbitmq, elasticsearch, amazonaws). Omit otherwise.

Roles
- external: users, third parties, anything outside the system. frontend: web or mobile clients, UIs. backend: services, APIs, workers. database: durable stores. cache: caches and in-memory stores. queue: message brokers, event streams. cloud: CDNs, load balancers, gateways, managed infrastructure. service: third-party SaaS the system calls. process: a step in a workflow. decision: a branch point in a workflow. state: a state in a lifecycle. terminal: start and end points.

Edge styles
- default: a normal call or flow. emphasis: the main path (use on a few edges at most). dashed: asynchronous, optional or failure paths. weak: structural links that are not data flow.

Diagram types
- architecture: components and how they talk. Edges point from caller to callee. Usually direction RIGHT.
- workflow: steps (process), branch points (decision) and start/end (terminal). Label the edges leaving a decision ("yes"/"no", or the condition). List a decision's main branch first. Usually direction DOWN.
- sequence: nodes are the participants, in left-to-right order; edges are the messages, in the order they happen, top to bottom. Label every message; replies use variant dashed.
- dataflow: sources, transformations and sinks, with edges labelled by what flows. Usually direction RIGHT.
- lifecycle: states (state), with start and end points (terminal); edges are transitions labelled by their trigger; retries and failures may point back to earlier states. Usually direction DOWN.`

export interface GenerationRequest {
  description: string
  /** ask for a specific type; undefined lets the model choose */
  type?: DiagramType
}

/** The user message for a request. */
export function userPrompt(req: GenerationRequest): string {
  const type = req.type ? `Make it a ${req.type} diagram.\n\n` : 'Choose the diagram type that fits best.\n\n'
  return `${type}Description:\n${req.description.trim()}`
}

export class GenerationError extends Error {
  /** true when retrying with the error fed back could fix it */
  constructor(
    message: string,
    readonly repairable = true,
  ) {
    super(message)
  }
}

export interface Generated {
  diagram: IRDiagram
  fixes: string[]
}

/**
 * Parse and validate a model's answer. Throws GenerationError with a message
 * written to be fed back to the model for a repair attempt.
 */
export function parseGeneration(text: string, req: GenerationRequest): Generated {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch (e) {
    throw new GenerationError(`The answer was not valid JSON (${e instanceof Error ? e.message : String(e)}). Return only the JSON object.`)
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const nodeCount = Array.isArray(obj.nodes) ? obj.nodes.length : 0
  if (nodeCount === 0) throw new GenerationError('The diagram has no nodes. Include the parts of the system as nodes.')
  if (nodeCount > MAX_GENERATED_NODES) {
    throw new GenerationError(`The diagram has ${nodeCount} nodes; keep it to at most ${MAX_GENERATED_NODES} by grouping related parts.`)
  }

  const { value, fixes } = sanitizeDiagram({ ...obj, id: 'generated' })
  const edgeCount = Array.isArray(obj.edges) ? obj.edges.length : 0
  // Most edges pointing at unknown ids means the ids are wrong; worth a repair.
  if (edgeCount > 0 && value.edges.length < edgeCount / 2) {
    throw new GenerationError('Most edges refer to node ids that do not exist. Every edge source and target must be a node id.')
  }
  if (req.type && value.type !== req.type) {
    value.type = req.type
    fixes.push(`type set to ${req.type} as requested`)
  }
  value.id = value.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'generated'
  return { diagram: value, fixes }
}
