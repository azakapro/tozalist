import { existsSync, readdirSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { MIGRATIONS_DIR } from './paths.js'

/**
 * Lists the generated SQL migration files, sorted the way Drizzle applies them.
 *
 * Scope note (step 0.1): drizzle-kit has not generated anything yet, so this is
 * empty. It stops being empty in the next step.
 */
export function listMigrationFiles(directory: string): string[] {
  if (!existsSync(directory)) return []

  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
}

/**
 * True when there is at least one migration to apply.
 *
 * Deliberately narrow: it only reports "nothing to do" when the directory holds
 * no SQL at all. If SQL exists but the drizzle journal is missing or broken,
 * this still returns true so the migrator fails loudly instead of skipping
 * migrations in silence.
 */
export function hasMigrations(directory: string): boolean {
  return listMigrationFiles(directory).length > 0
}

/**
 * Applies every committed migration to the database at `url`. Used by other
 * packages' test setups so they never need their own drizzle dependency.
 */
export async function applyMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR })
  } finally {
    await sql.end()
  }
}
