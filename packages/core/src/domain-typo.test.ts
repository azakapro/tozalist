import { describe, expect, it } from 'vitest'
import { detectTypo, KNOWN_PROVIDER_DOMAINS, levenshtein } from './domain-typo.js'

describe('detectTypo', () => {
  describe('global providers', () => {
    it.each([
      ['gmai.com', 'gmail.com'],
      ['gmial.com', 'gmail.com'],
      ['gmal.com', 'gmail.com'],
      ['gamil.com', 'gmail.com'],
      ['gmail.co', 'gmail.com'],
      ['yaho.com', 'yahoo.com'],
      ['yahooo.com', 'yahoo.com'],
      ['hotnail.com', 'hotmail.com'],
      ['hotmial.com', 'hotmail.com'],
      ['outlok.com', 'outlook.com'],
      ['outloook.com', 'outlook.com'],
      ['iclod.com', 'icloud.com'],
      ['icoud.com', 'icloud.com'],
      ['protonmial.com', 'protonmail.com'],
    ])('%s → %s', (input, expected) => {
      expect(detectTypo(input)).toBe(expected)
    })

    it('catches distance-based misses not in the static map', () => {
      expect(detectTypo('gmaill.com')).toBe('gmail.com')
      expect(detectTypo('hotmaill.com')).toBe('hotmail.com')
      expect(detectTypo('outlool.com')).toBe('outlook.com')
    })
  })

  describe('CIS and Uzbek providers', () => {
    it.each([
      ['mail.rut', 'mail.ru'],
      ['meil.ru', 'mail.ru'],
      ['yandex.con', 'yandex.com'],
      ['yandx.ru', 'yandex.ru'],
      ['ramler.ru', 'rambler.ru'],
      ['rambler.rut', 'rambler.ru'],
      ['umail.zu', 'umail.uz'],
      ['umaill.uz', 'umail.uz'],
      ['exat.zu', 'exat.uz'],
      ['inbox.rut', 'inbox.ru'],
    ])('%s → %s', (input, expected) => {
      expect(detectTypo(input)).toBe(expected)
    })
  })

  describe('TLD mistakes', () => {
    it.each([
      ['gmail.cmo', 'gmail.com'],
      ['gmail.con', 'gmail.com'],
      ['gmail.ocm', 'gmail.com'],
      ['yahoo.cmo', 'yahoo.com'],
      ['hotmail.con', 'hotmail.com'],
      ['outlook.vom', 'outlook.com'],
      ['icloud.xom', 'icloud.com'],
      ['yandex.ruu', 'yandex.ru'],
      ['list.rut', 'list.ru'],
      ['bk.rut', 'bk.ru'],
      ['umail.uzz', 'umail.uz'],
      ['exat.uzz', 'exat.uz'],
    ])('%s → %s', (input, expected) => {
      expect(detectTypo(input)).toBe(expected)
    })

    it('does not repair a TLD into a domain that is not a known provider', () => {
      expect(detectTypo('acme-corp.cmo')).toBeNull()
      expect(detectTypo('mycompany.con')).toBeNull()
    })
  })

  describe('exact known domains', () => {
    it.each([...KNOWN_PROVIDER_DOMAINS])('returns null for %s', (domain) => {
      expect(detectTypo(domain)).toBeNull()
    })

    it('recognises a known domain regardless of case and outer whitespace', () => {
      expect(detectTypo('  GMAIL.COM  ')).toBeNull()
      expect(detectTypo('Yandex.Ru')).toBeNull()
    })

    it('ignores a trailing FQDN dot', () => {
      expect(detectTypo('gmail.com.')).toBeNull()
      expect(detectTypo('gmai.com.')).toBe('gmail.com')
    })
  })

  describe('unrelated domains', () => {
    it.each([
      'acme-corp.com',
      'tozalist.uz',
      'example.com',
      'university.edu',
      'government.gov.uz',
      'somestartup.io',
      'mydomain.dev',
    ])('never invents a correction for %s', (domain) => {
      expect(detectTypo(domain)).toBeNull()
    })

    it('returns null for empty and junk input', () => {
      expect(detectTypo('')).toBeNull()
      expect(detectTypo('   ')).toBeNull()
      expect(detectTypo('nodots')).toBeNull()
    })

    it('never corrects real services that sit close to a known provider', () => {
      expect(detectTypo('vk.ru')).toBeNull()
      expect(detectTypo('ok.ru')).toBeNull()
      expect(detectTypo('mail.com')).toBeNull()
      expect(detectTypo('protonmail.ch')).toBeNull()
      expect(detectTypo('inbox.lv')).toBeNull()
      expect(detectTypo('yandex.kz')).toBeNull()
    })

    it('is stricter with short domains where two edits rewrite too much', () => {
      // xy.ru is nothing in particular; at length 5 only one edit is allowed,
      // so it must not be pulled two edits over to bk.ru.
      expect(detectTypo('xy.ru')).toBeNull()
      expect(detectTypo('kb.ru')).toBeNull()
    })
  })

  describe('determinism', () => {
    it('always returns the same suggestion for the same input', () => {
      const first = detectTypo('gmall.com')
      for (let i = 0; i < 5; i++) {
        expect(detectTypo('gmall.com')).toBe(first)
      }
    })

    it('breaks ties by provider-list order', () => {
      // yandex.cmu is distance 2 from both yandex.ru and yandex.com - a true
      // tie - so the earlier list entry (yandex.ru) must win, and keep winning.
      expect(detectTypo('yandex.cmu')).toBe('yandex.ru')
      // yandex.cm is NOT a tie: distance 1 to yandex.com beats 2 to yandex.ru.
      expect(detectTypo('yandex.cm')).toBe('yandex.com')
    })

    it('suggestions always come from the known provider list', () => {
      const inputs = ['gmall.com', 'yahok.com', 'inbox.ry', 'rambller.ru', 'umall.uz']
      for (const input of inputs) {
        const suggestion = detectTypo(input)
        if (suggestion !== null) {
          expect(KNOWN_PROVIDER_DOMAINS).toContain(suggestion)
        }
      }
    })
  })
})

describe('levenshtein', () => {
  it('computes classic distances', () => {
    expect(levenshtein('kitten', 'sitting', 5)).toBe(3)
    expect(levenshtein('gmail.com', 'gmail.com', 2)).toBe(0)
    expect(levenshtein('gmai.com', 'gmail.com', 2)).toBe(1)
  })

  it('cuts off above the limit instead of computing exactly', () => {
    expect(levenshtein('abcdefgh', 'zyxwvuts', 2)).toBe(3)
    expect(levenshtein('a', 'abcd', 2)).toBe(3)
  })
})
