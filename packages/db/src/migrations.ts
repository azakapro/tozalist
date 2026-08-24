import { existsSync, readdirSync } from 'node:fs'

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
