import { REASON_CODES, isReasonCode } from '@tozalist/core'
import type { EmailCheck, PhoneCheck } from '@tozalist/db'
import type { SmtpStatus, StoredEmailCheck } from '@tozalist/shared'

/**
 * Response rendering: one place that turns rows + snapshots into the stable
 * public shapes, so POST results and later GET polling render identically.
 */

export const API_VERSION = 'v1'

/** Exact wording; the response must never overstate what a phone check is. */
export const PHONE_LIMITATION =
  'This is format validation only. It does not show whether a number is active, reachable, or owned by any person or organization.'

export function reasonExplanations(codes: string[]): Record<string, string> {
  const explanations: Record<string, string> = {}
  for (const code of codes) {
    if (isReasonCode(code)) explanations[code] = REASON_CODES[code]
  }
  return explanations
}

export function renderEmailCheckData(
  check: EmailCheck,
  snapshot: StoredEmailCheck,
): Record<string, unknown> {
  return {
    check_id: check.id,
    email: check.emailNormalized,
    verdict: check.verdict,
    score: snapshot.score,
    reason_codes: check.reasonCodes,
    reason_explanations: reasonExplanations(check.reasonCodes),
    suggestion: snapshot.typo,
    checks: {
      syntax: snapshot.engine.syntax,
      domain: snapshot.engine.mx,
      disposable: snapshot.engine.disposable,
      role_account: snapshot.engine.role_account,
      smtp: snapshot.engine.smtp,
    },
    disclaimer: snapshot.disclaimer,
  }
}

export type ResponseMeta = {
  request_id: string
  credits_used: number
  credits_remaining: number
  cached: boolean
  smtp: SmtpStatus
  api_version: typeof API_VERSION
}

export function renderMeta(
  requestId: string,
  fields: { creditsUsed: number; creditsRemaining: number; cached: boolean; smtp: SmtpStatus },
): ResponseMeta {
  return {
    request_id: requestId,
    credits_used: fields.creditsUsed,
    credits_remaining: fields.creditsRemaining,
    cached: fields.cached,
    smtp: fields.smtp,
    api_version: API_VERSION,
  }
}

export function renderPhoneCheckData(check: PhoneCheck): Record<string, unknown> {
  return {
    check_id: check.id,
    e164: check.e164,
    valid: check.valid,
    country: check.country,
    line_type_guess: check.lineTypeGuess,
    reason_codes: check.reasonCodes,
    reason_explanations: reasonExplanations(check.reasonCodes),
    limitation: PHONE_LIMITATION,
  }
}
