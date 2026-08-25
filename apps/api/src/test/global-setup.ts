import { config as loadEnvFile } from 'dotenv'
import { applyMigrations, checkTestDatabaseConfig } from '@tozalist/db'

/** Same guard policy as packages/db and apps/worker. */
export default async function setup(): Promise<void> {
  loadEnvFile({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true })

  const checked = checkTestDatabaseConfig(process.env)
  if (!checked.ok) {
    if (checked.code === 'missing') {
      console.warn(`[api] ${checked.message} Integration tests will be skipped.`)
      return
    }
    throw new Error(checked.message)
  }
  await applyMigrations(checked.url)
}
