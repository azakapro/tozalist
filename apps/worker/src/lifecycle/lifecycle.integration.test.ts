import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apiKeys,
  auditEvents,
  batches,
  creditLedger,
  emailChecks,
  leads,
  listOrganizationsDueForPurge,
  organizations,
  phoneChecks,
  users,
  webhookEndpoints,
  PURGED_ORG_NAME,
  type DatabaseClient,
} from '@tozalist/db'
import { exportObjectKey, STORAGE_DELETE_FAILED, type ObjectStorage } from '@tozalist/shared'
import {
  captureLogger,
  connectIsolatedTestStorage,
  connectTestDb,
  hasIntegrationEnv,
  uniqueName,
} from '../test/support.js'
import { runLifecycleSweep, EXPORT_OBJECT_TTL_MS } from './processor.js'

/** Injected clock: the sweep never reads the wall clock in these tests. */
const NOW = new Date('2026-08-25T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const past = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const future = (days: number) => new Date(NOW.getTime() + days * DAY_MS)

describe.skipIf(!hasIntegrationEnv)('lifecycle sweep (integration)', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let storage: ObjectStorage

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    storage = await connectIsolatedTestStorage()
  })

  afterAll(async () => {
    storage.close()
    await sqlEnd()
  })

  async function makeOrg(tag: string): Promise<string> {
    const [org] = await db
      .insert(organizations)
      .values({ name: uniqueName(tag) })
      .returning({ id: organizations.id })
    if (org === undefined) throw new Error('failed to create test organisation')
    return org.id
  }

  function emailRow(orgId: string, expiresAt: Date) {
    return {
      orgId,
      emailNormalized: 'sweep@example.com',
      emailHash: `hash-${randomUUID()}`,
      verdict: 'valid' as const,
      expiresAt,
    }
  }

  async function put(key: string, content = 'x,y\n'): Promise<void> {
    await storage.uploadStream(key, Readable.from([content]))
  }

  it('sweeps expired data, removes the S3 objects, and audits the counts', async () => {
    // --- fixtures ---------------------------------------------------------
    const liveOrgId = await makeOrg('live')
    await db
      .insert(emailChecks)
      .values([emailRow(liveOrgId, past(1)), emailRow(liveOrgId, future(1))])
    await db.insert(phoneChecks).values({
      orgId: liveOrgId,
      e164: '+998901234567',
      inputHash: `hash-${randomUUID()}`,
      valid: true,
      expiresAt: past(1),
    })

    // An expired batch WITH real objects, and a live batch that must survive.
    const expiredBatchId = randomUUID()
    const expiredInput = `org/${liveOrgId}/batches/${expiredBatchId}/input.csv`
    const expiredResult = `org/${liveOrgId}/batches/${expiredBatchId}/result.csv`
    await put(expiredInput)
    await put(expiredResult)
    await db.insert(batches).values({
      id: expiredBatchId,
      orgId: liveOrgId,
      filename: 'old.csv',
      inputObjectKey: expiredInput,
      resultObjectKey: expiredResult,
      expiresAt: past(1),
    })
    const liveBatchId = randomUUID()
    const liveInput = `org/${liveOrgId}/batches/${liveBatchId}/input.csv`
    await put(liveInput)
    await db.insert(batches).values({
      id: liveBatchId,
      orgId: liveOrgId,
      filename: 'new.csv',
      inputObjectKey: liveInput,
      expiresAt: future(1),
    })

    // An organisation past the 30-day grace period, fully populated.
    const purgeOrgId = await makeOrg('purge')
    await db
      .update(organizations)
      .set({ deletedAt: past(31) })
      .where(eq(organizations.id, purgeOrgId))
    await db.insert(users).values({
      orgId: purgeOrgId,
      email: `admin-${randomUUID().slice(0, 8)}@purged.example`,
      passwordHash: 'x',
      role: 'admin',
    })
    await db.insert(apiKeys).values({
      orgId: purgeOrgId,
      name: 'k',
      keyHash: `hash-${randomUUID()}`,
      keyPrefix: 'tzl_live_abcd',
    })
    await db.insert(emailChecks).values(emailRow(purgeOrgId, future(30)))
    const purgeBatchId = randomUUID()
    const purgeInput = `org/${purgeOrgId}/batches/${purgeBatchId}/input.csv`
    await put(purgeInput)
    await db.insert(batches).values({
      id: purgeBatchId,
      orgId: purgeOrgId,
      filename: 'p.csv',
      inputObjectKey: purgeInput,
      expiresAt: future(30),
    })
    await db.insert(webhookEndpoints).values({
      orgId: purgeOrgId,
      url: 'https://example.com/hook',
      secret: 's'.repeat(32),
      events: ['batch.completed'],
    })
    await db.insert(creditLedger).values({ orgId: purgeOrgId, delta: 42, reason: 'grant' })
    // A stray export AND a billing statement under the purged org must go
    // too: the whole prefix is the retention path for org-scoped documents.
    const purgeExport = exportObjectKey(purgeOrgId, NOW.getTime(), randomUUID())
    await put(purgeExport, 'zip-bytes')
    await put(`org/${purgeOrgId}/statements/2026-07.html`, '<html>statement</html>')

    // Leads: one expired, one live.
    await db.insert(leads).values([
      { email: 'gone@ex.uz', source: 'landing_pilot', locale: 'uz', expiresAt: past(1) },
      { email: 'stay@ex.uz', source: 'landing_pilot', locale: 'uz', expiresAt: future(1) },
    ])

    // Exports for the LIVE org: one stale (past the 24h TTL), one fresh.
    const staleExport = exportObjectKey(
      liveOrgId,
      NOW.getTime() - EXPORT_OBJECT_TTL_MS - 60_000,
      randomUUID(),
    )
    const freshExport = exportObjectKey(liveOrgId, NOW.getTime() - 60_000, randomUUID())
    await put(staleExport, 'zip-bytes')
    await put(freshExport, 'zip-bytes')

    // --- run --------------------------------------------------------------
    const { lines, logger } = captureLogger()
    const counts = await runLifecycleSweep({ db, storage, logger, now: () => NOW })

    // --- database assertions ---------------------------------------------
    // Exactly the expired checks are gone.
    const liveEmails = await db
      .select({ expiresAt: emailChecks.expiresAt })
      .from(emailChecks)
      .where(eq(emailChecks.orgId, liveOrgId))
    expect(liveEmails).toHaveLength(1)
    expect(liveEmails[0]?.expiresAt.getTime()).toBeGreaterThan(NOW.getTime())
    expect(
      await db.select().from(phoneChecks).where(eq(phoneChecks.orgId, liveOrgId)),
    ).toHaveLength(0)

    // Batch rows: expired gone, live retained.
    const liveBatches = await db
      .select({ id: batches.id })
      .from(batches)
      .where(eq(batches.orgId, liveOrgId))
    expect(liveBatches.map((row) => row.id)).toEqual([liveBatchId])

    // Cascade: zero orphans anywhere for the purged org.
    for (const [table, column] of [
      [users, users.orgId],
      [apiKeys, apiKeys.orgId],
      [emailChecks, emailChecks.orgId],
      [phoneChecks, phoneChecks.orgId],
      [batches, batches.orgId],
      [webhookEndpoints, webhookEndpoints.orgId],
    ] as const) {
      expect(await db.select().from(table).where(eq(column, purgeOrgId))).toHaveLength(0)
    }
    const [purgedOrg] = await db
      .select({ name: organizations.name, purgedAt: organizations.purgedAt })
      .from(organizations)
      .where(eq(organizations.id, purgeOrgId))
    expect(purgedOrg?.name).toBe(PURGED_ORG_NAME)
    expect(purgedOrg?.purgedAt).not.toBeNull()
    // Accounting survives the purge.
    const ledger = await db
      .select({ delta: creditLedger.delta })
      .from(creditLedger)
      .where(eq(creditLedger.orgId, purgeOrgId))
    expect(ledger).toEqual([{ delta: 42 }])

    // Leads: expired removed, live kept.
    const remainingLeads = await db.select({ email: leads.email }).from(leads)
    const leadEmails = remainingLeads.map((row) => row.email)
    expect(leadEmails).toContain('stay@ex.uz')
    expect(leadEmails).not.toContain('gone@ex.uz')

    // --- storage assertions (against the real test MinIO) -----------------
    const liveOrgKeys = await storage.listKeys(`org/${liveOrgId}/`)
    expect(liveOrgKeys.sort()).toEqual([liveInput, freshExport].sort())
    // Zero orphans in the bucket for the purged org.
    expect(await storage.listKeys(`org/${purgeOrgId}/`)).toEqual([])

    // --- counts, audit, and log ------------------------------------------
    expect(counts.email_checks).toBeGreaterThanOrEqual(1)
    expect(counts.phone_checks).toBeGreaterThanOrEqual(1)
    expect(counts.batches).toBeGreaterThanOrEqual(1)
    expect(counts.batch_objects).toBeGreaterThanOrEqual(2)
    expect(counts.orgs_purged).toBeGreaterThanOrEqual(1)
    expect(counts.leads).toBeGreaterThanOrEqual(1)
    expect(counts.export_objects).toBeGreaterThanOrEqual(1)
    expect(counts.ledger_entries).toBeGreaterThanOrEqual(0)
    expect(counts.orgs_removed).toBeGreaterThanOrEqual(0)

    const sweepAudits = await db
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lifecycle.sweep'))
    expect(sweepAudits.length).toBeGreaterThanOrEqual(1)
    const lastAudit = sweepAudits[sweepAudits.length - 1]
    expect(lastAudit?.metadata).toMatchObject({
      email_checks: counts.email_checks,
      phone_checks: counts.phone_checks,
      batches: counts.batches,
      orgs_purged: counts.orgs_purged,
      leads: counts.leads,
    })

    const summary = lines.find((line) => line.msg === 'lifecycle sweep complete')
    expect(summary).toBeDefined()
    expect(summary?.email_checks).toBe(counts.email_checks)
    // The summary line carries counts only - never keys, addresses or names.
    const serialized = JSON.stringify(lines)
    expect(serialized).not.toContain('@ex.uz')
    expect(serialized).not.toContain('input.csv')
    expect(serialized).not.toContain(liveOrgId)
  })

  it('a second sweep is a no-op: nothing left to delete, still audited', async () => {
    const { logger } = captureLogger()
    const before = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lifecycle.sweep'))
    const counts = await runLifecycleSweep({ db, storage, logger, now: () => NOW })
    expect(counts).toMatchObject({
      email_checks: 0,
      phone_checks: 0,
      batches: 0,
      batch_objects: 0,
      orgs_purged: 0,
      export_objects: 0,
    })
    const after = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lifecycle.sweep'))
    expect(after.length).toBe(before.length + 1)
  })

  it('drains every expired batch, not just the first page', async () => {
    const orgId = await makeOrg('drain')
    const total = 5
    const ids: string[] = []
    for (let index = 0; index < total; index += 1) {
      const batchId = randomUUID()
      ids.push(batchId)
      const key = `org/${orgId}/batches/${batchId}/input.csv`
      await put(key)
      await db.insert(batches).values({
        id: batchId,
        orgId,
        filename: `drain-${index}.csv`,
        inputObjectKey: key,
        expiresAt: past(1),
      })
    }

    const { logger } = captureLogger()
    // Page size 2 forces three pages; the sweep must loop until dry.
    const counts = await runLifecycleSweep({
      db,
      storage,
      logger,
      now: () => NOW,
      batchPageSize: 2,
    })
    expect(counts.batches).toBeGreaterThanOrEqual(total)
    expect(await db.select().from(batches).where(eq(batches.orgId, orgId))).toHaveLength(0)
    expect(await storage.listKeys(`org/${orgId}/`)).toEqual([])
  })

  it('a storage failure aborts the org purge with no terminal marker, then a retry completes it', async () => {
    const orgId = await makeOrg('faulty')
    await db
      .update(organizations)
      .set({ deletedAt: past(31) })
      .where(eq(organizations.id, orgId))
    // A recent ledger row: accounting retention keeps the anonymized org row
    // alive after the purge instead of letting step 6 remove it immediately.
    await db.insert(creditLedger).values({ orgId, delta: 9, reason: 'grant' })
    const batchId = randomUUID()
    const key = `org/${orgId}/batches/${batchId}/input.csv`
    await put(key)
    await db.insert(batches).values({
      id: batchId,
      orgId,
      filename: 'f.csv',
      inputObjectKey: key,
      expiresAt: future(30),
    })

    // Fault injection: deletion of this org's keys fails exactly once, the
    // way a partial DeleteObjects response surfaces from the shared layer.
    let failures = 0
    const faulty: ObjectStorage = {
      ...storage,
      deleteObjects: (keys) => {
        if (keys.some((candidate) => candidate.includes(orgId))) {
          failures += 1
          return Promise.reject(new Error(STORAGE_DELETE_FAILED))
        }
        return storage.deleteObjects(keys)
      },
    }

    const { lines, logger } = captureLogger()
    const auditsBefore = (
      await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'lifecycle.sweep'))
    ).length
    await expect(
      runLifecycleSweep({ db, storage: faulty, logger, now: () => NOW }),
    ).rejects.toThrow(STORAGE_DELETE_FAILED)
    expect(failures).toBe(1)

    // No false success anywhere: no terminal purge marker, org still due,
    // rows and object untouched, no sweep audit event, no key in any log.
    const [org] = await db
      .select({ purgedAt: organizations.purgedAt })
      .from(organizations)
      .where(eq(organizations.id, orgId))
    expect(org?.purgedAt).toBeNull()
    const due = await listOrganizationsDueForPurge(db, NOW)
    expect(due.map((row) => row.id)).toContain(orgId)
    expect(await db.select().from(batches).where(eq(batches.orgId, orgId))).toHaveLength(1)
    expect(await storage.listKeys(`org/${orgId}/`)).toEqual([key])
    const auditsAfter = (
      await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'lifecycle.sweep'))
    ).length
    expect(auditsAfter).toBe(auditsBefore)
    expect(JSON.stringify(lines)).not.toContain(key)

    // Retry with healthy storage: cleanup completes and the marker lands.
    const retry = await runLifecycleSweep({ db, storage, logger, now: () => NOW })
    expect(retry.orgs_purged).toBeGreaterThanOrEqual(1)
    const [purged] = await db
      .select({ purgedAt: organizations.purgedAt, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
    expect(purged?.purgedAt).not.toBeNull()
    expect(purged?.name).toBe(PURGED_ORG_NAME)
    expect(await storage.listKeys(`org/${orgId}/`)).toEqual([])
    expect(await db.select().from(batches).where(eq(batches.orgId, orgId))).toHaveLength(0)
  })

  it('a failed expired-batch object deletion keeps the rows for the next sweep', async () => {
    const orgId = await makeOrg('batch-fault')
    const batchId = randomUUID()
    const key = `org/${orgId}/batches/${batchId}/input.csv`
    await put(key)
    await db.insert(batches).values({
      id: batchId,
      orgId,
      filename: 'bf.csv',
      inputObjectKey: key,
      expiresAt: past(1),
    })

    const faulty: ObjectStorage = {
      ...storage,
      deleteObjects: (keys) =>
        keys.includes(key)
          ? Promise.reject(new Error(STORAGE_DELETE_FAILED))
          : storage.deleteObjects(keys),
    }
    const { logger } = captureLogger()
    await expect(
      runLifecycleSweep({ db, storage: faulty, logger, now: () => NOW }),
    ).rejects.toThrow(STORAGE_DELETE_FAILED)
    // The row survives, still pointing at its object: retryable, not orphaned.
    expect(await db.select().from(batches).where(eq(batches.id, batchId))).toHaveLength(1)
    expect(await storage.listKeys(`org/${orgId}/`)).toEqual([key])

    const counts = await runLifecycleSweep({ db, storage, logger, now: () => NOW })
    expect(counts.batches).toBeGreaterThanOrEqual(1)
    expect(await db.select().from(batches).where(eq(batches.id, batchId))).toHaveLength(0)
    expect(await storage.listKeys(`org/${orgId}/`)).toEqual([])
  })
})
