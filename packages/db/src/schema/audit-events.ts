import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { apiKeys } from './api-keys.js'
import { organizations } from './organizations.js'
import { users } from './users.js'

/**
 * Who did what, to which object, and when.
 *
 * The actor is either a user or an API key, and both are nullable so a
 * system-initiated action is still recordable. Actor references are `set null`
 * rather than cascade: deleting a user must not erase the fact that something
 * happened.
 *
 * `metadata` must never carry secrets - no API keys, webhook secrets, password
 * hashes or MFA secrets.
 *
 * Retention: `expires_at` from the organisation's `retention_days`.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorApiKeyId: uuid('actor_api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('audit_events_org_id_created_at_idx').on(table.orgId, table.createdAt),
    index('audit_events_actor_user_id_idx').on(table.actorUserId),
    index('audit_events_actor_api_key_id_idx').on(table.actorApiKeyId),
    index('audit_events_expires_at_idx').on(table.expiresAt),
  ],
)

export type AuditEvent = typeof auditEvents.$inferSelect
export type NewAuditEvent = typeof auditEvents.$inferInsert
