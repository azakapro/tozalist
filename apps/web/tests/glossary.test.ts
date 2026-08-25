import { REASON_CODES } from '@tozalist/core'
import { describe, expect, it } from 'vitest'
import { buildGlossary, RECOMMENDED_ACTIONS } from '../lib/glossary'

/**
 * Drift gate: the public glossary is generated from core's registry, and this
 * test fails the suite the moment core adds a reason code without a
 * recommended action (or the site keeps an action for a code core removed).
 */
describe('reason-code glossary', () => {
  const coreCodes = Object.keys(REASON_CODES).sort()

  it('has a recommended action for every core reason code', () => {
    expect(Object.keys(RECOMMENDED_ACTIONS).sort()).toEqual(coreCodes)
  })

  it('renders every code with a non-empty meaning and action', () => {
    const glossary = buildGlossary()
    expect(glossary.map((entry) => entry.code).sort()).toEqual(coreCodes)
    for (const entry of glossary) {
      expect(entry.meaning.length, entry.code).toBeGreaterThan(10)
      expect(entry.action.length, entry.code).toBeGreaterThan(10)
    }
  })

  it('never tells customers to delete unknown-verdict addresses (§0.2)', () => {
    // The retry-later codes must all say keep/re-check, never remove.
    for (const code of [
      'MX_LOOKUP_UNAVAILABLE',
      'SMTP_UNAVAILABLE',
      'CIRCUIT_OPEN',
      'SMTP_DISABLED',
      'SMTP_NOT_CHECKED',
    ] as const) {
      expect(RECOMMENDED_ACTIONS[code].toLowerCase()).toContain('keep')
      expect(RECOMMENDED_ACTIONS[code].toLowerCase()).not.toContain('remove')
    }
  })
})
