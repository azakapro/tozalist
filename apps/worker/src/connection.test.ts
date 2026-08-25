import { describe, expect, it } from 'vitest'
import { buildRedisConnectionOptions } from '@tozalist/shared'
import { buildConnectionOptions } from './connection.js'

describe('buildConnectionOptions', () => {
  it('derives host, port and database from the URL', () => {
    expect(buildConnectionOptions('redis://cache.internal:6380/3')).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      db: 3,
    })
  })

  it('applies Redis defaults when the URL omits them', () => {
    expect(buildConnectionOptions('redis://localhost')).toMatchObject({ port: 6379, db: 0 })
  })

  it('keeps BullMQ blocking commands alive', () => {
    expect(buildConnectionOptions('redis://localhost:6379')).toMatchObject({
      maxRetriesPerRequest: null,
    })
  })

  it('carries credentials and enables TLS only for rediss:', () => {
    expect(buildConnectionOptions('rediss://user:p%40ss@localhost:6379')).toMatchObject({
      username: 'user',
      password: 'p@ss',
      tls: {},
    })
    expect(buildConnectionOptions('redis://localhost:6379')).not.toHaveProperty('tls')
  })
})

describe('parity with the shared parser', () => {
  it('worker and API obtain structurally identical options for the same URL', () => {
    const urls = [
      'redis://localhost:6379',
      'redis://user:pass@redis.internal:6380/6',
      'rediss://user:pass@redis.internal/2',
      'redis://u%40ser:p%40ss@host/1',
    ]
    for (const url of urls) {
      // The API queue publisher passes buildRedisConnectionOptions straight to
      // BullMQ; the worker's buildConnectionOptions must be the same object
      // shape, or the two processes could target different databases.
      expect(buildConnectionOptions(url)).toEqual(buildRedisConnectionOptions(url))
    }
  })
})
