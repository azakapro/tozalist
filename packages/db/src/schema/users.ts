import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { userRoleEnum } from './enums.js'
import { organizations } from './organizations.js'

/**
 * A person who signs in to the dashboard.
 *
 * `password_hash` holds an Argon2id encoded hash (`$argon2id$...`) and nothing
 * else - never a plaintext password and never a reversible encoding.
 * `mfa_secret` is a TOTP secret and must never be logged.
 *
 * Deletion path: soft delete via `deleted_at`, hard delete cascades from the
 * organisation.
 *
 * Scope note (step 0.2): schema only. No login, session or MFA flow exists yet.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('member'),
    mfaSecret: text('mfa_secret'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('users_org_id_idx').on(table.orgId),
    index('users_deleted_at_idx').on(table.deletedAt),
  ],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
