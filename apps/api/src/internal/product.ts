import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  createBatchWithReservation,
  deleteBatchForOrg,
  getBatchForOrg,
  getChecksPerDay,
  getCreditBalance,
  getLedgerWithRunningBalance,
  listBatchesForOrg,
  recordAuditEvent,
  type DatabaseClient,
} from '@tozalist/db'
import { batchInputKey, batchResultKey, type ObjectStorage } from '@tozalist/shared'
import type { BalanceCache } from '../balance-cache.js'
import { performEmailCheck, performPhoneCheck, type CheckServiceDeps } from '../check-service.js'
import { inspectCsv, MAX_BATCH_ROWS } from '../csv-inspect.js'
import { sendError } from '../errors.js'
import { renderEmailCheckData, renderPhoneCheckData } from '../render.js'
import type { BatchQueuePublisher, EngineCaller, SmtpQueuePublisher } from '../types.js'
import { readSession, type SessionConfig, type SessionData } from './session.js'

/**
 * Session-authenticated product endpoints for the dashboard: single checks,
 * batches and usage. Thin wrappers over the SAME service/helpers the public
 * /v1 routes use - identical credit, cache, and retention behavior. All
 * hidden from the public OpenAPI document.
 */

export type InternalProductOptions = {
  db: DatabaseClient
  session: SessionConfig
  engine: EngineCaller
  smtpQueue: SmtpQueuePublisher
  balanceCache: BalanceCache
  smtpEnabled: boolean
  storage?: ObjectStorage
  batchQueue?: BatchQueuePublisher
}

const HIDDEN = { hide: true } as const

export const internalProductRoutes = fp<InternalProductOptions>(
  async (app: FastifyInstance, opts) => {
    const checkDeps: CheckServiceDeps = {
      db: opts.db,
      engine: opts.engine,
      smtpQueue: opts.smtpQueue,
      balanceCache: opts.balanceCache,
      smtpEnabled: opts.smtpEnabled,
    }

    async function requireVerified(
      request: FastifyRequest,
      reply: FastifyReply,
      csrf: boolean,
    ): Promise<SessionData | null> {
      const session = await readSession(request, opts.session)
      if (session === null || !session.mfaVerified) {
        void sendError(reply, 'UNAUTHORIZED')
        return null
      }
      if (csrf) {
        const token = request.headers['x-csrf-token']
        if (typeof token !== 'string' || token !== session.csrfToken) {
          void sendError(reply, 'UNAUTHORIZED', 'The request is missing a valid CSRF token.')
          return null
        }
      }
      return session
    }

    // ---- single checks -----------------------------------------------------

    app.post<{ Body: { email: string; smtp?: boolean } }>(
      '/internal/check/email',
      {
        schema: {
          ...HIDDEN,
          body: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                minLength: 1,
                maxLength: 320,
                pattern: '^[^\\u0000-\\u001f\\u007f]*$',
              },
              smtp: { type: 'boolean' },
            },
            required: ['email'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const session = await requireVerified(request, reply, true)
        if (session === null) return

        const outcome = await performEmailCheck(checkDeps, session.orgId, {
          email: request.body.email,
          smtp: request.body.smtp === true,
          requestId: request.id,
        })
        if (outcome.kind === 'insufficient') return sendError(reply, 'INSUFFICIENT_CREDITS')
        if (outcome.kind !== 'ok') return sendError(reply, 'INTERNAL_ERROR')

        return reply.status(200).send({
          data: renderEmailCheckData(outcome.check, outcome.snapshot),
          meta: {
            request_id: request.id,
            credits_used: outcome.creditsUsed,
            credits_remaining: outcome.creditsRemaining,
            cached: outcome.cached,
            smtp: outcome.smtp,
          },
        })
      },
    )

    app.post<{ Body: { phone: string; country?: string } }>(
      '/internal/check/phone',
      {
        schema: {
          ...HIDDEN,
          body: {
            type: 'object',
            properties: {
              phone: {
                type: 'string',
                minLength: 1,
                maxLength: 64,
                pattern: '^[^\\u0000-\\u001f\\u007f]*$',
              },
              country: { type: 'string', minLength: 2, maxLength: 2 },
            },
            required: ['phone'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const session = await requireVerified(request, reply, true)
        if (session === null) return

        const outcome = await performPhoneCheck(opts, session.orgId, {
          phone: request.body.phone,
          country: request.body.country ?? 'UZ',
        })
        if (outcome.kind === 'insufficient') return sendError(reply, 'INSUFFICIENT_CREDITS')

        return reply.status(200).send({
          data: renderPhoneCheckData(outcome.check),
          meta: {
            request_id: request.id,
            credits_used: 1,
            credits_remaining: outcome.creditsRemaining,
          },
        })
      },
    )

    // ---- batches -----------------------------------------------------------

    if (opts.storage !== undefined && opts.batchQueue !== undefined) {
      const storage = opts.storage
      const batchQueue = opts.batchQueue

      app.post('/internal/batches', { schema: HIDDEN }, async (request, reply) => {
        const session = await requireVerified(request, reply, true)
        if (session === null) return

        const upload = await request.file()
        if (upload === undefined) {
          return sendError(reply, 'VALIDATION_ERROR', 'A CSV file upload is required.')
        }

        const batchId = randomUUID()
        const inputKey = batchInputKey(session.orgId, batchId)
        const toStorage = new PassThrough()
        const toInspect = new PassThrough()
        upload.file.pipe(toStorage)
        upload.file.pipe(toInspect)

        let inspection
        try {
          const [, inspected] = await Promise.all([
            storage.uploadStream(inputKey, toStorage),
            inspectCsv(toInspect),
          ])
          inspection = inspected
          if (upload.file.truncated) {
            await storage.deleteObjects([inputKey])
            return sendError(reply, 'PAYLOAD_TOO_LARGE')
          }
        } catch {
          await storage.deleteObjects([inputKey]).catch(() => undefined)
          return sendError(reply, 'INTERNAL_ERROR')
        }

        if (!inspection.ok) {
          await storage.deleteObjects([inputKey])
          const message =
            inspection.reason === 'too_many_rows'
              ? `The file exceeds the maximum of ${MAX_BATCH_ROWS} rows.`
              : inspection.reason === 'empty'
                ? 'The file contains no data rows.'
                : 'No email column could be detected.'
          return sendError(reply, 'VALIDATION_ERROR', message)
        }

        const created = await createBatchWithReservation(opts.db, {
          batchId,
          orgId: session.orgId,
          filename: upload.filename || 'upload.csv',
          totalRows: inspection.totalRows,
          inputObjectKey: inputKey,
          stats: {
            email_column: inspection.emailColumn,
            has_header: inspection.hasHeader,
            malformed_rows: 0,
            charged: 0,
            cached: 0,
            duplicates: 0,
            engine_errors: 0,
            distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
          },
        })
        if (created.kind === 'org_unavailable') {
          await storage.deleteObjects([inputKey])
          return sendError(reply, 'UNAUTHORIZED')
        }
        if (created.kind === 'insufficient') {
          await storage.deleteObjects([inputKey])
          return sendError(
            reply,
            'INSUFFICIENT_CREDITS',
            `Not enough credits for this batch: ${created.shortfall} more needed.`,
          )
        }

        try {
          await batchQueue.enqueue(batchId, request.id)
        } catch {
          const { failBatch } = await import('@tozalist/db')
          await failBatch(opts.db, {
            batchId,
            orgId: session.orgId,
            reservedCredits: inspection.totalRows,
            error: 'queue_unavailable',
          })
          await storage.deleteObjects([inputKey]).catch(() => undefined)
          return sendError(reply, 'INTERNAL_ERROR')
        }

        await opts.balanceCache.set(session.orgId, created.balance)
        return reply.status(200).send({
          data: {
            batch_id: batchId,
            total_rows: inspection.totalRows,
            credit_cost: inspection.totalRows,
            status: 'pending',
          },
          meta: { request_id: request.id, credits_remaining: created.balance },
        })
      })

      app.get<{ Querystring: { cursor?: string; limit?: string } }>(
        '/internal/batches',
        { schema: HIDDEN },
        async (request, reply) => {
          const session = await requireVerified(request, reply, false)
          if (session === null) return
          const page = await listBatchesForOrg(opts.db, session.orgId, {
            ...(request.query.cursor !== undefined ? { cursor: request.query.cursor } : {}),
            limit: 20,
          })
          if (page === null) return sendError(reply, 'VALIDATION_ERROR')
          return reply.status(200).send({
            data: {
              batches: page.entries.map((batch) => renderInternalBatch(batch)),
              next_cursor: page.nextCursor,
            },
            meta: { request_id: request.id },
          })
        },
      )

      app.get<{ Params: { id: string } }>(
        '/internal/batches/:id',
        {
          schema: {
            ...HIDDEN,
            params: {
              type: 'object',
              properties: { id: { type: 'string', format: 'uuid' } },
              required: ['id'],
              additionalProperties: false,
            },
          },
        },
        async (request, reply) => {
          const session = await requireVerified(request, reply, false)
          if (session === null) return
          const batch = await getBatchForOrg(opts.db, request.params.id, session.orgId)
          if (batch === undefined) return sendError(reply, 'NOT_FOUND')
          let downloadUrl: string | null = null
          if (batch.status === 'done' && batch.resultObjectKey !== null) {
            downloadUrl = await storage.presignDownload(batch.resultObjectKey, 3600)
          }
          return reply.status(200).send({
            data: { ...renderInternalBatch(batch), download_url: downloadUrl },
            meta: { request_id: request.id },
          })
        },
      )

      app.post<{ Params: { id: string } }>(
        '/internal/batches/:id/delete',
        {
          schema: {
            ...HIDDEN,
            params: {
              type: 'object',
              properties: { id: { type: 'string', format: 'uuid' } },
              required: ['id'],
              additionalProperties: false,
            },
          },
        },
        async (request, reply) => {
          const session = await requireVerified(request, reply, true)
          if (session === null) return
          const deleted = await deleteBatchForOrg(opts.db, request.params.id, session.orgId)
          if (deleted.kind === 'not_found') return sendError(reply, 'NOT_FOUND')
          if (deleted.kind === 'processing') {
            return sendError(
              reply,
              'CONFLICT',
              'The batch is currently being processed and cannot be deleted. Retry once it has completed or failed.',
            )
          }
          const keys = [deleted.inputObjectKey]
          keys.push(deleted.resultObjectKey ?? batchResultKey(session.orgId, request.params.id))
          await storage.deleteObjects(keys).catch(() => undefined)
          await recordAuditEvent(opts.db, {
            orgId: session.orgId,
            actorUserId: session.userId,
            action: 'batch.deleted',
            targetType: 'batch',
            targetId: request.params.id,
            metadata: { objects_deleted: keys.length, credits_refunded: deleted.refunded },
          })
          return reply
            .status(200)
            .send({ data: { deleted: true }, meta: { request_id: request.id } })
        },
      )
    }

    // ---- usage ---------------------------------------------------------------

    app.get<{ Querystring: { from?: string; to?: string } }>(
      '/internal/usage',
      {
        schema: {
          ...HIDDEN,
          querystring: {
            type: 'object',
            properties: {
              from: { type: 'string', format: 'date' },
              to: { type: 'string', format: 'date' },
            },
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const session = await requireVerified(request, reply, false)
        if (session === null) return

        const from = request.query.from !== undefined ? new Date(request.query.from) : undefined
        const to =
          request.query.to !== undefined
            ? new Date(new Date(request.query.to).getTime() + 24 * 60 * 60 * 1000 - 1)
            : undefined

        const [balance, ledger, perDay] = await Promise.all([
          getCreditBalance(opts.db, session.orgId),
          getLedgerWithRunningBalance(opts.db, session.orgId, {
            ...(from !== undefined ? { from } : {}),
            ...(to !== undefined ? { to } : {}),
            limit: 200,
          }),
          getChecksPerDay(opts.db, session.orgId, 30),
        ])

        return reply.status(200).send({
          data: {
            balance,
            ledger: ledger.map((entry) => ({
              id: entry.id,
              delta: entry.delta,
              reason: entry.reason,
              reference_id: entry.referenceId,
              created_at: entry.createdAt.toISOString(),
              running_balance: entry.runningBalance,
            })),
            checks_per_day: perDay,
          },
          meta: { request_id: request.id },
        })
      },
    )
  },
)

function renderInternalBatch(batch: {
  id: string
  filename: string
  status: string
  totalRows: number
  processedRows: number
  stats: unknown
  error: string | null
  createdAt: Date
  completedAt: Date | null
}): Record<string, unknown> {
  const stats = batch.stats as {
    malformed_rows?: number
    distribution?: Record<string, number>
  }
  return {
    batch_id: batch.id,
    filename: batch.filename,
    status: batch.status,
    total_rows: batch.totalRows,
    processed_rows: batch.processedRows,
    malformed_rows: stats.malformed_rows ?? 0,
    verdicts: stats.distribution ?? { valid: 0, invalid: 0, risky: 0, unknown: 0 },
    error: batch.error,
    created_at: batch.createdAt.toISOString(),
    completed_at: batch.completedAt === null ? null : batch.completedAt.toISOString(),
  }
}
