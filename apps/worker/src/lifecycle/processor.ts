import type { Logger } from 'pino'
import {
  deleteBatchesByIds,
  deleteRetiredOrganizations,
  hardDeleteOrganizationData,
  listExpiredBatches,
  listOrganizationsDueForPurge,
  purgeExpiredChecks,
  purgeExpiredLeads,
  purgeExpiredLedgerEntries,
  recordAuditEvent,
  type DatabaseClient,
} from '@tozalist/db'
import {
  exportKeyCreatedAtMs,
  orgObjectPrefix,
  STORAGE_DELETE_FAILED,
  type ObjectStorage,
} from '@tozalist/shared'

/** How long an export ZIP may outlive its 24-hour signed link. */
export const EXPORT_OBJECT_TTL_MS = 24 * 60 * 60 * 1000

export type LifecycleDeps = {
  db: DatabaseClient
  storage: ObjectStorage
  logger: Logger
  /** Injected clock; production passes () => new Date(). */
  now?: () => Date
  /** Expired-batch page size; the sweep drains pages until none remain. */
  batchPageSize?: number
}

export type LifecycleRunCounts = {
  email_checks: number
  phone_checks: number
  batches: number
  batch_objects: number
  orgs_purged: number
  org_objects: number
  leads: number
  export_objects: number
  ledger_entries: number
  orgs_removed: number
}

/**
 * One retention sweep.
 *
 * Failure-safety rules, uniform across every destructive path:
 * - Storage objects are ALWAYS deleted (and, for org purges, verified gone)
 *   BEFORE the database rows or markers that track them. A crash or storage
 *   failure at any point leaves rows that still point at deletable objects -
 *   never objects that nothing tracks. Every failure surfaces as a thrown
 *   error, the run records no false success, and the next hourly sweep
 *   simply retries from the database's view of what still exists.
 * - deleteObjects itself fails closed on partial S3 responses (shared layer),
 *   with a fixed message that carries no key, endpoint, or customer value.
 *
 * Every completed run writes one audit event with per-category counts and
 * logs one summary line - counts only.
 */
export async function runLifecycleSweep(deps: LifecycleDeps): Promise<LifecycleRunCounts> {
  const now = (deps.now ?? (() => new Date()))()
  const pageSize = deps.batchPageSize ?? 500

  // 1. Expired check rows (no objects involved).
  const checks = await purgeExpiredChecks(deps.db, now)

  // 2. Expired batches: drain page by page until none remain, objects first,
  //    rows after. Deleting each page's rows before fetching the next makes
  //    the loop terminate even when new batches expire mid-run.
  let batchRowsDeleted = 0
  let batchObjects = 0
  for (;;) {
    const expired = await listExpiredBatches(deps.db, now, pageSize)
    if (expired.length === 0) break
    const keys = expired.flatMap((batch) =>
      batch.resultObjectKey === null
        ? [batch.inputObjectKey]
        : [batch.inputObjectKey, batch.resultObjectKey],
    )
    await deps.storage.deleteObjects(keys)
    batchObjects += keys.length
    batchRowsDeleted += await deleteBatchesByIds(
      deps.db,
      expired.map((batch) => batch.id),
    )
  }

  // 3. Organisations past the soft-delete grace period. Storage strictly
  //    first: empty the prefix, RE-LIST to confirm it is empty, and only then
  //    run the database purge that sets the terminal purged_at marker. A
  //    storage failure throws before the marker exists, so the org stays
  //    listed as due and the next sweep retries the remaining prefix. No new
  //    objects can appear concurrently: the org has been soft-deleted for 30
  //    days, and batch creation, exports, and uploads all require an active
  //    organisation.
  const dueOrgs = await listOrganizationsDueForPurge(deps.db, now)
  let orgsPurged = 0
  let orgObjects = 0
  for (const org of dueOrgs) {
    const keys = await deps.storage.listKeys(orgObjectPrefix(org.id))
    if (keys.length > 0) await deps.storage.deleteObjects(keys)
    const remaining = await deps.storage.listKeys(orgObjectPrefix(org.id))
    if (remaining.length > 0) throw new Error(STORAGE_DELETE_FAILED)
    await hardDeleteOrganizationData(deps.db, org.id, now)
    orgsPurged += 1
    orgObjects += keys.length
  }

  // 4. Leads past their stored 180-day expiry marker, and erasure requests.
  const leadsRemoved = await purgeExpiredLeads(deps.db, now)

  // 5. Export ZIPs older than their signed link's lifetime. The creation time
  //    is embedded in the key, so no database record is needed.
  const allKeys = await deps.storage.listKeys('org/')
  const staleExports = allKeys.filter((key) => {
    const createdAtMs = exportKeyCreatedAtMs(key)
    return createdAtMs !== null && now.getTime() - createdAtMs > EXPORT_OBJECT_TTL_MS
  })
  if (staleExports.length > 0) await deps.storage.deleteObjects(staleExports)

  // 6. Accounting retention completion: ledger entries past three years go
  //    through the sanctioned trigger gate, then anonymized org rows with no
  //    ledger left are removed entirely.
  const ledgerEntries = await purgeExpiredLedgerEntries(deps.db, now)
  const orgsRemoved = await deleteRetiredOrganizations(deps.db)

  const counts: LifecycleRunCounts = {
    email_checks: checks.emailChecks,
    phone_checks: checks.phoneChecks,
    batches: batchRowsDeleted,
    batch_objects: batchObjects,
    orgs_purged: orgsPurged,
    org_objects: orgObjects,
    leads: leadsRemoved,
    export_objects: staleExports.length,
    ledger_entries: ledgerEntries,
    orgs_removed: orgsRemoved,
  }

  await recordAuditEvent(
    deps.db,
    {
      action: 'lifecycle.sweep',
      targetType: 'system',
      targetId: 'retention-sweep',
      metadata: { ...counts },
    },
    now,
  )
  deps.logger.info({ ...counts }, 'lifecycle sweep complete')
  return counts
}
