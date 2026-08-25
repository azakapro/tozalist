import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { deletePhoneCheckForOrg, recordAuditEvent, type DatabaseClient } from '@tozalist/db'
import type { BalanceCache } from '../balance-cache.js'
import type { ApiMetrics } from '../metrics.js'
import { performPhoneCheck } from '../check-service.js'
import { sendError } from '../errors.js'
import { createPhoneCheckOperation, deletePhoneCheckOperation } from '../openapi/operations.js'
import { renderMeta, renderPhoneCheckData } from '../render.js'

export type PhoneCheckRouteOptions = {
  db: DatabaseClient
  balanceCache: BalanceCache
  metrics?: ApiMetrics
}

type PhoneBody = { phone: string; country?: string }

export const phoneCheckRoutes = fp<PhoneCheckRouteOptions>(async (app: FastifyInstance, opts) => {
  app.post<{ Body: PhoneBody }>(
    '/v1/phone/check',
    { schema: createPhoneCheckOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      const outcome = await performPhoneCheck(opts, auth.orgId, {
        phone: request.body.phone,
        country: request.body.country ?? 'UZ',
      })
      if (outcome.kind === 'insufficient') return sendError(reply, 'INSUFFICIENT_CREDITS')

      return reply.status(200).send({
        data: renderPhoneCheckData(outcome.check),
        meta: renderMeta(request.id, {
          creditsUsed: 1,
          creditsRemaining: outcome.creditsRemaining,
          cached: false,
          smtp: 'skipped',
        }),
      })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/v1/phone/check/:id',
    { schema: deletePhoneCheckOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      // Unknown, expired, foreign and deleted-org ids: one identical 404.
      const deleted = await deletePhoneCheckForOrg(opts.db, request.params.id, auth.orgId)
      if (!deleted) return sendError(reply, 'NOT_FOUND')

      await recordAuditEvent(opts.db, {
        orgId: auth.orgId,
        actorApiKeyId: auth.apiKeyId,
        action: 'check.deleted',
        targetType: 'phone_check',
        targetId: request.params.id,
      })
      return reply.status(200).send({
        data: { deleted: true, check_id: request.params.id },
        meta: { request_id: request.id, api_version: 'v1' },
      })
    },
  )
})
