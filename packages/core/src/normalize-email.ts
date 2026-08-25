/**
 * Email normalization: whitespace, wrappers and domain casing only.
 *
 * This module normalizes; it never validates. A syntactically hopeless string
 * comes back normalized-but-hopeless, and judging validity stays with the
 * engine's syntax check.
 *
 * The local part is preserved exactly as supplied (RFC 5321: it may be
 * case-sensitive, so changing its case can change the target mailbox). Only
 * the domain, which is case-insensitive by definition, is lowercased.
 */

export const EMAIL_CHANGES = Object.freeze({
  TRIMMED_WHITESPACE: 'TRIMMED_WHITESPACE',
  STRIPPED_ANGLE_BRACKETS: 'STRIPPED_ANGLE_BRACKETS',
  STRIPPED_DOUBLE_QUOTES: 'STRIPPED_DOUBLE_QUOTES',
  STRIPPED_SINGLE_QUOTES: 'STRIPPED_SINGLE_QUOTES',
  LOWERCASED_DOMAIN: 'LOWERCASED_DOMAIN',
} as const)

export type EmailChange = keyof typeof EMAIL_CHANGES

export type NormalizedEmail = {
  /** The cleaned address, or null when nothing remains after cleaning. */
  normalized: string | null
  /** Every transformation that was actually applied, in application order. */
  changes: EmailChange[]
}

/** One matching outer wrapper is stripped; mismatched ends are left alone. */
const WRAPPERS: ReadonlyArray<{ open: string; close: string; change: EmailChange }> = [
  { open: '<', close: '>', change: 'STRIPPED_ANGLE_BRACKETS' },
  { open: '"', close: '"', change: 'STRIPPED_DOUBLE_QUOTES' },
  { open: "'", close: "'", change: 'STRIPPED_SINGLE_QUOTES' },
]

export function normalizeEmail(input: string): NormalizedEmail {
  const changes: EmailChange[] = []
  let value = input

  const recordOnce = (change: EmailChange): void => {
    if (!changes.includes(change)) changes.push(change)
  }

  const trimmed = value.trim()
  if (trimmed !== value) recordOnce('TRIMMED_WHITESPACE')
  value = trimmed

  // Strip at most one matching wrapper, e.g. a pasted "<x@example.com>".
  for (const wrapper of WRAPPERS) {
    if (value.length >= 2 && value.startsWith(wrapper.open) && value.endsWith(wrapper.close)) {
      value = value.slice(1, -1)
      recordOnce(wrapper.change)

      const innerTrimmed = value.trim()
      if (innerTrimmed !== value) recordOnce('TRIMMED_WHITESPACE')
      value = innerTrimmed
      break
    }
  }

  if (value === '') {
    return { normalized: null, changes }
  }

  // Lowercase only the domain after the final @. Everything before it is the
  // local part and is preserved byte-for-byte - quoted forms, plus tags and
  // casing included.
  const at = value.lastIndexOf('@')
  if (at > -1) {
    const local = value.slice(0, at)
    const domain = value.slice(at + 1)

    const lowerDomain = domain.toLowerCase()
    if (lowerDomain !== domain) recordOnce('LOWERCASED_DOMAIN')

    value = `${local}@${lowerDomain}`
  }

  return { normalized: value, changes }
}
