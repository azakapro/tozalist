import { config as loadEnvFile } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { checkTestDatabaseConfig } from '../config.js'
import { MIGRATIONS_DIR } from '../paths.js'

/**
 * Resets the test database and applies migrations once, before any test file
 * runs.
 *
 * If DATABASE_URL_TEST is absent this does nothing at all and the integration
 * tests skip themselves - a machine without a database can still run the unit
 * tests. If it is present but unsafe (equal to DATABASE_URL, or not named
 * *_test) this throws instead of skipping: that configuration is a mistake
 * worth failing loudly for, not one to work around.
 */
export default async function setup(): Promise<void> {
  loadEnvFile({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true })

  const checked = checkTestDatabaseConfig(process.env)

  if (!checked.ok) {
    if (checked.code === 'missing') {
      console.warn(`[db] ${checked.message} Integration tests will be skipped.`)
      return
    }
    throw new Error(checked.message)
  }

  const sql = postgres(checked.url, { max: 1, onnotice: () => {} })
  try {
    // Every run starts from an empty schema, so the suite is repeatable and the
    // migration is genuinely applied fresh rather than found already in place.
    // Only ever reached after the guards above approved this database.
    await sql.unsafe('drop schema if exists public cascade')
    await sql.unsafe('drop schema if exists drizzle cascade')
    await sql.unsafe('create schema public')

    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR })
  } finally {
    await sql.end()
  }
}
