import { randomUUID } from 'node:crypto'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { sendError } from '../errors.js'

/**
 * Redis-backed sliding-window rate limit: 100 requests per 10 seconds per API
 * key. State lives only in Redis, so every API instance enforces one shared
 * budget. Runs after authentication: failed auth never consumes a valid key's
 * quota, and the limit key is the API-key ID - never plaintext.
 *
 * If Redis cannot be consulted the plugin fails closed with INTERNAL_ERROR:
 * silently disabling the limiter would turn a Redis outage into an
 * unprotected API.
 */

export type RateLimitOptions = {
  redis: Redis
  limit?: number
  windowMs?: number
  keyPrefix?: string
  clock?: () => number
}

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = (tonumber(oldest[2]) + windowMs) - now
  if retry < 1 then retry = 1 end
  return {0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, 0}
`

export const rateLimitPlugin = fp<RateLimitOptions>(async (app: FastifyInstance, options) => {
  const limit = options.limit ?? 100
  const windowMs = options.windowMs ?? 10_000
  const prefix = options.keyPrefix ?? 'tz:api:rl:'
  const clock = options.clock ?? Date.now

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/v1/') || request.auth === null) return

    let result: [number, number]
    try {
      result = (await options.redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        `${prefix}${request.auth.apiKeyId}`,
        String(clock()),
        String(windowMs),
        String(limit),
        // A collision-proof internal nonce. PID+counter+timestamp is NOT
        // enough: two app instances (or containers) can share a PID and a
        // millisecond, and a colliding ZADD member would silently overwrite an
        // earlier entry and undercount the window. The nonce never leaves
        // Redis: not logged, not returned, not derived from request data.
        randomUUID(),
      )) as [number, number]
    } catch {
      // Fail closed: no limiter state means no service, not unlimited service.
      request.log.error({ request_id: request.id }, 'rate limit state unavailable')
      return sendError(reply, 'INTERNAL_ERROR')
    }

    if (result[0] !== 1) {
      // Ceiling, and never 0: a caller told to wait 0 seconds would retry
      // immediately and be rejected again.
      const retryAfterSeconds = Math.max(1, Math.ceil(result[1] / 1000))
      reply.header('Retry-After', String(retryAfterSeconds))
      return sendError(reply, 'RATE_LIMITED')
    }
  })
})
