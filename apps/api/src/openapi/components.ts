import { REASON_CODES } from '@tozalist/core'
import { SMTP_STATUSES } from '@tozalist/shared'
import { PHONE_LIMITATION } from '../render.js'

/**
 * Reusable component schemas, registered with app.addSchema so the same
 * definitions drive runtime serialization AND appear as named components in
 * the generated OpenAPI document. Property names are the exact snake_case
 * wire names; drift here would drop fields from real responses, so the
 * integration tests exercise both representations.
 */

export const REASON_CODE_VALUES = Object.keys(REASON_CODES)

export const uuidSchema = {
  $id: 'Uuid',
  type: 'string',
  format: 'uuid',
  description: 'A UUID identifier.',
  examples: ['3f2a4b1c-9d8e-4f00-8a11-000000000000'],
} as const

export const errorEnvelopeSchema = {
  $id: 'ErrorEnvelope',
  type: 'object',
  description: 'The one error envelope every request error uses.',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: [
            'VALIDATION_ERROR',
            'UNAUTHORIZED',
            'INSUFFICIENT_CREDITS',
            'NOT_FOUND',
            'CONFLICT',
            'PAYLOAD_TOO_LARGE',
            'RATE_LIMITED',
            'INTERNAL_ERROR',
          ],
        },
        message: { type: 'string' },
        request_id: { type: 'string', format: 'uuid' },
      },
      required: ['code', 'message', 'request_id'],
      additionalProperties: false,
    },
  },
  required: ['error'],
  additionalProperties: false,
} as const

export const engineSyntaxSchema = {
  $id: 'EngineSyntax',
  type: 'object',
  description: 'Syntax assessment of the address.',
  properties: {
    valid: { type: 'boolean' },
    username: { type: 'string' },
    domain: { type: 'string' },
  },
  required: ['valid', 'username', 'domain'],
  additionalProperties: false,
} as const

export const engineMxSchema = {
  $id: 'EngineMx',
  type: 'object',
  description:
    'MX lookup result. has_mx is null when the lookup itself failed; the error field then says why.',
  properties: {
    has_mx: { type: ['boolean', 'null'] },
    records: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
  required: ['has_mx', 'records', 'error'],
  additionalProperties: false,
} as const

export const engineSmtpSchema = {
  $id: 'EngineSmtp',
  type: 'object',
  description:
    'SMTP probe result. mailbox_accepted is a low-level protocol signal, not a delivery promise.',
  properties: {
    attempted: { type: 'boolean' },
    mailbox_accepted: { type: 'boolean' },
    catch_all: { type: 'boolean' },
    full_inbox: { type: 'boolean' },
    disabled: { type: 'boolean' },
    error: { type: 'string' },
  },
  required: ['attempted', 'mailbox_accepted', 'catch_all', 'full_inbox', 'disabled', 'error'],
  additionalProperties: false,
} as const

export const reasonExplanationsSchema = {
  $id: 'ReasonExplanations',
  type: 'object',
  description: 'Plain, cautious explanation for each returned reason code.',
  additionalProperties: { type: 'string' },
} as const

export const checkMetaSchema = {
  $id: 'CheckMeta',
  type: 'object',
  description:
    'Response metadata. cached results cost nothing: credits_used is 0 and no new check is stored.',
  properties: {
    request_id: { type: 'string', format: 'uuid' },
    credits_used: { type: 'integer', minimum: 0 },
    credits_remaining: { type: 'integer' },
    cached: { type: 'boolean' },
    smtp: {
      type: 'string',
      enum: [...SMTP_STATUSES],
      description:
        'SMTP probe lifecycle: skipped (not requested or not permitted), pending (queued; poll the check), complete (terminal result stored).',
    },
    api_version: { type: 'string', enum: ['v1'] },
  },
  required: ['request_id', 'credits_used', 'credits_remaining', 'cached', 'smtp', 'api_version'],
  additionalProperties: false,
} as const

export const emailCheckDataSchema = {
  $id: 'EmailCheckData',
  type: 'object',
  description:
    'One email verification result. Verdicts are risk signals, never delivery guarantees.',
  properties: {
    check_id: { type: 'string', format: 'uuid' },
    email: { type: 'string', description: 'The normalized address that was checked.' },
    verdict: { type: 'string', enum: ['valid', 'invalid', 'risky', 'unknown'] },
    score: { type: 'number', description: 'Sort key only. Not a probability.' },
    reason_codes: {
      type: 'array',
      items: { type: 'string', enum: REASON_CODE_VALUES },
      description: 'Known reason codes, deciding reason first.',
    },
    reason_explanations: { $ref: 'ReasonExplanations#' },
    suggestion: {
      type: ['string', 'null'],
      description: 'A likely intended provider domain when the input looks misspelled.',
    },
    checks: {
      type: 'object',
      properties: {
        syntax: { $ref: 'EngineSyntax#' },
        domain: { $ref: 'EngineMx#' },
        disposable: { type: 'boolean' },
        role_account: { type: 'boolean' },
        smtp: { anyOf: [{ $ref: 'EngineSmtp#' }, { type: 'null' }] },
      },
      required: ['syntax', 'domain', 'disposable', 'role_account', 'smtp'],
      additionalProperties: false,
    },
    disclaimer: { type: 'string' },
  },
  required: [
    'check_id',
    'email',
    'verdict',
    'score',
    'reason_codes',
    'reason_explanations',
    'suggestion',
    'checks',
    'disclaimer',
  ],
  additionalProperties: false,
} as const

export const phoneCheckDataSchema = {
  $id: 'PhoneCheckData',
  type: 'object',
  description: 'One phone format-validation result. ' + PHONE_LIMITATION,
  properties: {
    check_id: { type: 'string', format: 'uuid' },
    e164: {
      type: ['string', 'null'],
      description: 'E.164 form, only when it could be safely derived.',
    },
    valid: { type: 'boolean' },
    country: { type: ['string', 'null'], description: 'ISO 3166-1 alpha-2 country.' },
    line_type_guess: {
      type: ['string', 'null'],
      description:
        'Numbering-plan inference only (e.g. MOBILE, FIXED_LINE). Not live carrier, owner, or status data.',
    },
    reason_codes: { type: 'array', items: { type: 'string', enum: REASON_CODE_VALUES } },
    reason_explanations: { $ref: 'ReasonExplanations#' },
    limitation: { type: 'string', enum: [PHONE_LIMITATION] },
  },
  required: [
    'check_id',
    'e164',
    'valid',
    'country',
    'line_type_guess',
    'reason_codes',
    'reason_explanations',
    'limitation',
  ],
  additionalProperties: false,
} as const

export const usageDataSchema = {
  $id: 'UsageData',
  type: 'object',
  description: 'Org-scoped usage: balance, current-UTC-month counts and a ledger page.',
  properties: {
    balance: { type: 'integer' },
    checks_this_month: {
      type: 'object',
      properties: {
        email: { type: 'integer' },
        phone: { type: 'integer' },
        total: { type: 'integer' },
      },
      required: ['email', 'phone', 'total'],
      additionalProperties: false,
    },
    ledger: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              delta: { type: 'integer' },
              reason: { type: 'string' },
              reference_id: { type: ['string', 'null'] },
              created_at: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'delta', 'reason', 'reference_id', 'created_at'],
            additionalProperties: false,
          },
        },
        next_cursor: {
          type: ['string', 'null'],
          description:
            'Opaque cursor for the next page, or null on the last page. Pass it back as ?cursor=. Page size defaults to 20; the maximum limit is 100.',
        },
      },
      required: ['entries', 'next_cursor'],
      additionalProperties: false,
    },
  },
  required: ['balance', 'checks_this_month', 'ledger'],
  additionalProperties: false,
} as const

export const usageMetaSchema = {
  $id: 'UsageMeta',
  type: 'object',
  properties: {
    request_id: { type: 'string', format: 'uuid' },
    api_version: { type: 'string', enum: ['v1'] },
  },
  required: ['request_id', 'api_version'],
  additionalProperties: false,
} as const

export const batchDataSchema = {
  $id: 'BatchData',
  type: 'object',
  description: 'One batch upload and its processing state.',
  properties: {
    batch_id: { type: 'string', format: 'uuid' },
    filename: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'validating', 'processing', 'done', 'failed'] },
    total_rows: { type: 'integer' },
    processed_rows: { type: 'integer' },
    malformed_rows: { type: 'integer' },
    charged_credits: { type: 'integer', description: 'Unique, uncached rows actually charged.' },
    cached_rows: { type: 'integer' },
    duplicate_rows: { type: 'integer' },
    verdicts: {
      type: 'object',
      properties: {
        valid: { type: 'integer' },
        invalid: { type: 'integer' },
        risky: { type: 'integer' },
        unknown: { type: 'integer' },
      },
      required: ['valid', 'invalid', 'risky', 'unknown'],
      additionalProperties: false,
    },
    error: { type: ['string', 'null'] },
    created_at: { type: 'string', format: 'date-time' },
    completed_at: { type: ['string', 'null'] },
    download_url: {
      type: ['string', 'null'],
      description: 'A presigned result download link, valid for one hour, once status is done.',
    },
  },
  required: [
    'batch_id',
    'filename',
    'status',
    'total_rows',
    'processed_rows',
    'malformed_rows',
    'charged_credits',
    'cached_rows',
    'duplicate_rows',
    'verdicts',
    'error',
    'created_at',
    'completed_at',
  ],
  additionalProperties: false,
} as const

/** Every component, in registration order (referenced ones first). */
export const ALL_COMPONENTS = [
  uuidSchema,
  errorEnvelopeSchema,
  engineSyntaxSchema,
  engineMxSchema,
  engineSmtpSchema,
  reasonExplanationsSchema,
  checkMetaSchema,
  emailCheckDataSchema,
  phoneCheckDataSchema,
  usageDataSchema,
  usageMetaSchema,
  batchDataSchema,
] as const
