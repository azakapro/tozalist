import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiUnreachable, NoCredits } from '../lib/states'

afterEach(cleanup)

describe('error and empty states', () => {
  it('API-unreachable state offers a retry button that retries', () => {
    const onRetry = vi.fn()
    render(<ApiUnreachable onRetry={onRetry} />)
    expect(screen.getByTestId('api-unreachable').textContent).toContain('could not be reached')
    fireEvent.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('no-credits state links to billing', () => {
    render(<NoCredits />)
    expect(screen.getByTestId('no-credits').textContent).toContain('out of credits')
    const link = screen.getByText('Go to billing') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/settings')
  })
})
