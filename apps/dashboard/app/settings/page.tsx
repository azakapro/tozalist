'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { t } from '../../lib/messages'
import { Shell } from '../../lib/shell'

const RETENTION_OPTIONS = [7, 30, 90] as const

export default function SettingsPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [retention, setRetention] = useState<number>(30)
  const [saved, setSaved] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    api
      .get<{ org_name: string; retention_days: number }>('/internal/settings')
      .then((data) => {
        setOrgName(data.org_name)
        setRetention(data.retention_days)
      })
      .catch(() => undefined)
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    await api.post('/internal/settings', { org_name: orgName, retention_days: retention })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function deleteOrg(event: React.FormEvent) {
    event.preventDefault()
    try {
      await api.post('/internal/org/delete', { confirm_name: confirmName })
      router.replace('/login')
    } catch (error: unknown) {
      setDeleteError(
        error instanceof ApiError && error.status === 400
          ? t('settings.danger.mismatch')
          : t('common.error'),
      )
    }
  }

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">{t('settings.title')}</h1>
      <form onSubmit={save} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm">
          {t('settings.orgName')}
          <input
            required
            minLength={2}
            className="mt-1 w-full max-w-sm rounded border border-slate-300 px-3 py-2"
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">{t('settings.retention.title')}</legend>
          <p className="mb-2 text-xs text-slate-500">{t('settings.retention.explain')}</p>
          <div className="space-y-1">
            {RETENTION_OPTIONS.map((days) => (
              <label key={days} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="retention"
                  checked={retention === days}
                  onChange={() => setRetention(days)}
                />
                <span>{t(`settings.retention.${days}` as 'settings.retention.7')}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {t('settings.save')}
        </button>
        {saved && <span className="ml-2 text-sm text-green-700">{t('settings.saved')}</span>}
      </form>

      <section className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4">
        <h2 className="font-medium text-red-800">{t('settings.danger.title')}</h2>
        <p className="mt-1 text-sm text-red-700">{t('settings.danger.explain')}</p>
        <form onSubmit={deleteOrg} className="mt-3 space-y-2">
          <label className="block text-sm text-red-800">
            {t('settings.danger.confirmLabel')}
            <input
              required
              className="mt-1 w-full max-w-sm rounded border border-red-300 px-3 py-2"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </label>
          {deleteError !== '' && <p className="text-sm text-red-700">{deleteError}</p>}
          <button className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white">
            {t('settings.danger.delete')}
          </button>
        </form>
      </section>
    </Shell>
  )
}
