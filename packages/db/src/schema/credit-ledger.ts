import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { creditReasonEnum } from './enums.js'
import { organizations } from './organizations.js'

/**
 * Append-only record of every credit movement.
 *
 * There is deliberately no balance column anywhere in this schema: a balance is
 * always `SUM(delta)` over this table (see `getCreditBalance`). A stored
 * balance would be a second source of truth that can silently drift.
 *
 * Updates and deletes are rejected by a database trigger, not just by
 * convention - see the `0001_append_only_credit_ledger` migration.
 *
 * `reference_id` identifies the operation that caused the movement (a check, a
 * batch, an invoice, a seed run). It is covered by a partial unique index, so
 * replaying the same operation cannot move credits twice.
 *
 * Retention: financial records are not personal data and are not swept. The
 * organisation FK is `restrict` on purpose, so a hard org delete cannot quietly
 * erase the money trail.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Positive for a grant or refund, negative for a spend. */
    delta: integer('delta').notNull(),
    reason: creditReasonEnum('reason').notNull(),
    referenceId: text('reference_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('credit_ledger_org_id_created_at_idx').on(table.orgId, table.createdAt),
    uniqueIndex('credit_ledger_org_id_reference_id_uniq')
      .on(table.orgId, table.referenceId)
      .where(sql`${table.referenceId} is not null`),
  ],
)

export type CreditLedgerEntry = typeof creditLedger.$inferSelect
export type NewCreditLedgerEntry = typeof creditLedger.$inferInsert
