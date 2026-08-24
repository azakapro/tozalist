import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { emailVerdictEnum } from './enums.js'
import { organizations } from './organizations.js'

/**
 * The result of checking one email address, owned by the organisation that
 * submitted it.
 *
 * `email_hash` (SHA-256) is what lookups and cache hits go through, so a repeat
 * check never has to scan plaintext addresses.
 *
 * Retention: `expires_at` is set from the organisation's `retention_days`. Rows
 * past it are swept; a hard org delete cascades.
 *
 * Scope note (step 0.2): schema only. Nothing writes here yet.
 */
export const emailChecks = pgTable(
  'email_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    emailNormalized: text('email_normalized').notNull(),
    /** SHA-256 of the normalised address, lowercase hex. */
    emailHash: text('email_hash').notNull(),
    verdict: emailVerdictEnum('verdict').notNull(),
    reasonCodes: text('reason_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    checksJson: jsonb('checks_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    cached: boolean('cached').notNull().default(false),
    creditsUsed: integer('credits_used').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('email_checks_org_id_email_hash_created_at_idx').on(
      table.orgId,
      table.emailHash,
      table.createdAt,
    ),
    index('email_checks_email_hash_idx').on(table.emailHash),
    index('email_checks_expires_at_idx').on(table.expiresAt),
  ],
)

export type EmailCheck = typeof emailChecks.$inferSelect
export type NewEmailCheck = typeof emailChecks.$inferInsert
