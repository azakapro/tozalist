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
}

type Env = Readonly<Record<string, string | undefined>>

/** Reads `API_PORT`, falling back to {@link DEFAULT_API_PORT}. */
export function readApiConfig(env: Env = process.env): ApiConfig {
  return { port: parsePort(env.API_PORT), host: API_HOST }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_API_PORT

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be an integer between 1 and 65535, received "${raw}"`)
  }
  return port
}
