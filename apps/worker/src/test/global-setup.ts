import { config as loadEnvFile } from 'dotenv'
import { applyMigrations, checkTestDatabaseConfig } from '@tozalist/db'

/**
 * Migrates the dedicated test database before the worker integration tests.
 * Same guard policy as packages/db: a missing DATABASE_URL_TEST skips the
 * integration suites; an unsafe one fails loudly.
 */
export default async function setup(): Promise<void> {
  loadEnvFile({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true })

  const checked = checkTestDatabaseConfig(process.env)
  if (!checked.ok) {
    if (checked.code === 'missing') {
      console.warn(`[worker] ${checked.message} Integration tests will be skipped.`)
      return
    }
    throw new Error(checked.message)
  }

  await applyMigrations(checked.url)
}
