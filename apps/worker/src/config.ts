/**
 * Process configuration for the worker.
 *
 * Scope note (step 0.1): the worker only needs to know how to reach Redis.
 * Queue names and job payloads arrive with the first real job.
 */

export const DEFAULT_REDIS_URL = 'redis://localhost:6379'

export type WorkerConfig = {
  readonly redisUrl: string
}

type Env = Readonly<Record<string, string | undefined>>

/** Reads `REDIS_URL`, falling back to {@link DEFAULT_REDIS_URL}. */
export function readWorkerConfig(env: Env = process.env): WorkerConfig {
  const raw = env.REDIS_URL
  const redisUrl = raw === undefined || raw.trim() === '' ? DEFAULT_REDIS_URL : raw.trim()

  assertRedisUrl(redisUrl)
  return { redisUrl }
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
