import { aggregate, detectTypo, normalizeEmail, validatePhone } from '@tozalist/core'
import {
  createEmailCheckWithDebit,
  createPhoneCheckWithDebit,
  findRecentEmailCheck,
  getOrgSettings,
  getCreditBalance,
  sha256Hex,
  updateEmailCheckSnapshot,
  type DatabaseClient,
  type EmailCheck,
  type PhoneCheck,
} from '@tozalist/db'
import { parseStoredEmailCheck, type SmtpStatus, type StoredEmailCheck } from '@tozalist/shared'
import type { BalanceCache } from './balance-cache.js'
import type { ApiMetrics } from './metrics.js'
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
  /** Optional Prometheus instruments; absent in unit tests. */
  metrics?: ApiMetrics | undefined
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
  input: { email: string; smtp: boolean; requestId?: string | undefined },
): Promise<EmailCheckOutcome> {
  const normalized = normalizeEmail(input.email).normalized ?? ''
  const emailHash = sha256Hex(normalized)

  // Balance gate first: a zero-credit org is refused before any cache hit.
  const balance = await currentBalance(deps, orgId)
  if (balance < 1) return { kind: 'insufficient' }

  const cachedRow = await findRecentEmailCheck(deps.db, orgId, emailHash)
  deps.metrics?.cacheEvents.inc({ result: cachedRow !== undefined ? 'hit' : 'miss' })
  if (cachedRow !== undefined) {
    const snapshot = parseStoredEmailCheck(cachedRow.checksJson)
    if (snapshot === null) return { kind: 'snapshot_unreadable' }

    // A cached offline-only result does not satisfy a request for a mailbox
    // probe. When every switch allows probing, attach the probe to the cached
    // check instead of returning "skipped": still a cache hit, still free, and
    // the worker completes the very same row. A probe already pending or
    // complete is returned as-is.
    let smtpStatus: SmtpStatus = snapshot.smtp_status
    if (input.smtp && deps.smtpEnabled && snapshot.smtp_status === 'skipped') {
      const org = await getOrgSettings(deps.db, orgId)
      if (org?.smtpEnabled === true) {
        const pending: StoredEmailCheck = { ...snapshot, smtp_status: 'pending' }
        await updateEmailCheckSnapshot(deps.db, cachedRow.id, pending)
        try {
          await deps.smtpQueue.enqueue(cachedRow.id, input.requestId)
          smtpStatus = 'pending'
        } catch {
          await updateEmailCheckSnapshot(deps.db, cachedRow.id, snapshot)
        }
      }
    }

    return {
      kind: 'ok',
      check: cachedRow,
      snapshot: { ...snapshot, smtp_status: smtpStatus },
      creditsUsed: 0,
      creditsRemaining: balance,
      cached: true,
      smtp: smtpStatus,
    }
  }

  let engineResponse
  const engineStarted = Date.now()
  try {
    engineResponse = await deps.engine.verify(normalized, {
      smtp: false,
      catchAll: false,
      requestId: input.requestId,
    })
    deps.metrics?.engineDuration.observe({}, (Date.now() - engineStarted) / 1000)
    deps.metrics?.engineCalls.inc({ outcome: 'ok' })
  } catch (error) {
    deps.metrics?.engineDuration.observe({}, (Date.now() - engineStarted) / 1000)
    deps.metrics?.engineCalls.inc({ outcome: 'error' })
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
  deps.metrics?.creditsSpent.inc({ kind: 'single_check' })

  let smtpStatus: SmtpStatus = 'skipped'
  if (input.smtp && result.org.smtpEnabled && deps.smtpEnabled) {
    const pending: StoredEmailCheck = { ...snapshot, smtp_status: 'pending' }
    await updateEmailCheckSnapshot(deps.db, result.check.id, pending)
    try {
      await deps.smtpQueue.enqueue(result.check.id, input.requestId)
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
  deps: Pick<CheckServiceDeps, 'db' | 'balanceCache' | 'metrics'>,
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
  deps.metrics?.creditsSpent.inc({ kind: 'phone_check' })
  return { kind: 'ok', check: debit.check, creditsRemaining: debit.balance }
}

async function currentBalance(deps: CheckServiceDeps, orgId: string): Promise<number> {
  const cached = await deps.balanceCache.get(orgId)
  if (cached !== null) return cached
  const balance = await getCreditBalance(deps.db, orgId)
  await deps.balanceCache.set(orgId, balance)
  return balance
}
