import { notFound } from 'next/navigation'
import { isLocale, LOCALES, t } from '../../../lib/messages'
import { PageShell } from '../../../lib/page-shell'
import { PilotForm } from '../../../lib/pilot-form'

export const dynamic = 'force-static'
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  return (
    <PageShell locale={locale}>
      <h1 className="mb-2 pt-4 text-2xl font-bold">{t(locale, 'contact.title')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t(locale, 'contact.intro')}</p>
      <div className="max-w-md">
        <PilotForm locale={locale} source="landing_contact" />
      </div>
    </PageShell>
  )
}
