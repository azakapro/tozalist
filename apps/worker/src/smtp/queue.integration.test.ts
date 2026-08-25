import type { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Queue, Worker } from 'bullmq'
import { getEmailCheckForProcessing, type DatabaseClient } from '@tozalist/db'
import type { EngineResponse } from '@tozalist/shared'
import { DomainCircuit } from './domain-circuit.js'
import { MxThrottle } from './throttle.js'
import { buildSmtpQueue, buildSmtpWorker, shutdownWorker } from './worker.js'
import type { EngineVerifier, SmtpProbeJobData } from './types.js'
import { buildConnectionOptions } from '../connection.js'
import {
  captureLogger,
  connectTestDb,
  connectTestRedis,
  createOrg,
  engineSnapshot,
  hasIntegrationEnv,
  insertEmailCheck,
  testRedisUrl,
  uniqueName,
  waitFor,
} from '../test/support.js'

/**
 * Queue-level integration tests: a real BullMQ worker against real Redis, so
 * the delayed-state mechanics (moveToDelayed + DelayedError) are exercised for
 * real. The engine stays mocked; nothing touches DNS or SMTP.
 */

function okEngineResponse(): EngineResponse {
  return engineSnapshot({
    smtp: {
      attempted: true,
      mailbox_accepted: true,
      catch_all: false,
      full_inbox: false,
      disabled: false,
      error: '',
    },
  })
}

describe.skipIf(!hasIntegrationEnv)('smtp probe queue', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let orgId: string
  const cleanups: Array<() => Promise<unknown>> = []

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    orgId = await createOrg(db)
  })

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.()
    }
  })

  afterAll(async () => {
    await redis.quit()
    await sqlEnd()
  })

  function startWorker(options: {
    engine: EngineVerifier
    throttle?: MxThrottle
    concurrency?: number
  }): {
    worker: Worker<SmtpProbeJobData>
    queue: Queue<SmtpProbeJobData>
    queueName: string
    logs: Array<Record<string, unknown>>
  } {
    const queueName = uniqueName('queue')
    const prefix = `${queueName}:`
    const connection = buildConnectionOptions(testRedisUrl())
    const captured = captureLogger()

    const worker = buildSmtpWorker({
      queueName,
      connection,
      concurrency: options.concurrency ?? 10,
      deps: {
        db,
        throttle: options.throttle ?? new MxThrottle({ redis, keyPrefix: `${prefix}throttle:` }),
        circuit: new DomainCircuit({ redis, keyPrefix: `${prefix}circuit:` }),
        logger: captured.logger,
        smtpEnabled: true,
        getEngine: () => options.engine,
      },
    })
    const queue = buildSmtpQueue(connection, queueName)

    cleanups.push(async () => {
      await worker.close(true)
      await queue.obliterate({ force: true }).catch(() => undefined)
      await queue.close()
    })

    return { worker, queue, queueName, logs: captured.lines }
  }

  async function verdictWritten(id: string): Promise<boolean> {
    const row = await getEmailCheckForProcessing(db, id)
    return (
      row !== undefined && row.check.reasonCodes.length + Number(row.check.verdict === 'valid') > 0
    )
  }

  // --- 2 + 5. concurrency per host and across hosts ---------------------------

  it('one MX host never has more than one active probe; hosts run independently', async () => {
    const active = new Map<string, number>()
    const peaks = new Map<string, number>()
    let concurrentHosts = 0

    const engine: EngineVerifier = {
      async verify(email) {
        const domain = email.slice(email.lastIndexOf('@') + 1)
        active.set(domain, (active.get(domain) ?? 0) + 1)
        peaks.set(domain, Math.max(peaks.get(domain) ?? 0, active.get(domain) ?? 0))
        concurrentHosts = Math.max(
          concurrentHosts,
          [...active.values()].filter((n) => n > 0).length,
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
        active.set(domain, (active.get(domain) ?? 0) - 1)
        return okEngineResponse()
      },
    }

    const { queue } = startWorker({ engine })

    const ids: string[] = []
    for (const host of ['host-a.test', 'host-b.test']) {
      for (let i = 0; i < 2; i++) {
        const snapshot = engineSnapshot({
          email: `user@${host}`,
          syntax: { valid: true, username: 'user', domain: host },
          mx: { has_mx: true, records: [`mx.${host}.`], error: '' },
        })
        ids.push(await insertEmailCheck(db, orgId, snapshot))
      }
    }
    for (const id of ids) {
      await queue.add('probe', { emailCheckId: id })
    }

    await waitFor(async () => {
      for (const id of ids) {
        if (!(await verdictWritten(id))) return false
      }
      return true
    }, 25_000)

    expect(peaks.get('host-a.test')).toBe(1)
    expect(peaks.get('host-b.test')).toBe(1)
    // 5. While each host is serialised, the two hosts overlapped.
    expect(concurrentHosts).toBeGreaterThanOrEqual(2)
  })

  // --- 3 + 4. sliding window: sixth job delayed, then eventually runs ---------

  it('the sixth probe within the window is delayed, never dropped, and runs later', async () => {
    let engineCalls = 0
    const engine: EngineVerifier = {
      verify: () => {
        engineCalls += 1
        return Promise.resolve(okEngineResponse())
      },
    }

    const queueName = uniqueName('window')
    const throttle = new MxThrottle({
      redis,
      keyPrefix: `${queueName}:throttle:`,
      windowLimit: 5,
      windowMs: 3_000,
    })
    const { queue, logs } = startWorker({ engine, throttle })

    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      ids.push(await insertEmailCheck(db, orgId, engineSnapshot()))
    }
    const jobs = []
    for (const id of ids) {
      jobs.push(await queue.add('probe', { emailCheckId: id }))
    }

    // The first five drain within the window; the sixth must be throttled into
    // the delayed state at least once. The 'throttled' outcome event is written
    // immediately before moveToDelayed, so it cannot be missed by polling.
    void jobs

    await waitFor(async () => {
      for (const id of ids) {
        if (!(await verdictWritten(id))) return false
      }
      return true
    }, 25_000)

    const throttledEvents = logs.filter((line) => line.outcome === 'throttled')
    expect(throttledEvents.length).toBeGreaterThanOrEqual(1)
    expect(engineCalls).toBe(6)

    // Nothing was dropped: every row got its verdict.
    for (const id of ids) {
      const row = await getEmailCheckForProcessing(db, id)
      expect(row?.check.verdict).toBe('valid')
    }
  })

  // --- single log event per job, including failures ---------------------------

  it('a failed job path emits exactly one processor outcome event and nothing leaks', async () => {
    const email = 'Very.Secret.Person@one-event.test'
    const engine: EngineVerifier = {
      verify: () =>
        Promise.reject(
          // A hostile-ish foreign error carrying the email and a fake password.
          new Error(`probe exploded for ${email} via redis://user:hunter2@10.0.0.1:6379`),
        ),
    }

    const { queue, worker, logs } = startWorker({ engine, concurrency: 1 })
    const snapshot = engineSnapshot({
      email,
      syntax: { valid: true, username: 'Very.Secret.Person', domain: 'one-event.test' },
    })
    const checkId = await insertEmailCheck(db, orgId, snapshot)
    const job = await queue.add('probe', { emailCheckId: checkId })

    // Wait for BullMQ to consider the job finished (completed here: an engine
    // failure resolves the row rather than failing the job).
    await waitFor(async () => (await verdictWritten(checkId)) === true, 20_000)
    await waitFor(async () => {
      const state = await job.getState()
      return state === 'completed' || state === 'failed'
    }, 20_000)
    // Let any queue-level listeners that might exist fire before auditing.
    await new Promise((resolve) => setTimeout(resolve, 250))

    const outcomeEvents = logs.filter((line) => line.outcome !== undefined)
    expect(outcomeEvents).toHaveLength(1)
    expect(outcomeEvents[0]).toMatchObject({ domain: 'one-event.test', outcome: 'engine_failure' })
    expect(logs).toHaveLength(1)

    const raw = JSON.stringify(logs)
    expect(raw).not.toContain(email)
    expect(raw).not.toContain('Very.Secret.Person')
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('probe exploded')
    expect(raw).not.toContain(checkId)
    for (const line of logs) {
      expect(line).not.toHaveProperty('job_id')
      expect(line).not.toHaveProperty('email_check_id')
      expect(line).not.toHaveProperty('error')
    }
    void worker
    void job
  })

  it('an unrecoverable (truly failed) job emits exactly one outcome event', async () => {
    const engine: EngineVerifier = {
      verify: () => Promise.reject(new Error('never reached')),
    }
    const { queue, logs } = startWorker({ engine, concurrency: 1 })

    // A job pointing at a row that does not exist: the processor fails it
    // non-retryably, which is the path the old worker-level listener logged.
    const ghost = '00000000-0000-4000-8000-00000000feed'
    const job = await queue.add('probe', { emailCheckId: ghost })

    await waitFor(async () => (await job.getState()) === 'failed', 20_000)
    await new Promise((resolve) => setTimeout(resolve, 250))

    const outcomeEvents = logs.filter((line) => line.outcome !== undefined)
    expect(outcomeEvents).toHaveLength(1)
    expect(outcomeEvents[0]).toMatchObject({ outcome: 'row_unavailable' })
    expect(logs).toHaveLength(1)

    const raw = JSON.stringify(logs)
    expect(raw).not.toContain(ghost)
    expect(raw).not.toContain('@')
    for (const line of logs) {
      expect(line).not.toHaveProperty('job_id')
      expect(line).not.toHaveProperty('email_check_id')
      expect(line).not.toHaveProperty('error')
    }
    void job
  })

  // --- 13. graceful shutdown ---------------------------------------------------

  it('graceful shutdown drains the active job and closes cleanly', async () => {
    let started = false
    const engine: EngineVerifier = {
      async verify() {
        started = true
        await new Promise((resolve) => setTimeout(resolve, 700))
        return okEngineResponse()
      },
    }

    const { worker, queue } = startWorker({ engine, concurrency: 1 })
    const checkId = await insertEmailCheck(db, orgId, engineSnapshot())
    await queue.add('probe', { emailCheckId: checkId })

    await waitFor(() => started, 10_000)

    const captured = captureLogger()
    const result = await shutdownWorker(worker, captured.logger, 10_000)

    expect(result).toBe('drained')
    // The active job finished during the drain and its verdict landed.
    const row = await getEmailCheckForProcessing(db, checkId)
    expect(row?.check.verdict).toBe('valid')
  })

  it('shutdown that exceeds the drain limit logs a safe event and force-closes', async () => {
    let started = false
    const engine: EngineVerifier = {
      async verify() {
        started = true
        await new Promise((resolve) => setTimeout(resolve, 5_000))
        return okEngineResponse()
      },
    }

    const { worker, queue } = startWorker({ engine, concurrency: 1 })
    const checkId = await insertEmailCheck(db, orgId, engineSnapshot())
    await queue.add('probe', { emailCheckId: checkId })
    await waitFor(() => started, 10_000)

    const captured = captureLogger()
    const result = await shutdownWorker(worker, captured.logger, 300)

    expect(result).toBe('timed_out')
    const raw = JSON.stringify(captured.lines)
    expect(raw).toContain('shutdown drain timeout exceeded')
    expect(raw).not.toContain('@')
  })
})
