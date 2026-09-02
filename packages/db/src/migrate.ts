import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { loadWorkspaceEnv } from './env.js'
import { createClient } from './client.js'
import { hasMigrations } from './migrations.js'
import { MIGRATIONS_DIR } from './paths.js'

// Local development reads the workspace .env; CI and deployments pass env explicitly.
loadWorkspaceEnv()

/**
 * Applies every pending SQL migration in ./drizzle.
 *
 * Scope note (step 0.1): no migrations have been generated yet, so this exits
 * as an explicit no-op without opening a database connection. That keeps
 * `pnpm db:migrate` runnable in CI and on a fresh checkout.
 */
if (!hasMigrations(MIGRATIONS_DIR)) {
  console.log('no migrations to apply')
} else {
  const { db, sql } = createClient({ maxConnections: 1 })

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    console.log('migrations applied')
  } finally {
    await sql.end()
  }
}
