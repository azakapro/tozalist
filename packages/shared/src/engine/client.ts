import { createHash } from 'node:crypto'
import { CircuitBreaker } from './circuit-breaker.js'
import {
  EngineContractError,
  EngineHttpError,
  EngineTimeoutError,
  EngineUnavailableError,
} from './errors.js'
import { engineResponseSchema, type EngineResponse } from './schema.js'

/**
 * Typed, resilient client for the internal Go engine.
 *
 * Emails travel only in POST bodies, never in URLs. Every response is
 * validated against the engine contract before it is returned. Failures are
 * retried within strict limits, and a circuit breaker keeps a dead engine
 * from being hammered.
 */

export type EngineTransportRequest = {
  url: string
  /** Serialised JSON body. Contains the email; must never be logged. */
  body: string
  timeoutMs: number
  /** Propagated API request id; forwarded as the X-Request-Id header. */
  requestId?: string | undefined
}

export type EngineTransportResponse = {
  status: number
  body: string
}

/**
 * The HTTP seam. The default implementation uses fetch; tests inject a mock.
 * A transport reports a timeout by throwing EngineTimeoutError; any other
 * thrown value is treated as a network failure.
 */
export type EngineTransport = (request: EngineTransportRequest) => Promise<EngineTransportResponse>

export type EngineLogger = {
  info(event: string, fields: Record<string, string | number | boolean>): void
}

export type EngineClientOptions = {
  /** Defaults to ENGINE_URL. The constructor throws if neither is set. */
  baseUrl?: string
  transport?: EngineTransport
  logger?: EngineLogger
  /** Millisecond clock. Injected in tests; Date.now in production. */
  clock?: () => number
  /** Sleep between retries. Injected in tests so nothing really waits. */
  delay?: (ms: number) => Promise<void>
  /** Circuit-breaker tuning; defaults are 5 failures / 30s open. */
  breaker?: { failureThreshold?: number; openDurationMs?: number }
}

export type VerifyOptions = {
  smtp: boolean
  catchAll: boolean
  /** Propagated API request id; sent as X-Request-Id for engine-side logs. */
  requestId?: string | undefined
}

const NON_SMTP_TIMEOUT_MS = 5_000
const SMTP_TIMEOUT_MS = 20_000
/** Initial attempt + 2 retries. */
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [200, 800] as const

type Outcome =
  'ok' | 'circuit_open' | 'timeout' | 'network_error' | 'http_4xx' | 'http_5xx' | 'contract_error'

export class EngineClient {
  private readonly baseUrl: string
  private readonly transport: EngineTransport
  private readonly logger: EngineLogger
  private readonly clock: () => number
  private readonly delay: (ms: number) => Promise<void>
  private readonly breaker: CircuitBreaker

  constructor(options: EngineClientOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env.ENGINE_URL
    if (baseUrl === undefined || baseUrl.trim() === '') {
      throw new Error('EngineClient requires a base URL: set ENGINE_URL or pass baseUrl')
    }
    assertHttpUrl(baseUrl)

    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.transport = options.transport ?? fetchTransport
    this.logger = options.logger ?? jsonConsoleLogger
    this.clock = options.clock ?? Date.now
    this.delay = options.delay ?? sleep
    this.breaker = new CircuitBreaker({
      clock: this.clock,
      ...(options.breaker?.failureThreshold !== undefined
        ? { failureThreshold: options.breaker.failureThreshold }
        : {}),
      ...(options.breaker?.openDurationMs !== undefined
        ? { openDurationMs: options.breaker.openDurationMs }
        : {}),
    })
  }

  async verify(email: string, opts: VerifyOptions): Promise<EngineResponse> {
    const started = this.clock()

    try {
      this.breaker.acquire()
    } catch (error) {
      this.logCall(email, started, 'circuit_open', 0)
      throw error
    }

    const request: EngineTransportRequest = {
      url: `${this.baseUrl}/verify`,
      body: JSON.stringify({ email, smtp: opts.smtp, catch_all: opts.catchAll }),
      timeoutMs: opts.smtp ? SMTP_TIMEOUT_MS : NON_SMTP_TIMEOUT_MS,
      ...(opts.requestId !== undefined ? { requestId: opts.requestId } : {}),
    }

    let attempts = 0
    let lastFailure: { error: Error; outcome: Outcome } | null = null

    while (attempts < MAX_ATTEMPTS) {
      attempts += 1

      const attempt = await this.attemptOnce(request)

      if (attempt.kind === 'success') {
        this.breaker.recordSuccess()
        this.logCall(email, started, 'ok', attempts)
        return attempt.response
      }

      if (attempt.kind === 'client_error') {
        // 4xx: our request is wrong. Not retryable, not a health signal.
        this.breaker.recordNeutral()
        this.logCall(email, started, 'http_4xx', attempts)
        throw attempt.error
      }

      lastFailure = attempt
      const retryable =
        attempt.outcome === 'network_error' ||
        attempt.outcome === 'http_5xx' ||
        (attempt.outcome === 'timeout' && !opts.smtp)

      if (!retryable || attempts >= MAX_ATTEMPTS) break

      await this.delay(RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[1])
    }

    // Every service failure - retried out or not retryable - counts once.
    this.breaker.recordFailure()
    if (lastFailure === null) {
      throw new EngineUnavailableError('engine call failed without a recorded cause')
    }
    this.logCall(email, started, lastFailure.outcome, attempts)
    throw lastFailure.error
  }

  private async attemptOnce(
    request: EngineTransportRequest,
  ): Promise<
    | { kind: 'success'; response: EngineResponse }
    | { kind: 'client_error'; error: EngineHttpError }
    | { kind: 'service_failure'; error: Error; outcome: Outcome }
  > {
    let response: EngineTransportResponse
    try {
      response = await this.transport(request)
    } catch (error) {
      if (error instanceof EngineTimeoutError) {
        return { kind: 'service_failure', error, outcome: 'timeout' }
      }
      // The transport's own message is untrusted: a runtime could echo the
      // request URL or body into it, and the body contains the email. A fixed
      // string is the only safe surface.
      return {
        kind: 'service_failure',
        error: new EngineUnavailableError('engine request failed'),
        outcome: 'network_error',
      }
    }

    if (response.status >= 500) {
      return {
        kind: 'service_failure',
        error: new EngineHttpError(response.status),
        outcome: 'http_5xx',
      }
    }
    if (response.status >= 400) {
      return { kind: 'client_error', error: new EngineHttpError(response.status) }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(response.body)
    } catch {
      return {
        kind: 'service_failure',
        error: new EngineContractError('response body is not valid JSON'),
        outcome: 'contract_error',
      }
    }

    const validated = engineResponseSchema.safeParse(parsed)
    if (!validated.success) {
      // Issue paths and codes only: response data contains the email address.
      const detail = validated.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
        .join('; ')
      return {
        kind: 'service_failure',
        error: new EngineContractError(detail),
        outcome: 'contract_error',
      }
    }

    return { kind: 'success', response: validated.data }
  }

  private logCall(email: string, started: number, outcome: Outcome, attempts: number): void {
    this.logger.info('engine_verify', {
      ...emailLogFields(email),
      duration_ms: this.clock() - started,
      outcome,
      attempts,
    })
  }
}

/**
 * The only loggable representation of an email address: the domain in the
 * clear plus a SHA-256 of the local part. Mirrors the Go engine's logging.
 */
export function emailLogFields(email: string): { domain: string; local_hash: string } {
  const at = email.lastIndexOf('@')
  const local = at >= 0 ? email.slice(0, at) : email
  const domain = at >= 0 ? email.slice(at + 1) : ''

  return {
    domain,
    local_hash: createHash('sha256').update(local, 'utf8').digest('hex'),
  }
}

function assertHttpUrl(value: string): void {
  let protocol: string
  try {
    protocol = new URL(value).protocol
  } catch {
    throw new Error('EngineClient base URL is not a valid URL')
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`EngineClient base URL must be http(s), received "${protocol}"`)
  }
}

const fetchTransport: EngineTransport = async (request) => {
  let response: Response
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.requestId !== undefined ? { 'X-Request-Id': request.requestId } : {}),
      },
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs),
    })
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new EngineTimeoutError(request.timeoutMs)
    }
    throw error
  }

  return { status: response.status, body: await response.text() }
}

const jsonConsoleLogger: EngineLogger = {
  info(event, fields) {
    console.log(JSON.stringify({ event, ...fields }))
  },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
