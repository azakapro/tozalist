import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DelayedError, type Job } from 'bullmq'
import {
  createWebhookDelivery,
  createWebhookEndpoint,
  organizations,
  softDeleteWebhookEndpoint,
  webhookDeliveries,
  type DatabaseClient,
} from '@tozalist/db'
import {
  signWebhookBody,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_MS,
  type HostResolver,
  type WebhookDeliverJobData,
} from '@tozalist/shared'
import { createWebhookProcessor } from './processor.js'
import {
  fetchWebhookTransport,
  type WebhookPostRequest,
  type WebhookPostResult,
  type WebhookTransport,
} from './transport.js'
import { captureLogger, connectTestDb, createOrg, hasIntegrationEnv } from '../test/support.js'

type StubJob = Job<WebhookDeliverJobData> & { delayedTo: number[] }

function stubJob(deliveryId: string): StubJob {
  const job = {
    data: { deliveryId },
    attemptsMade: 0,
    delayedTo: [] as number[],
    moveToDelayed(timestamp: number) {
      job.delayedTo.push(timestamp)
      return Promise.resolve()
    },
  }
  return job as unknown as StubJob
}

function scriptedTransport(results: WebhookPostResult[]): {
  transport: WebhookTransport
  requests: WebhookPostRequest[]
} {
  const requests: WebhookPostRequest[] = []
  let cursor = 0
  return {
    requests,
    transport: (request) => {
      requests.push(request)
      const result = results[Math.min(cursor, results.length - 1)]
      cursor += 1
      if (result === undefined) throw new Error('transport script exhausted')
      return Promise.resolve(result)
    },
  }
}

const publicResolver: HostResolver = () => Promise.resolve(['203.0.113.10'])

describe('webhook signing', () => {
  it('matches a known HMAC-SHA256 vector', () => {
    // Independently computed: echo -n '{"hello":"world"}' | openssl dgst -sha256 -hmac 'whsec_test_secret'
    expect(signWebhookBody('whsec_test_secret', '{"hello":"world"}')).toBe(
      'fe301dfe943ee0aa11ef5f74e680f2f2a4e0babff7821f1ad97f827640fe6bc2',
    )
  })

  it('is verifiable exactly as the documentation samples do it', () => {
    const secret = 'whsec_docs_example'
    const rawBody = JSON.stringify({ event: 'batch.completed', data: { batch_id: 'x' } })
    const signature = signWebhookBody(secret, rawBody)
    // The docs' Node sample: hex HMAC over the raw bytes, compared in constant time.
    const expected = createHmac('sha256', secret).update(Buffer.from(rawBody)).digest()
    const received = Buffer.from(signature, 'hex')
    expect(received.length).toBe(expected.length)
    expect(timingSafeEqual(expected, received)).toBe(true)
  })
})

describe.skipIf(!hasIntegrationEnv)('webhook delivery processor', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let orgId: string
  const { logger } = captureLogger()

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    orgId = await createOrg(db)
  })

  afterAll(async () => {
    await sqlEnd()
  })

  async function plantDelivery(
    options: {
      url?: string
      secret?: string
      event?: string
    } = {},
  ): Promise<{ deliveryId: string; endpointId: string; secret: string }> {
    const secret = options.secret ?? `whsec_${randomUUID()}`
    const endpoint = await createWebhookEndpoint(db, {
      orgId,
      url: options.url ?? 'https://hooks.example.com/receive',
      events: ['batch.completed', 'batch.failed'],
      secret,
    })
    const deliveryId = randomUUID()
    await createWebhookDelivery(db, {
      id: deliveryId,
      endpointId: endpoint.id,
      eventType: options.event ?? 'batch.completed',
      payload: {
        event: options.event ?? 'batch.completed',
        data: { batch_id: randomUUID(), status: 'done', total_rows: 3, verdict_counts: {} },
      },
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    return { deliveryId, endpointId: endpoint.id, secret }
  }

  async function readDelivery(id: string) {
    const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id))
    if (row === undefined) throw new Error('delivery vanished')
    return row
  }

  it('delivers on 2xx with correct headers and a body signed with the endpoint secret', async () => {
    const { deliveryId, secret } = await plantDelivery()
    const { transport, requests } = scriptedTransport([{ kind: 'response', statusCode: 204 }])
    const frozenNow = 1_750_000_000_000

    await createWebhookProcessor({
      db,
      logger,
      transport,
      resolver: publicResolver,
      clock: () => frozenNow,
    })(stubJob(deliveryId), 'token')

    expect(requests).toHaveLength(1)
    const request = requests[0]
    if (request === undefined) throw new Error('no request')
    expect(request.timeoutMs).toBe(5_000)

    // Signature over the RAW body, verifiable by the documented recipe.
    expect(request.headers['X-Signature']).toBe(signWebhookBody(secret, request.body))
    const envelope = JSON.parse(request.body) as Record<string, unknown>
    expect(envelope.event).toBe('batch.completed')
    expect(envelope.delivery_id).toBe(deliveryId)
    expect(request.headers['X-Timestamp']).toBe(envelope.timestamp)
    expect(request.headers['X-Delivery-Id']).toBe(deliveryId)
    expect(request.headers['X-Event-Type']).toBe('batch.completed')

    // The socket target is the resolver-approved address, never a fresh lookup.
    expect(request.connectToAddress).toBe('203.0.113.10')

    const row = await readDelivery(deliveryId)
    expect(row.status).toBe('delivered')
    expect(row.attempts).toBe(1)
    expect(row.attemptLog).toHaveLength(1)
    // A first-attempt success records its REAL attempt number and clock time.
    expect(row.attemptLog[0]).toMatchObject({
      attempt: 1,
      at: new Date(frozenNow).toISOString(),
      status_code: 204,
    })
  })

  it('a retry-then-success delivery leaves an ordered, accurate attempt log', async () => {
    const { deliveryId } = await plantDelivery()
    const { transport } = scriptedTransport([
      { kind: 'response', statusCode: 500 },
      { kind: 'response', statusCode: 200 },
    ])
    let nowMs = 1_760_000_000_000
    const process = createWebhookProcessor({
      db,
      logger,
      transport,
      resolver: publicResolver,
      clock: () => nowMs,
    })

    const firstAt = nowMs
    await expect(process(stubJob(deliveryId), 'token')).rejects.toBeInstanceOf(DelayedError)
    nowMs += 60_000
    const secondAt = nowMs
    await process(stubJob(deliveryId), 'token')

    const row = await readDelivery(deliveryId)
    expect(row.status).toBe('delivered')
    expect(row.attempts).toBe(2)
    expect(row.attemptLog).toEqual([
      { attempt: 1, at: new Date(firstAt).toISOString(), status_code: 500, error: 'http_error' },
      { attempt: 2, at: new Date(secondAt).toISOString(), status_code: 200 },
    ])
  })

  it('binding proof: the real transport connects to the approved address, not fresh DNS', async () => {
    // A local HTTP server plays the "approved address". The hostname in the
    // URL is deliberately unresolvable: any implementation that performs its
    // own DNS lookup (the old check-then-normal-fetch design) MUST fail here,
    // while the pinned transport reaches the server.
    const received: Array<{ url: string; host: string | undefined; body: string }> = []
    const server = createServer((request: IncomingMessage, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        received.push({ url: request.url ?? '', host: request.headers.host, body })
        response.writeHead(204)
        response.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const url = `http://ssrf-pin-proof.invalid:${port}/hook`

    try {
      // The old design's behavior: an ordinary fetch cannot resolve the name.
      await expect(fetch(url, { method: 'POST', body: 'x' })).rejects.toThrow()

      // The pinned transport: same URL, socket forced to the approved address.
      const result = await fetchWebhookTransport({
        url,
        body: '{"probe":true}',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 5_000,
        connectToAddress: '127.0.0.1',
      })

      expect(result).toEqual({ kind: 'response', statusCode: 204 })
      expect(received).toHaveLength(1)
      // The request travelled with the ORIGINAL hostname (Host header intact),
      // proving the pin changes only the socket target.
      expect(received[0]?.host).toBe(`ssrf-pin-proof.invalid:${port}`)
      expect(received[0]?.body).toBe('{"probe":true}')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('the real transport refuses an unpinnable (non-IP) connect address', async () => {
    const result = await fetchWebhookTransport({
      url: 'http://anything.invalid/hook',
      body: '{}',
      headers: {},
      timeoutMs: 1_000,
      connectToAddress: 'not-an-ip',
    })
    expect(result).toEqual({ kind: 'network_error' })
  })

  it('follows the exact retry schedule and fails after the sixth attempt', async () => {
    const { deliveryId } = await plantDelivery()
    const { transport } = scriptedTransport([{ kind: 'response', statusCode: 500 }])
    let nowMs = 1_700_000_000_000
    const process = createWebhookProcessor({
      db,
      logger,
      transport,
      resolver: publicResolver,
      clock: () => nowMs,
    })

    // Five failing attempts schedule retries at exactly 1m, 5m, 30m, 2h, 6h.
    for (let attempt = 1; attempt <= WEBHOOK_RETRY_SCHEDULE_MS.length; attempt++) {
      const job = stubJob(deliveryId)
      await expect(process(job, 'token')).rejects.toBeInstanceOf(DelayedError)
      const expectedDelay = WEBHOOK_RETRY_SCHEDULE_MS[attempt - 1] ?? 0
      expect(job.delayedTo, `attempt ${attempt}`).toEqual([nowMs + expectedDelay])

      const row = await readDelivery(deliveryId)
      expect(row.status).toBe('pending')
      expect(row.attempts).toBe(attempt)
      expect(row.nextRetryAt?.getTime()).toBe(nowMs + expectedDelay)
      nowMs += expectedDelay
    }

    // The sixth attempt exhausts the schedule: terminal failure.
    const finalJob = stubJob(deliveryId)
    await process(finalJob, 'token')
    expect(finalJob.delayedTo).toHaveLength(0)

    const row = await readDelivery(deliveryId)
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(WEBHOOK_MAX_ATTEMPTS)
    expect(row.attemptLog).toHaveLength(WEBHOOK_MAX_ATTEMPTS)
    // Every attempt recorded its response code and error category.
    for (const entry of row.attemptLog as Array<{ status_code?: number; error?: string }>) {
      expect(entry.status_code).toBe(500)
      expect(entry.error).toBe('http_error')
    }
    expect(row.lastError).toBe('http_error')
  })

  it('refuses redirects: a 3xx is never delivered and never followed', async () => {
    const { deliveryId } = await plantDelivery()
    const { transport, requests } = scriptedTransport([{ kind: 'redirect', statusCode: 301 }])
    const job = stubJob(deliveryId)

    await expect(
      createWebhookProcessor({ db, logger, transport, resolver: publicResolver })(job, 'token'),
    ).rejects.toBeInstanceOf(DelayedError)

    expect(requests).toHaveLength(1) // exactly one POST; nothing followed
    const row = await readDelivery(deliveryId)
    expect(row.status).toBe('pending')
    expect((row.attemptLog[0] as { error: string }).error).toBe('redirect_refused')
    expect((row.attemptLog[0] as { status_code: number }).status_code).toBe(301)
  })

  it('treats a timeout as a retryable failed attempt', async () => {
    const { deliveryId } = await plantDelivery()
    const { transport } = scriptedTransport([{ kind: 'timeout' }])
    const job = stubJob(deliveryId)

    await expect(
      createWebhookProcessor({ db, logger, transport, resolver: publicResolver })(job, 'token'),
    ).rejects.toBeInstanceOf(DelayedError)

    const row = await readDelivery(deliveryId)
    expect((row.attemptLog[0] as { error: string }).error).toBe('timeout')
  })

  it('blocks DNS rebinding at delivery time without making any request', async () => {
    // Registered against a public address...
    const { deliveryId } = await plantDelivery({ url: 'https://rebind.example.com/hook' })
    // ...but by delivery time the name points into the internal network.
    const rebindResolver: HostResolver = () => Promise.resolve(['10.0.0.7'])
    const { transport, requests } = scriptedTransport([{ kind: 'response', statusCode: 200 }])
    const job = stubJob(deliveryId)

    await expect(
      createWebhookProcessor({ db, logger, transport, resolver: rebindResolver })(job, 'token'),
    ).rejects.toBeInstanceOf(DelayedError)

    expect(requests).toHaveLength(0) // the POST never happened
    const row = await readDelivery(deliveryId)
    expect((row.attemptLog[0] as { error: string }).error).toBe('ssrf_blocked')
  })

  it('finishes quietly for a deleted endpoint without sending', async () => {
    const { deliveryId, endpointId } = await plantDelivery()
    await softDeleteWebhookEndpoint(db, endpointId, orgId)
    const { transport, requests } = scriptedTransport([{ kind: 'response', statusCode: 200 }])
    const captured = captureLogger()

    await createWebhookProcessor({
      db,
      logger: captured.logger,
      transport,
      resolver: publicResolver,
    })(stubJob(deliveryId), 'token')

    expect(requests).toHaveLength(0)
    const row = await readDelivery(deliveryId)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(0)
    expect(captured.lines.some((line) => line.outcome === 'not_deliverable')).toBe(true)
    expect(captured.lines.every((line) => Number(line.level) < 40)).toBe(true)
  })

  it('logs never contain URLs, secrets, or payload contents', async () => {
    const secretMarker = `whsec_super_secret_${randomUUID().slice(0, 8)}`
    const { deliveryId } = await plantDelivery({
      url: 'https://secret-host.example.com/private-path?token=abc',
      secret: secretMarker,
    })
    const { transport } = scriptedTransport([{ kind: 'response', statusCode: 200 }])
    const captured = captureLogger()

    await createWebhookProcessor({
      db,
      logger: captured.logger,
      transport,
      resolver: publicResolver,
    })(stubJob(deliveryId), 'token')

    const raw = JSON.stringify(captured.lines)
    expect(raw).not.toContain(secretMarker)
    expect(raw).not.toContain('secret-host.example.com')
    expect(raw).not.toContain('private-path')
    expect(raw).not.toContain('batch_id')
    expect(raw).toContain(deliveryId)
  })

  it('org deletion silences pending deliveries', async () => {
    const doomedOrg = await createOrg(db)
    const endpoint = await createWebhookEndpoint(db, {
      orgId: doomedOrg,
      url: 'https://hooks.example.com/doomed',
      events: ['batch.completed'],
      secret: `whsec_${randomUUID()}`,
    })
    const deliveryId = randomUUID()
    await createWebhookDelivery(db, {
      id: deliveryId,
      endpointId: endpoint.id,
      eventType: 'batch.completed',
      payload: { event: 'batch.completed', data: {} },
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, doomedOrg))

    const { transport, requests } = scriptedTransport([{ kind: 'response', statusCode: 200 }])
    await createWebhookProcessor({ db, logger, transport, resolver: publicResolver })(
      stubJob(deliveryId),
      'token',
    )
    expect(requests).toHaveLength(0)
  })
})
