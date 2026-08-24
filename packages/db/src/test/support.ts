import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { checkTestDatabaseConfig } from '../config.js'
import type { DatabaseClient } from '../client.js'

/**
 * Helpers shared by the integration tests. Excluded from the published build -
 * see tsconfig.build.json.
 */

const checked = checkTestDatabaseConfig(process.env)

/** False when no test database is configured, so suites can skip themselves. */
export const hasTestDatabase = checked.ok

export function connectToTestDatabase(): { db: DatabaseClient; sql: postgres.Sql } {
  if (!checked.ok) throw new Error(checked.message)

  const sql = postgres(checked.url, { max: 2 })
  return { db: drizzle(sql), sql }
}

/** A fresh organisation per test, so tests cannot interfere with each other. */
export function uniqueOrgName(label: string): string {
  return `test-${label}-${Math.random().toString(36).slice(2, 10)}`
}
