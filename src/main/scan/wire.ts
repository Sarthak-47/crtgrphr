/**
 * How one part talks to another, read from the configuration itself: the scheme
 * and port in a connection string ("postgres://app@db:5432/app" is SQL on 5432),
 * or, when only a dependency is declared, the well-known protocol and port of the
 * target (a Redis image speaks Redis on 6379). This is what turns an arrow
 * labelled "depends on" into one labelled "SQL :5432".
 */

const SCHEMES: Record<string, string> = {
  postgres: 'SQL', postgresql: 'SQL', 'postgresql+asyncpg': 'SQL', 'postgresql+psycopg': 'SQL', postgis: 'SQL',
  mysql: 'SQL', 'mysql+pymysql': 'SQL', mariadb: 'SQL', sqlserver: 'SQL', mssql: 'SQL', cockroachdb: 'SQL',
  mongodb: 'MongoDB', 'mongodb+srv': 'MongoDB',
  redis: 'Redis', rediss: 'Redis',
  amqp: 'AMQP', amqps: 'AMQP',
  kafka: 'Kafka', nats: 'NATS', mqtt: 'MQTT',
  http: 'HTTP', https: 'HTTPS', grpc: 'gRPC', grpcs: 'gRPC', ws: 'WebSocket', wss: 'WebSocket',
  smtp: 'SMTP', smtps: 'SMTP', s3: 'S3', memcached: 'Memcached', clickhouse: 'SQL', neo4j: 'Bolt', bolt: 'Bolt',
}

/** Protocol and default port of well-known infrastructure, by brand key. */
const BRANDS: Record<string, { proto: string; port: number }> = {
  postgresql: { proto: 'SQL', port: 5432 },
  mysql: { proto: 'SQL', port: 3306 },
  microsoftsqlserver: { proto: 'SQL', port: 1433 },
  mongodb: { proto: 'MongoDB', port: 27017 },
  redis: { proto: 'Redis', port: 6379 },
  rabbitmq: { proto: 'AMQP', port: 5672 },
  apachekafka: { proto: 'Kafka', port: 9092 },
  elasticsearch: { proto: 'HTTP', port: 9200 },
}

export interface Wire {
  proto?: string
  port?: number
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where `value` names `host` as a network address, the scheme and port it uses.
 * Matches "db", "db:5432", "postgres://u:p@db:5432/x", "jdbc:postgresql://db/x",
 * "http://api.default.svc.cluster.local:8080". Returns null if `host` isn't named.
 */
export function wireTo(value: string, host: string): Wire | null {
  const h = escape(host)
  const re = new RegExp(`(?:([a-z][a-z0-9+.-]*):\\/\\/)?(?:[^@\\s/"']*@)?(?<![\\w.-])${h}(?:\\.[a-z0-9.-]+)?(?::(\\d{2,5}))?(?=$|[/,\\s"'?;)])`, 'i')
  const m = value.match(re)
  if (!m) return null
  // A bare word only counts as a host when it stands on its own (not "redis_url").
  const scheme = m[1]?.toLowerCase().replace(/^jdbc:/, '')
  const w: Wire = {}
  if (scheme && SCHEMES[scheme]) w.proto = SCHEMES[scheme]
  if (m[2]) w.port = Number(m[2])
  return w
}

/** The arrow label: "SQL :5432", "HTTP :8080", "AMQP", ":3000", or the fallback. */
export function wireLabel(found: Wire | null, targetBrand: string | undefined, fallback: string): string {
  const known = targetBrand ? BRANDS[targetBrand] : undefined
  const proto = found?.proto ?? known?.proto
  const port = found?.port ?? known?.port
  if (proto && port) return `${proto} :${port}`
  if (proto) return proto
  if (port) return `:${port}`
  return fallback
}

/** The protocol a well-known piece of infrastructure speaks, if known ("SQL" for postgresql). */
export function protocolOf(brand: string | undefined): string | undefined {
  return brand ? BRANDS[brand]?.proto : undefined
}

/** Combine several sightings of the same link, preferring the most specific. */
export function mergeWire(a: Wire | null, b: Wire | null): Wire | null {
  if (!a) return b
  if (!b) return a
  return { proto: a.proto ?? b.proto, port: a.port ?? b.port }
}

/** Published ports of a compose service: "8080:80", "80", "127.0.0.1:80:80/tcp", {published, target}. */
export function publishedPorts(ports: unknown): number[] {
  if (!Array.isArray(ports)) return []
  const out: number[] = []
  for (const p of ports) {
    if (p && typeof p === 'object') {
      const pub = Number((p as Record<string, unknown>).published)
      if (Number.isFinite(pub) && pub > 0) out.push(pub)
      continue
    }
    const parts = String(p).split('/')[0].split(':')
    // "80" publishes on a random host port; host:container and ip:host:container publish host.
    const host = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    const n = Number(host.split('-')[0])
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return out
}

export const webProto = (port: number): string => (port === 443 || port === 8443 ? 'HTTPS' : 'HTTP')
