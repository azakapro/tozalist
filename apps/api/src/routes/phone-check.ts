import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import type { DatabaseClient } from '@tozalist/db'
import type { BalanceCache } from '../balance-cache.js'
import { performPhoneCheck } from '../check-service.js'
import { sendError } from '../errors.js'
import { createPhoneCheckOperation } from '../openapi/operations.js'
import { renderMeta, renderPhoneCheckData } from '../render.js'

export type PhoneCheckRouteOptions = {
  db: DatabaseClient
  balanceCache: BalanceCache
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
})
