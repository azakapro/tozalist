import { describe, expect, it } from 'vitest'
import { validatePhone } from './phone.js'
import { isReasonCode } from './reason-codes.js'

describe('validatePhone', () => {
  describe('Uzbekistan (default country)', () => {
    it('accepts a +998 mobile number', () => {
      expect(validatePhone('+998901234567')).toEqual({
        e164: '+998901234567',
        valid: true,
        country: 'UZ',
        lineTypeGuess: 'MOBILE',
        reasonCodes: ['PHONE_OK'],
      })
    })

    it('accepts a bare nine-digit national number', () => {
      const result = validatePhone('901234567')
      expect(result.valid).toBe(true)
      expect(result.e164).toBe('+998901234567')
      expect(result.country).toBe('UZ')
    })

    it('accepts formatted national input with spaces', () => {
      expect(validatePhone('90 123 45 67').e164).toBe('+998901234567')
    })

    it('recognises a Tashkent landline as fixed line', () => {
      const result = validatePhone('711234567')
      expect(result.valid).toBe(true)
      expect(result.e164).toBe('+998711234567')
      expect(result.lineTypeGuess).toBe('FIXED_LINE')
    })
  })

  describe('international input', () => {
    it('reads a Russian mobile from its +7 prefix', () => {
      const result = validatePhone('+79161234567')
      expect(result.valid).toBe(true)
      expect(result.country).toBe('RU')
      expect(result.e164).toBe('+79161234567')
      expect(result.lineTypeGuess).toBe('MOBILE')
    })

    it('distinguishes Kazakhstan inside the shared +7 plan', () => {
      const result = validatePhone('+77011234567')
      expect(result.valid).toBe(true)
      expect(result.country).toBe('KZ')
    })

    it('tolerates spaces in international input', () => {
      expect(validatePhone('+7 701 123 45 67').e164).toBe('+77011234567')
    })

    it('lets an explicit +country override the default country', () => {
      const result = validatePhone('+79161234567', 'UZ')
      expect(result.country).toBe('RU')
    })
  })

  describe('failures', () => {
    it('classifies too-short input', () => {
      expect(validatePhone('90123')).toEqual({
        e164: null,
        valid: false,
        country: null,
        lineTypeGuess: null,
        reasonCodes: ['PHONE_TOO_SHORT'],
      })
    })

    it('classifies too-long input', () => {
      const result = validatePhone('+9989012345678901')
      expect(result.valid).toBe(false)
      expect(result.e164).toBeNull()
      expect(result.reasonCodes).toEqual(['PHONE_TOO_LONG'])
    })

    it('rejects malformed input as invalid format', () => {
      for (const input of ['abc', 'call me', '+', '++998901234567']) {
        const result = validatePhone(input)
        expect(result.valid).toBe(false)
        expect(result.e164).toBeNull()
        expect(result.reasonCodes).toEqual(['PHONE_INVALID_FORMAT'])
      }
    })

    it('rejects the empty string without consulting the country', () => {
      expect(validatePhone('').reasonCodes).toEqual(['PHONE_INVALID_FORMAT'])
    })

    it('rejects a plausible-length number that fits no numbering plan', () => {
      // Nine digits like a real UZ number, but 54 is not an allocated prefix.
      const result = validatePhone('541234567')
      expect(result.valid).toBe(false)
      expect(result.e164).toBeNull()
      expect(result.reasonCodes).toEqual(['PHONE_INVALID_FORMAT'])
    })

    it('never fabricates an E.164 value for an invalid number', () => {
      for (const input of ['90123', 'abc', '541234567', '+9989012345678901']) {
        expect(validatePhone(input).e164).toBeNull()
      }
    })
  })

  describe('unknown default country', () => {
    it('fails national input under an unsupported default country', () => {
      expect(validatePhone('901234567', 'XX')).toEqual({
        e164: null,
        valid: false,
        country: null,
        lineTypeGuess: null,
        reasonCodes: ['PHONE_UNKNOWN_COUNTRY'],
      })
    })

    it('still accepts +international input under an unsupported default', () => {
      const result = validatePhone('+998901234567', 'XX')
      expect(result.valid).toBe(true)
      expect(result.country).toBe('UZ')
    })

    it('handles lowercase and junk country codes the same way', () => {
      expect(validatePhone('901234567', 'zz').reasonCodes).toEqual(['PHONE_UNKNOWN_COUNTRY'])
      expect(validatePhone('901234567', 'NOT A COUNTRY').reasonCodes).toEqual([
        'PHONE_UNKNOWN_COUNTRY',
      ])
    })
  })

  describe('reason-code discipline', () => {
    it('emits only registered reason codes, whatever the input', () => {
      const inputs = [
        '+998901234567',
        '901234567',
        '711234567',
        '+79161234567',
        '+77011234567',
        '90123',
        '+9989012345678901',
        'abc',
        '',
        '  ',
        '+',
        '999999999',
      ]
      for (const input of inputs) {
        for (const code of validatePhone(input).reasonCodes) {
          expect(isReasonCode(code)).toBe(true)
        }
      }
      for (const code of validatePhone('901234567', 'XX').reasonCodes) {
        expect(isReasonCode(code)).toBe(true)
      }
    })

    it('emits exactly one reason code per result', () => {
      for (const input of ['+998901234567', '90123', 'abc']) {
        expect(validatePhone(input).reasonCodes).toHaveLength(1)
      }
    })
  })
})
