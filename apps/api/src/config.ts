/**
 * Process configuration for the API.
 *
 * Scope note (step 0.1): only the values the HTTP server itself needs. Nothing
 * here reads a secret, so nothing here may be logged carelessly later either.
 */

export const DEFAULT_API_PORT = 3001

/** Bound on every interface: the API is meant to run inside a container. */
export const API_HOST = '0.0.0.0'

export type ApiConfig = {
  readonly port: number
  readonly host: string
  readonly redisUrl: string
  /** Process-level switch for SMTP probing. Defaults to false. */
  readonly smtpEnabled: boolean
  /** Session-cookie auth for /internal; absent disables those routes. */
  readonly internalAuth: {
    sessionSecret: string
    dashboardOrigin: string
    cookieSecure: boolean
  } | null
  /** Public marketing-site origin for CORS and the pilot-request endpoint. */
  readonly webOrigin: string
}

type Env = Readonly<Record<string, string | undefined>>

export const DEFAULT_REDIS_URL = 'redis://localhost:6379'

/** Reads `API_PORT` and `REDIS_URL`, with local-development defaults. */
export function readApiConfig(env: Env = process.env): ApiConfig {
  const rawRedis = env.REDIS_URL
  return {
    port: parsePort(env.API_PORT),
    host: API_HOST,
    redisUrl:
      rawRedis === undefined || rawRedis.trim() === '' ? DEFAULT_REDIS_URL : rawRedis.trim(),
    smtpEnabled: parseSmtpEnabled(env.SMTP_ENABLED),
    internalAuth: parseInternalAuth(env),
    webOrigin:
      env.WEB_ORIGIN === undefined || env.WEB_ORIGIN.trim() === ''
        ? 'http://localhost:3000'
        : env.WEB_ORIGIN.trim(),
  }
}

function parseInternalAuth(env: Env): ApiConfig['internalAuth'] {
  const secret = env.SESSION_SECRET
  if (secret === undefined || secret.trim() === '') return null
  // Never echo the value: it is the session encryption key.
  if (secret.trim().length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  const origin = env.DASHBOARD_ORIGIN?.trim()
  return {
    sessionSecret: secret.trim(),
    dashboardOrigin: origin === undefined || origin === '' ? 'http://localhost:3002' : origin,
    cookieSecure: env.NODE_ENV === 'production',
  }
}

function parseSmtpEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === '') return false
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  // The raw value is not echoed: configuration may be pasted with secrets.
  throw new Error('SMTP_ENABLED must be a boolean')
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_API_PORT

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be an integer between 1 and 65535, received "${raw}"`)
  }
  return port
}
