import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { leads, type DatabaseClient } from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  hasIntegrationEnv,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

describe.skipIf(!hasIntegrationEnv)('public pilot leads', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let app: FastifyInstance
  let logs: ReturnType<typeof captureStream>['lines']
  const WEB_ORIGIN = 'http://localhost:3000'

  beforeAll(() => {
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
        webOrigin: WEB_ORIGIN,
        publicLeads: { keyPrefix: `${uniqueName('leads')}:`, limit: 3, windowMs: 60_000 },
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        internalAuth: {
          sessionSecret: 'test_session_secret_at_least_32_chars!',
          dashboardOrigin: 'http://localhost:3002',
          cookieSecure: false,
        },
      },
    })
  })

  afterAll(async () => {
    await app.close()
    await redis.quit()
    await sqlEnd()
  })

  const submit = (body: unknown, ip = '203.0.113.50') =>
    app.inject({
      method: 'POST',
      url: '/public/leads',
      remoteAddress: ip,
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify(body),
    })

  it('writes a lead with source landing_pilot, locale, volume and retention expiry', async () => {
    const local = `Lead.${uniqueName('x')}`
    const email = `${local}@firma.uz`
    const response = await submit({
      email: ` ${local}@FIRMA.UZ `,
      company: 'Firma LLC',
      phone: '+998901234567',
      volume: '10k-50k',
      message: 'We send weekly newsletters.',
      locale: 'uz',
    })
    expect(response.statusCode).toBe(200)

    // Trimmed; the local part's casing is PRESERVED; only the domain lowers.
    const [row] = await db.select().from(leads).where(eq(leads.email, email))
    expect(row).toBeDefined()
    expect(row?.email).toBe(email)
    expect(row?.source).toBe('landing_pilot')
    expect(row?.locale).toBe('uz')
    expect(row?.company).toBe('Firma LLC')
    expect(row?.message).toContain('volume: 10k-50k')
    expect(row?.message).toContain('weekly newsletters')
    // Personal data carries an expiry for the retention sweep.
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('the honeypot pretends success and stores nothing', async () => {
    const email = `${uniqueName('bot')}@spam.test`
    const response = await submit({ email, website: 'http://bot.example' }, '203.0.113.51')
    expect(response.statusCode).toBe(200) // indistinguishable from success
    const rows = await db.select().from(leads).where(eq(leads.email, email))
    expect(rows).toHaveLength(0)
  })

  it('rate limits per IP and fails closed without Redis state', async () => {
    const ip = '203.0.113.52'
    for (let i = 0; i < 3; i++) {
      expect((await submit({ email: `${uniqueName('rl')}@x.uz` }, ip)).statusCode).toBe(200)
    }
    const blocked = await submit({ email: `${uniqueName('rl')}@x.uz` }, ip)
    expect(blocked.statusCode).toBe(429)
    // A different IP is unaffected.
    expect((await submit({ email: `${uniqueName('rl')}@x.uz` }, '203.0.113.53')).statusCode).toBe(
      200,
    )
  })

  it('validates the body strictly', async () => {
    expect((await submit({ email: 'nope' }, '203.0.113.54')).statusCode).toBe(400)
    expect((await submit({ email: 'a@b.uz', volume: 'tons' }, '203.0.113.54')).statusCode).toBe(400)
    expect((await submit({ email: 'a@b.uz', extra: 1 }, '203.0.113.54')).statusCode).toBe(400)
    expect((await submit({ email: 'a@b.uz', locale: 'de' }, '203.0.113.54')).statusCode).toBe(400)
  })

  it('CORS allows the web origin alongside the dashboard origin', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/public/leads',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST' },
    })
    expect(preflight.headers['access-control-allow-origin']).toBe(WEB_ORIGIN)

    const foreign = await app.inject({
      method: 'OPTIONS',
      url: '/public/leads',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    })
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('TRUST BOUNDARY: the web origin gets NO CORS access to dashboard routes', async () => {
    // Preflight and simple-request checks against /internal/me: the web
    // origin must receive no Access-Control-* headers at all there.
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/internal/me',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' },
    })
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()

    const simple = await app.inject({
      method: 'GET',
      url: '/internal/me',
      headers: { origin: WEB_ORIGIN },
    })
    expect(simple.headers['access-control-allow-origin']).toBeUndefined()
    expect(simple.headers['access-control-allow-credentials']).toBeUndefined()

    // The dashboard origin keeps its credentialed access to /internal.
    const dashboard = await app.inject({
      method: 'OPTIONS',
      url: '/internal/me',
      headers: { origin: 'http://localhost:3002', 'access-control-request-method': 'GET' },
    })
    expect(dashboard.headers['access-control-allow-origin']).toBe('http://localhost:3002')
    expect(dashboard.headers['access-control-allow-credentials']).toBe('true')

    // And the dashboard origin has no business on the public lead endpoint.
    const crossed = await app.inject({
      method: 'OPTIONS',
      url: '/public/leads',
      headers: { origin: 'http://localhost:3002', 'access-control-request-method': 'POST' },
    })
    expect(crossed.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('the lead endpoint CORS is non-credentialed', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/public/leads',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST' },
    })
    expect(preflight.headers['access-control-allow-origin']).toBe(WEB_ORIGIN)
    // Never Access-Control-Allow-Credentials on the public surface.
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('fails closed with the generic envelope when Redis is unavailable, leaking nothing', async () => {
    const deadRedis = connectTestRedis()
    const captured = captureStream()
    const isolated = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis: deadRedis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        smtpEnabled: false,
        webOrigin: WEB_ORIGIN,
        publicLeads: { keyPrefix: `${uniqueName('dead')}:` },
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
      },
    })
    await deadRedis.quit()

    const email = `${uniqueName('offline')}@no-redis.uz`
    const response = await isolated.inject({
      method: 'POST',
      url: '/public/leads',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ email, phone: '+998901112233' }),
    })
    expect(response.statusCode).toBe(500)
    const parsed = response.json() as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('INTERNAL_ERROR')
    expect(parsed.error.message).toBe('An internal error occurred.')

    // No lead stored, and no submitted field in the response or logs.
    const rows = await db.select().from(leads).where(eq(leads.email, email))
    expect(rows).toHaveLength(0)
    const raw = JSON.stringify(captured.lines) + response.body
    expect(raw).not.toContain(email)
    expect(raw).not.toContain('no-redis')
    expect(raw).not.toContain('901112233')
    await isolated.close()
  })

  it('logs never contain submitted emails or phone numbers', async () => {
    const email = `${uniqueName('private')}@secret-lead.uz`
    await submit({ email, phone: '+998907776655' }, '203.0.113.55')
    const raw = JSON.stringify(logs)
    expect(raw).not.toContain(email)
    expect(raw).not.toContain('secret-lead')
    expect(raw).not.toContain('907776655')
  })
})
