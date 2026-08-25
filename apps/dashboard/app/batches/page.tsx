'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { t } from '../../lib/messages'
import { Shell } from '../../lib/shell'
import { ApiUnreachable, NoCredits } from '../../lib/states'
import { countCsvRows, UploadConfirm } from '../../lib/upload-confirm'

type Batch = {
  batch_id: string
  filename: string
  status: string
  total_rows: number
  processed_rows: number
  verdicts: { valid: number; invalid: number; risky: number; unknown: number }
  created_at: string
  download_url?: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export default function BatchesPage() {
  const [batches, setBatches] = useState<Batch[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [pending, setPending] = useState<{ file: File; rows: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rejected, setRejected] = useState('')
  const [noCredits, setNoCredits] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ batches: Batch[] }>('/internal/batches')
      setBatches(data.batches)
      setUnreachable(false)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) return
      setUnreachable(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll while anything is still processing so progress bars move.
  useEffect(() => {
    if (
      batches === null ||
      !batches.some((batch) => ['pending', 'processing', 'validating'].includes(batch.status))
    ) {
      return
    }
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [batches, refresh])

  async function chooseFile(file: File) {
    setRejected('')
    const text = await file.text()
    setPending({ file, rows: countCsvRows(text) })
  }

  async function confirmUpload() {
    if (pending === null) return
    setUploading(true)
    setNoCredits(false)
    try {
      const form = new FormData()
      form.append('file', pending.file)
      const response = await fetch(`${API_URL}/internal/batches`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': (await api.get<{ csrf_token: string }>('/internal/me')).csrf_token,
        },
        body: form,
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
        if (response.status === 402) setNoCredits(true)
        else setRejected(body.error?.message ?? t('common.error'))
        return
      }
      setPending(null)
      await refresh()
    } finally {
      setUploading(false)
    }
  }

  async function deleteBatch(id: string) {
    if (!window.confirm(t('batches.deleteConfirm'))) return
    await api.post(`/internal/batches/${id}/delete`).catch(() => undefined)
    await refresh()
  }

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">{t('batches.title')}</h1>

      {noCredits && (
        <div className="mb-4">
          <NoCredits />
        </div>
      )}
      {unreachable && <ApiUnreachable onRetry={() => void refresh()} />}

      {pending === null ? (
        <div
          data-testid="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const file = event.dataTransfer.files[0]
            if (file !== undefined) void chooseFile(file)
          }}
          onClick={() => fileInput.current?.click()}
          className="mb-6 cursor-pointer rounded-lg border-2 border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <p className="text-sm text-slate-600">{t('batches.drop')}</p>
          <p className="mt-1 text-xs text-slate-400">{t('batches.dropHint')}</p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) void chooseFile(file)
            }}
          />
        </div>
      ) : (
        <div className="mb-6">
          <UploadConfirm
            file={pending.file}
            rowCount={pending.rows}
            busy={uploading}
            onConfirm={() => void confirmUpload()}
            onCancel={() => setPending(null)}
          />
        </div>
      )}

      {rejected !== '' && (
        <div
          data-testid="upload-rejected"
          className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <strong>{t('batches.rejected')}:</strong> {rejected}
        </div>
      )}

      <h2 className="mb-2 font-medium">{t('batches.history')}</h2>
      {batches === null ? (
        !unreachable && <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : batches.length === 0 ? (
        <p
          data-testid="batches-empty"
          className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500"
        >
          {t('batches.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <BatchRow
              key={batch.batch_id}
              batch={batch}
              onDelete={() => void deleteBatch(batch.batch_id)}
            />
          ))}
        </div>
      )}
    </Shell>
  )
}

function BatchRow({ batch, onDelete }: { batch: Batch; onDelete: () => void }) {
  const [detail, setDetail] = useState<Batch | null>(null)
  const inFlight = ['pending', 'processing', 'validating'].includes(batch.status)
  const progress =
    batch.total_rows === 0 ? 0 : Math.round((batch.processed_rows / batch.total_rows) * 100)

  useEffect(() => {
    if (batch.status === 'done' && detail === null) {
      void api
        .get<Batch>(`/internal/batches/${batch.batch_id}`)
        .then(setDetail)
        .catch(() => undefined)
    }
  }, [batch.status, batch.batch_id, detail])

  const verdictTotal =
    batch.verdicts.valid + batch.verdicts.invalid + batch.verdicts.risky + batch.verdicts.unknown

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-mono">{batch.filename}</span>
        <span className="text-slate-500">
          {batch.status} · {batch.total_rows} {t('batches.rows').toLowerCase()} ·{' '}
          {new Date(batch.created_at).toLocaleString()}
        </span>
      </div>

      {inFlight && (
        <div data-testid="progress" className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
          <div className="h-full bg-slate-700 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {batch.status === 'done' && verdictTotal > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-slate-500">{t('batches.summary')}</p>
          <div className="flex h-4 overflow-hidden rounded text-[10px] leading-4 text-white">
            {(['valid', 'risky', 'unknown', 'invalid'] as const).map((verdict) => {
              const count = batch.verdicts[verdict]
              if (count === 0) return null
              const percent = Math.round((count / verdictTotal) * 100)
              const color = {
                valid: 'bg-green-500',
                risky: 'bg-amber-500',
                unknown: 'bg-slate-400',
                invalid: 'bg-red-500',
              }[verdict]
              return (
                <div
                  key={verdict}
                  className={color}
                  style={{ width: `${percent}%` }}
                  title={`${verdict}: ${count}`}
                >
                  <span className="px-1">
                    {count} ({percent}%)
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-3 text-sm">
        {batch.status === 'done' && detail?.download_url != null && (
          <a href={detail.download_url} className="text-slate-900 underline" download>
            {t('batches.download')}
          </a>
        )}
        {!inFlight && (
          <button onClick={onDelete} className="text-red-600 hover:underline">
            {t('batches.delete')}
          </button>
        )}
      </div>
    </div>
  )
}
