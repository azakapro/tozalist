import { notFound } from 'next/navigation'
import { buildGlossary } from '../../../../lib/glossary'
import { isLocale, LOCALES } from '../../../../lib/messages'
import { PageShell } from '../../../../lib/page-shell'

export const dynamic = 'force-static'
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export default function GlossaryPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const entries = buildGlossary()
  return (
    <PageShell locale={params.locale}>
      <h1 className="mb-2 pt-4 text-2xl font-bold">Reason codes</h1>
      <p className="mb-6 text-sm text-slate-600">
        Generated directly from the product&apos;s reason-code registry — this page cannot drift
        from what the API returns.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left">Code</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left">Meaning</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left">
                Recommended action
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.code}>
                <td className="border border-slate-200 px-3 py-2 font-mono text-xs">
                  {entry.code}
                </td>
                <td className="border border-slate-200 px-3 py-2">{entry.meaning}</td>
                <td className="border border-slate-200 px-3 py-2">{entry.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
