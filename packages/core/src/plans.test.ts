import { describe, expect, it } from 'vitest'
import { formatAmount, getPlan, PLAN_CODES, PLANS } from './plans.js'

describe('plan configuration', () => {
  it('pins the roadmap pilot pricing exactly', () => {
    // Changing a price or allowance is a product decision; this test makes
    // it an explicit one.
    expect(PLANS).toEqual([
      { code: 'PILOT', priceUzs: 500_000, checks: 10_000 },
      { code: 'TEAM', priceUzs: 1_500_000, checks: 50_000 },
      { code: 'API', priceUzs: 3_500_000, checks: 200_000 },
    ])
    expect(PLAN_CODES).toEqual(['PILOT', 'TEAM', 'API'])
  })

  it('is frozen: nothing can mutate the source of truth at runtime', () => {
    expect(Object.isFrozen(PLANS)).toBe(true)
    for (const plan of PLANS) expect(Object.isFrozen(plan)).toBe(true)
  })

  it('looks up plans by code and rejects unknown codes', () => {
    expect(getPlan('TEAM')?.checks).toBe(50_000)
    expect(getPlan('ENTERPRISE')).toBeUndefined()
    expect(getPlan('pilot')).toBeUndefined()
  })

  it('formats amounts with any locale group separator', () => {
    expect(formatAmount(500_000, ',')).toBe('500,000')
    expect(formatAmount(1_500_000, ' ')).toBe('1 500 000')
    expect(formatAmount(200_000, ' ')).toBe('200 000')
    expect(formatAmount(999, ',')).toBe('999')
  })
})
