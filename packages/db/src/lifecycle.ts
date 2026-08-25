import { and, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm'
import type { DatabaseClient, DatabaseExecutor } from './client.js'
import { recordAuditEvent } from './api-keys.js'
import {
  apiKeys,
  batches,
  creditLedger,
  invoiceRequests,
  emailChecks,
  leads,
  organizations,
  phoneChecks,
  users,
  webhookEndpoints,
} from './schema/index.js'

/**
 * Data-lifecycle helpers: the retention sweep and the self-service deletion
 * paths. Every function takes `now` so tests drive time explicitly; nothing
 * here reads the wall clock on its own.
 *
 * Boundary rules encoded here:
 * - credit_ledger is NEVER touched: it is append-only at the database level
 *   (trigger) and kept three years for accounting. An organisation hard
 *   delete therefore anonymizes the organizations row (the only place its
 *   name exists) and deletes the children, instead of deleting the row the
 *   ledger references.
 * - Deletions return counts so the sweep can audit exactly what it removed.
 */

/** How long a soft-deleted organisation waits before its data is purged. */
export const ORG_PURGE_GRACE_DAYS = 30

/** The name an organisation keeps after its purge - carries no identity. */
export const PURGED_ORG_NAME = 'deleted organization'

export type ExpiredCheckCounts = { emailChecks: number; phoneChecks: number }

/** Hard-deletes every check row past its expiry. */
export async function purgeExpiredChecks(
  db: DatabaseExecutor,
  now: Date,
): Promise<ExpiredCheckCounts> {
  const expiredEmail = await db
    .delete(emailChecks)
    .where(lte(emailChecks.expiresAt, now))
    .returning({ id: emailChecks.id })
  const expiredPhone = await db
    .delete(phoneChecks)
    .where(lte(phoneChecks.expiresAt, now))
    .returning({ id: phoneChecks.id })
  return { emailChecks: expiredEmail.length, phoneChecks: expiredPhone.length }
}

export type BatchPurgeTarget = {
  id: string
  orgId: string
  inputObjectKey: string
  resultObjectKey: string | null
}

/**
 * Batches past expiry, with their object keys. The caller deletes the S3
 * objects FIRST and the rows after - losing a row before its objects would
 * orphan customer files with nothing left pointing at them.
 */
export async function listExpiredBatches(
  db: DatabaseExecutor,
  now: Date,
  limit = 500,
): Promise<BatchPurgeTarget[]> {
  return db
    .select({
      id: batches.id,
      orgId: batches.orgId,
      inputObjectKey: batches.inputObjectKey,
      resultObjectKey: batches.resultObjectKey,
    })
    .from(batches)
    .where(lte(batches.expiresAt, now))
    .limit(limit)
}

/** Removes batch rows whose objects are already gone. */
export async function deleteBatchesByIds(db: DatabaseExecutor, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const deleted = await db
    .delete(batches)
    .where(inArray(batches.id, ids))
    .returning({ id: batches.id })
  return deleted.length
}

/** Organisations soft-deleted at least the grace period ago and not yet purged. */
export async function listOrganizationsDueForPurge(
  db: DatabaseExecutor,
  now: Date,
  graceDays = ORG_PURGE_GRACE_DAYS,
): Promise<Array<{ id: string }>> {
  const cutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000)
  return db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        isNotNull(organizations.deletedAt),
        lte(organizations.deletedAt, cutoff),
        isNull(organizations.purgedAt),
      ),
    )
}

export type OrgPurgeResult = {
  users: number
  apiKeys: number
  emailChecks: number
  phoneChecks: number
  batches: number
  webhookEndpoints: number
  invoiceRequests: number
}

/**
 * Hard-deletes everything an organisation owns except the accounting trail:
 * users, API keys, checks, batches, webhook endpoints (deliveries cascade).
 * The organizations row survives anonymized - name replaced, purged_at set -
 * because credit_ledger keeps a three-year RESTRICT reference to the org id
 * and nothing else.
 *
 * ORDERING CONTRACT: the caller must have already emptied the org's storage
 * prefix and verified it empty. purged_at is the terminal marker that stops
 * future sweeps from revisiting this org, so it must only ever be set after
 * the objects are confirmed gone - a storage failure must leave purged_at
 * NULL and the org still listed as due.
 *
 * Audit events are intentionally untouched: they carry actions and ids, not
 * content, and each row already has its own expiry. Deleting them here would
 * erase the record that the deletion happened.
 */
export async function hardDeleteOrganizationData(
  db: DatabaseClient,
  orgId: string,
  now: Date,
): Promise<OrgPurgeResult> {
  return db.transaction(async (tx) => {
    const deletedUsers = await tx
      .delete(users)
      .where(eq(users.orgId, orgId))
      .returning({ id: users.id })
    const deletedKeys = await tx
      .delete(apiKeys)
      .where(eq(apiKeys.orgId, orgId))
      .returning({ id: apiKeys.id })
    const deletedEmail = await tx
      .delete(emailChecks)
      .where(eq(emailChecks.orgId, orgId))
      .returning({ id: emailChecks.id })
    const deletedPhone = await tx
      .delete(phoneChecks)
      .where(eq(phoneChecks.orgId, orgId))
      .returning({ id: phoneChecks.id })
    const deletedBatches = await tx
      .delete(batches)
      .where(eq(batches.orgId, orgId))
      .returning({ id: batches.id })
    const deletedEndpoints = await tx
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.orgId, orgId))
      .returning({ id: webhookEndpoints.id })
    const deletedInvoiceRequests = await tx
      .delete(invoiceRequests)
      .where(eq(invoiceRequests.orgId, orgId))
      .returning({ id: invoiceRequests.id })

    await tx
      .update(organizations)
      .set({ name: PURGED_ORG_NAME, purgedAt: now })
      .where(eq(organizations.id, orgId))

    await recordAuditEvent(
      tx,
      {
        orgId,
        action: 'org.purged',
        targetType: 'organization',
        targetId: orgId,
        metadata: {
          users: deletedUsers.length,
          api_keys: deletedKeys.length,
          email_checks: deletedEmail.length,
          phone_checks: deletedPhone.length,
          batches: deletedBatches.length,
          webhook_endpoints: deletedEndpoints.length,
          invoice_requests: deletedInvoiceRequests.length,
        },
      },
      now,
    )

    return {
      users: deletedUsers.length,
      apiKeys: deletedKeys.length,
      emailChecks: deletedEmail.length,
      phoneChecks: deletedPhone.length,
      batches: deletedBatches.length,
      webhookEndpoints: deletedEndpoints.length,
      invoiceRequests: deletedInvoiceRequests.length,
    }
  })
}

/**
 * Hard-deletes leads that are past their stored expiry marker or were
 * soft-deleted by an erasure request. The published (draft) privacy policy
 * promises the 180-day expiry marker; sweeping on the marker honors it.
 */
export async function purgeExpiredLeads(db: DatabaseExecutor, now: Date): Promise<number> {
  const deleted = await db
    .delete(leads)
    .where(or(lte(leads.expiresAt, now), isNotNull(leads.deletedAt)))
    .returning({ id: leads.id })
  return deleted.length
}

export type ScopedDeleteResult = { deleted: boolean }

/**
 * Deletes one email check when it belongs to the org, the org is active, and
 * the row has not expired - exactly the rows GET can see, so a DELETE can
 * never confirm the existence of anything a GET would 404.
 */
export async function deleteEmailCheckForOrg(
  db: DatabaseClient,
  id: string,
  orgId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    if (org === undefined) return false
    const deleted = await tx
      .delete(emailChecks)
      .where(
        and(eq(emailChecks.id, id), eq(emailChecks.orgId, orgId), gt(emailChecks.expiresAt, now)),
      )
      .returning({ id: emailChecks.id })
    return deleted.length === 1
  })
}

/** The phone twin of deleteEmailCheckForOrg, with identical visibility rules. */
export async function deletePhoneCheckForOrg(
  db: DatabaseClient,
  id: string,
  orgId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    if (org === undefined) return false
    const deleted = await tx
      .delete(phoneChecks)
      .where(
        and(eq(phoneChecks.id, id), eq(phoneChecks.orgId, orgId), gt(phoneChecks.expiresAt, now)),
      )
      .returning({ id: phoneChecks.id })
    return deleted.length === 1
  })
}

export type CheckDataWipeResult = {
  emailChecks: number
  phoneChecks: number
  batches: number
  /** How many storage objects were deleted before the rows. */
  batchObjects: number
}

/**
 * The dashboard's "Delete all check data": every check row and batch row the
 * organisation owns, immediately. Ledger and audit rows are untouched by
 * design.
 *
 * Failure-safety and race-safety, in one transaction:
 * - The organisation row is locked FOR UPDATE first. Batch creation debits
 *   credits under the same lock, so no new batch (whose object is already
 *   uploaded) can slip between key enumeration and row deletion.
 * - `deleteObjects` runs INSIDE the transaction, before any row is deleted.
 *   If it throws, the transaction rolls back: rows stay, nothing is audited,
 *   and the caller can simply retry. Rows are only ever removed after their
 *   objects are confirmed gone, so a failure can never orphan an object.
 */
export async function wipeCheckDataForOrg(
  db: DatabaseClient,
  orgId: string,
  deleteObjects: (keys: string[]) => Promise<void>,
): Promise<CheckDataWipeResult | null> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .for('update')
    if (org === undefined) return null

    const batchRows = await tx
      .select({ inputObjectKey: batches.inputObjectKey, resultObjectKey: batches.resultObjectKey })
      .from(batches)
      .where(eq(batches.orgId, orgId))
    const objectKeys = batchRows.flatMap((row) =>
      row.resultObjectKey === null
        ? [row.inputObjectKey]
        : [row.inputObjectKey, row.resultObjectKey],
    )

    // Objects first: a throw here rolls the whole wipe back untouched.
    await deleteObjects(objectKeys)

    const deletedEmail = await tx
      .delete(emailChecks)
      .where(eq(emailChecks.orgId, orgId))
      .returning({ id: emailChecks.id })
    const deletedPhone = await tx
      .delete(phoneChecks)
      .where(eq(phoneChecks.orgId, orgId))
      .returning({ id: phoneChecks.id })
    const deletedBatches = await tx
      .delete(batches)
      .where(eq(batches.orgId, orgId))
      .returning({ id: batches.id })

    return {
      emailChecks: deletedEmail.length,
      phoneChecks: deletedPhone.length,
      batches: deletedBatches.length,
      batchObjects: objectKeys.length,
    }
  })
}

/** Accounting retention: ledger rows live exactly this long, then purge. */
export const LEDGER_RETENTION_YEARS = 3

/** The retention cutoff: rows created at or before this moment are purgeable. */
export function ledgerRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - LEDGER_RETENTION_YEARS)
  return cutoff
}

/**
 * Deletes credit-ledger entries older than the three-year accounting
 * retention. This is the ONLY sanctioned path through the append-only guard:
 * it sets the transaction-local `tozalist.allow_ledger_purge` flag (SET
 * LOCAL - it dies with the transaction), and even then the database trigger
 * re-checks each row's age itself, so this code cannot delete young rows no
 * matter what cutoff it computes. Ordinary application DELETE/UPDATE attempts
 * remain blocked exactly as before.
 */
export async function purgeExpiredLedgerEntries(db: DatabaseClient, now: Date): Promise<number> {
  const cutoff = ledgerRetentionCutoff(now)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL tozalist.allow_ledger_purge = 'on'`)
    const deleted = await tx
      .delete(creditLedger)
      .where(lte(creditLedger.createdAt, cutoff))
      .returning({ id: creditLedger.id })
    return deleted.length
  })
}

/**
 * Removes anonymized organization rows whose accounting retention has fully
 * completed: purged (children long gone) and no ledger row left. audit_events
 * references are ON DELETE SET NULL, so nothing orphans. Only after this does
 * the organisation id itself disappear.
 */
export async function deleteRetiredOrganizations(db: DatabaseExecutor): Promise<number> {
  const deleted = await db
    .delete(organizations)
    .where(
      and(
        isNotNull(organizations.purgedAt),
        notExists(
          db
            .select({ id: creditLedger.id })
            .from(creditLedger)
            .where(eq(creditLedger.orgId, organizations.id)),
        ),
      ),
    )
    .returning({ id: organizations.id })
  return deleted.length
}
