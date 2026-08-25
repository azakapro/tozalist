import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the API module and the authenticated shell before importing the page.
const getMock = vi.fn()
vi.mock('../lib/api', () => ({
  api: {
    get: (path: string) => getMock(path) as Promise<unknown>,
    post: vi.fn(),
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

import BatchesPage from '../app/batches/page'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  getMock.mockReset()
})

function batch(processed: number, status = 'processing') {
  return {
    batch_id: 'b1',
    filename: 'list.csv',
    status,
    total_rows: 100,
    processed_rows: processed,
    verdicts: { valid: 0, invalid: 0, risky: 0, unknown: 0 },
    created_at: new Date().toISOString(),
  }
}

describe('batches progress polling', () => {
  it('polls while processing and advances the progress bar', async () => {
    vi.useFakeTimers()
    getMock
      .mockResolvedValueOnce({ batches: [batch(20)] }) // initial load
      .mockResolvedValueOnce({ batches: [batch(60)] }) // first poll
      .mockResolvedValue({ batches: [batch(100, 'done')] }) // second poll: finished

    render(<BatchesPage />)
    await act(async () => {
      await Promise.resolve()
    })

    const bar = () => screen.getByTestId('progress').firstElementChild as HTMLElement
    expect(bar().style.width).toBe('20%')
    const callsAfterLoad = getMock.mock.calls.length

    // 2s later: the page re-fetched and the bar moved.
    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(getMock.mock.calls.length).toBeGreaterThan(callsAfterLoad)
    expect(bar().style.width).toBe('60%')

    // Next poll completes the batch: the progress bar disappears.
    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(screen.queryByTestId('progress')).toBeNull()

    // Once nothing is in flight, polling stops.
    const callsWhenDone = getMock.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    expect(getMock.mock.calls.length).toBe(callsWhenDone)
  })

  it('shows the empty state when there are no batches', async () => {
    getMock.mockResolvedValue({ batches: [] })
    render(<BatchesPage />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('batches-empty').textContent).toContain('No batches yet')
  })

  it('shows the API-unreachable state with retry when loading fails', async () => {
    getMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValue({ batches: [] })
    render(<BatchesPage />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('api-unreachable')).toBeTruthy()

    // Retry recovers.
    await act(async () => {
      screen.getByText('Retry').click()
      await Promise.resolve()
    })
    expect(screen.queryByTestId('api-unreachable')).toBeNull()
  })
})
