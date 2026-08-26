import { aggregate, detectTypo, type ReasonCode, type Verdict } from '../src/index.js'
import { buildCorpus, type Fixture } from './corpus.js'

/**
 * Runs the REAL local aggregation pipeline over the corpus and scores it.
 *
 * Per fixture the pipeline is exactly what the API/worker run: derive the typo
 * signal with detectTypo() from the stubbed engine's domain, then aggregate()
 * the engine response (plus any operational reason). No network, no engine
 * process - the engine response is the stub. Because the corpus is synthetic
 * and its labels are written independently of aggregate(), every fixture must
 * match exactly; any mismatch is a logic regression.
 */

export type Mismatch = {
  email: string
  category: string
  expectedVerdict: Verdict
  actualVerdict: Verdict
  expectedReasonCodes: ReasonCode[]
  actualReasonCodes: ReasonCode[]
}

export const VERDICTS: readonly Verdict[] = ['valid', 'risky', 'unknown', 'invalid']

// Email-relevant reason codes only (phone codes are out of this corpus's scope).
export const EMAIL_REASON_CODES: readonly ReasonCode[] = [
  'SYNTAX_INVALID',
  'DOMAIN_NO_MX',
  'MX_LOOKUP_UNAVAILABLE',
  'CATCH_ALL_DOMAIN',
  'SMTP_UNAVAILABLE',
  'MAILBOX_REJECTED',
  'MAILBOX_FULL',
  'MAILBOX_DISABLED',
  'DISPOSABLE_DOMAIN',
  'ROLE_ACCOUNT',
  'POSSIBLE_TYPO',
  'SMTP_NOT_CHECKED',
  'SMTP_DISABLED',
  'CIRCUIT_OPEN',
]

export type ReasonMetric = { code: ReasonCode; tp: number; fp: number; fn: number }

export type ScoreResult = {
  total: number
  passed: number
  mismatches: Mismatch[]
  /** matrix[expected][actual] = count. */
  confusion: Record<Verdict, Record<Verdict, number>>
  reasonMetrics: ReasonMetric[]
}

function runFixture(fixture: Fixture): { verdict: Verdict; reasonCodes: ReasonCode[] } {
  const typo = detectTypo(fixture.stubbedEngineResponse.syntax.domain)
  const result = aggregate({
    engine: fixture.stubbedEngineResponse,
    typo,
    ...(fixture.operationalReason !== undefined
      ? { operationalReason: fixture.operationalReason }
      : {}),
  })
  return { verdict: result.verdict, reasonCodes: result.reasonCodes }
}

function arraysEqual(a: readonly ReasonCode[], b: readonly ReasonCode[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function scoreCorpus(fixtures: Fixture[] = buildCorpus()): ScoreResult {
  const confusion = Object.fromEntries(
    VERDICTS.map((expected) => [
      expected,
      Object.fromEntries(VERDICTS.map((actual) => [actual, 0])) as Record<Verdict, number>,
    ]),
  ) as Record<Verdict, Record<Verdict, number>>

  const metrics = new Map<ReasonCode, ReasonMetric>(
    EMAIL_REASON_CODES.map((code) => [code, { code, tp: 0, fp: 0, fn: 0 }]),
  )
  const mismatches: Mismatch[] = []
  let passed = 0

  for (const fixture of fixtures) {
    const actual = runFixture(fixture)
    confusion[fixture.expectedVerdict][actual.verdict] += 1

    const verdictOk = actual.verdict === fixture.expectedVerdict
    const reasonsOk = arraysEqual(actual.reasonCodes, fixture.expectedReasonCodes)
    if (verdictOk && reasonsOk) {
      passed += 1
    } else {
      mismatches.push({
        email: fixture.email,
        category: fixture.category,
        expectedVerdict: fixture.expectedVerdict,
        actualVerdict: actual.verdict,
        expectedReasonCodes: fixture.expectedReasonCodes,
        actualReasonCodes: actual.reasonCodes,
      })
    }

    // Per-reason set-wise scoring (order-independent), for precision/recall.
    const expectedSet = new Set(fixture.expectedReasonCodes)
    const actualSet = new Set(actual.reasonCodes)
    for (const code of EMAIL_REASON_CODES) {
      const metric = metrics.get(code) as ReasonMetric
      const inExpected = expectedSet.has(code)
      const inActual = actualSet.has(code)
      if (inExpected && inActual) metric.tp += 1
      else if (!inExpected && inActual) metric.fp += 1
      else if (inExpected && !inActual) metric.fn += 1
    }
  }

  return {
    total: fixtures.length,
    passed,
    mismatches,
    confusion,
    reasonMetrics: [...metrics.values()],
  }
}

export function precision(metric: ReasonMetric): number | null {
  const denominator = metric.tp + metric.fp
  return denominator === 0 ? null : metric.tp / denominator
}

export function recall(metric: ReasonMetric): number | null {
  const denominator = metric.tp + metric.fn
  return denominator === 0 ? null : metric.tp / denominator
}
