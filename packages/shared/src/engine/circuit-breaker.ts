import { EngineUnavailableError } from './errors.js'

/**
 * In-memory circuit breaker for the engine service.
 *
 * closed -> (threshold consecutive eligible failures) -> open
 * open -> (cool-down elapses) -> half-open, admitting exactly one probe
 * half-open probe success -> closed; probe failure -> open again
 *
 * "Eligible" failures are service faults: network errors, timeouts, HTTP 5xx
 * and contract drift. HTTP 4xx is a caller bug, not service health, so the
 * client neither counts it nor lets it reset the streak.
 *
 * The clock is injected so tests never wait in real time.
 */
export type CircuitBreakerOptions = {
  clock: () => number
  /** Consecutive eligible failures that open the circuit. */
  failureThreshold?: number
  /** How long the circuit stays open before admitting a probe. */
  openDurationMs?: number
}

type State = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private readonly clock: () => number
  private readonly failureThreshold: number
  private readonly openDurationMs: number

  private state: State = 'closed'
  private consecutiveFailures = 0
  private openedAt = 0
  private probeInFlight = false

  constructor(options: CircuitBreakerOptions) {
    this.clock = options.clock
    this.failureThreshold = options.failureThreshold ?? 5
    this.openDurationMs = options.openDurationMs ?? 30_000
  }

  /**
   * Gate a call. Throws EngineUnavailableError without any I/O when the
   * circuit is open, or when the single half-open probe slot is taken.
   */
  acquire(): void {
    if (this.state === 'open') {
      if (this.clock() - this.openedAt < this.openDurationMs) {
        throw new EngineUnavailableError('engine circuit is open; request not attempted')
      }
      this.state = 'half-open'
      this.probeInFlight = false
    }

    if (this.state === 'half-open') {
      if (this.probeInFlight) {
        throw new EngineUnavailableError('engine circuit is half-open; probe already in flight')
      }
      this.probeInFlight = true
    }
  }

  /** Report that a gated call succeeded. */
  recordSuccess(): void {
    this.state = 'closed'
    this.consecutiveFailures = 0
    this.probeInFlight = false
  }

  /** Report that a gated call failed with an eligible service failure. */
  recordFailure(): void {
    if (this.state === 'half-open') {
      this.open()
      return
    }

    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.open()
    }
  }

  /**
   * Report an outcome that says nothing about service *health* (HTTP 4xx: the
   * request was wrong, but the engine answered it). In the closed state the
   * failure streak neither grows nor resets. A half-open probe that draws a
   * 4xx closes the circuit - the engine demonstrably responded - even though
   * the caller still receives its EngineHttpError.
   */
  recordNeutral(): void {
    if (this.state === 'half-open') {
      this.recordSuccess()
    }
  }

  private open(): void {
    this.state = 'open'
    this.openedAt = this.clock()
    this.consecutiveFailures = 0
    this.probeInFlight = false
  }
}
