import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'

/**
 * Startup environment validation (roadmap 8.1): checks every required
 * variable up front and fails fast with ONE error naming ALL missing
 * variables - never their values - so a misconfigured deployment reports the
 * complete gap instead of dying one variable at a time.
 */
export function assertRequiredEnv(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const missing = names.filter((name) => {
    const value = env[name]
    return value === undefined || value.trim() === ''
  })
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(', ')}`)
  }
}

/**
 * Local-development convenience: loads the workspace-root `.env` (the file
 * the README tells you to create with `cp .env.example .env`) into
 * `process.env` if it exists. Walks up from the current directory to the
 * folder containing `pnpm-workspace.yaml`, so it works whether a process is
 * started from the repository root or from inside one package.
 *
 * Never overrides variables that are already set, so CI and production
 * environments (which pass configuration explicitly and ship no `.env`) are
 * unaffected. Returns the path it loaded, or null when nothing was loaded.
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
