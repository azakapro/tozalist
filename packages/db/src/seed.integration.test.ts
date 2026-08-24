import { eq, sql } from 'drizzle-orm'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseClient } from './client.js'
import { getCreditBalance } from './credits.js'
import { API_KEY_PREFIX_LENGTH, sha256Hex, verifyPassword } from './crypto.js'
import { apiKeys, creditLedger, users } from './schema/index.js'
import {
  DEMO_ORG_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  INITIAL_CREDIT_GRANT,
  INITIAL_GRANT_REFERENCE,
  seedDemoData,
  type SeedResult,
} from './seed-data.js'
import { connectToTestDatabase, hasTestDatabase } from './test/support.js'

describe.skipIf(!hasTestDatabase)('seed', () => {
  let db: DatabaseClient
  let raw: postgres.Sql
  let first: SeedResult
  let second: SeedResult

  beforeAll(async () => {
    const connection = connectToTestDatabase()
    db = connection.db
    raw = connection.sql

    first = await seedDemoData(db)
    second = await seedDemoData(db)
  })

  afterAll(async () => {
    await raw.end()
  })

  it('creates the demo organisation and admin user once', async () => {
    expect(first.orgId).toBe(DEMO_ORG_ID)
    expect(second.orgId).toBe(first.orgId)
    expect(second.userId).toBe(first.userId)

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEMO_USER_EMAIL))
    expect(rows).toHaveLength(1)
  })

  it('stores the demo password as an Argon2id hash, never in plaintext', async () => {
    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, DEMO_USER_EMAIL))

    expect(user?.passwordHash).toMatch(/^\$argon2id\$/)
    expect(user?.passwordHash).not.toContain(DEMO_USER_PASSWORD)
    expect(await verifyPassword(user?.passwordHash ?? '', DEMO_USER_PASSWORD)).toBe(true)
  })

  it('grants the initial credits exactly once, however often the seed runs', async () => {
    expect(first.creditsGranted).toBe(true)
    expect(second.creditsGranted).toBe(false)

    const grants = await db
      .select({ id: creditLedger.id, delta: creditLedger.delta })
      .from(creditLedger)
      .where(eq(creditLedger.referenceId, INITIAL_GRANT_REFERENCE))

    expect(grants).toHaveLength(1)
    expect(grants[0]?.delta).toBe(INITIAL_CREDIT_GRANT)
    expect(await getCreditBalance(db, DEMO_ORG_ID)).toBe(INITIAL_CREDIT_GRANT)
  })

  it('mints a fresh key each run and stores only its hash and prefix', async () => {
    expect(second.apiKeyPlaintext).not.toBe(first.apiKeyPlaintext)

    for (const result of [first, second]) {
      expect(result.apiKeyPrefix).toHaveLength(API_KEY_PREFIX_LENGTH)
      expect(result.apiKeyPlaintext.startsWith(result.apiKeyPrefix)).toBe(true)

      const [stored] = await db
        .select({ keyHash: apiKeys.keyHash, keyPrefix: apiKeys.keyPrefix })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, sha256Hex(result.apiKeyPlaintext)))

      expect(stored?.keyHash).toBe(sha256Hex(result.apiKeyPlaintext))
      expect(stored?.keyPrefix).toBe(result.apiKeyPrefix)
    }
  })

  it('never writes the plaintext key into any column of the database', async () => {
    // Scan every text-ish column of every table for the secret, not just the
    // columns we expect to be safe.
    const columns = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')`,
    )

    for (const { table_name, column_name } of columns) {
      const [hit] = await raw<{ count: number }[]>`
        select count(*)::int as count
        from ${raw(table_name)}
        where ${raw(column_name)}::text like ${'%' + first.apiKeyPlaintext + '%'}
      `
      expect(hit?.count, `${table_name}.${column_name} contains the plaintext API key`).toBe(0)
    }
  })

  it('does not leave the key recoverable from its stored form', async () => {
    const [stored] = await db
      .select({ keyHash: apiKeys.keyHash, keyPrefix: apiKeys.keyPrefix })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, sha256Hex(first.apiKeyPlaintext)))

    expect(stored?.keyHash).toHaveLength(64)
    expect(stored?.keyHash).toMatch(/^[0-9a-f]{64}$/)
    // The prefix is for display: it must not be enough to reconstruct the key.
    expect((stored?.keyPrefix ?? '').length).toBeLessThan(first.apiKeyPlaintext.length)
  })
})
