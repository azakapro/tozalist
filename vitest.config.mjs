import { defineConfig } from 'vitest/config'

/**
 * Root-level tests for repository tooling that is not part of any workspace
 * package (the secret scanner, other build gates). Package tests run via
 * `pnpm -r test`; this covers `scripts/`.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.mjs'],
  },
})
