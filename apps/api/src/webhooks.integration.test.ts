import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditEvents,
  createApiKeyForOrg,
  webhookEndpoints,
  type DatabaseClient,
} from '@tozalist/db'
import { isPrivateAddress, type HostResolver } from '@tozalist/shared'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import {
  captureStream,
  connectTestDb,
  connectTestRedis,
  createOrg,
  hasIntegrationEnv,
  stubEngine,
  stubQueue,
  uniqueName,
} from './test/support.js'

describe('SSRF address classification', () => {
  it.each([
    ['10.0.0.1', true],
    ['10.255.255.254', true],
    ['172.16.0.1', true],
    ['172.31.255.1', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['127.9.9.9', true],
    ['169.254.169.254', true],
    ['0.0.0.0', true],
    ['0.1.2.3', true],
    ['::1', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['febf::1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:203.0.113.9', false],
    // Hexadecimal IPv4-mapped forms must classify like their embedded IPv4.
    ['::ffff:0a00:1', true], // 10.0.0.1
    ['::ffff:7f00:1', true], // 127.0.0.1
    ['::ffff:a9fe:a9fe', true], // 169.254.169.254 (metadata address)
    ['::ffff:c0a8:101', true], // 192.168.1.1
    ['::ffff:cb00:7109', false], // 203.0.113.9
    ['0:0:0:0:0:ffff:0a00:0001', true], // fully expanded mapped 10.0.0.1
    ['fe80::1%en0', true], // zone index: fail closed
    ['203.0.113.9', false],
    ['8.8.8.8', false],
    ['2606:4700::1111', false],
    ['not-an-ip', true],
  ])('%s → private=%s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected)
  })
})

describe.skipIf(!hasIntegrationEnv)('webhook registration endpoints', () => {
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

  async function harness(resolver?: HostResolver) {
    const orgId = await createOrg(db)
    const created = await createApiKeyForOrg(db, orgId, 'webhook key')
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
        webhookResolver: resolver ?? (() => Promise.resolve(['203.0.113.10'])),
        authKeyPrefix: `${uniqueName('lu')}:`,
        rateLimit: { keyPrefix: `${uniqueName('rl')}:` },
      },
    })
    apps.push(app)
    return { app, orgId, key: created.created.plaintext, logs: captured.lines }
  }

  type Harness = Awaited<ReturnType<typeof harness>>

  const create = (h: Harness, body: unknown) =>
    h.app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { authorization: `Bearer ${h.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('registers an endpoint and returns the secret exactly once', async () => {
    const h = await harness()
    const response = await create(h, {
      url: 'https://hooks.example.com/tozalist',
      events: ['batch.completed'],
    })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { data: Record<string, unknown> }
    expect(String(body.data.secret)).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    expect(body.data.events).toEqual(['batch.completed'])

    // The secret is stored for signing but never listed again.
    const list = await h.app.inject({
      method: 'GET',
      url: '/v1/webhooks',
      headers: { authorization: `Bearer ${h.key}` },
    })
    const listed = list.json() as { data: { webhooks: Array<Record<string, unknown>> } }
    expect(listed.data.webhooks).toHaveLength(1)
    expect(list.body).not.toContain(String(body.data.secret))
    expect(listed.data.webhooks[0]).not.toHaveProperty('secret')

    // Audit event exists and holds no secret and no full URL.
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'webhook.created'))
    const forThis = audits.filter((event) => event.targetId === body.data.webhook_id)
    expect(forThis).toHaveLength(1)
    expect(JSON.stringify(forThis)).not.toContain(String(body.data.secret))
    expect(JSON.stringify(forThis)).not.toContain('/tozalist')

    // Logs never carry the secret either.
    expect(JSON.stringify(h.logs)).not.toContain(String(body.data.secret))
  })

  it('rejects http:// and malformed URLs and credentials-in-URL', async () => {
    const h = await harness()
    for (const url of [
      'http://hooks.example.com/insecure',
      'not a url',
      'ftp://example.com/x',
      'https://user:pass@example.com/hook',
    ]) {
      const response = await create(h, { url, events: ['batch.completed'] })
      expect(response.statusCode, url).toBe(400)
      expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects every private and reserved destination at registration', async () => {
    const cases = [
      '10.1.2.3',
      '172.16.5.5',
      '192.168.0.10',
      '127.0.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      'fc00::2',
      'fe80::2',
      '::ffff:0a00:1', // hex-mapped 10.0.0.1
      '::ffff:a9fe:a9fe', // hex-mapped metadata address
    ]
    for (const address of cases) {
      const h = await harness(() => Promise.resolve([address]))
      const response = await create(h, {
        url: 'https://internal.example.com/hook',
        events: ['batch.completed'],
      })
      expect(response.statusCode, address).toBe(400)
      expect((response.json() as { error: { message: string } }).error.message).toContain(
        'private or reserved',
      )
    }

    // One private address among public ones still rejects.
    const mixed = await harness(() => Promise.resolve(['203.0.113.7', '10.0.0.9']))
    expect(
      (await create(mixed, { url: 'https://mixed.example.com/h', events: ['batch.failed'] }))
        .statusCode,
    ).toBe(400)

    // Unresolvable hostnames reject too.
    const broken = await harness(() => Promise.reject(new Error('NXDOMAIN')))
    const response = await create(broken, {
      url: 'https://ghost.example.com/h',
      events: ['batch.completed'],
    })
    expect(response.statusCode).toBe(400)
    expect((response.json() as { error: { message: string } }).error.message).toContain(
      'could not be resolved',
    )
  })

  it('validates the events array strictly', async () => {
    const h = await harness()
    for (const events of [
      [],
      ['nope'],
      ['batch.completed', 'batch.completed'],
      'batch.completed',
    ]) {
      const response = await create(h, { url: 'https://ok.example.com/h', events })
      expect(response.statusCode, JSON.stringify(events)).toBe(400)
    }
    const extra = await create(h, {
      url: 'https://ok.example.com/h',
      events: ['batch.completed'],
      sneaky: true,
    })
    expect(extra.statusCode).toBe(400)
  })

  it('deletes are soft, idempotent-safe, audited, and cross-org blind', async () => {
    const h = await harness()
    const created = await create(h, { url: 'https://del.example.com/h', events: ['batch.failed'] })
    const webhookId = String((created.json() as { data: { webhook_id: string } }).data.webhook_id)

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/v1/webhooks/${webhookId}`,
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(del.statusCode).toBe(200)

    const [row] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, webhookId))
    expect(row?.deletedAt).not.toBeNull()
    expect(row?.active).toBe(false)

    // Second delete: plain 404 (already deleted). Foreign delete: same 404.
    const again = await h.app.inject({
      method: 'DELETE',
      url: `/v1/webhooks/${webhookId}`,
      headers: { authorization: `Bearer ${h.key}` },
    })
    expect(again.statusCode).toBe(404)

    const stranger = await harness()
    const foreign = await stranger.app.inject({
      method: 'DELETE',
      url: `/v1/webhooks/${randomUUID()}`,
      headers: { authorization: `Bearer ${stranger.key}` },
    })
    expect(foreign.statusCode).toBe(404)
    expect((again.json() as { error: { message: string } }).error.message).toBe(
      (foreign.json() as { error: { message: string } }).error.message,
    )
  })
})
