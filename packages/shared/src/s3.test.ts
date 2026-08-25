import { describe, expect, it } from 'vitest'
import {
  ensureDeleteSucceeded,
  exportKeyCreatedAtMs,
  exportObjectKey,
  STORAGE_DELETE_FAILED,
} from './s3.js'

describe('ensureDeleteSucceeded', () => {
  it('accepts a clean response and an absent error list', () => {
    expect(() => ensureDeleteSucceeded(undefined)).not.toThrow()
    expect(() => ensureDeleteSucceeded([])).not.toThrow()
  })

  it('fails closed on a partial DeleteObjects response', () => {
    // S3 can answer 200 while the body reports per-key failures.
    const partial = [
      {
        Key: 'org/11111111-1111-1111-1111-111111111111/batches/x/input.csv',
        Code: 'InternalError',
        Message: 'We encountered an internal error. Please try again.',
      },
    ]
    expect(() => ensureDeleteSucceeded(partial)).toThrow(STORAGE_DELETE_FAILED)
  })

  it('the failure carries no key, code, or foreign message text', () => {
    const partial = [{ Key: 'org/secret-org/batches/b/input.csv', Code: 'AccessDenied' }]
    let caught: Error | undefined
    try {
      ensureDeleteSucceeded(partial)
    } catch (error) {
      caught = error as Error
    }
    expect(caught).toBeDefined()
    expect(caught?.message).toBe(STORAGE_DELETE_FAILED)
    expect(caught?.message).not.toContain('secret-org')
    expect(caught?.message).not.toContain('AccessDenied')
  })
})

describe('export object keys', () => {
  it('round-trips the embedded creation time', () => {
    const orgId = '11111111-1111-1111-1111-111111111111'
    const key = exportObjectKey(orgId, 1787645478647, 'abcd1234-1111-2222-3333-444455556666')
    expect(exportKeyCreatedAtMs(key)).toBe(1787645478647)
  })

  it('returns null for keys that are not exports', () => {
    expect(exportKeyCreatedAtMs('org/x/batches/y/input.csv')).toBeNull()
    expect(exportKeyCreatedAtMs('unrelated.txt')).toBeNull()
  })
})
