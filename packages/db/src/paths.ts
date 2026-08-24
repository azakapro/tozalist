import { fileURLToPath } from 'node:url'

/** Absolute path of the generated SQL migrations directory. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url))
