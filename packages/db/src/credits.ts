import { eq, sql } from 'drizzle-orm'
import type { DatabaseExecutor } from './client.js'
import { creditLedger } from './schema/index.js'

/**
 * Current credit balance for an organisation.
 *
 * The balance is derived, always and only, as SUM(delta) over the append-only
 * ledger. There is no cached balance column to drift out of sync, and adding
 * one would defeat the point of the ledger.
 */
export async function getCreditBalance(db: DatabaseExecutor, orgId: string): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId))

  return row?.balance ?? 0
}
