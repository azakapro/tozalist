import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VerdictCard, VERDICT_STYLES, type Verdict } from '../lib/verdict'

afterEach(cleanup)

function renderVerdict(
  verdict: Verdict,
  overrides: Partial<Parameters<typeof VerdictCard>[0]> = {},
) {
  return render(
    <VerdictCard
      verdict={verdict}
      email="user@example.com"
      reasonCodes={['ROLE_ACCOUNT']}
      reasonExplanations={{ ROLE_ACCOUNT: 'The address looks like a shared role.' }}
      suggestion={null}
      disclaimer="These are risk signals, not delivery guarantees."
      {...overrides}
    />,
  )
}

describe('VerdictCard', () => {
  it.each(['valid', 'risky', 'unknown', 'invalid'] as const)(
    'renders the %s verdict with its own styling',
    (verdict) => {
      renderVerdict(verdict)
      const card = screen.getByTestId('verdict-card')
      expect(card.getAttribute('data-verdict')).toBe(verdict)
      expect(card.className).toContain(VERDICT_STYLES[verdict].container.split(' ')[0] ?? '')
    },
  )

  it('CRITICAL: unknown is never styled as an error and is distinct from invalid', () => {
    renderVerdict('unknown')
    const card = screen.getByTestId('verdict-card')

    // No red anywhere on an unknown card: not the container, not the badge.
    expect(card.className).not.toMatch(/red/)
    expect(card.innerHTML).not.toMatch(/red-\d/)

    // The mandated wording is present, verbatim.
    expect(screen.getByTestId('unknown-notice').textContent).toBe(
      'Do not delete — we could not determine this address.',
    )

    // And it is visually distinct from invalid: different container classes.
    cleanup()
    renderVerdict('invalid')
    const invalidCard = screen.getByTestId('verdict-card')
    expect(invalidCard.className).toMatch(/red/)
    expect(invalidCard.className).not.toBe(card.className)
    // Invalid never shows the do-not-delete notice.
    expect(screen.queryByTestId('unknown-notice')).toBeNull()
  })

  it('valid is green, risky is amber, invalid is red', () => {
    renderVerdict('valid')
    expect(screen.getByTestId('verdict-card').className).toMatch(/green/)
    cleanup()
    renderVerdict('risky')
    expect(screen.getByTestId('verdict-card').className).toMatch(/amber/)
    cleanup()
    renderVerdict('invalid')
    expect(screen.getByTestId('verdict-card').className).toMatch(/red/)
  })

  it('shows reason codes with their plain-English explanations', () => {
    renderVerdict('risky', {
      reasonCodes: ['DISPOSABLE_DOMAIN', 'ROLE_ACCOUNT'],
      reasonExplanations: {
        DISPOSABLE_DOMAIN: 'The domain belongs to a temporary email service.',
        ROLE_ACCOUNT: 'The address looks like a shared role.',
      },
    })
    expect(screen.getByText('DISPOSABLE_DOMAIN')).toBeTruthy()
    expect(screen.getByText(/temporary email service/)).toBeTruthy()
    expect(screen.getByText(/shared role/)).toBeTruthy()
  })

  it('shows the typo suggestion prominently when present', () => {
    renderVerdict('risky', { suggestion: 'gmail.com' })
    const suggestion = screen.getByTestId('typo-suggestion')
    expect(suggestion.textContent).toContain('Did you mean')
    expect(suggestion.textContent).toContain('gmail.com')
  })

  it('always renders the disclaimer below the result', () => {
    for (const verdict of ['valid', 'invalid', 'risky', 'unknown'] as const) {
      renderVerdict(verdict)
      expect(screen.getByTestId('disclaimer').textContent).toContain('risk signals')
      cleanup()
    }
  })
})
