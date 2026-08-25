import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { DatabaseClient, DatabaseExecutor } from './client.js'
import { batches, creditLedger, emailChecks, organizations } from './schema/index.js'
import type { Batch, EmailCheck } from './schema/index.js'

/**
 * Batch lifecycle helpers. Credit rules mirror single checks: one locked
 * transaction reserves the whole batch cost as a single batch_check ledger
 * entry; completion or failure reconciles with at most one refund entry per
 * batch, enforced by the ledger's (org_id, reference_id) unique index.
 */

function refundReference(batchId: string): string {
  return `${batchId}:refund`
}

type LockedOrg = { id: string; retentionDays: number }

async function lockOrganization(
  tx: DatabaseExecutor,
  orgId: string,
): Promise<LockedOrg | undefined> {
  const [org] = await tx
    .select({ id: organizations.id, retentionDays: organizations.retentionDays })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .for('update')
  return org
}

async function lockedBalance(tx: DatabaseExecutor, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId))
  return row?.balance ?? 0
}

export type CreateBatchInput = {
  batchId: string
  orgId: string
  filename: string
  totalRows: number
  inputObjectKey: string
  /** BatchStats seed: detected column layout plus zeroed counters. */
  stats: Record<string, unknown>
}

export type CreateBatchResult =
  | { kind: 'created'; batch: Batch; balance: number }
  | { kind: 'insufficient'; balance: number; shortfall: number }
  | { kind: 'org_unavailable' }

/**
 * Creates a batch and reserves its full cost (1 credit per row) as ONE
 * negative ledger entry referenced to the batch id, inside the same locked
 * transaction that verified the balance.
 */
export async function createBatchWithReservation(
  db: DatabaseClient,
  input: CreateBatchInput,
  now: Date = new Date(),
): Promise<CreateBatchResult> {
  return db.transaction(async (tx) => {
    const org = await lockOrganization(tx, input.orgId)
    if (org === undefined) return { kind: 'org_unavailable' } as const

    const balance = await lockedBalance(tx, input.orgId)
    if (balance < input.totalRows) {
      return { kind: 'insufficient', balance, shortfall: input.totalRows - balance } as const
    }

    const expiresAt = new Date(now.getTime() + org.retentionDays * 24 * 60 * 60 * 1000)
    const [batch] = await tx
      .insert(batches)
      .values({
        id: input.batchId,
        orgId: input.orgId,
        filename: input.filename,
        status: 'pending',
        totalRows: input.totalRows,
        processedRows: 0,
        stats: input.stats,
        inputObjectKey: input.inputObjectKey,
        expiresAt,
      })
      .returning()
    if (batch === undefined) throw new Error('failed to insert the batch row')

    await tx.insert(creditLedger).values({
      orgId: input.orgId,
      delta: -input.totalRows,
      reason: 'batch_check',
      referenceId: input.batchId,
    })

    return { kind: 'created', batch, balance: balance - input.totalRows } as const
  })
}

/** Loads one batch for its owning, active org; all misses look identical. */
export async function getBatchForOrg(
  db: DatabaseExecutor,
  id: string,
  orgId: string,
): Promise<Batch | undefined> {
  const [row] = await db
    .select({ batch: batches })
    .from(batches)
    .innerJoin(organizations, eq(batches.orgId, organizations.id))
    .where(and(eq(batches.id, id), eq(batches.orgId, orgId), isNull(organizations.deletedAt)))
  return row?.batch
}

/** Worker-side load: the batch plus its org's retention, org must be active. */
export async function getBatchForProcessing(
  db: DatabaseExecutor,
  id: string,
): Promise<{ batch: Batch; retentionDays: number } | undefined> {
  const [row] = await db
    .select({ batch: batches, retentionDays: organizations.retentionDays })
    .from(batches)
    .innerJoin(organizations, eq(batches.orgId, organizations.id))
    .where(and(eq(batches.id, id), isNull(organizations.deletedAt)))
  return row
}

export type BatchPage = { entries: Batch[]; nextCursor: string | null }

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (iso === undefined || id === undefined) return null
    const createdAt = new Date(iso)
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id }
  } catch {
    return null
  }
}

/** Deterministic (created_at, id) DESC pagination, same shape as usage. */
export async function listBatchesForOrg(
  db: DatabaseExecutor,
  orgId: string,
  options: { cursor?: string; limit: number },
): Promise<BatchPage | null> {
  const decoded = options.cursor !== undefined ? decodeCursor(options.cursor) : null
  if (options.cursor !== undefined && decoded === null) return null

  const filter =
    decoded === null
      ? eq(batches.orgId, orgId)
      : and(
          eq(batches.orgId, orgId),
          or(
            lt(batches.createdAt, decoded.createdAt),
            and(eq(batches.createdAt, decoded.createdAt), lt(batches.id, decoded.id)),
          ),
        )

  const rows = await db
    .select()
    .from(batches)
    .where(filter)
    .orderBy(desc(batches.createdAt), desc(batches.id))
    .limit(options.limit + 1)

  const page = rows.slice(0, options.limit)
  const last = page[page.length - 1]
  return {
    entries: page,
    nextCursor:
      rows.length > options.limit && last !== undefined
        ? encodeCursor(last.createdAt, last.id)
        : null,
  }
}

export type ClaimBatchResult =
  | { kind: 'claimed'; batch: Batch; retentionDays: number }
  | { kind: 'org_unavailable'; batch: Batch }
  | { kind: 'not_claimable' }

/**
 * Atomically claims a batch for processing: the status flips to `processing`
 * only when the row still exists in a claimable state. A row deleted before
 * the claim - or already claimed or terminal - yields `not_claimable`, and the
 * worker must finish quietly. This UPDATE and the DELETE endpoint's row lock
 * contend on the same row, so exactly one of them wins any race.
 */
export async function claimBatchForProcessing(
  db: DatabaseClient,
  id: string,
): Promise<ClaimBatchResult> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(batches)
      .set({ status: 'processing' })
      .where(and(eq(batches.id, id), inArray(batches.status, ['pending', 'validating'])))
      .returning()

    const [batch] = claimed
    if (batch === undefined) return { kind: 'not_claimable' } as const

    const [org] = await tx
      .select({ retentionDays: organizations.retentionDays, deletedAt: organizations.deletedAt })
      .from(organizations)
      .where(eq(organizations.id, batch.orgId))
    if (org === undefined || org.deletedAt !== null) {
      return { kind: 'org_unavailable', batch } as const
    }

    return { kind: 'claimed', batch, retentionDays: org.retentionDays } as const
  })
}

/** Progress heartbeat; called every N rows, never per row. */
export async function updateBatchProgress(
  db: DatabaseExecutor,
  id: string,
  processedRows: number,
): Promise<void> {
  await db.update(batches).set({ processedRows }).where(eq(batches.id, id))
}

export type CompleteBatchInput = {
  batchId: string
  orgId: string
  resultObjectKey: string
  processedRows: number
  stats: Record<string, unknown>
  /** Credits actually consumed: unique, uncached, well-formed rows. */
  chargedCredits: number
  reservedCredits: number
  retentionDays: number
}

/**
 * Terminal success: writes the result pointer, final stats and status, and
 * reconciles the ledger - the unspent part of the reservation comes back as
 * one refund entry. The (org_id, reference_id) unique index makes a duplicate
 * completion attempt unable to refund twice.
 */
export async function completeBatch(
  db: DatabaseClient,
  input: CompleteBatchInput,
  now: Date = new Date(),
): Promise<void> {
  const refund = input.reservedCredits - input.chargedCredits
  await db.transaction(async (tx) => {
    await tx
      .update(batches)
      .set({
        status: 'done',
        processedRows: input.processedRows,
        resultObjectKey: input.resultObjectKey,
        stats: input.stats,
        completedAt: now,
        expiresAt: new Date(now.getTime() + input.retentionDays * 24 * 60 * 60 * 1000),
      })
      .where(eq(batches.id, input.batchId))

    if (refund > 0) {
      await tx.insert(creditLedger).values({
        orgId: input.orgId,
        delta: refund,
        reason: 'refund',
        referenceId: refundReference(input.batchId),
        note: 'Batch reconciliation: reserved minus charged',
      })
    }
  })
}

/**
 * Terminal failure: refunds the ENTIRE reservation and records a safe error
 * category (never foreign error text).
 */
export async function failBatch(
  db: DatabaseClient,
  input: { batchId: string; orgId: string; reservedCredits: number; error: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(batches)
      .set({ status: 'failed', error: input.error })
      .where(eq(batches.id, input.batchId))

    if (input.reservedCredits > 0) {
      await tx
        .insert(creditLedger)
        .values({
          orgId: input.orgId,
          delta: input.reservedCredits,
          reason: 'refund',
          referenceId: refundReference(input.batchId),
          note: 'Batch failed: full reservation refunded',
        })
        .onConflictDoNothing()
    }
  })
}

export type DeleteBatchResult =
  | {
      kind: 'deleted'
      inputObjectKey: string
      resultObjectKey: string | null
      /** Credits refunded by this deletion (0 for terminal batches). */
      refunded: number
    }
  | { kind: 'processing' }
  | { kind: 'not_found' }

/**
 * Deletes a batch for its owning org, safely for the ledger and the worker:
 *
 * - The row is locked FOR UPDATE first, so this serialises against the
 *   worker's atomic claim: after this transaction commits, no later claim can
 *   succeed, and therefore no probe, result object, cache insert, progress
 *   update, or settlement can happen for the deleted batch.
 * - `pending`/`validating` (never claimed): the row is deleted and the FULL
 *   reservation comes back as one refund entry. The (org_id, reference_id)
 *   unique index plus onConflictDoNothing make a second refund impossible.
 * - `processing`: refused - the caller gets `processing` and must retry after
 *   the batch reaches a terminal state. Success is never reported while a
 *   worker could still act on the batch.
 * - `done`/`failed`: the row is deleted; the already-reconciled ledger history
 *   is preserved untouched.
 */
export async function deleteBatchForOrg(
  db: DatabaseClient,
  id: string,
  orgId: string,
): Promise<DeleteBatchResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(batches)
      .where(and(eq(batches.id, id), eq(batches.orgId, orgId)))
      .for('update')
    if (row === undefined) return { kind: 'not_found' } as const

    if (row.status === 'processing') return { kind: 'processing' } as const

    let refunded = 0
    if (row.status === 'pending' || row.status === 'validating') {
      const inserted = await tx
        .insert(creditLedger)
        .values({
          orgId: row.orgId,
          delta: row.totalRows,
          reason: 'refund',
          referenceId: refundReference(row.id),
          note: 'Batch deleted before processing: full reservation refunded',
        })
        .onConflictDoNothing()
        .returning({ id: creditLedger.id })
      refunded = inserted.length > 0 ? row.totalRows : 0
    }

    await tx.delete(batches).where(eq(batches.id, row.id))

    return {
      kind: 'deleted',
      inputObjectKey: row.inputObjectKey,
      resultObjectKey: row.resultObjectKey,
      refunded,
    } as const
  })
}

/** Chunked 7-day cache lookup for many hashes at once. Freshest row wins. */
export async function findRecentEmailChecksByHashes(
  db: DatabaseExecutor,
  orgId: string,
  hashes: string[],
  now: Date = new Date(),
): Promise<Map<string, EmailCheck>> {
  const result = new Map<string, EmailCheck>()
  if (hashes.length === 0) return result

  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const rows = await db
    .select()
    .from(emailChecks)
    .where(
      and(
        eq(emailChecks.orgId, orgId),
        inArray(emailChecks.emailHash, hashes),
        gt(emailChecks.createdAt, cutoff),
        gt(emailChecks.expiresAt, now),
      ),
    )
    .orderBy(desc(emailChecks.createdAt), desc(emailChecks.id))

  for (const row of rows) {
    // Rows arrive newest first; keep the first (freshest) per hash.
    if (!result.has(row.emailHash)) result.set(row.emailHash, row)
  }
  return result
}

/** Bulk insert of batch-produced checks. No per-row ledger entries: the batch
 * reservation already paid for them. */
export async function insertBatchEmailChecks(
  db: DatabaseExecutor,
  rows: Array<{
    orgId: string
    emailNormalized: string
    emailHash: string
    verdict: EmailCheck['verdict']
    reasonCodes: string[]
    checksJson: Record<string, unknown>
    expiresAt: Date
  }>,
): Promise<void> {
  if (rows.length === 0) return
  await db.insert(emailChecks).values(
    rows.map((row) => ({
      id: randomUUID(),
      orgId: row.orgId,
      emailNormalized: row.emailNormalized,
      emailHash: row.emailHash,
      verdict: row.verdict,
      reasonCodes: row.reasonCodes,
      checksJson: row.checksJson,
      cached: false,
      creditsUsed: 1,
      expiresAt: row.expiresAt,
    })),
  )
}
