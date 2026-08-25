import { describe, expect, it } from 'vitest'
import {
  API_KEY_PREFIX_LENGTH,
  generateApiKey,
  hashPassword,
  hashesMatch,
  sha256Hex,
  verifyPassword,
} from './crypto.js'

describe('sha256Hex', () => {
  it('produces the known SHA-256 digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('generateApiKey', () => {
  it('produces tzl_live_ plus exactly 32 base62 characters', () => {
    for (let i = 0; i < 20; i++) {
      const key = generateApiKey()
      expect(key.plaintext).toMatch(/^tzl_live_[0-9A-Za-z]{32}$/)
      expect(key.plaintext).toHaveLength('tzl_live_'.length + 32)
    }
  })

  it('uses the whole base62 alphabet across many keys (no truncated range)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      for (const ch of generateApiKey().plaintext.slice('tzl_live_'.length)) {
        seen.add(ch)
      }
    }
    // 200 keys x 32 chars = 6400 draws over 62 symbols: every symbol appears.
    expect(seen.size).toBe(62)
  })

  it('returns a key whose stored hash matches the plaintext', () => {
    const key = generateApiKey()
    expect(key.keyHash).toBe(sha256Hex(key.plaintext))
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('exposes only the first 12 characters as a display prefix', () => {
    const key = generateApiKey()
    expect(key.keyPrefix).toHaveLength(API_KEY_PREFIX_LENGTH)
    expect(key.plaintext.startsWith(key.keyPrefix)).toBe(true)
    expect(key.plaintext.length).toBeGreaterThan(API_KEY_PREFIX_LENGTH * 2)
  })

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().plaintext))
    expect(keys.size).toBe(50)
  })
})

describe('hashesMatch', () => {
  it('accepts identical digests and rejects different ones', () => {
    const digest = sha256Hex('same')
    expect(hashesMatch(digest, digest)).toBe(true)
    expect(hashesMatch(digest, sha256Hex('other'))).toBe(false)
  })

  it('rejects digests of different lengths without throwing', () => {
    expect(hashesMatch(sha256Hex('a'), 'ff')).toBe(false)
  })
})

describe('hashPassword', () => {
  it('produces an Argon2id hash that is not the password', async () => {
    const hash = await hashPassword('correct horse battery staple')

    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(hash).not.toContain('correct horse battery staple')
  })

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')])
    expect(first).not.toBe(second)
  })

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('right')
    expect(await verifyPassword(hash, 'right')).toBe(true)
    expect(await verifyPassword(hash, 'wrong')).toBe(false)
  })
})
