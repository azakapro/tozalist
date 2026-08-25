import { DelayedError, UnrecoverableError, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEmailCheckForProcessing, type DatabaseClient } from '@tozalist/db'
import { EngineHttpError, EngineTimeoutError, type EngineResponse } from '@tozalist/shared'
import { DomainCircuit } from './domain-circuit.js'
import { MxThrottle } from './throttle.js'
import { createSmtpProbeProcessor, primaryMxHost, type ProcessorDeps } from './processor.js'
import type { EngineVerifier, SmtpProbeJobData } from './types.js'
import {
  captureLogger,
  connectTestDb,
  connectTestRedis,
  createOrg,
  engineSnapshot,
  hasIntegrationEnv,
  insertEmailCheck,
  uniqueName,
} from '../test/support.js'

/**
 * Processor-level integration tests: real Redis, real test database, mocked
 * engine. No BullMQ machinery - the job is a minimal stub, which keeps every
 * scenario deterministic.
 */

type StubJob = Job<SmtpProbeJobData> & { delayedTo: number[] }

function stubJob(emailCheckId: string): StubJob {
  const job = {
    data: { emailCheckId },
    attemptsMade: 0,
    delayedTo: [] as number[],
    moveToDelayed(timestamp: number, _token?: string) {
      job.delayedTo.push(timestamp)
      return Promise.resolve()
    },
  }
  return job as unknown as StubJob
}

/** An engine mock whose behaviour is scripted per call. */
function scriptedEngine(script: Array<'ok' | 'timeout' | '500' | '400' | 'contract'>): {
  engine: EngineVerifier
  calls: number[]
  instantiations: number
  factory: () => EngineVerifier
} {
  let call = 0
  const state = {
    calls: [] as number[],
    instantiations: 0,
  }
  const engine: EngineVerifier = {
    verify(_email, _opts): Promise<EngineResponse> {
      state.calls.push(call)
      const step = script[Math.min(call, script.length - 1)]
      call += 1
      switch (step) {
        case 'ok':
          return Promise.resolve(
            engineSnapshot({
              smtp: {
                attempted: true,
                mailbox_accepted: true,
                catch_all: false,
                full_inbox: false,
                disabled: false,
                error: '',
              },
            }),
          )
        case 'timeout':
          return Promise.reject(new EngineTimeoutError(20_000))
        case '500':
          return Promise.reject(new EngineHttpError(503))
        case '400':
          return Promise.reject(new EngineHttpError(400))
        default:
          return Promise.reject(new Error('unscripted'))
      }
    },
  }
  const result = {
    engine,
    factory: () => {
      result.instantiations += 1
      return engine
    },
    get calls() {
      return state.calls
    },
    instantiations: 0,
  }
  Object.defineProperty(result, 'instantiations', {
    get: () => state.instantiations,
  })
  const factory = () => {
    state.instantiations += 1
    return engine
  }
  result.factory = factory
  return result as typeof result & { calls: number[]; instantiations: number }
}

describe.skipIf(!hasIntegrationEnv)('smtp probe processor', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let orgId: string

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    orgId = await createOrg(db)
  })

  afterAll(async () => {
    await redis.quit()
    await sqlEnd()
  })

  function makeDeps(overrides: Partial<ProcessorDeps> = {}): {
    deps: ProcessorDeps
    logs: ReturnType<typeof captureLogger>['lines']
  } {
    const captured = captureLogger()
    const prefix = `${uniqueName('proc')}:`
    const deps: ProcessorDeps = {
      db,
      throttle: new MxThrottle({ redis, keyPrefix: `${prefix}throttle:` }),
      circuit: new DomainCircuit({ redis, keyPrefix: `${prefix}circuit:` }),
      logger: captured.logger,
      smtpEnabled: true,
      getEngine: () => {
        throw new Error('engine must not be requested in this test')
      },
      ...overrides,
    }
    return { deps, logs: captured.lines }
  }

  async function readRow(id: string) {
    const row = await getEmailCheckForProcessing(db, id)
    if (row === undefined) throw new Error('row vanished')
    return row.check
  }

  // --- 1. SMTP disabled -----------------------------------------------------

  it('SMTP disabled: zero engine usage, unknown with SMTP_DISABLED written', async () => {
    const scripted = scriptedEngine(['ok'])
    const checkId = await insertEmailCheck(db, orgId, engineSnapshot({ role_account: true }))
    const { deps } = makeDeps({ smtpEnabled: false, getEngine: scripted.factory })

    await createSmtpProbeProcessor(deps)(stubJob(checkId), 'token')

    expect(scripted.instantiations).toBe(0)
    expect(scripted.calls).toHaveLength(0)

    const row = await readRow(checkId)
    expect(row.verdict).toBe('unknown')
    expect(row.reasonCodes[0]).toBe('SMTP_DISABLED')
    expect(row.reasonCodes).toContain('ROLE_ACCOUNT')
    expect(row.cached).toBe(false)
  })

  // --- 6-10. domain circuit -------------------------------------------------

  it('opens the domain circuit after three consecutive eligible failures', async () => {
    const scripted = scriptedEngine(['timeout', '500', 'contract'])
    const engine = engineSnapshot({
      syntax: { valid: true, username: 'user', domain: uniqueName('cb') + '.test' },
    })
    const { deps } = makeDeps({ getEngine: scripted.factory })
    const process = createSmtpProbeProcessor(deps)

    for (let i = 0; i < 3; i++) {
      const checkId = await insertEmailCheck(db, orgId, engine)
      await process(stubJob(checkId), 'token')
      const row = await readRow(checkId)
      // Eligible failure before the circuit opens: unknown + SMTP_UNAVAILABLE.
      expect(row.verdict).toBe('unknown')
      expect(row.reasonCodes[0]).toBe('SMTP_UNAVAILABLE')
    }

    expect(await deps.circuit.isOpen(engine.syntax.domain)).toBe(true)

    // 7. Open circuit: zero engine calls, CIRCUIT_OPEN written.
    const skippedId = await insertEmailCheck(db, orgId, engine)
    const callsBefore = scripted.calls.length
    await process(stubJob(skippedId), 'token')

    expect(scripted.calls.length).toBe(callsBefore)
    const row = await readRow(skippedId)
    expect(row.verdict).toBe('unknown')
    expect(row.reasonCodes[0]).toBe('CIRCUIT_OPEN')
  })

  it('a successful probe resets the failure streak', async () => {
    const scripted = scriptedEngine(['timeout', 'timeout', 'ok', 'timeout', 'timeout'])
    const engine = engineSnapshot({
      syntax: { valid: true, username: 'user', domain: uniqueName('reset') + '.test' },
    })
    const { deps } = makeDeps({ getEngine: scripted.factory })
    const process = createSmtpProbeProcessor(deps)

    for (let i = 0; i < 5; i++) {
      const checkId = await insertEmailCheck(db, orgId, engine)
      await process(stubJob(checkId), 'token')
    }

    // Two failures, a success (reset), two failures: never three consecutive.
    expect(await deps.circuit.isOpen(engine.syntax.domain)).toBe(false)
  })

  it('the circuit closes again after its configured duration', async () => {
    const engine = engineSnapshot({
      syntax: { valid: true, username: 'user', domain: uniqueName('reopen') + '.test' },
    })
    const prefix = `${uniqueName('short')}:`
    const circuit = new DomainCircuit({ redis, keyPrefix: prefix, threshold: 1, openMs: 300 })

    await circuit.recordFailure(engine.syntax.domain)
    expect(await circuit.isOpen(engine.syntax.domain)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(await circuit.isOpen(engine.syntax.domain)).toBe(false)
  })

  it('HTTP 4xx neither opens the circuit nor counts toward it', async () => {
    const scripted = scriptedEngine(['400', '400', '400', '400'])
    const engine = engineSnapshot({
      syntax: { valid: true, username: 'user', domain: uniqueName('4xx') + '.test' },
    })
    const { deps } = makeDeps({
      getEngine: scripted.factory,
      circuit: new DomainCircuit({ redis, keyPrefix: `${uniqueName('4xx')}:`, threshold: 3 }),
    })
    const process = createSmtpProbeProcessor(deps)

    for (let i = 0; i < 4; i++) {
      const checkId = await insertEmailCheck(db, orgId, engine)
      await process(stubJob(checkId), 'token')
      const row = await readRow(checkId)
      expect(row.verdict).toBe('unknown')
    }

    expect(scripted.calls.length).toBe(4)
    expect(await deps.circuit.isOpen(engine.syntax.domain)).toBe(false)
  })

  // --- 11. fresh output stored ----------------------------------------------

  it('aggregates and stores fresh engine output', async () => {
    const scripted = scriptedEngine(['ok'])
    const engine = engineSnapshot()
    const checkId = await insertEmailCheck(db, orgId, engine)
    const { deps } = makeDeps({ getEngine: scripted.factory })

    await createSmtpProbeProcessor(deps)(stubJob(checkId), 'token')

    const row = await readRow(checkId)
    expect(row.verdict).toBe('valid')
    expect(row.reasonCodes).toEqual([])
    expect(row.cached).toBe(false)
    const stored = row.checksJson as { engine: EngineResponse }
    expect(stored.engine.smtp?.mailbox_accepted).toBe(true)
    expect(scripted.calls.length).toBe(1)
  })

  // --- throttled path (processor side) ---------------------------------------

  it('a busy MX host moves the job to delayed and throws DelayedError', async () => {
    const scripted = scriptedEngine(['ok'])
    const engine = engineSnapshot()
    const host = primaryMxHost(engine)
    if (host === null) throw new Error('fixture must have an MX host')

    const prefix = `${uniqueName('busy')}:`
    const throttle = new MxThrottle({ redis, keyPrefix: prefix })
    const { deps } = makeDeps({ getEngine: scripted.factory, throttle })

    // Occupy the host slot as if another worker held it.
    const holder = await throttle.acquire(host)
    if (!holder.allowed) throw new Error('setup lease should have succeeded')

    const checkId = await insertEmailCheck(db, orgId, engine)
    const job = stubJob(checkId)

    await expect(createSmtpProbeProcessor(deps)(job, 'token')).rejects.toBeInstanceOf(DelayedError)
    expect(job.delayedTo).toHaveLength(1)
    expect(scripted.calls).toHaveLength(0)

    await throttle.release(host, holder.leaseToken)
  })

  // --- unusable rows ----------------------------------------------------------

  it('fails non-retryably and safely for a missing row', async () => {
    const { deps, logs } = makeDeps({ smtpEnabled: false })
    const process = createSmtpProbeProcessor(deps)
    const ghost = '00000000-0000-4000-8000-00000000dead'

    await expect(process(stubJob(ghost), 'token')).rejects.toBeInstanceOf(UnrecoverableError)
    expect(JSON.stringify(logs)).not.toContain('@')
  })

  it('fails non-retryably for a malformed stored snapshot', async () => {
    const checkId = await insertEmailCheck(db, orgId, engineSnapshot(), {
      checksJson: { engine: { nonsense: true } },
    })
    const { deps } = makeDeps({ smtpEnabled: false })

    await expect(createSmtpProbeProcessor(deps)(stubJob(checkId), 'token')).rejects.toBeInstanceOf(
      UnrecoverableError,
    )
  })

  it('resolves a snapshot without MX records from stored data, without probing', async () => {
    const scripted = scriptedEngine(['ok'])
    const engine = engineSnapshot({ mx: { has_mx: false, records: [], error: '' } })
    const checkId = await insertEmailCheck(db, orgId, engine)
    const { deps } = makeDeps({ getEngine: scripted.factory })

    await createSmtpProbeProcessor(deps)(stubJob(checkId), 'token')

    expect(scripted.calls).toHaveLength(0)
    const row = await readRow(checkId)
    expect(row.verdict).toBe('invalid')
    expect(row.reasonCodes).toEqual(['DOMAIN_NO_MX'])
  })

  // --- 12. privacy ------------------------------------------------------------

  it('captured logs never contain the email or local part, on any path', async () => {
    const email = 'Very.Secret.Person@log-privacy.test'
    const engine = engineSnapshot({
      email,
      syntax: { valid: true, username: 'Very.Secret.Person', domain: 'log-privacy.test' },
    })

    const paths: Array<{ script: Parameters<typeof scriptedEngine>[0]; smtpEnabled: boolean }> = [
      { script: ['ok'], smtpEnabled: true },
      { script: ['timeout'], smtpEnabled: true },
      { script: ['400'], smtpEnabled: true },
      { script: ['ok'], smtpEnabled: false },
    ]

    for (const path of paths) {
      const scripted = scriptedEngine(path.script)
      const { deps, logs } = makeDeps({
        smtpEnabled: path.smtpEnabled,
        getEngine: scripted.factory,
      })
      const checkId = await insertEmailCheck(db, orgId, engine)
      await createSmtpProbeProcessor(deps)(stubJob(checkId), 'token')

      const raw = JSON.stringify(logs)
      expect(raw).not.toContain(email)
      expect(raw).not.toContain('Very.Secret.Person')
      expect(raw).toContain('log-privacy.test')
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({ domain: 'log-privacy.test' })
      expect(typeof logs[0]?.duration_ms).toBe('number')
      expect(typeof logs[0]?.retry_count).toBe('number')
    }
  })

  it('primaryMxHost lowercases and strips the trailing dot', () => {
    expect(primaryMxHost(engineSnapshot())).toBe('mx1.snapshot.test')
    expect(
      primaryMxHost(engineSnapshot({ mx: { has_mx: true, records: [], error: '' } })),
    ).toBeNull()
  })
})
