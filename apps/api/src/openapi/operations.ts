import { DEFAULT_MESSAGES, ERROR_CODES, type ErrorCode } from '../errors.js'
import { PHONE_LIMITATION } from '../render.js'

/**
 * The single route/operation registry: every production product route's
 * Fastify schema lives here, carrying its operationId, tag, security and
 * response documentation. Route modules attach these schemas; the OpenAPI
 * coverage test iterates this same registry - there is no second
 * hand-maintained list to drift.
 */

const REQUEST_ID_HEADER = {
  'X-Request-Id': {
    type: 'string',
    description: 'Server-generated UUID identifying this request. Present on every response.',
  },
} as const

const BEARER_SECURITY = [{ bearerApiKey: [] }] as const

function errorResponse(code: ErrorCode, description: string): Record<string, unknown> {
  return {
    description,
    type: 'object',
    headers: REQUEST_ID_HEADER,
    properties: {
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', enum: [code] },
          message: { type: 'string', enum: [DEFAULT_MESSAGES[code]] },
          request_id: { type: 'string', format: 'uuid' },
        },
        required: ['code', 'message', 'request_id'],
        additionalProperties: false,
      },
    },
    required: ['error'],
    additionalProperties: false,
    examples: [
      {
        error: {
          code,
          message: DEFAULT_MESSAGES[code],
          request_id: '3f2a4b1c-9d8e-4f00-8a11-000000000000',
        },
      },
    ],
  }
}

// Errors every authenticated /v1 route can actually produce.
const COMMON_V1_ERRORS = {
  401: errorResponse('UNAUTHORIZED', 'Missing, malformed, revoked, or expired API key.'),
  429: errorResponse('RATE_LIMITED', 'Per-key rate limit exceeded. Retry-After says when.'),
  500: errorResponse('INTERNAL_ERROR', 'Unexpected failure. Nothing was charged.'),
} as const

const EMAIL_EXAMPLE_DATA = {
  check_id: '3f2a4b1c-9d8e-4f00-8a11-000000000000',
  email: 'user@example.com',
  verdict: 'risky',
  score: 65,
  reason_codes: ['POSSIBLE_TYPO'],
  reason_explanations: {
    POSSIBLE_TYPO: 'The domain looks like a misspelling of a well-known email provider.',
  },
  suggestion: 'gmail.com',
  checks: {
    syntax: { valid: true, username: 'user', domain: 'gmai.com' },
    domain: { has_mx: true, records: ['mx.example.com.'], error: '' },
    disposable: false,
    role_account: false,
    smtp: null,
  },
  disclaimer:
    "These are risk signals, not delivery guarantees. Results marked 'unknown' should not be deleted automatically.",
} as const

const EMAIL_EXAMPLE_META = {
  request_id: '3f2a4b1c-9d8e-4f00-8a11-000000000000',
  credits_used: 1,
  credits_remaining: 9999,
  cached: false,
  smtp: 'skipped',
  api_version: 'v1',
} as const

export type ProductOperation = {
  operationId: string
  method: 'GET' | 'POST' | 'DELETE'
  /** OpenAPI path form, e.g. /v1/email/check/{id}. */
  path: string
  schema: Record<string, unknown>
}

export const healthOperation: ProductOperation = {
  operationId: 'health',
  method: 'GET',
  path: '/health',
  schema: {
    operationId: 'health',
    tags: ['System'],
    summary: 'Service liveness',
    description: 'Public liveness probe. Returns exactly {"status":"ok"}.',
    response: {
      200: {
        description: 'The service is up.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: { status: { type: 'string' } },
        required: ['status'],
        additionalProperties: false,
        examples: [{ status: 'ok' }],
      },
    },
  },
}

export const createEmailCheckOperation: ProductOperation = {
  operationId: 'createEmailCheck',
  method: 'POST',
  path: '/v1/email/check',
  schema: {
    operationId: 'createEmailCheck',
    tags: ['Email checks'],
    summary: 'Check one email address',
    description:
      'Runs offline checks (syntax, MX, disposable/role/free lists, typo detection) and returns a risk verdict. ' +
      'Results are risk signals, not delivery guarantees. A fresh result for the same address within 7 days is ' +
      'returned from cache with credits_used 0. Set smtp: true to additionally queue a mailbox probe (runs ' +
      'asynchronously; poll the check by id while meta.smtp is "pending").',
    security: BEARER_SECURITY,
    body: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          minLength: 1,
          maxLength: 320,
          description: 'The address to check. Normalization is applied server-side.',
        },
        smtp: {
          type: 'boolean',
          description: 'Request an asynchronous SMTP mailbox probe. Defaults to false.',
        },
      },
      required: ['email'],
      additionalProperties: false,
      examples: [{ email: 'user@example.com', smtp: false }],
    },
    response: {
      200: {
        description: 'The verification result. cached: true means no credit was used.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: { data: { $ref: 'EmailCheckData#' }, meta: { $ref: 'CheckMeta#' } },
        required: ['data', 'meta'],
        additionalProperties: false,
        examples: [{ data: EMAIL_EXAMPLE_DATA, meta: EMAIL_EXAMPLE_META }],
      },
      400: errorResponse('VALIDATION_ERROR', 'Unknown fields, wrong types, or a missing email.'),
      ...COMMON_V1_ERRORS,
      402: errorResponse('INSUFFICIENT_CREDITS', 'The organization has no credits left.'),
      413: errorResponse('PAYLOAD_TOO_LARGE', 'The JSON body exceeds 1 MB.'),
    },
  },
}

export const getEmailCheckOperation: ProductOperation = {
  operationId: 'getEmailCheck',
  method: 'GET',
  path: '/v1/email/check/{id}',
  schema: {
    operationId: 'getEmailCheck',
    tags: ['Email checks'],
    summary: 'Fetch a stored email check',
    description:
      'Returns a previously created check for the authenticated organization. Never charges credits. ' +
      'Use this to poll meta.smtp until a queued probe reports "complete".',
    security: BEARER_SECURITY,
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
    response: {
      200: {
        description: 'The stored result, rendered exactly like the original response.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: { data: { $ref: 'EmailCheckData#' }, meta: { $ref: 'CheckMeta#' } },
        required: ['data', 'meta'],
        additionalProperties: false,
        examples: [
          {
            data: EMAIL_EXAMPLE_DATA,
            meta: { ...EMAIL_EXAMPLE_META, credits_used: 0, cached: true },
          },
        ],
      },
      400: errorResponse('VALIDATION_ERROR', 'The id is not a UUID.'),
      404: errorResponse(
        'NOT_FOUND',
        'Unknown, expired, or not owned by this organization - all indistinguishable.',
      ),
      ...COMMON_V1_ERRORS,
    },
  },
}

export const createPhoneCheckOperation: ProductOperation = {
  operationId: 'createPhoneCheck',
  method: 'POST',
  path: '/v1/phone/check',
  schema: {
    operationId: 'createPhoneCheck',
    tags: ['Phone checks'],
    summary: 'Check one phone number format',
    description:
      'Offline numbering-plan validation. ' +
      PHONE_LIMITATION +
      ' An invalid number is still a completed, charged format check.',
    security: BEARER_SECURITY,
    body: {
      type: 'object',
      properties: {
        phone: { type: 'string', minLength: 1, maxLength: 64 },
        country: {
          type: 'string',
          minLength: 2,
          maxLength: 2,
          description: 'Default country for national-format input. Defaults to UZ.',
        },
      },
      required: ['phone'],
      additionalProperties: false,
      examples: [{ phone: '+998901234567' }, { phone: '901234567', country: 'UZ' }],
    },
    response: {
      200: {
        description: 'The format-validation result.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: { data: { $ref: 'PhoneCheckData#' }, meta: { $ref: 'CheckMeta#' } },
        required: ['data', 'meta'],
        additionalProperties: false,
        examples: [
          {
            data: {
              check_id: '3f2a4b1c-9d8e-4f00-8a11-000000000000',
              e164: '+998901234567',
              valid: true,
              country: 'UZ',
              line_type_guess: 'MOBILE',
              reason_codes: ['PHONE_OK'],
              reason_explanations: {
                PHONE_OK: 'The number matches the numbering plan for its country.',
              },
              limitation: PHONE_LIMITATION,
            },
            meta: { ...EMAIL_EXAMPLE_META, smtp: 'skipped' },
          },
        ],
      },
      400: errorResponse('VALIDATION_ERROR', 'Unknown fields, wrong types, or a missing phone.'),
      ...COMMON_V1_ERRORS,
      402: errorResponse('INSUFFICIENT_CREDITS', 'The organization has no credits left.'),
      413: errorResponse('PAYLOAD_TOO_LARGE', 'The JSON body exceeds 1 MB.'),
    },
  },
}

export const getUsageOperation: ProductOperation = {
  operationId: 'getUsage',
  method: 'GET',
  path: '/v1/usage',
  schema: {
    operationId: 'getUsage',
    tags: ['Usage'],
    summary: 'Usage and credit balance',
    description:
      'Current balance, checks in the current UTC calendar month, and recent ledger entries. ' +
      'Cursor-paginated: pass next_cursor back as ?cursor=; limit defaults to 20 with a maximum of 100.',
    security: BEARER_SECURITY,
    querystring: {
      type: 'object',
      properties: {
        cursor: { type: 'string', minLength: 1, maxLength: 512 },
        limit: {
          type: 'string',
          pattern: '^[0-9]{1,3}$',
          description: 'Page size, 1-100. Defaults to 20.',
        },
      },
      additionalProperties: false,
    },
    response: {
      200: {
        description: 'The usage summary.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: { data: { $ref: 'UsageData#' }, meta: { $ref: 'UsageMeta#' } },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      400: errorResponse('VALIDATION_ERROR', 'A malformed cursor or an out-of-range limit.'),
      ...COMMON_V1_ERRORS,
    },
  },
}

const SIMPLE_META = {
  type: 'object',
  properties: {
    request_id: { type: 'string', format: 'uuid' },
    api_version: { type: 'string', enum: ['v1'] },
  },
  required: ['request_id', 'api_version'],
  additionalProperties: true,
} as const

export const createBatchOperation: ProductOperation = {
  operationId: 'createBatch',
  method: 'POST',
  path: '/v1/batches',
  schema: {
    operationId: 'createBatch',
    tags: ['Batches'],
    summary: 'Upload a CSV for batch checking',
    description:
      'multipart/form-data upload of one CSV file (max 20 MB, max 100,000 rows). The email column is ' +
      'detected by header name (email, e-mail, mail, email_address, pochta, elektron pochta) or, for ' +
      'headerless files, by sampling the first 50 rows. The full cost (1 credit per row) is reserved ' +
      'up front; unspent credits are refunded when processing completes. Results are risk signals, ' +
      'not delivery guarantees.',
    security: BEARER_SECURITY,
    consumes: ['multipart/form-data'],
    response: {
      200: {
        description: 'The batch was created and queued.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: {
          data: {
            type: 'object',
            properties: {
              batch_id: { type: 'string', format: 'uuid' },
              total_rows: { type: 'integer' },
              credit_cost: { type: 'integer' },
              status: { type: 'string', enum: ['pending'] },
            },
            required: ['batch_id', 'total_rows', 'credit_cost', 'status'],
            additionalProperties: false,
          },
          meta: {
            type: 'object',
            properties: {
              request_id: { type: 'string', format: 'uuid' },
              credits_remaining: { type: 'integer' },
              api_version: { type: 'string', enum: ['v1'] },
            },
            required: ['request_id', 'credits_remaining', 'api_version'],
            additionalProperties: false,
          },
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      400: errorResponse(
        'VALIDATION_ERROR',
        'Missing file, no email column, empty file, or too many rows.',
      ),
      ...COMMON_V1_ERRORS,
      402: errorResponse(
        'INSUFFICIENT_CREDITS',
        'The balance does not cover the batch; the message states the shortfall.',
      ),
      413: errorResponse('PAYLOAD_TOO_LARGE', 'The upload exceeds 20 MB.'),
    },
  },
}

export const getBatchOperation: ProductOperation = {
  operationId: 'getBatch',
  method: 'GET',
  path: '/v1/batches/{id}',
  schema: {
    operationId: 'getBatch',
    tags: ['Batches'],
    summary: 'Batch status, progress and download link',
    description:
      'Progress counters, verdict distribution and - once done - a presigned result download URL valid ' +
      'for one hour. Owner organization only; anything else is an identical 404.',
    security: BEARER_SECURITY,
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
    response: {
      200: {
        description: 'The batch state.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: { data: { $ref: 'BatchData#' }, meta: SIMPLE_META },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      400: errorResponse('VALIDATION_ERROR', 'The id is not a UUID.'),
      404: errorResponse('NOT_FOUND', 'Unknown or not owned by this organization.'),
      ...COMMON_V1_ERRORS,
    },
  },
}

export const listBatchesOperation: ProductOperation = {
  operationId: 'listBatches',
  method: 'GET',
  path: '/v1/batches',
  schema: {
    operationId: 'listBatches',
    tags: ['Batches'],
    summary: 'List batches',
    description: 'Cursor-paginated batches for the organization, newest first. Maximum limit 100.',
    security: BEARER_SECURITY,
    querystring: {
      type: 'object',
      properties: {
        cursor: { type: 'string', minLength: 1, maxLength: 512 },
        limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
      },
      additionalProperties: false,
    },
    response: {
      200: {
        description: 'One page of batches.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: {
          data: {
            type: 'object',
            properties: {
              batches: { type: 'array', items: { $ref: 'BatchData#' } },
              next_cursor: { type: ['string', 'null'] },
            },
            required: ['batches', 'next_cursor'],
            additionalProperties: false,
          },
          meta: SIMPLE_META,
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      400: errorResponse('VALIDATION_ERROR', 'A malformed cursor or out-of-range limit.'),
      ...COMMON_V1_ERRORS,
    },
  },
}

export const deleteBatchOperation: ProductOperation = {
  operationId: 'deleteBatch',
  method: 'DELETE',
  path: '/v1/batches/{id}',
  schema: {
    operationId: 'deleteBatch',
    tags: ['Batches'],
    summary: 'Delete a batch and its files',
    description:
      'Immediately deletes the batch row and both stored CSV objects; audit-logged. Deleting a batch that has ' +
      'not started processing refunds its full credit reservation exactly once. Deleting a completed or failed ' +
      'batch preserves its already-reconciled ledger history. A batch that is currently processing cannot be ' +
      'deleted and returns 409 CONFLICT - retry once it reaches a terminal state.',
    security: BEARER_SECURITY,
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
    response: {
      200: {
        description: 'The batch and its objects were deleted.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: {
          data: {
            type: 'object',
            properties: {
              deleted: { type: 'boolean', enum: [true] },
              batch_id: { type: 'string', format: 'uuid' },
            },
            required: ['deleted', 'batch_id'],
            additionalProperties: false,
          },
          meta: SIMPLE_META,
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      400: errorResponse('VALIDATION_ERROR', 'The id is not a UUID.'),
      404: errorResponse('NOT_FOUND', 'Unknown or not owned by this organization.'),
      409: errorResponse(
        'CONFLICT',
        'The batch is currently being processed; retry after it completes or fails.',
      ),
      ...COMMON_V1_ERRORS,
    },
  },
}

const WEBHOOK_EVENT_ENUM = ['batch.completed', 'batch.failed'] as const

export const createWebhookOperation: ProductOperation = {
  operationId: 'createWebhook',
  method: 'POST',
  path: '/v1/webhooks',
  schema: {
    operationId: 'createWebhook',
    tags: ['Webhooks'],
    summary: 'Register a webhook endpoint',
    description:
      'Registers an HTTPS endpoint for batch lifecycle events. http:// URLs and hostnames resolving to ' +
      'private or reserved addresses are rejected; the address check repeats at every delivery attempt. ' +
      'The signing secret is returned exactly once in this response and cannot be retrieved again. ' +
      'See docs/webhooks.md for signature verification.',
    security: BEARER_SECURITY,
    body: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 12, maxLength: 2048, description: 'HTTPS URL only.' },
        events: {
          type: 'array',
          items: { type: 'string', enum: [...WEBHOOK_EVENT_ENUM] },
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
        },
      },
      required: ['url', 'events'],
      additionalProperties: false,
      examples: [{ url: 'https://example.com/hooks/tozalist', events: ['batch.completed'] }],
    },
    response: {
      200: {
        description: 'The endpoint was registered. Store the secret now - it is shown only once.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: {
          data: {
            type: 'object',
            properties: {
              webhook_id: { type: 'string', format: 'uuid' },
              url: { type: 'string' },
              events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENT_ENUM] } },
              secret: {
                type: 'string',
                description: 'whsec_-prefixed signing secret. Shown exactly once.',
              },
              created_at: { type: 'string', format: 'date-time' },
            },
            required: ['webhook_id', 'url', 'events', 'secret', 'created_at'],
            additionalProperties: false,
          },
          meta: SIMPLE_META,
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      400: errorResponse(
        'VALIDATION_ERROR',
        'Non-HTTPS URL, unknown event, or a hostname resolving to a private/reserved address.',
      ),
      ...COMMON_V1_ERRORS,
    },
  },
}

export const listWebhooksOperation: ProductOperation = {
  operationId: 'listWebhooks',
  method: 'GET',
  path: '/v1/webhooks',
  schema: {
    operationId: 'listWebhooks',
    tags: ['Webhooks'],
    summary: 'List webhook endpoints',
    description: 'Active endpoints for the organization. Secrets are never returned here.',
    security: BEARER_SECURITY,
    response: {
      200: {
        description: 'The active endpoints.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: {
          data: {
            type: 'object',
            properties: {
              webhooks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    webhook_id: { type: 'string', format: 'uuid' },
                    url: { type: 'string' },
                    events: { type: 'array', items: { type: 'string' } },
                    active: { type: 'boolean' },
                    created_at: { type: 'string', format: 'date-time' },
                  },
                  required: ['webhook_id', 'url', 'events', 'active', 'created_at'],
                  additionalProperties: false,
                },
              },
            },
            required: ['webhooks'],
            additionalProperties: false,
          },
          meta: SIMPLE_META,
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      ...COMMON_V1_ERRORS,
    },
  },
}

export const deleteWebhookOperation: ProductOperation = {
  operationId: 'deleteWebhook',
  method: 'DELETE',
  path: '/v1/webhooks/{id}',
  schema: {
    operationId: 'deleteWebhook',
    tags: ['Webhooks'],
    summary: 'Delete a webhook endpoint',
    description:
      'Deactivates the endpoint. Pending deliveries to it finish quietly without sending.',
    security: BEARER_SECURITY,
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
    response: {
      200: {
        description: 'The endpoint was deactivated.',
        type: 'object',
        headers: REQUEST_ID_HEADER,
        properties: {
          data: {
            type: 'object',
            properties: {
              deleted: { type: 'boolean', enum: [true] },
              webhook_id: { type: 'string', format: 'uuid' },
            },
            required: ['deleted', 'webhook_id'],
            additionalProperties: false,
          },
          meta: SIMPLE_META,
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      400: errorResponse('VALIDATION_ERROR', 'The id is not a UUID.'),
      404: errorResponse('NOT_FOUND', 'Unknown or not owned by this organization.'),
      ...COMMON_V1_ERRORS,
    },
  },
}

export const PRODUCT_OPERATIONS: readonly ProductOperation[] = [
  healthOperation,
  createEmailCheckOperation,
  getEmailCheckOperation,
  createPhoneCheckOperation,
  getUsageOperation,
  createBatchOperation,
  getBatchOperation,
  listBatchesOperation,
  deleteBatchOperation,
  createWebhookOperation,
  listWebhooksOperation,
  deleteWebhookOperation,
]

void ERROR_CODES
