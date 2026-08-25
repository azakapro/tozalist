import type { Redis } from 'ioredis'

/**
 * A 10-second Redis hint for an org's credit balance.
 *
 * Strictly a read-performance optimisation: a cached value may REFUSE work
 * early (402 before doing anything expensive) but never AUTHORISES a debit -
 * the locked database transaction always re-checks. Any cache failure falls
 * back to the database silently. Keys carry only org UUIDs.
 */
export class BalanceCache {
  private readonly redis: Redis
  private readonly ttlMs: number
  private readonly prefix: string

  constructor(redis: Redis, options: { ttlMs?: number; keyPrefix?: string } = {}) {
    this.redis = redis
    this.ttlMs = options.ttlMs ?? 10_000
    this.prefix = options.keyPrefix ?? 'tz:api:balance:'
  }

  async get(orgId: string): Promise<number | null> {
    try {
      const raw = await this.redis.get(`${this.prefix}${orgId}`)
      if (raw === null) return null
      const value = Number(raw)
      return Number.isInteger(value) ? value : null
    } catch {
      return null
    }
  }

  /** Replaces the cached value, e.g. with the exact post-debit balance. */
  async set(orgId: string, balance: number): Promise<void> {
    try {
      await this.redis.set(`${this.prefix}${orgId}`, String(balance), 'PX', this.ttlMs)
    } catch {
      // A failed hint write is not an error worth surfacing.
    }
  }
}
