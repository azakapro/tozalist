'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/messages'
import { Shell } from '../../lib/shell'
import { ApiUnreachable } from '../../lib/states'

type Usage = {
  balance: number
  ledger: Array<{
    id: string
    delta: number
    reason: string
    created_at: string
    running_balance: number
  }>
  checks_per_day: Array<{ day: string; count: number }>
}

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (from !== '') params.set('from', from)
    if (to !== '') params.set('to', to)
    const query = params.size > 0 ? `?${params.toString()}` : ''
    try {
      setUsage(await api.get<Usage>(`/internal/usage${query}`))
      setUnreachable(false)
    } catch {
      setUnreachable(true)
    }
  }, [from, to])

  // Load once on mount; subsequent loads are explicit via the Apply button.
  useEffect(() => {
    void load()
    // (initial load only - filters apply on demand)
  }, [])

  function exportCsv() {
    if (usage === null) return
    const header = 'date,reason,delta,balance\n'
    const rows = usage.ledger
      .map((entry) => `${entry.created_at},${entry.reason},${entry.delta},${entry.running_balance}`)
      .join('\n')
    const blob = new Blob([header + rows + '\n'], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'tozalist-usage.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">{t('usage.title')}</h1>
      {unreachable && <ApiUnreachable onRetry={() => void load()} />}
      {usage !== null && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">{t('usage.balance')}</p>
            <p className="text-2xl font-semibold">{usage.balance}</p>
          </div>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium">{t('usage.chart')}</h2>
            <ChecksChart data={usage.checks_per_day} />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-500">
                {t('usage.from')}
                <input
                  type="date"
                  className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label className="text-xs text-slate-500">
                {t('usage.to')}
                <input
                  type="date"
                  className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <button
                onClick={() => void load()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                {t('usage.filter')}
              </button>
              <button
                onClick={exportCsv}
                className="ml-auto rounded border border-slate-300 px-3 py-1.5 text-sm"
              >
                {t('usage.export')}
              </button>
            </div>

            {usage.ledger.length === 0 ? (
              <p data-testid="usage-empty" className="p-4 text-sm text-slate-500">
                {t('usage.empty')}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1">{t('usage.table.date')}</th>
                    <th className="py-1">{t('usage.table.reason')}</th>
                    <th className="py-1 text-right">{t('usage.table.delta')}</th>
                    <th className="py-1 text-right">{t('usage.table.balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.ledger.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-100">
                      <td className="py-1">{new Date(entry.created_at).toLocaleString()}</td>
                      <td className="py-1">{entry.reason}</td>
                      <td
                        className={`py-1 text-right ${entry.delta < 0 ? 'text-red-600' : 'text-green-700'}`}
                      >
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </td>
                      <td className="py-1 text-right font-mono">{entry.running_balance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Shell>
  )
}

/** Plain-SVG bar chart: no charting dependency. */
function ChecksChart({ data }: { data: Array<{ day: string; count: number }> }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-500">{t('usage.empty')}</p>
  }
  const width = 600
  const height = 120
  const max = Math.max(...data.map((entry) => entry.count), 1)
  const barWidth = width / data.length
  return (
    <svg
      viewBox={`0 0 ${width} ${height + 16}`}
      className="w-full"
      role="img"
      aria-label={t('usage.chart')}
    >
      {data.map((entry, index) => {
        const barHeight = Math.max(2, (entry.count / max) * height)
        return (
          <g key={entry.day}>
            <rect
              x={index * barWidth + 2}
              y={height - barHeight}
              width={Math.max(2, barWidth - 4)}
              height={barHeight}
              className="fill-slate-700"
            />
            <title>{`${entry.day}: ${entry.count}`}</title>
          </g>
        )
      })}
    </svg>
  )
}
