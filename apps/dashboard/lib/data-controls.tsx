'use client'

import { useEffect, useState } from 'react'
import { api } from './api'
import { t } from './messages'

type ExportResult = { export_id: string; url: string; expires_at: string }
type WipeResult = { deleted: true; email_checks: number; phone_checks: number; batches: number }

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

/** Live countdown to the signed link's expiry; updates once a minute. */
function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const remaining = Date.parse(expiresAt) - nowMs
  if (remaining <= 0) {
    return <span data-testid="export-expired">{t('settings.export.expired')}</span>
  }
  return (
    <span data-testid="export-countdown">
      {t('settings.export.expires')} {formatRemaining(remaining)}
    </span>
  )
}

/** Self-service data lifecycle: export everything, or wipe all check data. */
export function DataControls() {
  const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle')
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [wipeState, setWipeState] = useState<'idle' | 'working' | 'error'>('idle')
  const [wipeResult, setWipeResult] = useState<WipeResult | null>(null)

  async function requestExport() {
    setExportState('working')
    try {
      setExportResult(await api.post<ExportResult>('/internal/export'))
      setExportState('idle')
    } catch {
      setExportState('error')
    }
  }

  async function wipe(event: React.FormEvent) {
    event.preventDefault()
    setWipeState('working')
    try {
      setWipeResult(
        await api.post<WipeResult>('/internal/checks/delete-all', { confirm: confirmText }),
      )
      setWipeState('idle')
      setConfirmText('')
    } catch {
      setWipeState('error')
    }
  }

  return (
    <>
      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{t('settings.export.title')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('settings.export.explain')}</p>
        <button
          onClick={() => void requestExport()}
          disabled={exportState === 'working'}
          className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {exportState === 'working' ? t('settings.export.working') : t('settings.export.button')}
        </button>
        {exportState === 'error' && (
          <p data-testid="export-error" className="mt-2 text-sm text-red-700">
            {t('common.error')}
          </p>
        )}
        {exportResult !== null && (
          <p className="mt-3 text-sm">
            <a
              data-testid="export-link"
              href={exportResult.url}
              className="font-medium text-blue-700 underline"
            >
              {t('settings.export.download')}
            </a>{' '}
            <span className="text-slate-500">
              <ExpiryCountdown expiresAt={exportResult.expires_at} />
            </span>
          </p>
        )}
      </section>

      <section className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4">
        <h2 className="font-medium text-amber-900">{t('settings.wipe.title')}</h2>
        <p className="mt-1 text-sm text-amber-800">{t('settings.wipe.explain')}</p>
        {wipeResult === null ? (
          <form onSubmit={wipe} className="mt-3 space-y-2">
            <label className="block text-sm text-amber-900">
              {t('settings.wipe.confirmLabel')}
              <input
                required
                data-testid="wipe-confirm"
                className="mt-1 w-full max-w-sm rounded border border-amber-400 px-3 py-2"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </label>
            {wipeState === 'error' && (
              <p data-testid="wipe-error" className="text-sm text-red-700">
                {t('common.error')}
              </p>
            )}
            <button
              data-testid="wipe-submit"
              disabled={confirmText !== 'DELETE' || wipeState === 'working'}
              className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('settings.wipe.button')}
            </button>
          </form>
        ) : (
          <p data-testid="wipe-done" className="mt-3 text-sm text-amber-900">
            {t('settings.wipe.done')} ({wipeResult.email_checks} / {wipeResult.phone_checks} /{' '}
            {wipeResult.batches})
          </p>
        )}
      </section>
    </>
  )
}
