import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { formatAmount, PLANS } from '@tozalist/core'
import LandingPage from '../app/[locale]/page'
import { LOCALES, MESSAGES_BY_LOCALE, t } from '../lib/messages'

afterEach(cleanup)

/**
 * Single-source-of-truth gate (roadmap 7.2): the public pricing section must
 * render every value FROM @tozalist/core PLANS. If the page (or a message
 * string) reintroduces a hard-coded amount, changing the config breaks this
 * test - divergence cannot ship silently.
 */
describe('pricing single-sourcing', () => {
  it('renders every plan price and allowance from PLANS, in every locale', () => {
    for (const locale of LOCALES) {
      const { container } = render(<LandingPage params={{ locale }} />)
      const text = container.textContent ?? ''
      for (const plan of PLANS) {
        const price = `${formatAmount(plan.priceUzs, t(locale, 'pricing.thousands'))} ${t(locale, 'pricing.currency')}`
        const volume = `${formatAmount(plan.checks, t(locale, 'pricing.thousands'))} ${t(locale, 'pricing.volumeUnit')}`
        expect(text, `${locale} ${plan.code} price`).toContain(price)
        expect(text, `${locale} ${plan.code} volume`).toContain(volume)
      }
      cleanup()
    }
  })

  it('keeps no hard-coded plan amounts in the messages file', () => {
    // The strings live in code now, so amounts may only enter via PLANS.
    for (const locale of LOCALES) {
      const values = Object.values(MESSAGES_BY_LOCALE[locale])
      for (const amount of [
        '500,000',
        '500 000',
        '1,500,000',
        '1 500 000',
        '3,500,000',
        '3 500 000',
      ]) {
        expect(
          values.some((value) => value.includes(amount)),
          `${locale} contains ${amount}`,
        ).toBe(false)
      }
    }
  })
})
