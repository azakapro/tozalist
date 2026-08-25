import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LocaleSwitcher } from '../../lib/locale-switcher'
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  t,
  type Locale,
  type MessageKey,
} from '../../lib/messages'
import { PilotForm } from '../../lib/pilot-form'

export const dynamic = 'force-static'

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tozalist.uz'

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  if (!isLocale(params.locale)) return {}
  const locale = params.locale
  return {
    title: `${t(locale, 'site.name')} — ${t(locale, 'site.tagline')}`,
    description: t(locale, 'hero.subtitle'),
    alternates: {
      canonical: `${SITE_URL}/${locale}`,
      languages: Object.fromEntries([
        ...LOCALES.map((entry) => [entry, `${SITE_URL}/${entry}`]),
        ['x-default', `${SITE_URL}/${DEFAULT_LOCALE}`],
      ]),
    },
    openGraph: {
      title: `${t(locale, 'site.name')} — ${t(locale, 'site.tagline')}`,
      description: t(locale, 'hero.subtitle'),
      url: `${SITE_URL}/${locale}`,
      siteName: t(locale, 'site.name'),
      locale,
      type: 'website',
    },
  }
}

export default function LandingPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const locale: Locale = params.locale
  const m = (key: MessageKey) => t(locale, key)

  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TozaList',
    url: SITE_URL,
    description: m('hero.subtitle'),
    address: { '@type': 'PostalAddress', addressLocality: 'Tashkent', addressCountry: 'UZ' },
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />

      <header className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-4">
        <span className="text-lg font-bold">{m('site.name')}</span>
        <nav className="hidden gap-4 text-sm text-slate-600 sm:flex">
          <a href="#how" className="hover:text-slate-900">
            {m('nav.how')}
          </a>
          <a href="#pricing" className="hover:text-slate-900">
            {m('nav.pricing')}
          </a>
          <a href="#faq" className="hover:text-slate-900">
            {m('nav.faq')}
          </a>
        </nav>
        <div className="ml-auto">
          <LocaleSwitcher current={locale} />
        </div>
      </header>

      {/* 1 — Hero */}
      <section className="mx-auto max-w-5xl px-4 py-14 text-center sm:py-20">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
          {m('hero.title')}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-600 sm:text-lg">{m('hero.subtitle')}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href="#pilot"
            className="rounded-lg bg-slate-900 px-6 py-3 font-medium text-white hover:bg-slate-700"
          >
            {m('hero.cta.primary')}
          </a>
          <a
            href="#how"
            className="rounded-lg border border-slate-300 px-6 py-3 font-medium hover:border-slate-500"
          >
            {m('hero.cta.secondary')}
          </a>
        </div>
      </section>

      {/* 2 — Problem */}
      <section className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold">{m('problem.title')}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {(['1', '2', '3'] as const).map((n) => (
              <div key={n} className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="font-semibold">{m(`problem.${n}.title` as MessageKey)}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {m(`problem.${n}.text` as MessageKey)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 — How it works */}
      <section id="how" className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold">{m('how.title')}</h2>
        <ol className="mx-auto mt-8 max-w-2xl space-y-4">
          {(['1', '2', '3', '4'] as const).map((n) => (
            <li key={n} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                {n}
              </span>
              <p className="text-slate-700">{m(`how.${n}` as MessageKey)}</p>
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-10 max-w-2xl rounded-lg border border-slate-200 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-500">{m('how.sample.title')}</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="rounded bg-green-100 px-2 py-0.5 text-green-800">
                {m('how.badge.valid')}
              </span>
              <span className="text-slate-600">{m('how.sample.valid')}</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">
                {m('how.badge.risky')}
              </span>
              <span className="text-slate-600">{m('how.sample.risky')}</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">
                {m('how.badge.unknown')}
              </span>
              <span className="text-slate-600">{m('how.sample.unknown')}</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">
                {m('how.badge.invalid')}
              </span>
              <span className="text-slate-600">{m('how.sample.invalid')}</span>
            </li>
          </ul>
          <p className="mt-3 text-sm text-slate-500">{m('how.unknown.note')}</p>
        </div>
      </section>

      {/* 4 — What we do NOT do */}
      <section className="border-t border-slate-100 bg-slate-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold">{m('notdo.title')}</h2>
          <p className="mt-2 text-center text-slate-300">{m('notdo.intro')}</p>
          <ul className="mx-auto mt-8 max-w-2xl space-y-3">
            {(['1', '2', '3', '4', '5'] as const).map((n) => (
              <li key={n} className="flex gap-3">
                <span aria-hidden className="font-bold text-slate-400">
                  ✕
                </span>
                <p>{m(`notdo.${n}` as MessageKey)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 5 — Pricing */}
      <section id="pricing" className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold">{m('pricing.title')}</h2>
        <p className="mt-2 text-center text-sm text-slate-500">{m('pricing.note')}</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {(['pilot', 'team', 'api'] as const).map((tier) => (
            <div key={tier} className="flex flex-col rounded-lg border border-slate-200 p-6">
              <h3 className="font-semibold">{m(`pricing.${tier}.name` as MessageKey)}</h3>
              <p className="mt-2 text-2xl font-bold">{m(`pricing.${tier}.price` as MessageKey)}</p>
              <p className="text-sm text-slate-500">{m(`pricing.${tier}.volume` as MessageKey)}</p>
              <a
                href="#pilot"
                className="mt-6 rounded border border-slate-900 px-4 py-2 text-center text-sm font-medium hover:bg-slate-900 hover:text-white"
              >
                {m('pricing.cta')}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* 6 — Data handling */}
      <section className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center">
          <h2 className="text-2xl font-bold">{m('data.title')}</h2>
          <ul className="mt-6 space-y-2 text-slate-700">
            {(['1', '2', '3', '4'] as const).map((n) => (
              <li key={n}>{m(`data.${n}` as MessageKey)}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* 7 — Pilot request form */}
      <section id="pilot" className="mx-auto max-w-xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold">{m('form.title')}</h2>
        <div className="mt-6">
          <PilotForm locale={locale} />
        </div>
      </section>

      {/* 8 — FAQ */}
      <section id="faq" className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold">{m('faq.title')}</h2>
          <div className="mt-8 space-y-3">
            {(['1', '2', '3', '4', '5', '6', '7', '8'] as const).map((n) => (
              <details key={n} className="rounded-lg border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer font-medium">
                  {m(`faq.${n}.q` as MessageKey)}
                </summary>
                <p className="mt-2 text-sm text-slate-600">{m(`faq.${n}.a` as MessageKey)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 9 — Footer */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-8 text-sm text-slate-500">
          <span>
            © {new Date().getFullYear()} {m('site.name')}
          </span>
          <Link href={`/${locale}/privacy`} className="hover:text-slate-900">
            {m('footer.privacy')}
          </Link>
          <Link href={`/${locale}/terms`} className="hover:text-slate-900">
            {m('footer.terms')}
          </Link>
          <Link href={`/${locale}/docs`} className="hover:text-slate-900">
            {m('footer.docs')}
          </Link>
          <a href="mailto:salom@tozalist.uz" className="hover:text-slate-900">
            {m('footer.contact')}
          </a>
          <span className="ml-auto">{m('footer.note')}</span>
        </div>
      </footer>
    </div>
  )
}
