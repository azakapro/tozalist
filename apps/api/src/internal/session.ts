import { randomBytes } from 'node:crypto'
import { sealData, unsealData } from 'iron-session'
import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Stateless encrypted sessions (iron-session seal/unseal) carried in an
 * httpOnly cookie. The CSRF token lives inside the sealed session and must be
 * echoed via the X-CSRF-Token header on every mutation - SameSite=lax plus
 * the token covers cross-site request forgery.
 */

export const SESSION_COOKIE = 'tozalist_session'
const SESSION_TTL_SECONDS = 60 * 60 * 12

export type SessionData = {
  userId: string
  orgId: string
  role: 'admin' | 'member'
  /** True only after a TOTP or recovery-code check in this session. */
  mfaVerified: boolean
  /** Random per-session CSRF token, required on all mutations. */
  csrfToken: string
}

export type SessionConfig = {
  sessionSecret: string
  cookieSecure: boolean
}

export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url')
}

export async function writeSession(
  reply: FastifyReply,
  config: SessionConfig,
  data: SessionData,
): Promise<void> {
  const sealed = await sealData(data, {
    password: config.sessionSecret,
    ttl: SESSION_TTL_SECONDS,
  })
  reply.setCookie(SESSION_COOKIE, sealed, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function readSession(
  request: FastifyRequest,
  config: SessionConfig,
): Promise<SessionData | null> {
  const raw = request.cookies[SESSION_COOKIE]
  if (raw === undefined || raw === '') return null
  try {
    const data = await unsealData<SessionData>(raw, { password: config.sessionSecret })
    if (typeof data.userId !== 'string' || typeof data.csrfToken !== 'string') return null
    return data
  } catch {
    return null
  }
}

export function clearSession(reply: FastifyReply, config: SessionConfig): void {
  reply.setCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}
