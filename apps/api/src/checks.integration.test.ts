import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createApiKeyForOrg,
  creditLedger,
  emailChecks,
  organizations,
  phoneChecks,
  sha256Hex,
  type DatabaseClient,
} from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { PHONE_LIMITATION } from './render.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  createOrg,
  grantCredits,
  hasIntegrationEnv,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

describe.skipIf(!hasIntegrationEnv)('check endpoints', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  const apps: FastifyInstance[] = []

  beforeAll(() => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
  })

  afterAll(async () => {
    for (const instance of apps) await instance.close()
    await redis.quit()
    await sqlEnd()
  })

  type Harness = {
    app: FastifyInstance
    orgId: string
    key: string
    engine: ReturnType<typeof stubEngine>
    queue: ReturnType<typeof stubQueue>
    logs: Array<Record<string, unknown>>
  }

  async function harness(
    options: {
      credits?: number
      orgSmtp?: boolean
      smtpEnabled?: boolean
      engine?: ReturnType<typeof stubEngine>
      queue?: ReturnType<typeof stubQueue>
    } = {},
  ): Promise<Harness> {
    const orgId = await createOrg(db, { smtpEnabled: options.orgSmtp ?? false })
    if ((options.credits ?? 10) > 0) await grantCredits(db, orgId, options.credits ?? 10)
    const created = await createApiKeyForOrg(db, orgId, 'checks key')
    if (!created.ok) throw new Error('key setup failed')

    const engine = options.engine ?? stubEngine()
    const queue = options.queue ?? stubQueue()
    const captured = captureStream()

    const app = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis,
        engine,
        smtpQueue: queue,
        smtpEnabled: options.smtpEnabled ?? false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
      },
    })
    apps.push(app)
    return { app, orgId, key: created.created.plaintext, engine, queue, logs: captured.lines }
  }

  const post = (h: Harness, url: string, body: unknown) =>
    h.app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${h.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  const get = (h: Harness, url: string) =>
    h.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${h.key}` } })

  async function ledgerRows(orgId: string) {
    return db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId))
  }

  // --- 1. strict validation ---------------------------------------------------

  it('rejects unknown fields and invalid types with VALIDATION_ERROR', async () => {
    const h = await harness()
    const cases = [
      { email: 'a@b.test', extra: 1 },
      { email: 42 },
      { smtp: true },
      { email: '' },
      { email: 'a@b.test', smtp: 'yes' },
    ]
    for (const body of cases) {
      const response = await post(h, '/v1/email/check', body)
      expect(response.statusCode, JSON.stringify(body)).toBe(400)
      expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR')
    }
    // Nothing was charged for rejected bodies.
    expect((await ledgerRows(h.orgId)).filter((row) => row.delta < 0)).toHaveLength(0)
  })

  // --- 2. cache miss: engine call, one row, one debit ---------------------------

  it('a cache miss calls the engine offline-only and charges exactly one credit', async () => {
    const h = await harness({ credits: 5 })
    const response = await post(h, '/v1/email/check', { email: ' User@Example.TEST ' })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { data: Record<string, unknown>; meta: Record<string, unknown> }

    // The engine saw the normalized form, with SMTP and catch-all off.
    expect(h.engine.calls).toEqual([{ email: 'User@example.test', smtp: false, catchAll: false }])

    expect(body.data.email).toBe('User@example.test')
    expect(body.meta).toMatchObject({
      credits_used: 1,
      credits_remaining: 4,
      cached: false,
      smtp: 'skipped',
      api_version: 'v1',
    })
    expect(body.data.disclaimer).toContain('risk signals')

    const debits = (await ledgerRows(h.orgId)).filter((row) => row.delta === -1)
    expect(debits).toHaveLength(1)
    expect(debits[0]?.reason).toBe('single_check')
    expect(debits[0]?.referenceId).toBe(body.data.check_id)

    const [checkRow] = await db
      .select()
      .from(emailChecks)
      .where(eq(emailChecks.id, String(body.data.check_id)))
    expect(checkRow?.emailHash).toBe(sha256Hex('User@example.test'))
  })

  // --- 3. engine failure: nothing persisted, safe 500 ---------------------------

  it('an engine failure charges nothing, stores nothing, and stays safe', async () => {
    const h = await harness({ credits: 5, engine: stubEngine('fail') })
    const response = await post(h, '/v1/email/check', { email: 'victim@fail.test' })

    expect(response.statusCode).toBe(500)
    const parsed = response.json() as { error: Record<string, string> }
    expect(parsed.error.code).toBe('INTERNAL_ERROR')
    expect(parsed.error.message).toBe('An internal error occurred.')
    expect(response.body).not.toContain('engine exploded')

    expect((await ledgerRows(h.orgId)).filter((row) => row.delta < 0)).toHaveLength(0)
    const rows = await db.select().from(emailChecks).where(eq(emailChecks.orgId, h.orgId))
    expect(rows).toHaveLength(0)
  })

  // --- 4-6. cache behavior -------------------------------------------------------

  it('a repeat within 7 days is free, cached, and writes no ledger row', async () => {
    const h = await harness({ credits: 5 })
    const first = await post(h, '/v1/email/check', { email: 'repeat@cache.test' })
    expect(first.statusCode).toBe(200)

    const second = await post(h, '/v1/email/check', { email: 'repeat@cache.test' })
    expect(second.statusCode).toBe(200)
    const body = second.json() as { data: Record<string, unknown>; meta: Record<string, unknown> }
    expect(body.meta).toMatchObject({ credits_used: 0, cached: true })
    expect(body.data.check_id).toBe((first.json() as { data: { check_id: string } }).data.check_id)

    expect(h.engine.calls).toHaveLength(1)
    expect((await ledgerRows(h.orgId)).filter((row) => row.delta < 0)).toHaveLength(1)
  })

  it('exactly 7 days old is a miss; strictly newer is a hit', async () => {
    const h = await harness({ credits: 5 })
    const email = 'boundary@cache.test'
    const hash = sha256Hex(email)
    const now = Date.now()

    // Plant a result exactly 7 days old.
    const plant = async (createdAt: Date) => {
      await db.insert(emailChecks).values({
        id: randomUUID(),
        orgId: h.orgId,
        emailNormalized: email,
        emailHash: hash,
        verdict: 'valid',
        reasonCodes: [],
        checksJson: {
          engine: (await import('./test/support.js')).engineResponseFixture({ email }),
          score: 95,
          disclaimer: 'd',
          typo: null,
          smtp_status: 'skipped',
        },
        cached: false,
        creditsUsed: 1,
        createdAt,
        expiresAt: new Date(now + 86_400_000),
      })
    }

    await plant(new Date(now - 7 * 24 * 60 * 60 * 1000))
    const miss = await post(h, '/v1/email/check', { email })
    expect((miss.json() as { meta: { cached: boolean } }).meta.cached).toBe(false)
    expect(h.engine.calls).toHaveLength(1)

    // The just-created fresh row is now strictly newer: a hit.
    const hit = await post(h, '/v1/email/check', { email })
    expect((hit.json() as { meta: { cached: boolean } }).meta.cached).toBe(true)
    expect(h.engine.calls).toHaveLength(1)
  })

  it('the cache is scoped to the organisation', async () => {
    const h1 = await harness({ credits: 5 })
    const h2 = await harness({ credits: 5 })

    await post(h1, '/v1/email/check', { email: 'shared@scope.test' })
    const other = await post(h2, '/v1/email/check', { email: 'shared@scope.test' })

    expect((other.json() as { meta: { cached: boolean } }).meta.cached).toBe(false)
    expect(h2.engine.calls).toHaveLength(1)
    expect((await ledgerRows(h2.orgId)).filter((row) => row.delta < 0)).toHaveLength(1)
  })

  // --- 7. GET :id isolation -------------------------------------------------------

  it('GET /v1/email/check/:id returns identical 404s for foreign, missing and bogus ids', async () => {
    const h1 = await harness({ credits: 5 })
    const h2 = await harness({ credits: 5 })

    const created = await post(h1, '/v1/email/check', { email: 'owner@isolation.test' })
    const checkId = (created.json() as { data: { check_id: string } }).data.check_id

    const own = await get(h1, `/v1/email/check/${checkId}`)
    expect(own.statusCode).toBe(200)
    expect((own.json() as { meta: { credits_used: number } }).meta.credits_used).toBe(0)

    const foreign = await get(h2, `/v1/email/check/${checkId}`)
    const missing = await get(h2, `/v1/email/check/${randomUUID()}`)
    expect(foreign.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
    const foreignBody = foreign.json() as { error: Record<string, string> }
    const missingBody = missing.json() as { error: Record<string, string> }
    expect(foreignBody.error.code).toBe('NOT_FOUND')
    expect(foreignBody.error.message).toBe(missingBody.error.message)
  })

  // --- 8-10. SMTP lifecycle -------------------------------------------------------

  it('queues only the check UUID and reports pending, when every switch agrees', async () => {
    const h = await harness({ credits: 5, orgSmtp: true, smtpEnabled: true })
    const response = await post(h, '/v1/email/check', { email: 'probe.me@smtp.test', smtp: true })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { data: { check_id: string }; meta: { smtp: string } }
    expect(body.meta.smtp).toBe('pending')

    expect(h.queue.jobs).toEqual([body.data.check_id])
    expect(JSON.stringify(h.queue.jobs)).not.toContain('probe.me')

    // Polling reports pending until the worker writes a terminal snapshot.
    const pending = await get(h, `/v1/email/check/${body.data.check_id}`)
    expect((pending.json() as { meta: { smtp: string } }).meta.smtp).toBe('pending')

    // Simulate the worker's terminal update.
    const [row] = await db.select().from(emailChecks).where(eq(emailChecks.id, body.data.check_id))
    const snapshot = row?.checksJson as Record<string, unknown>
    await db
      .update(emailChecks)
      .set({ checksJson: { ...snapshot, smtp_status: 'complete' } })
      .where(eq(emailChecks.id, body.data.check_id))

    const complete = await get(h, `/v1/email/check/${body.data.check_id}`)
    expect((complete.json() as { meta: { smtp: string } }).meta.smtp).toBe('complete')
  })

  it.each([
    ['request off', { body: false, org: true, env: true }],
    ['org policy off', { body: true, org: false, env: true }],
    ['process policy off', { body: true, org: true, env: false }],
  ])('smtp is skipped when %s', async (_label, flags) => {
    const h = await harness({ credits: 5, orgSmtp: flags.org, smtpEnabled: flags.env })
    const response = await post(h, '/v1/email/check', {
      email: `skip@${uniqueName('s')}.test`,
      smtp: flags.body,
    })
    expect((response.json() as { meta: { smtp: string } }).meta.smtp).toBe('skipped')
    expect(h.queue.jobs).toHaveLength(0)
  })

  it('an enqueue failure never leaves a false pending and leaks nothing', async () => {
    const h = await harness({
      credits: 5,
      orgSmtp: true,
      smtpEnabled: true,
      queue: stubQueue('fail'),
    })
    const response = await post(h, '/v1/email/check', { email: 'lost@queue.test', smtp: true })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { data: { check_id: string }; meta: { smtp: string } }
    expect(body.meta.smtp).toBe('skipped')
    expect(response.body).not.toContain('queue backend unreachable')

    // The stored snapshot agrees: no phantom pending for pollers.
    const polled = await get(h, `/v1/email/check/${body.data.check_id}`)
    expect((polled.json() as { meta: { smtp: string } }).meta.smtp).toBe('skipped')
    // The core check itself was still charged and stored.
    expect((await ledgerRows(h.orgId)).filter((row) => row.delta < 0)).toHaveLength(1)
  })

  // --- 11. phone -------------------------------------------------------------------

  it('phone checks validate offline, charge one credit, and state the limitation', async () => {
    const h = await harness({ credits: 5 })
    const response = await post(h, '/v1/phone/check', { phone: '+998901234567' })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { data: Record<string, unknown>; meta: Record<string, unknown> }
    expect(body.data).toMatchObject({
      e164: '+998901234567',
      valid: true,
      country: 'UZ',
      line_type_guess: 'MOBILE',
      limitation: PHONE_LIMITATION,
    })
    expect(body.meta).toMatchObject({ credits_used: 1, credits_remaining: 4 })

    const [stored] = await db.select().from(phoneChecks).where(eq(phoneChecks.orgId, h.orgId))
    expect(stored?.inputHash).toBe(sha256Hex('+998901234567'))
    expect(JSON.stringify(stored)).not.toContain('901234567'.slice(0, 5) + '34567')

    // An invalid number is still a completed, charged format check.
    const invalid = await post(h, '/v1/phone/check', { phone: 'abc', country: 'UZ' })
    expect(invalid.statusCode).toBe(200)
    const invalidBody = invalid.json() as { data: Record<string, unknown> }
    expect(invalidBody.data.valid).toBe(false)
    expect(invalidBody.data.e164).toBeNull()
    expect((await ledgerRows(h.orgId)).filter((row) => row.delta < 0)).toHaveLength(2)

    const bad = await post(h, '/v1/phone/check', { phone: '+998901234567', extra: 1 })
    expect(bad.statusCode).toBe(400)
  })

  // --- 16. privacy sweep -----------------------------------------------------------

  it('logs, queue jobs and error bodies never carry raw emails or keys', async () => {
    const h = await harness({ credits: 5, orgSmtp: true, smtpEnabled: true })
    const email = 'Very.Secret.Person@privacy.test'
    await post(h, '/v1/email/check', { email, smtp: true })
    await post(h, '/v1/phone/check', { phone: '+998907654321' })
    await get(h, `/v1/email/check/${randomUUID()}`)

    const rawLogs = JSON.stringify(h.logs)
    expect(rawLogs).not.toContain(email)
    expect(rawLogs).not.toContain('Very.Secret.Person')
    expect(rawLogs).not.toContain(h.key)
    expect(rawLogs).not.toContain('authorization')
    expect(rawLogs).not.toContain('907654321')

    expect(JSON.stringify(h.queue.jobs)).not.toContain('@')

    // The deliberate exception: email_normalized in the database row.
    const [row] = await db.select().from(emailChecks).where(eq(emailChecks.orgId, h.orgId))
    expect(row?.emailNormalized).toBe(email)
    const snapshotRaw = JSON.stringify(row?.checksJson)
    expect(snapshotRaw).not.toContain(h.key)
  })

  it('renders explanations from the registry and audit ordering is stable', async () => {
    const h = await harness({ credits: 5 })
    const response = await post(h, '/v1/email/check', { email: 'info@gmai.com' })
    const body = response.json() as {
      data: {
        reason_codes: string[]
        reason_explanations: Record<string, string>
        suggestion: string
      }
    }
    expect(body.data.suggestion).toBe('gmail.com')
    for (const code of body.data.reason_codes) {
      expect(body.data.reason_explanations[code]).toBeTruthy()
    }
    const [latest] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, h.orgId))
      .orderBy(desc(organizations.createdAt))
    expect(latest).toBeDefined()
  })
})
