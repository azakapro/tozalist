import { createClient } from './client.js'
import { loadWorkspaceEnv } from './env.js'
import { getCreditBalance } from './credits.js'
import {
  DEMO_USER_EMAIL,
  INITIAL_CREDIT_GRANT,
  seedDemoData,
  type SeedResult,
} from './seed-data.js'

// Local development reads the workspace .env; CI and deployments pass env explicitly.
loadWorkspaceEnv()

/**
 * Seed entrypoint for local development.
 *
 * The plaintext API key is printed exactly once, only after the transaction has
 * committed. Nothing else sensitive is printed: not the key hash, not the
 * password hash, not the database URL.
 */
const { db, sql } = createClient({ maxConnections: 1 })

let result: SeedResult
try {
  result = await seedDemoData(db)
  const balance = await getCreditBalance(db, result.orgId)

  console.log('seed complete')
  console.log(`  organisation: ${result.orgId}`)
  console.log(`  admin user:   ${DEMO_USER_EMAIL}`)
  console.log(
    result.creditsGranted
      ? `  credits:      granted ${INITIAL_CREDIT_GRANT}, balance ${balance}`
      : `  credits:      already granted on an earlier run, balance ${balance}`,
  )
  console.log('')
  console.log('  API key (local development only, shown once, not recoverable):')
  console.log(`    ${result.apiKeyPlaintext}`)
} finally {
  await sql.end()
}
