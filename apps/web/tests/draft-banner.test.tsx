import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.doUnmock('../lib/site-config')
})
beforeEach(() => vi.resetModules())

describe('DraftBanner', () => {
  it('renders the DRAFT notice while LEGAL_PAGES_DRAFT is on', async () => {
    vi.doMock('../lib/site-config', () => ({ LEGAL_PAGES_DRAFT: true }))
    const { DraftBanner } = await import('../lib/draft-banner')
    render(<DraftBanner />)
    expect(screen.getByTestId('draft-banner').textContent).toContain('DRAFT')
  })

  it('renders nothing once the flag is turned off', async () => {
    vi.doMock('../lib/site-config', () => ({ LEGAL_PAGES_DRAFT: false }))
    const { DraftBanner } = await import('../lib/draft-banner')
    render(<DraftBanner />)
    expect(screen.queryByTestId('draft-banner')).toBeNull()
  })

  it('the real flag is currently on: legal pages ship with the banner', async () => {
    const { LEGAL_PAGES_DRAFT } = await import('../lib/site-config')
    expect(LEGAL_PAGES_DRAFT).toBe(true)
  })
})
