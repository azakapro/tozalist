import { and, eq, isNull } from 'drizzle-orm'
import type { DatabaseExecutor } from './client.js'
import { emailChecks, organizations } from './schema/index.js'
import type { EmailCheck } from './schema/index.js'

/**
 * Typed helpers for workers operating on email_checks rows.
 *
 * Callers pass row IDs around (job payloads, logs); the email address itself
 * only ever comes out of the database here, immediately before use.
 */

export type EmailCheckForProcessing = {
  check: EmailCheck
  /** Soft-delete timestamp of the owning organisation, if any. */
  orgDeletedAt: Date | null
}

/** Loads one check together with its organisation's deletion state. */
export async function getEmailCheckForProcessing(
  db: DatabaseExecutor,
  id: string,
): Promise<EmailCheckForProcessing | undefined> {
  const [row] = await db
    .select({ check: emailChecks, orgDeletedAt: organizations.deletedAt })
    .from(emailChecks)
    .innerJoin(organizations, eq(emailChecks.orgId, organizations.id))
    .where(eq(emailChecks.id, id))

  return row
}

export type EmailCheckResultUpdate = {
  verdict: EmailCheck['verdict']
  reasonCodes: string[]
  checksJson: Record<string, unknown>
  cached: boolean
}

/**
 * Writes a verification outcome onto an existing row. A single UPDATE, so the
 * verdict, reasons and snapshot always land together. Returns false when the
 * row no longer exists (it may have been swept between load and update).
 */
export async function updateEmailCheckResult(
  db: DatabaseExecutor,
  id: string,
  update: EmailCheckResultUpdate,
): Promise<boolean> {
  const updated = await db
    .update(emailChecks)
    .set({
      verdict: update.verdict,
      reasonCodes: update.reasonCodes,
      checksJson: update.checksJson,
      cached: update.cached,
    })
    .where(eq(emailChecks.id, id))
    .returning({ id: emailChecks.id })

  return updated.length > 0
}

/** Loads a check only when its organisation is still active. */
export async function getActiveEmailCheck(
  db: DatabaseExecutor,
  id: string,
): Promise<EmailCheck | undefined> {
  const [row] = await db
    .select({ check: emailChecks })
    .from(emailChecks)
    .innerJoin(organizations, eq(emailChecks.orgId, organizations.id))
    .where(and(eq(emailChecks.id, id), isNull(organizations.deletedAt)))

  return row?.check
}
