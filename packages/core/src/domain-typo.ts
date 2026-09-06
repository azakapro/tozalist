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
  // --- The original core list stays first and in order: it is the tie-breaker.
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
  // --- Global consumer providers.
  'googlemail.com',
  'live.com',
  'msn.com',
  'me.com',
  'mac.com',
  'aol.com',
  'pm.me',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'gmx.at',
  'gmx.ch',
  'web.de',
  'zoho.com',
  'zohomail.com',
  'fastmail.com',
  'fastmail.fm',
  'tutanota.com',
  'tuta.com',
  'tuta.io',
  'hey.com',
  'hushmail.com',
  'mailfence.com',
  'posteo.de',
  'ymail.com',
  'rocketmail.com',
  // --- Microsoft and Yahoo regional variants (widely used ones only).
  'outlook.de',
  'outlook.fr',
  'outlook.es',
  'outlook.it',
  'outlook.jp',
  'outlook.kr',
  'outlook.in',
  'outlook.ie',
  'outlook.be',
  'outlook.at',
  'outlook.dk',
  'outlook.pt',
  'outlook.cz',
  'outlook.hu',
  'outlook.sa',
  'outlook.com.br',
  'outlook.com.au',
  'outlook.com.tr',
  'outlook.com.ar',
  'outlook.co.id',
  'outlook.co.il',
  'outlook.co.nz',
  'outlook.co.th',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'hotmail.nl',
  'hotmail.be',
  'hotmail.ca',
  'hotmail.se',
  'hotmail.dk',
  'hotmail.no',
  'hotmail.fi',
  'hotmail.ch',
  'hotmail.gr',
  'hotmail.pt',
  'hotmail.cz',
  'hotmail.hu',
  'hotmail.sk',
  'hotmail.ie',
  'hotmail.sg',
  'hotmail.my',
  'hotmail.ph',
  'hotmail.cl',
  'hotmail.com.br',
  'hotmail.com.ar',
  'hotmail.com.au',
  'hotmail.com.mx',
  'hotmail.com.tr',
  'hotmail.com.hk',
  'hotmail.com.tw',
  'hotmail.co.jp',
  'hotmail.co.nz',
  'hotmail.co.th',
  'hotmail.co.il',
  'hotmail.co.za',
  'hotmail.co.kr',
  'live.co.uk',
  'live.fr',
  'live.de',
  'live.it',
  'live.nl',
  'live.be',
  'live.se',
  'live.dk',
  'live.no',
  'live.fi',
  'live.ca',
  'live.ie',
  'live.at',
  'live.ch',
  'live.jp',
  'live.cl',
  'live.in',
  'live.ru',
  'live.com.au',
  'live.com.mx',
  'live.com.ar',
  'live.com.pt',
  'live.com.sg',
  'live.com.my',
  'live.co.za',
  'live.co.kr',
  'yahoo.co.uk',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.it',
  'yahoo.es',
  'yahoo.ca',
  'yahoo.ie',
  'yahoo.se',
  'yahoo.dk',
  'yahoo.no',
  'yahoo.fi',
  'yahoo.nl',
  'yahoo.be',
  'yahoo.gr',
  'yahoo.pl',
  'yahoo.ro',
  'yahoo.cz',
  'yahoo.hu',
  'yahoo.pt',
  'yahoo.ae',
  'yahoo.cn',
  'yahoo.in',
  'yahoo.cl',
  'yahoo.com.br',
  'yahoo.com.ar',
  'yahoo.com.mx',
  'yahoo.com.au',
  'yahoo.com.sg',
  'yahoo.com.my',
  'yahoo.com.ph',
  'yahoo.com.vn',
  'yahoo.com.hk',
  'yahoo.com.tw',
  'yahoo.com.tr',
  'yahoo.com.cn',
  'yahoo.com.pe',
  'yahoo.com.co',
  'yahoo.com.ve',
  'yahoo.co.jp',
  'yahoo.co.in',
  'yahoo.co.id',
  'yahoo.co.kr',
  'yahoo.co.nz',
  'yahoo.co.za',
  'yahoo.co.th',
  'yahoo.co.il',
  // --- Europe.
  't-online.de',
  'freenet.de',
  'arcor.de',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
  'sfr.fr',
  'bbox.fr',
  'neuf.fr',
  'libero.it',
  'virgilio.it',
  'tiscali.it',
  'alice.it',
  'tin.it',
  'fastwebnet.it',
  'seznam.cz',
  'centrum.cz',
  'email.cz',
  'post.cz',
  'volny.cz',
  'wp.pl',
  'o2.pl',
  'onet.pl',
  'onet.eu',
  'interia.pl',
  'op.pl',
  'vp.pl',
  'tlen.pl',
  'gazeta.pl',
  'poczta.fm',
  'azet.sk',
  'centrum.sk',
  'zoznam.sk',
  'freemail.hu',
  'citromail.hu',
  'indamail.hu',
  'abv.bg',
  'mail.bg',
  'dir.bg',
  'telenet.be',
  'skynet.be',
  'ziggo.nl',
  'kpnmail.nl',
  'planet.nl',
  'home.nl',
  'xs4all.nl',
  'telia.com',
  'telia.se',
  'comhem.se',
  'online.no',
  'bluewin.ch',
  'sunrise.ch',
  'a1.net',
  'chello.at',
  'aon.at',
  'sapo.pt',
  'terra.com',
  'terra.es',
  'telefonica.net',
  'btinternet.com',
  'btopenworld.com',
  'sky.com',
  'virginmedia.com',
  'blueyonder.co.uk',
  'ntlworld.com',
  'talktalk.net',
  'tiscali.co.uk',
  'eircom.net',
  'mail.ee',
  'hot.ee',
  'inbox.lv',
  'apollo.lv',
  'inbox.lt',
  // --- North America, Australia, New Zealand.
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'optonline.net',
  'roadrunner.com',
  'rr.com',
  'frontier.com',
  'windstream.net',
  'centurylink.net',
  'juno.com',
  'netzero.net',
  'shaw.ca',
  'rogers.com',
  'sympatico.ca',
  'bell.net',
  'telus.net',
  'videotron.ca',
  'bigpond.com',
  'bigpond.net.au',
  'optusnet.com.au',
  'iinet.net.au',
  'tpg.com.au',
  'xtra.co.nz',
  // --- Asia and Latin America.
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'sina.cn',
  'sohu.com',
  'foxmail.com',
  'aliyun.com',
  'yeah.net',
  '139.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  'kakao.com',
  'rediffmail.com',
  'sify.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  // --- CIS and Uzbekistan.
  'internet.ru',
  'ya.ru',
  'yandex.kz',
  'yandex.by',
  'yandex.ua',
  'narod.ru',
  'lenta.ru',
  'autorambler.ru',
  'myrambler.ru',
  'ro.ru',
  'r0.ru',
  'ukr.net',
  'i.ua',
  'ua.fm',
  'meta.ua',
  'bigmir.net',
  'email.ua',
  'tut.by',
  'mail.kz',
  'sarkor.uz',
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
  'vk.ru',
  'vk.com',
  'ok.ru',
  'bk.com',
  'protonmail.ch',
  'yandex.net',
  'outlook.office.com',
  'office365.com',
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
 * Distance matching only applies from 8 characters (one edit) and allows two
 * edits from 10: shorter names (aol.com, qq.com, gm.com, ibm.com, sony.com)
 * sit one or two edits from each other and from real companies, so for them
 * only the explicit maps may speak. A company's domain is never guessed to be
 * a typo.
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

const MIN_LENGTH_FOR_DISTANCE_MATCH = 8
const MIN_LENGTH_FOR_TWO_EDITS = 10

function closestKnownDomain(domain: string): string | null {
  if (domain.length < MIN_LENGTH_FOR_DISTANCE_MATCH) return null
  // Two edits rewrite a quarter of an 8-character domain: tesla.com would
  // become telia.com and sony.com sky.com. One edit there; two from 10 up.
  const maxDistance = domain.length < MIN_LENGTH_FOR_TWO_EDITS ? 1 : 2

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
