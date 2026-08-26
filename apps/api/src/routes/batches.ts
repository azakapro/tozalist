import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import multipart from '@fastify/multipart'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import {
  createBatchWithReservation,
  deleteBatchForOrg,
  getBatchForOrg,
  listBatchesForOrg,
  recordAuditEvent,
  type Batch,
  type DatabaseClient,
} from '@tozalist/db'
import {
  batchInputKey,
  batchResultKey,
  type BatchStats,
  type ObjectStorage,
} from '@tozalist/shared'
import { inspectCsv, MAX_BATCH_ROWS } from '../csv-inspect.js'
import { sendError } from '../errors.js'
import {
  createBatchOperation,
  deleteBatchOperation,
  getBatchOperation,
  listBatchesOperation,
} from '../openapi/operations.js'
import { API_VERSION } from '../render.js'
import type { BatchQueuePublisher } from '../types.js'

export type BatchRouteOptions = {
  db: DatabaseClient
  storage: ObjectStorage
  batchQueue: BatchQueuePublisher
}

/** Max upload size: 20 MB, enforced by the multipart parser during streaming. */
export const MAX_BATCH_UPLOAD_BYTES = 20 * 1024 * 1024

/** Signed download links stay valid for one hour. */
export const DOWNLOAD_URL_TTL_SECONDS = 3600

/** Fixed message for a delete refused because the batch is being processed. */
export const BATCH_PROCESSING_DELETE_MESSAGE =
  'The batch is currently being processed and cannot be deleted. Retry once it has completed or failed.'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

function emptyStats(emailColumn: number, hasHeader: boolean): BatchStats {
  return {
    email_column: emailColumn,
    has_header: hasHeader,
    malformed_rows: 0,
    charged: 0,
    cached: 0,
    duplicates: 0,
    engine_errors: 0,
    distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
  }
}

function renderBatch(batch: Batch): Record<string, unknown> {
  const stats = batch.stats as Partial<BatchStats>
  return {
    batch_id: batch.id,
    filename: batch.filename,
    status: batch.status,
    total_rows: batch.totalRows,
    processed_rows: batch.processedRows,
    malformed_rows: stats.malformed_rows ?? 0,
    charged_credits: stats.charged ?? 0,
    cached_rows: stats.cached ?? 0,
    duplicate_rows: stats.duplicates ?? 0,
    verdicts: stats.distribution ?? { valid: 0, invalid: 0, risky: 0, unknown: 0 },
    error: batch.error,
    created_at: batch.createdAt.toISOString(),
    completed_at: batch.completedAt === null ? null : batch.completedAt.toISOString(),
  }
}

export const batchRoutes = fp<BatchRouteOptions>(async (app: FastifyInstance, opts) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_BATCH_UPLOAD_BYTES, files: 1, fields: 0 },
  })

  app.post('/v1/batches', { schema: createBatchOperation.schema }, async (request, reply) => {
    const auth = request.auth
    if (auth === null) return sendError(reply, 'UNAUTHORIZED')

    const upload = await request.file()
    if (upload === undefined) {
      return sendError(reply, 'VALIDATION_ERROR', 'A CSV file upload is required.')
    }

    const batchId = randomUUID()
    const inputKey = batchInputKey(auth.orgId, batchId)

    // Tee the incoming stream: one branch goes to object storage, the other
    // through the CSV inspector. Nothing buffers the whole file.
    const toStorage = new PassThrough()
    const toInspect = new PassThrough()
    upload.file.pipe(toStorage)
    upload.file.pipe(toInspect)

    let inspection
    try {
      const [, inspected] = await Promise.all([
        opts.storage.uploadStream(inputKey, toStorage),
        inspectCsv(toInspect),
      ])
      inspection = inspected
      if (upload.file.truncated) {
        await opts.storage.deleteObjects([inputKey])
        return sendError(reply, 'PAYLOAD_TOO_LARGE')
      }
    } catch (error) {
      await opts.storage.deleteObjects([inputKey]).catch(() => undefined)
      request.log.error(
        { request_id: request.id, error_name: error instanceof Error ? error.name : 'unknown' },
        'batch upload failed',
      )
      return sendError(reply, 'INTERNAL_ERROR')
    }

    if (!inspection.ok) {
      await opts.storage.deleteObjects([inputKey])
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
      orgId: auth.orgId,
      filename: upload.filename || 'upload.csv',
      totalRows: inspection.totalRows,
      inputObjectKey: inputKey,
      stats: emptyStats(inspection.emailColumn, inspection.hasHeader),
    })

    if (created.kind === 'org_unavailable') {
      await opts.storage.deleteObjects([inputKey])
      return sendError(reply, 'UNAUTHORIZED')
    }
    if (created.kind === 'insufficient') {
      await opts.storage.deleteObjects([inputKey])
      return sendError(
        reply,
        'INSUFFICIENT_CREDITS',
        `Not enough credits for this batch: ${created.shortfall} more needed.`,
      )
    }

    try {
      await opts.batchQueue.enqueue(batchId, request.id)
    } catch (error) {
      // The reservation must not survive a batch that can never run.
      const { failBatch } = await import('@tozalist/db')
      await failBatch(opts.db, {
        batchId,
        orgId: auth.orgId,
        reservedCredits: inspection.totalRows,
        error: 'queue_unavailable',
      })
      await opts.storage.deleteObjects([inputKey]).catch(() => undefined)
      request.log.error(
        { request_id: request.id, error_name: error instanceof Error ? error.name : 'unknown' },
        'batch enqueue failed',
      )
      return sendError(reply, 'INTERNAL_ERROR')
    }

    return reply.status(200).send({
      data: {
        batch_id: batchId,
        total_rows: inspection.totalRows,
        credit_cost: inspection.totalRows,
        status: 'pending',
      },
      meta: {
        request_id: request.id,
        credits_remaining: created.balance,
        api_version: API_VERSION,
      },
    })
  })

  app.get<{ Params: { id: string } }>(
    '/v1/batches/:id',
    { schema: getBatchOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      const batch = await getBatchForOrg(opts.db, request.params.id, auth.orgId)
      if (batch === undefined) return sendError(reply, 'NOT_FOUND')

      let downloadUrl: string | null = null
      if (batch.status === 'done' && batch.resultObjectKey !== null) {
        downloadUrl = await opts.storage.presignDownload(
          batch.resultObjectKey,
          DOWNLOAD_URL_TTL_SECONDS,
        )
      }

      return reply.status(200).send({
        data: { ...renderBatch(batch), download_url: downloadUrl },
        meta: { request_id: request.id, api_version: API_VERSION },
      })
    },
  )

  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/v1/batches',
    { schema: listBatchesOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      const limit =
        request.query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(request.query.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        return sendError(reply, 'VALIDATION_ERROR')
      }

      const page = await listBatchesForOrg(opts.db, auth.orgId, {
        ...(request.query.cursor !== undefined ? { cursor: request.query.cursor } : {}),
        limit,
      })
      if (page === null) return sendError(reply, 'VALIDATION_ERROR')

      return reply.status(200).send({
        data: {
          batches: page.entries.map((entry) => renderBatch(entry)),
          next_cursor: page.nextCursor,
        },
        meta: { request_id: request.id, api_version: API_VERSION },
      })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/v1/batches/:id',
    { schema: deleteBatchOperation.schema },
    async (request, reply) => {
      const auth = request.auth
      if (auth === null) return sendError(reply, 'UNAUTHORIZED')

      const deleted = await deleteBatchForOrg(opts.db, request.params.id, auth.orgId)
      // Cross-org and unknown ids share one 404; only the owner can learn more.
      if (deleted.kind === 'not_found') return sendError(reply, 'NOT_FOUND')
      if (deleted.kind === 'processing') {
        // Success is never claimed while a worker could still act on the
        // batch: an in-flight job may write results, cache rows and a
        // settlement. The owner retries after the terminal state.
        return sendError(reply, 'CONFLICT', BATCH_PROCESSING_DELETE_MESSAGE)
      }

      // Row first, then objects: the transaction above already guarantees no
      // later worker claim can succeed for this batch.
      const keys = [deleted.inputObjectKey]
      if (deleted.resultObjectKey !== null) keys.push(deleted.resultObjectKey)
      // Result key is deterministic; delete it even if never written.
      if (deleted.resultObjectKey === null) keys.push(batchResultKey(auth.orgId, request.params.id))
      try {
        await opts.storage.deleteObjects(keys)
      } catch (error) {
        request.log.error(
          { request_id: request.id, error_name: error instanceof Error ? error.name : 'unknown' },
          'batch object deletion failed',
        )
      }

      await recordAuditEvent(opts.db, {
        orgId: auth.orgId,
        actorApiKeyId: auth.apiKeyId,
        action: 'batch.deleted',
        targetType: 'batch',
        targetId: request.params.id,
        metadata: { objects_deleted: keys.length, credits_refunded: deleted.refunded },
      })

      return reply.status(200).send({
        data: { deleted: true, batch_id: request.params.id },
        meta: { request_id: request.id, api_version: API_VERSION },
      })
    },
  )
})
