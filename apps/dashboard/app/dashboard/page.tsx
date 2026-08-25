'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/messages'
import { Shell } from '../../lib/shell'

type Overview = {
  credits: number
  checks_this_month: { email: number; phone: number; total: number }
  recent_batches: Array<{
    batch_id: string
    filename: string
    status: string
    total_rows: number
    created_at: string
  }>
  recent_activity: Array<{ action: string; target_type: string; at: string }>
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    api
      .get<Overview>('/internal/overview')
      .then(setOverview)
      .catch(() => undefined)
  }, [])

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">{t('dashboard.title')}</h1>
      {overview === null ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">{t('dashboard.credits')}</p>
              <p className="text-2xl font-semibold">{overview.credits}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">{t('dashboard.checksThisMonth')}</p>
              <p className="text-2xl font-semibold">{overview.checks_this_month.total}</p>
            </div>
          </div>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-medium">{t('dashboard.recentBatches')}</h2>
            {overview.recent_batches.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.noBatches')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {overview.recent_batches.map((batch) => (
                  <li key={batch.batch_id} className="flex justify-between py-2">
                    <span>{batch.filename}</span>
                    <span className="text-slate-500">
                      {batch.status} · {batch.total_rows}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-medium">{t('dashboard.recentActivity')}</h2>
            {overview.recent_activity.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.noActivity')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {overview.recent_activity.map((event, index) => (
                  <li key={index} className="flex justify-between py-2">
                    <span>{event.action}</span>
                    <span className="text-slate-500">{new Date(event.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Shell>
  )
}
