import Fastify, { type FastifyInstance } from 'fastify'

/**
 * The health payload is pinned by a response schema so the serialised body is
 * exactly `{"status":"ok"}` - uptime checks and load balancers depend on it.
 */
const healthResponseSchema = {
  200: {
    type: 'object',
    properties: { status: { type: 'string' } },
    required: ['status'],
    additionalProperties: false,
  },
} as const

export type BuildAppOptions = {
  readonly logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false })

  app.get('/health', { schema: { response: healthResponseSchema } }, async () => ({
    status: 'ok',
  }))

  return app
}
