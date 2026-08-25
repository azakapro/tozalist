import { describe, expect, it } from 'vitest'
import { buildRedisConnectionOptions } from './redis.js'

describe('buildRedisConnectionOptions', () => {
  it('parses a bare local URL with defaults', () => {
    expect(buildRedisConnectionOptions('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 0,
      maxRetriesPerRequest: null,
    })
  })

  it('defaults the port to 6379 when omitted', () => {
    expect(buildRedisConnectionOptions('redis://cache.internal')).toMatchObject({
      host: 'cache.internal',
      port: 6379,
      db: 0,
    })
  })

  it('parses database index, username and password', () => {
    expect(buildRedisConnectionOptions('redis://user:pass@redis.internal:6380/6')).toEqual({
      host: 'redis.internal',
      port: 6380,
      db: 6,
      username: 'user',
      password: 'pass',
      maxRetriesPerRequest: null,
    })
  })

  it('enables TLS for rediss:// and keeps credentials and database', () => {
    expect(buildRedisConnectionOptions('rediss://user:pass@redis.internal/2')).toEqual({
      host: 'redis.internal',
      port: 6379,
      db: 2,
      username: 'user',
      password: 'pass',
      tls: {},
      maxRetriesPerRequest: null,
    })
  })

  it('does not set tls for plain redis://', () => {
    expect(buildRedisConnectionOptions('redis://localhost:6379/1')).not.toHaveProperty('tls')
  })

  it('decodes percent-encoded credentials', () => {
    const options = buildRedisConnectionOptions('redis://u%40ser:p%40ss%2Fword@host:6379/3')
    expect(options.username).toBe('u@ser')
    expect(options.password).toBe('p@ss/word')
    expect(options.db).toBe(3)
  })

  it('always pins maxRetriesPerRequest to null for BullMQ', () => {
    expect(buildRedisConnectionOptions('rediss://host/5').maxRetriesPerRequest).toBeNull()
  })

  it('rejects non-redis schemes without echoing the URL', () => {
    const url = 'http://user:sup3rs3cret@host:6379'
    try {
      buildRedisConnectionOptions(url)
      expect.unreachable('should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toBe('Redis URL must use the redis: or rediss: scheme')
      expect(message).not.toContain('sup3rs3cret')
    }
  })
})
