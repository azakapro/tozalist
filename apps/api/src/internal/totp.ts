import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s steps) - the algorithm every
 * authenticator app implements. Self-contained: no third-party dependency
 * handles our MFA secrets.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6

export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(encoded: string): Buffer | null {
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of encoded.toUpperCase().replace(/=+$/, '')) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** A fresh 20-byte TOTP secret, base32-encoded for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function hotp(key: Buffer, counter: bigint): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(counter)
  const digest = createHmac('sha1', key).update(message).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0xf
  const code =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff)
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

export function totpAt(secretBase32: string, epochMs: number): string | null {
  const key = base32Decode(secretBase32)
  if (key === null || key.length === 0) return null
  return hotp(key, BigInt(Math.floor(epochMs / 1000 / TOTP_STEP_SECONDS)))
}

/** Verifies a code against the current step ±1 (clock drift tolerance). */
export function verifyTotp(secretBase32: string, code: string, epochMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false
  for (const drift of [-1, 0, 1]) {
    const expected = totpAt(secretBase32, epochMs + drift * TOTP_STEP_SECONDS * 1000)
    if (expected === null) return false
    const a = Buffer.from(expected)
    const b = Buffer.from(code)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}

/** The otpauth:// URI encoded into the enrollment QR code. */
export function totpUri(secretBase32: string, accountEmail: string): string {
  const issuer = 'TozaList'
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`
}
