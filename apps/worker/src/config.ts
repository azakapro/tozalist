/**
 * Process configuration for the worker.
 *
 * Scope note (step 0.1): the worker only needs to know how to reach Redis.
 * Queue names and job payloads arrive with the first real job.
 */

export const DEFAULT_REDIS_URL = 'redis://localhost:6379'

export type WorkerConfig = {
  readonly redisUrl: string
  /** Process-level switch for SMTP probing. Defaults to false. */
  readonly smtpEnabled: boolean
  /** BullMQ concurrency for the smtp-probe worker. Defaults to 10. */
  readonly smtpWorkerConcurrency: number
  /** Local port for the Prometheus /metrics scrape server. Defaults to 9464. */
  readonly metricsPort: number
  /** Bind address for the scrape server. Loopback unless explicitly changed. */
  readonly metricsHost: string
}

type Env = Readonly<Record<string, string | undefined>>

/** Reads `REDIS_URL`, falling back to {@link DEFAULT_REDIS_URL}. */
export const DEFAULT_SMTP_WORKER_CONCURRENCY = 10

export function readWorkerConfig(env: Env = process.env): WorkerConfig {
  const raw = env.REDIS_URL
  const redisUrl = raw === undefined || raw.trim() === '' ? DEFAULT_REDIS_URL : raw.trim()

  assertRedisUrl(redisUrl)
  return {
    redisUrl,
    smtpEnabled: parseSmtpEnabled(env.SMTP_ENABLED),
    smtpWorkerConcurrency: parseConcurrency(env.SMTP_WORKER_CONCURRENCY),
    metricsPort: parsePort(env.METRICS_PORT),
    metricsHost:
      env.METRICS_HOST === undefined || env.METRICS_HOST.trim() === ''
        ? '127.0.0.1'
        : env.METRICS_HOST.trim(),
  }
}

export const DEFAULT_METRICS_PORT = 9464

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_METRICS_PORT
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`METRICS_PORT must be a port number, received "${raw}"`)
  }
  return value
}

function parseSmtpEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === '') return false
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new Error(`SMTP_ENABLED must be a boolean, received "${raw}"`)
}

function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SMTP_WORKER_CONCURRENCY
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`SMTP_WORKER_CONCURRENCY must be a positive integer, received "${raw}"`)
  }
  return value
}

function assertRedisUrl(value: string): void {
  let protocol: string
  try {
    protocol = new URL(value).protocol
  } catch {
    // Never echo the value back: a Redis URL can carry a password.
    throw new Error('REDIS_URL is not a valid URL')
  }

  if (protocol !== 'redis:' && protocol !== 'rediss:') {
    throw new Error(`REDIS_URL must use the redis: or rediss: scheme, received "${protocol}"`)
  }
}
