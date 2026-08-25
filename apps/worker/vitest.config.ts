import { config as loadEnvFile } from 'dotenv'
import { defineConfig } from 'vitest/config'

loadEnvFile({ path: new URL('../../.env', import.meta.url).pathname, quiet: true })

const passthrough: Record<string, string> = {}
for (const key of ['DATABASE_URL', 'DATABASE_URL_TEST', 'REDIS_URL']) {
  const value = process.env[key]
  if (value !== undefined) passthrough[key] = value
}

export default defineConfig({
  test: {
    environment: 'node',
    // --expose-gc lets the memory test measure LIVE heap (after forced GC)
    // rather than allocation churn, which inflates RSS without retention.
    poolOptions: { forks: { execArgv: ['--expose-gc'] } },
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    // Integration tests share Redis and one database; keep files sequential.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: passthrough,
  },
})
