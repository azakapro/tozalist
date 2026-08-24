import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organizations } from './organizations.js'

/**
 * A machine credential for the public API.
 *
 * Only the SHA-256 hash of the key is stored. The plaintext key is shown to the
 * caller exactly once, at creation, and is unrecoverable afterwards.
 * `key_prefix` holds the first 12 characters purely so a human can tell two
 * keys apart in a list.
 *
 * Deletion path: `revoked_at` for revocation, `expires_at` for expiry, hard
 * delete cascades from the organisation.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 of the plaintext key, lowercase hex. Never the key itself. */
    keyHash: text('key_hash').notNull().unique(),
    /** First 12 characters of the key, for display only. */
    keyPrefix: text('key_prefix').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('api_keys_org_id_idx').on(table.orgId),
    index('api_keys_expires_at_idx').on(table.expiresAt),
    index('api_keys_revoked_at_idx').on(table.revokedAt),
  ],
)

export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert
