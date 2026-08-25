import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import {
  createWebhookEndpoint,
  listWebhookEndpointsForOrg,
  recordAuditEvent,
  softDeleteWebhookEndpoint,
  type DatabaseClient,
} from '@tozalist/db'
import {
  checkWebhookHost,
  defaultHostResolver,
  generateWebhookSecret,
  type HostResolver,
} from '@tozalist/shared'
import { sendError } from '../errors.js'
import {
  createWebhookOperation,
  deleteWebhookOperation,
  listWebhooksOperation,
} from '../openapi/operations.js'
import { API_VERSION } from '../render.js'

export type WebhookRouteOptions = {
  db: DatabaseClient
  /** Injectable DNS resolution for SSRF tests; production uses real DNS. */
  resolver?: HostResolver
}

type CreateBody = { url: string; events: string[] }

export const webhookRoutes = fp<WebhookRouteOptions>(async (app: FastifyInstance, opts) => {
  const resolver = opts.resolver ?? defaultHostResolver

  app.post<{ Body: CreateBody }>(
    '/v1/webhooks',
    { schema: createWebhookOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      let parsed: URL
      try {
        parsed = new URL(request.body.url)
      } catch {
        return sendError(reply, 'VALIDATION_ERROR', 'The webhook URL is not a valid URL.')
      }
      // HTTPS only: webhook payloads describe customer batches.
      if (parsed.protocol !== 'https:') {
        return sendError(reply, 'VALIDATION_ERROR', 'Webhook URLs must use https.')
      }
      if (parsed.username !== '' || parsed.password !== '') {
        return sendError(reply, 'VALIDATION_ERROR', 'Webhook URLs must not contain credentials.')
      }

      // SSRF: every resolved address must be public. Checked again at every
      // delivery attempt - registration-time DNS is not trusted forever.
      const ssrf = await checkWebhookHost(parsed.hostname, resolver)
      if (!ssrf.ok) {
        return sendError(
          reply,
          'VALIDATION_ERROR',
          ssrf.reason === 'unresolvable'
            ? 'The webhook hostname could not be resolved.'
            : 'The webhook hostname resolves to a private or reserved address.',
        )
      }

      const secret = generateWebhookSecret()
      const endpoint = await createWebhookEndpoint(opts.db, {
        orgId: auth.orgId,
        url: parsed.toString(),
        events: request.body.events,
        secret,
      })

      await recordAuditEvent(opts.db, {
        orgId: auth.orgId,
        actorApiKeyId: auth.apiKeyId,
        action: 'webhook.created',
        targetType: 'webhook_endpoint',
        targetId: endpoint.id,
        // The URL's host only - never the secret, never the full URL (its path
        // or query could carry customer tokens).
        metadata: { host: parsed.hostname, events: request.body.events },
      })

      return reply.status(200).send({
        data: {
          webhook_id: endpoint.id,
          url: endpoint.url,
          events: endpoint.events,
          // The one and only time the secret leaves the system.
          secret,
          created_at: endpoint.createdAt.toISOString(),
        },
        meta: { request_id: request.id, api_version: API_VERSION },
      })
    },
  )

  app.get('/v1/webhooks', { schema: listWebhooksOperation.schema }, async (request, reply) => {
    const auth = request.auth
    if (auth === null) return sendError(reply, 'UNAUTHORIZED')

    const endpoints = await listWebhookEndpointsForOrg(opts.db, auth.orgId)
    return reply.status(200).send({
      data: {
        webhooks: endpoints.map((endpoint) => ({
          webhook_id: endpoint.id,
          url: endpoint.url,
          events: endpoint.events,
          active: endpoint.active,
          created_at: endpoint.createdAt.toISOString(),
        })),
      },
      meta: { request_id: request.id, api_version: API_VERSION },
    })
  })

  app.delete<{ Params: { id: string } }>(
    '/v1/webhooks/:id',
    { schema: deleteWebhookOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      const deleted = await softDeleteWebhookEndpoint(opts.db, request.params.id, auth.orgId)
      if (!deleted) return sendError(reply, 'NOT_FOUND')

      await recordAuditEvent(opts.db, {
        orgId: auth.orgId,
        actorApiKeyId: auth.apiKeyId,
        action: 'webhook.deleted',
        targetType: 'webhook_endpoint',
        targetId: request.params.id,
      })

      return reply.status(200).send({
        data: { deleted: true, webhook_id: request.params.id },
        meta: { request_id: request.id, api_version: API_VERSION },
      })
    },
  )
})
