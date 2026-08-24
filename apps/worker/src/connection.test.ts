import { describe, expect, it } from 'vitest'
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
