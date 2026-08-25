import { describe, expect, it } from 'vitest'
import { assertRequiredEnv } from './env.js'

describe('assertRequiredEnv', () => {
  it('passes when everything is present and non-blank', () => {
    expect(() => assertRequiredEnv(['A', 'B'], { A: 'x', B: 'y' })).not.toThrow()
  })

  it('lists EVERY missing variable in one error, values never included', () => {
    let caught: Error | undefined
    try {
      assertRequiredEnv(['DATABASE_URL', 'S3_ENDPOINT', 'S3_SECRET_KEY'], {
        DATABASE_URL: 'postgres://u:sup3rs3cret@host/db',
        S3_ENDPOINT: '   ',
      })
    } catch (error) {
      caught = error as Error
    }
    expect(caught?.message).toBe(
      'missing required environment variables: S3_ENDPOINT, S3_SECRET_KEY',
    )
    expect(caught?.message).not.toContain('sup3rs3cret')
  })
})
