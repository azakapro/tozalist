/**
 * Database-error inspection.
 *
 * drizzle-orm >= 0.39 wraps every driver failure in a `DrizzleQueryError`
 * whose own message is a generic "Failed query: ..." summary; the real
 * PostgreSQL error (constraint name, trigger RAISE text, SQLSTATE) lives on
 * the `cause` chain. Anything that needs to recognise a specific database
 * guarantee - the append-only ledger trigger, a unique-reference collision -
 * must therefore look through the chain rather than at the top-level message.
 */

const MAX_CAUSE_DEPTH = 5

/** The message text of an error and every cause below it, newline-joined. */
export function flattenErrorChain(error: unknown, depth = 0): string {
  if (depth > MAX_CAUSE_DEPTH || !(error instanceof Error)) return ''
  const below = flattenErrorChain(error.cause, depth + 1)
  return below === '' ? error.message : `${error.message}\n${below}`
}

/**
 * True when the error, or any error in its cause chain, mentions `needle`.
 * Used to recognise a specific database constraint/trigger regardless of how
 * many wrapper layers the ORM adds.
 */
export function errorChainMentions(error: unknown, needle: string | RegExp): boolean {
  const text = flattenErrorChain(error)
  if (text === '') return false
  return typeof needle === 'string' ? text.includes(needle) : needle.test(text)
}
