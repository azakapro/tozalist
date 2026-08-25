import type postgres from 'postgres'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseClient } from './client.js'
import {
  deleteBatchesByIds,
  deleteRetiredOrganizations,
  deleteEmailCheckForOrg,
  deletePhoneCheckForOrg,
  hardDeleteOrganizationData,
  listExpiredBatches,
  listOrganizationsDueForPurge,
  ledgerRetentionCutoff,
  PURGED_ORG_NAME,
  purgeExpiredChecks,
  purgeExpiredLeads,
  purgeExpiredLedgerEntries,
  wipeCheckDataForOrg,
} from './lifecycle.js'
import {
  apiKeys,
  auditEvents,
  batches,
  creditLedger,
  emailChecks,
  leads,
  organizations,
  phoneChecks,
  users,
  webhookDeliveries,
  webhookEndpoints,
} from './schema/index.js'
import { connectToTestDatabase, hasTestDatabase, uniqueOrgName } from './test/support.js'

/** Fixed injected clock: nothing in these tests reads the wall clock. */
const NOW = new Date('2026-08-25T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const past = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const future = (days: number) => new Date(NOW.getTime() + days * DAY_MS)

describe.skipIf(!hasTestDatabase)('data lifecycle', () => {
  let db: DatabaseClient
  let raw: postgres.Sql

  beforeAll(async () => {
    const connection = connectToTestDatabase()
    db = connection.db
    raw = connection.sql
  })

  afterAll(async () => {
    await raw.end()
  })

  async function makeOrg(tag: string): Promise<string> {
    const [org] = await db
      .insert(organizations)
      .values({ name: uniqueOrgName(tag) })
      .returning({ id: organizations.id })
    if (org === undefined) throw new Error('failed to create the test organisation')
    return org.id
  }

  function emailRow(orgId: string, expiresAt: Date) {
    return {
      orgId,
      emailNormalized: 'person@example.com',
      emailHash: 'a'.repeat(64),
      verdict: 'valid' as const,
      expiresAt,
    }
  }

  function phoneRow(orgId: string, expiresAt: Date) {
    return { orgId, e164: '+998901234567', inputHash: 'b'.repeat(64), valid: true, expiresAt }
  }

  it('purges exactly the expired checks and nothing else', async () => {
    const orgId = await makeOrg('sweep')
    const [expiredEmail] = await db
      .insert(emailChecks)
      .values(emailRow(orgId, past(1)))
      .returning({ id: emailChecks.id })
    const [liveEmail] = await db
      .insert(emailChecks)
      .values(emailRow(orgId, future(1)))
      .returning({ id: emailChecks.id })
    const [expiredPhone] = await db
      .insert(phoneChecks)
      .values(phoneRow(orgId, NOW)) // exactly at the boundary: expired
      .returning({ id: phoneChecks.id })
    const [livePhone] = await db
      .insert(phoneChecks)
      .values(phoneRow(orgId, future(30)))
      .returning({ id: phoneChecks.id })

    const counts = await purgeExpiredChecks(db, NOW)
    expect(counts.emailChecks).toBeGreaterThanOrEqual(1)
    expect(counts.phoneChecks).toBeGreaterThanOrEqual(1)

    const remainingEmails = await db
      .select({ id: emailChecks.id })
      .from(emailChecks)
      .where(eq(emailChecks.orgId, orgId))
    const remainingPhones = await db
      .select({ id: phoneChecks.id })
      .from(phoneChecks)
      .where(eq(phoneChecks.orgId, orgId))
    expect(remainingEmails.map((row) => row.id)).toEqual([liveEmail?.id])
    expect(remainingPhones.map((row) => row.id)).toEqual([livePhone?.id])
    expect(expiredEmail?.id).toBeDefined()
    expect(expiredPhone?.id).toBeDefined()
  })

  it('lists expired batches with keys, and deletes only those rows', async () => {
    const orgId = await makeOrg('batches')
    const [expired] = await db
      .insert(batches)
      .values({
        orgId,
        filename: 'old.csv',
        inputObjectKey: `org/${orgId}/batches/x/input.csv`,
        resultObjectKey: `org/${orgId}/batches/x/result.csv`,
        expiresAt: past(2),
      })
      .returning({ id: batches.id })
    const [live] = await db
      .insert(batches)
      .values({
        orgId,
        filename: 'new.csv',
        inputObjectKey: `org/${orgId}/batches/y/input.csv`,
        expiresAt: future(2),
      })
      .returning({ id: batches.id })

    const targets = await listExpiredBatches(db, NOW)
    const mine = targets.filter((target) => target.orgId === orgId)
    expect(mine.map((target) => target.id)).toEqual([expired?.id])
    expect(mine[0]?.inputObjectKey).toContain('input.csv')
    expect(mine[0]?.resultObjectKey).toContain('result.csv')

    const deleted = await deleteBatchesByIds(
      db,
      mine.map((target) => target.id),
    )
    expect(deleted).toBe(1)
    const remaining = await db
      .select({ id: batches.id })
      .from(batches)
      .where(eq(batches.orgId, orgId))
    expect(remaining.map((row) => row.id)).toEqual([live?.id])
  })

  it('org purge: cascade leaves zero orphans, ledger and org id survive anonymized', async () => {
    const orgId = await makeOrg('purge')
    await db
      .update(organizations)
      .set({ deletedAt: past(31) })
      .where(eq(organizations.id, orgId))
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: 'admin@purged.example',
        passwordHash: 'x',
        role: 'admin',
      })
      .returning({ id: users.id })
    await db
      .insert(apiKeys)
      .values({ orgId, name: 'k', keyHash: 'h'.repeat(64), keyPrefix: 'tzl_live_abcd' })
    await db.insert(emailChecks).values(emailRow(orgId, future(30)))
    await db.insert(phoneChecks).values(phoneRow(orgId, future(30)))
    const [batch] = await db
      .insert(batches)
      .values({
        orgId,
        filename: 'f.csv',
        inputObjectKey: `org/${orgId}/batches/b/input.csv`,
        resultObjectKey: `org/${orgId}/batches/b/result.csv`,
        expiresAt: future(30),
      })
      .returning({ id: batches.id })
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        orgId,
        url: 'https://example.com/hook',
        secret: 's'.repeat(32),
        events: ['batch.completed'],
      })
      .returning({ id: webhookEndpoints.id })
    if (endpoint === undefined || batch === undefined || user === undefined) {
      throw new Error('fixture insert failed')
    }
    await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      eventType: 'batch.completed',
      expiresAt: future(30),
    })
    await db.insert(creditLedger).values({ orgId, delta: 100, reason: 'grant' })

    const due = await listOrganizationsDueForPurge(db, NOW)
    expect(due.map((row) => row.id)).toContain(orgId)

    const result = await hardDeleteOrganizationData(db, orgId, NOW)
    expect(result).toMatchObject({
      users: 1,
      apiKeys: 1,
      emailChecks: 1,
      phoneChecks: 1,
      batches: 1,
      webhookEndpoints: 1,
    })
    // Zero orphans in every child table.
    for (const [table, column] of [
      [users, users.orgId],
      [apiKeys, apiKeys.orgId],
      [emailChecks, emailChecks.orgId],
      [phoneChecks, phoneChecks.orgId],
      [batches, batches.orgId],
      [webhookEndpoints, webhookEndpoints.orgId],
    ] as const) {
      const rows = await db.select().from(table).where(eq(column, orgId))
      expect(rows).toHaveLength(0)
    }
    const orphanDeliveries = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint.id))
    expect(orphanDeliveries).toHaveLength(0)

    // The accounting trail survives, pointing at an anonymized org row.
    const ledgerRows = await db
      .select({ delta: creditLedger.delta })
      .from(creditLedger)
      .where(eq(creditLedger.orgId, orgId))
    expect(ledgerRows).toEqual([{ delta: 100 }])
    const [orgRow] = await db
      .select({ name: organizations.name, purgedAt: organizations.purgedAt })
      .from(organizations)
      .where(eq(organizations.id, orgId))
    expect(orgRow?.name).toBe(PURGED_ORG_NAME)
    expect(orgRow?.purgedAt).not.toBeNull()

    // The purge is audited and idempotent: already-purged orgs are not re-listed.
    const audit = await db
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.orgId, orgId))
    expect(audit.some((event) => event.action === 'org.purged')).toBe(true)
    const dueAfter = await listOrganizationsDueForPurge(db, NOW)
    expect(dueAfter.map((row) => row.id)).not.toContain(orgId)
  })

  it('keeps organisations inside the 30-day grace period', async () => {
    const orgId = await makeOrg('grace')
    await db
      .update(organizations)
      .set({ deletedAt: past(29) })
      .where(eq(organizations.id, orgId))
    const due = await listOrganizationsDueForPurge(db, NOW)
    expect(due.map((row) => row.id)).not.toContain(orgId)
  })

  it('purges leads past their expiry marker or soft-deleted, keeping the rest', async () => {
    const [expired] = await db
      .insert(leads)
      .values({ email: 'a@ex.uz', source: 'landing_pilot', locale: 'uz', expiresAt: past(1) })
      .returning({ id: leads.id })
    const [erased] = await db
      .insert(leads)
      .values({
        email: 'b@ex.uz',
        source: 'landing_contact',
        locale: 'ru',
        expiresAt: future(10),
        deletedAt: past(1),
      })
      .returning({ id: leads.id })
    const [live] = await db
      .insert(leads)
      .values({ email: 'c@ex.uz', source: 'landing_pilot', locale: 'en', expiresAt: future(10) })
      .returning({ id: leads.id })

    const removed = await purgeExpiredLeads(db, NOW)
    expect(removed).toBeGreaterThanOrEqual(2)

    const remaining = await db.select({ id: leads.id }).from(leads)
    const ids = remaining.map((row) => row.id)
    expect(ids).toContain(live?.id)
    expect(ids).not.toContain(expired?.id)
    expect(ids).not.toContain(erased?.id)
  })

  it('scoped single-check deletion mirrors GET visibility exactly', async () => {
    const orgId = await makeOrg('single-delete')
    const otherOrgId = await makeOrg('single-delete-other')
    const [mine] = await db
      .insert(emailChecks)
      .values(emailRow(orgId, future(1)))
      .returning({ id: emailChecks.id })
    const [expired] = await db
      .insert(emailChecks)
      .values(emailRow(orgId, past(1)))
      .returning({ id: emailChecks.id })
    const [phone] = await db
      .insert(phoneChecks)
      .values(phoneRow(orgId, future(1)))
      .returning({ id: phoneChecks.id })
    if (mine === undefined || expired === undefined || phone === undefined) {
      throw new Error('fixture insert failed')
    }

    // Foreign org, expired row, unknown id: all refuse identically.
    expect(await deleteEmailCheckForOrg(db, mine.id, otherOrgId, NOW)).toBe(false)
    expect(await deleteEmailCheckForOrg(db, expired.id, orgId, NOW)).toBe(false)
    expect(await deletePhoneCheckForOrg(db, mine.id, orgId, NOW)).toBe(false)

    expect(await deleteEmailCheckForOrg(db, mine.id, orgId, NOW)).toBe(true)
    expect(await deletePhoneCheckForOrg(db, phone.id, orgId, NOW)).toBe(true)
    // Idempotence: a second delete is a miss, not an error.
    expect(await deleteEmailCheckForOrg(db, mine.id, orgId, NOW)).toBe(false)
  })

  it('wipeCheckDataForOrg deletes objects before rows and rolls back on failure', async () => {
    const orgId = await makeOrg('wipe')
    await db.insert(emailChecks).values([emailRow(orgId, future(1)), emailRow(orgId, past(1))])
    await db.insert(phoneChecks).values(phoneRow(orgId, future(1)))
    await db.insert(batches).values({
      orgId,
      filename: 'w.csv',
      inputObjectKey: `org/${orgId}/batches/w/input.csv`,
      expiresAt: future(1),
    })
    await db.insert(creditLedger).values({ orgId, delta: 5, reason: 'grant' })

    // Fault injection: storage refuses. The transaction must roll back whole -
    // rows survive, nothing half-deleted, and the failure is retryable.
    await expect(
      wipeCheckDataForOrg(db, orgId, () =>
        Promise.reject(new Error('object storage deletion incomplete')),
      ),
    ).rejects.toThrow('object storage deletion incomplete')
    expect(await db.select().from(emailChecks).where(eq(emailChecks.orgId, orgId))).toHaveLength(2)
    expect(await db.select().from(batches).where(eq(batches.orgId, orgId))).toHaveLength(1)

    // Retry with working storage: keys are enumerated and deleted BEFORE rows.
    const deletedKeys: string[][] = []
    const result = await wipeCheckDataForOrg(db, orgId, (keys) => {
      deletedKeys.push([...keys])
      return Promise.resolve()
    })
    expect(result).toMatchObject({ emailChecks: 2, phoneChecks: 1, batches: 1, batchObjects: 1 })
    expect(deletedKeys).toEqual([[`org/${orgId}/batches/w/input.csv`]])

    for (const [table, column] of [
      [emailChecks, emailChecks.orgId],
      [phoneChecks, phoneChecks.orgId],
      [batches, batches.orgId],
    ] as const) {
      expect(await db.select().from(table).where(eq(column, orgId))).toHaveLength(0)
    }
    // The ledger is untouched: deletion never rewrites accounting.
    const ledgerRows = await db
      .select({ delta: creditLedger.delta })
      .from(creditLedger)
      .where(eq(creditLedger.orgId, orgId))
    expect(ledgerRows).toEqual([{ delta: 5 }])

    // A soft-deleted org refuses the wipe (the sweep owns that path).
    await db.update(organizations).set({ deletedAt: NOW }).where(eq(organizations.id, orgId))
    expect(await wipeCheckDataForOrg(db, orgId, () => Promise.resolve())).toBeNull()
  })

  // Ledger fixtures must be old by BOTH clocks: the JS cutoff uses the
  // injected NOW, and the database trigger independently re-checks age
  // against its own now(). LEDGER_NOW sits safely in the past so the JS
  // filter is always the stricter of the two and governs the boundary.
  const LEDGER_NOW = new Date('2026-08-24T00:00:00.000Z')

  it('three-year ledger purge: exact boundary, sanctioned path only', async () => {
    const orgId = await makeOrg('ledger')
    const cutoff = ledgerRetentionCutoff(LEDGER_NOW)
    expect(cutoff.toISOString()).toBe('2023-08-24T00:00:00.000Z')

    await db.insert(creditLedger).values([
      // Exactly at the cutoff: purgeable.
      { orgId, delta: 10, reason: 'grant', createdAt: cutoff },
      // One second younger: retained.
      { orgId, delta: 20, reason: 'grant', createdAt: new Date(cutoff.getTime() + 1000) },
      // Recent: retained.
      { orgId, delta: 30, reason: 'grant', createdAt: LEDGER_NOW },
    ])

    // An ordinary application DELETE stays blocked even for the old row.
    await expect(db.delete(creditLedger).where(eq(creditLedger.orgId, orgId))).rejects.toThrow(
      /append-only/,
    )
    // And the flag alone cannot touch young rows: the trigger re-checks age.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL tozalist.allow_ledger_purge = 'on'`)
        await tx
          .delete(creditLedger)
          .where(and(eq(creditLedger.orgId, orgId), eq(creditLedger.delta, 30)))
      }),
    ).rejects.toThrow(/append-only/)

    const purged = await purgeExpiredLedgerEntries(db, LEDGER_NOW)
    expect(purged).toBeGreaterThanOrEqual(1)

    const remaining = await db
      .select({ delta: creditLedger.delta })
      .from(creditLedger)
      .where(eq(creditLedger.orgId, orgId))
    expect(remaining.map((row) => row.delta).sort()).toEqual([20, 30])
  })

  it('removes the anonymized org row only after all accounting retention completes', async () => {
    const orgId = await makeOrg('retired')
    await db
      .update(organizations)
      .set({ deletedAt: past(31), purgedAt: past(1), name: PURGED_ORG_NAME })
      .where(eq(organizations.id, orgId))
    const oldCreatedAt = new Date('2023-01-01T00:00:00.000Z')
    await db
      .insert(creditLedger)
      .values({ orgId, delta: 7, reason: 'grant', createdAt: oldCreatedAt })
    // An audit event referencing the org, to prove SET NULL instead of orphaning.
    await db.insert(auditEvents).values({
      orgId,
      action: 'org.purged',
      targetType: 'organization',
      targetId: orgId,
      expiresAt: future(30),
    })

    // Ledger row still present: the org row MUST survive.
    await deleteRetiredOrganizations(db)
    expect(
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, orgId)),
    ).toHaveLength(1)

    // Retention completes; now the org row goes, audit reference nulls out.
    await purgeExpiredLedgerEntries(db, NOW)
    const removed = await deleteRetiredOrganizations(db)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, orgId)),
    ).toHaveLength(0)
    const [audit] = await db
      .select({ orgId: auditEvents.orgId, targetId: auditEvents.targetId })
      .from(auditEvents)
      .where(eq(auditEvents.targetId, orgId))
    expect(audit?.orgId).toBeNull()
    expect(audit?.targetId).toBe(orgId)
  })

  it('never removes an active or merely soft-deleted organisation', async () => {
    const activeId = await makeOrg('active-keep')
    const softId = await makeOrg('soft-keep')
    await db
      .update(organizations)
      .set({ deletedAt: past(2) })
      .where(eq(organizations.id, softId))
    await deleteRetiredOrganizations(db)
    expect(
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, activeId)),
    ).toHaveLength(1)
    expect(
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, softId)),
    ).toHaveLength(1)
  })
})
