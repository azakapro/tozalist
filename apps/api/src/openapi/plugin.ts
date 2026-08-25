import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { ALL_COMPONENTS } from './components.js'

/**
 * OpenAPI 3.1 generation and the public documentation surface: GET /docs
 * (Swagger UI) and GET /openapi.json. Registered before any product route so
 * every route's schema is captured. /v1 stays API-key protected; only the
 * documentation itself is public.
 */
export const openapiPlugin = fp(async (app: FastifyInstance) => {
  for (const component of ALL_COMPONENTS) {
    app.addSchema(component)
  }

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'TozaList API',
        version: 'v1',
        description:
          'Consent-first email and phone list hygiene. Every verdict is a risk signal, never a ' +
          "delivery guarantee - results marked 'unknown' should not be deleted automatically. " +
          'Authenticate with an API key via the Authorization: Bearer header.',
      },
      tags: [
        { name: 'System', description: 'Liveness and service metadata.' },
        { name: 'Email checks', description: 'Email verification and polling.' },
        { name: 'Phone checks', description: 'Offline phone format validation.' },
        { name: 'Usage', description: 'Credits and usage reporting.' },
        { name: 'Batches', description: 'Bulk CSV checking with progress and downloads.' },
        { name: 'Webhooks', description: 'Signed batch-event notifications.' },
      ],
      components: {
        securitySchemes: {
          bearerApiKey: {
            type: 'http',
            scheme: 'bearer',
            description: 'A TozaList API key (tzl_live_...), sent as Authorization: Bearer <key>.',
          },
        },
      },
    },
    // Routes must opt IN with a schema; anything marked hide never appears.
    hiddenTag: 'x-internal',
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  })

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger())
})
