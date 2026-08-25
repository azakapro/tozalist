import type { RedisOptions } from 'bullmq'
import { buildRedisConnectionOptions } from '@tozalist/shared'

/**
 * Builds the Redis connection options this process shares.
 *
 * Delegates to the shared parser so the worker consumes from exactly the same
 * database - with the same credentials and TLS behaviour - that the API's
 * queue publisher enqueues into. The return type is BullMQ's own
 * `RedisOptions`, so the same object can be handed to a `Worker`, a `Queue`,
 * or an `ioredis` client.
 */
export function buildConnectionOptions(redisUrl: string): RedisOptions {
  return buildRedisConnectionOptions(redisUrl)
}
