import { DelayedError, UnrecoverableError, type Job } from 'bullmq'
import type pino from 'pino'
import { aggregate, detectTypo, type EngineResponse } from '@tozalist/core'
import {
  getEmailCheckForProcessing,
  updateEmailCheckResult,
  type DatabaseClient,
} from '@tozalist/db'
import { EngineHttpError, engineResponseSchema, emailLogFields } from '@tozalist/shared'
import type { DomainCircuit } from './domain-circuit.js'
import type { MxThrottle } from './throttle.js'
import type { EngineVerifier, SmtpProbeJobData, StoredEmailCheck } from './types.js'

/**
 * The SMTP probe processor.
 *
 * Privacy rules enforced here: job data carries only the row ID; the email is
 * loaded from PostgreSQL immediately before use; log lines and error messages
 * carry the domain and a local-part hash at most, never the address.
 */

export type ProcessorDeps = {
  db: DatabaseClient
  throttle: MxThrottle
  circuit: DomainCircuit
  logger: pino.Logger
  smtpEnabled: boolean
  /**
   * Lazy engine factory: with SMTP disabled (or a circuit open) it is never
   * invoked, so no EngineClient is even instantiated for those jobs.
   */
  getEngine: () => EngineVerifier
  clock?: () => number
}

type JobOutcome =
  | 'ok'
  | 'smtp_disabled'
  | 'circuit_open'
  | 'throttled'
  | 'engine_failure'
  | 'engine_rejected'
  | 'no_mx_host'
  | 'row_unavailable'
  | 'invalid_snapshot'

export function createSmtpProbeProcessor(deps: ProcessorDeps) {
  const clock = deps.clock ?? Date.now

  return async function processSmtpProbe(
    job: Job<SmtpProbeJobData>,
    token?: string,
  ): Promise<void> {
    const started = clock()
    let logDomain = ''

    const finish = (outcome: JobOutcome): void => {
      deps.logger.info({
        domain: logDomain,
        outcome,
        duration_ms: clock() - started,
        retry_count: job.attemptsMade,
      })
    }

    // 1. Load the row; everything personal lives in PostgreSQL, not the job.
    const row = await getEmailCheckForProcessing(deps.db, job.data.emailCheckId)
    if (row === undefined || row.orgDeletedAt !== null || row.check.expiresAt <= new Date()) {
      finish('row_unavailable')
      throw new UnrecoverableError('email check row is missing, expired, or organisation deleted')
    }

    const snapshot = parseStoredChecks(row.check.checksJson)
    if (snapshot === null) {
      finish('invalid_snapshot')
      throw new UnrecoverableError('stored engine snapshot does not match the engine contract')
    }

    const engineSnapshot = snapshot.engine
    const email = row.check.emailNormalized
    const domain = engineSnapshot.syntax.domain
    logDomain = domain

    // Every terminal outcome writes a COMPLETE snapshot: engine data, score,
    // disclaimer, typo and smtp_status 'complete', so polling clients see a
    // consistent finished check. Throttled/delayed jobs write nothing and the
    // stored status stays 'pending'.
    const writeResult = async (
      engine: EngineResponse,
      operationalReason?: 'SMTP_DISABLED' | 'CIRCUIT_OPEN',
    ): Promise<void> => {
      const typo = detectTypo(engine.syntax.domain)
      const aggregated = aggregate({
        engine,
        typo,
        ...(operationalReason !== undefined ? { operationalReason } : {}),
      })
      await updateEmailCheckResult(deps.db, row.check.id, {
        verdict: aggregated.verdict,
        reasonCodes: aggregated.reasonCodes,
        checksJson: {
          engine,
          score: aggregated.score,
          disclaimer: aggregated.disclaimer,
          typo,
          smtp_status: 'complete',
          ...(operationalReason !== undefined ? { operational_reason: operationalReason } : {}),
        } satisfies StoredEmailCheck,
        cached: false,
      })
    }

    // 2. SMTP switched off: re-aggregate the stored snapshot; no engine at all.
    if (!deps.smtpEnabled) {
      await writeResult(engineSnapshot, 'SMTP_DISABLED')
      finish('smtp_disabled')
      return
    }

    // 3. Per-domain circuit: skip a domain that keeps failing.
    if (await deps.circuit.isOpen(domain)) {
      await writeResult(engineSnapshot, 'CIRCUIT_OPEN')
      finish('circuit_open')
      return
    }

    // A probe needs a destination. Without an MX host the stored snapshot is
    // already the whole truth - re-aggregate it and finish.
    const mxHost = primaryMxHost(engineSnapshot)
    if (mxHost === null) {
      await writeResult(engineSnapshot)
      finish('no_mx_host')
      return
    }

    // 4. Per-MX-host throttle: 1 concurrent, 5 per rolling minute.
    const lease = await deps.throttle.acquire(mxHost)
    if (!lease.allowed) {
      finish('throttled')
      await job.moveToDelayed(clock() + lease.retryDelayMs, token)
      throw new DelayedError()
    }

    try {
      // 5. The probe itself.
      let fresh: EngineResponse
      try {
        fresh = await deps.getEngine().verify(email, { smtp: true, catchAll: true })
      } catch (error) {
        if (error instanceof EngineHttpError && error.status < 500) {
          // Our request was malformed - a bug, not domain health. Resolve the
          // row from the stored snapshot and do not touch the circuit.
          await writeUnavailable(deps.db, row.check.id, engineSnapshot)
          finish('engine_rejected')
          return
        }

        // Eligible failure: unavailable, timeout, 5xx, contract drift.
        await deps.circuit.recordFailure(domain)
        await writeUnavailable(deps.db, row.check.id, engineSnapshot)
        finish('engine_failure')
        return
      }

      await deps.circuit.recordSuccess(domain)
      await writeResult(fresh)
      finish('ok')
    } finally {
      // 6. Always hand the host slot back, even on failure paths.
      await deps.throttle.release(mxHost, lease.leaseToken)
    }
  }
}

/**
 * Resolves the row as unknown with an SMTP-unavailable signal. The stored
 * snapshot is re-aggregated with a synthetic errored SMTP object so the
 * existing rule 5 (SMTP_UNAVAILABLE) decides; the snapshot persisted back is
 * the ORIGINAL one - no foreign error text and no fabricated probe data is
 * ever stored.
 */
async function writeUnavailable(
  db: DatabaseClient,
  id: string,
  engineSnapshot: EngineResponse,
): Promise<void> {
  const typo = detectTypo(engineSnapshot.syntax.domain)
  const aggregated = aggregate({
    engine: {
      ...engineSnapshot,
      smtp: {
        attempted: true,
        mailbox_accepted: false,
        catch_all: false,
        full_inbox: false,
        disabled: false,
        error: 'engine unavailable',
      },
    },
    typo,
  })

  await updateEmailCheckResult(db, id, {
    verdict: aggregated.verdict,
    reasonCodes: aggregated.reasonCodes,
    checksJson: {
      engine: engineSnapshot,
      score: aggregated.score,
      disclaimer: aggregated.disclaimer,
      typo,
      // Terminal: the probe was attempted and the engine was unavailable.
      smtp_status: 'complete',
    } satisfies StoredEmailCheck,
    cached: false,
  })
}

/**
 * Validates the stored engine object strictly before trusting it. The rest of
 * the snapshot (score, status, ...) is API-owned presentation state the worker
 * recomputes anyway, so it is not required here - but the engine contract is.
 */
function parseStoredChecks(value: unknown): { engine: EngineResponse } | null {
  if (typeof value !== 'object' || value === null || !('engine' in value)) return null

  const parsed = engineResponseSchema.safeParse((value as { engine: unknown }).engine)
  return parsed.success ? { engine: parsed.data } : null
}

/** First MX record, lowercased, without the trailing FQDN dot. */
export function primaryMxHost(engine: EngineResponse): string | null {
  const first = engine.mx.records[0]
  if (first === undefined || first.trim() === '') return null

  const host = first.trim().toLowerCase().replace(/\.$/, '')
  return host === '' ? null : host
}

/** Re-exported so callers can build privacy-safe ad-hoc log fields. */
export { emailLogFields }
