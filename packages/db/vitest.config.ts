import { config as loadEnvFile } from 'dotenv'
import { defineConfig } from 'vitest/config'

// The repository root .env is the single source of local configuration; load it
// here so `pnpm -r test` works without a wrapper script. Values already present
// in the environment win.
loadEnvFile({ path: new URL('../../.env', import.meta.url).pathname, quiet: true })

const passthrough: Record<string, string> = {}
for (const key of ['DATABASE_URL', 'DATABASE_URL_TEST']) {
  const value = process.env[key]
  if (value !== undefined) passthrough[key] = value
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    // Integration tests share one database; keep files sequential so a failure
    // is reproducible rather than order-dependent.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: passthrough,
  },
})
