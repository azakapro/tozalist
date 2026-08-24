import { describe, expect, it } from 'vitest'
import { DEFAULT_REDIS_URL, readWorkerConfig } from './config.js'

describe('readWorkerConfig', () => {
  it('falls back to the local Redis when REDIS_URL is absent', () => {
    expect(readWorkerConfig({}).redisUrl).toBe(DEFAULT_REDIS_URL)
    expect(readWorkerConfig({ REDIS_URL: '  ' }).redisUrl).toBe(DEFAULT_REDIS_URL)
  })

  it('uses REDIS_URL when provided', () => {
    expect(readWorkerConfig({ REDIS_URL: 'redis://redis:6379/1' }).redisUrl).toBe(
      'redis://redis:6379/1',
    )
  })

  it('rejects URLs that are not Redis endpoints', () => {
    expect(() => readWorkerConfig({ REDIS_URL: 'http://redis:6379' })).toThrow(/redis:/)
    expect(() => readWorkerConfig({ REDIS_URL: 'not-a-url' })).toThrow(/valid URL/)
  })

  it('does not leak the credential-bearing value in error messages', () => {
    expect(() => readWorkerConfig({ REDIS_URL: 'redis//user:sup3rs3cret@host' })).toThrow(
      /^REDIS_URL is not a valid URL$/,
    )
  })
})
