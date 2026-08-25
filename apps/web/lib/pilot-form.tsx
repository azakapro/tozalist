'use client'

import { useState } from 'react'
import { t, type Locale } from './messages'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const VOLUME_RANGES = ['<1k', '1k-10k', '10k-50k', '50k-200k', '200k+'] as const

/** The pilot-request form: posts to the public API, honeypot included. */
export function PilotForm({ locale }: { locale: Locale }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [emailError, setEmailError] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    if (!email.includes('@') || email.length < 5) {
      setEmailError(true)
      return
    }
    setEmailError(false)
    setState('sending')
    try {
      const response = await fetch(`${API_URL}/public/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          company: String(form.get('company') ?? ''),
          phone: String(form.get('phone') ?? ''),
          volume: String(form.get('volume') ?? '') || undefined,
          message: String(form.get('message') ?? ''),
          locale,
          // Honeypot: humans never fill this hidden field.
          website: String(form.get('website') ?? ''),
        }),
      })
      setState(response.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div
        data-testid="form-success"
        className="rounded-lg border border-green-200 bg-green-50 p-6 text-center"
      >
        <p className="text-lg font-semibold text-green-800">{t(locale, 'form.success.title')}</p>
        <p className="mt-1 text-sm text-green-700">{t(locale, 'form.success.text')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">
        {t(locale, 'form.email')} *
        <input
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      {emailError && (
        <p data-testid="email-error" className="text-sm text-red-600">
          {t(locale, 'form.email.invalid')}
        </p>
      )}
      <label className="block text-sm font-medium">
        {t(locale, 'form.company')}
        <input name="company" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm font-medium">
        {t(locale, 'form.phone')}
        <input name="phone" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm font-medium">
        {t(locale, 'form.volume')}
        <select
          name="volume"
          defaultValue=""
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 bg-white"
        >
          <option value="" disabled>
            {t(locale, 'form.volume.placeholder')}
          </option>
          {VOLUME_RANGES.map((range) => (
            <option key={range} value={range}>
              {range}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        {t(locale, 'form.message')}
        <textarea
          name="message"
          rows={3}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      {/* Honeypot: visually hidden, tab-skipped; bots fill it, humans cannot. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
      >
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" data-testid="honeypot" />
        </label>
      </div>
      {state === 'error' && (
        <p data-testid="form-error" className="text-sm text-red-600">
          {t(locale, 'form.error')}
        </p>
      )}
      <button
        disabled={state === 'sending'}
        className="w-full rounded bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-40"
      >
        {state === 'sending' ? t(locale, 'form.sending') : t(locale, 'form.submit')}
      </button>
    </form>
  )
}
