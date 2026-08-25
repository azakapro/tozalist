import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiKeyForOrg, type DatabaseClient } from '@tozalist/db'
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

const METRICS_TEST_TOKEN = 'metrics-scrape-token-for-tests-only'

describe.skipIf(!hasIntegrationEnv)('observability and security hardening', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let app: FastifyInstance
  let logs: ReturnType<typeof captureStream>['lines']
  let orgId: string
  let apiKey: string

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    const captured = captureStream()
    logs = captured.lines
    app = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        smtpEnabled: false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
        metricsToken: METRICS_TEST_TOKEN,
      },
    })
    orgId = await createOrg(db)
    await grantCredits(db, orgId, 50)
    const created = await createApiKeyForOrg(db, orgId, 'hardening key')
    if (!created.ok) throw new Error('key setup failed')
    apiKey = created.created.plaintext
  })

  afterAll(async () => {
    await app.close()
    await redis.quit()
    await sqlEnd()
  })

  const check = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/email/check',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })

  it('a full check flow logs neither the raw email nor the API key', async () => {
    const email = `redact-${Date.now()}@leak-test.example`
    const miss = await check(email)
    expect(miss.statusCode).toBe(200)
    const hit = await check(email)
    expect(hit.statusCode).toBe(200)
    // A deliberately careless log call: the wired logger must scrub it too.
    app.log.info({ note: `operator note about ${email}`, email }, `debugging ${email}`)
    // And secret-shaped keys - flat AND deeply nested inside objects, arrays,
    // and headers - all censored by the recursive redactor.
    app.log.info({ apiKey, password: 'super-secret-password-123' }, 'careless secret log')
    app.log.info(
      {
        request: {
          headers: { authorization: `Bearer ${apiKey}`, cookie: 'session=sealed-cookie-value' },
        },
        deep: { a: { b: { token: 'nested-token-value', webhook_secret: 'whsec_nested_value' } } },
        list: [{ mfaSecret: 'JBSWY3DPNESTED' }, { csrfToken: 'csrf-nested-value' }],
      },
      'careless nested secret log',
    )

    const serialized = JSON.stringify(logs)
    expect(logs.length).toBeGreaterThan(0)
    expect(serialized).not.toContain(email)
    expect(serialized).not.toContain('redact-')
    expect(serialized).toContain('leak-test.example#') // domain + hash form
    expect(serialized).not.toContain(apiKey)
    expect(serialized).not.toContain('super-secret-password-123')
    for (const nested of [
      'sealed-cookie-value',
      'nested-token-value',
      'whsec_nested_value',
      'JBSWY3DPNESTED',
      'csrf-nested-value',
    ]) {
      expect(serialized, nested).not.toContain(nested)
    }
  })

  it('request ids propagate into the SMTP job payload', async () => {
    const smtpOrgId = await createOrg(db, { smtpEnabled: true })
    await grantCredits(db, smtpOrgId, 10)
    const created = await createApiKeyForOrg(db, smtpOrgId, 'smtp key')
    if (!created.ok) throw new Error('key setup failed')
    const queue = stubQueue()
    const captured = captureStream()
    const smtpApp = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: queue,
        smtpEnabled: true,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
      },
    })
    try {
      const response = await smtpApp.inject({
        method: 'POST',
        url: '/v1/email/check',
        headers: {
          authorization: `Bearer ${created.created.plaintext}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: `probe-${Date.now()}@propagate.example`, smtp: true }),
      })
      expect(response.statusCode).toBe(200)
      const requestId = String(response.headers['x-request-id'])
      expect(queue.calls).toHaveLength(1)
      expect(queue.calls[0]?.requestId).toBe(requestId)
    } finally {
      await smtpApp.close()
    }
  })

  it('metrics are private: fail closed without the monitoring credential', async () => {
    // No credential, wrong credential, wrong scheme: identical 401 envelopes.
    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/metrics',
          headers: { authorization: 'Bearer wrong-token' },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/metrics',
          headers: { authorization: METRICS_TEST_TOKEN },
        })
      ).statusCode,
    ).toBe(401)

    // An app with NO configured token fails closed even for that token.
    const unconfigured = buildApp({
      logger: false,
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        smtpEnabled: false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
      },
    })
    try {
      const refused = await unconfigured.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${METRICS_TEST_TOKEN}` },
      })
      expect(refused.statusCode).toBe(401)
    } finally {
      await unconfigured.close()
    }
  })

  it('serves Prometheus metrics to the authorized scraper only', async () => {
    await check(`metrics-${Date.now()}@metrics.example`)
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${METRICS_TEST_TOKEN}` },
    })
    expect(response.statusCode).toBe(200)
    // Never browser-readable: no CORS headers on the metrics surface.
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(String(response.headers['content-type'])).toContain('text/plain')
    const text = response.body
    expect(text).toContain(
      'tozalist_http_requests_total{method="POST",route="/v1/email/check",status="200"}',
    )
    expect(text).toContain('tozalist_http_request_duration_seconds_bucket')
    expect(text).toContain('tozalist_check_cache_events_total{result="miss"}')
    expect(text).toContain('tozalist_check_cache_events_total{result="hit"}')
    expect(text).toContain('tozalist_credits_spent_total{kind="single_check"}')
    expect(text).toContain('tozalist_engine_calls_total{outcome="ok"}')
    // Route labels are patterns, never raw URLs with ids.
    expect(text).not.toMatch(/route="\/v1\/email\/check\/[0-9a-f-]{36}"/)
  })

  it('every response carries the security headers; /v1 is open-CORS, /internal is not', async () => {
    const api = await app.inject({ method: 'GET', url: '/v1/usage' })
    expect(api.headers['strict-transport-security']).toContain('max-age=')
    expect(api.headers['x-frame-options']).toBe('DENY')
    expect(api.headers['x-content-type-options']).toBe('nosniff')
    expect(api.headers['referrer-policy']).toBe('no-referrer')
    expect(api.headers['content-security-policy']).toContain("default-src 'none'")
    expect(api.headers['access-control-allow-origin']).toBe('*')
    expect(api.headers['access-control-allow-credentials']).toBeUndefined()

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/email/check',
      headers: { origin: 'https://customer.example', 'access-control-request-method': 'POST' },
    })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect(String(preflight.headers['access-control-allow-headers'])).toContain('Authorization')

    // The health and docs surfaces get headers too; docs CSP allows its own UI.
    const docs = await app.inject({ method: 'GET', url: '/docs' })
    expect(String(docs.headers['content-security-policy'])).toContain("default-src 'self'")

    // No wildcard CORS ever leaks onto the credentialed dashboard scope.
    const internal = await app.inject({
      method: 'GET',
      url: '/internal/me',
      headers: { origin: 'https://evil.example' },
    })
    expect(internal.headers['access-control-allow-origin']).toBeUndefined()
  })
})
