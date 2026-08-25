import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import {
  deleteEmailCheckForOrg,
  getCreditBalance,
  getEmailCheckForOrg,
  recordAuditEvent,
  type DatabaseClient,
} from '@tozalist/db'
import { parseStoredEmailCheck } from '@tozalist/shared'
import type { BalanceCache } from '../balance-cache.js'
import { performEmailCheck, type CheckServiceDeps } from '../check-service.js'
import { sendError } from '../errors.js'
import {
  createEmailCheckOperation,
  deleteEmailCheckOperation,
  getEmailCheckOperation,
} from '../openapi/operations.js'
import { renderEmailCheckData, renderMeta } from '../render.js'
import type { EngineCaller, SmtpQueuePublisher } from '../types.js'

export type EmailCheckRouteOptions = {
  db: DatabaseClient
  engine: EngineCaller
  smtpQueue: SmtpQueuePublisher
  balanceCache: BalanceCache
  smtpEnabled: boolean
}

type CheckBody = { email: string; smtp?: boolean }

export const emailCheckRoutes = fp<EmailCheckRouteOptions>(async (app: FastifyInstance, opts) => {
  const deps: CheckServiceDeps = opts

  app.post<{ Body: CheckBody }>(
    '/v1/email/check',
    { schema: createEmailCheckOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      const outcome = await performEmailCheck(deps, auth.orgId, {
        email: request.body.email,
        smtp: request.body.smtp === true,
      })

      switch (outcome.kind) {
        case 'insufficient':
          return sendError(reply, 'INSUFFICIENT_CREDITS')
        case 'engine_failed':
          request.log.error(
            { request_id: request.id, error_name: outcome.errorName },
            'engine verify failed',
          )
          return sendError(reply, 'INTERNAL_ERROR')
        case 'snapshot_unreadable':
          request.log.error({ request_id: request.id }, 'stored snapshot unreadable')
          return sendError(reply, 'INTERNAL_ERROR')
        case 'ok':
          return reply.status(200).send({
            data: renderEmailCheckData(outcome.check, outcome.snapshot),
            meta: renderMeta(request.id, {
              creditsUsed: outcome.creditsUsed,
              creditsRemaining: outcome.creditsRemaining,
              cached: outcome.cached,
              smtp: outcome.smtp,
            }),
          })
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/v1/email/check/:id',
    { schema: getEmailCheckOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      // Missing, expired, other-org and deleted-org all take this same path:
      // an identical 404, never a 403 that would confirm existence.
      const check = await getEmailCheckForOrg(opts.db, request.params.id, auth.orgId)
      if (check === undefined) return sendError(reply, 'NOT_FOUND')

      const snapshot = parseStoredEmailCheck(check.checksJson)
      if (snapshot === null) {
        request.log.error({ request_id: request.id }, 'stored snapshot unreadable')
        return sendError(reply, 'INTERNAL_ERROR')
      }

      const cachedBalance = await opts.balanceCache.get(auth.orgId)
      const balance = cachedBalance ?? (await getCreditBalance(opts.db, auth.orgId))
      return reply.status(200).send({
        data: renderEmailCheckData(check, snapshot),
        meta: renderMeta(request.id, {
          creditsUsed: 0,
          creditsRemaining: balance,
          cached: true,
          smtp: snapshot.smtp_status,
        }),
      })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/v1/email/check/:id',
    { schema: deleteEmailCheckOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      // Same visibility rule as GET: unknown, expired, foreign and deleted-org
      // ids all produce an identical 404, so DELETE can confirm nothing.
      const deleted = await deleteEmailCheckForOrg(opts.db, request.params.id, auth.orgId)
      if (!deleted) return sendError(reply, 'NOT_FOUND')

      await recordAuditEvent(opts.db, {
        orgId: auth.orgId,
        actorApiKeyId: auth.apiKeyId,
        action: 'check.deleted',
        targetType: 'email_check',
        targetId: request.params.id,
      })
      return reply.status(200).send({
        data: { deleted: true, check_id: request.params.id },
        meta: { request_id: request.id, api_version: 'v1' },
      })
    },
  )
})
