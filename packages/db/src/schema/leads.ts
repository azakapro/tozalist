import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { leadSourceEnum } from './enums.js'

/**
 * Someone who filled in a form on the public site.
 *
 * This is personal data belonging to a person who is not (yet) a customer, so
 * it carries both an expiry and a soft-delete column: `expires_at` for the
 * retention sweep, `deleted_at` for an erasure request.
 *
 * Scope note (step 0.2): schema only. No form handling and no marketing copy.
 */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    company: text('company'),
    phone: text('phone'),
    message: text('message'),
    source: leadSourceEnum('source').notNull(),
    locale: text('locale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('leads_email_idx').on(table.email),
    index('leads_created_at_idx').on(table.createdAt),
    index('leads_expires_at_idx').on(table.expiresAt),
    index('leads_deleted_at_idx').on(table.deletedAt),
  ],
)

export type Lead = typeof leads.$inferSelect
export type NewLead = typeof leads.$inferInsert
