import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import type { FastifyBaseLogger } from 'fastify'
import type { Redis } from 'ioredis'
import type { DatabaseClient } from '@tozalist/db'
import { addScopedCors } from './cors.js'
import { BalanceCache } from './balance-cache.js'
import { publicLeadRoutes } from './routes/public-leads.js'
import { openapiPlugin } from './openapi/plugin.js'
import { healthOperation } from './openapi/operations.js'
import { foundationPlugin } from './plugins/foundation.js'
import { authPlugin } from './plugins/auth.js'
import { rateLimitPlugin } from './plugins/rate-limit.js'
import { emailCheckRoutes } from './routes/email-check.js'
import { phoneCheckRoutes } from './routes/phone-check.js'
import { usageRoutes } from './routes/usage.js'
import type { HostResolver, ObjectStorage } from '@tozalist/shared'
import { batchRoutes } from './routes/batches.js'
import { webhookRoutes } from './routes/webhooks.js'
import { internalRoutes } from './internal/routes.js'
import { internalProductRoutes } from './internal/product.js'
import type { BatchQueuePublisher, EngineCaller, SmtpQueuePublisher } from './types.js'

/** Exactly 1 MB: larger JSON bodies get 413 PAYLOAD_TOO_LARGE. */
export const JSON_BODY_LIMIT_BYTES = 1024 * 1024

export type AppDeps = {
  db: DatabaseClient
  redis: Redis
  /**
   * Product-route collaborators. When provided together, the email, phone and
   * usage routes are registered. Tests substitute stubs; server.ts passes the
   * real EngineClient and BullMQ publisher.
   */
  engine?: EngineCaller
  smtpQueue?: SmtpQueuePublisher
  /** Object storage + batch publisher; providing both registers batch routes. */
  storage?: ObjectStorage
  batchQueue?: BatchQueuePublisher
  /** Injectable DNS resolution for webhook SSRF checks (tests only). */
  webhookResolver?: HostResolver
  /** Session-cookie config; providing it registers the /internal routes. */
  internalAuth?: {
    sessionSecret: string
    dashboardOrigin: string
    cookieSecure: boolean
    clock?: () => number
  }
  /** Public marketing-site origin; providing it registers /public/leads. */
  webOrigin?: string
  publicLeads?: { limit?: number; windowMs?: number; keyPrefix?: string }
  /** Process-level SMTP switch (SMTP_ENABLED). Defaults to false. */
  smtpEnabled?: boolean
  /** Test-only tuning knobs; production uses the defaults. */
  lastUsedThrottleMs?: number
  rateLimit?: { limit?: number; windowMs?: number; keyPrefix?: string; clock?: () => number }
  authKeyPrefix?: string
  balanceCache?: { ttlMs?: number; keyPrefix?: string }
}

export type BuildAppOptions = {
  logger?: boolean | { stream: NodeJS.WritableStream }
  /**
   * Database and Redis. When absent (bare health-check apps in unit tests),
   * the /v1 scope is not registered at all - there is no unauthenticated
   * fallback. The production server always passes deps.
   */
  deps?: AppDeps
  /**
   * Registers GET /v1/test-protected for the test suite. Never set in
   * production code paths; server.ts does not pass it.
   */
  testRoutes?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(options.logger),
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    ajv: {
      // Strict bodies: unknown fields are rejected (never silently stripped)
      // and types are never coerced - 42 is not a string, "yes" is not a bool.
      customOptions: { removeAdditional: false, coerceTypes: false },
    },
    // A fresh UUID per request; the caller's X-Request-Id is never trusted.
    genReqId: () => randomUUID(),
    requestIdLogLabel: 'request_id',
    disableRequestLogging: true,
  })

  void app.register(foundationPlugin)
  void app.register(openapiPlugin)

  // Routes live in a deferred plugin scope: avvio loads registrations in
  // order, so by the time these run @fastify/swagger's onRoute hook exists
  // and every route below is captured in the generated document.
  void app.register(async (routes) => {
    routes.get('/health', { schema: healthOperation.schema }, async () => ({
      status: 'ok',
    }))
  })

  if (options.deps !== undefined) {
    const { db, redis } = options.deps
    void app.register(authPlugin, {
      db,
      redis,
      ...(options.deps.lastUsedThrottleMs !== undefined
        ? { lastUsedThrottleMs: options.deps.lastUsedThrottleMs }
        : {}),
      ...(options.deps.authKeyPrefix !== undefined
        ? { keyPrefix: options.deps.authKeyPrefix }
        : {}),
    })
    void app.register(rateLimitPlugin, { redis, ...options.deps.rateLimit })

    // One structured line per request; the only place org/key IDs are logged,
    // and only after successful authentication.
    app.addHook('onResponse', async (request, reply) => {
      request.log.info(
        {
          request_id: request.id,
          method: request.method,
          route: request.routeOptions.url ?? request.url.split('?')[0],
          status_code: reply.statusCode,
          duration_ms: Math.round(reply.elapsedTime),
          ...(request.auth !== null
            ? { org_id: request.auth.orgId, api_key_id: request.auth.apiKeyId }
            : {}),
        },
        'request',
      )
    })

    if (options.deps.engine !== undefined && options.deps.smtpQueue !== undefined) {
      const balanceCache = new BalanceCache(redis, options.deps.balanceCache ?? {})
      const engine = options.deps.engine
      const smtpQueue = options.deps.smtpQueue
      const smtpEnabled = options.deps.smtpEnabled ?? false
      const storage = options.deps.storage
      const batchQueue = options.deps.batchQueue
      const webhookResolver = options.deps.webhookResolver
      const internalAuth = options.deps.internalAuth
      const webOrigin = options.deps.webOrigin
      const publicLeads = options.deps.publicLeads
      void app.register(async (routes) => {
        await routes.register(emailCheckRoutes, {
          db,
          engine,
          smtpQueue,
          balanceCache,
          smtpEnabled,
        })
        await routes.register(phoneCheckRoutes, { db, balanceCache })
        await routes.register(usageRoutes, { db })
        await routes.register(webhookRoutes, {
          db,
          ...(webhookResolver !== undefined ? { resolver: webhookResolver } : {}),
        })
        if (storage !== undefined && batchQueue !== undefined) {
          await routes.register(batchRoutes, { db, storage, batchQueue })
        }
        if (webOrigin !== undefined) {
          // TRUST BOUNDARY: the public site's CORS scope covers ONLY the lead
          // endpoint, without credentials. The web origin must never receive
          // CORS headers - credentialed or not - on any dashboard route.
          await routes.register(async (publicScope) => {
            addScopedCors(publicScope, {
              origin: webOrigin,
              credentials: false,
              methods: ['POST', 'OPTIONS'],
              headers: ['Content-Type'],
              preflightPaths: ['/public/leads'],
            })
            await publicScope.register(publicLeadRoutes, { db, redis, ...(publicLeads ?? {}) })
          })
        }
        if (internalAuth !== undefined) {
          const session = {
            sessionSecret: internalAuth.sessionSecret,
            cookieSecure: internalAuth.cookieSecure,
          }
          // TRUST BOUNDARY: credentialed CORS exists only inside this scope,
          // and only for the dashboard origin.
          await routes.register(async (internalScope) => {
            addScopedCors(internalScope, {
              origin: internalAuth.dashboardOrigin,
              credentials: true,
              methods: ['GET', 'POST', 'OPTIONS'],
              headers: ['Content-Type', 'X-CSRF-Token'],
              preflightPaths: ['/internal/*'],
            })
            await internalScope.register(internalRoutes, {
              db,
              session,
              dashboardOrigin: internalAuth.dashboardOrigin,
              ...(internalAuth.clock !== undefined ? { clock: internalAuth.clock } : {}),
              ...(storage !== undefined ? { storage } : {}),
            })
            await internalScope.register(internalProductRoutes, {
              db,
              session,
              engine,
              smtpQueue,
              balanceCache,
              smtpEnabled,
              ...(storage !== undefined ? { storage } : {}),
              ...(batchQueue !== undefined ? { batchQueue } : {}),
            })
          })
        }
      })
    }

    if (options.testRoutes === true) {
      // Test-only routes: never present in the OpenAPI document.
      void app.register(async (routes) => {
        routes.get('/v1/test-protected', { schema: { hide: true } }, async (request) => ({
          ok: true,
          orgId: request.auth?.orgId ?? null,
          apiKeyId: request.auth?.apiKeyId ?? null,
        }))
        routes.get('/v1/test-error', { schema: { hide: true } }, async () => {
          throw new Error('secret internal detail that must never surface')
        })
      })
    }
  }

  return app
}

function buildLoggerOptions(
  logger: BuildAppOptions['logger'],
): boolean | { level: string; stream: NodeJS.WritableStream } {
  if (logger === undefined) return false
  if (typeof logger === 'boolean') return logger
  return { level: 'info', stream: logger.stream }
}

export type { FastifyBaseLogger }
