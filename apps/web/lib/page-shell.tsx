import Link from 'next/link'
import type { ReactNode } from 'react'
import { LocaleSwitcher } from './locale-switcher'
import { t, type Locale } from './messages'

/** Simple header/footer wrapper for docs and legal pages. */
export function PageShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-4 py-4">
        <Link href={`/${locale}`} className="text-lg font-bold">
          {t(locale, 'site.name')}
        </Link>
        <div className="ml-auto">
          <LocaleSwitcher current={locale} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">{children}</main>
      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-4 px-4 py-6 text-sm text-slate-500">
          <Link href={`/${locale}/privacy`}>{t(locale, 'footer.privacy')}</Link>
          <Link href={`/${locale}/terms`}>{t(locale, 'footer.terms')}</Link>
          <Link href={`/${locale}/docs`}>{t(locale, 'footer.docs')}</Link>
          <Link href={`/${locale}/contact`}>{t(locale, 'footer.contact')}</Link>
        </div>
      </footer>
    </div>
  )
}
