import type { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseClient } from '@tozalist/db'
import type { FastifyInstance } from 'fastify'
import { buildApp, JSON_BODY_LIMIT_BYTES } from './app.js'
import { connectTestDb, connectTestRedis, hasIntegrationEnv, uniqueName } from './test/support.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe.skipIf(!hasIntegrationEnv)('api error envelope', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let redis: Redis
  let app: FastifyInstance

  beforeAll(() => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    redis = connectTestRedis()
    app = buildApp({
      deps: { db, redis, authKeyPrefix: `${uniqueName('lu')}:` },
      testRoutes: true,
    })
    // A POST route outside /v1 so body parsing happens without auth.
    app.post('/echo-size', async () => ({ ok: true }))
  })

  afterAll(async () => {
    await app.close()
    await redis.quit()
    await sqlEnd()
  })

  // --- 13. oversized body -------------------------------------------------------

  it('oversized JSON returns 413 with the standard envelope and request id', async () => {
    const body = JSON.stringify({ padding: 'x'.repeat(JSON_BODY_LIMIT_BYTES + 128) })
    const response = await app.inject({
      method: 'POST',
      url: '/echo-size',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(response.statusCode).toBe(413)
    const parsed = response.json() as { error: Record<string, string> }
    expect(parsed.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(parsed.error.message).toBe('The request body is too large.')
    expect(parsed.error.request_id).toMatch(UUID_RE)
    expect(response.headers['x-request-id']).toBe(parsed.error.request_id)
  })

  it('a body exactly at the limit is accepted', async () => {
    const padding = 'x'.repeat(JSON_BODY_LIMIT_BYTES - 20)
    const body = JSON.stringify({ p: padding })
    expect(body.length).toBeLessThanOrEqual(JSON_BODY_LIMIT_BYTES)

    const response = await app.inject({
      method: 'POST',
      url: '/echo-size',
      headers: { 'content-type': 'application/json' },
      body,
    })
    expect(response.statusCode).toBe(200)
  })

  // --- 14. unknown route ----------------------------------------------------------

  it('unknown routes return the standard 404 envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/definitely-not-a-route' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource does not exist.',
        request_id: response.headers['x-request-id'],
      },
    })
  })

  // --- 16 (error half) ------------------------------------------------------------

  it('error responses carry a UUID request id header', async () => {
    const notFound = await app.inject({ method: 'GET', url: '/nope' })
    expect(notFound.headers['x-request-id']).toMatch(UUID_RE)
  })

  it('health stays public and still carries a request id', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"status":"ok"}')
    expect(response.headers['x-request-id']).toMatch(UUID_RE)
  })
})
