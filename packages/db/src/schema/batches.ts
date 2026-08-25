import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { batchStatusEnum } from './enums.js'
import { organizations } from './organizations.js'

/**
 * One uploaded list and its processing state.
 *
 * `input_object_key` and `result_object_key` point at objects in S3/MinIO. The
 * retention sweep must delete those objects as well as the row - the file is
 * customer data even after the row is gone.
 *
 * Scope note (step 0.2): schema only. No upload handling and no jobs yet.
 */
export const batches = pgTable(
  'batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    status: batchStatusEnum('status').notNull().default('pending'),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    error: text('error'),
    /**
     * Operational counters and CSV layout (shared BatchStats shape): detected
     * email column, header flag, malformed/charged/cached/duplicate counts and
     * the verdict distribution. Never contains addresses.
     */
    stats: jsonb('stats')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    inputObjectKey: text('input_object_key').notNull(),
    resultObjectKey: text('result_object_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('batches_org_id_created_at_idx').on(table.orgId, table.createdAt),
    index('batches_expires_at_idx').on(table.expiresAt),
    index('batches_status_idx').on(table.status),
  ],
)

export type Batch = typeof batches.$inferSelect
export type NewBatch = typeof batches.$inferInsert
