import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js/max'
import type { ReasonCode } from './reason-codes.js'

/**
 * Offline phone-format validation.
 *
 * Everything here comes from libphonenumber-js's bundled "max" numbering-plan
 * metadata - the variant that includes line-type tables, so getType() can make
 * an offline guess. There is no network access of any kind: no carrier lookup, no HLR,
 * no ownership or live-status data - and none may be added to this package.
 */

export type PhoneResult = {
  /** E.164 form, only when it could be safely derived from the input. */
  e164: string | null
  valid: boolean
  /** ISO 3166-1 alpha-2 country, when the numbering plan identifies one. */
  country: string | null
  /**
   * A guess at the line type (for example "MOBILE" or "FIXED_LINE"), inferred
   * purely from the number's position in its country's numbering plan.
   *
   * This is NOT live carrier data. It does not identify the current carrier
   * (numbers are ported), does not identify an owner, and says nothing about
   * whether the number is active, reachable, or in service.
   */
  lineTypeGuess: string | null
  reasonCodes: ReasonCode[]
}

export const DEFAULT_PHONE_COUNTRY = 'UZ'

const failure = (code: ReasonCode): PhoneResult => ({
  e164: null,
  valid: false,
  country: null,
  lineTypeGuess: null,
  reasonCodes: [code],
})

/**
 * Validates a phone number's format against its numbering plan, offline.
 *
 * Input starting with "+" carries its own country. Anything else is read
 * against `defaultCountry` (Uzbekistan unless told otherwise).
 */
export function validatePhone(
  input: string,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): PhoneResult {
  const trimmed = input.trim()
  const hasExplicitCountry = trimmed.startsWith('+')

  if (!isSupportedCountry(defaultCountry)) {
    // Without a usable default, only "+..." input can be interpreted at all.
    if (!hasExplicitCountry) return failure('PHONE_UNKNOWN_COUNTRY')
  }

  const country: CountryCode | undefined = isSupportedCountry(defaultCountry)
    ? defaultCountry
    : undefined

  if (trimmed === '') return failure('PHONE_INVALID_FORMAT')

  // The length check classifies failures more precisely than parsing alone.
  const lengthProblem = validatePhoneNumberLength(trimmed, country)

  const parsed = parsePhoneNumberFromString(trimmed, country)
  if (parsed === undefined) {
    return failure(classifyFailure(lengthProblem))
  }

  if (!parsed.isValid()) {
    return failure(classifyFailure(lengthProblem))
  }

  return {
    e164: parsed.number,
    valid: true,
    country: parsed.country ?? null,
    lineTypeGuess: parsed.getType() ?? null,
    reasonCodes: ['PHONE_OK'],
  }
}

function classifyFailure(lengthProblem: ReturnType<typeof validatePhoneNumberLength>): ReasonCode {
  switch (lengthProblem) {
    case 'TOO_SHORT':
      return 'PHONE_TOO_SHORT'
    case 'TOO_LONG':
      return 'PHONE_TOO_LONG'
    case 'INVALID_COUNTRY':
      return 'PHONE_UNKNOWN_COUNTRY'
    default:
      // NOT_A_NUMBER, INVALID_LENGTH, or a plan mismatch at a plausible length.
      return 'PHONE_INVALID_FORMAT'
  }
}
