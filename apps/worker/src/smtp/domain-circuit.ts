import type { Redis } from 'ioredis'

/**
 * Redis-backed per-domain circuit breaker shared by every worker instance.
 *
 * After `threshold` consecutive eligible engine failures for a domain, the
 * domain's circuit opens for `openMs` (production default: one hour). While
 * open, jobs for that domain skip the engine entirely and resolve as unknown
 * with CIRCUIT_OPEN. A successful probe resets the streak.
 *
 * Keys:
 *  - `${prefix}fails:{domain}` - consecutive-failure counter, PX = failureTtlMs
 *  - `${prefix}open:{domain}`  - presence marks the circuit open, PX = openMs
 */
export type DomainCircuitOptions = {
  redis: Redis
  keyPrefix?: string
  /** Consecutive eligible failures that open the circuit. */
  threshold?: number
  /** How long an opened circuit stays open. Production default: one hour. */
  openMs?: number
  /** How long a failure streak survives without new failures. */
  failureTtlMs?: number
}

const RECORD_FAILURE_SCRIPT = `
local fails = KEYS[1]
local open = KEYS[2]
local threshold = tonumber(ARGV[1])
local openMs = tonumber(ARGV[2])
local failureTtlMs = tonumber(ARGV[3])

local count = redis.call('INCR', fails)
redis.call('PEXPIRE', fails, failureTtlMs)
if count >= threshold then
  redis.call('SET', open, '1', 'PX', openMs)
  redis.call('DEL', fails)
  return 1
end
return 0
`

export class DomainCircuit {
  private readonly redis: Redis
  private readonly prefix: string
  private readonly threshold: number
  private readonly openMs: number
  private readonly failureTtlMs: number

  constructor(options: DomainCircuitOptions) {
    this.redis = options.redis
    this.prefix = options.keyPrefix ?? 'tz:smtp:circuit:'
    this.threshold = options.threshold ?? 3
    this.openMs = options.openMs ?? 60 * 60 * 1000
    this.failureTtlMs = options.failureTtlMs ?? this.openMs
  }

  async isOpen(domain: string): Promise<boolean> {
    return (await this.redis.exists(this.openKey(domain))) === 1
  }

  /**
   * Records one eligible failure. Returns true when this failure opened the
   * circuit. HTTP 4xx must not be reported here - it is a caller bug, not
   * domain health.
   */
  async recordFailure(domain: string): Promise<boolean> {
    const opened = (await this.redis.eval(
      RECORD_FAILURE_SCRIPT,
      2,
      this.failsKey(domain),
      this.openKey(domain),
      String(this.threshold),
      String(this.openMs),
      String(this.failureTtlMs),
    )) as number
    return opened === 1
  }

  /** A successful probe clears the domain's failure streak. */
  async recordSuccess(domain: string): Promise<void> {
    await this.redis.del(this.failsKey(domain))
  }

  private failsKey(domain: string): string {
    return `${this.prefix}fails:{${domain}}`
  }

  private openKey(domain: string): string {
    return `${this.prefix}open:{${domain}}`
  }
}
