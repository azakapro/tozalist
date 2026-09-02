import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'

/**
 * Local-development convenience for the db scripts (migrate, seed,
 * test-prepare): loads the workspace-root `.env` into `process.env` if it
 * exists, walking up from the current directory to the folder containing
 * `pnpm-workspace.yaml`.
 *
 * Never overrides variables that are already set, so CI and production
 * (which pass configuration explicitly and ship no `.env`) are unaffected.
 *
 * This deliberately duplicates `loadWorkspaceEnv` from `@tozalist/shared`:
 * the db package is a dependency leaf that must run (for example in CI's
 * "create test database" step) before any workspace package has been built.
 */
export function loadWorkspaceEnv(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const envPath = join(dir, '.env')
      if (!existsSync(envPath)) return null
      loadDotenv({ path: envPath, override: false, quiet: true })
      return envPath
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
