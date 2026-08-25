import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getPlan } from '@tozalist/core'
import {
  createInvoiceRequest,
  getBillingSummary,
  getLedgerWithRunningBalance,
  getOrgSettings,
  getUserById,
  parseStatementMonth,
  recordAuditEvent,
  type DatabaseClient,
} from '@tozalist/db'
import {
  orgObjectPrefix,
  statementKeyMonth,
  statementObjectKey,
  type ObjectStorage,
} from '@tozalist/shared'
import { sendError } from '../errors.js'
import { readSession, type SessionConfig, type SessionData } from './session.js'

/**
 * /internal/billing - the dashboard's invoice-based billing surface.
 * Ledger-only: credits move exclusively through append-only grants (CLI) and
 * the existing check debits. There is NO payment-provider code anywhere in
 * this product; invoices are requested here and settled by bank transfer.
 *
 * Bank-transfer instructions come from environment configuration only
 * (BILLING_BANK_DETAILS) - never hard-coded, never stored, never logged.
 */

export type InternalBillingOptions = {
  db: DatabaseClient
  session: SessionConfig
  storage?: ObjectStorage
  /** Display-only bank-transfer instructions from the environment. */
  bankDetails?: string
  clock?: () => number
}

const HIDDEN = { hide: true } as const

/** Signed statement links live one hour: short-lived, re-issued on demand. */
export const STATEMENT_LINK_TTL_SECONDS = 60 * 60

export const internalBillingRoutes = fp<InternalBillingOptions>(
  async (app: FastifyInstance, opts) => {
    const clock = opts.clock ?? Date.now

    async function requireSession(
      request: FastifyRequest,
      reply: FastifyReply,
      options: { csrf?: boolean; admin?: boolean } = {},
    ): Promise<SessionData | null> {
      const session = await readSession(request, opts.session)
      if (session === null || !session.mfaVerified) {
        void sendError(reply, 'UNAUTHORIZED')
        return null
      }
      // Org liveness: sealed cookies outlive deletion; the database decides.
      const org = await getOrgSettings(opts.db, session.orgId)
      if (org === undefined) {
        void sendError(reply, 'UNAUTHORIZED')
        return null
      }
      if (options.csrf === true) {
        const token = request.headers['x-csrf-token']
        if (typeof token !== 'string' || token !== session.csrfToken) {
          void sendError(reply, 'UNAUTHORIZED', 'The request is missing a valid CSRF token.')
          return null
        }
      }
      if (options.admin === true && session.role !== 'admin') {
        void sendError(reply, 'UNAUTHORIZED')
        return null
      }
      return session
    }

    app.get('/internal/billing', { schema: HIDDEN }, async (request, reply) => {
      const session = await requireSession(request, reply)
      if (session === null) return

      const now = new Date(clock())
      const summary = await getBillingSummary(opts.db, session.orgId, now)
      const ledger = await getLedgerWithRunningBalance(opts.db, session.orgId, { limit: 50 })
      let statements: string[] = []
      if (opts.storage !== undefined) {
        const keys = await opts.storage.listKeys(`${orgObjectPrefix(session.orgId)}statements/`)
        statements = keys
          .map((key) => statementKeyMonth(key))
          .filter((month): month is string => month !== null)
          .sort()
          .reverse()
      }
      return reply.status(200).send({
        data: {
          balance: summary.balance,
          last_grant: summary.lastGrant,
          month_to_date: {
            credits_granted: summary.monthToDate.creditsGranted,
            credits_consumed: summary.monthToDate.creditsConsumed,
            batches_run: summary.monthToDate.batchesRun,
          },
          ledger: ledger.map((entry) => ({
            id: entry.id,
            delta: entry.delta,
            reason: entry.reason,
            created_at: entry.createdAt.toISOString(),
            running_balance: entry.runningBalance,
          })),
          statements,
        },
        meta: { request_id: request.id },
      })
    })

    app.post<{ Body: { plan: string } }>(
      '/internal/billing/invoice-request',
      {
        schema: {
          ...HIDDEN,
          body: {
            type: 'object',
            properties: { plan: { type: 'string', minLength: 1, maxLength: 16 } },
            required: ['plan'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const session = await requireSession(request, reply, { csrf: true, admin: true })
        if (session === null) return

        const plan = getPlan(request.body.plan)
        if (plan === undefined) {
          return sendError(reply, 'VALIDATION_ERROR', 'Unknown plan.')
        }
        if (opts.bankDetails === undefined || opts.bankDetails.trim() === '') {
          // Fixed message: configuration state only, no values.
          request.log.error(
            { request_id: request.id },
            'invoice request refused: billing bank details are not configured',
          )
          return sendError(reply, 'INTERNAL_ERROR')
        }

        const user = await getUserById(opts.db, session.userId)
        if (user === undefined) return sendError(reply, 'UNAUTHORIZED')
        const created = await createInvoiceRequest(
          opts.db,
          { orgId: session.orgId, planCode: plan.code, requestedByUserId: session.userId },
          new Date(clock()),
        )
        if (created === null) return sendError(reply, 'UNAUTHORIZED')

        return reply.status(200).send({
          data: {
            request_id: created.id,
            plan: plan.code,
            price_uzs: plan.priceUzs,
            checks: plan.checks,
            bank_details: opts.bankDetails,
          },
          meta: { request_id: request.id },
        })
      },
    )

    app.post<{ Body: { month: string } }>(
      '/internal/billing/statements/link',
      {
        schema: {
          ...HIDDEN,
          body: {
            type: 'object',
            properties: { month: { type: 'string', minLength: 7, maxLength: 7 } },
            required: ['month'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const session = await requireSession(request, reply, { csrf: true })
        if (session === null) return
        if (parseStatementMonth(request.body.month) === null) {
          return sendError(reply, 'VALIDATION_ERROR', 'The month must be YYYY-MM.')
        }
        if (opts.storage === undefined) {
          request.log.error({ request_id: request.id }, 'statement link requested without storage')
          return sendError(reply, 'INTERNAL_ERROR')
        }

        // Scope: the key is derived from the session's own org id; another
        // organisation's statements are simply unreachable from here.
        const key = statementObjectKey(session.orgId, request.body.month)
        const existing = await opts.storage.listKeys(key)
        if (!existing.includes(key)) return sendError(reply, 'NOT_FOUND')

        const url = await opts.storage.presignDownload(key, STATEMENT_LINK_TTL_SECONDS)
        // Audited by month only - the signed URL is never logged or audited.
        await recordAuditEvent(opts.db, {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: 'billing.statement_link',
          targetType: 'statement',
          targetId: request.body.month,
        })
        return reply.status(200).send({
          data: {
            month: request.body.month,
            url,
            expires_at: new Date(clock() + STATEMENT_LINK_TTL_SECONDS * 1000).toISOString(),
          },
          meta: { request_id: request.id },
        })
      },
    )
  },
)
