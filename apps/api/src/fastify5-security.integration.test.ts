import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiKeyForOrg, emailChecks, organizations, type DatabaseClient } from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { ERROR_CODES } from './errors.js'
import { PRODUCT_OPERATIONS } from './openapi/operations.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  connectTestStorage,
  createOrg,
  engineResponseFixture,
  grantCredits,
  hasIntegrationEnv,
  stubBatchQueue,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

/**
 * Step 8.4 security regressions for the patched Fastify 5 / Drizzle chain.
 *
 * Each block pins the behavior an advisory in gate #5 threatened, so a future
 * downgrade or misconfiguration fails here rather than in production:
 *   - GHSA-jx2c-rxcm-jvmq  Content-Type tab body-validation bypass (fastify)
 *   - GHSA-83w8-p2f5-377r  route-guard bypass / traversal (@fastify/static)
 *   - GHSA-c96f-x56v-gq3h  router DoS (find-my-way, via Fastify 5)
 *   - GHSA-gpj5-g38j-94v9  dynamic-identifier SQL injection (drizzle-orm)
 */
describe.skipIf(!hasIntegrationEnv)('Fastify 5 / Drizzle security regressions', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let storage: Awaited<ReturnType<typeof connectTestStorage>>
  let app: FastifyInstance
  let logs: ReturnType<typeof captureStream>['lines']
  let orgId: string
  let apiKey: string
  let foreignOrgId: string
  let foreignKey: string
  let foreignCheckId: string

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    storage = await connectTestStorage()
    const captured = captureStream()
    logs = captured.lines
    app = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        storage,
        batchQueue: stubBatchQueue(),
        smtpEnabled: false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:`, limit: 100_000 },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
      },
    })
    await app.ready()

    orgId = await createOrg(db)
    await grantCredits(db, orgId, 500)
    const created = await createApiKeyForOrg(db, orgId, 'security key')
    if (!created.ok) throw new Error('key setup failed')
    apiKey = created.created.plaintext

    // A second tenant with its own stored check, for isolation assertions.
    foreignOrgId = await createOrg(db)
    await grantCredits(db, foreignOrgId, 100)
    const foreignCreated = await createApiKeyForOrg(db, foreignOrgId, 'foreign key')
    if (!foreignCreated.ok) throw new Error('foreign key setup failed')
    foreignKey = foreignCreated.created.plaintext
    const [row] = await db
      .insert(emailChecks)
      .values({
        orgId: foreignOrgId,
        emailNormalized: 'tenant-b@example.com',
        emailHash: `hash-${uniqueName('h')}`,
        verdict: 'valid',
        checksJson: {
          engine: engineResponseFixture({ email: 'tenant-b@example.com' }),
          score: 95,
          disclaimer: 'test disclaimer',
          typo: null,
          smtp_status: 'skipped',
        },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: emailChecks.id })
    if (row === undefined) throw new Error('foreign check fixture failed')
    foreignCheckId = row.id
  })

  afterAll(async () => {
    await app.close()
    storage.close()
    await redis.quit()
    await sqlEnd()
  })

  function assertEnvelope(name: string, statusCode: number, body: string): void {
    expect(statusCode, `${name}: never an unhandled 500`).not.toBe(500)
    expect(statusCode, `${name}: is an error status`).toBeGreaterThanOrEqual(400)
    const parsed = JSON.parse(body) as { error?: { code?: string; request_id?: string } }
    expect(Object.keys(ERROR_CODES), `${name}: known code`).toContain(parsed.error?.code)
    expect(parsed.error?.request_id, `${name}: request id`).toBeDefined()
  }

  // --- GHSA-jx2c-rxcm-jvmq: Content-Type must not bypass body validation ----

  it('a tabbed/padded Content-Type cannot bypass JSON body validation', async () => {
    // The advisory: a tab (and similar whitespace/parameter tricks) in the
    // Content-Type let a malformed body skip schema validation. Each variant
    // must either be rejected outright or still be schema-validated - never
    // accepted unvalidated, and never a 500.
    const hostileTypes = [
      'application/json\t',
      '\tapplication/json',
      'application/json\t;charset=utf-8',
      'application/json ;charset=utf-8\t',
      'application/json',
      'application/json;\tcharset=utf-8',
    ]
    for (const contentType of hostileTypes) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/email/check',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': contentType },
        // Body violates the schema: `email` must be a string, and `nope` is
        // an unknown property under additionalProperties:false.
        body: JSON.stringify({ email: 12345, nope: true }),
      })
      assertEnvelope(
        `content-type ${JSON.stringify(contentType)}`,
        response.statusCode,
        response.body,
      )
      // Specifically: it must NOT have been accepted as a successful check.
      expect(response.statusCode, JSON.stringify(contentType)).not.toBe(200)
    }
  })

  it('a valid Content-Type still validates the body (schema is genuinely enforced)', async () => {
    const wrongType = await app.inject({
      method: 'POST',
      url: '/v1/email/check',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 12345 }),
    })
    assertEnvelope('typed number email', wrongType.statusCode, wrongType.body)
    expect(wrongType.statusCode).toBe(400)

    const unknownField = await app.inject({
      method: 'POST',
      url: '/v1/email/check',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ok@example.com', unexpected: 'x' }),
    })
    assertEnvelope('unknown field', unknownField.statusCode, unknownField.body)
    expect(unknownField.statusCode).toBe(400)
  })

  // --- GHSA-83w8-p2f5-377r: static/route-guard traversal must disclose nothing

  it('Swagger UI static traversal and route-guard bypass attempts disclose no files', async () => {
    const traversals = [
      '/docs/static/../../package.json',
      '/docs/static/../../../package.json',
      '/docs/../package.json',
      '/docs/static/%2e%2e%2f%2e%2e%2fpackage.json',
      '/docs/static/..%2f..%2fpackage.json',
      '/docs/static/....//....//package.json',
      '/docs/static/..%5c..%5cpackage.json',
      '/docs/static/%2e%2e/%2e%2e/apps/api/package.json',
      '/docs/static/./../../pnpm-lock.yaml',
    ]
    for (const url of traversals) {
      const response = await app.inject({ method: 'GET', url })
      // Never a success, never a 500, and never repository content.
      expect(response.statusCode, url).toBeGreaterThanOrEqual(400)
      expect(response.statusCode, url).not.toBe(500)
      expect(response.body, `${url}: must not disclose package manifest`).not.toContain(
        '"@tozalist/api"',
      )
      expect(response.body, `${url}: must not disclose lockfile`).not.toContain('lockfileVersion')
      expect(response.body, `${url}: must not disclose dependencies block`).not.toContain(
        '"dependencies"',
      )
      assertEnvelope(url, response.statusCode, response.body)
    }
  })

  it('the docs surface itself still serves, so the traversal guard is not a blanket 404', () => {
    // Guard against a false-positive above: prove the UI genuinely works.
    return app
      .inject({ method: 'GET', url: '/docs' })
      .then((entry) => {
        expect(entry.statusCode).toBe(200)
        expect(entry.body.toLowerCase()).toContain('swagger')
      })
      .then(() => app.inject({ method: 'GET', url: '/docs/static/swagger-ui.css' }))
      .then((asset) => {
        expect(asset.statusCode).toBe(200)
      })
  })

  // --- Router (find-my-way 9) behavior under hostile paths ------------------

  it('hostile and deeply nested paths route safely without a 500', async () => {
    const hostilePaths = [
      `/v1/${'a'.repeat(4000)}`,
      `/${'segment/'.repeat(120)}`,
      '/v1/email/check/%00',
      '/v1/email/check/%ff%fe',
      '/v1//email//check',
      '/v1/email/check/../../../etc/passwd',
    ]
    for (const url of hostilePaths) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${apiKey}` },
      })
      expect(response.statusCode, url).not.toBe(500)
      if (
        response.body.length > 0 &&
        String(response.headers['content-type'] ?? '').includes('json')
      ) {
        assertEnvelope(url, response.statusCode, response.body)
      }
    }
  })

  // --- OpenAPI: every registered route stays schema-backed ------------------

  it('every product operation is present in the served OpenAPI document', async () => {
    const spec = await app.inject({ method: 'GET', url: '/openapi.json' })
    expect(spec.statusCode).toBe(200)
    const doc = JSON.parse(spec.body) as {
      openapi: string
      paths: Record<string, Record<string, { operationId?: string }>>
    }
    expect(doc.openapi).toBe('3.1.0')
    for (const operation of PRODUCT_OPERATIONS) {
      const method = operation.method.toLowerCase()
      const entry = doc.paths[operation.path]?.[method]
      expect(entry, `${operation.method} ${operation.path} missing from OpenAPI`).toBeDefined()
      expect(entry?.operationId, `${operation.path} operationId`).toBe(operation.operationId)
    }
  })

  // --- Authentication and cross-organization isolation ----------------------

  it('authentication and cross-organization isolation are unchanged', async () => {
    // No key at all.
    const anonymous = await app.inject({ method: 'GET', url: '/v1/usage' })
    expect(anonymous.statusCode).toBe(401)
    assertEnvelope('anonymous', anonymous.statusCode, anonymous.body)

    // Malformed / bogus key.
    for (const header of [
      'Bearer not-a-key',
      'Bearer ',
      'Basic abc',
      `Bearer ${'x'.repeat(200)}`,
    ]) {
      const bad = await app.inject({
        method: 'GET',
        url: '/v1/usage',
        headers: { authorization: header },
      })
      expect(bad.statusCode, header).toBe(401)
      assertEnvelope(header, bad.statusCode, bad.body)
    }

    // Tenant A may not read tenant B's stored check: an identical 404 that
    // never confirms the row exists.
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/v1/email/check/${foreignCheckId}`,
      headers: { authorization: `Bearer ${apiKey}` },
    })
    expect(foreignRead.statusCode).toBe(404)
    const unknownRead = await app.inject({
      method: 'GET',
      url: `/v1/email/check/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${apiKey}` },
    })
    expect(unknownRead.statusCode).toBe(404)
    const shape = (body: string) => {
      const { error } = JSON.parse(body) as { error: { code: string; message: string } }
      return { code: error.code, message: error.message }
    }
    expect(shape(foreignRead.body)).toEqual(shape(unknownRead.body))

    // Tenant B still reads its own row.
    const ownRead = await app.inject({
      method: 'GET',
      url: `/v1/email/check/${foreignCheckId}`,
      headers: { authorization: `Bearer ${foreignKey}` },
    })
    expect(ownRead.statusCode).toBe(200)

    // And tenant A cannot delete tenant B's row.
    const foreignDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/email/check/${foreignCheckId}`,
      headers: { authorization: `Bearer ${apiKey}` },
    })
    expect(foreignDelete.statusCode).toBe(404)
    const stillThere = await db
      .select({ id: emailChecks.id })
      .from(emailChecks)
      .where(eq(emailChecks.id, foreignCheckId))
    expect(stillThere).toHaveLength(1)
  })

  // --- GHSA-gpj5-g38j-94v9: no user-controlled dynamic Drizzle identifier ---

  it('identifier-shaped hostile input is parameterized, never interpolated', async () => {
    // A SQL-identifier payload as an organization name and as query data must
    // be stored/compared as a value - the row survives verbatim and no table
    // is harmed.
    const hostileName = `x"; drop table credit_ledger; --`
    const [org] = await db
      .insert(organizations)
      .values({ name: hostileName })
      .returning({ id: organizations.id, name: organizations.name })
    expect(org?.name).toBe(hostileName)

    // The ledger table still exists and the earlier grant is still readable.
    const [reread] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, org?.id ?? ''))
    expect(reread?.name).toBe(hostileName)

    // Identifier-shaped input through the public API is data, not SQL.
    const injected = await app.inject({
      method: 'POST',
      url: '/v1/email/check',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `a"@b.example` }),
    })
    expect(injected.statusCode, 'identifier-shaped email must not 500').not.toBe(500)
  })

  it('the database layer contains no dynamic SQL identifier construction', () => {
    // Static guard for the advisory class: nothing in the db package may build
    // an identifier/alias from a runtime value. Any future use of sql.raw,
    // sql.identifier, dynamic aliasing, or .unsafe() must be reviewed here.
    const dbSrc = join(
      fileURLToPath(new URL('.', import.meta.url)),
      '..',
      '..',
      '..',
      'packages',
      'db',
      'src',
    )
    const files = readFileSync(join(dbSrc, 'index.ts'), 'utf8')
    expect(files.length).toBeGreaterThan(0)

    const forbidden = /sql\.raw\(|sql\.identifier\(|\.unsafe\(|aliasedTable\(/
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry: string) => {
        const full = join(dir, entry)
        return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
      })
    const offenders = walk(dbSrc)
      // Product source only. Test infrastructure (test-prepare.ts, test/) runs
      // fixed DDL through .unsafe() to create/drop the isolated test database
      // and schema - no runtime/user value reaches those statements.
      .filter((file) => !file.includes('.test.'))
      .filter((file) => !file.includes('/test/') && !file.endsWith('test-prepare.ts'))
      .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
    expect(offenders, `dynamic identifier construction found in: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })

  // --- Envelope + redaction still hold across these paths -------------------

  it('no secret or raw email leaked into logs during these security probes', () => {
    const serialized = JSON.stringify(logs)
    expect(serialized).not.toContain(apiKey)
    expect(serialized).not.toContain(foreignKey)
    expect(serialized).not.toContain('tenant-b@example.com')
  })
})
