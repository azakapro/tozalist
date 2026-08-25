import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditEvents,
  creditLedger,
  invoiceRequests,
  organizations,
  type DatabaseClient,
} from '@tozalist/db'
import { statementObjectKey, type ObjectStorage } from '@tozalist/shared'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { billingGrantCommand } from './cli/billing-grant.js'
import { billingStatementCommand } from './cli/billing-statement.js'
import { totpAt } from './internal/totp.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  connectTestStorage,
  createOrg,
  hasIntegrationEnv,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

const NOW_MS = Date.parse('2026-08-25T12:00:00.000Z')
const BANK_DETAILS = 'TEST-ONLY transfer instructions: pay invoice by bank transfer.'

describe.skipIf(!hasIntegrationEnv)('pilot billing (integration)', () => {
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
          billingBankDetails: BANK_DETAILS,
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

  type Client = { cookie: string; csrf: string; orgId: string }

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

  const get = (url: string, client?: Partial<Client>) =>
    app.inject({
      method: 'GET',
      url,
      headers: {
        origin: DASHBOARD_ORIGIN,
        ...(client?.cookie !== undefined ? { cookie: client.cookie } : {}),
      },
    })

  async function signupAndVerify(orgName: string): Promise<Client> {
    const email = `${uniqueName('admin')}@example.com`
    const signup = await post('/internal/signup', {
      org_name: orgName,
      email,
      password: 'a-long-password-123',
    })
    expect(signup.statusCode).toBe(200)
    const client = {
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

  // ---- CLI: billing:grant ---------------------------------------------------

  it('grant CLI: validates input, grants once, and refuses a replay', async () => {
    const orgId = await createOrg(db)
    const out: string[] = []
    const print = (line: string) => out.push(line)

    expect((await billingGrantCommand(db, ['--credits', '10'], print)).exitCode).toBe(2)
    expect(
      (await billingGrantCommand(db, ['--org', orgId, '--credits', '0', '--note', 'x'], print))
        .exitCode,
    ).toBe(2)
    expect(
      (await billingGrantCommand(db, ['--org', orgId, '--credits', '2.5', '--note', 'x'], print))
        .exitCode,
    ).toBe(2)
    expect(
      (await billingGrantCommand(db, ['--org', orgId, '--credits', '10', '--note', '  '], print))
        .exitCode,
    ).toBe(2)

    const args = ['--org', orgId, '--credits', '10000', '--note', 'Invoice INV-100 paid 2026-08-25']
    expect((await billingGrantCommand(db, args, print)).exitCode).toBe(0)
    // Replay: refused, still exactly one ledger row.
    expect((await billingGrantCommand(db, args, print)).exitCode).toBe(1)
    const rows = await db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.delta).toBe(10_000)

    // Output shows results only - no connection strings or secrets.
    const text = out.join('\n')
    expect(text).toContain('Credits granted')
    expect(text).not.toContain('postgres')
    expect(text).not.toContain('DATABASE_URL')
  })

  // ---- CLI: billing:statement ----------------------------------------------

  it('statement CLI: validates month and org, stores correct HTML in storage', async () => {
    const orgId = await createOrg(db)
    await db.insert(creditLedger).values([
      {
        orgId,
        delta: 5_000,
        reason: 'grant',
        createdAt: new Date('2026-07-20T00:00:00Z'),
        referenceId: `g-${orgId}`,
      },
      { orgId, delta: -400, reason: 'single_check', createdAt: new Date('2026-08-03T00:00:00Z') },
      {
        orgId,
        delta: -1_000,
        reason: 'batch_check',
        createdAt: new Date('2026-08-04T00:00:00Z'),
        note: '<script>alert(1)</script>',
      },
      { orgId, delta: 100, reason: 'refund', createdAt: new Date('2026-08-05T00:00:00Z') },
    ])
    const out: string[] = []
    const print = (line: string) => out.push(line)

    expect(
      (await billingStatementCommand(db, storage, ['--org', orgId, '--month', '2026-13'], print))
        .exitCode,
    ).toBe(2)
    expect(
      (
        await billingStatementCommand(
          db,
          storage,
          ['--org', randomUUID(), '--month', '2026-08'],
          print,
        )
      ).exitCode,
    ).toBe(1)
    expect(
      (await billingStatementCommand(db, storage, ['--org', orgId, '--month', '2026-08'], print))
        .exitCode,
    ).toBe(0)

    const stream = await storage.getStream(statementObjectKey(orgId, '2026-08'))
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
    const html = chunks.join('')
    expect(html).toContain('Opening balance</th><td>5000</td>')
    expect(html).toContain('Credits consumed (checks charged)</th><td>1400</td>')
    expect(html).toContain('Credits refunded</th><td>100</td>')
    expect(html).toContain('Closing balance</th><td>3700</td>')
    expect(html).toContain('Batches run</th><td>1</td>')
    // Operator note text is HTML-escaped, never active markup.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    // The CLI prints the object key, never a URL or credential.
    expect(out.join('\n')).not.toContain('http')
  })

  // ---- /internal/billing ----------------------------------------------------

  it('billing summary needs a session and returns ledger, balance, and statements', async () => {
    expect((await get('/internal/billing')).statusCode).toBe(401)

    const admin = await signupAndVerify(uniqueName('billing-org'))
    await db.insert(creditLedger).values([
      {
        orgId: admin.orgId,
        delta: 10_000,
        reason: 'grant',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        referenceId: `b-${admin.orgId}`,
      },
      {
        orgId: admin.orgId,
        delta: -2_500,
        reason: 'batch_check',
        createdAt: new Date('2026-08-10T00:00:00Z'),
      },
    ])
    await billingStatementCommand(
      db,
      storage,
      ['--org', admin.orgId, '--month', '2026-08'],
      () => {},
    )

    const response = await get('/internal/billing', admin)
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: Record<string, unknown> }).data
    expect(data.balance).toBe(7_500)
    expect(data.last_grant).toBe(10_000)
    expect(data.month_to_date).toEqual({
      credits_granted: 10_000,
      credits_consumed: 2_500,
      batches_run: 1,
    })
    expect(data.statements).toEqual(['2026-08'])
    expect((data.ledger as unknown[]).length).toBe(2)
  })

  it('invoice request: admin + CSRF, valid plan only, bank details from config only', async () => {
    const admin = await signupAndVerify(uniqueName('invoice-org'))

    expect(
      (await post('/internal/billing/invoice-request', { plan: 'TEAM' }, { cookie: admin.cookie }))
        .statusCode,
    ).toBe(401)
    expect(
      (await post('/internal/billing/invoice-request', { plan: 'GOLD' }, admin)).statusCode,
    ).toBe(400)

    const response = await post('/internal/billing/invoice-request', { plan: 'TEAM' }, admin)
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({
      plan: 'TEAM',
      price_uzs: 1_500_000,
      checks: 50_000,
      bank_details: BANK_DETAILS,
    })

    const rows = await db
      .select()
      .from(invoiceRequests)
      .where(eq(invoiceRequests.orgId, admin.orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.planCode).toBe('TEAM')
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'billing.invoice_requested'))
    const mine = audits.filter((event) => event.orgId === admin.orgId)
    expect(mine).toHaveLength(1)
    // Bank details are displayed to the requester, never audited or logged.
    expect(JSON.stringify(mine[0]?.metadata)).not.toContain('transfer')
    expect(JSON.stringify(logs)).not.toContain(BANK_DETAILS)
  })

  it('statement links are org-scoped, month-validated, and never logged or audited', async () => {
    const admin = await signupAndVerify(uniqueName('stmt-org'))
    const stranger = await signupAndVerify(uniqueName('stmt-stranger'))
    await db.insert(creditLedger).values({
      orgId: admin.orgId,
      delta: 1_000,
      reason: 'grant',
      createdAt: new Date('2026-08-02T00:00:00Z'),
      referenceId: `s-${admin.orgId}`,
    })
    await billingStatementCommand(
      db,
      storage,
      ['--org', admin.orgId, '--month', '2026-08'],
      () => {},
    )

    expect(
      (await post('/internal/billing/statements/link', { month: '2026-8' }, admin)).statusCode,
    ).toBe(400)
    expect(
      (await post('/internal/billing/statements/link', { month: '2026-99' }, admin)).statusCode,
    ).toBe(400)
    // The other org has no such statement: its own key simply does not exist.
    expect(
      (await post('/internal/billing/statements/link', { month: '2026-08' }, stranger)).statusCode,
    ).toBe(404)

    const response = await post('/internal/billing/statements/link', { month: '2026-08' }, admin)
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: { url: string; expires_at: string } }).data
    expect(data.url).toContain('http')
    expect(Date.parse(data.expires_at)).toBe(NOW_MS + 60 * 60 * 1000)

    // The signed link actually serves the statement, scoped to this org.
    const download = await fetch(data.url)
    expect(download.status).toBe(200)
    expect(await download.text()).toContain(admin.orgId)

    // Never logged, never audited.
    const serializedLogs = JSON.stringify(logs)
    expect(serializedLogs).not.toContain('X-Amz-Signature')
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'billing.statement_link'))
    const mine = audits.filter((event) => event.orgId === admin.orgId)
    expect(mine).toHaveLength(1)
    expect(JSON.stringify(mine[0])).not.toContain('X-Amz')
    expect(JSON.stringify(mine[0])).not.toContain(data.url)
  })
})
