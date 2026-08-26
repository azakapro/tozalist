import { notFound } from 'next/navigation'
import Content from '../../../../content/quickstart.mdx'
import { isLocale, LOCALES } from '../../../../lib/messages'
import { PageShell } from '../../../../lib/page-shell'

export const dynamic = 'force-static'
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export default async function QuickstartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  return (
    <PageShell locale={locale}>
      <div className="pt-4">
        <Content />
      </div>
    </PageShell>
  )
}
