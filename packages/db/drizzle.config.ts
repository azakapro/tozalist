import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit loads this file with its own bundler, so it stays dependency-free
 * and reads the environment directly instead of importing package internals.
 *
 * The schema points at the compiled output, not at ./src: drizzle-kit resolves
 * imports as CommonJS and cannot follow TypeScript's ".js" specifiers. The
 * db:generate script builds first, so dist is always current.
 */
const url = process.env.DATABASE_URL

if (url === undefined || url.trim() === '') {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and set it.')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './dist/schema/index.js',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
