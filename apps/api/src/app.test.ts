import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

describe('GET /health', () => {
  it('returns 200 with exactly {"status":"ok"}', async () => {
    const app = buildApp()
    try {
      const response = await app.inject({ method: 'GET', url: '/health' })

      expect(response.statusCode).toBe(200)
      expect(response.body).toBe('{"status":"ok"}')
      expect(response.headers['content-type']).toContain('application/json')
    } finally {
      await app.close()
    }
  })

  it('does not answer unknown routes', async () => {
    const app = buildApp()
    try {
      const response = await app.inject({ method: 'GET', url: '/nope' })
      expect(response.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})
