import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Job } from 'bullmq'
import {
  createBatchWithReservation,
  createWebhookEndpoint,
  creditLedger,
  deleteBatchForOrg,
  emailChecks,
  getBatchForProcessing,
  getCreditBalance,
  insertBatchEmailChecks,
  webhookDeliveries,
  type DatabaseClient,
} from '@tozalist/db'
import {
  batchInputKey,
  type BatchProcessJobData,
  type BatchStats,
  type ObjectStorage,
} from '@tozalist/shared'
import { createBatchProcessor } from './processor.js'
import type { EngineVerifier } from '../smtp/types.js'
import {
  captureLogger,
  connectTestDb,
  connectTestStorage,
  createOrg,
  engineSnapshot,
  hasIntegrationEnv,
  readObject,
} from '../test/support.js'

/** Engine stub: instant, deterministic verdicts derived from the address. */
function batchEngine(): EngineVerifier & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    verify(email) {
      calls.push(email)
      const at = email.lastIndexOf('@')
      const domain = at >= 0 ? email.slice(at + 1) : ''
      const username = at >= 0 ? email.slice(0, at) : email
      return Promise.resolve(
        engineSnapshot({
          email,
          syntax: { valid: at > 0 && domain !== '', username, domain },
          mx: { has_mx: true, records: [`mx.${domain || 'x'}.`], error: '' },
          role_account: username.startsWith('info'),
        }),
      )
    },
  }
}

function job(batchId: string): Job<BatchProcessJobData> {
  return { data: { batchId }, attemptsMade: 0 } as unknown as Job<BatchProcessJobData>
}

describe.skipIf(!hasIntegrationEnv)('batch processor', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let storage: ObjectStorage
  const { logger } = captureLogger()

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    storage = await connectTestStorage()
  })

  afterAll(async () => {
    storage.close()
    await sqlEnd()
  })

  async function grant(orgId: string, amount: number): Promise<void> {
    await db.insert(creditLedger).values({
      orgId,
      delta: amount,
      reason: 'grant',
      referenceId: `grant-${randomUUID()}`,
    })
  }

  async function plantBatch(options: {
    orgId: string
    csv: string
    totalRows: number
    emailColumn: number
    hasHeader: boolean
  }): Promise<string> {
    const batchId = randomUUID()
    const key = batchInputKey(options.orgId, batchId)
    await storage.uploadStream(key, Readable.from([options.csv]))
    const created = await createBatchWithReservation(db, {
      batchId,
      orgId: options.orgId,
      filename: 'test.csv',
      totalRows: options.totalRows,
      inputObjectKey: key,
      stats: {
        email_column: options.emailColumn,
        has_header: options.hasHeader,
        malformed_rows: 0,
        charged: 0,
        cached: 0,
        duplicates: 0,
        engine_errors: 0,
        distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
      },
    })
    if (created.kind !== 'created') throw new Error(`reservation failed: ${created.kind}`)
    return batchId
  }

  async function ledgerFor(orgId: string) {
    return db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId))
  }

  it('processes a 10k-row CSV end to end with exact ledger reconciliation', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 12_000)
    const engine = batchEngine()

    // 10,000 data rows: 8,000 unique addresses; 2,000 in-file duplicates.
    // 500 of the unique ones are pre-cached from an earlier run.
    const uniqueCount = 8_000
    const rows: string[] = ['name,email,city']
    for (let i = 0; i < 10_000; i++) {
      const id = i < uniqueCount ? i : i - uniqueCount // repeat the first 2000
      rows.push(`user${i},person${id}@batch.test,tashkent`)
    }
    const preCached = 500
    await insertBatchEmailChecks(
      db,
      Array.from({ length: preCached }, (_, i) => {
        const email = `person${i}@batch.test`
        return {
          orgId,
          emailNormalized: email,
          emailHash: '',
          verdict: 'valid' as const,
          reasonCodes: [],
          checksJson: {
            engine: engineSnapshot({ email }),
            score: 95,
            disclaimer: 'd',
            typo: null,
            smtp_status: 'skipped',
          },
          expiresAt: new Date(Date.now() + 86_400_000),
        }
      }).map((row) => ({
        ...row,
        emailHash: createHash('sha256').update(row.emailNormalized, 'utf8').digest('hex'),
      })),
    )

    const batchId = await plantBatch({
      orgId,
      csv: rows.join('\n') + '\n',
      totalRows: 10_000,
      emailColumn: 1,
      hasHeader: true,
    })

    const balanceAfterReserve = await getCreditBalance(db, orgId)
    expect(balanceAfterReserve).toBe(2_000)

    await createBatchProcessor({ db, storage, engine, logger })(job(batchId))

    const loaded = await getBatchForProcessing(db, batchId)
    expect(loaded?.batch.status).toBe('done')
    expect(loaded?.batch.processedRows).toBe(10_000)
    const stats = loaded?.batch.stats as BatchStats
    expect(stats.charged).toBe(uniqueCount - preCached) // 7500 fresh
    expect(stats.cached).toBe(preCached)
    expect(stats.duplicates).toBe(2_000)
    expect(stats.malformed_rows).toBe(0)
    expect(
      stats.distribution.valid +
        stats.distribution.invalid +
        stats.distribution.risky +
        stats.distribution.unknown,
    ).toBe(10_000)

    // Duplicates charged once, cached rows charged zero: the engine ran only
    // for fresh unique addresses.
    expect(engine.calls.length).toBe(uniqueCount - preCached)

    // Ledger reconciles exactly: -10000 reserve, +2500 refund.
    const entries = await ledgerFor(orgId)
    const reserve = entries.find((entry) => entry.reason === 'batch_check')
    const refund = entries.find((entry) => entry.reason === 'refund')
    expect(reserve?.delta).toBe(-10_000)
    expect(refund?.delta).toBe(10_000 - (uniqueCount - preCached))
    expect(refund?.referenceId).toBe(`${batchId}:refund`)
    expect(await getCreditBalance(db, orgId)).toBe(12_000 - (uniqueCount - preCached))

    // The result CSV preserves original columns and appends the new ones.
    const result = await readObject(storage, `org/${orgId}/batches/${batchId}/result.csv`)
    const lines = result.trimEnd().split('\n')
    expect(lines).toHaveLength(10_001)
    expect(lines[0]).toBe('name,email,city,normalized_email,verdict,score,reason_codes,suggestion')
    expect(lines[1]).toContain('user0,person0@batch.test,tashkent,person0@batch.test,')
  }, 120_000)

  it('handles malformed rows without crashing and never charges them', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 100)
    const engine = batchEngine()

    const csv = [
      'email',
      'good@rows.test',
      '', // skipped as empty line by parser
      '   ', // malformed: empty after normalization
      'also.good@rows.test',
      'not-an-email-but-normalizes', // engine says syntax invalid; charged
    ].join('\n')

    const batchId = await plantBatch({ orgId, csv, totalRows: 4, emailColumn: 0, hasHeader: true })
    await createBatchProcessor({ db, storage, engine, logger })(job(batchId))

    const loaded = await getBatchForProcessing(db, batchId)
    expect(loaded?.batch.status).toBe('done')
    const stats = loaded?.batch.stats as BatchStats
    expect(stats.malformed_rows).toBe(1)
    expect(stats.charged).toBe(3)

    const result = await readObject(storage, `org/${orgId}/batches/${batchId}/result.csv`)
    expect(result).toContain(',invalid,0,SYNTAX_INVALID,')
  })

  it('a failed batch refunds the entire reservation', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 50)
    const engine = batchEngine()

    // The input object deliberately does not exist.
    const batchId = randomUUID()
    const created = await createBatchWithReservation(db, {
      batchId,
      orgId,
      filename: 'ghost.csv',
      totalRows: 30,
      inputObjectKey: `org/${orgId}/batches/${batchId}/input.csv`,
      stats: {
        email_column: 0,
        has_header: false,
        malformed_rows: 0,
        charged: 0,
        cached: 0,
        duplicates: 0,
        engine_errors: 0,
        distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
      },
    })
    expect(created.kind).toBe('created')
    expect(await getCreditBalance(db, orgId)).toBe(20)

    await createBatchProcessor({ db, storage, engine, logger })(job(batchId))

    const loaded = await getBatchForProcessing(db, batchId)
    expect(loaded?.batch.status).toBe('failed')
    expect(loaded?.batch.error).toBe('processing_failed')
    expect(await getCreditBalance(db, orgId)).toBe(50)
    expect(engine.calls).toHaveLength(0)
  })

  it('a redelivered job for a finished batch neither reprocesses nor double-refunds', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 20)
    const engine = batchEngine()
    const csv = 'email\na@redelivery.test\nb@redelivery.test\n'
    const batchId = await plantBatch({ orgId, csv, totalRows: 2, emailColumn: 0, hasHeader: true })

    const process = createBatchProcessor({ db, storage, engine, logger })
    await process(job(batchId))
    const balanceAfterFirst = await getCreditBalance(db, orgId)

    await process(job(batchId))
    expect(await getCreditBalance(db, orgId)).toBe(balanceAfterFirst)
    expect(engine.calls).toHaveLength(2)
  })

  it('a batch deleted before its job runs finishes quietly with the exact balance restored', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 40)
    const engine = batchEngine()
    const csv = 'email\na@predelete.test\nb@predelete.test\nc@predelete.test\n'
    const batchId = await plantBatch({ orgId, csv, totalRows: 3, emailColumn: 0, hasHeader: true })
    expect(await getCreditBalance(db, orgId)).toBe(37)

    // The owner deletes the still-pending batch: full refund, exactly once.
    const deleted = await deleteBatchForOrg(db, batchId, orgId)
    expect(deleted.kind).toBe('deleted')
    if (deleted.kind === 'deleted') expect(deleted.refunded).toBe(3)
    expect(await getCreditBalance(db, orgId)).toBe(40)

    // The queued job arrives afterwards: it must do NOTHING, quietly.
    const captured = captureLogger()
    await createBatchProcessor({ db, storage, engine, logger: captured.logger })(job(batchId))

    expect(engine.calls).toHaveLength(0)
    await expect(storage.getStream(`org/${orgId}/batches/${batchId}/result.csv`)).rejects.toThrow()
    const checks = await db.select().from(emailChecks).where(eq(emailChecks.orgId, orgId))
    expect(checks).toHaveLength(0)

    // Ledger: grant, reservation, one refund - and nothing after the delete.
    const entries = await ledgerFor(orgId)
    expect(entries.filter((entry) => entry.reason === 'refund')).toHaveLength(1)
    expect(entries).toHaveLength(3)
    expect(await getCreditBalance(db, orgId)).toBe(40)

    // Quiet means quiet: an info outcome, no error-level line.
    const outcomes = captured.lines.filter((line) => line.outcome !== undefined)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ outcome: 'not_claimable' })
    expect(captured.lines.every((line) => Number(line.level) < 50)).toBe(true)
  })

  it('a delete racing an in-flight job is refused, then terminal deletion keeps the ledger', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 30)

    // An engine that parks mid-batch so the race window is deterministic.
    let releaseEngine: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseEngine = resolve
    })
    let engineStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      engineStarted = resolve
    })
    const inner = batchEngine()
    const gatedEngine = {
      async verify(email: string, opts: { smtp: boolean; catchAll: boolean }) {
        engineStarted?.()
        await gate
        return inner.verify(email, opts)
      },
    }

    const csv = 'email\nx@race.test\ny@race.test\n'
    const batchId = await plantBatch({ orgId, csv, totalRows: 2, emailColumn: 0, hasHeader: true })

    const processing = createBatchProcessor({ db, storage, engine: gatedEngine, logger })(
      job(batchId),
    )
    await started

    // Mid-processing: deletion must be refused, not silently "succeed".
    const refused = await deleteBatchForOrg(db, batchId, orgId)
    expect(refused.kind).toBe('processing')

    releaseEngine?.()
    await processing

    const loaded = await getBatchForProcessing(db, batchId)
    expect(loaded?.batch.status).toBe('done')
    const balanceAfterCompletion = await getCreditBalance(db, orgId)
    expect(balanceAfterCompletion).toBe(28) // 30 - 2 charged

    // Terminal deletion now succeeds, refunds nothing, and the reconciled
    // ledger survives byte for byte.
    const entriesBefore = await ledgerFor(orgId)
    const deleted = await deleteBatchForOrg(db, batchId, orgId)
    expect(deleted.kind).toBe('deleted')
    if (deleted.kind === 'deleted') expect(deleted.refunded).toBe(0)
    const entriesAfter = await ledgerFor(orgId)
    expect(entriesAfter).toEqual(entriesBefore)
    expect(await getCreditBalance(db, orgId)).toBe(28)
  })

  it('deleting a failed batch preserves its full-refund ledger without a second refund', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 25)
    const engine = batchEngine()

    // Fails at processing time: the input object is missing.
    const batchId = randomUUID()
    const created = await createBatchWithReservation(db, {
      batchId,
      orgId,
      filename: 'ghost.csv',
      totalRows: 10,
      inputObjectKey: `org/${orgId}/batches/${batchId}/input.csv`,
      stats: {
        email_column: 0,
        has_header: false,
        malformed_rows: 0,
        charged: 0,
        cached: 0,
        duplicates: 0,
        engine_errors: 0,
        distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
      },
    })
    expect(created.kind).toBe('created')
    await createBatchProcessor({ db, storage, engine, logger })(job(batchId))
    expect(await getCreditBalance(db, orgId)).toBe(25)

    const deleted = await deleteBatchForOrg(db, batchId, orgId)
    expect(deleted.kind).toBe('deleted')
    if (deleted.kind === 'deleted') expect(deleted.refunded).toBe(0)
    const refunds = (await ledgerFor(orgId)).filter((entry) => entry.reason === 'refund')
    expect(refunds).toHaveLength(1)
    expect(await getCreditBalance(db, orgId)).toBe(25)
  })

  it('terminal batches fan out webhook events with only delivery UUIDs in jobs', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 20)
    const engine = batchEngine()

    // Two subscribed endpoints; one deleted endpoint and one wrong-event
    // endpoint must NOT receive deliveries.
    const subscribed = await createWebhookEndpoint(db, {
      orgId,
      url: 'https://a.example.com/hook',
      events: ['batch.completed', 'batch.failed'],
      secret: `whsec_${randomUUID()}`,
    })
    const alsoSubscribed = await createWebhookEndpoint(db, {
      orgId,
      url: 'https://b.example.com/hook',
      events: ['batch.completed'],
      secret: `whsec_${randomUUID()}`,
    })
    const wrongEvent = await createWebhookEndpoint(db, {
      orgId,
      url: 'https://c.example.com/hook',
      events: ['batch.failed'],
      secret: `whsec_${randomUUID()}`,
    })

    const enqueued: string[] = []
    const publisher = {
      enqueue: (deliveryId: string) => {
        enqueued.push(deliveryId)
        return Promise.resolve()
      },
    }

    const csv = 'email\nhook@emit.test\n'
    const batchId = await plantBatch({ orgId, csv, totalRows: 1, emailColumn: 0, hasHeader: true })
    await createBatchProcessor({ db, storage, engine, logger, webhookPublisher: publisher })(
      job(batchId),
    )

    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.eventType, 'batch.completed'))
    const forThisBatch = deliveries.filter(
      (delivery) =>
        (delivery.payload as { data?: { batch_id?: string } }).data?.batch_id === batchId,
    )
    expect(forThisBatch).toHaveLength(2)
    const endpointIds = forThisBatch.map((delivery) => delivery.endpointId).sort()
    expect(endpointIds).toEqual([subscribed.id, alsoSubscribed.id].sort())
    expect(endpointIds).not.toContain(wrongEvent.id)

    // Jobs carry delivery UUIDs only - no URLs, secrets, or emails.
    expect(enqueued.sort()).toEqual(forThisBatch.map((delivery) => delivery.id).sort())
    expect(JSON.stringify(enqueued)).not.toContain('@')
    expect(JSON.stringify(enqueued)).not.toContain('whsec')

    // The payload holds the documented event data shape.
    const payload = forThisBatch[0]?.payload as {
      event: string
      data: { batch_id: string; status: string; total_rows: number; verdict_counts: unknown }
    }
    expect(payload.event).toBe('batch.completed')
    expect(payload.data.status).toBe('done')
    expect(payload.data.total_rows).toBe(1)
    expect(payload.data.verdict_counts).toBeDefined()
  })

  it('a failed batch emits batch.failed to its subscribers', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 10)
    const endpoint = await createWebhookEndpoint(db, {
      orgId,
      url: 'https://f.example.com/hook',
      events: ['batch.failed'],
      secret: `whsec_${randomUUID()}`,
    })
    const enqueued: string[] = []
    const publisher = {
      enqueue: (deliveryId: string) => {
        enqueued.push(deliveryId)
        return Promise.resolve()
      },
    }

    // Input object missing: the batch fails and refunds.
    const batchId = randomUUID()
    await createBatchWithReservation(db, {
      batchId,
      orgId,
      filename: 'ghost.csv',
      totalRows: 4,
      inputObjectKey: `org/${orgId}/batches/${batchId}/input.csv`,
      stats: {
        email_column: 0,
        has_header: false,
        malformed_rows: 0,
        charged: 0,
        cached: 0,
        duplicates: 0,
        engine_errors: 0,
        distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
      },
    })
    await createBatchProcessor({
      db,
      storage,
      engine: batchEngine(),
      logger,
      webhookPublisher: publisher,
    })(job(batchId))

    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint.id))
    expect(deliveries).toHaveLength(1)
    const payload = deliveries[0]?.payload as { event: string; data: { status: string } }
    expect(payload.event).toBe('batch.failed')
    expect(payload.data.status).toBe('failed')
    expect(enqueued).toEqual([deliveries[0]?.id])
  })

  it('streaming keeps memory flat between a 1k-row and a 50k-row file', async () => {
    const orgId = await createOrg(db)
    await grant(orgId, 60_000)
    const engine = batchEngine()
    // Fat rows (~1 KB padding) so buffering the file would be clearly visible.
    const padding = 'x'.repeat(1024)

    const run = async (rowCount: number): Promise<number> => {
      // The fixture itself streams: the test process never holds the file.
      const batchId = randomUUID()
      const key = batchInputKey(orgId, batchId)
      function* generate(): Generator<string> {
        yield 'email,notes\n'
        for (let i = 0; i < rowCount; i++) {
          yield `mem${i}-${rowCount}@stream.test,${padding}\n`
        }
      }
      await storage.uploadStream(key, Readable.from(generate()))
      const created = await createBatchWithReservation(db, {
        batchId,
        orgId,
        filename: 'mem.csv',
        totalRows: rowCount,
        inputObjectKey: key,
        stats: {
          email_column: 0,
          has_header: true,
          malformed_rows: 0,
          charged: 0,
          cached: 0,
          duplicates: 0,
          engine_errors: 0,
          distribution: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
        },
      })
      if (created.kind !== 'created') throw new Error('reservation failed')

      // Live-heap peak: force a full GC before each sample so the number
      // reflects retained objects (real buffering), not allocation churn.
      const forceGc = (globalThis as { gc?: () => void }).gc
      if (forceGc === undefined) throw new Error('run with --expose-gc (vitest config sets it)')
      let peak = 0
      const sampler = setInterval(() => {
        forceGc()
        const live = process.memoryUsage().heapUsed
        if (live > peak) peak = live
      }, 200)
      try {
        await createBatchProcessor({ db, storage, engine, logger })(job(batchId))
      } finally {
        clearInterval(sampler)
      }
      const loaded = await getBatchForProcessing(db, batchId)
      expect(loaded?.batch.status).toBe('done')
      return peak
    }

    const smallPeak = await run(1_000)
    const largePeak = await run(50_000)

    // A buffered implementation would retain the ~51 MB file (plus parsed
    // rows and the ~55 MB result) in the live set; streaming's live growth is
    // bounded by the dedup map and chunk buffers.
    const growth = largePeak - smallPeak
    expect(growth).toBeLessThan(40 * 1024 * 1024)
  }, 240_000)
})
