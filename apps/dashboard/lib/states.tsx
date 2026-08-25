'use client'

import Link from 'next/link'
import { t } from './messages'

/** Shared empty/error state blocks used across pages. */

export function ApiUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid="api-unreachable"
      className="rounded-lg border border-slate-200 bg-white p-6 text-center"
    >
      <p className="text-sm text-slate-600">{t('common.apiUnreachable')}</p>
      <button
        onClick={onRetry}
        className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
      >
        {t('common.retry')}
      </button>
    </div>
  )
}

export function NoCredits() {
  return (
    <div
      data-testid="no-credits"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"
    >
      <p className="text-amber-800">{t('common.noCredits')}</p>
      <Link href="/settings" className="mt-1 inline-block text-amber-900 underline">
        {t('common.noCreditsLink')}
      </Link>
    </div>
  )
}
