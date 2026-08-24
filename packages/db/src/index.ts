export { readDatabaseConfig, requireTestDatabaseConfig, checkTestDatabaseConfig } from './config.js'
export type { DatabaseConfig, TestDatabaseCheck, TestDatabaseRejection } from './config.js'
export { createClient } from './client.js'
export type { CreateClientOptions, DatabaseClient, DatabaseExecutor } from './client.js'
export { getCreditBalance } from './credits.js'
export {
  API_KEY_PREFIX_LENGTH,
  generateApiKey,
  hashesMatch,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from './crypto.js'
export type { GeneratedApiKey } from './crypto.js'
export { hasMigrations, listMigrationFiles } from './migrations.js'
export { MIGRATIONS_DIR } from './paths.js'
export {
  DEMO_API_KEY_NAME,
  DEMO_ORG_ID,
  DEMO_ORG_NAME,
  DEMO_USER_EMAIL,
  INITIAL_CREDIT_GRANT,
  INITIAL_GRANT_REFERENCE,
  seedDemoData,
  seedDemoDataInTransaction,
} from './seed-data.js'
export type { SeedResult } from './seed-data.js'
export * from './schema/index.js'
