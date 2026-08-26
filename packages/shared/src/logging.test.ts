import { describe, expect, it } from 'vitest'
import { isSecretKey, redactEmail, redactEmailsInText, redactLogValue } from './logging.js'

describe('log redaction', () => {
  it('replaces an email with domain plus local-part hash', () => {
    const redacted = redactEmail('person@example.com')
    expect(redacted).toMatch(/^example\.com#[0-9a-f]{10}$/)
    expect(redacted).not.toContain('person')
    // Deterministic: the same address maps to the same token (correlatable
    // for debugging without being reversible to the address).
    expect(redactEmail('person@example.com')).toBe(redacted)
    expect(redactEmail('other@example.com')).not.toBe(redacted)
  })

  it('scrubs every email-shaped substring inside free text', () => {
    const scrubbed = redactEmailsInText('check failed for a.b+tag@mail.example.uz, retrying')
    expect(scrubbed).not.toContain('a.b+tag@')
    expect(scrubbed).toContain('mail.example.uz#')
    expect(scrubbed).toContain('retrying')
  })

  it('deep-walks objects, arrays, and errors', () => {
    const value = redactLogValue({
      msg: 'user user@x.example failed',
      nested: { list: ['ok', 'admin@corp.example'] },
      error: new Error('lookup for someone@deep.example broke'),
      count: 3,
    }) as Record<string, unknown>
    const serialized = JSON.stringify(value)
    expect(serialized).not.toContain('user@x.example')
    expect(serialized).not.toContain('admin@corp.example')
    expect(serialized).not.toContain('someone@deep.example')
    expect(serialized).toContain('x.example#')
    expect(value.count).toBe(3)
  })

  it('censors secret-named keys at every nesting depth, including arrays', () => {
    const value = redactLogValue({
      request: {
        headers: { authorization: 'Bearer tzl_live_abc123', 'x-csrf-token': 'csrf-value-1' },
        cookies: [{ cookie: 'session=sealed-value' }],
      },
      deep: { a: { b: { c: { password: 'hunter2-deep', apiKey: 'key-material-1' } } } },
      list: [
        { webhook_secret: 'whsec_value', ok: 'keep-me' },
        { user: { mfaSecret: 'JBSWY3DP', passwordHash: 'argon2id$hash' } },
      ],
      token: 'top-level-token-value',
    }) as Record<string, unknown>
    const serialized = JSON.stringify(value)
    for (const secret of [
      'tzl_live_abc123',
      'csrf-value-1',
      'session=sealed-value',
      'hunter2-deep',
      'key-material-1',
      'whsec_value',
      'JBSWY3DP',
      'argon2id$hash',
      'top-level-token-value',
    ]) {
      expect(serialized, secret).not.toContain(secret)
    }
    // The censor is fixed text; non-secret siblings survive.
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('keep-me')
  })

  it('key matching is separator- and case-insensitive but not overbroad', () => {
    for (const key of [
      'password',
      'PASSWORD',
      'api_key',
      'apiKey',
      'X-CSRF-Token',
      'webhook_secret',
      'mfa_secret',
      'Authorization',
    ]) {
      expect(isSecretKey(key), key).toBe(true)
    }
    for (const key of ['email', 'domain', 'note', 'count', 'reason', 'request_id', 'outcome']) {
      expect(isSecretKey(key), key).toBe(false)
    }
    // Identifier fields (a key's id, not its material) are logged for tracing.
    for (const key of ['api_key_id', 'apiKeyId', 'token_id', 'credential_id']) {
      expect(isSecretKey(key), key).toBe(false)
    }
  })

  it('leaves non-email strings and dates untouched', () => {
    const when = new Date('2026-08-25T00:00:00Z')
    const value = redactLogValue({ msg: 'batch 42 done', when }) as Record<string, unknown>
    expect(value.msg).toBe('batch 42 done')
    expect(value.when).toBe(when)
  })
})

import { Writable } from 'node:stream'
import pino from 'pino'
import { redactError, redactSecretsInText, redactedLoggerOptions } from './logging.js'

/**
 * Proof against the REAL sink: a pino logger configured exactly as the API and
 * worker configure theirs (redactedLoggerOptions). These close the two
 * reproduced bypasses - depth > former cap, and native Error serialization -
 * end to end, not only through the helper functions.
 */
function captureLogger(): { lines: string[]; logger: pino.Logger } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString())
      cb()
    },
  })
  return { lines, logger: pino({ base: null, ...redactedLoggerOptions() }, stream) }
}

describe('redaction through a real pino logger', () => {
  it('censors a secret nested deeper than the former depth cap, through arrays', () => {
    // 10 levels of nesting - past the old cap of 8 - with the secret at the
    // bottom, reached through an array on the way down.
    let node: Record<string, unknown> = { password: 'deep-secret-value-xyz' }
    for (let level = 0; level < 10; level += 1) node = { nested: [node] }
    const { lines, logger } = captureLogger()
    logger.info({ payload: node }, 'deep nesting')
    const out = lines.join('')
    expect(out).not.toContain('deep-secret-value-xyz')
    expect(out).toContain('[REDACTED]')
  })

  it('never leaks a secret via a direct logger.error(new Error(...))', () => {
    const { lines, logger } = captureLogger()
    logger.error(
      new Error('auth failed for admin@corp.example with key tzl_live_abcdef0123456789abcdef'),
    )
    const out = lines.join('')
    expect(out).not.toContain('tzl_live_abcdef0123456789abcdef')
    expect(out).not.toContain('admin@corp.example')
    // Domain#hash form for the email; the class name is retained.
    expect(out).toContain('corp.example#')
    expect(out).toContain('Error')
  })

  it('redacts secrets carried in an Error cause and enumerable properties', () => {
    const inner = new Error('inner boom')
    Object.assign(inner, { webhook_secret: 'whsec_nested_error_value' })
    const outer = new Error('outer failure', { cause: inner })
    Object.assign(outer, { context: { authorization: 'Bearer sk-error-token-value-123456' } })
    const { lines, logger } = captureLogger()
    logger.error(outer)
    const out = lines.join('')
    expect(out).not.toContain('whsec_nested_error_value')
    expect(out).not.toContain('sk-error-token-value-123456')
    expect(out).toContain('[REDACTED]')
  })

  it('scrubs secret-shaped text passed as the log message string', () => {
    const { lines, logger } = captureLogger()
    const shaped = 'tzl_live_' + 'zzzz1111yyyy2222wwww3333'
    logger.warn(`rejected key ${shaped} for user@site.example`)
    const out = lines.join('')
    expect(out).not.toContain(shaped)
    expect(out).not.toContain('user@site.example')
  })

  it('censors generic labelled secrets in a direct Error message and stack', () => {
    const { lines, logger } = captureLogger()
    logger.error(
      new Error('login failed: password=SuperSecret123 token=abctokenvalue987 for the request'),
    )
    const out = lines.join('')
    expect(out).not.toContain('SuperSecret123')
    expect(out).not.toContain('abctokenvalue987')
    expect(out).toContain('[REDACTED]')
    expect(out).toContain('Error')
  })

  it('censors generic labelled secrets in ordinary info/warn message strings', () => {
    const { lines, logger } = captureLogger()
    logger.info('cookie: session=sessioncookievalue123; Path=/')
    logger.warn('authorization=Basic dXNlcjpzM2NyZXQ and api_key=livekeymaterial4567')
    logger.info('mfa_code=908172 recovery_code=RECOVERY-CODE-9999')
    logger.warn('webhook_secret=whsec_ordinarymessagevalue for endpoint update')
    const out = lines.join('')
    for (const secret of [
      'sessioncookievalue123',
      'dXNlcjpzM2NyZXQ',
      'livekeymaterial4567',
      '908172',
      'RECOVERY-CODE-9999',
      'whsec_ordinarymessagevalue',
    ]) {
      expect(out, secret).not.toContain(secret)
    }
    expect(out).toContain('[REDACTED]')
  })

  it('keeps non-secret correlation fields usable while censoring secrets', () => {
    const { lines, logger } = captureLogger()
    logger.info(
      { api_key_id: 'c0ffee00-0000-4000-8000-000000000000', apiKey: 'tzl_live_realkeymaterial99' },
      'authenticated',
    )
    const out = lines.join('')
    expect(out).toContain('c0ffee00-0000-4000-8000-000000000000')
    expect(out).not.toContain('tzl_live_realkeymaterial99')
  })
})

describe('redactError and redactSecretsInText helpers', () => {
  it('redactError keeps the type but scrubs message, stack, and cause', () => {
    const cause = new Error('cause with password field')
    Object.assign(cause, { token: 'secret-token-1' })
    const error = new Error('failed for a@b.example')
    Object.defineProperty(error, 'cause', { value: cause, enumerable: false })
    const redacted = redactError(error)
    expect(redacted.type).toBe('Error')
    expect(JSON.stringify(redacted)).not.toContain('secret-token-1')
    expect(JSON.stringify(redacted)).not.toContain('a@b.example')
  })

  it('redactSecretsInText censors shaped secrets and hashes emails', () => {
    const scrubbed = redactSecretsInText('key tzl_live_aaaabbbbccccdddd and mail x@y.example')
    expect(scrubbed).toContain('[REDACTED]')
    expect(scrubbed).toContain('y.example#')
    expect(scrubbed).not.toContain('tzl_live_aaaabbbbccccdddd')
  })

  it('a self-referential (cyclic) object is censored, not infinitely walked', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const redacted = redactLogValue(node) as Record<string, unknown>
    expect(redacted.name).toBe('root')
    expect(redacted.self).toBe('[REDACTED]')
  })
})
