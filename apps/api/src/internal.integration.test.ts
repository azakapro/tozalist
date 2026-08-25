import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditEvents, organizations, users, type DatabaseClient } from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { base32Encode, totpAt, verifyTotp } from './internal/totp.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  hasIntegrationEnv,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    expect(totpAt(secret, 59_000)).toBe('287082')
    expect(totpAt(secret, 1_111_111_109_000)).toBe('081804')
    expect(totpAt(secret, 1_234_567_890_000)).toBe('005924')
  })

  it('accepts ±1 step of drift and rejects stale codes and junk', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    const now = 1_700_000_000_000
    const code = totpAt(secret, now)
    if (code === null) throw new Error('no code')
    expect(verifyTotp(secret, code, now + 30_000)).toBe(true)
    expect(verifyTotp(secret, code, now + 90_000)).toBe(false)
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false)
    expect(verifyTotp('!!!!', '123456', now)).toBe(false)
  })
})

describe.skipIf(!hasIntegrationEnv)('internal dashboard auth', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let app: FastifyInstance
  let logs: ReturnType<typeof captureStream>['lines']
  const DASHBOARD_ORIGIN = 'http://localhost:3002'
  const nowMs = Date.now()

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
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        internalAuth: {
          sessionSecret: 'test_session_secret_at_least_32_chars!',
          dashboardOrigin: DASHBOARD_ORIGIN,
          cookieSecure: false,
          clock: () => nowMs,
        },
      },
    })
  })

  afterAll(async () => {
    await app.close()
    await redis.quit()
    await sqlEnd()
  })

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

  const get = (url: string, client?: Partial<Client>) =>
    app.inject({
      method: 'GET',
      url,
      headers: {
        origin: DASHBOARD_ORIGIN,
        ...(client?.cookie !== undefined ? { cookie: client.cookie } : {}),
      },
    })

  async function signupAndVerify(
    orgName: string,
  ): Promise<Client & { email: string; recovery: string[] }> {
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
    expect(enroll.statusCode).toBe(200)
    const enrollment = (
      enroll.json() as {
        data: { secret: string; otpauth_uri: string; recovery_codes: string[] }
      }
    ).data
    expect(enrollment.recovery_codes).toHaveLength(10)
    expect(enrollment.otpauth_uri).toContain('otpauth://totp/')

    const code = totpAt(enrollment.secret, nowMs)
    const verify = await post('/internal/mfa/verify', { code }, client)
    expect(verify.statusCode).toBe(200)

    // The verify response re-seals the session with mfaVerified=true; the
    // client must adopt that cookie exactly like a browser would.
    return {
      cookie: extractCookie(verify.headers['set-cookie']),
      csrf: client.csrf,
      email,
      recovery: enrollment.recovery_codes,
    }
  }

  // ---- signup / login / logout ----------------------------------------------

  it('signup creates org + admin, requires MFA setup, and audits both creations', async () => {
    const orgName = uniqueName('org')
    const email = `${uniqueName('admin')}@example.com`
    const response = await post('/internal/signup', {
      org_name: orgName,
      email,
      password: 'a-long-password-123',
    })
    expect(response.statusCode).toBe(200)
    expect(
      (response.json() as { data: { mfa_setup_required: boolean } }).data.mfa_setup_required,
    ).toBe(true)

    // Cookie flags: httpOnly + SameSite=Lax.
    const rawCookie = String(
      Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie'][0]
        : response.headers['set-cookie'],
    )
    expect(rawCookie).toContain('HttpOnly')
    expect(rawCookie).toContain('SameSite=Lax')

    const [user] = await db.select().from(users).where(eq(users.email, email))
    expect(user?.role).toBe('admin')
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/)

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.orgId, user?.orgId ?? ''))
    const actions = audits.map((event) => event.action)
    expect(actions).toContain('org.created')
    expect(actions).toContain('user.created')
  })

  it('signup rejects a duplicate email without enumerating details elsewhere', async () => {
    const email = `${uniqueName('dupe')}@example.com`
    await post('/internal/signup', {
      org_name: uniqueName('o'),
      email,
      password: 'a-long-password-123',
    })
    const again = await post('/internal/signup', {
      org_name: uniqueName('o'),
      email,
      password: 'a-long-password-123',
    })
    expect(again.statusCode).toBe(400)
  })

  it('full flow: enroll, verify, access protected data, logout', async () => {
    const client = await signupAndVerify(uniqueName('org'))

    const overview = await get('/internal/overview', client)
    expect(overview.statusCode).toBe(200)
    const data = (overview.json() as { data: Record<string, unknown> }).data
    expect(data).toHaveProperty('credits')
    expect(data).toHaveProperty('checks_this_month')
    expect(data).toHaveProperty('recent_batches')
    expect(data).toHaveProperty('recent_activity')

    const logout = await post('/internal/logout', null, client)
    expect(logout.statusCode).toBe(200)
    const cleared = extractCookie(logout.headers['set-cookie'])
    expect(cleared.endsWith('=')).toBe(true)
  })

  it('login requires MFA when enrolled; wrong password and unknown email look identical', async () => {
    const client = await signupAndVerify(uniqueName('org'))

    const login = await post('/internal/login', {
      email: client.email,
      password: 'a-long-password-123',
    })
    expect(login.statusCode).toBe(200)
    const body = login.json() as { data: { mfa_required: boolean; csrf_token: string } }
    expect(body.data.mfa_required).toBe(true)

    // MFA-gated data is refused until the code is presented.
    const fresh: Client = {
      cookie: extractCookie(login.headers['set-cookie']),
      csrf: body.data.csrf_token,
    }
    expect((await get('/internal/overview', fresh)).statusCode).toBe(401)

    const wrongPassword = await post('/internal/login', {
      email: client.email,
      password: 'wrong-password-xx',
    })
    const unknownEmail = await post('/internal/login', {
      email: 'ghost@example.com',
      password: 'wrong-password-xx',
    })
    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownEmail.statusCode).toBe(401)
    expect((wrongPassword.json() as { error: { message: string } }).error.message).toBe(
      (unknownEmail.json() as { error: { message: string } }).error.message,
    )
  })

  it('a fresh login completes MFA with a TOTP code', async () => {
    const client = await signupAndVerify(uniqueName('org'))
    const [user] = await db.select().from(users).where(eq(users.email, client.email))
    const secret = user?.mfaSecret ?? ''

    const login = await post('/internal/login', {
      email: client.email,
      password: 'a-long-password-123',
    })
    const fresh: Client = {
      cookie: extractCookie(login.headers['set-cookie']),
      csrf: (login.json() as { data: { csrf_token: string } }).data.csrf_token,
    }
    const wrong = await post('/internal/mfa/verify', { code: '000000' }, fresh)
    expect(wrong.statusCode).toBe(401)

    const verify = await post('/internal/mfa/verify', { code: totpAt(secret, nowMs) }, fresh)
    expect(verify.statusCode).toBe(200)
    const verified: Client = { ...fresh, cookie: extractCookie(verify.headers['set-cookie']) }
    expect((await get('/internal/overview', verified)).statusCode).toBe(200)
  })

  // ---- recovery codes --------------------------------------------------------

  it('recovery codes verify MFA and are strictly single-use', async () => {
    const client = await signupAndVerify(uniqueName('org'))
    const code = client.recovery[0]
    if (code === undefined) throw new Error('no recovery code')

    const login = await post('/internal/login', {
      email: client.email,
      password: 'a-long-password-123',
    })
    const fresh: Client = {
      cookie: extractCookie(login.headers['set-cookie']),
      csrf: (login.json() as { data: { csrf_token: string } }).data.csrf_token,
    }
    const first = await post('/internal/mfa/verify', { code }, fresh)
    expect(first.statusCode).toBe(200)

    // The very same code again, on a new login: refused.
    const login2 = await post('/internal/login', {
      email: client.email,
      password: 'a-long-password-123',
    })
    const fresh2: Client = {
      cookie: extractCookie(login2.headers['set-cookie']),
      csrf: (login2.json() as { data: { csrf_token: string } }).data.csrf_token,
    }
    const second = await post('/internal/mfa/verify', { code }, fresh2)
    expect(second.statusCode).toBe(401)

    // Only hashes are stored, and one fewer than issued.
    const [user] = await db.select().from(users).where(eq(users.email, client.email))
    expect(user?.mfaRecoveryCodes).toHaveLength(9)
    expect(JSON.stringify(user?.mfaRecoveryCodes)).not.toContain(code)
  })

  // ---- API keys through the dashboard ----------------------------------------

  it('key creation shows the plaintext once; the list shows prefixes only', async () => {
    const client = await signupAndVerify(uniqueName('org'))
    const created = await post('/internal/keys', { name: 'dashboard key' }, client)
    expect(created.statusCode).toBe(200)
    const key = (
      created.json() as { data: { key_id: string; plaintext_key: string; key_prefix: string } }
    ).data
    expect(key.plaintext_key).toMatch(/^tzl_live_[0-9A-Za-z]{32}$/)

    const list = await get('/internal/keys', client)
    expect(list.statusCode).toBe(200)
    expect(list.body).not.toContain(key.plaintext_key)
    const listed = (list.json() as { data: { keys: Array<{ key_prefix: string }> } }).data.keys
    expect(listed.some((entry) => entry.key_prefix === key.key_prefix)).toBe(true)

    // The plaintext key authenticates against the public API...
    const v1 = await app.inject({
      method: 'GET',
      url: '/v1/usage',
      headers: { authorization: `Bearer ${key.plaintext_key}` },
    })
    expect(v1.statusCode).toBe(200)

    // ...until revoked through the dashboard, which blocks API use.
    const revoke = await post(`/internal/keys/${key.key_id}/revoke`, null, client)
    expect(revoke.statusCode).toBe(200)
    const blocked = await app.inject({
      method: 'GET',
      url: '/v1/usage',
      headers: { authorization: `Bearer ${key.plaintext_key}` },
    })
    expect(blocked.statusCode).toBe(401)

    // Foreign key ids are a plain 404.
    const foreign = await post(`/internal/keys/${randomUUID()}/revoke`, null, client)
    expect(foreign.statusCode).toBe(404)
  })

  // ---- CSRF and settings ------------------------------------------------------

  it('mutations without the CSRF token are refused', async () => {
    const client = await signupAndVerify(uniqueName('org'))
    const noToken = await post('/internal/keys', { name: 'no csrf' }, { cookie: client.cookie })
    expect(noToken.statusCode).toBe(401)
    const wrongToken = await post(
      '/internal/keys',
      { name: 'bad csrf' },
      { cookie: client.cookie, csrf: 'forged' },
    )
    expect(wrongToken.statusCode).toBe(401)
  })

  it('CORS is locked to the dashboard origin', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/internal/login',
      headers: {
        origin: DASHBOARD_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    })
    expect(allowed.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN)
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')

    const foreign = await app.inject({
      method: 'OPTIONS',
      url: '/internal/login',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    })
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('settings update retention within 7/30/90 and org deletion needs the exact name', async () => {
    const orgName = uniqueName('org')
    const client = await signupAndVerify(orgName)

    expect((await post('/internal/settings', { retention_days: 90 }, client)).statusCode).toBe(200)
    expect((await post('/internal/settings', { retention_days: 45 }, client)).statusCode).toBe(400)
    const settings = await get('/internal/settings', client)
    expect((settings.json() as { data: { retention_days: number } }).data.retention_days).toBe(90)

    const wrongName = await post('/internal/org/delete', { confirm_name: 'not the name' }, client)
    expect(wrongName.statusCode).toBe(400)

    const deleted = await post('/internal/org/delete', { confirm_name: orgName }, client)
    expect(deleted.statusCode).toBe(200)
    const [org] = await db.select().from(organizations).where(eq(organizations.name, orgName))
    expect(org?.deletedAt).not.toBeNull()

    // Soft-deleted org: the session is gone and login is refused.
    expect((await get('/internal/overview', client)).statusCode).toBe(401)
    const login = await post('/internal/login', {
      email: client.email,
      password: 'a-long-password-123',
    })
    expect(login.statusCode).toBe(401)
  })

  it('logs and audit records never contain passwords, secrets, codes, or key plaintext', async () => {
    const client = await signupAndVerify(uniqueName('org'))
    const created = await post('/internal/keys', { name: 'leak check' }, client)
    const plaintext = (created.json() as { data: { plaintext_key: string } }).data.plaintext_key
    const [user] = await db.select().from(users).where(eq(users.email, client.email))

    const rawLogs = JSON.stringify(logs)
    expect(rawLogs).not.toContain('a-long-password-123')
    expect(rawLogs).not.toContain(plaintext)
    expect(rawLogs).not.toContain(user?.mfaSecret ?? 'IMPOSSIBLE')
    for (const code of client.recovery) {
      expect(rawLogs).not.toContain(code)
    }

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.orgId, user?.orgId ?? ''))
    const rawAudits = JSON.stringify(audits)
    expect(rawAudits).not.toContain('a-long-password-123')
    expect(rawAudits).not.toContain(plaintext)
    expect(rawAudits).not.toContain(user?.mfaSecret ?? 'IMPOSSIBLE')
  })

  it('audit events attribute the real dashboard user and cover logout and MFA', async () => {
    const client = await signupAndVerify(uniqueName('org'))
    const [user] = await db.select().from(users).where(eq(users.email, client.email))
    const userId = user?.id ?? ''
    const secret = user?.mfaSecret ?? ''
    const orgId = user?.orgId ?? ''

    // Dashboard key creation and revocation.
    const created = await post('/internal/keys', { name: 'attribution key' }, client)
    const key = (created.json() as { data: { key_id: string; plaintext_key: string } }).data
    await post(`/internal/keys/${key.key_id}/revoke`, null, client)

    // A fresh login verified via TOTP, then one via a recovery code.
    const login1 = await post('/internal/login', {
      email: client.email,
      password: 'a-long-password-123',
    })
    const c1: Client = {
      cookie: extractCookie(login1.headers['set-cookie']),
      csrf: (login1.json() as { data: { csrf_token: string } }).data.csrf_token,
    }
    const totpVerify = await post('/internal/mfa/verify', { code: totpAt(secret, nowMs) }, c1)
    expect(totpVerify.statusCode).toBe(200)

    const recovery = client.recovery[1]
    if (recovery === undefined) throw new Error('no recovery code')
    const login2 = await post('/internal/login', {
      email: client.email,
      password: 'a-long-password-123',
    })
    const c2: Client = {
      cookie: extractCookie(login2.headers['set-cookie']),
      csrf: (login2.json() as { data: { csrf_token: string } }).data.csrf_token,
    }
    const recoveryVerify = await post('/internal/mfa/verify', { code: recovery }, c2)
    expect(recoveryVerify.statusCode).toBe(200)

    // Logout, from the recovery-verified session.
    const verifiedC2: Client = {
      ...c2,
      cookie: extractCookie(recoveryVerify.headers['set-cookie']),
    }
    expect((await post('/internal/logout', null, verifiedC2)).statusCode).toBe(200)

    const events = await db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId))

    // Key creation/revocation: actor is the USER; the key is the target only.
    const createdEvent = events.find(
      (event) => event.action === 'api_key.created' && event.targetId === key.key_id,
    )
    expect(createdEvent?.actorUserId).toBe(userId)
    expect(createdEvent?.actorApiKeyId).toBeNull()
    const revokedEvent = events.find(
      (event) => event.action === 'api_key.revoked' && event.targetId === key.key_id,
    )
    expect(revokedEvent?.actorUserId).toBe(userId)
    expect(revokedEvent?.actorApiKeyId).toBeNull()

    // MFA verification: one totp, at least one recovery_code (signup's initial
    // verification also records totp), always attributed to the user.
    const mfaEvents = events.filter((event) => event.action === 'user.mfa_verified')
    const methods = mfaEvents.map((event) => (event.metadata as { method: string }).method)
    expect(methods).toContain('totp')
    expect(methods).toContain('recovery_code')
    for (const event of mfaEvents) {
      expect(event.actorUserId).toBe(userId)
      expect(event.targetId).toBe(userId)
    }

    // Logout: attributed, targeted at the user.
    const logoutEvent = events.find((event) => event.action === 'user.logout')
    expect(logoutEvent?.actorUserId).toBe(userId)
    expect(logoutEvent?.targetId).toBe(userId)

    // No sensitive material anywhere in the audit JSON.
    const rawAudits = JSON.stringify(events)
    expect(rawAudits).not.toContain('a-long-password-123')
    expect(rawAudits).not.toContain(key.plaintext_key)
    expect(rawAudits).not.toContain(secret)
    for (const code of client.recovery) {
      expect(rawAudits).not.toContain(code)
    }
    expect(rawAudits).not.toContain(client.csrf)
  })

  it('internal routes never appear in the public OpenAPI document', async () => {
    const spec = await app.inject({ method: 'GET', url: '/openapi.json' })
    expect(spec.body).not.toContain('/internal')
  })
})

describe.skipIf(!hasIntegrationEnv)('internal product endpoints', () => {
  // Reuses the outer describe's app/db via a fresh setup, kept lean.
  let db2: DatabaseClient
  let sqlEnd2: () => Promise<void>
  let redis2: Redis
  let app2: FastifyInstance
  const ORIGIN = 'http://localhost:3002'

  beforeAll(() => {
    const connection = connectTestDb()
    db2 = connection.db
    sqlEnd2 = () => connection.sql.end()
    redis2 = connectTestRedis()
    app2 = buildApp({
      deps: {
        db: db2,
        redis: redis2,
        engine: stubEngine(),
        smtpQueue: stubQueue(),
        smtpEnabled: false,
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
        balanceCache: { keyPrefix: `${uniqueName('bal')}:` },
        internalAuth: {
          sessionSecret: 'test_session_secret_at_least_32_chars!',
          dashboardOrigin: ORIGIN,
          cookieSecure: false,
        },
      },
    })
  })

  afterAll(async () => {
    await app2.close()
    await redis2.quit()
    await sqlEnd2()
  })

  function cookieOf(response: { headers: Record<string, unknown> }): string {
    const raw = response.headers['set-cookie']
    const first = Array.isArray(raw) ? raw[0] : raw
    return String(first).split(';')[0] ?? ''
  }

  async function verifiedClient(): Promise<{ cookie: string; csrf: string; orgId: string }> {
    const email = `${uniqueName('ui')}@example.com`
    const signup = await app2.inject({
      method: 'POST',
      url: '/internal/signup',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ org_name: uniqueName('org'), email, password: 'a-long-password-123' }),
    })
    const csrf = (signup.json() as { data: { csrf_token: string } }).data.csrf_token
    let cookie = cookieOf(signup)
    const enroll = await app2.inject({
      method: 'POST',
      url: '/internal/mfa/enroll',
      headers: { origin: ORIGIN, cookie, 'x-csrf-token': csrf },
    })
    const secret = (enroll.json() as { data: { secret: string } }).data.secret
    const verify = await app2.inject({
      method: 'POST',
      url: '/internal/mfa/verify',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie, 'x-csrf-token': csrf },
      body: JSON.stringify({ code: totpAt(secret, Date.now()) }),
    })
    cookie = cookieOf(verify)
    const [user] = await db2.select().from(users).where(eq(users.email, email))
    // Fund the org for check/batch work.
    const { creditLedger } = await import('@tozalist/db')
    await db2.insert(creditLedger).values({
      orgId: user?.orgId ?? '',
      delta: 100,
      reason: 'grant',
      referenceId: `ui-grant-${randomUUID()}`,
    })
    return { cookie, csrf, orgId: user?.orgId ?? '' }
  }

  it('email and phone checks work through the session with identical crediting', async () => {
    const client = await verifiedClient()
    const emailCheck = await app2.inject({
      method: 'POST',
      url: '/internal/check/email',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: client.cookie,
        'x-csrf-token': client.csrf,
      },
      body: JSON.stringify({ email: 'ui.user@dash.test' }),
    })
    expect(emailCheck.statusCode).toBe(200)
    const emailBody = emailCheck.json() as {
      data: Record<string, unknown>
      meta: Record<string, unknown>
    }
    expect(emailBody.data).toHaveProperty('verdict')
    expect(emailBody.data).toHaveProperty('reason_explanations')
    expect(emailBody.data).toHaveProperty('disclaimer')
    expect(emailBody.meta).toMatchObject({ credits_used: 1, credits_remaining: 99 })

    const phoneCheck = await app2.inject({
      method: 'POST',
      url: '/internal/check/phone',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: client.cookie,
        'x-csrf-token': client.csrf,
      },
      body: JSON.stringify({ phone: '+998901234567' }),
    })
    expect(phoneCheck.statusCode).toBe(200)
    expect((phoneCheck.json() as { data: { limitation: string } }).data.limitation).toContain(
      'format validation only',
    )

    // CSRF still enforced on the product surface.
    const noCsrf = await app2.inject({
      method: 'POST',
      url: '/internal/check/email',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: client.cookie },
      body: JSON.stringify({ email: 'x@y.test' }),
    })
    expect(noCsrf.statusCode).toBe(401)
  })

  it('usage returns running balances that add up and per-day counts', async () => {
    const client = await verifiedClient()
    await app2.inject({
      method: 'POST',
      url: '/internal/check/email',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: client.cookie,
        'x-csrf-token': client.csrf,
      },
      body: JSON.stringify({ email: `${uniqueName('u')}@usage.test` }),
    })

    const usage = await app2.inject({
      method: 'GET',
      url: '/internal/usage',
      headers: { origin: ORIGIN, cookie: client.cookie },
    })
    expect(usage.statusCode).toBe(200)
    const body = usage.json() as {
      data: {
        balance: number
        ledger: Array<{ delta: number; running_balance: number }>
        checks_per_day: Array<{ day: string; count: number }>
      }
    }
    expect(body.data.balance).toBe(99)
    // Newest entry's running balance equals the current balance.
    expect(body.data.ledger[0]?.running_balance).toBe(99)
    // Each row's running balance = previous row's minus its delta (descending).
    for (let index = 0; index + 1 < body.data.ledger.length; index++) {
      const current = body.data.ledger[index]
      const older = body.data.ledger[index + 1]
      if (current === undefined || older === undefined) break
      expect(older.running_balance).toBe(current.running_balance - current.delta)
    }
    expect(body.data.checks_per_day.length).toBeGreaterThan(0)
  })
})
