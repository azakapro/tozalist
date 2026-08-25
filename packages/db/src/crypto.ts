import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'

/** Visible prefix of an API key, stored for display so keys are tellable apart. */
export const API_KEY_PREFIX_LENGTH = 12

/** Marks a key as belonging to TozaList, and as a live (non-test) credential. */
const API_KEY_NAMESPACE = 'tzl_live_'

/** SHA-256 as lowercase hex. Used for API key and email/phone lookup hashes. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export type GeneratedApiKey = {
  /** Shown to the caller once, never stored. */
  readonly plaintext: string
  /** What actually goes in the database. */
  readonly keyHash: string
  /** First {@link API_KEY_PREFIX_LENGTH} characters, for display only. */
  readonly keyPrefix: string
}

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
/** Random part of a key: 32 base62 characters (~190 bits of entropy). */
export const API_KEY_RANDOM_LENGTH = 32

/** Matches a well-formed TozaList API key exactly. */
export const API_KEY_PATTERN = /^tzl_live_[0-9A-Za-z]{32}$/

/**
 * Unbiased base62 string from the CSPRNG.
 *
 * Rejection sampling: 62 * 4 = 248, so bytes 248..255 are rejected instead of
 * being folded back in by a modulo, which would bias the first 8 characters of
 * the alphabet. Math.random never appears here - it is not a CSPRNG.
 */
function randomBase62(length: number): string {
  const limit = 62 * 4 // largest multiple of 62 that fits a byte
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < limit) {
        out += BASE62_ALPHABET[byte % 62]
        if (out.length === length) break
      }
    }
  }
  return out
}

/**
 * Mints an API key: `tzl_live_` + 32 unbiased base62 characters. Only the
 * SHA-256 hash and the display prefix are ever persisted, so a database leak
 * does not hand out usable keys.
 */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = API_KEY_NAMESPACE + randomBase62(API_KEY_RANDOM_LENGTH)

  return {
    plaintext,
    keyHash: sha256Hex(plaintext),
    keyPrefix: plaintext.slice(0, API_KEY_PREFIX_LENGTH),
  }
}

/** Constant-time comparison of two hex digests, safe against timing probes. */
export function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')

  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Hashes a password with Argon2id.
 *
 * Argon2id is memory-hard, so an attacker holding the database cannot brute
 * force it with cheap parallel hardware the way they could with SHA-based or
 * reversible schemes. The parameters are the @node-rs/argon2 defaults
 * (m=19456, t=2, p=1), which follow the OWASP baseline.
 *
 * The library's `Algorithm` enum is an ambient const enum and cannot be
 * referenced under `verbatimModuleSyntax`, so the variant is asserted from the
 * encoded output instead of being passed in. Argon2id is the default, and this
 * check fails loudly if a future version changes that.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoded = await argon2Hash(password)

  if (!encoded.startsWith('$argon2id$')) {
    throw new Error('password hashing did not produce an Argon2id hash')
  }

  return encoded
}

/** Verifies a password against an Argon2id encoded hash. */
export function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  return argon2Verify(encodedHash, password)
}
