import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { webhookDeliveryStatusEnum } from './enums.js'
import { webhookEndpoints } from './webhook-endpoints.js'

/**
 * One attempt log for one outgoing event.
 *
 * `payload` can contain customer data, so rows carry `expires_at` and are swept
 * like any other customer-generated table. Deleting an endpoint cascades here.
 *
 * Scope note (step 0.2): schema only. Nothing delivers anything yet.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /**
     * One entry per attempt: {attempt, at, status_code?, error?}. Codes and
     * fixed error categories only - never response bodies or foreign text.
     */
    attemptLog: jsonb('attempt_log')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastError: text('last_error'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('webhook_deliveries_endpoint_id_idx').on(table.endpointId),
    index('webhook_deliveries_status_next_retry_at_idx').on(table.status, table.nextRetryAt),
    index('webhook_deliveries_expires_at_idx').on(table.expiresAt),
  ],
)

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert
