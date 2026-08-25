'use client'

import { t } from './messages'

/**
 * Verdict presentation. THE UX rule that must never regress: `unknown` is
 * gray - never red, never styled like an error - and always carries the
 * "do not delete" notice. Only `invalid` is red.
 */

export type Verdict = 'valid' | 'invalid' | 'risky' | 'unknown'

export const VERDICT_STYLES: Record<Verdict, { container: string; badge: string; icon: string }> = {
  valid: {
    container: 'border-green-200 bg-green-50',
    badge: 'bg-green-100 text-green-800',
    icon: '✓',
  },
  risky: {
    container: 'border-amber-200 bg-amber-50',
    badge: 'bg-amber-100 text-amber-800',
    icon: '!',
  },
  unknown: {
    container: 'border-slate-200 bg-slate-50',
    badge: 'bg-slate-200 text-slate-700',
    icon: '?',
  },
  invalid: {
    container: 'border-red-200 bg-red-50',
    badge: 'bg-red-100 text-red-800',
    icon: '✕',
  },
}

export function VerdictCard(props: {
  verdict: Verdict
  email: string
  reasonCodes: string[]
  reasonExplanations: Record<string, string>
  suggestion: string | null
  disclaimer: string
}) {
  const style = VERDICT_STYLES[props.verdict]
  return (
    <div
      data-testid="verdict-card"
      data-verdict={props.verdict}
      className={`rounded-lg border p-4 ${style.container}`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`flex h-8 w-8 items-center justify-center rounded-full font-bold ${style.badge}`}
        >
          {style.icon}
        </span>
        <div>
          <p className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${style.badge}`}>
            {t(`check.verdict.${props.verdict}` as 'check.verdict.valid')}
          </p>
          <p className="mt-0.5 font-mono text-sm">{props.email}</p>
        </div>
      </div>

      {props.verdict === 'unknown' && (
        <p
          data-testid="unknown-notice"
          className="mt-3 rounded bg-slate-100 p-2 text-sm text-slate-700"
        >
          {t('check.unknown.notice')}
        </p>
      )}

      {props.suggestion !== null && (
        <p
          data-testid="typo-suggestion"
          className="mt-3 rounded bg-blue-50 p-2 text-sm text-blue-800"
        >
          {t('check.didYouMean')} <strong className="font-mono">{props.suggestion}</strong>?
        </p>
      )}

      {props.reasonCodes.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase text-slate-500">{t('check.reasons')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {props.reasonCodes.map((code) => (
              <li key={code}>
                <span className="font-mono text-xs text-slate-500">{code}</span>{' '}
                {props.reasonExplanations[code] ?? ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p
        data-testid="disclaimer"
        className="mt-4 border-t border-slate-200 pt-2 text-xs text-slate-500"
      >
        {props.disclaimer}
      </p>
    </div>
  )
}
