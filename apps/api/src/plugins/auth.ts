import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import {
  findActiveApiKeyByHash,
  recordAuditEvent,
  sha256Hex,
  touchApiKeyLastUsed,
  type DatabaseClient,
} from '@tozalist/db'
import { sendError } from '../errors.js'

/**
 * Bearer authentication for /v1 routes.
 *
 * The supplied key is hashed immediately; neither the raw header nor the
 * plaintext key is stored, logged, or written to audit events. Failures are
 * audited with a safe category string only.
 */

export type AuthContext = {
  orgId: string
  apiKeyId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
}

export type AuthPluginOptions = {
  db: DatabaseClient
  redis: Redis
  /** last_used_at write throttle window. */
  lastUsedThrottleMs?: number
  keyPrefix?: string
}

type FailureCategory =
  | 'missing_header'
  | 'malformed_header'
  | 'unknown_key'
  | 'revoked_key'
  | 'expired_key'
  | 'org_deleted'

export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, options) => {
  const throttleMs = options.lastUsedThrottleMs ?? 60_000
  const prefix = options.keyPrefix ?? 'tz:api:lastused:'

  app.decorateRequest('auth', null)

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return
    // CORS preflights carry no Authorization by design; the OPTIONS route
    // returns only fixed header metadata, never data.
    if (request.method === 'OPTIONS') return

    const header = request.headers.authorization

    if (header === undefined || header === '') {
      await auditFailure(options.db, 'missing_header', request)
      return sendError(reply, 'UNAUTHORIZED')
    }

    const match = /^Bearer\s+(\S+)$/.exec(header)
    if (match === null || match[1] === undefined) {
      await auditFailure(options.db, 'malformed_header', request)
      return sendError(reply, 'UNAUTHORIZED')
    }

    const lookup = await findActiveApiKeyByHash(options.db, sha256Hex(match[1]))
    if (!lookup.ok) {
      await auditFailure(options.db, lookup.reason, request)
      return sendError(reply, 'UNAUTHORIZED')
    }

    request.auth = lookup.key

    // last_used_at at most once per minute per key, coordinated through Redis
    // so multiple API instances share the throttle.
    const marker = await options.redis.set(
      `${prefix}${lookup.key.apiKeyId}`,
      '1',
      'PX',
      throttleMs,
      'NX',
    )
    if (marker === 'OK') {
      await touchApiKeyLastUsed(options.db, lookup.key.apiKeyId)
    }
  })
})

async function auditFailure(
  db: DatabaseClient,
  category: FailureCategory,
  request: FastifyRequest,
): Promise<void> {
  // Only safe, fixed values: the category, route and request id. Never the
  // header, never key material.
  await recordAuditEvent(db, {
    action: 'api.auth_failed',
    targetType: 'request',
    targetId: request.id,
    metadata: { category, route: request.url.split('?')[0] ?? request.url },
  })
}
