import type { MetadataRoute } from 'next'
import { LOCALES } from '../lib/messages'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tozalist.uz'

export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALES.map((locale) => ({
    url: `${SITE_URL}/${locale}`,
    changeFrequency: 'weekly',
    priority: locale === 'uz' ? 1 : 0.8,
  }))
}
