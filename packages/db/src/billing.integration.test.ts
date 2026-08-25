import type postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseClient } from './client.js'
import {
  createInvoiceRequest,
  getBillingSummary,
  getMonthlyStatement,
  grantCreditsWithAudit,
  grantReference,
  parseStatementMonth,
} from './billing.js'
import { auditEvents, creditLedger, invoiceRequests, organizations, users } from './schema/index.js'
import { connectToTestDatabase, hasTestDatabase, uniqueOrgName } from './test/support.js'

const NOW = new Date('2026-08-20T10:00:00.000Z')

describe.skipIf(!hasTestDatabase)('pilot billing', () => {
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

  it('a grant creates exactly one ledger row and one audit event, atomically', async () => {
    const orgId = await makeOrg('grant')
    const result = await grantCreditsWithAudit(
      db,
      { orgId, credits: 10_000, note: 'Invoice INV-001 paid 2026-09-01' },
      NOW,
    )
    if (!result.ok) throw new Error('grant failed')

    const rows = await db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      delta: 10_000,
      reason: 'grant',
      referenceId: result.referenceId,
      note: 'Invoice INV-001 paid 2026-09-01',
    })
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, result.ledgerId))
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      action: 'billing.grant',
      orgId,
      metadata: { credits: 10_000, reference_id: result.referenceId },
    })
  })

  it('replaying the identical grant cannot double-grant its reference', async () => {
    const orgId = await makeOrg('replay')
    const input = { orgId, credits: 5000, note: 'Invoice INV-002 paid 2026-09-02' }
    const first = await grantCreditsWithAudit(db, input, NOW)
    expect(first.ok).toBe(true)

    const replay = await grantCreditsWithAudit(db, input, NOW)
    expect(replay).toEqual({ ok: false, reason: 'duplicate_reference' })

    const rows = await db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId))
    expect(rows).toHaveLength(1)

    // A genuinely different grant (new invoice) has a new reference and lands.
    const second = await grantCreditsWithAudit(
      db,
      { orgId, credits: 5000, note: 'Invoice INV-003 paid 2026-10-02' },
      NOW,
    )
    expect(second.ok).toBe(true)
    expect(grantReference(5000, 'Invoice INV-002 paid 2026-09-02')).not.toBe(
      grantReference(5000, 'Invoice INV-003 paid 2026-10-02'),
    )
  })

  it('the helper itself rejects invalid grants: zero rows, zero audits', async () => {
    const orgId = await makeOrg('invalid-input')
    const invalidInputs: Array<{ credits: number; note: string }> = [
      { credits: -100, note: 'Invoice INV-N paid' },
      { credits: 0, note: 'Invoice INV-Z paid' },
      { credits: 2.5, note: 'Invoice INV-F paid' },
      { credits: Number.NaN, note: 'Invoice INV-NAN paid' },
      { credits: Number.POSITIVE_INFINITY, note: 'Invoice INV-INF paid' },
      { credits: Number.MAX_SAFE_INTEGER + 2, note: 'Invoice INV-BIG paid' },
      { credits: 100, note: '' },
      { credits: 100, note: '   \t  ' },
    ]
    for (const input of invalidInputs) {
      const result = await grantCreditsWithAudit(db, { orgId, ...input }, NOW)
      expect(result, JSON.stringify({ credits: input.credits })).toEqual({
        ok: false,
        reason: 'invalid_input',
      })
    }
    // The authoritative boundary wrote nothing, anywhere.
    expect(await db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId))).toHaveLength(
      0,
    )
    expect(await db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId))).toHaveLength(0)
  })

  it('canonicalizes note whitespace: variants share one replay-protected reference', async () => {
    const orgId = await makeOrg('canonical')
    const first = await grantCreditsWithAudit(
      db,
      { orgId, credits: 300, note: '  Invoice INV-9 paid 2026-08-25  ' },
      NOW,
    )
    if (!first.ok) throw new Error('grant failed')

    // A whitespace-only variation of the same invoice cannot grant again.
    const replay = await grantCreditsWithAudit(
      db,
      { orgId, credits: 300, note: 'Invoice INV-9 paid 2026-08-25' },
      NOW,
    )
    expect(replay).toEqual({ ok: false, reason: 'duplicate_reference' })

    const rows = await db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId))
    expect(rows).toHaveLength(1)
    // The stored note is the canonical trimmed form, matching the reference.
    expect(rows[0]?.note).toBe('Invoice INV-9 paid 2026-08-25')
    expect(rows[0]?.referenceId).toBe(grantReference(300, 'Invoice INV-9 paid 2026-08-25'))
  })

  it('refuses unknown and deleted organisations', async () => {
    expect(
      await grantCreditsWithAudit(
        db,
        { orgId: '00000000-0000-0000-0000-000000000000', credits: 1, note: 'x' },
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'org_not_found' })
    const orgId = await makeOrg('deleted')
    await db.update(organizations).set({ deletedAt: NOW }).where(eq(organizations.id, orgId))
    expect(await grantCreditsWithAudit(db, { orgId, credits: 1, note: 'x' }, NOW)).toEqual({
      ok: false,
      reason: 'org_deleted',
    })
  })

  it('summary: balance, last grant, and month-to-date movement', async () => {
    const orgId = await makeOrg('summary')
    const july = new Date('2026-07-15T00:00:00.000Z')
    const august = new Date('2026-08-05T00:00:00.000Z')
    await db.insert(creditLedger).values([
      { orgId, delta: 10_000, reason: 'grant', createdAt: july, referenceId: `s1-${orgId}` },
      { orgId, delta: -700, reason: 'single_check', createdAt: july },
      { orgId, delta: 2_000, reason: 'grant', createdAt: august, referenceId: `s2-${orgId}` },
      { orgId, delta: -300, reason: 'single_check', createdAt: august },
      { orgId, delta: -1_000, reason: 'batch_check', createdAt: august },
      { orgId, delta: 50, reason: 'refund', createdAt: august },
    ])

    const summary = await getBillingSummary(db, orgId, NOW)
    expect(summary.balance).toBe(10_000 - 700 + 2_000 - 300 - 1_000 + 50)
    expect(summary.lastGrant).toBe(2_000)
    expect(summary.monthToDate).toEqual({
      creditsGranted: 2_000,
      creditsConsumed: 1_300,
      batchesRun: 1,
    })
  })

  it('statement: exact month boundaries, opening/closing balance, category totals', async () => {
    const orgId = await makeOrg('statement')
    const boundary = parseStatementMonth('2026-08')
    if (boundary === null) throw new Error('month parse failed')
    await db.insert(creditLedger).values([
      // Before the month: opening balance only.
      {
        orgId,
        delta: 9_000,
        reason: 'grant',
        createdAt: new Date('2026-07-31T23:59:59.999Z'),
        referenceId: `t0-${orgId}`,
      },
      // Exactly at month start: inside the month.
      { orgId, delta: -100, reason: 'single_check', createdAt: boundary.start },
      {
        orgId,
        delta: -2_000,
        reason: 'batch_check',
        createdAt: new Date('2026-08-10T12:00:00.000Z'),
      },
      { orgId, delta: 200, reason: 'refund', createdAt: new Date('2026-08-10T13:00:00.000Z') },
      { orgId, delta: -5, reason: 'adjustment', createdAt: new Date('2026-08-20T00:00:00.000Z') },
      {
        orgId,
        delta: 1_000,
        reason: 'grant',
        createdAt: new Date('2026-08-31T23:59:59.999Z'),
        referenceId: `t1-${orgId}`,
      },
      // Exactly at next month start: excluded.
      { orgId, delta: -999, reason: 'single_check', createdAt: boundary.end },
    ])

    const statement = await getMonthlyStatement(db, orgId, '2026-08')
    if (statement === null) throw new Error('statement missing')
    expect(statement.openingBalance).toBe(9_000)
    expect(statement.creditsGranted).toBe(1_000)
    expect(statement.creditsConsumed).toBe(2_100)
    expect(statement.creditsRefunded).toBe(200)
    expect(statement.adjustments).toBe(-5)
    expect(statement.closingBalance).toBe(9_000 - 100 - 2_000 + 200 - 5 + 1_000)
    expect(statement.checksCharged).toBe(2_100)
    expect(statement.batchesRun).toBe(1)
    expect(statement.entries).toHaveLength(5)
    // The next-month row is untouched and appears in September instead.
    const september = await getMonthlyStatement(db, orgId, '2026-09')
    expect(september?.openingBalance).toBe(statement.closingBalance)
    expect(september?.creditsConsumed).toBe(999)
  })

  it('rejects malformed and impossible months', () => {
    expect(parseStatementMonth('2026-13')).toBeNull()
    expect(parseStatementMonth('2026-00')).toBeNull()
    expect(parseStatementMonth('202608')).toBeNull()
    expect(parseStatementMonth('2026-8')).toBeNull()
    expect(parseStatementMonth('3026-01')).toBeNull()
    expect(parseStatementMonth('2026-02')?.end.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('invoice request: recorded, audited, scoped to an active organisation', async () => {
    const orgId = await makeOrg('invoice')
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `${uniqueOrgName('u')}@example.com`,
        passwordHash: 'x',
        role: 'admin',
      })
      .returning({ id: users.id })
    if (user === undefined) throw new Error('user fixture failed')

    const request = await createInvoiceRequest(
      db,
      { orgId, planCode: 'TEAM', requestedByUserId: user.id },
      NOW,
    )
    expect(request).not.toBeNull()
    const rows = await db.select().from(invoiceRequests).where(eq(invoiceRequests.orgId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ planCode: 'TEAM', requestedByUserId: user.id })
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'billing.invoice_requested'))
    expect(audits.some((event) => event.orgId === orgId)).toBe(true)

    await db.update(organizations).set({ deletedAt: NOW }).where(eq(organizations.id, orgId))
    expect(
      await createInvoiceRequest(db, { orgId, planCode: 'PILOT', requestedByUserId: user.id }, NOW),
    ).toBeNull()
  })
})
