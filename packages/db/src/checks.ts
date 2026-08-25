import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, gte, isNull, lt, or, sql } from 'drizzle-orm'
import type { DatabaseClient, DatabaseExecutor } from './client.js'
import { creditLedger, emailChecks, organizations, phoneChecks } from './schema/index.js'
import type { EmailCheck, PhoneCheck } from './schema/index.js'

/**
 * Check-and-debit helpers. The locked transaction in this file - not any
 * route-level pre-check - is the authoritative double-spend protection:
 * balance is computed as SUM(delta) inside a FOR UPDATE lock on the
 * organisation row, so concurrent debits serialise per org.
 */

/** Cache window for email results: strictly within the previous 7 days. */
export const EMAIL_CACHE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Finds the freshest reusable result for (org, email hash), or undefined. */
export async function findRecentEmailCheck(
  db: DatabaseExecutor,
  orgId: string,
  emailHash: string,
  now: Date = new Date(),
): Promise<EmailCheck | undefined> {
  const cutoff = new Date(now.getTime() - EMAIL_CACHE_WINDOW_MS)
  const [row] = await db
    .select()
    .from(emailChecks)
    .where(
      and(
        eq(emailChecks.orgId, orgId),
        eq(emailChecks.emailHash, emailHash),
        // Strictly newer than the cutoff: a check exactly 7 days old is a miss.
        gt(emailChecks.createdAt, cutoff),
        gt(emailChecks.expiresAt, now),
      ),
    )
    .orderBy(desc(emailChecks.createdAt), desc(emailChecks.id))
    .limit(1)
  return row
}

/**
 * Loads one email check only when it belongs to the given org, the org is
 * active, and the row has not expired. All misses look identical to callers.
 */
export async function getEmailCheckForOrg(
  db: DatabaseExecutor,
  id: string,
  orgId: string,
  now: Date = new Date(),
): Promise<EmailCheck | undefined> {
  const [row] = await db
    .select({ check: emailChecks })
    .from(emailChecks)
    .innerJoin(organizations, eq(emailChecks.orgId, organizations.id))
    .where(
      and(
        eq(emailChecks.id, id),
        eq(emailChecks.orgId, orgId),
        isNull(organizations.deletedAt),
        gt(emailChecks.expiresAt, now),
      ),
    )
  return row?.check
}

type LockedOrg = { id: string; retentionDays: number; smtpEnabled: boolean }

/** Locks the active org row; concurrent debits for one org serialise here. */
async function lockOrganization(
  tx: DatabaseExecutor,
  orgId: string,
): Promise<LockedOrg | undefined> {
  const [org] = await tx
    .select({
      id: organizations.id,
      retentionDays: organizations.retentionDays,
      smtpEnabled: organizations.smtpEnabled,
    })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .for('update')
  return org
}

async function lockedBalance(tx: DatabaseExecutor, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId))
  return row?.balance ?? 0
}

export type NewEmailCheckInput = {
  orgId: string
  emailNormalized: string
  emailHash: string
  verdict: EmailCheck['verdict']
  reasonCodes: string[]
  checksJson: Record<string, unknown>
}

export type EmailCheckDebitResult =
  | { kind: 'created'; check: EmailCheck; balance: number; org: LockedOrg }
  | { kind: 'cache_hit'; check: EmailCheck; balance: number }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'org_unavailable' }

/**
 * Creates an email check and its single_check debit atomically.
 *
 * Inside one transaction: lock the org row, re-check the result cache (a
 * concurrent request may have just written this same email - if so, reuse it
 * and charge nothing), compute the ledger balance, refuse below 1, then insert
 * exactly one check row and one -1 ledger row referenced to the check's
 * app-generated UUID.
 */
export async function createEmailCheckWithDebit(
  db: DatabaseClient,
  input: NewEmailCheckInput,
  now: Date = new Date(),
): Promise<EmailCheckDebitResult> {
  return db.transaction(async (tx) => {
    const org = await lockOrganization(tx, input.orgId)
    if (org === undefined) return { kind: 'org_unavailable' } as const

    const existing = await findRecentEmailCheck(tx, input.orgId, input.emailHash, now)
    if (existing !== undefined) {
      return {
        kind: 'cache_hit',
        check: existing,
        balance: await lockedBalance(tx, org.id),
      } as const
    }

    const balance = await lockedBalance(tx, org.id)
    if (balance < 1) return { kind: 'insufficient', balance } as const

    const checkId = randomUUID()
    const expiresAt = new Date(now.getTime() + org.retentionDays * 24 * 60 * 60 * 1000)

    const [check] = await tx
      .insert(emailChecks)
      .values({
        id: checkId,
        orgId: input.orgId,
        emailNormalized: input.emailNormalized,
        emailHash: input.emailHash,
        verdict: input.verdict,
        reasonCodes: input.reasonCodes,
        checksJson: input.checksJson,
        cached: false,
        creditsUsed: 1,
        expiresAt,
      })
      .returning()
    if (check === undefined) throw new Error('failed to insert the email check')

    await tx.insert(creditLedger).values({
      orgId: input.orgId,
      delta: -1,
      reason: 'single_check',
      referenceId: checkId,
    })

    return { kind: 'created', check, balance: balance - 1, org } as const
  })
}

export type NewPhoneCheckInput = {
  orgId: string
  e164: string | null
  inputHash: string
  valid: boolean
  country: string | null
  lineTypeGuess: string | null
  reasonCodes: string[]
}

export type PhoneCheckDebitResult =
  | { kind: 'created'; check: PhoneCheck; balance: number }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'org_unavailable' }

/** Same locked debit mechanism for phone checks (no result cache). */
export async function createPhoneCheckWithDebit(
  db: DatabaseClient,
  input: NewPhoneCheckInput,
  now: Date = new Date(),
): Promise<PhoneCheckDebitResult> {
  return db.transaction(async (tx) => {
    const org = await lockOrganization(tx, input.orgId)
    if (org === undefined) return { kind: 'org_unavailable' } as const

    const balance = await lockedBalance(tx, org.id)
    if (balance < 1) return { kind: 'insufficient', balance } as const

    const checkId = randomUUID()
    const expiresAt = new Date(now.getTime() + org.retentionDays * 24 * 60 * 60 * 1000)

    const [check] = await tx
      .insert(phoneChecks)
      .values({
        id: checkId,
        orgId: input.orgId,
        e164: input.e164,
        inputHash: input.inputHash,
        valid: input.valid,
        country: input.country,
        lineTypeGuess: input.lineTypeGuess,
        reasonCodes: input.reasonCodes,
        creditsUsed: 1,
        expiresAt,
      })
      .returning()
    if (check === undefined) throw new Error('failed to insert the phone check')

    await tx.insert(creditLedger).values({
      orgId: input.orgId,
      delta: -1,
      reason: 'single_check',
      referenceId: checkId,
    })

    return { kind: 'created', check, balance: balance - 1 } as const
  })
}

/** Marks a stored snapshot's SMTP lifecycle; used when enqueueing fails. */
export async function updateEmailCheckSnapshot(
  db: DatabaseExecutor,
  id: string,
  checksJson: Record<string, unknown>,
): Promise<void> {
  await db.update(emailChecks).set({ checksJson }).where(eq(emailChecks.id, id))
}

export type LedgerPage = {
  entries: Array<{
    id: string
    delta: number
    reason: string
    referenceId: string | null
    createdAt: Date
  }>
  nextCursor: string | null
}

export type UsageSummary = {
  balance: number
  month: { email: number; phone: number; total: number }
  ledger: LedgerPage
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (iso === undefined || id === undefined) return null
    const createdAt = new Date(iso)
    if (Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

/**
 * Org-scoped usage: balance, current-UTC-month check counts, and a ledger page.
 * Ordering is (created_at DESC, id DESC) so pagination stays deterministic even
 * when timestamps tie; the cursor encodes both columns.
 */
export async function getUsageSummary(
  db: DatabaseExecutor,
  orgId: string,
  options: { cursor?: string; limit: number },
  now: Date = new Date(),
): Promise<UsageSummary | null> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const decoded = options.cursor !== undefined ? decodeCursor(options.cursor) : null
  if (options.cursor !== undefined && decoded === null) return null

  const [balanceRow] = await db
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId))

  const [emailCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailChecks)
    .where(and(eq(emailChecks.orgId, orgId), gte(emailChecks.createdAt, monthStart)))
  const [phoneCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(phoneChecks)
    .where(and(eq(phoneChecks.orgId, orgId), gte(phoneChecks.createdAt, monthStart)))

  const pageFilter =
    decoded === null
      ? eq(creditLedger.orgId, orgId)
      : and(
          eq(creditLedger.orgId, orgId),
          or(
            lt(creditLedger.createdAt, decoded.createdAt),
            and(eq(creditLedger.createdAt, decoded.createdAt), lt(creditLedger.id, decoded.id)),
          ),
        )

  const rows = await db
    .select({
      id: creditLedger.id,
      delta: creditLedger.delta,
      reason: creditLedger.reason,
      referenceId: creditLedger.referenceId,
      createdAt: creditLedger.createdAt,
    })
    .from(creditLedger)
    .where(pageFilter)
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(options.limit + 1)

  const page = rows.slice(0, options.limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > options.limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null

  const email = emailCount?.count ?? 0
  const phone = phoneCount?.count ?? 0

  return {
    balance: balanceRow?.balance ?? 0,
    month: { email, phone, total: email + phone },
    ledger: { entries: page, nextCursor },
  }
}

/** Daily check counts (email + phone) for the last `days` days, UTC. */
export async function getChecksPerDay(
  db: DatabaseExecutor,
  orgId: string,
  days: number,
  now: Date = new Date(),
): Promise<Array<{ day: string; count: number }>> {
  // ISO strings: raw execute() parameters must be primitives, not Dates.
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  const rows = await db.execute<{ day: string; count: number }>(sql`
    select day::text as day, sum(count)::int as count from (
      select date_trunc('day', ${emailChecks.createdAt} at time zone 'UTC')::date as day, count(*) as count
      from ${emailChecks}
      where ${emailChecks.orgId} = ${orgId} and ${emailChecks.createdAt} >= ${since}
      group by 1
      union all
      select date_trunc('day', ${phoneChecks.createdAt} at time zone 'UTC')::date as day, count(*) as count
      from ${phoneChecks}
      where ${phoneChecks.orgId} = ${orgId} and ${phoneChecks.createdAt} >= ${since}
      group by 1
    ) combined
    group by day
    order by day
  `)
  return rows.map((row) => ({ day: row.day, count: row.count }))
}

/**
 * Ledger entries with a TRUE running balance: a window sum over the whole
 * org history, so the balance column stays correct even when a date filter
 * hides earlier rows. Newest first, bounded page.
 */
export async function getLedgerWithRunningBalance(
  db: DatabaseExecutor,
  orgId: string,
  options: { from?: Date; to?: Date; limit: number },
): Promise<
  Array<{
    id: string
    delta: number
    reason: string
    referenceId: string | null
    createdAt: Date
    runningBalance: number
  }>
> {
  const rows = await db.execute<{
    id: string
    delta: number
    reason: string
    reference_id: string | null
    created_at: string
    running_balance: number
  }>(sql`
    select id, delta, reason, reference_id, created_at::text as created_at,
           running_balance::int as running_balance
    from (
      select *, sum(delta) over (order by created_at asc, id asc)::int as running_balance
      from ${creditLedger}
      where ${creditLedger.orgId} = ${orgId}
    ) history
    where (${options.from?.toISOString() ?? null}::timestamptz is null or created_at >= ${options.from?.toISOString() ?? null}::timestamptz)
      and (${options.to?.toISOString() ?? null}::timestamptz is null or created_at <= ${options.to?.toISOString() ?? null}::timestamptz)
    order by created_at desc, id desc
    limit ${options.limit}
  `)
  return rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    referenceId: row.reference_id,
    createdAt: new Date(row.created_at),
    runningBalance: row.running_balance,
  }))
}
