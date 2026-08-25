import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * A customer account. Everything else in the schema hangs off an organisation.
 *
 * Deletion path: soft delete via `deleted_at`, then the retention sweep removes
 * the organisation's personal data. `retention_days` is how long that data may
 * be kept, and it drives every `expires_at` in the child tables.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Set once the retention sweep has hard-deleted this organisation's data.
     * The row itself must outlive the purge: credit_ledger references it with
     * ON DELETE RESTRICT (three-year accounting retention), so the sweep
     * anonymizes the row - name replaced, children deleted - and marks it here
     * instead of deleting it. A set purged_at also makes the sweep idempotent.
     */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    retentionDays: integer('retention_days').notNull().default(30),
    smtpEnabled: boolean('smtp_enabled').notNull().default(false),
  },
  (table) => [index('organizations_deleted_at_idx').on(table.deletedAt)],
)

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
