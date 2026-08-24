import { sql } from 'drizzle-orm'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseClient } from './client.js'
import { connectToTestDatabase, hasTestDatabase } from './test/support.js'

/**
 * Proves the generated migration produces the schema we expect, on a database
 * that was created empty by `pnpm db:test:prepare`.
 */
describe.skipIf(!hasTestDatabase)('migrated schema', () => {
  let db: DatabaseClient
  let raw: postgres.Sql

  beforeAll(() => {
    const connection = connectToTestDatabase()
    db = connection.db
    raw = connection.sql
  })

  afterAll(async () => {
    await raw.end()
  })

  it('creates every table in the data model', async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )
    const tables = rows.map((row) => row.table_name)

    expect(tables).toEqual(
      expect.arrayContaining([
        'organizations',
        'users',
        'api_keys',
        'credit_ledger',
        'email_checks',
        'phone_checks',
        'batches',
        'webhook_endpoints',
        'webhook_deliveries',
        'audit_events',
        'leads',
      ]),
    )
  })

  it('records the migrations it applied', async () => {
    const rows = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    )
    expect(rows[0]?.count).toBeGreaterThanOrEqual(2)
  })

  it('creates the database enums with the expected values', async () => {
    const rows = await db.execute<{ typname: string; labels: string[] }>(
      sql`select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          group by t.typname`,
    )
    const enums = new Map(rows.map((row) => [row.typname, row.labels]))

    expect(enums.get('user_role')).toEqual(['admin', 'member'])
    expect(enums.get('credit_reason')).toEqual([
      'grant',
      'single_check',
      'batch_check',
      'refund',
      'adjustment',
    ])
    expect(enums.get('email_verdict')).toEqual(['valid', 'invalid', 'risky', 'unknown'])
    expect(enums.get('batch_status')).toEqual([
      'pending',
      'validating',
      'processing',
      'done',
      'failed',
    ])
    expect(enums.get('webhook_delivery_status')).toEqual(['pending', 'delivered', 'failed'])
    expect(enums.get('lead_source')).toEqual([
      'landing_pilot',
      'landing_contact',
      'landing_checklist',
    ])
  })

  it('creates the indexes the query paths depend on', async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    )
    const indexes = rows.map((row) => row.indexname)

    expect(indexes).toEqual(
      expect.arrayContaining([
        'email_checks_org_id_email_hash_created_at_idx',
        'phone_checks_org_id_input_hash_idx',
        'credit_ledger_org_id_created_at_idx',
        'audit_events_org_id_created_at_idx',
        'batches_org_id_created_at_idx',
      ]),
    )
  })

  it('gives every customer-data table an expiry or deletion column', async () => {
    const rows = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public' and column_name in ('expires_at', 'deleted_at', 'revoked_at')`,
    )

    const byTable = new Map<string, string[]>()
    for (const row of rows) {
      byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name])
    }

    // credit_ledger is deliberately absent: it is a financial record, not
    // personal data, and it is append-only.
    for (const table of [
      'organizations',
      'users',
      'api_keys',
      'email_checks',
      'phone_checks',
      'batches',
      'webhook_endpoints',
      'webhook_deliveries',
      'audit_events',
      'leads',
    ]) {
      expect(byTable.get(table) ?? [], `${table} has no retention column`).not.toHaveLength(0)
    }
  })

  it('stores no mutable credit balance anywhere', async () => {
    const rows = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public' and column_name like '%balance%'`,
    )
    expect(rows).toHaveLength(0)
  })
})
