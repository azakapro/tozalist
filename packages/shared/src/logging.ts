import { createHash } from 'node:crypto'

/**
 * Log redaction (roadmap 8.1). Two layers, both fail-safe:
 *
 * 1. Key-based redaction paths (REDACT_PATHS) for anything secret-shaped -
 *    passwords, API keys, tokens, webhook secrets, cookies, authorization
 *    headers. These are censored outright.
 * 2. A deep value scrubber (redactLogValue) that walks every logged object
 *    and replaces anything that LOOKS like an email address with
 *    "domain#<hash of local part>" - so even an accidental log of customer
 *    data degrades to a non-identifying form. Applied via the pino
 *    log formatter, it covers fields nobody thought to list.
 */

const EMAIL_PATTERN = /[A-Za-z0-9][\w.+-]*@[A-Za-z0-9][\w-]*(?:\.[A-Za-z0-9][\w-]*)+/g

/** person@example.com -> example.com#a1b2c3d4e5 (domain + local-part hash). */
export function redactEmail(email: string): string {
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const hash = createHash('sha256').update(local).digest('hex').slice(0, 10)
  return `${domain}#${hash}`
}

/** Replaces every email-shaped substring in a string. */
export function redactEmailsInText(text: string): string {
  return text.replace(EMAIL_PATTERN, (match) => redactEmail(match))
}

/** The one fixed censor token used everywhere a value must be hidden. */
const CENSOR = '[REDACTED]'

/**
 * Shaped-secret substrings that must never survive in free text (error
 * messages, stacks, log message strings): our own live keys and endpoint
 * secrets, provider tokens, private-key blocks, and `Bearer <token>` /
 * `Basic <token>` authorization values. Each match is replaced with the fixed
 * censor - not transformed.
 */
const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /\btzl_live_[A-Za-z0-9]{8,}\b/g,
  /\bwhsec_[A-Za-z0-9]{8,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END [^-]*-----/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
]

/**
 * Secret LABEL alternation for free-text `label = value` leaks. Each label is
 * separator-insensitive (`webhook_secret`, `webhook secret`, `webhook-secret`)
 * and matched case-insensitively.
 */
const SECRET_LABEL =
  '(?:passwords?|passwd|pwd|api[ _-]?keys?|access[ _-]?keys?|secret[ _-]?keys?|' +
  'webhook[ _-]?secrets?|client[ _-]?secrets?|secrets?|tokens?|authorization|auth|' +
  'cookies?|mfa(?:[ _-]?codes?)?|recovery[ _-]?codes?|credentials?|private[ _-]?keys?)'

// label followed by `=`/`:` then any non-space value (value censored, not echoed).
const LABELLED_DELIMITED = new RegExp(`\\b(${SECRET_LABEL})(\\s*[:=]\\s*)(\\S+)`, 'gi')
// label followed by whitespace then a >=6-char value: covers `password hunter2`
// while sparing short prose words like "token was".
const LABELLED_WHITESPACE = new RegExp(`\\b(${SECRET_LABEL})(\\s+)(\\S{6,})`, 'gi')

/**
 * Scrubs a free-text string, in order:
 *  1. email-shaped substrings degrade to their domain#hash form (approved);
 *  2. shaped secrets (SECRET_TEXT_PATTERNS incl. `Bearer <token>`) are
 *     censored - run BEFORE the labelled pass so `authorization: Bearer xyz`
 *     loses the whole token, not just up to the first space;
 *  3. labelled `<label><delim><value>` secrets have their VALUE replaced with
 *     the fixed censor, keeping the label and delimiter for readability.
 *
 * Nothing captured is ever echoed. Used for Pino message strings and for
 * Error message/stack text, where key names are unavailable.
 */
export function redactSecretsInText(text: string): string {
  let out = redactEmailsInText(text)
  for (const pattern of SECRET_TEXT_PATTERNS) out = out.replace(pattern, CENSOR)
  out = out.replace(
    LABELLED_DELIMITED,
    (_match, label, delimiter) => `${label}${delimiter}${CENSOR}`,
  )
  out = out.replace(LABELLED_WHITESPACE, (_match, label, gap) => `${label}${gap}${CENSOR}`)
  return out
}

const MAX_DEPTH = 12

/**
 * Key names whose VALUES are secrets at any nesting depth. Matched
 * case-insensitively on normalized key text (separators stripped), so
 * password / passwordHash / api_key / apiKey / X-CSRF-Token all match.
 */
const SECRET_KEY_PATTERN =
  /password|passwd|authorization|cookie|apikey|secret|token|mfa|credential|privatekey/i

/**
 * True when an object key names a secret whose value must be censored.
 *
 * Identifier fields are exempt: a normalized name ending in `id` (api_key_id,
 * token_id, ...) holds a correlation UUID, not key material, and is logged
 * deliberately for tracing - exactly like org_id. Only names that both match
 * the secret pattern AND are not identifiers are censored.
 */
export function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z]/g, '').toLowerCase()
  if (!SECRET_KEY_PATTERN.test(normalized)) return false
  // e.g. apikeyid, tokenid, credentialid -> identifier, not the secret itself.
  if (normalized.length > 2 && normalized.endsWith('id')) return false
  return true
}

/**
 * Redacts an Error into a plain, safe object: the class name is kept for
 * diagnostics, but message and stack are text-scrubbed of emails and shaped
 * secrets, `cause` is walked recursively, and every enumerable own property
 * is redacted key-first. Nothing raw from the error survives.
 */
export type RedactedError = { type: string; message: string; stack: string } & Record<
  string,
  unknown
>

export function redactError(error: Error, seen?: WeakSet<object>): RedactedError {
  const track = seen ?? new WeakSet<object>()
  track.add(error)
  const out: RedactedError = {
    type: error.name,
    message: redactSecretsInText(error.message),
    // Always present (pino's serialized-error shape expects it); scrubbed.
    stack: typeof error.stack === 'string' ? redactSecretsInText(error.stack) : '',
  }
  if (error.cause !== undefined) out.cause = redactLogValue(error.cause, 0, track)
  // Enumerable own props (excluding the ones already handled) - e.g. a
  // secret-bearing field attached to a custom error.
  for (const [key, value] of Object.entries(error)) {
    if (key === 'stack' || key === 'message' || key === 'cause') continue
    out[key] = isSecretKey(key) ? CENSOR : redactLogValue(value, 0, track)
  }
  return out
}

/**
 * Deep-walks a log value: secret-named keys are censored outright at EVERY
 * depth (objects, arrays, arbitrary nesting), Errors are redacted, and every
 * remaining string is scrubbed of email- and secret-shaped substrings.
 *
 * Non-bypassable: a value beyond the depth cap is replaced with the fixed
 * censor (never returned raw), and cycles are broken by identity tracking
 * that yields the censor too - so no source value is ever emitted while
 * handling depth or cycles. This is the authoritative layer; pino's own
 * `redact` paths (one wildcard level) stay wired as defense in depth only.
 */
export function redactLogValue(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactSecretsInText(value)
  if (value === null || typeof value !== 'object') return value
  // Past the cap, censor the whole subtree rather than returning it raw.
  if (depth >= MAX_DEPTH) return CENSOR
  const track = seen ?? new WeakSet<object>()
  // A cycle (or a shared reference already emitted) is censored, not logged.
  if (track.has(value)) return CENSOR
  track.add(value)
  if (value instanceof Error) return redactError(value, track)
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1, track))
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    // The censor replaces the whole value - never a transformation of it.
    out[key] = isSecretKey(key) ? CENSOR : redactLogValue(entry, depth + 1, track)
  }
  return out
}

/**
 * pino `redact` paths for secret-shaped keys, censored entirely. Wildcards
 * cover one nesting level; the deep scrubber handles emails everywhere else.
 */
export const REDACT_PATHS: readonly string[] = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'cookie',
  '*.cookie',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'secret',
  '*.secret',
  'secretHash',
  '*.secretHash',
  'token',
  '*.token',
  'csrfToken',
  '*.csrfToken',
  'mfaSecret',
  '*.mfaSecret',
]

/**
 * pino options fragment shared by the API and the worker: secret-key
 * censoring plus the deep email scrubber on every log call.
 */
export function redactedLoggerOptions(): {
  redact: { paths: string[]; censor: string }
  serializers: { err: (error: Error) => RedactedError }
  formatters: { log: (object: Record<string, unknown>) => Record<string, unknown> }
  hooks: {
    logMethod: (this: unknown, args: unknown[], method: (...rest: unknown[]) => void) => void
  }
} {
  return {
    redact: { paths: [...REDACT_PATHS], censor: CENSOR },
    // Errors placed under an `err` key are redacted before serialization.
    serializers: { err: (error) => redactError(error) },
    formatters: {
      // Covers every merged-object field.
      log: (object) => redactLogValue(object) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        // Pino reads `msg` and serializes a direct Error argument BEFORE the
        // formatter or serializers run, so intercept both here:
        // - a leading Error is replaced with a pre-redacted { err } object,
        //   which also stops pino from lifting its raw message into `msg`;
        // - every string argument (message strings, interpolation values) is
        //   scrubbed of emails and shaped secrets.
        const mapped = args.map((argument) => {
          if (argument instanceof Error) return { err: redactError(argument) }
          if (typeof argument === 'string') return redactSecretsInText(argument)
          return argument
        })
        method.apply(this, mapped)
      },
    },
  }
}
