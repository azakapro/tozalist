'use client'

import { useState } from 'react'
import { t } from './messages'

/**
 * Client-side row counting and the cost-before-confirm gate. The button
 * literally reads "Use N credits" - nothing uploads until it is pressed.
 */

export function countCsvRows(text: string): number {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return 0
  // A header row containing a recognized email column name is not billed.
  const first = (lines[0] ?? '').toLowerCase()
  const hasHeader = ['email', 'e-mail', 'mail', 'email_address', 'pochta', 'elektron pochta'].some(
    (name) =>
      first
        .split(',')
        .map((cell) => cell.trim())
        .includes(name),
  )
  return hasHeader ? lines.length - 1 : lines.length
}

export function UploadConfirm(props: {
  file: File
  rowCount: number
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  const [confirmed] = useState(false)
  void confirmed
  return (
    <div data-testid="upload-confirm" className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm">
        <span className="font-mono">{props.file.name}</span> —{' '}
        <strong data-testid="row-count">{props.rowCount}</strong> {t('batches.estimate.rows')}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {t('batches.estimate.cost')}: <strong>{props.rowCount}</strong>
      </p>
      <div className="mt-3 flex gap-2">
        <button
          data-testid="confirm-upload"
          disabled={props.busy}
          onClick={props.onConfirm}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {props.busy
            ? t('batches.uploading')
            : t('batches.confirm').replace('{n}', String(props.rowCount))}
        </button>
        <button
          onClick={props.onCancel}
          className="rounded border border-slate-300 px-4 py-2 text-sm"
        >
          {t('batches.cancel')}
        </button>
      </div>
    </div>
  )
}
