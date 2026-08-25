/**
 * Redis connection-option construction shared by every process that talks to
 * Redis through BullMQ (the API's queue publisher, the worker's consumer).
 * One parser means the API can never enqueue into a different database, or
 * with different TLS behaviour, than the worker consumes from.
 *
 * Dependency-light on purpose: the type is structural and assignable to both
 * BullMQ's RedisOptions and ioredis's options without importing either.
 */

export type RedisConnectionOptions = {
  host: string
  port: number
  db: number
  username?: string
  password?: string
  tls?: Record<string, never>
  /**
   * BullMQ requires blocking commands to retry forever; a queue consumer that
   * gives up mid-poll would silently stop draining work.
   */
  maxRetriesPerRequest: null
}

/**
 * Parses a redis:// or rediss:// URL into connection options.
 *
 * Never echo the input URL (or the parsed credentials) into errors or logs -
 * it may carry a password.
 */
export function buildRedisConnectionOptions(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl)
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('Redis URL must use the redis: or rediss: scheme')
  }

  const database = url.pathname.replace(/^\//, '')

  return {
    host: url.hostname,
    port: url.port === '' ? 6379 : Number(url.port),
    db: database === '' ? 0 : Number(database),
    ...(url.username === '' ? {} : { username: decodeURIComponent(url.username) }),
    ...(url.password === '' ? {} : { password: decodeURIComponent(url.password) }),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  }
}
