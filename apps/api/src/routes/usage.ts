import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { getUsageSummary, type DatabaseClient } from '@tozalist/db'
import { sendError } from '../errors.js'
import { getUsageOperation } from '../openapi/operations.js'
import { API_VERSION } from '../render.js'

export type UsageRouteOptions = {
  db: DatabaseClient
}

type UsageQuery = { cursor?: string; limit?: string }

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export const usageRoutes = fp<UsageRouteOptions>(async (app: FastifyInstance, opts) => {
  app.get<{ Querystring: UsageQuery }>(
    '/v1/usage',
    { schema: getUsageOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      const limit =
        request.query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(request.query.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        return sendError(reply, 'VALIDATION_ERROR')
      }

      const summary = await getUsageSummary(opts.db, auth.orgId, {
        ...(request.query.cursor !== undefined ? { cursor: request.query.cursor } : {}),
        limit,
      })
      if (summary === null) return sendError(reply, 'VALIDATION_ERROR')

      return reply.status(200).send({
        data: {
          balance: summary.balance,
          checks_this_month: summary.month,
          ledger: {
            entries: summary.ledger.entries.map((entry) => ({
              id: entry.id,
              delta: entry.delta,
              reason: entry.reason,
              reference_id: entry.referenceId,
              created_at: entry.createdAt.toISOString(),
            })),
            next_cursor: summary.ledger.nextCursor,
          },
        },
        meta: { request_id: request.id, api_version: API_VERSION },
      })
    },
  )
})
