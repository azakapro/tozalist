import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditEvents,
  batches,
  createApiKeyForOrg,
  creditLedger,
  getCreditBalance,
  type DatabaseClient,
} from '@tozalist/db'
import type { ObjectStorage } from '@tozalist/shared'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { BATCH_PROCESSING_DELETE_MESSAGE } from './routes/batches.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  connectTestStorage,
  createOrg,
  grantCredits,
  hasIntegrationEnv,
  multipartCsv,
  stubBatchQueue,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

describe.skipIf(!hasIntegrationEnv)('batch endpoints', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let storage: ObjectStorage
  const apps: FastifyInstance[] = []

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    storage = await connectTestStorage()
  })

  afterAll(async () => {
    for (const instance of apps) await instance.close()
    storage.close()
    await redis.quit()
    await sqlEnd()
  })

  async function harness(credits: number, queue = stubBatchQueue()) {
    const orgId = await createOrg(db)
    if (credits > 0) await grantCredits(db, orgId, credits)
    const created = await createApiKeyForOrg(db, orgId, 'batch key')
    if (!created.ok) throw new Error('setup failed')
    const captured = captureStream()

    const app = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        storage,
        batchQueue: queue,
        smtpEnabled: false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:`, limit: 1000 },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
      },
    })
    apps.push(app)
    return { app, orgId, key: created.created.plaintext, queue, logs: captured.lines }
  }

  type Harness = Awaited<ReturnType<typeof harness>>

  const uploadCsv = (h: Harness, csv: string) => {
    const { body, contentType } = multipartCsv(csv)
    return h.app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: { authorization: `Bearer ${h.key}`, 'content-type': contentType },
      body,
    })
  }

  const get = (h: Harness, url: string) =>
    h.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${h.key}` } })

  it('creates a batch: reservation, single ledger entry, job with only the UUID', async () => {
    const h = await harness(100)
    const csv = 'email\na@upload.test\nb@upload.test\nc@upload.test\n'
    const response = await uploadCsv(h, csv)

    expect(response.statusCode).toBe(200)
    const body = response.json() as { data: Record<string, unknown>; meta: Record<string, unknown> }
    expect(body.data).toMatchObject({ total_rows: 3, credit_cost: 3, status: 'pending' })
    expect(body.meta).toMatchObject({ credits_remaining: 97 })

    const batchId = String(body.data.batch_id)
    expect(h.queue.jobs).toEqual([batchId])
    expect(JSON.stringify(h.queue.jobs)).not.toContain('@')

    const entries = await db.select().from(creditLedger).where(eq(creditLedger.orgId, h.orgId))
    const reserves = entries.filter((entry) => entry.reason === 'batch_check')
    expect(reserves).toHaveLength(1)
    expect(reserves[0]?.delta).toBe(-3)
    expect(reserves[0]?.referenceId).toBe(batchId)

    // The input object landed in storage.
    const [row] = await db.select().from(batches).where(eq(batches.id, batchId))
    expect(row?.inputObjectKey).toBe(`org/${h.orgId}/batches/${batchId}/input.csv`)
    const stream = await storage.getStream(row?.inputObjectKey ?? '')
    let stored = ''
    for await (const chunk of stream) stored += String(chunk)
    expect(stored).toBe(csv)
  })

  it('detects headerless CSVs by @-sampling', async () => {
    const h = await harness(50)
    const csv = 'Alice,alice@headerless.test,1\nBob,bob@headerless.test,2\n'
    const response = await uploadCsv(h, csv)
    expect(response.statusCode).toBe(200)
    expect((response.json() as { data: { total_rows: number } }).data.total_rows).toBe(2)

    const batchId = (response.json() as { data: { batch_id: string } }).data.batch_id
    const [row] = await db.select().from(batches).where(eq(batches.id, batchId))
    expect((row?.stats as { email_column: number; has_header: boolean }).email_column).toBe(1)
    expect((row?.stats as { has_header: boolean }).has_header).toBe(false)
  })

  it('rejects a CSV with no detectable email column and cleans up the object', async () => {
    const h = await harness(50)
    const response = await uploadCsv(h, 'name,city\nAlice,Tashkent\nBob,Samarkand\n')
    expect(response.statusCode).toBe(400)
    expect((response.json() as { error: { message: string } }).error.message).toContain(
      'No email column',
    )
    // No batch row, no reservation.
    const rows = await db.select().from(batches).where(eq(batches.orgId, h.orgId))
    expect(rows).toHaveLength(0)
    expect(await getCreditBalance(db, h.orgId)).toBe(50)
  })

  it('insufficient credits: 402 names the shortfall and reserves nothing', async () => {
    const h = await harness(2)
    const response = await uploadCsv(h, 'email\na@x.test\nb@x.test\nc@x.test\nd@x.test\n')
    expect(response.statusCode).toBe(402)
    const parsed = response.json() as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('INSUFFICIENT_CREDITS')
    expect(parsed.error.message).toContain('2 more needed')
    expect(await getCreditBalance(db, h.orgId)).toBe(2)
    expect(h.queue.jobs).toHaveLength(0)
  })

  it('an enqueue failure fails the batch and refunds the full reservation', async () => {
    const h = await harness(10, stubBatchQueue('fail'))
    const response = await uploadCsv(h, 'email\na@fail.test\nb@fail.test\n')
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('queue backend unreachable')

    const [row] = await db.select().from(batches).where(eq(batches.orgId, h.orgId))
    expect(row?.status).toBe('failed')
    expect(await getCreditBalance(db, h.orgId)).toBe(10)
  })

  it('cross-org access is an identical 404 for GET and DELETE', async () => {
    const owner = await harness(10)
    const stranger = await harness(10)
    const created = await uploadCsv(owner, 'email\na@iso.test\n')
    const batchId = (created.json() as { data: { batch_id: string } }).data.batch_id

    expect((await get(owner, `/v1/batches/${batchId}`)).statusCode).toBe(200)
    const foreignGet = await get(stranger, `/v1/batches/${batchId}`)
    const missingGet = await get(stranger, `/v1/batches/${randomUUID()}`)
    expect(foreignGet.statusCode).toBe(404)
    expect(missingGet.statusCode).toBe(404)
    expect((foreignGet.json() as { error: { message: string } }).error.message).toBe(
      (missingGet.json() as { error: { message: string } }).error.message,
    )

    const foreignDelete = await stranger.app.inject({
      method: 'DELETE',
      url: `/v1/batches/${batchId}`,
      headers: { authorization: `Bearer ${stranger.key}` },
    })
    expect(foreignDelete.statusCode).toBe(404)
  })

  it('a done batch returns a one-hour signed download URL', async () => {
    const h = await harness(10)
    const created = await uploadCsv(h, 'email\na@signed.test\n')
    const batchId = (created.json() as { data: { batch_id: string } }).data.batch_id

    // Simulate worker completion.
    const resultKey = `org/${h.orgId}/batches/${batchId}/result.csv`
    const { Readable } = await import('node:stream')
    await storage.uploadStream(resultKey, Readable.from(['email,verdict\na@signed.test,valid\n']))
    await db
      .update(batches)
      .set({ status: 'done', resultObjectKey: resultKey, completedAt: new Date() })
      .where(eq(batches.id, batchId))

    const response = await get(h, `/v1/batches/${batchId}`)
    const body = response.json() as { data: { download_url: string | null; status: string } }
    expect(body.data.status).toBe('done')
    expect(body.data.download_url).not.toBeNull()
    expect(String(body.data.download_url)).toContain('X-Amz-Expires=3600')
    expect(String(body.data.download_url)).toContain(resultKey)

    // A pending batch has no download URL.
    const pending = await uploadCsv(h, 'email\nb@signed.test\n')
    const pendingId = (pending.json() as { data: { batch_id: string } }).data.batch_id
    const pendingGet = await get(h, `/v1/batches/${pendingId}`)
    expect((pendingGet.json() as { data: { download_url: null } }).data.download_url).toBeNull()
  })

  it('DELETE removes the row and both objects and writes one audit event', async () => {
    const h = await harness(10)
    const created = await uploadCsv(h, 'email\na@delete.test\n')
    const batchId = (created.json() as { data: { batch_id: string } }).data.batch_id
    const inputKey = `org/${h.orgId}/batches/${batchId}/input.csv`

    const response = await h.app.inject({
      method: 'DELETE',
      url: `/v1/batches/${batchId}`,
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(response.statusCode).toBe(200)
    expect((response.json() as { data: { deleted: boolean } }).data.deleted).toBe(true)

    const rows = await db.select().from(batches).where(eq(batches.id, batchId))
    expect(rows).toHaveLength(0)
    await expect(storage.getStream(inputKey)).rejects.toThrow()

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'batch.deleted'))
    const forThis = audits.filter((event) => event.targetId === batchId)
    expect(forThis).toHaveLength(1)
    expect(JSON.stringify(forThis)).not.toContain('@delete.test')
  })

  it('deleting a pending batch refunds the reservation exactly once', async () => {
    const h = await harness(20)
    const created = await uploadCsv(h, 'email\na@refund.test\nb@refund.test\nc@refund.test\n')
    const batchId = (created.json() as { data: { batch_id: string } }).data.batch_id
    expect(await getCreditBalance(db, h.orgId)).toBe(17)

    const response = await h.app.inject({
      method: 'DELETE',
      url: `/v1/batches/${batchId}`,
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(response.statusCode).toBe(200)
    expect(await getCreditBalance(db, h.orgId)).toBe(20)

    const entries = await db.select().from(creditLedger).where(eq(creditLedger.orgId, h.orgId))
    const refunds = entries.filter((entry) => entry.reason === 'refund')
    expect(refunds).toHaveLength(1)
    expect(refunds[0]?.delta).toBe(3)
    expect(refunds[0]?.referenceId).toBe(`${batchId}:refund`)

    // A second delete is an ordinary 404 and changes nothing.
    const again = await h.app.inject({
      method: 'DELETE',
      url: `/v1/batches/${batchId}`,
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(again.statusCode).toBe(404)
    expect(await getCreditBalance(db, h.orgId)).toBe(20)

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'batch.deleted'))
    const forThis = audits.filter((event) => event.targetId === batchId)
    expect(forThis).toHaveLength(1)
    expect(forThis[0]?.metadata).toMatchObject({ credits_refunded: 3 })
  })

  it('deleting a processing batch is refused with the fixed CONFLICT envelope', async () => {
    const h = await harness(10)
    const created = await uploadCsv(h, 'email\na@busy.test\n')
    const batchId = (created.json() as { data: { batch_id: string } }).data.batch_id
    // The worker has claimed it.
    await db.update(batches).set({ status: 'processing' }).where(eq(batches.id, batchId))

    const response = await h.app.inject({
      method: 'DELETE',
      url: `/v1/batches/${batchId}`,
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(response.statusCode).toBe(409)
    const parsed = response.json() as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('CONFLICT')
    expect(parsed.error.message).toBe(BATCH_PROCESSING_DELETE_MESSAGE)

    // No refund happened, the row and object survive.
    expect(await getCreditBalance(db, h.orgId)).toBe(9)
    const rows = await db.select().from(batches).where(eq(batches.id, batchId))
    expect(rows).toHaveLength(1)

    // A stranger deleting the same processing batch still sees a plain 404 -
    // cross-org requests stay indistinguishable from missing ids.
    const stranger = await harness(5)
    const foreign = await stranger.app.inject({
      method: 'DELETE',
      url: `/v1/batches/${batchId}`,
      headers: { authorization: `Bearer ${stranger.key}` },
    })
    expect(foreign.statusCode).toBe(404)
  })

  it('lists batches with deterministic cursor pagination', async () => {
    const h = await harness(50)
    for (let i = 0; i < 5; i++) {
      await uploadCsv(h, `email\nuser${i}@list.test\n`)
    }

    const page1 = await get(h, '/v1/batches?limit=2')
    const body1 = page1.json() as {
      data: { batches: Array<{ batch_id: string }>; next_cursor: string | null }
    }
    expect(body1.data.batches).toHaveLength(2)
    expect(body1.data.next_cursor).not.toBeNull()

    const page2 = await get(
      h,
      `/v1/batches?limit=2&cursor=${encodeURIComponent(body1.data.next_cursor ?? '')}`,
    )
    const body2 = page2.json() as {
      data: { batches: Array<{ batch_id: string }>; next_cursor: string | null }
    }
    const ids = [...body1.data.batches, ...body2.data.batches].map((entry) => entry.batch_id)
    expect(new Set(ids).size).toBe(4)

    expect((await get(h, '/v1/batches?cursor=%%%bad')).statusCode).toBe(400)
    expect((await get(h, '/v1/batches?limit=999')).statusCode).toBe(400)
  })

  it('oversized uploads are rejected and logs stay clean of addresses', async () => {
    const h = await harness(10)
    // 21 MB body trips the 20 MB multipart limit.
    const big = 'email\n' + `${'x'.repeat(1024)}@big.test\n`.repeat(20 * 1024)
    const response = await uploadCsv(h, big)
    expect([413, 500]).toContain(response.statusCode)
    if (response.statusCode === 413) {
      expect((response.json() as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE')
    }
    // Nothing reserved for a rejected upload.
    expect(await getCreditBalance(db, h.orgId)).toBe(10)

    const raw = JSON.stringify(h.logs)
    expect(raw).not.toContain('@upload.test')
    expect(raw).not.toContain('@big.test')
    expect(raw).not.toContain(h.key)
  }, 60_000)
})
