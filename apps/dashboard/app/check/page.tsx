'use client'

import { useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { t } from '../../lib/messages'
import { Shell } from '../../lib/shell'
import { NoCredits } from '../../lib/states'
import { VerdictCard, type Verdict } from '../../lib/verdict'

type EmailResult = {
  email: string
  verdict: Verdict
  reason_codes: string[]
  reason_explanations: Record<string, string>
  suggestion: string | null
  disclaimer: string
}

type PhoneResult = {
  e164: string | null
  valid: boolean
  country: string | null
  line_type_guess: string | null
  reason_codes: string[]
  reason_explanations: Record<string, string>
  limitation: string
}

export default function CheckPage() {
  const [tab, setTab] = useState<'email' | 'phone'>('email')
  const [input, setInput] = useState('')
  const [emailResult, setEmailResult] = useState<EmailResult | null>(null)
  const [phoneResult, setPhoneResult] = useState<PhoneResult | null>(null)
  const [noCredits, setNoCredits] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNoCredits(false)
    setEmailResult(null)
    setPhoneResult(null)
    try {
      if (tab === 'email') {
        setEmailResult(await api.post<EmailResult>('/internal/check/email', { email: input }))
      } else {
        setPhoneResult(await api.post<PhoneResult>('/internal/check/phone', { phone: input }))
      }
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 402) setNoCredits(true)
      else setError(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">{t('check.title')}</h1>
      <div className="mb-4 flex gap-2">
        {(['email', 'phone'] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => {
              setTab(kind)
              setEmailResult(null)
              setPhoneResult(null)
            }}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === kind
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            {t(kind === 'email' ? 'check.email.tab' : 'check.phone.tab')}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mb-6 flex max-w-xl gap-2">
        <input
          required
          className="flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm"
          placeholder={t(tab === 'email' ? 'check.email.placeholder' : 'check.phone.placeholder')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          disabled={busy}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {t('check.submit')}
        </button>
      </form>

      {noCredits && <NoCredits />}
      {error !== '' && <p className="text-sm text-red-600">{error}</p>}

      {emailResult !== null && (
        <div className="max-w-xl">
          <VerdictCard
            verdict={emailResult.verdict}
            email={emailResult.email}
            reasonCodes={emailResult.reason_codes}
            reasonExplanations={emailResult.reason_explanations}
            suggestion={emailResult.suggestion}
            disclaimer={emailResult.disclaimer}
          />
        </div>
      )}

      {phoneResult !== null && (
        <div
          className={`max-w-xl rounded-lg border p-4 ${
            phoneResult.valid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
          }`}
        >
          <p className="text-sm font-semibold">
            {phoneResult.valid ? t('check.phone.valid') : t('check.phone.invalid')}
          </p>
          {phoneResult.e164 !== null && (
            <p className="mt-1 font-mono text-sm">{phoneResult.e164}</p>
          )}
          <ul className="mt-2 space-y-1 text-sm">
            {phoneResult.reason_codes.map((code) => (
              <li key={code}>
                <span className="font-mono text-xs text-slate-500">{code}</span>{' '}
                {phoneResult.reason_explanations[code] ?? ''}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500">
            {phoneResult.limitation}
          </p>
        </div>
      )}
    </Shell>
  )
}
