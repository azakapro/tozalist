import Link from 'next/link'
import { LOCALES, type Locale } from './messages'

const LABELS: Record<Locale, string> = { uz: "O'zbekcha", ru: 'Русский', en: 'English' }

export function LocaleSwitcher({ current }: { current: Locale }) {
  return (
    <nav aria-label="Language" data-testid="locale-switcher" className="flex gap-2 text-sm">
      {LOCALES.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}`}
          hrefLang={locale}
          className={
            locale === current
              ? 'font-semibold text-slate-900 underline'
              : 'text-slate-500 hover:text-slate-900'
          }
        >
          {LABELS[locale]}
        </Link>
      ))}
    </nav>
  )
}
