'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, setCsrfToken } from './api'
import { t } from './messages'

/** Authenticated page shell: loads the session, redirects to /login when it
 * is missing or not MFA-verified, and renders the nav. */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    api
      .get<{ mfa_verified: boolean; csrf_token: string }>('/internal/me')
      .then((me) => {
        if (!me.mfa_verified) {
          router.replace('/login')
          return
        }
        setCsrfToken(me.csrf_token)
        setReady(true)
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) router.replace('/login')
      })
  }, [router])

  async function logout() {
    await api.post('/internal/logout').catch(() => undefined)
    router.replace('/login')
  }

  if (!ready) return <p className="p-8 text-sm text-slate-500">{t('common.loading')}</p>

  return (
    <div className="min-h-screen">
      <nav className="flex items-center gap-6 border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold">{t('app.name')}</span>
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">
          {t('nav.dashboard')}
        </Link>
        <Link href="/check" className="text-sm text-slate-600 hover:text-slate-900">
          {t('nav.check')}
        </Link>
        <Link href="/batches" className="text-sm text-slate-600 hover:text-slate-900">
          {t('nav.batches')}
        </Link>
        <Link href="/usage" className="text-sm text-slate-600 hover:text-slate-900">
          {t('nav.usage')}
        </Link>
        <Link href="/billing" className="text-sm text-slate-600 hover:text-slate-900">
          {t('nav.billing')}
        </Link>
        <Link href="/keys" className="text-sm text-slate-600 hover:text-slate-900">
          {t('nav.keys')}
        </Link>
        <Link href="/settings" className="text-sm text-slate-600 hover:text-slate-900">
          {t('nav.settings')}
        </Link>
        <button onClick={logout} className="ml-auto text-sm text-slate-600 hover:text-slate-900">
          {t('nav.logout')}
        </button>
      </nav>
      <main className="mx-auto max-w-4xl p-6">{children}</main>
    </div>
  )
}
