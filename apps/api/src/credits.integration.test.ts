import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createApiKeyForOrg,
  creditLedger,
  getCreditBalance,
  type DatabaseClient,
} from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
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

describe.skipIf(!hasIntegrationEnv)('credit correctness and usage', () => {
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

  async function harness(credits: number, balanceCachePrefix?: string) {
    const orgId = await createOrg(db)
    if (credits > 0) await grantCredits(db, orgId, credits)
    const created = await createApiKeyForOrg(db, orgId, 'credits key')
    if (!created.ok) throw new Error('setup failed')
    const captured = captureStream()

    const app = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        smtpEnabled: false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:`, limit: 1000 },
        balanceCache: { keyPrefix: balanceCachePrefix ?? `${uniqueName('bal')}:` },
      },
    })
    apps.push(app)
    return { app, orgId, key: created.created.plaintext }
  }

  const post = (h: { app: FastifyInstance; key: string }, url: string, body: unknown) =>
    h.app.inject({
      method: 'GET' === url ? 'GET' : 'POST',
      url,
      headers: { authorization: `Bearer ${h.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  // --- 13. concurrent spend can never overdraw -----------------------------------

  it('20 concurrent checks against 10 credits: exactly 10 succeed, balance exactly 0', async () => {
    const h = await harness(10)

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        post(h, '/v1/email/check', { email: `burst-${i}@overdraw.test` }),
      ),
    )

    const ok = responses.filter((r) => r.statusCode === 200)
    const refused = responses.filter((r) => r.statusCode === 402)
    expect(ok).toHaveLength(10)
    expect(refused).toHaveLength(10)
    for (const r of refused) {
      expect((r.json() as { error: { code: string } }).error.code).toBe('INSUFFICIENT_CREDITS')
    }

    const balance = await getCreditBalance(db, h.orgId)
    expect(balance).toBe(0)

    const debits = await db.select().from(creditLedger).where(eq(creditLedger.orgId, h.orgId))
    const spends = debits.filter((row) => row.delta === -1)
    expect(spends).toHaveLength(10)
    const references = spends.map((row) => row.referenceId)
    expect(new Set(references).size).toBe(10)
    expect(references.every((ref) => ref !== null)).toBe(true)
  })

  // --- 14. simultaneous same-email requests cannot double-charge ------------------

  it('two simultaneous same-email requests result in exactly one debit', async () => {
    const h = await harness(10)
    const email = 'same.instant@dedupe.test'

    const [a, b] = await Promise.all([
      post(h, '/v1/email/check', { email }),
      post(h, '/v1/email/check', { email }),
    ])

    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    const metaA = (a.json() as { meta: { cached: boolean; credits_used: number } }).meta
    const metaB = (b.json() as { meta: { cached: boolean; credits_used: number } }).meta

    // One request paid, the other reused - in either order.
    expect([metaA.credits_used, metaB.credits_used].sort()).toEqual([0, 1])
    expect([metaA.cached, metaB.cached].sort()).toEqual([false, true])

    const spends = (
      await db.select().from(creditLedger).where(eq(creditLedger.orgId, h.orgId))
    ).filter((row) => row.delta === -1)
    expect(spends).toHaveLength(1)
    expect(await getCreditBalance(db, h.orgId)).toBe(9)
  })

  // --- 15. balance cache is a hint, never an authority -----------------------------

  it('a stale positive cached balance can never authorize a debit', async () => {
    const prefix = `${uniqueName('stale')}:`
    const h = await harness(0, prefix)

    // Poison the cache: claim a rich balance for a broke org.
    await redis.set(`${prefix}${h.orgId}`, '100', 'PX', 10_000)

    const response = await post(h, '/v1/email/check', { email: 'broke@stale.test' })
    expect(response.statusCode).toBe(402)
    expect((response.json() as { error: { code: string } }).error.code).toBe('INSUFFICIENT_CREDITS')
    expect(await getCreditBalance(db, h.orgId)).toBe(0)
    const rows = await db.select().from(creditLedger).where(eq(creditLedger.orgId, h.orgId))
    expect(rows).toHaveLength(0)
  })

  it('a zero-credit org is refused before any cache or engine work', async () => {
    const h = await harness(0)
    const engineCallsBefore = 0
    const response = await post(h, '/v1/email/check', { email: 'nobudget@gate.test' })
    expect(response.statusCode).toBe(402)
    void engineCallsBefore
  })

  it('after a debit the cache holds the exact post-transaction balance', async () => {
    const prefix = `${uniqueName('post')}:`
    const h = await harness(3, prefix)

    await post(h, '/v1/email/check', { email: 'first@exact.test' })
    expect(await redis.get(`${prefix}${h.orgId}`)).toBe('2')

    await post(h, '/v1/phone/check', { phone: '+998901112233' })
    expect(await redis.get(`${prefix}${h.orgId}`)).toBe('1')
  })

  // --- 12. usage -----------------------------------------------------------------

  it('usage is org-scoped, UTC-month bounded, and pagination is deterministic', async () => {
    const h = await harness(50)
    const other = await harness(50)

    // Three email checks + one phone check this month for h.
    for (let i = 0; i < 3; i++) {
      await post(h, '/v1/email/check', { email: `usage-${i}@month.test` })
    }
    await post(h, '/v1/phone/check', { phone: '+998905556677' })
    // Noise in another org.
    await post(other, '/v1/email/check', { email: 'noise@other.test' })

    // A tied-timestamp pair to prove deterministic ordering.
    const tied = new Date()
    await db.insert(creditLedger).values([
      {
        orgId: h.orgId,
        delta: 5,
        reason: 'grant',
        referenceId: `tie-a-${randomUUID()}`,
        createdAt: tied,
      },
      {
        orgId: h.orgId,
        delta: 7,
        reason: 'grant',
        referenceId: `tie-b-${randomUUID()}`,
        createdAt: tied,
      },
    ])

    const usage = await h.app.inject({
      method: 'GET',
      url: '/v1/usage?limit=3',
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(usage.statusCode).toBe(200)
    const body = usage.json() as {
      data: {
        balance: number
        checks_this_month: { email: number; phone: number; total: number }
        ledger: { entries: Array<{ id: string; delta: number }>; next_cursor: string | null }
      }
    }

    expect(body.data.balance).toBe(50 - 4 + 12)
    expect(body.data.checks_this_month).toEqual({ email: 3, phone: 1, total: 4 })
    expect(body.data.ledger.entries).toHaveLength(3)
    expect(body.data.ledger.next_cursor).not.toBeNull()

    // Walk every page twice: identical order both times, no duplicates.
    const walk = async (): Promise<string[]> => {
      const seen: string[] = []
      let cursor: string | null = null
      for (;;) {
        const url: string = `/v1/usage?limit=3${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`
        const page = await h.app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${h.key}` },
        })
        const parsed = page.json() as {
          data: { ledger: { entries: Array<{ id: string }>; next_cursor: string | null } }
        }
        seen.push(...parsed.data.ledger.entries.map((entry) => entry.id))
        if (parsed.data.ledger.next_cursor === null) break
        cursor = parsed.data.ledger.next_cursor
      }
      return seen
    }

    const firstWalk = await walk()
    const secondWalk = await walk()
    expect(firstWalk).toEqual(secondWalk)
    expect(new Set(firstWalk).size).toBe(firstWalk.length)
    // 1 grant + 4 debits + 2 tied grants = 7 entries.
    expect(firstWalk).toHaveLength(7)

    // Another org sees only its own entries.
    const otherUsage = await other.app.inject({
      method: 'GET',
      url: '/v1/usage',
      headers: { authorization: `Bearer ${other.key}` },
    })
    const otherBody = otherUsage.json() as { data: { checks_this_month: { total: number } } }
    expect(otherBody.data.checks_this_month.total).toBe(1)

    const badCursor = await h.app.inject({
      method: 'GET',
      url: '/v1/usage?cursor=%%%garbage',
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(badCursor.statusCode).toBe(400)
  })

  it('usage does not count last months checks in the current month', async () => {
    const h = await harness(10)
    await post(h, '/v1/email/check', { email: 'now@months.test' })

    // Plant an email check dated in the previous UTC month.
    const lastMonth = new Date()
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1, 15)
    const { emailChecks } = await import('@tozalist/db')
    await db.insert(emailChecks).values({
      id: randomUUID(),
      orgId: h.orgId,
      emailNormalized: 'old@months.test',
      emailHash: `old-${randomUUID()}`,
      verdict: 'valid',
      reasonCodes: [],
      checksJson: {},
      cached: false,
      creditsUsed: 1,
      createdAt: lastMonth,
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    const usage = await h.app.inject({
      method: 'GET',
      url: '/v1/usage',
      headers: { authorization: `Bearer ${h.key}` },
    })
    const body = usage.json() as { data: { checks_this_month: { email: number } } }
    expect(body.data.checks_this_month.email).toBe(1)
  })
})
