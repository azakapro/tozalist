import { and, asc, eq, gt } from 'drizzle-orm'
import type { DatabaseExecutor } from './client.js'
import {
  auditEvents,
  batches,
  creditLedger,
  emailChecks,
  phoneChecks,
  type AuditEvent,
  type Batch,
  type CreditLedgerEntry,
  type EmailCheck,
  type PhoneCheck,
} from './schema/index.js'

/**
 * Keyset-paginated readers for the self-service data export. Each pages by
 * primary key so the export streams an organisation's data without ever
 * holding a full table in memory, and without OFFSET scans.
 *
 * Scope: strictly one organisation per call - the export ZIP must never be
 * able to contain another organisation's rows.
 */

export const EXPORT_PAGE_SIZE = 1000

async function page<T extends { id: string }>(
  query: (afterId: string | null) => Promise<T[]>,
  afterId: string | null,
): Promise<{ rows: T[]; nextAfterId: string | null }> {
  const rows = await query(afterId)
  const last = rows[rows.length - 1]
  return { rows, nextAfterId: rows.length < EXPORT_PAGE_SIZE ? null : (last?.id ?? null) }
}

export function pageEmailChecksForExport(db: DatabaseExecutor, orgId: string) {
  return (afterId: string | null) =>
    page(
      (after) =>
        db
          .select()
          .from(emailChecks)
          .where(
            after === null
              ? eq(emailChecks.orgId, orgId)
              : and(eq(emailChecks.orgId, orgId), gt(emailChecks.id, after)),
          )
          .orderBy(asc(emailChecks.id))
          .limit(EXPORT_PAGE_SIZE),
      afterId,
    )
}

export function pagePhoneChecksForExport(db: DatabaseExecutor, orgId: string) {
  return (afterId: string | null) =>
    page(
      (after) =>
        db
          .select()
          .from(phoneChecks)
          .where(
            after === null
              ? eq(phoneChecks.orgId, orgId)
              : and(eq(phoneChecks.orgId, orgId), gt(phoneChecks.id, after)),
          )
          .orderBy(asc(phoneChecks.id))
          .limit(EXPORT_PAGE_SIZE),
      afterId,
    )
}

export function pageBatchesForExport(db: DatabaseExecutor, orgId: string) {
  return (afterId: string | null) =>
    page(
      (after) =>
        db
          .select()
          .from(batches)
          .where(
            after === null
              ? eq(batches.orgId, orgId)
              : and(eq(batches.orgId, orgId), gt(batches.id, after)),
          )
          .orderBy(asc(batches.id))
          .limit(EXPORT_PAGE_SIZE),
      afterId,
    )
}

export function pageLedgerForExport(db: DatabaseExecutor, orgId: string) {
  return (afterId: string | null) =>
    page(
      (after) =>
        db
          .select()
          .from(creditLedger)
          .where(
            after === null
              ? eq(creditLedger.orgId, orgId)
              : and(eq(creditLedger.orgId, orgId), gt(creditLedger.id, after)),
          )
          .orderBy(asc(creditLedger.id))
          .limit(EXPORT_PAGE_SIZE),
      afterId,
    )
}

export function pageAuditEventsForExport(db: DatabaseExecutor, orgId: string) {
  return (afterId: string | null) =>
    page(
      (after) =>
        db
          .select()
          .from(auditEvents)
          .where(
            after === null
              ? eq(auditEvents.orgId, orgId)
              : and(eq(auditEvents.orgId, orgId), gt(auditEvents.id, after)),
          )
          .orderBy(asc(auditEvents.id))
          .limit(EXPORT_PAGE_SIZE),
      afterId,
    )
}

export type ExportPager<T extends { id: string }> = (
  afterId: string | null,
) => Promise<{ rows: T[]; nextAfterId: string | null }>

export type { AuditEvent, Batch, CreditLedgerEntry, EmailCheck, PhoneCheck }
