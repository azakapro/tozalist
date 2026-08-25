'use client'

import { useState } from 'react'
import QRCode from 'qrcode'
import { api, setCsrfToken } from './api'
import { t } from './messages'

/** Shared MFA enrollment + challenge UI used by login and signup flows. */

type Enrollment = { otpauth_uri: string; secret: string; recovery_codes: string[] }

export function MfaEnroll({ onDone }: { onDone: () => void }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [qr, setQr] = useState<string>('')
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function begin() {
    const data = await api.post<Enrollment>('/internal/mfa/enroll')
    setEnrollment(data)
    setQr(await QRCode.toDataURL(data.otpauth_uri))
  }

  async function verify() {
    try {
      await api.post('/internal/mfa/verify', { code })
      onDone()
    } catch {
      setError(t('mfa.challenge.failed'))
    }
  }

  if (enrollment === null) {
    void begin()
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('mfa.setup.title')}</h2>
      <p className="text-sm text-slate-600">{t('mfa.setup.intro')}</p>
      {qr !== '' && <img src={qr} alt="TOTP QR code" className="h-40 w-40" />}
      <p className="text-xs text-slate-500">
        {t('mfa.setup.manual')} <code className="font-mono">{enrollment.secret}</code>
      </p>
      <div className="rounded border border-amber-300 bg-amber-50 p-3">
        <h3 className="text-sm font-semibold">{t('mfa.recovery.title')}</h3>
        <p className="mt-1 text-xs text-amber-800">{t('mfa.recovery.warning')}</p>
        <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
          {enrollment.recovery_codes.map((recovery) => (
            <li key={recovery}>{recovery}</li>
          ))}
        </ul>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
          />
          {t('mfa.recovery.confirm')}
        </label>
      </div>
      <MfaCodeInput
        code={code}
        setCode={setCode}
        onSubmit={verify}
        disabled={!saved}
        error={error}
      />
    </div>
  )
}

export function MfaChallenge({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function verify() {
    try {
      await api.post('/internal/mfa/verify', { code })
      onDone()
    } catch {
      setError(t('mfa.challenge.failed'))
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t('mfa.challenge.title')}</h2>
      <p className="text-sm text-slate-600">{t('mfa.challenge.hint')}</p>
      <MfaCodeInput
        code={code}
        setCode={setCode}
        onSubmit={verify}
        disabled={false}
        error={error}
      />
    </div>
  )
}

function MfaCodeInput(props: {
  code: string
  setCode: (value: string) => void
  onSubmit: () => void
  disabled: boolean
  error: string
}) {
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <input
        className="w-full rounded border border-slate-300 px-3 py-2 font-mono"
        value={props.code}
        onChange={(event) => props.setCode(event.target.value)}
        placeholder="123456"
        autoComplete="one-time-code"
      />
      {props.error !== '' && <p className="text-sm text-red-600">{props.error}</p>}
      <button
        type="submit"
        disabled={props.disabled}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {t('mfa.challenge.submit')}
      </button>
    </form>
  )
}

export function useAuthActions() {
  return { setCsrfToken }
}
