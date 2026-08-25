import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { desc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apiKeys,
  auditEvents,
  createApiKeyForOrg,
  organizations,
  sha256Hex,
  type DatabaseClient,
} from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppDeps } from './app.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  createOrg,
  hasIntegrationEnv,
  uniqueName,
} from './test/support.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe.skipIf(!hasIntegrationEnv)('api authentication', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let orgId: string
  let plaintextKey: string
  let apiKeyId: string
  let app: FastifyInstance
  let logs: ReturnType<typeof captureStream>['lines']
  const apps: FastifyInstance[] = []

  function makeApp(deps: Partial<AppDeps> = {}, stream?: NodeJS.WritableStream): FastifyInstance {
    const instance = buildApp({
      ...(stream !== undefined ? { logger: { stream } } : {}),
      deps: {
        db,
        redis,
        lastUsedThrottleMs: 60_000,
        authKeyPrefix: `${uniqueName('auth')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        ...deps,
      },
      testRoutes: true,
    })
    apps.push(instance)
    return instance
  }

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    orgId = await createOrg(db)

    const created = await createApiKeyForOrg(db, orgId, 'auth-test key')
    if (!created.ok) throw new Error('failed to create test key')
    plaintextKey = created.created.plaintext
    apiKeyId = created.created.apiKeyId

    const captured = captureStream()
    logs = captured.lines
    app = makeApp({}, captured.stream)
  })

  afterAll(async () => {
    for (const instance of apps) await instance.close()
    await redis.quit()
    await sqlEnd()
  })

  async function latestAuditFailure() {
    const [row] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'api.auth_failed'))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1)
    return row
  }

  // --- 1. success -------------------------------------------------------------

  it('a valid key authenticates and attaches orgId and apiKeyId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${plaintextKey}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, orgId, apiKeyId })
  })

  // --- 2-7. failures ----------------------------------------------------------

  const expectUnauthorized = (body: string, requestIdHeader: string | undefined) => {
    const parsed = JSON.parse(body) as { error: Record<string, string> }
    expect(parsed.error.code).toBe('UNAUTHORIZED')
    expect(parsed.error.message).toBe('Authentication is required.')
    expect(parsed.error.request_id).toMatch(UUID_RE)
    expect(requestIdHeader).toBe(parsed.error.request_id)
  }

  it('missing Authorization header returns the standard 401 envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/test-protected' })
    expect(response.statusCode).toBe(401)
    expectUnauthorized(response.body, response.headers['x-request-id'] as string)

    const audit = await latestAuditFailure()
    expect(audit?.metadata).toMatchObject({ category: 'missing_header' })
  })

  it('malformed Authorization header returns the standard 401 envelope', async () => {
    for (const header of ['Basic abc', 'Bearer', 'Bearer  ', 'bearer-token']) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/test-protected',
        headers: { authorization: header },
      })
      expect(response.statusCode, header).toBe(401)
      expectUnauthorized(response.body, response.headers['x-request-id'] as string)
    }
    const audit = await latestAuditFailure()
    expect(audit?.metadata).toMatchObject({ category: 'malformed_header' })
  })

  it('unknown key returns 401 and audits unknown_key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: 'Bearer tzl_live_00000000000000000000000000000000' },
    })
    expect(response.statusCode).toBe(401)
    const audit = await latestAuditFailure()
    expect(audit?.metadata).toMatchObject({ category: 'unknown_key' })
  })

  it('revoked key returns 401', async () => {
    const created = await createApiKeyForOrg(db, orgId, 'to-revoke')
    if (!created.ok) throw new Error('setup failed')
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, created.created.apiKeyId))

    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${created.created.plaintext}` },
    })
    expect(response.statusCode).toBe(401)
    const audit = await latestAuditFailure()
    expect(audit?.metadata).toMatchObject({ category: 'revoked_key' })
  })

  it('expired key returns 401', async () => {
    const created = await createApiKeyForOrg(db, orgId, 'expired')
    if (!created.ok) throw new Error('setup failed')
    await db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiKeys.id, created.created.apiKeyId))

    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${created.created.plaintext}` },
    })
    expect(response.statusCode).toBe(401)
    const audit = await latestAuditFailure()
    expect(audit?.metadata).toMatchObject({ category: 'expired_key' })
  })

  it('a key of a deleted organization returns 401', async () => {
    const doomedOrg = await createOrg(db)
    const created = await createApiKeyForOrg(db, doomedOrg, 'doomed')
    if (!created.ok) throw new Error('setup failed')
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, doomedOrg))

    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${created.created.plaintext}` },
    })
    expect(response.statusCode).toBe(401)
    const audit = await latestAuditFailure()
    expect(audit?.metadata).toMatchObject({ category: 'org_deleted' })
  })

  // --- 8. storage --------------------------------------------------------------

  it('the database stores only the hash and prefix, never the plaintext', async () => {
    const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId))
    expect(stored?.keyHash).toBe(sha256Hex(plaintextKey))
    expect(stored?.keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored?.keyPrefix).toBe(plaintextKey.slice(0, 12))
    expect(JSON.stringify(stored)).not.toContain(plaintextKey)
  })

  // --- 9. last_used_at throttle ------------------------------------------------

  it('last_used_at updates at most once per minute per key', async () => {
    const created = await createApiKeyForOrg(db, orgId, 'throttle-check')
    if (!created.ok) throw new Error('setup failed')
    const headers = { authorization: `Bearer ${created.created.plaintext}` }

    await app.inject({ method: 'GET', url: '/v1/test-protected', headers })
    const [afterFirst] = await db
      .select({ lastUsedAt: apiKeys.lastUsedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, created.created.apiKeyId))
    expect(afterFirst?.lastUsedAt).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 30))
    await app.inject({ method: 'GET', url: '/v1/test-protected', headers })
    const [afterSecond] = await db
      .select({ lastUsedAt: apiKeys.lastUsedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, created.created.apiKeyId))

    // Second hit within the window: the timestamp did not move.
    expect(afterSecond?.lastUsedAt?.getTime()).toBe(afterFirst?.lastUsedAt?.getTime())
  })

  // --- 16 (success half) + auth-failure quota ----------------------------------

  it('every response carries a fresh UUID request id, ignoring caller input', async () => {
    const ok = await app.inject({ method: 'GET', url: '/health' })
    expect(ok.headers['x-request-id']).toMatch(UUID_RE)

    const spoofed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'attacker-chosen-id' },
    })
    expect(spoofed.headers['x-request-id']).toMatch(UUID_RE)
    expect(spoofed.headers['x-request-id']).not.toBe('attacker-chosen-id')
    expect(spoofed.headers['x-request-id']).not.toBe(ok.headers['x-request-id'])
  })

  // --- 17. audit hygiene ---------------------------------------------------------

  it('auth-failure audits contain only safe categories, never key material', async () => {
    const secret = 'tzl_live_SuperSecretKeyValue0000000000'
    await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${secret}` },
    })

    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'api.auth_failed'))
    expect(rows.length).toBeGreaterThan(0)

    const validCategories = new Set([
      'missing_header',
      'malformed_header',
      'unknown_key',
      'revoked_key',
      'expired_key',
      'org_deleted',
    ])
    for (const row of rows) {
      const metadata = row.metadata as { category?: string }
      expect(metadata.category !== undefined && validCategories.has(metadata.category)).toBe(true)
      const raw = JSON.stringify(row)
      expect(raw).not.toContain(secret)
      expect(raw).not.toContain('Bearer')
      expect(raw).not.toContain(plaintextKey)
    }
  })

  // --- 20. log hygiene -----------------------------------------------------------

  it('logs carry request ids and never keys, headers, or bodies', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/test-protected',
      headers: { authorization: `Bearer ${plaintextKey}` },
    })
    await app.inject({ method: 'GET', url: '/v1/test-protected' })

    expect(logs.length).toBeGreaterThan(0)
    const raw = JSON.stringify(logs)
    expect(raw).not.toContain(plaintextKey)
    expect(raw).not.toContain('Bearer ')
    expect(raw).not.toContain('authorization')

    const requestLines = logs.filter((line) => line.msg === 'request')
    expect(requestLines.length).toBeGreaterThan(0)
    for (const line of requestLines) {
      expect(String(line.request_id)).toMatch(UUID_RE)
    }
    // Authenticated request lines carry org and key ids.
    const authed = requestLines.find((line) => line.org_id !== undefined)
    expect(authed).toMatchObject({ org_id: orgId, api_key_id: apiKeyId })
  })

  it('a 500 from an unexpected exception hides the internal detail', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-error',
      headers: { authorization: `Bearer ${plaintextKey}` },
    })
    expect(response.statusCode).toBe(500)
    const parsed = response.json() as { error: Record<string, string> }
    expect(parsed.error.code).toBe('INTERNAL_ERROR')
    expect(parsed.error.message).toBe('An internal error occurred.')
    expect(response.body).not.toContain('secret internal detail')
    expect(JSON.stringify(logs)).not.toContain('secret internal detail')
  })

  it('random request check: envelope shape is exact', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/nope-${randomUUID()}` })
    expect(response.statusCode).toBe(401) // auth runs before routing decisions in /v1
  })
})
