/**
 * Domain typo detection: pure, deterministic, and deliberately conservative.
 *
 * A suggestion is only ever a domain from {@link KNOWN_PROVIDER_DOMAINS}. This
 * module never invents a correction for an arbitrary company domain - a typo in
 * "acme-corp.com" is not ours to guess.
 */

/**
 * Known providers, ordered by how likely a typo is to mean them. The order is
 * the deterministic tie-breaker: when two candidates sit at the same edit
 * distance, the earlier entry wins.
 */
export const KNOWN_PROVIDER_DOMAINS = Object.freeze([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'mail.ru',
  'yandex.ru',
  'yandex.com',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'rambler.ru',
  'umail.uz',
  'exat.uz',
] as const)

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_PROVIDER_DOMAINS)

/** Explicit, frequently-seen misspellings. Checked before any distance math. */
const STATIC_TYPO_MAP: Readonly<Record<string, string>> = Object.freeze({
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'hotnail.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icoud.com': 'icloud.com',
  'protonmial.com': 'protonmail.com',
  'mail.rut': 'mail.ru',
  'meil.ru': 'mail.ru',
  'yandex.con': 'yandex.com',
  'yandx.ru': 'yandex.ru',
  'ramler.ru': 'rambler.ru',
  'umail.zu': 'umail.uz',
  'exat.zu': 'exat.uz',
})

/**
 * Real, distinct services that sit within edit distance of a known provider.
 * These are legitimate destinations, not typos, and must never be "corrected" -
 * mail.com is not a misspelling of mail.ru, and vk.ru is not bk.ru.
 */
const NEVER_CORRECT: ReadonlySet<string> = new Set([
  'mail.com',
  'vk.ru',
  'vk.com',
  'ok.ru',
  'bk.com',
  'inbox.lv',
  'protonmail.ch',
  'yandex.net',
  'yandex.kz',
  'yandex.by',
])

/**
 * Common last-label mistakes, applied only when the repaired domain is itself a
 * known provider. ".co" is deliberately absent: it is a real TLD, and the
 * frequent "gmail.co" case is handled by the static map instead.
 */
const TLD_TYPO_MAP: Readonly<Record<string, string>> = Object.freeze({
  cmo: 'com',
  con: 'com',
  ocm: 'com',
  comm: 'com',
  vom: 'com',
  xom: 'com',
  rut: 'ru',
  ruu: 'ru',
  zu: 'uz',
  uzz: 'uz',
})

/**
 * Suggests the provider domain the input was probably meant to be, or null.
 *
 * Order of attack: exact known domain (null - nothing to fix), explicit typo
 * map, TLD repair, then bounded Levenshtein distance against the provider list.
 * Distance is capped at 2, tightened to 1 for short domains where two edits
 * could rewrite half the string.
 */
export function detectTypo(domain: string): string | null {
  const normalized = normalizeDomain(domain)
  if (normalized === '') return null

  if (KNOWN_SET.has(normalized)) return null
  if (NEVER_CORRECT.has(normalized)) return null

  const mapped = STATIC_TYPO_MAP[normalized]
  if (mapped !== undefined) return mapped

  const tldRepaired = repairTld(normalized)
  if (tldRepaired !== null) return tldRepaired

  return closestKnownDomain(normalized)
}

function normalizeDomain(domain: string): string {
  let value = domain.trim().toLowerCase()
  // A trailing dot is valid FQDN syntax, not part of the name being compared.
  if (value.endsWith('.')) value = value.slice(0, -1)
  return value
}

function repairTld(domain: string): string | null {
  const lastDot = domain.lastIndexOf('.')
  if (lastDot <= 0) return null

  const name = domain.slice(0, lastDot)
  const tld = domain.slice(lastDot + 1)
  const fixedTld = TLD_TYPO_MAP[tld]
  if (fixedTld === undefined) return null

  const candidate = `${name}.${fixedTld}`
  return KNOWN_SET.has(candidate) ? candidate : null
}

function closestKnownDomain(domain: string): string | null {
  const maxDistance = domain.length < 6 ? 1 : 2

  let best: string | null = null
  let bestDistance = maxDistance + 1

  for (const known of KNOWN_PROVIDER_DOMAINS) {
    const distance = levenshtein(domain, known, maxDistance)
    // Strict less-than keeps the earliest list entry on ties.
    if (distance < bestDistance) {
      bestDistance = distance
      best = known
    }
  }

  return bestDistance <= maxDistance ? best : null
}

/**
 * Levenshtein distance with an early cut-off: once every value in a row
 * exceeds `limit`, the true distance cannot come back under it.
 */
export function levenshtein(a: string, b: string, limit: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i]
    let rowMin = i

    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const insertion = (current[j - 1] ?? 0) + 1
      const deletion = (previous[j] ?? 0) + 1
      const value = Math.min(substitution, insertion, deletion)
      current.push(value)
      if (value < rowMin) rowMin = value
    }

    if (rowMin > limit) return limit + 1
    previous = current
  }

  return previous[b.length] ?? limit + 1
}
