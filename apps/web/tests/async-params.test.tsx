import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCALES } from '../lib/messages'

// notFound() throws in Next; assert pages invoke it for an unknown locale
// rather than rendering. (Non-generic mock: generics clash with JSX in .tsx.)
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

// MDX-free pages so the test needs no MDX toolchain.
import DocsIndex from '../app/[locale]/docs/page'
import GlossaryPage from '../app/[locale]/docs/glossary/page'

afterEach(cleanup)

/**
 * Next 16 App Router migration (Step 8.3): route `params` is now an async
 * Promise, and the locale pages are async Server Components. These pin that
 * they resolve params, render localized content, and still guard unknown
 * locales via notFound().
 */
describe('async route params (Next 16)', () => {
  it('resolves Promise params and renders each localized page', async () => {
    for (const locale of LOCALES) {
      const docsUi = await DocsIndex({ params: Promise.resolve({ locale }) })
      const { container } = render(docsUi)
      expect(container.textContent, `${locale} docs index`).toContain('Developer documentation')
      // The links carry the resolved locale.
      expect(container.querySelector(`a[href="/${locale}/docs/quickstart"]`), locale).not.toBeNull()
      cleanup()

      const glossaryUi = await GlossaryPage({ params: Promise.resolve({ locale }) })
      const { container: glossaryContainer } = render(glossaryUi)
      expect(glossaryContainer.textContent, `${locale} glossary`).toContain('Reason codes')
      cleanup()
    }
  })

  it('guards an unknown locale with notFound() from resolved params', async () => {
    await expect(DocsIndex({ params: Promise.resolve({ locale: 'de' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
    await expect(GlossaryPage({ params: Promise.resolve({ locale: 'zz' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  })
})
