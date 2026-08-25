import { Validator } from '@seriousme/openapi-schema-validator'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiKeyForOrg, type DatabaseClient } from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { PRODUCT_OPERATIONS } from './openapi/operations.js'
import {
  connectTestDb,
  connectTestRedis,
  connectTestStorage,
  createOrg,
  grantCredits,
  hasIntegrationEnv,
  stubBatchQueue,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

type OpenApiDocument = {
  openapi: string
  info: { title: string; version: string }
  paths: Record<
    string,
    Record<
      string,
      { operationId?: string; security?: unknown[]; responses?: Record<string, unknown> }
    >
  >
  components: { securitySchemes?: Record<string, unknown>; schemas?: Record<string, unknown> }
}

describe.skipIf(!hasIntegrationEnv)('openapi documentation', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  /** Production-style app: real deps wiring, NO test routes. */
  let app: FastifyInstance
  let doc: OpenApiDocument
  let key: string
  const apps: FastifyInstance[] = []

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()

    const orgId = await createOrg(db)
    await grantCredits(db, orgId, 100)
    const created = await createApiKeyForOrg(db, orgId, 'openapi key')
    if (!created.ok) throw new Error('setup failed')
    key = created.created.plaintext

    const storage = await connectTestStorage()
    app = buildApp({
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        storage,
        batchQueue: stubBatchQueue(),
        smtpEnabled: false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
      },
    })
    apps.push(app)
    await app.ready()

    const response = await app.inject({ method: 'GET', url: '/openapi.json' })
    expect(response.statusCode).toBe(200)
    doc = JSON.parse(response.body) as OpenApiDocument
  })

  afterAll(async () => {
    for (const instance of apps) await instance.close()
    await redis.quit()
    await sqlEnd()
  })

  // --- 1 + 11. availability -----------------------------------------------------

  it('serves /openapi.json publicly as valid JSON declaring OpenAPI 3.1.0', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toMatchObject({ title: 'TozaList API', version: 'v1' })
    expect(doc.info).toHaveProperty('description')
  })

  it('serves /docs publicly', async () => {
    // The UI entry redirects to its static index; the chain stays public.
    const entry = await app.inject({ method: 'GET', url: '/docs' })
    expect(entry.statusCode).toBe(302)
    expect(String(entry.headers.location)).toContain('static/index.html')

    const index = await app.inject({ method: 'GET', url: '/docs/static/index.html' })
    expect(index.statusCode).toBe(200)
    expect(index.body.toLowerCase()).toContain('swagger')
  })

  // --- 2. metaschema validation ---------------------------------------------------

  it('the document validates against the OpenAPI 3.1 metaschema', async () => {
    const validator = new Validator()
    const result = await validator.validate(structuredClone(doc) as Record<string, unknown>)
    if (!result.valid) {
      throw new Error('metaschema violations: ' + JSON.stringify(result.errors).slice(0, 2000))
    }
    expect(result.valid).toBe(true)
    expect(validator.version).toBe('3.1')
  })

  // --- 3-5. coverage driven by the single registry --------------------------------

  it('contains each stable operation id exactly once', () => {
    const found = new Map<string, number>()
    for (const methods of Object.values(doc.paths)) {
      for (const operation of Object.values(methods)) {
        if (operation.operationId !== undefined) {
          found.set(operation.operationId, (found.get(operation.operationId) ?? 0) + 1)
        }
      }
    }
    for (const expected of [
      'health',
      'createEmailCheck',
      'getEmailCheck',
      'createPhoneCheck',
      'getUsage',
    ]) {
      expect(found.get(expected), expected).toBe(1)
    }
  })

  it('documents every production product route from the registry', () => {
    for (const operation of PRODUCT_OPERATIONS) {
      const path = doc.paths[operation.path]
      expect(path, operation.path).toBeDefined()
      const entry = path?.[operation.method.toLowerCase()]
      expect(entry?.operationId, `${operation.method} ${operation.path}`).toBe(
        operation.operationId,
      )
    }
  })

  it('never exposes test-only routes', () => {
    const allPaths = Object.keys(doc.paths)
    expect(allPaths).not.toContain('/v1/test-protected')
    expect(allPaths).not.toContain('/v1/test-error')
    expect(JSON.stringify(doc)).not.toContain('test-protected')
    expect(JSON.stringify(doc)).not.toContain('test-error')
  })

  // --- 6. security ------------------------------------------------------------------

  it('secures every /v1 operation with the Bearer API-key scheme', () => {
    expect(doc.components.securitySchemes).toHaveProperty('bearerApiKey')
    for (const [path, methods] of Object.entries(doc.paths)) {
      if (!path.startsWith('/v1/')) continue
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation.security, `${method} ${path}`).toEqual([{ bearerApiKey: [] }])
      }
    }
  })

  // --- 7. responses ------------------------------------------------------------------

  it('every operation documents a success response and its error envelopes', () => {
    for (const operation of PRODUCT_OPERATIONS) {
      const entry = doc.paths[operation.path]?.[operation.method.toLowerCase()]
      const responses = entry?.responses ?? {}
      expect(responses['200'], `${operation.operationId} success`).toBeDefined()
      if (operation.path.startsWith('/v1/')) {
        for (const status of ['401', '429', '500']) {
          expect(responses[status], `${operation.operationId} ${status}`).toBeDefined()
        }
        // A 400 belongs only to operations that validate input; a bare GET
        // with no body, params, or query genuinely cannot produce one.
        const validatesInput =
          'body' in operation.schema ||
          'params' in operation.schema ||
          'querystring' in operation.schema
        if (validatesInput) {
          expect(responses['400'], `${operation.operationId} 400`).toBeDefined()
        }
      }
    }
    // Statuses a route cannot return are not documented.
    const usageResponses = doc.paths['/v1/usage']?.get?.responses ?? {}
    expect(usageResponses['402']).toBeUndefined()
    expect(usageResponses['413']).toBeUndefined()
    const getCheckResponses = doc.paths['/v1/email/check/{id}']?.get?.responses ?? {}
    expect(getCheckResponses['404']).toBeDefined()
    expect(getCheckResponses['413']).toBeUndefined()
  })

  // --- 8-10. runtime strictness preserved ---------------------------------------------

  const authedPost = (url: string, body: unknown) =>
    app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('the email schema still rejects unknown fields at runtime', async () => {
    const response = await authedPost('/v1/email/check', { email: 'a@b.test', sneaky: true })
    expect(response.statusCode).toBe(400)
    expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR')
  })

  it('smtp accepts only booleans at runtime - no coercion', async () => {
    for (const bad of ['true', 1, 'yes', null]) {
      const response = await authedPost('/v1/email/check', { email: 'a@b.test', smtp: bad })
      expect(response.statusCode, JSON.stringify(bad)).toBe(400)
    }
    const good = await authedPost('/v1/email/check', { email: 'strict@types.test', smtp: false })
    expect(good.statusCode).toBe(200)
  })

  it('phone and usage schemas keep their strict behavior', async () => {
    expect((await authedPost('/v1/phone/check', { phone: '+998901234567', x: 1 })).statusCode).toBe(
      400,
    )
    expect((await authedPost('/v1/phone/check', { phone: 123 })).statusCode).toBe(400)
    expect(
      (await authedPost('/v1/phone/check', { phone: '+998901234567', country: 'UZB' })).statusCode,
    ).toBe(400)

    const usage = await app.inject({
      method: 'GET',
      url: '/v1/usage?limit=abc',
      headers: { authorization: `Bearer ${key}` },
    })
    expect(usage.statusCode).toBe(400)
    const unknownParam = await app.inject({
      method: 'GET',
      url: '/v1/usage?nope=1',
      headers: { authorization: `Bearer ${key}` },
    })
    expect(unknownParam.statusCode).toBe(400)
  })

  // --- 12. example hygiene --------------------------------------------------------------

  it('the document contains no real emails, keys, passwords, or connection strings', () => {
    const raw = JSON.stringify(doc)
    expect(raw).not.toMatch(/tzl_live_[0-9A-Za-z]{32}/)
    expect(raw).not.toContain('redis://')
    expect(raw).not.toContain('rediss://')
    expect(raw).not.toContain('postgres')
    expect(raw).not.toMatch(/[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|mail|yandex)\.(com|ru)/)
    expect(raw.toLowerCase()).not.toContain('password')
    expect(raw).not.toContain('local_dev_secret')
    // The only addresses in examples use RFC-reserved documentation domains.
    const emails = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []
    for (const email of emails) {
      expect(email.endsWith('@example.com') || email.includes('example'), email).toBe(true)
    }
  })

  it('response schemas do not distort live responses', async () => {
    // The schema-serialized live response keeps every documented field.
    const response = await authedPost('/v1/email/check', { email: 'serialization@shape.test' })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { data: Record<string, unknown>; meta: Record<string, unknown> }
    for (const field of [
      'check_id',
      'email',
      'verdict',
      'score',
      'reason_codes',
      'reason_explanations',
      'suggestion',
      'checks',
      'disclaimer',
    ]) {
      expect(body.data, field).toHaveProperty(field)
    }
    const checks = body.data.checks as Record<string, unknown>
    for (const field of ['syntax', 'domain', 'disposable', 'role_account', 'smtp']) {
      expect(checks, field).toHaveProperty(field)
    }
    for (const field of [
      'request_id',
      'credits_used',
      'credits_remaining',
      'cached',
      'smtp',
      'api_version',
    ]) {
      expect(body.meta, field).toHaveProperty(field)
    }
  })
})
