import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiKeyForOrg, sha256Hex, type DatabaseClient } from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import {
  connectTestDb,
  connectTestRedis,
  createOrg,
  hasIntegrationEnv,
  uniqueName,
} from './test/support.js'

describe.skipIf(!hasIntegrationEnv)('api rate limiting', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let orgId: string
  let key: string
  const apps: FastifyInstance[] = []

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    orgId = await createOrg(db)
    const created = await createApiKeyForOrg(db, orgId, 'rate-limit key')
    if (!created.ok) throw new Error('setup failed')
    key = created.created.plaintext
  })

  afterAll(async () => {
    for (const instance of apps) await instance.close()
    await redis.quit()
    await sqlEnd()
  })

  function makeApp(rlPrefix: string, redisClient: Redis = redis): FastifyInstance {
    const app = buildApp({
      deps: {
        db,
        redis: redisClient,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: rlPrefix },
      },
      testRoutes: true,
    })
    apps.push(app)
    return app
  }

  const authed = (app: FastifyInstance) =>
    app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${key}` },
    })

  // --- 10 + 11. the limit and Retry-After --------------------------------------

  it('allows 100 requests then blocks the 101st with an accurate Retry-After', async () => {
    const app = makeApp(`${uniqueName('rl-100')}:`)

    for (let i = 0; i < 100; i++) {
      const response = await authed(app)
      expect(response.statusCode, `request ${i + 1}`).toBe(200)
    }

    const blocked = await authed(app)
    expect(blocked.statusCode).toBe(429)
    const parsed = blocked.json() as { error: Record<string, string> }
    expect(parsed.error.code).toBe('RATE_LIMITED')
    expect(parsed.error.request_id).toBe(blocked.headers['x-request-id'])

    const retryAfter = Number(blocked.headers['retry-after'])
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(10)
  })

  it('Retry-After is never zero even at the window edge', async () => {
    // A 700ms window: the wait is sub-second, and the ceiling must still say 1.
    const app = buildApp({
      deps: {
        db,
        redis,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl-edge')}:`, limit: 1, windowMs: 700 },
      },
      testRoutes: true,
    })
    apps.push(app)

    expect((await authed(app)).statusCode).toBe(200)
    const blocked = await authed(app)
    expect(blocked.statusCode).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
  })

  // --- 12. state lives in Redis, not process memory -----------------------------

  it('two app instances share one budget through Redis', async () => {
    const sharedPrefix = `${uniqueName('rl-shared')}:`
    const appA = makeApp(sharedPrefix)
    const appB = makeApp(sharedPrefix)

    // Split 100 requests across two separate instances.
    for (let i = 0; i < 50; i++) {
      expect((await authed(appA)).statusCode).toBe(200)
      expect((await authed(appB)).statusCode).toBe(200)
    }

    // Whichever instance takes request 101, the shared budget is exhausted.
    expect((await authed(appA)).statusCode).toBe(429)
    expect((await authed(appB)).statusCode).toBe(429)
  })

  it('regression: identical PID and clock across instances cannot undercount', async () => {
    // Two independently built app instances, one Redis, one API key, and one
    // FROZEN clock value. Under the old pid+counter+timestamp member scheme,
    // instance A's request N and instance B's request N produced the same
    // member and ZADD silently overwrote it - the window undercounted and
    // request 101 was allowed. Collision-proof members must count all 100.
    const sharedPrefix = `${uniqueName('rl-frozen')}:`
    const frozenNow = Date.now() // identical injected clock for both instances

    const build = () => {
      const app = buildApp({
        deps: {
          db,
          redis,
          authKeyPrefix: `${uniqueName('lu')}:`,
          rateLimit: {
            keyPrefix: sharedPrefix,
            limit: 100,
            windowMs: 10_000,
            clock: () => frozenNow,
          },
        },
        testRoutes: true,
      })
      apps.push(app)
      return app
    }
    const appA = build()
    const appB = build()

    // 100 requests split across both instances, alternating.
    for (let i = 0; i < 50; i++) {
      expect((await authed(appA)).statusCode, `A request ${i + 1}`).toBe(200)
      expect((await authed(appB)).statusCode, `B request ${i + 1}`).toBe(200)
    }

    // Before the rejected request: exactly 100 distinct members in Redis.
    const keyHash = sha256Hex(key)
    void keyHash
    const windowKeys = await redis.keys(`${sharedPrefix}*`)
    expect(windowKeys).toHaveLength(1)
    const members = await redis.zrange(windowKeys[0] ?? '', 0, -1)
    expect(members).toHaveLength(100)
    expect(new Set(members).size).toBe(100)

    // Request 101 is rejected on either instance.
    const blocked = await authed(appA)
    expect(blocked.statusCode).toBe(429)
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect((await authed(appB)).statusCode).toBe(429)

    // The nonce never leaves Redis: no member value appears in the response.
    for (const member of members.slice(0, 3)) {
      expect(blocked.body).not.toContain(member)
    }
  })

  it('auth failures do not consume a valid key quota', async () => {
    const prefix = `${uniqueName('rl-authfail')}:`
    const app = buildApp({
      deps: {
        db,
        redis,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: prefix, limit: 2, windowMs: 10_000 },
      },
      testRoutes: true,
    })
    apps.push(app)

    // Hammer with bad credentials first.
    for (let i = 0; i < 10; i++) {
      const bad = await app.inject({ method: 'GET', url: '/v1/test-protected' })
      expect(bad.statusCode).toBe(401)
    }

    // The valid key still has its full budget of 2.
    expect((await authed(app)).statusCode).toBe(200)
    expect((await authed(app)).statusCode).toBe(200)
    expect((await authed(app)).statusCode).toBe(429)
  })

  it('fails closed with INTERNAL_ERROR when Redis is unavailable', async () => {
    const deadRedis = connectTestRedis()
    const app = makeApp(`${uniqueName('rl-dead')}:`, deadRedis)
    await deadRedis.quit() // the limiter now has no Redis to consult

    const response = await authed(app)
    expect(response.statusCode).toBe(500)
    const parsed = response.json() as { error: Record<string, string> }
    expect(parsed.error.code).toBe('INTERNAL_ERROR')
  })
})
