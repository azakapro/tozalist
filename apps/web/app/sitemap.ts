import type { MetadataRoute } from 'next'
import { LOCALES } from '../lib/messages'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tozalist.uz'

// Every static page the site ships, per locale. '' is the landing page.
const PAGES = [
  '',
  '/contact',
  '/privacy',
  '/terms',
  '/prohibited-use',
  '/docs',
  '/docs/quickstart',
  '/docs/reference',
  '/docs/webhooks',
  '/docs/glossary',
  '/docs/limitations',
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALES.flatMap((locale) =>
    PAGES.map((page) => ({
      url: `${SITE_URL}/${locale}${page}`,
      changeFrequency: 'weekly' as const,
      priority: page === '' ? (locale === 'uz' ? 1 : 0.8) : 0.5,
    })),
  )
}
