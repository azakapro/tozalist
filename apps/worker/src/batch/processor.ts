import { PassThrough } from 'node:stream'
import { parse } from 'csv-parse'
import type { Job } from 'bullmq'
import type pino from 'pino'
import { aggregate, detectTypo, normalizeEmail, type EngineResponse } from '@tozalist/core'
import {
  claimBatchForProcessing,
  completeBatch,
  failBatch,
  findRecentEmailChecksByHashes,
  insertBatchEmailChecks,
  sha256Hex,
  updateBatchProgress,
  type DatabaseClient,
} from '@tozalist/db'
import {
  batchResultKey,
  parseStoredEmailCheck,
  type BatchProcessJobData,
  type BatchStats,
  type ObjectStorage,
  type StoredEmailCheck,
} from '@tozalist/shared'
import type { EngineVerifier } from '../smtp/types.js'
import { emitBatchWebhookEvent, type WebhookJobPublisher } from '../webhooks/emit.js'

/**
 * The batch CSV processor.
 *
 * Streaming end to end: rows are read from object storage through csv-parse
 * and written to the result upload as they are produced - the file itself is
 * never buffered. The only per-file state is the in-file deduplication map
 * (bounded by the 100k row cap) holding one compact result per unique
 * address.
 *
 * Charging: the API reserved 1 credit per row up front. This processor counts
 * what was actually consumed - unique, uncached, well-formed rows - and
 * completion reconciles the difference as one refund entry. Failure refunds
 * the whole reservation. Nothing here writes per-row ledger entries.
 *
 * NOTE (step 4.2 seam): batch completion will also emit a webhook event once
 * the webhook system exists. The single place to attach that is right after
 * completeBatch()/failBatch() below.
 */

export type BatchProcessorDeps = {
  db: DatabaseClient
  storage: ObjectStorage
  engine: EngineVerifier
  logger: pino.Logger
  /** Webhook fan-out for terminal batch events; absent disables emission. */
  webhookPublisher?: WebhookJobPublisher
  /** Rows per cache-lookup/insert chunk. */
  chunkSize?: number
  /** Progress heartbeat interval in rows. */
  progressEvery?: number
}

/** Per-unique-address result. In the dedup map it is stored as ONE encoded
 * string (verdict\x00score\x00codes\x00suggestion): 100k map entries of
 * small objects with arrays would dominate the live heap; flat strings do not. */
type RowResult = {
  verdict: 'valid' | 'invalid' | 'risky' | 'unknown'
  score: number
  reasonCodes: string[]
  suggestion: string
}

const SEP = '\u0000'

function encodeResult(result: RowResult): string {
  return [
    result.verdict,
    String(result.score),
    result.reasonCodes.join('|'),
    result.suggestion,
  ].join(SEP)
}

function decodeResult(encoded: string): RowResult {
  const [verdict, score, codes, suggestion] = encoded.split(SEP)
  return {
    verdict: (verdict ?? 'unknown') as RowResult['verdict'],
    score: Number(score ?? 0),
    reasonCodes: codes === '' || codes === undefined ? [] : codes.split('|'),
    suggestion: suggestion ?? '',
  }
}

type PendingRow = { cells: string[]; normalized: string; hash: string }

const MALFORMED: RowResult = {
  verdict: 'invalid',
  score: 0,
  reasonCodes: ['SYNTAX_INVALID'],
  suggestion: '',
}

export function createBatchProcessor(deps: BatchProcessorDeps) {
  const chunkSize = deps.chunkSize ?? 500
  const progressEvery = deps.progressEvery ?? 500

  return async function processBatch(job: Job<BatchProcessJobData>): Promise<void> {
    const started = Date.now()

    // Atomic claim: the row flips to `processing` only if it still exists in a
    // claimable state. A batch deleted before this point (its reservation was
    // refunded by the deletion) - or one already terminal - is finished
    // QUIETLY: no probes, no result writes, no cache inserts, no ledger
    // mutations, and no error-level noise.
    const claim = await claimBatchForProcessing(deps.db, job.data.batchId)
    if (claim.kind === 'not_claimable') {
      deps.logger.info({ batch_id: job.data.batchId, outcome: 'not_claimable' })
      return
    }
    if (claim.kind === 'org_unavailable') {
      // The organisation vanished after upload: fail the batch and give the
      // full reservation back; nothing customer-visible remains to charge.
      await failBatch(deps.db, {
        batchId: claim.batch.id,
        orgId: claim.batch.orgId,
        reservedCredits: claim.batch.totalRows,
        error: 'org_unavailable',
      })
      deps.logger.warn({ batch_id: claim.batch.id, outcome: 'org_unavailable' })
      return
    }
    const { batch, retentionDays } = claim

    const layout = readLayout(batch.stats)
    if (layout === null) {
      await failBatch(deps.db, {
        batchId: batch.id,
        orgId: batch.orgId,
        reservedCredits: batch.totalRows,
        error: 'invalid_layout',
      })
      deps.logger.warn({ batch_id: batch.id, outcome: 'invalid_layout' })
      return
    }

    const stats: BatchStats = {
      email_column: layout.emailColumn,
      has_header: layout.hasHeader,
      malformed_rows: 0,
      charged: 0,
      cached: 0,
      duplicates: 0,
      engine_errors: 0,
      distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
    }

    const resultKey = batchResultKey(batch.orgId, batch.id)
    const resultStream = new PassThrough()
    const resultUpload = deps.storage.uploadStream(resultKey, resultStream)
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)

    /** In-file dedup: normalized address -> its ENCODED result string. */
    const seen = new Map<string, string>()
    let processed = 0
    let headerWritten = false

    // Backpressure-aware writer: when the S3 upload lags the parser, wait for
    // drain instead of letting the PassThrough buffer the whole output file.
    const writeLine = async (line: string): Promise<void> => {
      if (!resultStream.write(line)) {
        await new Promise<void>((resolve) => resultStream.once('drain', resolve))
      }
    }

    const writeRow = (cells: string[], normalized: string, result: RowResult): Promise<void> =>
      writeLine(
        toCsvLine([
          ...cells,
          normalized,
          result.verdict,
          String(result.score),
          result.reasonCodes.join('|'),
          result.suggestion,
        ]),
      )

    /** Resolve a chunk: cache lookups first, then engine calls for the rest. */
    const resolveChunk = async (rows: PendingRow[]): Promise<void> => {
      const unresolved = rows.filter((row) => !seen.has(row.normalized))
      const uniqueByHash = new Map<string, PendingRow>()
      for (const row of unresolved) {
        if (!uniqueByHash.has(row.hash)) uniqueByHash.set(row.hash, row)
      }

      if (uniqueByHash.size > 0) {
        const cachedRows = await findRecentEmailChecksByHashes(deps.db, batch.orgId, [
          ...uniqueByHash.keys(),
        ])
        const freshInserts: Parameters<typeof insertBatchEmailChecks>[1] = []

        for (const [hash, row] of uniqueByHash) {
          const cached = cachedRows.get(hash)
          if (cached !== undefined) {
            const snapshot = parseStoredEmailCheck(cached.checksJson)
            seen.set(
              row.normalized,
              encodeResult({
                verdict: cached.verdict,
                score: snapshot?.score ?? 0,
                reasonCodes: cached.reasonCodes,
                suggestion: snapshot?.typo ?? '',
              }),
            )
            stats.cached += 1
            continue
          }

          // Fresh check: offline engine pass, aggregate, persist for reuse.
          let engineResponse: EngineResponse
          try {
            engineResponse = await deps.engine.verify(row.normalized, {
              smtp: false,
              catchAll: false,
            })
          } catch {
            // One address the engine could not assess must not sink a whole
            // batch: honest unknown, never charged, counted separately.
            seen.set(
              row.normalized,
              encodeResult({
                verdict: 'unknown',
                score: 50,
                reasonCodes: ['MX_LOOKUP_UNAVAILABLE'],
                suggestion: '',
              }),
            )
            stats.engine_errors += 1
            continue
          }

          const typo = detectTypo(engineResponse.syntax.domain)
          const aggregated = aggregate({ engine: engineResponse, typo })
          const snapshot: StoredEmailCheck = {
            engine: engineResponse,
            score: aggregated.score,
            disclaimer: aggregated.disclaimer,
            typo,
            smtp_status: 'skipped',
          }
          seen.set(
            row.normalized,
            encodeResult({
              verdict: aggregated.verdict,
              score: aggregated.score,
              reasonCodes: aggregated.reasonCodes,
              suggestion: typo ?? '',
            }),
          )
          stats.charged += 1
          freshInserts.push({
            orgId: batch.orgId,
            emailNormalized: row.normalized,
            emailHash: row.hash,
            verdict: aggregated.verdict,
            reasonCodes: aggregated.reasonCodes,
            checksJson: snapshot,
            expiresAt,
          })
        }

        await insertBatchEmailChecks(deps.db, freshInserts)
      }

      for (const row of rows) {
        const encoded = seen.get(row.normalized)
        if (encoded === undefined) continue // unreachable; guards the type
        const result = decodeResult(encoded)
        await writeRow(row.cells, row.normalized, result)
        stats.distribution[result.verdict] += 1
        processed += 1
        if (processed % progressEvery === 0) {
          await updateBatchProgress(deps.db, batch.id, processed)
        }
      }
    }

    try {
      const input = await deps.storage.getStream(batch.inputObjectKey)
      const parser = input.pipe(
        parse({ bom: true, relaxColumnCount: true, relaxQuotes: true, skipEmptyLines: true }),
      )

      let chunk: PendingRow[] = []
      let isFirstRecord = true

      for await (const record of parser as AsyncIterable<string[]>) {
        if (isFirstRecord) {
          isFirstRecord = false
          if (layout.hasHeader) {
            await writeLine(
              toCsvLine([
                ...record,
                'normalized_email',
                'verdict',
                'score',
                'reason_codes',
                'suggestion',
              ]),
            )
            headerWritten = true
            continue
          }
        }

        const raw = record[layout.emailColumn] ?? ''
        const normalized = normalizeEmail(raw).normalized ?? ''

        if (normalized === '') {
          // Malformed row: recorded, counted, never charged, never crashing.
          await writeRow(record, '', MALFORMED)
          stats.malformed_rows += 1
          stats.distribution.invalid += 1
          processed += 1
          continue
        }

        if (seen.has(normalized)) {
          // In-file duplicate rows still resolve inside the chunk pass so the
          // original row order is preserved; count them here.
          stats.duplicates += 1
        }

        chunk.push({ cells: record, normalized, hash: sha256Hex(normalized) })
        if (chunk.length >= chunkSize) {
          await resolveChunk(chunk)
          chunk = []
        }
      }

      if (chunk.length > 0) await resolveChunk(chunk)
      void headerWritten

      resultStream.end()
      await resultUpload

      await completeBatch(deps.db, {
        batchId: batch.id,
        orgId: batch.orgId,
        resultObjectKey: resultKey,
        processedRows: processed,
        stats: stats as unknown as Record<string, unknown>,
        chargedCredits: stats.charged,
        reservedCredits: batch.totalRows,
        retentionDays,
      })
      if (deps.webhookPublisher !== undefined) {
        try {
          await emitBatchWebhookEvent(deps.db, deps.webhookPublisher, deps.logger, {
            orgId: batch.orgId,
            event: 'batch.completed',
            data: {
              batch_id: batch.id,
              status: 'done',
              total_rows: batch.totalRows,
              verdict_counts: stats.distribution,
            },
            retentionDays,
          })
        } catch (error) {
          deps.logger.warn({
            batch_id: batch.id,
            outcome: 'webhook_emit_failed',
            error_name: error instanceof Error ? error.name : 'unknown',
          })
        }
      }

      deps.logger.info({
        batch_id: batch.id,
        outcome: 'done',
        duration_ms: Date.now() - started,
        rows: processed,
        charged: stats.charged,
        cached: stats.cached,
        malformed: stats.malformed_rows,
      })
    } catch (error) {
      resultStream.destroy()
      await resultUpload.catch(() => undefined)
      // Full refund: a failed batch must never keep any part of its reservation.
      await failBatch(deps.db, {
        batchId: batch.id,
        orgId: batch.orgId,
        reservedCredits: batch.totalRows,
        error: 'processing_failed',
      })
      if (deps.webhookPublisher !== undefined) {
        try {
          await emitBatchWebhookEvent(deps.db, deps.webhookPublisher, deps.logger, {
            orgId: batch.orgId,
            event: 'batch.failed',
            data: {
              batch_id: batch.id,
              status: 'failed',
              total_rows: batch.totalRows,
              verdict_counts: stats.distribution,
            },
            retentionDays,
          })
        } catch (emitError) {
          deps.logger.warn({
            batch_id: batch.id,
            outcome: 'webhook_emit_failed',
            error_name: emitError instanceof Error ? emitError.name : 'unknown',
          })
        }
      }
      deps.logger.error({
        batch_id: batch.id,
        outcome: 'failed',
        duration_ms: Date.now() - started,
        error_name: error instanceof Error ? error.name : 'unknown',
      })
    }
  }
}

function readLayout(stats: unknown): { emailColumn: number; hasHeader: boolean } | null {
  if (typeof stats !== 'object' || stats === null) return null
  const record = stats as Record<string, unknown>
  const emailColumn = record.email_column
  const hasHeader = record.has_header
  if (typeof emailColumn !== 'number' || !Number.isInteger(emailColumn) || emailColumn < 0) {
    return null
  }
  if (typeof hasHeader !== 'boolean') return null
  return { emailColumn, hasHeader }
}

/** Minimal CSV escaping: quote cells containing separators, quotes or newlines. */
function toCsvLine(cells: string[]): string {
  return (
    cells
      .map((cell) => {
        if (/[",\n\r]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`
        return cell
      })
      .join(',') + '\n'
  )
}
