'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/messages'
import { Shell } from '../../lib/shell'

type Key = {
  key_id: string
  name: string
  key_prefix: string
  created_at: string
  revoked_at: string | null
  last_used_at: string | null
}

export default function KeysPage() {
  const [keys, setKeys] = useState<Key[]>([])
  const [name, setName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () =>
    api.get<{ keys: Key[] }>('/internal/keys').then((data) => setKeys(data.keys))
  useEffect(() => {
    void refresh()
  }, [])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    const data = await api.post<{ plaintext_key: string }>('/internal/keys', { name })
    setNewKey(data.plaintext_key)
    setCopied(false)
    setName('')
    await refresh()
  }

  async function revoke(id: string) {
    if (!window.confirm(t('keys.revokeConfirm'))) return
    await api.post(`/internal/keys/${id}/revoke`)
    await refresh()
  }

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">{t('keys.title')}</h1>
      <form onSubmit={create} className="mb-6 flex gap-2">
        <input
          required
          placeholder={t('keys.name')}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {t('keys.create')}
        </button>
      </form>

      {newKey !== null && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40">
          <div className="max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="font-semibold">{t('keys.modal.title')}</h2>
            <p className="mt-2 text-sm text-amber-700">{t('keys.modal.warning')}</p>
            <code className="mt-3 block break-all rounded bg-slate-100 p-3 font-mono text-sm">
              {newKey}
            </code>
            <div className="mt-4 flex gap-2">
              <button
                className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
                onClick={() => {
                  void navigator.clipboard.writeText(newKey)
                  setCopied(true)
                }}
              >
                {copied ? t('keys.modal.copied') : t('keys.modal.copy')}
              </button>
              <button
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                onClick={() => setNewKey(null)}
              >
                {t('keys.modal.done')}
              </button>
            </div>
          </div>
        </div>
      )}

      <table className="w-full rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="p-3">{t('keys.name')}</th>
            <th className="p-3">{t('keys.prefix')}</th>
            <th className="p-3">{t('keys.created')}</th>
            <th className="p-3">{t('keys.lastUsed')}</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.key_id} className="border-t border-slate-100">
              <td className="p-3">{key.name}</td>
              <td className="p-3 font-mono">{key.key_prefix}…</td>
              <td className="p-3">{new Date(key.created_at).toLocaleDateString()}</td>
              <td className="p-3">
                {key.last_used_at === null
                  ? t('keys.never')
                  : new Date(key.last_used_at).toLocaleString()}
              </td>
              <td className="p-3 text-right">
                {key.revoked_at !== null ? (
                  <span className="text-slate-400">{t('keys.revoked')}</span>
                ) : (
                  <button
                    className="text-red-600 hover:underline"
                    onClick={() => void revoke(key.key_id)}
                  >
                    {t('keys.revoke')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  )
}
