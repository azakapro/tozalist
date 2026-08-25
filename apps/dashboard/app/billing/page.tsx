'use client'

import { useEffect, useState } from 'react'
import { formatAmount, PLANS, type PlanCode } from '@tozalist/core'
import { api } from '../../lib/api'
import { t } from '../../lib/messages'
import { Shell } from '../../lib/shell'

type LedgerRow = {
  id: string
  delta: number
  reason: string
  created_at: string
  running_balance: number
}

type BillingData = {
  balance: number
  last_grant: number | null
  month_to_date: { credits_granted: number; credits_consumed: number; batches_run: number }
  ledger: LedgerRow[]
  statements: string[]
}

type InvoiceResult = { request_id: string; plan: PlanCode; bank_details: string }
type StatementLink = { month: string; url: string; expires_at: string }

/** Prices and allowances render from @tozalist/core PLANS - the same single
 * source of truth the public pricing page uses. */
export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null)
  const [comparePlan, setComparePlan] = useState<PlanCode>('PILOT')
  const [invoicePlan, setInvoicePlan] = useState<PlanCode>('PILOT')
  const [invoiceState, setInvoiceState] = useState<'idle' | 'working' | 'error'>('idle')
  const [invoiceResult, setInvoiceResult] = useState<InvoiceResult | null>(null)
  const [statementLink, setStatementLink] = useState<StatementLink | null>(null)
  const [statementError, setStatementError] = useState(false)

  useEffect(() => {
    api
      .get<BillingData>('/internal/billing')
      .then(setData)
      .catch(() => undefined)
  }, [])

  async function requestInvoice(event: React.FormEvent) {
    event.preventDefault()
    setInvoiceState('working')
    try {
      setInvoiceResult(
        await api.post<InvoiceResult>('/internal/billing/invoice-request', { plan: invoicePlan }),
      )
      setInvoiceState('idle')
    } catch {
      setInvoiceState('error')
    }
  }

  async function fetchStatementLink(month: string) {
    setStatementError(false)
    try {
      setStatementLink(
        await api.post<StatementLink>('/internal/billing/statements/link', { month }),
      )
    } catch {
      setStatementError(true)
    }
  }

  if (data === null) {
    return (
      <Shell>
        <h1 className="mb-4 text-xl font-semibold">{t('billing.title')}</h1>
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </Shell>
    )
  }

  const allowance = PLANS.find((plan) => plan.code === comparePlan)?.checks ?? 0
  const usedPct =
    allowance > 0
      ? Math.min(100, Math.round((data.month_to_date.credits_consumed / allowance) * 100))
      : 0
  const lowBalance = data.last_grant !== null && data.balance < data.last_grant * 0.1

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">{t('billing.title')}</h1>

      {lowBalance && (
        <div
          data-testid="low-balance"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {t('billing.lowBalance')}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm text-slate-500">{t('billing.balance')}</h2>
          <p data-testid="balance" className="mt-1 text-3xl font-bold">
            {data.balance}
          </p>
          {data.last_grant !== null && (
            <p className="mt-1 text-xs text-slate-500">
              {t('billing.lastGrant')}: +{data.last_grant}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm text-slate-500">{t('billing.mtd.title')}</h2>
          <p className="mt-1 text-sm">
            <span data-testid="mtd-consumed" className="font-semibold">
              {data.month_to_date.credits_consumed}
            </span>{' '}
            {t('billing.mtd.consumed').toLowerCase()} · {data.month_to_date.batches_run}{' '}
            {t('billing.mtd.batches').toLowerCase()}
          </p>
          <label className="mt-3 block text-xs text-slate-500">
            {t('billing.plan.select')}
            <select
              data-testid="compare-plan"
              className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm"
              value={comparePlan}
              onChange={(event) => setComparePlan(event.target.value as PlanCode)}
            >
              {PLANS.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.code} — {formatAmount(plan.checks, ',')} checks
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 h-2 w-full rounded bg-slate-100">
            <div
              data-testid="usage-bar"
              className="h-2 rounded bg-slate-700"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {usedPct}% {t('billing.mtd.allowance')} ({formatAmount(allowance, ',')})
          </p>
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{t('billing.invoice.title')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('billing.invoice.explain')}</p>
        {invoiceResult === null ? (
          <form onSubmit={requestInvoice} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex gap-3">
              {PLANS.map((plan) => (
                <label
                  key={plan.code}
                  className={`cursor-pointer rounded-lg border p-3 text-sm ${
                    invoicePlan === plan.code ? 'border-slate-900' : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="plan"
                    className="mr-1"
                    checked={invoicePlan === plan.code}
                    onChange={() => setInvoicePlan(plan.code)}
                  />
                  <span className="font-semibold">{plan.code}</span>
                  <br />
                  {formatAmount(plan.priceUzs, ',')} UZS · {formatAmount(plan.checks, ',')} checks
                </label>
              ))}
            </div>
            {invoiceState === 'error' && (
              <p data-testid="invoice-error" className="text-sm text-red-600">
                {t('common.error')}
              </p>
            )}
            <button
              data-testid="invoice-submit"
              disabled={invoiceState === 'working'}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {invoiceState === 'working'
                ? t('billing.invoice.working')
                : t('billing.invoice.button')}
            </button>
          </form>
        ) : (
          <div data-testid="invoice-done" className="mt-3 rounded-lg bg-slate-50 p-4 text-sm">
            <p className="font-medium">
              {t('billing.invoice.requested')} ({invoiceResult.plan})
            </p>
            <h3 className="mt-2 font-medium">{t('billing.invoice.bank')}</h3>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-700">
              {invoiceResult.bank_details}
            </pre>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{t('billing.statements.title')}</h2>
        {data.statements.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t('billing.statements.none')}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.statements.map((month) => (
              <li key={month} className="flex items-center gap-3 text-sm">
                <span className="font-mono">{month}</span>
                <button
                  data-testid={`statement-${month}`}
                  onClick={() => void fetchStatementLink(month)}
                  className="text-blue-700 underline"
                >
                  {t('billing.statements.download')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {statementError && (
          <p data-testid="statement-error" className="mt-2 text-sm text-red-600">
            {t('common.error')}
          </p>
        )}
        {statementLink !== null && (
          <p className="mt-2 text-sm">
            <a
              data-testid="statement-link"
              href={statementLink.url}
              className="text-blue-700 underline"
            >
              {statementLink.month}.html
            </a>{' '}
            <span className="text-slate-500">{t('billing.statements.linkNote')}</span>
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{t('billing.ledger.title')}</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1">{t('billing.ledger.when')}</th>
              <th className="py-1">{t('billing.ledger.reason')}</th>
              <th className="py-1">{t('billing.ledger.delta')}</th>
              <th className="py-1">{t('billing.ledger.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {data.ledger.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-100">
                <td className="py-1">{new Date(entry.created_at).toISOString().slice(0, 10)}</td>
                <td className="py-1">{entry.reason}</td>
                <td className={`py-1 ${entry.delta < 0 ? 'text-slate-600' : 'text-green-700'}`}>
                  {entry.delta > 0 ? '+' : ''}
                  {entry.delta}
                </td>
                <td className="py-1">{entry.running_balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Shell>
  )
}
