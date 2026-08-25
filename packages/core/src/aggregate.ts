import type { ReasonCode } from './reason-codes.js'

/**
 * Verdict aggregation: turns one Go-engine response plus the local typo signal
 * into a customer-facing verdict.
 *
 * Pure logic only - the engine response arrives as data; nothing here performs
 * I/O of any kind.
 */

/** Mirror of the Go engine's /verify response contract (step 1.1). */
export type EngineResponse = {
  email: string
  syntax: {
    valid: boolean
    username: string
    domain: string
  }
  mx: {
    /** true/false when the lookup succeeded; null when the lookup itself failed. */
    has_mx: boolean | null
    records: string[]
    error: string
  }
  disposable: boolean
  role_account: boolean
  free_provider: boolean
  /** null exactly when the request did not ask for an SMTP probe. */
  smtp: {
    attempted: boolean
    mailbox_accepted: boolean
    catch_all: boolean
    full_inbox: boolean
    disabled: boolean
    error: string
  } | null
  duration_ms: number
}

export type Verdict = 'valid' | 'invalid' | 'risky' | 'unknown'

export type AggregateInput = {
  engine: EngineResponse
  /** Suggested corrected domain from detectTypo(), or null. */
  typo: string | null
  /**
   * Worker-side operational condition, when the mailbox probe could not run at
   * all: probing switched off (`SMTP_DISABLED`) or the domain's circuit
   * breaker open (`CIRCUIT_OPEN`). Hard evidence about the address itself
   * (invalid syntax, confirmed no MX) still outranks it; anything else becomes
   * `unknown` with the operational reason first. Omit for normal aggregation -
   * behaviour without it is unchanged.
   */
  operationalReason?: 'SMTP_DISABLED' | 'CIRCUIT_OPEN'
}

export type AggregateResult = {
  /**
   * The verdict is a risk classification, not a delivery outcome.
   *
   * - `valid` is still a signal, never a promise that mail will arrive.
   * - `unknown` means the checks could not decide - most often because lookup
   *   infrastructure was unavailable - and must not be used as an automatic
   *   deletion decision.
   */
  verdict: Verdict
  /**
   * A sort key only: higher sorts as healthier within a list. It is NOT a
   * probability, is not calibrated, and must never be presented as one.
   */
  score: number
  /** The deciding reason first, then non-contradicting secondary cautions. */
  reasonCodes: ReasonCode[]
  /** Always {@link AGGREGATE_DISCLAIMER}, attached to every single result. */
  disclaimer: string
}

/** Attached verbatim to every result; consumer UIs surface it as-is. */
export const AGGREGATE_DISCLAIMER =
  "These are risk signals, not delivery guarantees. Results marked 'unknown' should not be deleted automatically."

type Decision = {
  verdict: Verdict
  score: number
  reason: ReasonCode | null
}

/**
 * Aggregates engine output and the typo signal into a verdict.
 *
 * Rules run in strict priority order; the first match decides verdict, score
 * and the leading reason code. Secondary caution reasons are appended only to
 * `risky` and `unknown` results, where they add context without contradicting
 * the decision - an `invalid` result stays single-reasoned, because piling
 * cautions onto a dead address only muddies why it is dead.
 *
 * Infrastructure failures (MX lookup unavailable, SMTP unreachable) always
 * yield `unknown`, never `invalid`: not being able to look is not evidence of
 * absence.
 */
export function aggregate(input: AggregateInput): AggregateResult {
  const decision = decide(input)

  const reasonCodes: ReasonCode[] =
    decision.reason === null ? [] : [decision.reason, ...secondaryReasons(input, decision)]

  return {
    verdict: decision.verdict,
    score: decision.score,
    reasonCodes,
    disclaimer: AGGREGATE_DISCLAIMER,
  }
}

function decide({ engine, typo, operationalReason }: AggregateInput): Decision {
  const { mx, smtp } = engine

  // 1. Unparseable address: nothing else is worth reporting.
  if (!engine.syntax.valid) {
    return { verdict: 'invalid', score: 0, reason: 'SYNTAX_INVALID' }
  }

  // 2. The MX lookup itself failed - the domain was never actually examined.
  if (mx.error !== '' || mx.has_mx === null) {
    return { verdict: 'unknown', score: 50, reason: 'MX_LOOKUP_UNAVAILABLE' }
  }

  // 3. Lookup succeeded and the domain advertises no mail servers.
  if (mx.has_mx === false) {
    return { verdict: 'invalid', score: 5, reason: 'DOMAIN_NO_MX' }
  }

  // Operational: the probe could not run. Hard invalid evidence above still
  // wins; everything below this point would only refine a probe that never
  // happened, so the honest verdict is unknown.
  if (operationalReason !== undefined) {
    return { verdict: 'unknown', score: 50, reason: operationalReason }
  }

  if (smtp !== null) {
    // 4. Catch-all domains accept everything; individual mailboxes are opaque.
    if (smtp.catch_all) {
      return { verdict: 'unknown', score: 50, reason: 'CATCH_ALL_DOMAIN' }
    }

    // 5. The probe errored - infrastructure, not evidence.
    if (smtp.error !== '') {
      return { verdict: 'unknown', score: 50, reason: 'SMTP_UNAVAILABLE' }
    }

    // 6. The engine refused to probe (SMTP disabled by policy).
    if (!smtp.attempted && smtp.disabled) {
      return { verdict: 'unknown', score: 50, reason: 'SMTP_NOT_CHECKED' }
    }

    if (smtp.attempted) {
      // 7. The server was asked and said no.
      if (!smtp.mailbox_accepted && !smtp.disabled) {
        return { verdict: 'invalid', score: 10, reason: 'MAILBOX_REJECTED' }
      }

      // 8. Accepting but out of space: deliverability is shaky.
      if (smtp.full_inbox) {
        return { verdict: 'risky', score: 45, reason: 'MAILBOX_FULL' }
      }

      // 9. The provider reports the mailbox disabled.
      if (smtp.disabled) {
        return { verdict: 'invalid', score: 10, reason: 'MAILBOX_DISABLED' }
      }
    }
  }

  // 10-12. Cautions that degrade an otherwise-working address to risky.
  if (engine.disposable) {
    return { verdict: 'risky', score: 50, reason: 'DISPOSABLE_DOMAIN' }
  }
  if (engine.role_account) {
    return { verdict: 'risky', score: 60, reason: 'ROLE_ACCOUNT' }
  }
  if (typo !== null) {
    return { verdict: 'risky', score: 65, reason: 'POSSIBLE_TYPO' }
  }

  // 13. Nothing wrong, but the mailbox itself was never probed.
  if (smtp === null) {
    return { verdict: 'unknown', score: 50, reason: 'SMTP_NOT_CHECKED' }
  }

  // 14. Every check that ran came back clean.
  return { verdict: 'valid', score: 95, reason: null }
}

/**
 * Secondary cautions, in fixed priority order, for risky/unknown results only.
 * Each is included when its signal is present and it is not already the
 * deciding reason. SMTP_NOT_CHECKED is appended when the mailbox genuinely was
 * not probed (no probe requested, or refused by policy).
 */
function secondaryReasons({ engine, typo }: AggregateInput, decision: Decision): ReasonCode[] {
  if (decision.verdict !== 'risky' && decision.verdict !== 'unknown') return []

  const candidates: Array<[ReasonCode, boolean]> = [
    ['DISPOSABLE_DOMAIN', engine.disposable],
    ['ROLE_ACCOUNT', engine.role_account],
    ['POSSIBLE_TYPO', typo !== null],
    ['SMTP_NOT_CHECKED', engine.smtp === null || (!engine.smtp.attempted && engine.smtp.disabled)],
  ]

  return candidates
    .filter(([code, applies]) => applies && code !== decision.reason)
    .map(([code]) => code)
}
