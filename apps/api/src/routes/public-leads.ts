import { randomUUID } from 'node:crypto'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { leads, type DatabaseClient } from '@tozalist/db'
import { sendError } from '../errors.js'

/**
 * The landing page's pilot-request endpoint. Public (no auth), so it defends
 * itself: a honeypot field silently swallows bots, and a per-IP Redis window
 * caps submissions. Lead rows are personal data: they carry an expiry for the
 * retention sweep, and nothing personal is ever logged.
 */

export type PublicLeadsOptions = {
  db: DatabaseClient
  redis: Redis
  /** Requests allowed per IP per window. */
  limit?: number
  windowMs?: number
  keyPrefix?: string
}

/** How long pilot leads are kept before the retention sweep removes them. */
export const LEAD_RETENTION_DAYS = 180

const VOLUME_RANGES = ['<1k', '1k-10k', '10k-50k', '50k-200k', '200k+'] as const

const RATE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
if redis.call('ZCARD', key) >= limit then return 0 end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return 1
`

type LeadBody = {
  email: string
  company?: string
  phone?: string
  volume?: string
  message?: string
  locale?: string
  source?: 'landing_pilot' | 'landing_contact'
  /** Honeypot: humans never see it; anything here means a bot. */
  website?: string
}

export const publicLeadRoutes = fp<PublicLeadsOptions>(async (app: FastifyInstance, opts) => {
  const limit = opts.limit ?? 5
  const windowMs = opts.windowMs ?? 60 * 60 * 1000
  const prefix = opts.keyPrefix ?? 'tz:web:leads:'

  app.post<{ Body: LeadBody }>(
    '/public/leads',
    {
      schema: {
        hide: true,
        body: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              minLength: 5,
              maxLength: 320,
              pattern: '^[^\\u0000-\\u001f\\u007f]*$',
            },
            company: { type: 'string', maxLength: 200, pattern: '^[^\\u0000-\\u001f\\u007f]*$' },
            phone: { type: 'string', maxLength: 64, pattern: '^[^\\u0000-\\u001f\\u007f]*$' },
            volume: { type: 'string', enum: [...VOLUME_RANGES] },
            message: { type: 'string', maxLength: 2000 },
            locale: { type: 'string', enum: ['uz', 'ru', 'en'] },
            source: { type: 'string', enum: ['landing_pilot', 'landing_contact'] },
            website: { type: 'string', maxLength: 200 },
          },
          required: ['email'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      // Honeypot: indistinguishable success for the bot, nothing stored.
      if (request.body.website !== undefined && request.body.website !== '') {
        return reply
          .status(200)
          .send({ data: { received: true }, meta: { request_id: request.id } })
      }

      // Per-IP window. Fail closed: an unlimited public write endpoint is
      // worse than a briefly unavailable form.
      let allowed: number
      try {
        allowed = (await opts.redis.eval(
          RATE_SCRIPT,
          1,
          `${prefix}${request.ip}`,
          String(Date.now()),
          String(windowMs),
          String(limit),
          // Collision-proof member from Node's CSPRNG - same rule as the
          // API-key limiter: colliding ZADD members would undercount.
          randomUUID(),
        )) as number
      } catch {
        request.log.error({ request_id: request.id }, 'lead rate-limit state unavailable')
        return sendError(reply, 'INTERNAL_ERROR')
      }
      if (allowed !== 1) return sendError(reply, 'RATE_LIMITED')

      // Trim, and lowercase ONLY the domain: RFC 5321 allows a
      // case-sensitive local part, so it is preserved exactly as entered.
      const email = normalizeLeadEmail(request.body.email)
      if (email === null) {
        return sendError(reply, 'VALIDATION_ERROR', 'A valid email address is required.')
      }

      await opts.db.insert(leads).values({
        email,
        company: emptyToNull(request.body.company),
        phone: emptyToNull(request.body.phone),
        message: composeMessage(request.body.volume, request.body.message),
        source: request.body.source ?? 'landing_pilot',
        locale: request.body.locale ?? 'uz',
        expiresAt: new Date(Date.now() + LEAD_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      })

      return reply.status(200).send({ data: { received: true }, meta: { request_id: request.id } })
    },
  )
})

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function composeMessage(volume: string | undefined, message: string | undefined): string | null {
  const parts: string[] = []
  if (volume !== undefined && volume !== '') parts.push(`volume: ${volume}`)
  const trimmed = message?.trim() ?? ''
  if (trimmed !== '') parts.push(trimmed)
  return parts.length === 0 ? null : parts.join('\n')
}

function normalizeLeadEmail(raw: string): string | null {
  const trimmed = raw.trim()
  const at = trimmed.lastIndexOf('@')
  if (at < 1 || at === trimmed.length - 1 || trimmed.length < 5) return null
  return trimmed.slice(0, at) + '@' + trimmed.slice(at + 1).toLowerCase()
}
