export { readDatabaseConfig, requireTestDatabaseConfig, checkTestDatabaseConfig } from './config.js'
export type { DatabaseConfig, TestDatabaseCheck, TestDatabaseRejection } from './config.js'
export { createClient } from './client.js'
export type { CreateClientOptions, DatabaseClient, DatabaseExecutor } from './client.js'
export { getCreditBalance } from './credits.js'
export {
  API_KEY_PATTERN,
  API_KEY_PREFIX_LENGTH,
  API_KEY_RANDOM_LENGTH,
  generateApiKey,
  hashesMatch,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from './crypto.js'
export type { GeneratedApiKey } from './crypto.js'
export { applyMigrations, hasMigrations, listMigrationFiles } from './migrations.js'
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
export {
  getActiveEmailCheck,
  getEmailCheckForProcessing,
  updateEmailCheckResult,
  type EmailCheckForProcessing,
  type EmailCheckResultUpdate,
} from './email-checks.js'
export {
  AUDIT_RETENTION_DAYS,
  createApiKeyForOrg,
  findActiveApiKeyByHash,
  recordAuditEvent,
  revokeApiKeyById,
  touchApiKeyLastUsed,
  type ApiKeyLookup,
  type AuditEventInput,
  type AuthenticatedKey,
  type CreateApiKeyResult,
  type CreatedApiKey,
  type RevokeApiKeyResult,
} from './api-keys.js'
export {
  createEmailCheckWithDebit,
  createPhoneCheckWithDebit,
  EMAIL_CACHE_WINDOW_MS,
  findRecentEmailCheck,
  getChecksPerDay,
  getEmailCheckForOrg,
  getLedgerWithRunningBalance,
  getUsageSummary,
  updateEmailCheckSnapshot,
  type EmailCheckDebitResult,
  type LedgerPage,
  type NewEmailCheckInput,
  type NewPhoneCheckInput,
  type PhoneCheckDebitResult,
  type UsageSummary,
} from './checks.js'
export {
  claimBatchForProcessing,
  completeBatch,
  createBatchWithReservation,
  deleteBatchForOrg,
  failBatch,
  findRecentEmailChecksByHashes,
  getBatchForOrg,
  getBatchForProcessing,
  insertBatchEmailChecks,
  listBatchesForOrg,
  updateBatchProgress,
  type BatchPage,
  type ClaimBatchResult,
  type DeleteBatchResult,
  type CompleteBatchInput,
  type CreateBatchInput,
  type CreateBatchResult,
} from './batches.js'
export {
  createWebhookDelivery,
  createWebhookEndpoint,
  findEndpointsForEvent,
  getDeliveryForProcessing,
  listWebhookEndpointsForOrg,
  recordDeliveryAttempt,
  softDeleteWebhookEndpoint,
  type AttemptRecord,
  type DeliveryForProcessing,
  type DeliveryOutcome,
  type WebhookEndpointSummary,
} from './webhooks.js'
export {
  consumeRecoveryCode,
  enrollMfa,
  findUserForLogin,
  getOrgSettings,
  getUserById,
  listApiKeysForOrg,
  listRecentAuditEvents,
  signupOrgWithAdmin,
  softDeleteOrganization,
  updateOrgSettings,
  type OrgSettings,
  type SignupResult,
} from './accounts.js'
export * from './schema/index.js'
