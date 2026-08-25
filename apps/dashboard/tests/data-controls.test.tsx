import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const postMock = vi.fn()
vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: (path: string, body?: unknown) => postMock(path, body) as Promise<unknown>,
  },
}))

import { DataControls } from '../lib/data-controls'

const NOW_MS = Date.parse('2026-08-25T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
})

afterEach(() => {
  cleanup()
  postMock.mockReset()
  vi.useRealTimers()
})

describe('DataControls', () => {
  it('requests an export and shows the signed link with a live expiry countdown', async () => {
    postMock.mockResolvedValue({
      export_id: 'e1',
      url: 'https://minio.local/signed',
      expires_at: new Date(NOW_MS + 24 * 60 * 60 * 1000).toISOString(),
    })
    render(<DataControls />)

    await act(async () => {
      fireEvent.click(screen.getByText('Generate export'))
      await Promise.resolve()
    })

    expect(postMock).toHaveBeenCalledWith('/internal/export', undefined)
    const link = screen.getByTestId('export-link')
    expect(link.getAttribute('href')).toBe('https://minio.local/signed')
    expect(screen.getByTestId('export-countdown').textContent).toContain('24h 00m')

    // The countdown ticks down live...
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    })
    expect(screen.getByTestId('export-countdown').textContent).toContain('22h 00m')

    // ...and flips to an expired notice at the end of the 24 hours.
    await act(async () => {
      vi.advanceTimersByTime(23 * 60 * 60 * 1000)
    })
    expect(screen.queryByTestId('export-countdown')).toBeNull()
    expect(screen.getByTestId('export-expired')).toBeDefined()
  })

  it('keeps the wipe button disabled until the exact word DELETE is typed', async () => {
    postMock.mockResolvedValue({ deleted: true, email_checks: 3, phone_checks: 1, batches: 2 })
    render(<DataControls />)

    const submit = screen.getByTestId('wipe-submit')
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByTestId('wipe-confirm'), { target: { value: 'delete' } })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByTestId('wipe-confirm'), { target: { value: 'DELETE' } })
    expect(submit.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      fireEvent.submit(submit.closest('form') as HTMLFormElement)
      await Promise.resolve()
    })
    expect(postMock).toHaveBeenCalledWith('/internal/checks/delete-all', { confirm: 'DELETE' })
    expect(screen.getByTestId('wipe-done').textContent).toContain('3 / 1 / 2')
  })

  it('surfaces an API failure without pretending anything was deleted', async () => {
    postMock.mockRejectedValue(new Error('boom'))
    render(<DataControls />)
    fireEvent.change(screen.getByTestId('wipe-confirm'), { target: { value: 'DELETE' } })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('wipe-submit').closest('form') as HTMLFormElement)
      await Promise.resolve()
    })
    expect(screen.getByTestId('wipe-error')).toBeDefined()
    expect(screen.queryByTestId('wipe-done')).toBeNull()
  })
})
