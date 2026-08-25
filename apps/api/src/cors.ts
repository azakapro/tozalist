import type { FastifyInstance } from 'fastify'

/**
 * Explicit, scope-local CORS. Registered inside an encapsulated plugin
 * context, the hook and the preflight route apply ONLY to that scope's
 * routes - so the dashboard's credentialed policy and the public site's
 * non-credentialed policy can never bleed into each other.
 *
 * Non-matching origins receive no Access-Control-* headers at all: the
 * browser refuses the response.
 */
export function addScopedCors(
  scope: FastifyInstance,
  policy: {
    origin: string
    credentials: boolean
    methods: readonly string[]
    headers: readonly string[]
    /** Fastify route patterns answering preflight, e.g. '/internal/*'. */
    preflightPaths: readonly string[]
  },
): void {
  scope.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin === policy.origin) {
      reply.header('Access-Control-Allow-Origin', policy.origin)
      reply.header('Vary', 'Origin')
      if (policy.credentials) reply.header('Access-Control-Allow-Credentials', 'true')
    }
  })

  for (const path of policy.preflightPaths) {
    scope.options(path, { schema: { hide: true } }, async (request, reply) => {
      if (request.headers.origin !== policy.origin) {
        // 204 with no CORS headers: a denied preflight, not an error leak.
        return reply.status(204).send()
      }
      reply.header('Access-Control-Allow-Methods', policy.methods.join(', '))
      reply.header('Access-Control-Allow-Headers', policy.headers.join(', '))
      reply.header('Access-Control-Max-Age', '86400')
      return reply.status(204).send()
    })
  }
}
