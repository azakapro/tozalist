import type { EngineResponse, ReasonCode, Verdict } from '../src/index.js'

/**
 * Deterministic accuracy-regression corpus (roadmap 8.2).
 *
 * Each fixture pairs a synthetic, stubbed engine response with the verdict and
 * reason codes the local aggregation pipeline MUST produce. Labels are written
 * from the documented aggregation rules, independently of calling aggregate(),
 * so a behavioural regression in the pipeline breaks the gate.
 *
 * Everything here is pure data built from fixed inputs and indices - no
 * Date.now(), no Math.random(), and NEVER any DNS or network access. Reserved
 * `.invalid` / `.test` TLDs stand in for non-existent domains precisely so a
 * run can never touch real DNS.
 *
 * `operationalReason` is an optional field beyond the roadmap's core
 * `{ email, stubbedEngineResponse, expectedVerdict, expectedReasonCodes }`
 * shape: the two operational reason codes (SMTP_DISABLED, CIRCUIT_OPEN) are
 * worker conditions the aggregator takes as a separate input, not something an
 * engine response can express, so a handful of fixtures carry it to give those
 * codes real coverage.
 */
export type Fixture = {
  email: string
  category: string
  stubbedEngineResponse: EngineResponse
  operationalReason?: 'SMTP_DISABLED' | 'CIRCUIT_OPEN'
  expectedVerdict: Verdict
  expectedReasonCodes: ReasonCode[]
}

/** A clean, fully-probed success response for `local@domain`. */
function baseEngine(local: string, domain: string, freeProvider = false): EngineResponse {
  return {
    email: `${local}@${domain}`,
    syntax: { valid: true, username: local, domain },
    mx: { has_mx: true, records: [`mx1.${domain}.`], error: '' },
    disposable: false,
    role_account: false,
    free_provider: freeProvider,
    smtp: {
      attempted: true,
      mailbox_accepted: true,
      catch_all: false,
      full_inbox: false,
      disabled: false,
      error: '',
    },
    duration_ms: 3,
  }
}

const GLOBAL_PROVIDERS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
] as const
const CIS_UZ_PROVIDERS = [
  'mail.ru',
  'yandex.ru',
  'yandex.com',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'rambler.ru',
  'umail.uz',
  'exat.uz',
] as const
// Distinct corporate domains, deliberately far from every known provider so
// detectTypo never fires on them.
const CORPORATE_DOMAINS = [
  'acme-corporation.com',
  'tashkent-textiles.uz',
  'silkroad-logistics.uz',
  'northwind-traders.com',
  'globex-industries.com',
  'uzbek-cotton-export.uz',
  'initech-systems.com',
  'samarkand-ceramics.uz',
] as const
const LOCAL_PARTS = [
  'firstname.lastname',
  'a.contact',
  'sales.team',
  'j.doe',
  'operations',
  'hr.department',
  'billing.dept',
  'developer',
  'maria.karimova',
  'sardor.aliyev',
] as const

function pushValid(
  out: Fixture[],
  category: string,
  domains: readonly string[],
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const domain = domains[i % domains.length] as string
    const local = `${LOCAL_PARTS[i % LOCAL_PARTS.length]}${i}`
    out.push({
      email: `${local}@${domain}`,
      category,
      stubbedEngineResponse: baseEngine(local, domain, true),
      expectedVerdict: 'valid',
      expectedReasonCodes: [],
    })
  }
}

// Every syntax-failure class the engine reports as syntax.valid === false,
// including control-character cases (NUL, tab, newline) via unicode escapes.
const SYNTAX_BAD_SAMPLES = [
  'plainaddress',
  'missing-at-sign.com',
  '@no-local.com',
  'no-domain@',
  'two@@ats.com',
  'a@b@c.com',
  '.leadingdot@x.com',
  'trailingdot.@x.com',
  'double..dot@x.com',
  'has space@x.com',
  'tab\u0009tab@x.com',
  'comma,name@x.com',
  'semi;colon@x.com',
  'paren(name)@x.com',
  'bracket[name]@x.com',
  'quote"name@x.com',
  'back\\slash@x.com',
  'domain@no-tld',
  'domain@-leadinghyphen.com',
  'domain@trailinghyphen-.com',
  'domain@under_score.com',
  'domain@.leadingdot.com',
  'domain@double..dot.com',
  'nul\u0000byte@x.com',
  'newline\u000aname@x.com',
] as const

function pushSyntaxFailures(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const raw = SYNTAX_BAD_SAMPLES[i % SYNTAX_BAD_SAMPLES.length] as string
    const atIndex = raw.lastIndexOf('@')
    const username = atIndex >= 0 ? raw.slice(0, atIndex) : raw
    const domain = atIndex >= 0 ? raw.slice(atIndex + 1) : ''
    out.push({
      email: raw,
      category: 'syntax-failure',
      stubbedEngineResponse: {
        email: raw,
        syntax: { valid: false, username, domain },
        mx: { has_mx: null, records: [], error: '' },
        disposable: false,
        role_account: false,
        free_provider: false,
        smtp: null,
        duration_ms: 1,
      },
      expectedVerdict: 'invalid',
      expectedReasonCodes: ['SYNTAX_INVALID'],
    })
  }
}

const DISPOSABLE_DOMAINS = [
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'temp-mail-service.org',
  'throwaway-inbox.net',
  'trashmail-box.com',
  'yopmail-clone.net',
  'disposable-address.xyz',
] as const

function pushDisposable(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const domain = DISPOSABLE_DOMAINS[i % DISPOSABLE_DOMAINS.length] as string
    const local = `user${i}`
    const engine = baseEngine(local, domain)
    engine.disposable = true
    out.push({
      email: `${local}@${domain}`,
      category: 'disposable',
      stubbedEngineResponse: engine,
      expectedVerdict: 'risky',
      expectedReasonCodes: ['DISPOSABLE_DOMAIN'],
    })
  }
}

const ROLE_LOCALS = [
  'admin',
  'info',
  'support',
  'sales',
  'contact',
  'billing',
  'help',
  'noreply',
  'postmaster',
  'webmaster',
] as const

function pushRoleAccounts(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const local = ROLE_LOCALS[i % ROLE_LOCALS.length] as string
    const domain = CORPORATE_DOMAINS[i % CORPORATE_DOMAINS.length] as string
    const engine = baseEngine(local, domain)
    engine.role_account = true
    out.push({
      email: `${local}@${domain}`,
      category: 'role-account',
      stubbedEngineResponse: engine,
      expectedVerdict: 'risky',
      expectedReasonCodes: ['ROLE_ACCOUNT'],
    })
  }
}

// Non-existent domains: reserved .invalid / .test TLDs, lookup succeeded and
// found no MX. NEVER real DNS.
function pushNonexistent(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const tld = i % 2 === 0 ? 'invalid' : 'test'
    const domain = `nonexistent-domain-${i}.${tld}`
    const local = `user${i}`
    const engine = baseEngine(local, domain)
    engine.mx = { has_mx: false, records: [], error: '' }
    engine.smtp = null
    out.push({
      email: `${local}@${domain}`,
      category: 'nonexistent-domain',
      stubbedEngineResponse: engine,
      expectedVerdict: 'invalid',
      expectedReasonCodes: ['DOMAIN_NO_MX'],
    })
  }
}

// Domains that detectTypo() must correct to a known provider.
const TYPO_DOMAINS = [
  'gmai.com',
  'gmial.com',
  'gmal.com',
  'gamil.com',
  'gmail.co',
  'yaho.com',
  'yahooo.com',
  'hotnail.com',
  'hotmial.com',
  'outlok.com',
  'outloook.com',
  'iclod.com',
  'icoud.com',
  'protonmial.com',
  'meil.ru',
  'yandx.ru',
  'ramler.ru',
  'umail.zu',
  'exat.zu',
  'gmail.cmo',
  'gmail.con',
  'yahoo.con',
  'outlook.ocm',
  'hotmail.vom',
  'mail.rut',
  'yandex.ruu',
  'umail.uzz',
] as const

function pushTypos(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const domain = TYPO_DOMAINS[i % TYPO_DOMAINS.length] as string
    const local = `user${i}`
    // Domain has MX and a clean probe; only the typo signal degrades it.
    out.push({
      email: `${local}@${domain}`,
      category: 'typo',
      stubbedEngineResponse: baseEngine(local, domain),
      expectedVerdict: 'risky',
      expectedReasonCodes: ['POSSIBLE_TYPO'],
    })
  }
}

function pushUnicodeIdnLong(out: Fixture[], validCount: number, invalidCount: number): void {
  // Valid addresses in three flavours, all far from any provider so detectTypo
  // never fires, all with a clean stubbed probe -> valid:
  //  - genuine NON-ASCII unicode local parts and/or domains (Cyrillic, CJK,
  //    Latin-with-diacritics) - the roadmap's real Unicode coverage,
  //  - punycode/IDN (ASCII) domains,
  //  - very long ASCII local parts.
  // Reserved / example TLDs keep everything free of real DNS meaning.
  const validAddresses: Array<{ local: string; domain: string }> = [
    { local: 'почта', domain: 'пример.test' }, // Cyrillic local + Cyrillic domain
    { local: 'фойдаланувчи', domain: 'example.test' }, // Cyrillic (Uzbek) local
    { local: 'josé.muñoz', domain: 'correo.example' }, // Latin diacritics local
    { local: '用户', domain: '例子.test' }, // CJK local + CJK domain
    { local: 'σύνδεσμος', domain: 'παράδειγμα.invalid' }, // Greek local + domain
    { local: 'user', domain: 'xn--80akhbyknj4f.test' }, // punycode IDN (ASCII)
    { local: 'contact', domain: 'mail.xn--90a3ac.test' }, // punycode IDN (ASCII)
    { local: `long.${'a'.repeat(48)}`, domain: 'very-long-domain.example' }, // long local
  ]
  for (let i = 0; i < validCount; i += 1) {
    const { local: baseLocal, domain } = validAddresses[i % validAddresses.length] as {
      local: string
      domain: string
    }
    // Keep addresses distinct without disturbing the non-ASCII/length property.
    const local = `${baseLocal}.${i}`
    const engine = baseEngine(local, domain)
    out.push({
      email: `${local}@${domain}`,
      category: 'unicode-idn-long-valid',
      stubbedEngineResponse: engine,
      expectedVerdict: 'valid',
      expectedReasonCodes: [],
    })
  }
  // Over-long / malformed addresses the engine rejects as syntax-bad.
  for (let i = 0; i < invalidCount; i += 1) {
    const local = `${'x'.repeat(300)}${i}`
    const domain = `${'d'.repeat(260)}.invalid`
    out.push({
      email: `${local}@${domain}`,
      category: 'unicode-idn-long-invalid',
      stubbedEngineResponse: {
        email: `${local}@${domain}`,
        syntax: { valid: false, username: local, domain },
        mx: { has_mx: null, records: [], error: '' },
        disposable: false,
        role_account: false,
        free_provider: false,
        smtp: null,
        duration_ms: 1,
      },
      expectedVerdict: 'invalid',
      expectedReasonCodes: ['SYNTAX_INVALID'],
    })
  }
}

function pushCatchAll(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const domain = `catch-all-domain-${i}.com`
    const local = `user${i}`
    const engine = baseEngine(local, domain)
    engine.smtp = {
      attempted: true,
      mailbox_accepted: true,
      catch_all: true,
      full_inbox: false,
      disabled: false,
      error: '',
    }
    out.push({
      email: `${local}@${domain}`,
      category: 'catch-all',
      stubbedEngineResponse: engine,
      expectedVerdict: 'unknown',
      expectedReasonCodes: ['CATCH_ALL_DOMAIN'],
    })
  }
}

type SmtpCase = {
  tag: string
  mutate: (smtp: NonNullable<EngineResponse['smtp']>) => void
  verdict: Verdict
  reasons: ReasonCode[]
}
const SMTP_CASES: SmtpCase[] = [
  {
    tag: 'rejected',
    mutate: (s) => {
      s.mailbox_accepted = false
    },
    verdict: 'invalid',
    reasons: ['MAILBOX_REJECTED'],
  },
  {
    tag: 'full',
    mutate: (s) => {
      s.full_inbox = true
    },
    verdict: 'risky',
    reasons: ['MAILBOX_FULL'],
  },
  {
    tag: 'disabled',
    mutate: (s) => {
      s.mailbox_accepted = false
      s.disabled = true
    },
    verdict: 'invalid',
    reasons: ['MAILBOX_DISABLED'],
  },
  {
    tag: 'error',
    mutate: (s) => {
      s.error = 'connection refused'
    },
    verdict: 'unknown',
    reasons: ['SMTP_UNAVAILABLE'],
  },
]

function pushSmtpFailures(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const spec = SMTP_CASES[i % SMTP_CASES.length] as SmtpCase
    const domain = `mailserver-${i}.com`
    const local = `user${i}`
    const engine = baseEngine(local, domain)
    spec.mutate(engine.smtp as NonNullable<EngineResponse['smtp']>)
    out.push({
      email: `${local}@${domain}`,
      category: `smtp-${spec.tag}`,
      stubbedEngineResponse: engine,
      expectedVerdict: spec.verdict,
      expectedReasonCodes: [...spec.reasons],
    })
  }
}

// MX lookup itself failed: the domain was never examined. smtp is null, so the
// aggregator also appends SMTP_NOT_CHECKED as a secondary caution.
function pushMxUnavailable(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const domain = `unreachable-dns-${i}.com`
    const local = `user${i}`
    const engine = baseEngine(local, domain)
    engine.mx = { has_mx: null, records: [], error: 'lookup timed out' }
    engine.smtp = null
    out.push({
      email: `${local}@${domain}`,
      category: 'mx-unavailable',
      stubbedEngineResponse: engine,
      expectedVerdict: 'unknown',
      expectedReasonCodes: ['MX_LOOKUP_UNAVAILABLE', 'SMTP_NOT_CHECKED'],
    })
  }
}

// Clean address, but no mailbox probe was requested (smtp === null): the honest
// verdict is unknown with SMTP_NOT_CHECKED.
function pushSmtpNotChecked(out: Fixture[], count: number): void {
  for (let i = 0; i < count; i += 1) {
    const domain = `probe-skipped-${i}.com`
    const local = `user${i}`
    const engine = baseEngine(local, domain)
    engine.smtp = null
    out.push({
      email: `${local}@${domain}`,
      category: 'smtp-not-checked',
      stubbedEngineResponse: engine,
      expectedVerdict: 'unknown',
      expectedReasonCodes: ['SMTP_NOT_CHECKED'],
    })
  }
}

// Operational conditions the worker passes to the aggregator (not engine-
// derived): probing disabled by policy, or the domain circuit breaker open.
// smtp is null, so SMTP_NOT_CHECKED is appended as a secondary caution.
function pushOperational(out: Fixture[], count: number): void {
  const reasons: Array<'SMTP_DISABLED' | 'CIRCUIT_OPEN'> = ['SMTP_DISABLED', 'CIRCUIT_OPEN']
  for (let i = 0; i < count; i += 1) {
    const reason = reasons[i % reasons.length] as 'SMTP_DISABLED' | 'CIRCUIT_OPEN'
    const domain = `operational-${i}.com`
    const local = `user${i}`
    const engine = baseEngine(local, domain)
    engine.smtp = null
    out.push({
      email: `${local}@${domain}`,
      category: `operational-${reason.toLowerCase()}`,
      stubbedEngineResponse: engine,
      operationalReason: reason,
      expectedVerdict: 'unknown',
      expectedReasonCodes: [reason, 'SMTP_NOT_CHECKED'],
    })
  }
}

/** Builds the full corpus: exactly 500 deterministic fixtures. */
export function buildCorpus(): Fixture[] {
  const out: Fixture[] = []
  pushValid(out, 'valid-global-provider', GLOBAL_PROVIDERS, 55)
  pushValid(out, 'valid-cis-uz-provider', CIS_UZ_PROVIDERS, 55)
  pushValid(out, 'valid-corporate', CORPORATE_DOMAINS, 40)
  pushSyntaxFailures(out, 50)
  pushDisposable(out, 40)
  pushRoleAccounts(out, 40)
  pushNonexistent(out, 40)
  pushTypos(out, 45)
  pushUnicodeIdnLong(out, 25, 15)
  pushCatchAll(out, 25)
  pushSmtpFailures(out, 40)
  pushMxUnavailable(out, 6)
  pushSmtpNotChecked(out, 20)
  pushOperational(out, 4)
  return out
}

export const CORPUS_SIZE = 500
