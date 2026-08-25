'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { api, setCsrfToken } from '../../lib/api'
import { t } from '../../lib/messages'
import { MfaChallenge, MfaEnroll } from '../../lib/mfa-flow'

type Step = 'credentials' | 'mfa_challenge' | 'mfa_setup'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const data = await api.post<{
        mfa_required: boolean
        mfa_setup_required: boolean
        csrf_token: string
      }>('/internal/login', { email, password })
      setCsrfToken(data.csrf_token)
      if (data.mfa_required) setStep('mfa_challenge')
      else if (data.mfa_setup_required) setStep('mfa_setup')
      else router.push('/dashboard')
    } catch {
      setError(t('auth.login.failed'))
    }
  }

  return (
    <main className="mx-auto mt-16 max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      {step === 'credentials' && (
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-xl font-semibold">{t('auth.login.title')}</h1>
          <label className="block text-sm">
            {t('auth.login.email')}
            <input
              type="email"
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            {t('auth.login.password')}
            <input
              type="password"
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error !== '' && <p className="text-sm text-red-600">{error}</p>}
          <button className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            {t('auth.login.submit')}
          </button>
          <p className="text-center text-sm text-slate-500">
            {t('auth.login.noAccount')}{' '}
            <Link href="/signup" className="text-slate-900 underline">
              {t('auth.login.signupLink')}
            </Link>
          </p>
        </form>
      )}
      {step === 'mfa_challenge' && <MfaChallenge onDone={() => router.push('/dashboard')} />}
      {step === 'mfa_setup' && <MfaEnroll onDone={() => router.push('/dashboard')} />}
    </main>
  )
}
