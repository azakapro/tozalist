import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleSwitcher } from '../lib/locale-switcher'
import { DEFAULT_LOCALE, LOCALES, MESSAGES_BY_LOCALE, t, type MessageKey } from '../lib/messages'

afterEach(cleanup)

describe('locales', () => {
  it('uz is the default and all three locales exist', () => {
    expect(DEFAULT_LOCALE).toBe('uz')
    expect(LOCALES).toEqual(['uz', 'ru', 'en'])
  })

  it('uz and ru are complete translations, not placeholders', () => {
    const keys = Object.keys(MESSAGES_BY_LOCALE.en) as MessageKey[]
    for (const locale of ['uz', 'ru'] as const) {
      for (const key of keys) {
        const value = MESSAGES_BY_LOCALE[locale][key]
        expect(value, `${locale}:${key}`).toBeTruthy()
      }
    }
    // Spot-check the copy is genuinely localized, not copied English.
    expect(t('uz', 'hero.title')).not.toBe(t('en', 'hero.title'))
    expect(t('ru', 'hero.title')).not.toBe(t('en', 'hero.title'))
    expect(t('uz', 'hero.title')).toContain('tozalang')
    expect(t('ru', 'hero.title')).toContain('Очистите')
  })

  it('unknown-verdict guidance says keep in every locale', () => {
    expect(t('en', 'how.sample.unknown')).toContain('keep this')
    expect(t('uz', 'how.sample.unknown')).toContain('saqlab qoling')
    expect(t('ru', 'how.sample.unknown')).toContain('оставьте')
  })

  it('the four sample verdict badges are localized, not hard-coded English', () => {
    expect(t('uz', 'how.badge.valid')).toBe('yaroqli')
    expect(t('uz', 'how.badge.risky')).toBe('xavfli')
    expect(t('uz', 'how.badge.unknown')).toBe("noma'lum")
    expect(t('uz', 'how.badge.invalid')).toBe('yaroqsiz')
    expect(t('ru', 'how.badge.valid')).toBe('рабочий')
    expect(t('ru', 'how.badge.risky')).toBe('рискованный')
    expect(t('ru', 'how.badge.unknown')).toBe('неизвестно')
    expect(t('ru', 'how.badge.invalid')).toBe('нерабочий')
    for (const badge of ['valid', 'risky', 'unknown', 'invalid'] as const) {
      expect(t('en', `how.badge.${badge}`)).toBe(badge)
      expect(t('uz', `how.badge.${badge}`)).not.toBe(t('en', `how.badge.${badge}`))
      expect(t('ru', `how.badge.${badge}`)).not.toBe(t('en', `how.badge.${badge}`))
    }
  })

  it('the switcher links every locale and marks the current one', () => {
    render(<LocaleSwitcher current="ru" />)
    const nav = screen.getByTestId('locale-switcher')
    const links = Array.from(nav.querySelectorAll('a'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/uz', '/ru', '/en'])
    const current = links.find((link) => link.getAttribute('href') === '/ru')
    expect(current?.className).toContain('font-semibold')
  })
})
