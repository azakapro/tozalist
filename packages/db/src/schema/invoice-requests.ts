import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organizations } from './organizations.js'
import { users } from './users.js'

/**
 * A request for a manual invoice, created from the dashboard billing page.
 * Plan codes come from @tozalist/core PLANS (configuration, not database);
 * this row only records which one was requested and by whom.
 *
 * Retention path: rows are deleted explicitly by the organisation hard purge
 * (they reference the org and a user, nothing else), and carry no bank or
 * payment data - the bank-transfer instructions live in environment
 * configuration and are only displayed, never stored.
 */
export const invoiceRequests = pgTable(
  'invoice_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    planCode: text('plan_code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('invoice_requests_org_id_created_at_idx').on(table.orgId, table.createdAt)],
)

export type InvoiceRequest = typeof invoiceRequests.$inferSelect
export type NewInvoiceRequest = typeof invoiceRequests.$inferInsert
