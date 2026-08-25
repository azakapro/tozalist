import type { Redis } from 'ioredis'

/**
 * Redis-backed per-MX-host throttle shared by every worker instance.
 *
 * Two rules per destination host, enforced atomically by one Lua script:
 *  - at most 1 concurrent probe (a lease key with a crash-safe TTL), and
 *  - at most 5 probes per rolling 60s window (a sorted-set of start times).
 *
 * Keys:
 *  - `${prefix}lease:{host}`  - the concurrency lease, PX = leaseTtlMs
 *  - `${prefix}window:{host}` - ZSET of probe start times, PX = windowMs
 */
export type MxThrottleOptions = {
  redis: Redis
  keyPrefix?: string
  /** Concurrent probes per host. */
  maxConcurrent?: number
  /** Probes allowed per rolling window. */
  windowLimit?: number
  windowMs?: number
  /** Lease auto-expiry, so a crashed worker cannot block a host forever. */
  leaseTtlMs?: number
  /** Delay before retrying a lease-blocked host (a lease releases quickly). */
  leaseRetryMs?: number
  clock?: () => number
}

export type ThrottleDecision =
  { allowed: true; leaseToken: string } | { allowed: false; retryDelayMs: number }

const ACQUIRE_SCRIPT = `
local lease = KEYS[1]
local window = KEYS[2]
local token = ARGV[1]
local now = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local windowLimit = tonumber(ARGV[4])
local leaseTtlMs = tonumber(ARGV[5])

if redis.call('EXISTS', lease) == 1 then
  local ttl = redis.call('PTTL', lease)
  if ttl < 0 then ttl = leaseTtlMs end
  return {0, ttl, 'lease'}
end

redis.call('ZREMRANGEBYSCORE', window, 0, now - windowMs)
if redis.call('ZCARD', window) >= windowLimit then
  local oldest = redis.call('ZRANGE', window, 0, 0, 'WITHSCORES')
  local retry = (tonumber(oldest[2]) + windowMs) - now
  if retry < 1 then retry = 1 end
  return {0, retry, 'window'}
end

redis.call('SET', lease, token, 'PX', leaseTtlMs)
redis.call('ZADD', window, now, token)
redis.call('PEXPIRE', window, windowMs)
return {1, 0}
`

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export class MxThrottle {
  private readonly redis: Redis
  private readonly prefix: string
  private readonly windowLimit: number
  private readonly windowMs: number
  private readonly leaseTtlMs: number
  private readonly leaseRetryMs: number
  private readonly clock: () => number
  private counter = 0

  constructor(options: MxThrottleOptions) {
    this.redis = options.redis
    this.prefix = options.keyPrefix ?? 'tz:smtp:throttle:'
    // maxConcurrent is fixed at 1 by the single-lease design; reject other values
    // loudly instead of silently ignoring them.
    if (options.maxConcurrent !== undefined && options.maxConcurrent !== 1) {
      throw new Error('MxThrottle supports exactly one concurrent probe per host')
    }
    this.windowLimit = options.windowLimit ?? 5
    this.windowMs = options.windowMs ?? 60_000
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000
    this.leaseRetryMs = options.leaseRetryMs ?? 1_000
    this.clock = options.clock ?? Date.now
  }

  /** Attempts to acquire the probe slot for a host. Never blocks. */
  async acquire(host: string): Promise<ThrottleDecision> {
    this.counter += 1
    const token = `${process.pid}-${this.counter}-${Math.random().toString(36).slice(2, 10)}`

    const result = (await this.redis.eval(
      ACQUIRE_SCRIPT,
      2,
      this.leaseKey(host),
      this.windowKey(host),
      token,
      String(this.clock()),
      String(this.windowMs),
      String(this.windowLimit),
      String(this.leaseTtlMs),
    )) as [number, number, string?]

    if (result[0] === 1) {
      return { allowed: true, leaseToken: token }
    }

    // A held lease usually releases within a probe's duration, so retry soon;
    // the lease TTL itself is only a crash-safety bound, not a schedule. A full
    // window means waiting for the oldest entry to age out. Both are clamped:
    // at least half a second so delays never busy-loop, at most the window.
    const suggested = result[2] === 'lease' ? Math.min(this.leaseRetryMs, result[1]) : result[1]
    const retryDelayMs = Math.min(Math.max(suggested, 500), this.windowMs)
    return { allowed: false, retryDelayMs }
  }

  /** Releases a lease, but only if this caller still owns it. */
  async release(host: string, leaseToken: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, this.leaseKey(host), leaseToken)
  }

  private leaseKey(host: string): string {
    return `${this.prefix}lease:{${host}}`
  }

  private windowKey(host: string): string {
    return `${this.prefix}window:{${host}}`
  }
}
