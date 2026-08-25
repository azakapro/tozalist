import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatAmount, PLANS } from '@tozalist/core'

const getMock = vi.fn()
const postMock = vi.fn()
vi.mock('../lib/api', () => ({
  api: {
    get: (path: string) => getMock(path) as Promise<unknown>,
    post: (path: string, body?: unknown) => postMock(path, body) as Promise<unknown>,
  },
}))
vi.mock('../lib/shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import BillingPage from '../app/billing/page'

afterEach(() => {
  cleanup()
  getMock.mockReset()
  postMock.mockReset()
})

const BASE_DATA = {
  balance: 8_000,
  last_grant: 10_000,
  month_to_date: { credits_granted: 10_000, credits_consumed: 2_000, batches_run: 3 },
  ledger: [
    {
      id: 'l1',
      delta: 10_000,
      reason: 'grant',
      created_at: '2026-08-01T00:00:00Z',
      running_balance: 10_000,
    },
    {
      id: 'l2',
      delta: -2_000,
      reason: 'batch_check',
      created_at: '2026-08-10T00:00:00Z',
      running_balance: 8_000,
    },
  ],
  statements: ['2026-08', '2026-07'],
}

async function renderBilling(data: typeof BASE_DATA) {
  getMock.mockResolvedValue(data)
  render(<BillingPage />)
  await act(async () => {
    await Promise.resolve()
  })
}

describe('BillingPage', () => {
  it('renders balance, usage, and plan values from the shared PLANS config', async () => {
    await renderBilling(BASE_DATA)
    expect(screen.getByTestId('balance').textContent).toBe('8000')
    expect(screen.getByTestId('mtd-consumed').textContent).toBe('2000')
    // Single-sourcing gate: every plan card shows config-derived numbers.
    for (const plan of PLANS) {
      const price = `${formatAmount(plan.priceUzs, ',')} UZS`
      expect(document.body.textContent).toContain(price)
    }
    // Above 10% of the last grant: no warning.
    expect(screen.queryByTestId('low-balance')).toBeNull()
  })

  it('shows the low-balance warning under 10% of the most recent grant', async () => {
    await renderBilling({ ...BASE_DATA, balance: 999 })
    expect(screen.getByTestId('low-balance')).toBeDefined()
  })

  it('boundary: exactly 10% of the last grant is not yet low', async () => {
    await renderBilling({ ...BASE_DATA, balance: 1_000 })
    expect(screen.queryByTestId('low-balance')).toBeNull()
  })

  it('requests an invoice for the chosen plan and shows bank details from the API only', async () => {
    postMock.mockResolvedValue({
      request_id: 'r1',
      plan: 'TEAM',
      bank_details: 'Transfer to account X (from env)',
    })
    await renderBilling(BASE_DATA)

    fireEvent.click(screen.getByText('TEAM'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('invoice-submit'))
      await Promise.resolve()
    })
    expect(postMock).toHaveBeenCalledWith('/internal/billing/invoice-request', { plan: 'TEAM' })
    expect(screen.getByTestId('invoice-done').textContent).toContain('Transfer to account X')
  })

  it('fetches a time-limited statement link on demand', async () => {
    postMock.mockResolvedValue({
      month: '2026-08',
      url: 'https://minio.local/signed-statement',
      expires_at: '2026-08-25T13:00:00Z',
    })
    await renderBilling(BASE_DATA)

    await act(async () => {
      fireEvent.click(screen.getByTestId('statement-2026-08'))
      await Promise.resolve()
    })
    expect(postMock).toHaveBeenCalledWith('/internal/billing/statements/link', { month: '2026-08' })
    expect(screen.getByTestId('statement-link').getAttribute('href')).toBe(
      'https://minio.local/signed-statement',
    )
  })

  it('surfaces invoice-request failure without pretending success', async () => {
    postMock.mockRejectedValue(new Error('boom'))
    await renderBilling(BASE_DATA)
    await act(async () => {
      fireEvent.click(screen.getByTestId('invoice-submit'))
      await Promise.resolve()
    })
    expect(screen.getByTestId('invoice-error')).toBeDefined()
    expect(screen.queryByTestId('invoice-done')).toBeNull()
  })
})
