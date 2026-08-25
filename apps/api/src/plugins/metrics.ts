import { timingSafeEqual } from 'node:crypto'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { sendError } from '../errors.js'
import type { ApiMetrics } from '../metrics.js'

/**
 * HTTP instrumentation + the Prometheus scrape endpoint.
 *
 * Route labels use the matched route PATTERN (e.g. /v1/email/check/:id),
 * never the raw URL, so label cardinality stays bounded and no request data
 * enters metrics.
 *
 * /metrics is PRIVATE: it requires the dedicated monitoring credential
 * (METRICS_TOKEN, server-side configuration only) as a bearer token and
 * fails closed - no configured token means nobody can scrape. It never
 * receives CORS headers, so browsers cannot be scripted into reading it.
 */
export const metricsPlugin = fp<{ metrics: ApiMetrics; metricsToken?: string | undefined }>(
  async (app: FastifyInstance, opts) => {
    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? 'unmatched'
      if (route === '/metrics') return
      const labels = {
        route,
        method: request.method,
        status: String(reply.statusCode),
      }
      opts.metrics.httpRequests.inc(labels)
      opts.metrics.httpDuration.observe(labels, reply.elapsedTime / 1000)
    })

    app.get('/metrics', { schema: { hide: true } }, async (request, reply) => {
      const configured = opts.metricsToken
      const header = request.headers.authorization
      // Fail closed: unconfigured token, missing header, or mismatch are all
      // the same 401 - and the comparison is constant-time.
      if (
        configured === undefined ||
        configured === '' ||
        typeof header !== 'string' ||
        !header.startsWith('Bearer ')
      ) {
        return sendError(reply, 'UNAUTHORIZED')
      }
      const presented = Buffer.from(header.slice('Bearer '.length))
      const expected = Buffer.from(configured)
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
        return sendError(reply, 'UNAUTHORIZED')
      }
      reply.header('Content-Type', opts.metrics.registry.contentType)
      return opts.metrics.registry.render()
    })
  },
)
