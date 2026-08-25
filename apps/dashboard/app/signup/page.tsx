'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { api, setCsrfToken } from '../../lib/api'
import { t } from '../../lib/messages'
import { MfaEnroll } from '../../lib/mfa-flow'

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState<'form' | 'mfa_setup'>('form')
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const data = await api.post<{ csrf_token: string }>('/internal/signup', {
        org_name: orgName,
        email,
        password,
      })
      setCsrfToken(data.csrf_token)
      setStep('mfa_setup')
    } catch {
      setError(t('auth.signup.failed'))
    }
  }

  return (
    <main className="mx-auto mt-16 max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      {step === 'form' ? (
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-xl font-semibold">{t('auth.signup.title')}</h1>
          <label className="block text-sm">
            {t('auth.signup.orgName')}
            <input
              required
              minLength={2}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
            />
          </label>
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
              minLength={10}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span className="text-xs text-slate-500">{t('auth.password.hint')}</span>
          </label>
          {error !== '' && <p className="text-sm text-red-600">{error}</p>}
          <button className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            {t('auth.signup.submit')}
          </button>
          <p className="text-center text-sm text-slate-500">
            {t('auth.signup.haveAccount')}{' '}
            <Link href="/login" className="text-slate-900 underline">
              {t('auth.signup.loginLink')}
            </Link>
          </p>
        </form>
      ) : (
        <MfaEnroll onDone={() => router.push('/dashboard')} />
      )}
    </main>
  )
}
