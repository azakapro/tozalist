import { randomUUID } from 'node:crypto'
import { redactedLoggerOptions } from '@tozalist/shared'
import Fastify, { LogController, type FastifyInstance } from 'fastify'
import type { FastifyBaseLogger } from 'fastify'
import type { Redis } from 'ioredis'
import type { DatabaseClient } from '@tozalist/db'
import { addScopedCors } from './cors.js'
import { BalanceCache } from './balance-cache.js'
import { publicLeadRoutes } from './routes/public-leads.js'
import { openapiPlugin } from './openapi/plugin.js'
import { healthOperation } from './openapi/operations.js'
import { DEFAULT_MESSAGES, sendError, type ErrorCode } from './errors.js'
import { foundationPlugin } from './plugins/foundation.js'
import { securityHeaders } from './plugins/security-headers.js'
import { metricsPlugin } from './plugins/metrics.js'
import { buildApiMetrics } from './metrics.js'
import { authPlugin } from './plugins/auth.js'
import { rateLimitPlugin } from './plugins/rate-limit.js'
import { emailCheckRoutes } from './routes/email-check.js'
import { phoneCheckRoutes } from './routes/phone-check.js'
import { usageRoutes } from './routes/usage.js'
import type { HostResolver, ObjectStorage } from '@tozalist/shared'
import { batchRoutes } from './routes/batches.js'
import { webhookRoutes } from './routes/webhooks.js'
import { internalRoutes } from './internal/routes.js'
import { internalBillingRoutes } from './internal/billing.js'
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
    /** Display-only bank-transfer instructions for invoice requests. */
    billingBankDetails?: string
  }
  /** Public marketing-site origin; providing it registers /public/leads. */
  webOrigin?: string
  publicLeads?: { limit?: number; windowMs?: number; keyPrefix?: string }
  /** Process-level SMTP switch (SMTP_ENABLED). Defaults to false. */
  smtpEnabled?: boolean
  /**
   * Monitoring credential for GET /metrics (METRICS_TOKEN). Server-side
   * configuration only; when absent the endpoint fails closed for everyone.
   */
  metricsToken?: string
  /** Test-only tuning knobs; production uses the defaults. */
  lastUsedThrottleMs?: number
  /** Test-only: observes every registered route (fuzz completeness gate). */
  routeObserver?: (route: { method: string; url: string }) => void
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
    // Fastify 5 moved `disableRequestLogging` and `requestIdLogLabel` off the
    // top level (FSTDEP023 / FSTDEP024) into the official LogController. Same
    // behavior: the built-in per-request logging stays OFF because
    // foundation.ts emits our own single redacted line, and the request id is
    // still logged under `request_id`.
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'request_id',
    }),
    // Fastify 5 answers framework-level failures (malformed URL, bad
    // content-type, oversized body) BEFORE the route error handler, and its
    // default reply is not our envelope. Route them through sendError so the
    // universal `{error:{code,message,request_id}}` contract holds on every
    // response, exactly as it did under Fastify 4.
    frameworkErrors: (error, request, reply) => {
      const code = classifyFrameworkError(error)
      if (code === 'INTERNAL_ERROR') {
        request.log.error({ request_id: request.id, error_name: error.name }, 'framework error')
      }
      void sendError(reply, code, DEFAULT_MESSAGES[code])
    },
  })

  const routeObserver = options.deps?.routeObserver
  if (routeObserver !== undefined) {
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method]
      for (const method of methods) routeObserver({ method, url: route.url })
    })
  }

  void app.register(foundationPlugin)
  void app.register(securityHeaders)
  const metrics = buildApiMetrics()
  void app.register(metricsPlugin, { metrics, metricsToken: options.deps?.metricsToken })
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
          metrics,
        })
        await routes.register(phoneCheckRoutes, { db, balanceCache, metrics })
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
            await internalScope.register(internalBillingRoutes, {
              db,
              session,
              ...(internalAuth.clock !== undefined ? { clock: internalAuth.clock } : {}),
              ...(storage !== undefined ? { storage } : {}),
              ...(internalAuth.billingBankDetails !== undefined
                ? { bankDetails: internalAuth.billingBankDetails }
                : {}),
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

/**
 * Maps a Fastify framework-level error to our public error code. Mirrors the
 * route-level classifier: 4xx framework failures are client errors, anything
 * else is INTERNAL_ERROR. No foreign message text is ever surfaced.
 */
function classifyFrameworkError(error: { statusCode?: number; code?: string }): ErrorCode {
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) {
    return 'PAYLOAD_TOO_LARGE'
  }
  if (error.statusCode === 429) return 'RATE_LIMITED'
  if (error.statusCode === 401) return 'UNAUTHORIZED'
  if (error.statusCode === 404) return 'NOT_FOUND'
  if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return 'VALIDATION_ERROR'
  }
  return 'INTERNAL_ERROR'
}

function buildLoggerOptions(
  logger: BuildAppOptions['logger'],
):
  | boolean
  | ({ level: string; stream?: NodeJS.WritableStream } & ReturnType<typeof redactedLoggerOptions>) {
  if (logger === undefined) return false
  if (logger === false) return false
  // Redaction is not optional: every enabled logger gets the secret-key
  // censor paths plus the deep email scrubber (roadmap 8.1).
  if (logger === true) return { level: 'info', ...redactedLoggerOptions() }
  return { level: 'info', stream: logger.stream, ...redactedLoggerOptions() }
}

export type { FastifyBaseLogger }
