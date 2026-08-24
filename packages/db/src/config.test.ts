import { describe, expect, it } from 'vitest'
import { checkTestDatabaseConfig, readDatabaseConfig, requireTestDatabaseConfig } from './config.js'

describe('readDatabaseConfig', () => {
  it('accepts postgres connection strings', () => {
    expect(readDatabaseConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' }).url).toBe(
      'postgres://u:p@localhost:5432/db',
    )
    expect(readDatabaseConfig({ DATABASE_URL: '  postgresql://u:p@localhost:5432/db  ' }).url).toBe(
      'postgresql://u:p@localhost:5432/db',
    )
  })

  it('requires DATABASE_URL to be set', () => {
    expect(() => readDatabaseConfig({})).toThrow(/DATABASE_URL is required/)
    expect(() => readDatabaseConfig({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL is required/)
  })

  it('rejects non-postgres URLs', () => {
    expect(() => readDatabaseConfig({ DATABASE_URL: 'mysql://localhost:3306/db' })).toThrow(
      /postgres:/,
    )
  })

  it('never echoes the connection string back', () => {
    const secret = 'postgres//user:sup3rs3cret@localhost/db'
    expect(() => readDatabaseConfig({ DATABASE_URL: secret })).toThrow(
      /^DATABASE_URL is not a valid URL$/,
    )
  })
})

describe('checkTestDatabaseConfig', () => {
  const development = 'postgresql://u:p@localhost:5432/tozalist'

  it('accepts a dedicated test database', () => {
    const checked = checkTestDatabaseConfig({
      DATABASE_URL: development,
      DATABASE_URL_TEST: 'postgresql://u:p@localhost:5432/tozalist_test',
    })
    expect(checked).toEqual({ ok: true, url: 'postgresql://u:p@localhost:5432/tozalist_test' })
  })

  it('reports a missing test database as skippable, not fatal', () => {
    const checked = checkTestDatabaseConfig({ DATABASE_URL: development })
    expect(checked.ok).toBe(false)
    expect(checked.ok === false && checked.code).toBe('missing')
  })

  it('refuses a test URL identical to the development database', () => {
    const checked = checkTestDatabaseConfig({
      DATABASE_URL: development,
      DATABASE_URL_TEST: development,
    })
    expect(checked.ok === false && checked.code).toBe('same_as_development')
  })

  it('refuses a database whose name does not end in _test', () => {
    const checked = checkTestDatabaseConfig({
      DATABASE_URL: development,
      DATABASE_URL_TEST: 'postgresql://u:p@localhost:5432/production',
    })
    expect(checked.ok === false && checked.code).toBe('unsafe_name')
  })

  it('refuses a malformed URL without echoing it', () => {
    const checked = checkTestDatabaseConfig({ DATABASE_URL_TEST: 'postgres//u:secret@h/db_test' })
    expect(checked.ok === false && checked.code).toBe('invalid')
    expect(checked.ok === false && checked.message).toBe('DATABASE_URL_TEST is not a valid URL')
  })
})

describe('requireTestDatabaseConfig', () => {
  it('throws rather than returning an unsafe configuration', () => {
    const development = 'postgresql://u:p@localhost:5432/tozalist'

    expect(() => requireTestDatabaseConfig({ DATABASE_URL: development })).toThrow(
      /DATABASE_URL_TEST is not set/,
    )
    expect(() =>
      requireTestDatabaseConfig({ DATABASE_URL: development, DATABASE_URL_TEST: development }),
    ).toThrow(/must not equal DATABASE_URL/)
    expect(() =>
      requireTestDatabaseConfig({
        DATABASE_URL: development,
        DATABASE_URL_TEST: 'postgresql://u:p@localhost:5432/tozalist',
      }),
    ).toThrow(/must not equal DATABASE_URL|ends in "_test"/)
  })
})
