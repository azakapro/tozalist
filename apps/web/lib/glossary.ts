import { REASON_CODES, type ReasonCode } from '@tozalist/core'

/**
 * The reason-code glossary is GENERATED from packages/core's frozen registry -
 * never hand-copied - so it cannot drift. The recommended actions live here
 * (they are product guidance, not core logic); a test fails the build's suite
 * when core adds a code without an action entry.
 */
export const RECOMMENDED_ACTIONS: Record<ReasonCode, string> = {
  SYNTAX_INVALID: 'Remove or fix the address; it can never receive mail as written.',
  DOMAIN_NO_MX: 'Remove it, or re-check later if the domain is being migrated.',
  MX_LOOKUP_UNAVAILABLE: 'Keep it and re-check later; the lookup infrastructure was unavailable.',
  CATCH_ALL_DOMAIN:
    'Keep it; send carefully and watch engagement, since the domain accepts everything.',
  SMTP_UNAVAILABLE: 'Keep it and re-check later; the mail server could not be reached.',
  MAILBOX_REJECTED: 'Remove it from active sending; the server declined the mailbox.',
  MAILBOX_FULL: 'Pause sending and retry in a week; full inboxes often clear.',
  MAILBOX_DISABLED: 'Remove it from active sending; the provider reports it disabled.',
  DISPOSABLE_DOMAIN: 'Treat as short-lived: fine for one-time onboarding, poor for newsletters.',
  ROLE_ACCOUNT: 'Send operational mail only; role addresses are shared inboxes, not people.',
  POSSIBLE_TYPO: 'Show the suggestion to the owner or fix obvious cases before sending.',
  SMTP_NOT_CHECKED:
    'Keep it; run a deeper check with SMTP enabled if you need mailbox-level signals.',
  SMTP_DISABLED: 'Keep it; mailbox probing is off in this environment.',
  CIRCUIT_OPEN: 'Keep it and re-check later; checks for this domain are temporarily paused.',
  PHONE_OK: 'The number fits its national numbering plan.',
  PHONE_INVALID_FORMAT: 'Fix or remove; the number does not match any known format.',
  PHONE_TOO_SHORT: 'Fix the number; digits are missing.',
  PHONE_TOO_LONG: 'Fix the number; it has extra digits.',
  PHONE_UNKNOWN_COUNTRY: 'Add a country code or set the right default country.',
}

export type GlossaryEntry = { code: ReasonCode; meaning: string; action: string }

/** Every code in the registry, with its core explanation and our guidance. */
export function buildGlossary(): GlossaryEntry[] {
  return (Object.keys(REASON_CODES) as ReasonCode[]).map((code) => ({
    code,
    meaning: REASON_CODES[code],
    action: RECOMMENDED_ACTIONS[code],
  }))
}
