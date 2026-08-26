import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { DEFAULT_MESSAGES, sendError, type ErrorCode } from '../errors.js'

/**
 * Request identity and the uniform error envelope.
 *
 * - Every response carries X-Request-Id, a UUID minted here per request. A
 *   caller-supplied ID is never trusted or echoed (genReqId in app.ts ignores
 *   the incoming headers entirely).
 * - Unknown routes, validation failures, oversized bodies and unexpected
 *   exceptions all use the same envelope, with fixed generic messages.
 */
export const foundationPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id)
    return payload
  })

  app.setNotFoundHandler((request, reply) => {
    void request
    return sendError(reply, 'NOT_FOUND')
  })

  app.setErrorHandler((error, request, reply) => {
    // Fastify 5 types the handled error as unknown; narrow it safely without
    // trusting any foreign fields beyond the shape classifyError reads.
    const known = (typeof error === 'object' && error !== null ? error : {}) as {
      statusCode?: number
      code?: string
      name?: string
    }
    const code = classifyError(known)

    if (code === 'INTERNAL_ERROR') {
      // The raw error goes to logs only - and even there just its name, since
      // foreign messages can carry request data.
      request.log.error(
        { request_id: request.id, error_name: known.name ?? 'Error' },
        'unhandled error',
      )
    }

    return sendError(reply, code, DEFAULT_MESSAGES[code])
  })
})

function classifyError(error: { statusCode?: number; code?: string }): ErrorCode {
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) {
    return 'PAYLOAD_TOO_LARGE'
  }
  if (error.statusCode === 429) return 'RATE_LIMITED'
  if (error.statusCode === 401) return 'UNAUTHORIZED'
  if (error.statusCode === 402) return 'INSUFFICIENT_CREDITS'
  if (error.statusCode === 404) return 'NOT_FOUND'
  if (error.statusCode === 409) return 'CONFLICT'
  if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return 'VALIDATION_ERROR'
  }
  return 'INTERNAL_ERROR'
}
