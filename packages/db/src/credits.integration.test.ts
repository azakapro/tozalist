import { eq, sql } from 'drizzle-orm'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseClient } from './client.js'
import { getCreditBalance } from './credits.js'
import { creditLedger, organizations } from './schema/index.js'
import { connectToTestDatabase, hasTestDatabase, uniqueOrgName } from './test/support.js'

describe.skipIf(!hasTestDatabase)('credit ledger', () => {
  let db: DatabaseClient
  let raw: postgres.Sql
  let orgId: string

  beforeAll(async () => {
    const connection = connectToTestDatabase()
    db = connection.db
    raw = connection.sql

    const [org] = await db
      .insert(organizations)
      .values({ name: uniqueOrgName('credits') })
      .returning({ id: organizations.id })
    if (org === undefined) throw new Error('failed to create the test organisation')
    orgId = org.id
  })

  afterAll(async () => {
    await raw.end()
  })

  it('derives a balance from mixed grants, spends and refunds', async () => {
    await db.insert(creditLedger).values([
      { orgId, delta: 10_000, reason: 'grant' },
      { orgId, delta: -1, reason: 'single_check' },
      { orgId, delta: -250, reason: 'batch_check' },
      { orgId, delta: 25, reason: 'refund' },
      { orgId, delta: -4, reason: 'adjustment' },
    ])

    // 10000 - 1 - 250 + 25 - 4
    expect(await getCreditBalance(db, orgId)).toBe(9770)
  })

  it('reports a zero balance for an organisation with no entries', async () => {
    const [empty] = await db
      .insert(organizations)
      .values({ name: uniqueOrgName('empty') })
      .returning({ id: organizations.id })
    if (empty === undefined) throw new Error('failed to create the test organisation')

    expect(await getCreditBalance(db, empty.id)).toBe(0)
  })

  it('counts only the requested organisation', async () => {
    const [other] = await db
      .insert(organizations)
      .values({ name: uniqueOrgName('other') })
      .returning({ id: organizations.id })
    if (other === undefined) throw new Error('failed to create the test organisation')

    await db.insert(creditLedger).values({ orgId: other.id, delta: 500, reason: 'grant' })

    expect(await getCreditBalance(db, other.id)).toBe(500)
    expect(await getCreditBalance(db, orgId)).toBe(9770)
  })

  it('rejects updates', async () => {
    await expect(
      db.update(creditLedger).set({ delta: 999_999 }).where(eq(creditLedger.orgId, orgId)),
    ).rejects.toThrow(/append-only/i)

    expect(await getCreditBalance(db, orgId)).toBe(9770)
  })

  it('rejects deletes', async () => {
    await expect(db.delete(creditLedger).where(eq(creditLedger.orgId, orgId))).rejects.toThrow(
      /append-only/i,
    )

    expect(await getCreditBalance(db, orgId)).toBe(9770)
  })

  it('rejects truncate, which row triggers would miss', async () => {
    await expect(raw.unsafe('truncate table credit_ledger')).rejects.toThrow(/append-only/i)
  })

  it('rejects a second entry reusing the same reference', async () => {
    const reference = `test-reference-${Math.random().toString(36).slice(2, 10)}`

    await db.insert(creditLedger).values({
      orgId,
      delta: 100,
      reason: 'grant',
      referenceId: reference,
    })

    await expect(
      db.insert(creditLedger).values({
        orgId,
        delta: 100,
        reason: 'grant',
        referenceId: reference,
      }),
    ).rejects.toThrow(/credit_ledger_org_id_reference_id_uniq/)

    expect(await getCreditBalance(db, orgId)).toBe(9870)
  })

  it('still allows many entries without a reference', async () => {
    const before = await getCreditBalance(db, orgId)

    await db.insert(creditLedger).values([
      { orgId, delta: -1, reason: 'single_check' },
      { orgId, delta: -1, reason: 'single_check' },
    ])

    expect(await getCreditBalance(db, orgId)).toBe(before - 2)
  })

  it('keeps SUM(delta) as the only source of truth', async () => {
    const [row] = await raw<{ sum: number }[]>`
      select coalesce(sum(delta), 0)::int as sum from credit_ledger where org_id = ${orgId}
    `
    expect(await getCreditBalance(db, orgId)).toBe(row?.sum)
  })

  it('does not allow an organisation with ledger history to be hard deleted', async () => {
    await expect(db.delete(organizations).where(eq(organizations.id, orgId))).rejects.toThrow()

    const [survivor] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
    expect(survivor?.id).toBe(orgId)
  })

  it('has no balance column to drift out of sync', async () => {
    const rows = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'credit_ledger'`,
    )
    expect(rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'id',
        'org_id',
        'delta',
        'reason',
        'reference_id',
        'note',
        'created_at',
      ]),
    )
    expect(rows.map((row) => row.column_name)).not.toContain('balance')
  })
})
