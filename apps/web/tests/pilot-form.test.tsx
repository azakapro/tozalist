import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PilotForm } from '../lib/pilot-form'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
})

function fill(name: string, value: string) {
  const field = document.querySelector(`[name="${name}"]`)
  if (field === null) throw new Error(`no field ${name}`)
  fireEvent.change(field, { target: { value } })
}

describe('PilotForm', () => {
  it('contact page usage: posts source landing_contact', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const { container } = render(<PilotForm locale="en" source="landing_contact" />)

    fill('email', 'person@example.com')
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
      await Promise.resolve()
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.source).toBe('landing_contact')
  })

  it('landing page usage: defaults to source landing_pilot', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const { container } = render(<PilotForm locale="uz" />)

    fill('email', 'owner@firma.uz')
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
      await Promise.resolve()
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.source).toBe('landing_pilot')
  })

  it('happy path: posts the lead with locale and shows the success state', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const { container } = render(<PilotForm locale="uz" />)

    fill('email', 'owner@firma.uz')
    fill('company', 'Firma LLC')
    fill('volume', '10k-50k')
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/public/leads')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      email: 'owner@firma.uz',
      company: 'Firma LLC',
      volume: '10k-50k',
      locale: 'uz',
      website: '', // untouched honeypot travels empty
    })
    expect(screen.getByTestId('form-success').textContent).toContain('Rahmat')
  })

  it('client validation: a malformed email never reaches the network', async () => {
    const { container } = render(<PilotForm locale="en" />)
    const email = container.querySelector('[name="email"]') as HTMLInputElement
    email.removeAttribute('type') // bypass native validation to hit ours
    fill('email', 'not-an-email')
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
      await Promise.resolve()
    })
    expect(screen.getByTestId('email-error')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('server failure shows the error state, not raw text', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 })
    const { container } = render(<PilotForm locale="ru" />)
    fill('email', 'someone@firma.ru')
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
      await Promise.resolve()
    })
    expect(screen.getByTestId('form-error').textContent).toContain('пошло не так')
  })

  it('the honeypot field is rendered but hidden from humans', () => {
    render(<PilotForm locale="en" />)
    const honeypot = screen.getByTestId('honeypot')
    expect(honeypot.getAttribute('name')).toBe('website')
    expect(honeypot.getAttribute('tabindex')).toBe('-1')
    const wrapper = honeypot.closest('[aria-hidden="true"]')
    expect(wrapper).not.toBeNull()
  })
})
