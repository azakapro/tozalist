import { aggregate, detectTypo, normalizeEmail, validatePhone } from '@tozalist/core'
import {
  createEmailCheckWithDebit,
  createPhoneCheckWithDebit,
  findRecentEmailCheck,
  getCreditBalance,
  sha256Hex,
  updateEmailCheckSnapshot,
  type DatabaseClient,
  type EmailCheck,
  type PhoneCheck,
} from '@tozalist/db'
import { parseStoredEmailCheck, type SmtpStatus, type StoredEmailCheck } from '@tozalist/shared'
import type { BalanceCache } from './balance-cache.js'
import type { EngineCaller, SmtpQueuePublisher } from './types.js'

/**
 * The single email/phone check orchestration, shared by the public /v1 routes
 * (API-key auth) and the dashboard's /internal routes (session auth). One
 * implementation means the credit, cache and SMTP rules cannot drift between
 * the two surfaces.
 */

export type CheckServiceDeps = {
  db: DatabaseClient
  engine: EngineCaller
  smtpQueue: SmtpQueuePublisher
  balanceCache: BalanceCache
  smtpEnabled: boolean
}

export type EmailCheckOutcome =
  | { kind: 'insufficient' }
  | { kind: 'engine_failed'; errorName: string }
  | { kind: 'snapshot_unreadable' }
  | {
      kind: 'ok'
      check: EmailCheck
      snapshot: StoredEmailCheck
      creditsUsed: number
      creditsRemaining: number
      cached: boolean
      smtp: SmtpStatus
    }

export async function performEmailCheck(
  deps: CheckServiceDeps,
  orgId: string,
  input: { email: string; smtp: boolean },
): Promise<EmailCheckOutcome> {
  const normalized = normalizeEmail(input.email).normalized ?? ''
  const emailHash = sha256Hex(normalized)

  // Balance gate first: a zero-credit org is refused before any cache hit.
  const balance = await currentBalance(deps, orgId)
  if (balance < 1) return { kind: 'insufficient' }

  const cachedRow = await findRecentEmailCheck(deps.db, orgId, emailHash)
  if (cachedRow !== undefined) {
    const snapshot = parseStoredEmailCheck(cachedRow.checksJson)
    if (snapshot === null) return { kind: 'snapshot_unreadable' }
    return {
      kind: 'ok',
      check: cachedRow,
      snapshot,
      creditsUsed: 0,
      creditsRemaining: balance,
      cached: true,
      smtp: snapshot.smtp_status,
    }
  }

  let engineResponse
  try {
    engineResponse = await deps.engine.verify(normalized, { smtp: false, catchAll: false })
  } catch (error) {
    return { kind: 'engine_failed', errorName: error instanceof Error ? error.name : 'unknown' }
  }

  const typo = detectTypo(engineResponse.syntax.domain)
  const aggregated = aggregate({ engine: engineResponse, typo })
  const snapshot: StoredEmailCheck = {
    engine: engineResponse,
    score: aggregated.score,
    disclaimer: aggregated.disclaimer,
    typo,
    smtp_status: 'skipped',
  }

  const result = await createEmailCheckWithDebit(deps.db, {
    orgId,
    emailNormalized: normalized,
    emailHash,
    verdict: aggregated.verdict,
    reasonCodes: aggregated.reasonCodes,
    checksJson: snapshot,
  })

  if (result.kind === 'org_unavailable') return { kind: 'insufficient' }
  if (result.kind === 'insufficient') {
    await deps.balanceCache.set(orgId, result.balance)
    return { kind: 'insufficient' }
  }
  if (result.kind === 'cache_hit') {
    const hitSnapshot = parseStoredEmailCheck(result.check.checksJson)
    if (hitSnapshot === null) return { kind: 'snapshot_unreadable' }
    return {
      kind: 'ok',
      check: result.check,
      snapshot: hitSnapshot,
      creditsUsed: 0,
      creditsRemaining: result.balance,
      cached: true,
      smtp: hitSnapshot.smtp_status,
    }
  }

  await deps.balanceCache.set(orgId, result.balance)

  let smtpStatus: SmtpStatus = 'skipped'
  if (input.smtp && result.org.smtpEnabled && deps.smtpEnabled) {
    const pending: StoredEmailCheck = { ...snapshot, smtp_status: 'pending' }
    await updateEmailCheckSnapshot(deps.db, result.check.id, pending)
    try {
      await deps.smtpQueue.enqueue(result.check.id)
      smtpStatus = 'pending'
    } catch {
      await updateEmailCheckSnapshot(deps.db, result.check.id, snapshot)
      smtpStatus = 'skipped'
    }
  }

  return {
    kind: 'ok',
    check: result.check,
    snapshot: { ...snapshot, smtp_status: smtpStatus },
    creditsUsed: 1,
    creditsRemaining: result.balance,
    cached: false,
    smtp: smtpStatus,
  }
}

export type PhoneCheckOutcome =
  { kind: 'insufficient' } | { kind: 'ok'; check: PhoneCheck; creditsRemaining: number }

export async function performPhoneCheck(
  deps: Pick<CheckServiceDeps, 'db' | 'balanceCache'>,
  orgId: string,
  input: { phone: string; country: string },
): Promise<PhoneCheckOutcome> {
  const result = validatePhone(input.phone, input.country)
  const debit = await createPhoneCheckWithDebit(deps.db, {
    orgId,
    e164: result.e164,
    inputHash: sha256Hex(input.phone),
    valid: result.valid,
    country: result.country,
    lineTypeGuess: result.lineTypeGuess,
    reasonCodes: result.reasonCodes,
  })
  if (debit.kind === 'org_unavailable' || debit.kind === 'insufficient') {
    if (debit.kind === 'insufficient') await deps.balanceCache.set(orgId, debit.balance)
    return { kind: 'insufficient' }
  }
  await deps.balanceCache.set(orgId, debit.balance)
  return { kind: 'ok', check: debit.check, creditsRemaining: debit.balance }
}

async function currentBalance(deps: CheckServiceDeps, orgId: string): Promise<number> {
  const cached = await deps.balanceCache.get(orgId)
  if (cached !== null) return cached
  const balance = await getCreditBalance(deps.db, orgId)
  await deps.balanceCache.set(orgId, balance)
  return balance
}
