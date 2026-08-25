import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import yauzl from 'yauzl'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditEvents,
  batches,
  createApiKeyForOrg,
  creditLedger,
  emailChecks,
  phoneChecks,
  organizations,
  type DatabaseClient,
} from '@tozalist/db'
import { STORAGE_DELETE_FAILED, type ObjectStorage } from '@tozalist/shared'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { totpAt } from './internal/totp.js'
import { neutralizeFormula } from './internal/data-export.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  connectTestStorage,
  createOrg,
  grantCredits,
  hasIntegrationEnv,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

/** Injected wall clock for the whole app; nothing here reads real time. */
const NOW_MS = Date.parse('2026-08-25T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function unzipNames(buffer: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, string>()
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError)
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks).toString('utf8'))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

describe.skipIf(!hasIntegrationEnv)('lifecycle endpoints (integration)', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let storage: ObjectStorage
  let app: FastifyInstance
  let logs: ReturnType<typeof captureStream>['lines']
  const DASHBOARD_ORIGIN = 'http://localhost:3002'

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
        smtpEnabled: false,
        storage,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
        internalAuth: {
          sessionSecret: 'test_session_secret_at_least_32_chars!',
          dashboardOrigin: DASHBOARD_ORIGIN,
          cookieSecure: false,
          clock: () => NOW_MS,
        },
      },
    })
  })

  afterAll(async () => {
    await app.close()
    storage.close()
    await redis.quit()
    await sqlEnd()
  })

  // ---- API-key harness -----------------------------------------------------

  async function apiHarness(): Promise<{ orgId: string; key: string; apiKeyId: string }> {
    const orgId = await createOrg(db)
    await grantCredits(db, orgId, 10)
    const created = await createApiKeyForOrg(db, orgId, 'lifecycle key')
    if (!created.ok) throw new Error('key setup failed')
    return { orgId, key: created.created.plaintext, apiKeyId: created.created.apiKeyId }
  }

  function seedEmailCheck(orgId: string, expiresInDays = 30): Promise<string> {
    return db
      .insert(emailChecks)
      .values({
        orgId,
        emailNormalized: `person-${randomUUID().slice(0, 8)}@example.com`,
        emailHash: `hash-${randomUUID()}`,
        verdict: 'valid',
        expiresAt: new Date(NOW_MS + expiresInDays * DAY_MS),
      })
      .returning({ id: emailChecks.id })
      .then((rows) => {
        const id = rows[0]?.id
        if (id === undefined) throw new Error('seed failed')
        return id
      })
  }

  const del = (url: string, key: string) =>
    app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${key}` } })

  // ---- DELETE /v1/email/check/{id} and /v1/phone/check/{id} -----------------

  it('deletes an owned email check immediately and audits with the API-key actor', async () => {
    const h = await apiHarness()
    const checkId = await seedEmailCheck(h.orgId)

    const response = await del(`/v1/email/check/${checkId}`, h.key)
    expect(response.statusCode).toBe(200)
    expect((response.json() as { data: { deleted: boolean; check_id: string } }).data).toEqual({
      deleted: true,
      check_id: checkId,
    })

    // The row is gone NOW, not at the next sweep.
    expect(await db.select().from(emailChecks).where(eq(emailChecks.id, checkId))).toHaveLength(0)

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.targetId, checkId))
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      action: 'check.deleted',
      targetType: 'email_check',
      orgId: h.orgId,
      actorApiKeyId: h.apiKeyId,
      actorUserId: null,
    })
  })

  it('deletes an owned phone check and refuses everything a GET cannot see', async () => {
    const h = await apiHarness()
    const foreign = await apiHarness()
    const [phone] = await db
      .insert(phoneChecks)
      .values({
        orgId: h.orgId,
        e164: '+998901234567',
        inputHash: `hash-${randomUUID()}`,
        valid: true,
        expiresAt: new Date(NOW_MS + DAY_MS),
      })
      .returning({ id: phoneChecks.id })
    if (phone === undefined) throw new Error('seed failed')
    const expired = await seedEmailCheck(h.orgId, -1)

    // Foreign key, expired row, unknown id: identical 404s, nothing deleted.
    const foreignAttempt = await del(`/v1/phone/check/${phone.id}`, foreign.key)
    expect(foreignAttempt.statusCode).toBe(404)
    const expiredAttempt = await del(`/v1/email/check/${expired}`, h.key)
    expect(expiredAttempt.statusCode).toBe(404)
    const unknownAttempt = await del(`/v1/email/check/${randomUUID()}`, h.key)
    expect(unknownAttempt.statusCode).toBe(404)
    const errorShape = (payload: unknown) => {
      const { error } = payload as { error: { code: string; message: string } }
      return { code: error.code, message: error.message }
    }
    expect(errorShape(foreignAttempt.json())).toEqual(errorShape(unknownAttempt.json()))
    expect(await db.select().from(phoneChecks).where(eq(phoneChecks.id, phone.id))).toHaveLength(1)

    // Malformed id: schema-level 400, not a lookup.
    expect((await del('/v1/phone/check/not-a-uuid', h.key)).statusCode).toBe(400)

    const owned = await del(`/v1/phone/check/${phone.id}`, h.key)
    expect(owned.statusCode).toBe(200)
    expect(await db.select().from(phoneChecks).where(eq(phoneChecks.id, phone.id))).toHaveLength(0)
  })

  // ---- dashboard session harness --------------------------------------------

  type Client = { cookie: string; csrf: string }

  function extractCookie(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
    if (raw === undefined) throw new Error('no session cookie set')
    return raw.split(';')[0] ?? ''
  }

  const post = (url: string, body: unknown, client?: Partial<Client>) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        ...(body !== null ? { 'content-type': 'application/json' } : {}),
        origin: DASHBOARD_ORIGIN,
        ...(client?.cookie !== undefined ? { cookie: client.cookie } : {}),
        ...(client?.csrf !== undefined ? { 'x-csrf-token': client.csrf } : {}),
      },
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    })

  async function signupAndVerify(orgName: string): Promise<Client & { orgId: string }> {
    const email = `${uniqueName('admin')}@example.com`
    const signup = await post('/internal/signup', {
      org_name: orgName,
      email,
      password: 'a-long-password-123',
    })
    expect(signup.statusCode).toBe(200)
    const client: Client = {
      cookie: extractCookie(signup.headers['set-cookie']),
      csrf: (signup.json() as { data: { csrf_token: string } }).data.csrf_token,
    }
    const enroll = await post('/internal/mfa/enroll', null, client)
    const secret = (enroll.json() as { data: { secret: string } }).data.secret
    const verify = await post('/internal/mfa/verify', { code: totpAt(secret, NOW_MS) }, client)
    expect(verify.statusCode).toBe(200)
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.name, orgName))
    if (org === undefined) throw new Error('signup org not found')
    return { cookie: extractCookie(verify.headers['set-cookie']), csrf: client.csrf, orgId: org.id }
  }

  async function seedOrgData(orgId: string): Promise<{ email: string; batchKey: string }> {
    const email = `export-${randomUUID().slice(0, 8)}@example.com`
    await db.insert(emailChecks).values({
      orgId,
      emailNormalized: email,
      emailHash: `hash-${randomUUID()}`,
      verdict: 'risky',
      expiresAt: new Date(NOW_MS + 30 * DAY_MS),
    })
    await db.insert(phoneChecks).values({
      orgId,
      e164: '+998907654321',
      inputHash: `hash-${randomUUID()}`,
      valid: true,
      expiresAt: new Date(NOW_MS + 30 * DAY_MS),
    })
    const batchId = randomUUID()
    const batchKey = `org/${orgId}/batches/${batchId}/input.csv`
    await storage.uploadStream(batchKey, Readable.from(['email\na@b.c\n']))
    await db.insert(batches).values({
      id: batchId,
      orgId,
      filename: 'subscribers.csv',
      inputObjectKey: batchKey,
      expiresAt: new Date(NOW_MS + 30 * DAY_MS),
    })
    await grantCredits(db, orgId, 100)
    return { email, batchKey }
  }

  // ---- POST /internal/export -------------------------------------------------

  it('exports every category as a ZIP behind a 24-hour signed link, own org only', async () => {
    const admin = await signupAndVerify(uniqueName('export-org'))
    const seeded = await seedOrgData(admin.orgId)
    // A second organisation whose data must NOT leak into the export.
    const other = await apiHarness()
    const otherEmail = `foreign-${randomUUID().slice(0, 8)}@example.com`
    await db.insert(emailChecks).values({
      orgId: other.orgId,
      emailNormalized: otherEmail,
      emailHash: `hash-${randomUUID()}`,
      verdict: 'valid',
      expiresAt: new Date(NOW_MS + 30 * DAY_MS),
    })

    const response = await post('/internal/export', null, admin)
    expect(response.statusCode).toBe(200)
    const data = (
      response.json() as { data: { export_id: string; url: string; expires_at: string } }
    ).data
    expect(Date.parse(data.expires_at)).toBe(NOW_MS + 24 * 60 * 60 * 1000)
    expect(data.url).toContain('http')

    // The signed link actually serves the ZIP (real MinIO round trip).
    const download = await fetch(data.url)
    expect(download.status).toBe(200)
    const zipEntries = await unzipNames(Buffer.from(await download.arrayBuffer()))
    expect([...zipEntries.keys()].sort()).toEqual([
      'audit_events.csv',
      'batches.csv',
      'credit_ledger.csv',
      'email_checks.csv',
      'phone_checks.csv',
    ])
    expect(zipEntries.get('email_checks.csv')).toContain(seeded.email)
    expect(zipEntries.get('phone_checks.csv')).toContain('+998907654321')
    expect(zipEntries.get('batches.csv')).toContain('subscribers.csv')
    expect(zipEntries.get('credit_ledger.csv')).toContain('grant')
    expect(zipEntries.get('audit_events.csv')).toContain('user.mfa_verified')
    // Authorization scope: not one byte of the other organisation's data.
    const allContent = [...zipEntries.values()].join('\n')
    expect(allContent).not.toContain(otherEmail)
    expect(allContent).not.toContain(other.orgId)

    // Audited without the credential-bearing URL, and never logged.
    const exportAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'data.exported'))
    const mine = exportAudits.filter((event) => event.orgId === admin.orgId)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.metadata).toMatchObject({ export_id: data.export_id })
    expect(JSON.stringify(mine[0]?.metadata)).not.toContain('X-Amz')
    const serializedLogs = JSON.stringify(logs)
    expect(serializedLogs).not.toContain('X-Amz-Signature')
    expect(serializedLogs).not.toContain(data.export_id)
  })

  it('export requires an admin session with CSRF', async () => {
    const admin = await signupAndVerify(uniqueName('export-csrf'))
    const noCsrf = await post('/internal/export', null, { cookie: admin.cookie })
    expect(noCsrf.statusCode).toBe(401)
    const noSession = await post('/internal/export', null)
    expect(noSession.statusCode).toBe(401)
  })

  // ---- POST /internal/checks/delete-all --------------------------------------

  it('wipes all check data immediately after typed confirmation, sparing the ledger', async () => {
    const admin = await signupAndVerify(uniqueName('wipe-org'))
    const seeded = await seedOrgData(admin.orgId)

    // Wrong confirmation: 400, and absolutely nothing changes.
    const refused = await post('/internal/checks/delete-all', { confirm: 'delete' }, admin)
    expect(refused.statusCode).toBe(400)
    expect(
      await db.select().from(emailChecks).where(eq(emailChecks.orgId, admin.orgId)),
    ).toHaveLength(1)

    const response = await post('/internal/checks/delete-all', { confirm: 'DELETE' }, admin)
    expect(response.statusCode).toBe(200)
    expect((response.json() as { data: Record<string, unknown> }).data).toMatchObject({
      deleted: true,
      email_checks: 1,
      phone_checks: 1,
      batches: 1,
    })

    // Immediate: rows and objects are gone the moment the response returns.
    expect(
      await db.select().from(emailChecks).where(eq(emailChecks.orgId, admin.orgId)),
    ).toHaveLength(0)
    expect(
      await db.select().from(phoneChecks).where(eq(phoneChecks.orgId, admin.orgId)),
    ).toHaveLength(0)
    expect(await db.select().from(batches).where(eq(batches.orgId, admin.orgId))).toHaveLength(0)
    await expect(storage.getStream(seeded.batchKey)).rejects.toThrow()

    // The ledger is untouched; the wipe is audited with counts only.
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.orgId, admin.orgId))
    expect(ledger.length).toBeGreaterThan(0)
    const wipes = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'check_data.deleted'))
    const mine = wipes.filter((event) => event.orgId === admin.orgId)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.metadata).toMatchObject({ email_checks: 1, phone_checks: 1, batches: 1 })
    expect(mine[0]?.actorUserId).not.toBeNull()
  })

  it('a storage failure fails the wipe closed: 500, rows intact, nothing audited', async () => {
    const admin = await signupAndVerify(uniqueName('wipe-fault'))
    const seeded = await seedOrgData(admin.orgId)

    // A second app over the same session secret, with storage that refuses
    // deletions the way the shared layer surfaces a partial S3 response.
    const faulty: ObjectStorage = {
      ...storage,
      deleteObjects: () => Promise.reject(new Error(STORAGE_DELETE_FAILED)),
    }
    const captured = captureStream()
    const faultyApp = buildApp({
      logger: { stream: captured.stream },
      deps: {
        db,
        redis,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        smtpEnabled: false,
        storage: faulty,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
        internalAuth: {
          sessionSecret: 'test_session_secret_at_least_32_chars!',
          dashboardOrigin: DASHBOARD_ORIGIN,
          cookieSecure: false,
          clock: () => NOW_MS,
        },
      },
    })
    try {
      const response = await faultyApp.inject({
        method: 'POST',
        url: '/internal/checks/delete-all',
        headers: {
          'content-type': 'application/json',
          origin: DASHBOARD_ORIGIN,
          cookie: admin.cookie,
          'x-csrf-token': admin.csrf,
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      })
      expect(response.statusCode).toBe(500)
      expect((response.json() as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR')

      // No false success: every row survives, the object survives, no audit.
      expect(
        await db.select().from(emailChecks).where(eq(emailChecks.orgId, admin.orgId)),
      ).toHaveLength(1)
      expect(await db.select().from(batches).where(eq(batches.orgId, admin.orgId))).toHaveLength(1)
      await expect(storage.getStream(seeded.batchKey)).resolves.toBeDefined()
      const audits = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'check_data.deleted'))
      expect(audits.filter((event) => event.orgId === admin.orgId)).toHaveLength(0)
      // The failure log names the error class only - no keys, no customer data.
      const serialized = JSON.stringify(captured.lines)
      expect(serialized).not.toContain(seeded.batchKey)
      expect(serialized).not.toContain(seeded.email)

      // The wipe is retryable: the healthy app completes it.
      const retry = await post('/internal/checks/delete-all', { confirm: 'DELETE' }, admin)
      expect(retry.statusCode).toBe(200)
      expect(
        await db.select().from(emailChecks).where(eq(emailChecks.orgId, admin.orgId)),
      ).toHaveLength(0)
      await expect(storage.getStream(seeded.batchKey)).rejects.toThrow()
    } finally {
      await faultyApp.close()
    }
  })

  it('neutralizes spreadsheet formulas in export cells while leaving ordinary values intact', async () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1")
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(neutralizeFormula('-2+3')).toBe("'-2+3")
    expect(neutralizeFormula('plain value')).toBe('plain value')

    const admin = await signupAndVerify(uniqueName('formula-org'))
    // Customer-controlled values that spreadsheets would execute as formulas.
    const hostileEmail = '=cmd@example.com'
    await db.insert(emailChecks).values({
      orgId: admin.orgId,
      emailNormalized: hostileEmail,
      emailHash: `hash-${randomUUID()}`,
      verdict: 'valid',
      expiresAt: new Date(NOW_MS + 30 * DAY_MS),
    })
    const batchId = randomUUID()
    await db.insert(batches).values({
      id: batchId,
      orgId: admin.orgId,
      filename: '=HYPERLINK("http://evil.example")',
      inputObjectKey: `org/${admin.orgId}/batches/${batchId}/input.csv`,
      expiresAt: new Date(NOW_MS + 30 * DAY_MS),
    })
    await db.insert(auditEvents).values({
      orgId: admin.orgId,
      action: 'test.formula',
      targetType: 'test',
      targetId: '@IMPORTDATA("http://evil.example")',
      expiresAt: new Date(NOW_MS + 30 * DAY_MS),
    })
    await grantCredits(db, admin.orgId, 5)

    const response = await post('/internal/export', null, admin)
    expect(response.statusCode).toBe(200)
    const url = (response.json() as { data: { url: string } }).data.url
    const download = await fetch(url)
    const zipEntries = await unzipNames(Buffer.from(await download.arrayBuffer()))

    // Every formula-shaped customer value is inert behind an apostrophe...
    expect(zipEntries.get('email_checks.csv')).toContain(`'${hostileEmail}`)
    expect(zipEntries.get('batches.csv')).toContain(`"'=HYPERLINK(""http://evil.example"")"`)
    expect(zipEntries.get('audit_events.csv')).toContain(`'@IMPORTDATA`)
    const allContent = [...zipEntries.values()].join('\n')
    expect(allContent).not.toMatch(/^=/m)
    expect(allContent).not.toMatch(/^@/m)
    // ...while ordinary cells and numeric ledger deltas are untouched.
    expect(zipEntries.get('credit_ledger.csv')).toContain('5,grant')
    expect(zipEntries.get('email_checks.csv')).toContain('valid')
  })
})
