import helmet from '@fastify/helmet'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'

/**
 * Security headers via @fastify/helmet (roadmap 8.1), plus the public-API
 * CORS boundary.
 *
 * - HSTS: only meaningful over TLS; harmless locally, required in production.
 * - frameguard DENY + frame-ancestors 'none': this API serves JSON and the
 *   /docs page; nothing here may ever be framed.
 * - Referrer-Policy no-referrer: URLs never leak to third parties.
 * - CSP: default-src 'none' for the JSON API. The Swagger UI under /docs is
 *   the one HTML surface and needs its own same-origin assets (bundled
 *   scripts and inline bootstrap), so an onSend override relaxes CSP for
 *   /docs paths only - Helmet has already set every other header by then.
 *
 * CORS note: /v1/* is a key-authenticated API, so any browser origin may
 * call it - without credentials; Authorization is caller-supplied. The
 * credentialed dashboard scope (/internal/*) and the lead endpoint keep
 * their own strict scoped CORS from apps/api/src/cors.ts; this plugin never
 * touches responses that already carry CORS headers. /metrics never gets
 * CORS headers at all.
 */

const DOCS_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; frame-ancestors 'none'"

export const securityHeaders = fp(async (app: FastifyInstance) => {
  await app.register(helmet, {
    global: true,
    hsts: { maxAge: 15_552_000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
    },
    // The swagger UI loads same-origin assets; these two defaults would block
    // them without adding anything for a same-origin JSON API.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })

  app.addHook('onSend', async (request, reply) => {
    // /docs override: Helmet ran first, this replaces only the CSP.
    if (request.url === '/docs' || request.url.startsWith('/docs/')) {
      reply.header('Content-Security-Policy', DOCS_CSP)
    }

    // Public-API CORS: /v1 and the spec endpoint are key-authenticated and
    // non-credentialed, so any origin may read them. Never /metrics.
    if (
      (request.url.startsWith('/v1/') || request.url === '/openapi.json') &&
      reply.getHeader('access-control-allow-origin') === undefined
    ) {
      reply.header('Access-Control-Allow-Origin', '*')
    }
  })

  // Preflight for browser callers of the key-authenticated API.
  app.options('/v1/*', { schema: { hide: true } }, async (_request, reply) => {
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Max-Age', '86400')
    return reply.status(204).send()
  })
})
