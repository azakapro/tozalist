import { describe, expect, it } from 'vitest'
import { isReasonCode, REASON_CODES } from './reason-codes.js'

describe('REASON_CODES', () => {
  it('is frozen: mutation attempts throw', () => {
    expect(Object.isFrozen(REASON_CODES)).toBe(true)
    expect(() => {
      // @ts-expect-error - proving runtime immutability, not type safety
      REASON_CODES.PHONE_OK = 'tampered'
    }).toThrow(TypeError)
    expect(() => {
      // @ts-expect-error - proving runtime immutability, not type safety
      REASON_CODES.NEW_CODE = 'added'
    }).toThrow(TypeError)
    expect(REASON_CODES.PHONE_OK).toBe('The number matches the numbering plan for its country.')
  })

  it('contains every code the product contract requires', () => {
    const required = [
      'SYNTAX_INVALID',
      'DOMAIN_NO_MX',
      'MX_LOOKUP_UNAVAILABLE',
      'CATCH_ALL_DOMAIN',
      'SMTP_UNAVAILABLE',
      'MAILBOX_REJECTED',
      'MAILBOX_FULL',
      'MAILBOX_DISABLED',
      'DISPOSABLE_DOMAIN',
      'ROLE_ACCOUNT',
      'POSSIBLE_TYPO',
      'SMTP_NOT_CHECKED',
      'PHONE_OK',
      'PHONE_INVALID_FORMAT',
      'PHONE_TOO_SHORT',
      'PHONE_TOO_LONG',
      'PHONE_UNKNOWN_COUNTRY',
    ]
    for (const code of required) {
      expect(REASON_CODES, `missing ${code}`).toHaveProperty(code)
    }
  })

  it('gives every code a non-empty plain-English explanation', () => {
    for (const [code, explanation] of Object.entries(REASON_CODES)) {
      expect(explanation, code).toBeTruthy()
      expect(explanation.length, code).toBeGreaterThan(10)
    }
  })

  it('never promises an outcome in customer-facing language', () => {
    // Words that would overclaim: delivery promises, ownership, live status.
    const forbidden =
      /\b(guarantee[ds]?|will (arrive|deliver)|definitely|owner is|currently active)\b/i
    for (const [code, explanation] of Object.entries(REASON_CODES)) {
      expect(forbidden.test(explanation), `${code}: "${explanation}"`).toBe(false)
    }
  })

  it('isReasonCode accepts registered codes and rejects everything else', () => {
    expect(isReasonCode('PHONE_OK')).toBe(true)
    expect(isReasonCode('SYNTAX_INVALID')).toBe(true)
    expect(isReasonCode('NOT_A_CODE')).toBe(false)
    expect(isReasonCode('')).toBe(false)
    expect(isReasonCode('phone_ok')).toBe(false)
    expect(isReasonCode('toString')).toBe(false)
    expect(isReasonCode('__proto__')).toBe(false)
  })
})
