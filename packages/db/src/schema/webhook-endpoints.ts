import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organizations } from './organizations.js'

/**
 * Where an organisation wants event callbacks delivered.
 *
 * `secret` is the HMAC signing secret for outgoing payloads. It must never be
 * logged, never returned by an API response, and never appear in an audit
 * event's metadata.
 *
 * Deletion path: soft delete via `deleted_at`; a hard org delete cascades.
 *
 * Scope note (step 0.2): schema only. No delivery and no endpoint management.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: text('events')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('webhook_endpoints_org_id_idx').on(table.orgId),
    index('webhook_endpoints_deleted_at_idx').on(table.deletedAt),
  ],
)

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert
