import type { RedisOptions } from 'bullmq'

/**
 * Builds the Redis connection options this process shares.
 *
 * The return type is BullMQ's own `RedisOptions`, so the same object can be
 * handed straight to a `Worker` or a `Queue` once real jobs exist, and to an
 * `ioredis` client in the meantime.
 *
 * BullMQ requires blocking commands to retry forever, hence
 * `maxRetriesPerRequest: null`; a queue consumer that gives up mid-poll would
 * silently stop draining work.
 */
export function buildConnectionOptions(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl)
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
