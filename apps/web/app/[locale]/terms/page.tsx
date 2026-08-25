import { notFound } from 'next/navigation'
import Content from '../../../content/terms.mdx'
import { DraftBanner } from '../../../lib/draft-banner'
import { isLocale, LOCALES } from '../../../lib/messages'
import { PageShell } from '../../../lib/page-shell'

export const dynamic = 'force-static'
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export default function TermsPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  return (
    <PageShell locale={params.locale}>
      <div className="pt-4">
        <DraftBanner />
        <Content />
      </div>
    </PageShell>
  )
}
