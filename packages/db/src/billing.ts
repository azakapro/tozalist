import { and, asc, count, eq, gte, isNull, lt, lte, sql as rawSql, sum } from 'drizzle-orm'
import type { DatabaseClient, DatabaseExecutor } from './client.js'
import { recordAuditEvent } from './api-keys.js'
import { sha256Hex } from './crypto.js'
import { creditLedger, invoiceRequests, organizations } from './schema/index.js'
import type { CreditLedgerEntry } from './schema/index.js'

/**
 * Invoice-based pilot billing (roadmap 7.2). Ledger-only accounting: a grant
 * is one additive credit_ledger row - balances stay SUM(delta), history is
 * never rewritten, and there is deliberately NO payment-provider code here.
 */

export type GrantResult =
  | { ok: true; ledgerId: string; referenceId: string }
  | { ok: false; reason: 'invalid_input' | 'org_not_found' | 'org_deleted' | 'duplicate_reference' }

/**
 * The replay guard: the reference is derived from WHAT is being granted, so
 * re-running the identical command (an interrupted CLI, a double Enter, a
 * retried runbook step) collides with the partial unique index on
 * (org_id, reference_id) instead of granting twice. A genuinely different
 * grant - other amount or other invoice note - gets a different reference.
 * Callers must pass the CANONICAL (trimmed) note - grantCreditsWithAudit
 * does, so whitespace variants of one invoice share one reference.
 */
export function grantReference(credits: number, note: string): string {
  return `grant:${sha256Hex(`${credits}:${note}`).slice(0, 32)}`
}

/**
 * One manual grant + its audit event, atomically.
 *
 * This helper is the AUTHORITATIVE boundary for manual grants, so it enforces
 * the accounting invariant itself instead of trusting its callers: credits
 * must be a positive safe integer and the note non-blank. Validation and note
 * canonicalization happen before the reference is derived and before any
 * transaction opens - an invalid call writes nothing, anywhere, and the
 * returned reason is a fixed token that never echoes the input.
 */
export async function grantCreditsWithAudit(
  db: DatabaseClient,
  input: { orgId: string; credits: number; note: string; actorLabel?: string },
  now: Date = new Date(),
): Promise<GrantResult> {
  if (!Number.isSafeInteger(input.credits) || input.credits <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note === '') {
    return { ok: false, reason: 'invalid_input' }
  }
  const referenceId = grantReference(input.credits, note)
  try {
    return await db.transaction(async (tx) => {
      const [org] = await tx
        .select({ id: organizations.id, deletedAt: organizations.deletedAt })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .for('update')
      if (org === undefined) return { ok: false, reason: 'org_not_found' } as const
      if (org.deletedAt !== null) return { ok: false, reason: 'org_deleted' } as const

      const [entry] = await tx
        .insert(creditLedger)
        .values({
          orgId: input.orgId,
          delta: input.credits,
          reason: 'grant',
          referenceId,
          note,
        })
        .returning({ id: creditLedger.id })
      if (entry === undefined) throw new Error('grant insert returned no row')

      await recordAuditEvent(
        tx,
        {
          orgId: input.orgId,
          action: 'billing.grant',
          targetType: 'credit_ledger',
          targetId: entry.id,
          // Amount and reference only: the note may quote an invoice number,
          // which is fine, but keep the audit record minimal by policy.
          metadata: { credits: input.credits, reference_id: referenceId },
        },
        now,
      )
      return { ok: true, ledgerId: entry.id, referenceId } as const
    })
  } catch (error) {
    if (error instanceof Error && /credit_ledger_org_id_reference_id_uniq/.test(error.message)) {
      return { ok: false, reason: 'duplicate_reference' }
    }
    throw error
  }
}

export type BillingSummary = {
  balance: number
  lastGrant: number | null
  monthToDate: { creditsGranted: number; creditsConsumed: number; batchesRun: number }
}

const CONSUMPTION_REASONS = ['single_check', 'batch_check'] as const

/** Start of the month containing `now`, in UTC. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Balance, most recent grant, and month-to-date movement, all from the ledger. */
export async function getBillingSummary(
  db: DatabaseExecutor,
  orgId: string,
  now: Date = new Date(),
): Promise<BillingSummary> {
  const start = monthStartUtc(now)
  const [balanceRow] = await db
    .select({ total: sum(creditLedger.delta) })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId))
  const [grantRow] = await db
    .select({ delta: creditLedger.delta })
    .from(creditLedger)
    .where(and(eq(creditLedger.orgId, orgId), eq(creditLedger.reason, 'grant')))
    .orderBy(rawSql`${creditLedger.createdAt} desc, ${creditLedger.id} desc`)
    .limit(1)
  const inMonth = and(
    eq(creditLedger.orgId, orgId),
    gte(creditLedger.createdAt, start),
    lte(creditLedger.createdAt, now),
  )
  const [granted] = await db
    .select({ total: sum(creditLedger.delta) })
    .from(creditLedger)
    .where(and(inMonth, eq(creditLedger.reason, 'grant')))
  const [consumed] = await db
    .select({ total: sum(creditLedger.delta) })
    .from(creditLedger)
    .where(and(inMonth, rawSql`${creditLedger.reason} in ('single_check', 'batch_check')`))
  const [batchCount] = await db
    .select({ total: count() })
    .from(creditLedger)
    .where(and(inMonth, eq(creditLedger.reason, 'batch_check')))

  return {
    balance: Number(balanceRow?.total ?? 0),
    lastGrant: grantRow?.delta ?? null,
    monthToDate: {
      creditsGranted: Number(granted?.total ?? 0),
      creditsConsumed: -Number(consumed?.total ?? 0),
      batchesRun: Number(batchCount?.total ?? 0),
    },
  }
}

export type MonthlyStatement = {
  month: string
  openingBalance: number
  creditsGranted: number
  creditsConsumed: number
  creditsRefunded: number
  adjustments: number
  closingBalance: number
  checksCharged: number
  batchesRun: number
  entries: CreditLedgerEntry[]
}

/** Parses YYYY-MM into [start, end) UTC instants; null for invalid months. */
export function parseStatementMonth(month: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (match === null) return null
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11 || year < 2020 || year > 2100) return null
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  }
}

/**
 * Everything a monthly statement needs, computed purely from the ledger so it
 * stays correct after check rows expire. Month boundaries are [start, end):
 * an entry at exactly 00:00 on the 1st belongs to that month, one at exactly
 * 00:00 on the next 1st belongs to the next.
 */
export async function getMonthlyStatement(
  db: DatabaseExecutor,
  orgId: string,
  month: string,
): Promise<MonthlyStatement | null> {
  const bounds = parseStatementMonth(month)
  if (bounds === null) return null

  const [openingRow] = await db
    .select({ total: sum(creditLedger.delta) })
    .from(creditLedger)
    .where(and(eq(creditLedger.orgId, orgId), lt(creditLedger.createdAt, bounds.start)))
  const entries = await db
    .select()
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.orgId, orgId),
        gte(creditLedger.createdAt, bounds.start),
        lt(creditLedger.createdAt, bounds.end),
      ),
    )
    .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id))

  const byReason = (reasons: readonly string[]): number =>
    entries
      .filter((entry) => reasons.includes(entry.reason))
      .reduce((total, entry) => total + entry.delta, 0)

  const openingBalance = Number(openingRow?.total ?? 0)
  const creditsGranted = byReason(['grant'])
  const consumedDelta = byReason(CONSUMPTION_REASONS)
  const creditsRefunded = byReason(['refund'])
  const adjustments = byReason(['adjustment'])
  const monthDelta = entries.reduce((total, entry) => total + entry.delta, 0)

  return {
    month,
    openingBalance,
    creditsGranted,
    creditsConsumed: -consumedDelta,
    creditsRefunded,
    adjustments,
    closingBalance: openingBalance + monthDelta,
    checksCharged: -consumedDelta,
    batchesRun: entries.filter((entry) => entry.reason === 'batch_check').length,
    entries,
  }
}

/** Records an invoice request; plan validity is the caller's (config) concern. */
export async function createInvoiceRequest(
  db: DatabaseClient,
  input: { orgId: string; planCode: string; requestedByUserId: string },
  now: Date = new Date(),
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, input.orgId), isNull(organizations.deletedAt)))
    if (org === undefined) return null
    const [request] = await tx
      .insert(invoiceRequests)
      .values({
        orgId: input.orgId,
        planCode: input.planCode,
        requestedByUserId: input.requestedByUserId,
      })
      .returning({ id: invoiceRequests.id })
    if (request === undefined) throw new Error('invoice request insert returned no row')
    await recordAuditEvent(
      tx,
      {
        orgId: input.orgId,
        actorUserId: input.requestedByUserId,
        action: 'billing.invoice_requested',
        targetType: 'invoice_request',
        targetId: request.id,
        metadata: { plan_code: input.planCode },
      },
      now,
    )
    return { id: request.id }
  })
}
