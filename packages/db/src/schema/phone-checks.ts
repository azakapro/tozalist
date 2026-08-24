import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organizations } from './organizations.js'

/**
 * The result of checking one phone number.
 *
 * Scope note (step 0.2): schema only, and deliberately format-level only.
 * `line_type_guess` is a guess derived from the number's own structure. There is
 * no carrier lookup, no HLR query, no owner or live-status data in this table,
 * and none may be added without a product decision.
 *
 * Retention: `expires_at` from the organisation's `retention_days`; a hard org
 * delete cascades.
 */
export const phoneChecks = pgTable(
  'phone_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    e164: text('e164'),
    /** SHA-256 of the raw input, lowercase hex. */
    inputHash: text('input_hash').notNull(),
    valid: boolean('valid').notNull(),
    country: text('country'),
    lineTypeGuess: text('line_type_guess'),
    reasonCodes: text('reason_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    creditsUsed: integer('credits_used').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('phone_checks_org_id_input_hash_idx').on(table.orgId, table.inputHash),
    index('phone_checks_expires_at_idx').on(table.expiresAt),
  ],
)

export type PhoneCheck = typeof phoneChecks.$inferSelect
export type NewPhoneCheck = typeof phoneChecks.$inferInsert
