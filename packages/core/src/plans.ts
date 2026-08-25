/**
 * Pilot pricing plans - the single source of truth (roadmap 7.2).
 *
 * Client-safe and versioned: no secrets, no bank details, importable by the
 * public web site, the dashboard, and the API alike. The web pricing section
 * and the dashboard billing page both render FROM this array; tests fail if
 * either surface diverges from it.
 *
 * Plans deliberately live in configuration, not the database.
 */

export const PLAN_CONFIG_VERSION = 1 as const

export type Plan = {
  /** Stable machine code; also what an invoice request records. */
  code: 'PILOT' | 'TEAM' | 'API'
  /** Price per period in Uzbek so'm. */
  priceUzs: number
  /** Included checks per period. */
  checks: number
}

export const PLANS: readonly Plan[] = Object.freeze([
  Object.freeze({ code: 'PILOT', priceUzs: 500_000, checks: 10_000 }),
  Object.freeze({ code: 'TEAM', priceUzs: 1_500_000, checks: 50_000 }),
  Object.freeze({ code: 'API', priceUzs: 3_500_000, checks: 200_000 }),
] as const)

export type PlanCode = Plan['code']

export const PLAN_CODES: readonly PlanCode[] = Object.freeze(PLANS.map((plan) => plan.code))

export function getPlan(code: string): Plan | undefined {
  return PLANS.find((plan) => plan.code === code)
}

/** 1500000 with ' ' -> '1 500 000'; with ',' -> '1,500,000'. Locale-agnostic. */
export function formatAmount(value: number, groupSeparator: string): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator)
}
