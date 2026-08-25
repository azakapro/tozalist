/**
 * Typed failures for the engine client. None of these ever carries a full
 * email address or raw local part - callers log them as-is.
 */

/** The engine could not be reached: network failure, or the circuit is open. */
export class EngineUnavailableError extends Error {
  override readonly name = 'EngineUnavailableError'

  constructor(message: string) {
    super(message)
  }
}

/** The request exceeded its deadline. */
export class EngineTimeoutError extends Error {
  override readonly name = 'EngineTimeoutError'
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`engine request timed out after ${timeoutMs}ms`)
    this.timeoutMs = timeoutMs
  }
}

/** The engine answered, but the response does not match the contract. */
export class EngineContractError extends Error {
  override readonly name = 'EngineContractError'

  constructor(detail: string) {
    super(`engine response violates the contract: ${detail}`)
  }
}

/** The engine answered with a non-success HTTP status. */
export class EngineHttpError extends Error {
  override readonly name = 'EngineHttpError'
  readonly status: number

  constructor(status: number) {
    super(`engine responded with HTTP ${status}`)
    this.status = status
  }
}
