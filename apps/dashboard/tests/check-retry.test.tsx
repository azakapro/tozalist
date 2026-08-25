import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the API module and the authenticated shell before importing the page.
const postMock = vi.fn()
vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: (path: string, body: unknown) => postMock(path, body) as Promise<unknown>,
  },
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('../lib/shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import CheckPage from '../app/check/page'

afterEach(() => {
  cleanup()
  postMock.mockReset()
})

const emailResult = {
  email: 'user@example.com',
  verdict: 'valid',
  reason_codes: [],
  reason_explanations: {},
  suggestion: null,
  disclaimer: 'These are risk signals, not delivery guarantees.',
}

async function submitEmail(value: string) {
  fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value } })
  await act(async () => {
    fireEvent.click(screen.getByText('Check'))
    await Promise.resolve()
  })
}

describe('/check API-unreachable retry', () => {
  it('failure shows the shared retry state; Retry repeats the SAME check and renders the result', async () => {
    postMock
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1: secret-internal-detail'))
      .mockResolvedValue(emailResult)

    render(<CheckPage />)
    await submitEmail('user@example.com')

    // The shared unreachable state with its Retry button - no raw error text.
    const state = screen.getByTestId('api-unreachable')
    expect(state.textContent).toContain('could not be reached')
    expect(document.body.textContent).not.toContain('ECONNREFUSED')
    expect(document.body.textContent).not.toContain('secret-internal-detail')

    // The user edits the input meanwhile; Retry must still repeat the
    // ORIGINALLY submitted check, not the half-typed new one.
    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'half-typed@' },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'))
      await Promise.resolve()
    })

    expect(postMock).toHaveBeenCalledTimes(2)
    expect(postMock.mock.calls[1]).toEqual(['/internal/check/email', { email: 'user@example.com' }])

    // Recovery: the unreachable state is gone and the verdict renders.
    expect(screen.queryByTestId('api-unreachable')).toBeNull()
    expect(screen.getByTestId('verdict-card').getAttribute('data-verdict')).toBe('valid')
  })

  it('a 402 still shows the no-credits state, not the retry state', async () => {
    const { ApiError } = (await import('../lib/api')) as unknown as {
      ApiError: new (status: number, message: string) => Error
    }
    postMock.mockRejectedValueOnce(new ApiError(402, 'no credits'))

    render(<CheckPage />)
    await submitEmail('broke@example.com')

    expect(screen.getByTestId('no-credits')).toBeTruthy()
    expect(screen.queryByTestId('api-unreachable')).toBeNull()
  })

  it('phone checks share the same retry behavior', async () => {
    postMock.mockRejectedValueOnce(new Error('down')).mockResolvedValue({
      e164: '+998901234567',
      valid: true,
      country: 'UZ',
      line_type_guess: 'MOBILE',
      reason_codes: ['PHONE_OK'],
      reason_explanations: { PHONE_OK: 'ok' },
      limitation: 'This is format validation only.',
    })

    render(<CheckPage />)
    fireEvent.click(screen.getByText('Phone'))
    fireEvent.change(screen.getByPlaceholderText('+998 90 123 45 67'), {
      target: { value: '+998901234567' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Check'))
      await Promise.resolve()
    })
    expect(screen.getByTestId('api-unreachable')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'))
      await Promise.resolve()
    })
    expect(postMock.mock.calls[1]).toEqual(['/internal/check/phone', { phone: '+998901234567' }])
    expect(screen.queryByTestId('api-unreachable')).toBeNull()
    expect(screen.getByText('+998901234567')).toBeTruthy()
  })
})
