import type { FastifyReply } from 'fastify'

/**
 * The one error envelope every request error uses. Messages are fixed,
 * generic strings: no key material, no emails, no connection strings, and no
 * foreign error text ever flows into a response.
 */

export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INSUFFICIENT_CREDITS: 402,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const

export type ErrorCode = keyof typeof ERROR_CODES

export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'The request is invalid.',
  UNAUTHORIZED: 'Authentication is required.',
  INSUFFICIENT_CREDITS: 'Not enough credits to perform this operation.',
  NOT_FOUND: 'The requested resource does not exist.',
  CONFLICT: 'The resource is in a state that does not allow this operation.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMITED: 'Too many requests. Slow down and retry.',
  INTERNAL_ERROR: 'An internal error occurred.',
}

export type ErrorEnvelope = {
  error: {
    code: ErrorCode
    message: string
    request_id: string
  }
}

export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  message: string = DEFAULT_MESSAGES[code],
): FastifyReply {
  const envelope: ErrorEnvelope = {
    error: { code, message, request_id: reply.request.id },
  }
  return reply.status(ERROR_CODES[code]).send(envelope)
}
