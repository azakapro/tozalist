import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale, LOCALES } from '../../../lib/messages'
import { PageShell } from '../../../lib/page-shell'

export const dynamic = 'force-static'
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

const SECTIONS = [
  { href: 'quickstart', title: 'Quickstart', text: 'Key → first check → first batch, with curl.' },
  {
    href: 'reference',
    title: 'API reference',
    text: 'Every endpoint, generated from the live OpenAPI document.',
  },
  {
    href: 'webhooks',
    title: 'Webhooks',
    text: 'Signed events, verification samples in Node.js and Python.',
  },
  {
    href: 'glossary',
    title: 'Reason codes',
    text: 'Every code, its meaning, and the recommended action.',
  },
  { href: 'limitations', title: 'Limitations', text: 'What the checks can and cannot tell you.' },
]

export default async function DocsIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  return (
    <PageShell locale={locale}>
      <h1 className="mb-6 pt-4 text-2xl font-bold">Developer documentation</h1>
      <div className="space-y-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={`/${locale}/docs/${section.href}`}
            className="block rounded-lg border border-slate-200 p-4 hover:border-slate-400"
          >
            <h2 className="font-semibold">{section.title}</h2>
            <p className="text-sm text-slate-600">{section.text}</p>
          </Link>
        ))}
      </div>
    </PageShell>
  )
}
