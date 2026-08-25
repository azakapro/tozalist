/**
 * The single source of truth for every reason-code string TozaList emits and
 * its customer-facing explanation.
 *
 * Explanations are deliberately cautious: a check reports evidence, never a
 * promise. Nothing here may claim that mail will arrive, that a mailbox is
 * monitored, or that a phone number is active or owned by anyone.
 */
export const REASON_CODES = Object.freeze({
  // --- email ---------------------------------------------------------------
  SYNTAX_INVALID: 'The address is not formatted like a valid email address.',
  DOMAIN_NO_MX: 'The domain does not advertise any mail servers (MX records).',
  MX_LOOKUP_UNAVAILABLE:
    'The mail-server lookup could not be completed, so the domain could not be checked.',
  CATCH_ALL_DOMAIN:
    'The domain accepts mail for any address, so individual mailboxes cannot be told apart.',
  SMTP_UNAVAILABLE: 'The mail server could not be reached to check this mailbox.',
  MAILBOX_REJECTED: 'The mail server declined this mailbox during the check.',
  MAILBOX_FULL: 'The mail server reported that this mailbox is out of storage space.',
  MAILBOX_DISABLED: 'The mail server reported this mailbox as disabled.',
  DISPOSABLE_DOMAIN: 'The domain belongs to a temporary (disposable) email service.',
  ROLE_ACCOUNT:
    'The address looks like a shared role (such as info@ or support@) rather than a person.',
  POSSIBLE_TYPO: 'The domain looks like a misspelling of a well-known email provider.',
  SMTP_NOT_CHECKED: 'The mailbox itself was not probed; only offline checks were performed.',
  SMTP_DISABLED:
    'Mailbox probing is switched off in this environment, so the mailbox could not be examined.',
  CIRCUIT_OPEN:
    'Checks for this domain are temporarily paused after repeated lookup problems; try again later.',

  // --- phone ---------------------------------------------------------------
  PHONE_OK: 'The number matches the numbering plan for its country.',
  PHONE_INVALID_FORMAT: 'The input does not match any known phone-number format.',
  PHONE_TOO_SHORT: 'The number has fewer digits than its numbering plan allows.',
  PHONE_TOO_LONG: 'The number has more digits than its numbering plan allows.',
  PHONE_UNKNOWN_COUNTRY: 'The country could not be determined for this number.',
} as const)

export type ReasonCode = keyof typeof REASON_CODES

/** Narrows an arbitrary string to a known reason code. */
export function isReasonCode(value: string): value is ReasonCode {
  return Object.prototype.hasOwnProperty.call(REASON_CODES, value)
}
