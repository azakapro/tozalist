import { describe, expect, it } from 'vitest'
import {
  aggregate,
  AGGREGATE_DISCLAIMER,
  type AggregateInput,
  type EngineResponse,
} from './aggregate.js'
import { isReasonCode } from './reason-codes.js'

/** A clean, fully-probed address that passed every check. Tests override what they need. */
function engineResponse(overrides: Partial<EngineResponse> = {}): EngineResponse {
  return {
    email: 'user@example.com',
    syntax: { valid: true, username: 'user', domain: 'example.com' },
    mx: { has_mx: true, records: ['mx.example.com.'], error: '' },
    disposable: false,
    role_account: false,
    free_provider: false,
    smtp: {
      attempted: true,
      mailbox_accepted: true,
      catch_all: false,
      full_inbox: false,
      disabled: false,
      error: '',
    },
    duration_ms: 12,
    ...overrides,
  }
}

function smtp(overrides: Partial<NonNullable<EngineResponse['smtp']>>): EngineResponse['smtp'] {
  return {
    attempted: true,
    mailbox_accepted: true,
    catch_all: false,
    full_inbox: false,
    disabled: false,
    error: '',
    ...overrides,
  }
}

function run(engine: EngineResponse, typo: string | null = null) {
  return aggregate({ engine, typo })
}

describe('aggregate - priority rules', () => {
  it('rule 1: invalid syntax -> invalid, SYNTAX_INVALID only, score 0', () => {
    const result = run(
      engineResponse({
        syntax: { valid: false, username: '', domain: '' },
        // Even with every other alarm ringing, syntax decides alone.
        disposable: true,
        role_account: true,
        mx: { has_mx: null, records: [], error: 'boom' },
      }),
      'gmail.com',
    )
    expect(result).toMatchObject({ verdict: 'invalid', score: 0, reasonCodes: ['SYNTAX_INVALID'] })
  })

  it('rule 2a: mx.error non-empty -> unknown, MX_LOOKUP_UNAVAILABLE, score 50', () => {
    const result = run(engineResponse({ mx: { has_mx: null, records: [], error: 'timeout: dns' } }))
    expect(result).toMatchObject({ verdict: 'unknown', score: 50 })
    expect(result.reasonCodes[0]).toBe('MX_LOOKUP_UNAVAILABLE')
  })

  it('rule 2b: has_mx null without an error string is still a failed lookup', () => {
    const result = run(engineResponse({ mx: { has_mx: null, records: [], error: '' } }))
    expect(result).toMatchObject({ verdict: 'unknown', score: 50 })
    expect(result.reasonCodes[0]).toBe('MX_LOOKUP_UNAVAILABLE')
  })

  it('rule 3: has_mx false -> invalid, DOMAIN_NO_MX only, score 5', () => {
    const result = run(engineResponse({ mx: { has_mx: false, records: [], error: '' } }))
    expect(result).toMatchObject({ verdict: 'invalid', score: 5, reasonCodes: ['DOMAIN_NO_MX'] })
  })

  it('rule 4: catch-all -> unknown, CATCH_ALL_DOMAIN, score 50', () => {
    const result = run(engineResponse({ smtp: smtp({ catch_all: true }) }))
    expect(result).toMatchObject({ verdict: 'unknown', score: 50 })
    expect(result.reasonCodes[0]).toBe('CATCH_ALL_DOMAIN')
  })

  it('rule 5: smtp error -> unknown, SMTP_UNAVAILABLE, score 50', () => {
    const result = run(
      engineResponse({
        smtp: smtp({ attempted: true, mailbox_accepted: false, error: 'timeout' }),
      }),
    )
    expect(result).toMatchObject({ verdict: 'unknown', score: 50 })
    expect(result.reasonCodes[0]).toBe('SMTP_UNAVAILABLE')
  })

  it('rule 6: probe refused by policy -> unknown, SMTP_NOT_CHECKED, score 50', () => {
    const result = run(
      engineResponse({ smtp: smtp({ attempted: false, mailbox_accepted: false, disabled: true }) }),
    )
    expect(result).toMatchObject({ verdict: 'unknown', score: 50 })
    expect(result.reasonCodes[0]).toBe('SMTP_NOT_CHECKED')
  })

  it('rule 7: mailbox rejected -> invalid, MAILBOX_REJECTED only, score 10', () => {
    const result = run(engineResponse({ smtp: smtp({ mailbox_accepted: false }) }))
    expect(result).toMatchObject({
      verdict: 'invalid',
      score: 10,
      reasonCodes: ['MAILBOX_REJECTED'],
    })
  })

  it('rule 8: full inbox -> risky, MAILBOX_FULL, score 45', () => {
    const result = run(engineResponse({ smtp: smtp({ full_inbox: true }) }))
    expect(result).toMatchObject({ verdict: 'risky', score: 45 })
    expect(result.reasonCodes[0]).toBe('MAILBOX_FULL')
  })

  it('rule 9: provider-disabled mailbox -> invalid, MAILBOX_DISABLED, score 10', () => {
    const result = run(
      engineResponse({ smtp: smtp({ attempted: true, mailbox_accepted: true, disabled: true }) }),
    )
    expect(result).toMatchObject({
      verdict: 'invalid',
      score: 10,
      reasonCodes: ['MAILBOX_DISABLED'],
    })
  })

  it('rule 10: disposable -> risky, DISPOSABLE_DOMAIN, score 50', () => {
    const result = run(engineResponse({ disposable: true }))
    expect(result).toMatchObject({ verdict: 'risky', score: 50 })
    expect(result.reasonCodes[0]).toBe('DISPOSABLE_DOMAIN')
  })

  it('rule 11: role account -> risky, ROLE_ACCOUNT, score 60', () => {
    const result = run(engineResponse({ role_account: true }))
    expect(result).toMatchObject({ verdict: 'risky', score: 60 })
    expect(result.reasonCodes[0]).toBe('ROLE_ACCOUNT')
  })

  it('rule 12: typo suggestion -> risky, POSSIBLE_TYPO, score 65', () => {
    const result = run(engineResponse(), 'gmail.com')
    expect(result).toMatchObject({ verdict: 'risky', score: 65 })
    expect(result.reasonCodes[0]).toBe('POSSIBLE_TYPO')
  })

  it('rule 13: no probe requested and nothing else wrong -> unknown, SMTP_NOT_CHECKED, score 50', () => {
    const result = run(engineResponse({ smtp: null }))
    expect(result).toMatchObject({
      verdict: 'unknown',
      score: 50,
      reasonCodes: ['SMTP_NOT_CHECKED'],
    })
  })

  it('rule 14: all checks clean -> valid, no reasons, score 95', () => {
    expect(run(engineResponse())).toEqual({
      verdict: 'valid',
      score: 95,
      reasonCodes: [],
      disclaimer: AGGREGATE_DISCLAIMER,
    })
  })
})

describe('aggregate - combinations', () => {
  it('disposable + role account: DISPOSABLE_DOMAIN first, ROLE_ACCOUNT second', () => {
    const result = run(engineResponse({ disposable: true, role_account: true }))
    expect(result.verdict).toBe('risky')
    expect(result.reasonCodes).toEqual(['DISPOSABLE_DOMAIN', 'ROLE_ACCOUNT'])
  })

  it('catch-all + typo: CATCH_ALL_DOMAIN first, POSSIBLE_TYPO second', () => {
    const result = run(engineResponse({ smtp: smtp({ catch_all: true }) }), 'gmail.com')
    expect(result.verdict).toBe('unknown')
    expect(result.reasonCodes).toEqual(['CATCH_ALL_DOMAIN', 'POSSIBLE_TYPO'])
  })

  it('no SMTP + role account: role decides, unprobed mailbox noted second', () => {
    const result = run(engineResponse({ smtp: null, role_account: true }))
    expect(result.verdict).toBe('risky')
    expect(result.score).toBe(60)
    expect(result.reasonCodes).toEqual(['ROLE_ACCOUNT', 'SMTP_NOT_CHECKED'])
  })

  it('MX lookup failure + disposable: unknown, disposable noted second', () => {
    const result = run(
      engineResponse({ mx: { has_mx: null, records: [], error: 'dns down' }, disposable: true }),
    )
    expect(result.verdict).toBe('unknown')
    expect(result.reasonCodes[0]).toBe('MX_LOOKUP_UNAVAILABLE')
    expect(result.reasonCodes).toContain('DISPOSABLE_DOMAIN')
  })

  it('no MX + disposable: invalid with DOMAIN_NO_MX only', () => {
    const result = run(
      engineResponse({ mx: { has_mx: false, records: [], error: '' }, disposable: true }),
    )
    expect(result.verdict).toBe('invalid')
    expect(result.reasonCodes).toEqual(['DOMAIN_NO_MX'])
  })

  it('mailbox rejected + full inbox: invalid with MAILBOX_REJECTED only', () => {
    const result = run(
      engineResponse({ smtp: smtp({ mailbox_accepted: false, full_inbox: true }) }),
    )
    expect(result.verdict).toBe('invalid')
    expect(result.reasonCodes).toEqual(['MAILBOX_REJECTED'])
  })

  it('SMTP-disabled policy + role account: unknown, role noted second', () => {
    const result = run(
      engineResponse({
        smtp: smtp({ attempted: false, mailbox_accepted: false, disabled: true }),
        role_account: true,
      }),
    )
    expect(result.verdict).toBe('unknown')
    expect(result.reasonCodes).toEqual(['SMTP_NOT_CHECKED', 'ROLE_ACCOUNT'])
  })

  it('valid SMTP result with no risk signals: valid with empty reasons', () => {
    const result = run(engineResponse(), null)
    expect(result.verdict).toBe('valid')
    expect(result.reasonCodes).toEqual([])
  })

  it('disposable + role + typo, all at once: fixed caution order after the decider', () => {
    const result = run(engineResponse({ disposable: true, role_account: true }), 'gmail.com')
    expect(result.reasonCodes).toEqual(['DISPOSABLE_DOMAIN', 'ROLE_ACCOUNT', 'POSSIBLE_TYPO'])
  })

  it('full inbox + disposable: MAILBOX_FULL decides, disposable noted second', () => {
    const result = run(engineResponse({ smtp: smtp({ full_inbox: true }), disposable: true }))
    expect(result.verdict).toBe('risky')
    expect(result.reasonCodes).toEqual(['MAILBOX_FULL', 'DISPOSABLE_DOMAIN'])
  })
})

describe('aggregate - priority order', () => {
  it('syntax beats every other signal', () => {
    const result = run(
      engineResponse({
        syntax: { valid: false, username: '', domain: '' },
        smtp: smtp({ catch_all: true, full_inbox: true }),
        disposable: true,
      }),
      'gmail.com',
    )
    expect(result.reasonCodes).toEqual(['SYNTAX_INVALID'])
  })

  it('MX failure beats catch-all and disposable', () => {
    const result = run(
      engineResponse({
        mx: { has_mx: null, records: [], error: 'dns down' },
        smtp: smtp({ catch_all: true }),
        disposable: true,
      }),
    )
    expect(result.verdict).toBe('unknown')
    expect(result.reasonCodes[0]).toBe('MX_LOOKUP_UNAVAILABLE')
  })

  it('a provider typo beats MX failure: the actionable signal decides, the failed lookup is noted', () => {
    const result = run(
      engineResponse({
        syntax: { valid: true, username: 'user', domain: 'gmial.com' },
        mx: { has_mx: null, records: [], error: 'lookup failed: server misbehaving' },
        disposable: true,
      }),
      'gmail.com',
    )
    expect(result.verdict).toBe('risky')
    expect(result.score).toBe(65)
    expect(result.reasonCodes).toEqual([
      'POSSIBLE_TYPO',
      'MX_LOOKUP_UNAVAILABLE',
      'DISPOSABLE_DOMAIN',
    ])
  })

  it('a typo with a completed lookup that found no MX is still invalid (no-MX is hard evidence)', () => {
    const result = run(
      engineResponse({ mx: { has_mx: false, records: [], error: '' } }),
      'gmail.com',
    )
    expect(result).toMatchObject({ verdict: 'invalid', score: 5, reasonCodes: ['DOMAIN_NO_MX'] })
  })

  it('no-MX beats SMTP signals and cautions', () => {
    const result = run(
      engineResponse({
        mx: { has_mx: false, records: [], error: '' },
        smtp: smtp({ mailbox_accepted: false }),
        role_account: true,
      }),
    )
    expect(result).toMatchObject({ verdict: 'invalid', score: 5, reasonCodes: ['DOMAIN_NO_MX'] })
  })

  it('catch-all beats an smtp error string', () => {
    const result = run(engineResponse({ smtp: smtp({ catch_all: true, error: 'later failure' }) }))
    expect(result.reasonCodes[0]).toBe('CATCH_ALL_DOMAIN')
  })

  it('rejection beats full inbox; full inbox beats provider-disabled', () => {
    expect(
      run(engineResponse({ smtp: smtp({ mailbox_accepted: false, full_inbox: true }) }))
        .reasonCodes[0],
    ).toBe('MAILBOX_REJECTED')
    expect(
      run(
        engineResponse({
          smtp: smtp({ attempted: true, mailbox_accepted: true, full_inbox: true, disabled: true }),
        }),
      ).reasonCodes[0],
    ).toBe('MAILBOX_FULL')
  })

  it('disposable beats role account beats typo', () => {
    expect(run(engineResponse({ disposable: true, role_account: true }), 'x.com').score).toBe(50)
    expect(run(engineResponse({ role_account: true }), 'x.com').score).toBe(60)
    expect(run(engineResponse(), 'x.com').score).toBe(65)
  })
})

describe('aggregate - operational reasons', () => {
  it('SMTP_DISABLED produces unknown with the operational reason first', () => {
    const result = aggregate({
      engine: engineResponse({ smtp: null, role_account: true }),
      typo: null,
      operationalReason: 'SMTP_DISABLED',
    })
    expect(result.verdict).toBe('unknown')
    expect(result.score).toBe(50)
    expect(result.reasonCodes).toEqual(['SMTP_DISABLED', 'ROLE_ACCOUNT', 'SMTP_NOT_CHECKED'])
  })

  it('CIRCUIT_OPEN produces unknown with secondary cautions preserved', () => {
    const result = aggregate({
      engine: engineResponse({ smtp: null, disposable: true }),
      typo: 'gmail.com',
      operationalReason: 'CIRCUIT_OPEN',
    })
    expect(result.verdict).toBe('unknown')
    expect(result.reasonCodes).toEqual([
      'CIRCUIT_OPEN',
      'DISPOSABLE_DOMAIN',
      'POSSIBLE_TYPO',
      'SMTP_NOT_CHECKED',
    ])
  })

  it('invalid syntax still outranks an operational reason', () => {
    const result = aggregate({
      engine: engineResponse({ syntax: { valid: false, username: '', domain: '' } }),
      typo: null,
      operationalReason: 'SMTP_DISABLED',
    })
    expect(result).toMatchObject({ verdict: 'invalid', score: 0, reasonCodes: ['SYNTAX_INVALID'] })
  })

  it('confirmed no-MX still outranks an operational reason', () => {
    const result = aggregate({
      engine: engineResponse({ mx: { has_mx: false, records: [], error: '' } }),
      typo: null,
      operationalReason: 'CIRCUIT_OPEN',
    })
    expect(result).toMatchObject({ verdict: 'invalid', score: 5, reasonCodes: ['DOMAIN_NO_MX'] })
  })

  it('an operational reason outranks catch-all, smtp signals and cautions', () => {
    const result = aggregate({
      engine: engineResponse({ smtp: smtp({ catch_all: true }), disposable: true }),
      typo: null,
      operationalReason: 'SMTP_DISABLED',
    })
    expect(result.reasonCodes[0]).toBe('SMTP_DISABLED')
    expect(result.verdict).toBe('unknown')
  })

  it('an MX lookup failure outranks an operational reason', () => {
    const result = aggregate({
      engine: engineResponse({ mx: { has_mx: null, records: [], error: 'dns down' } }),
      typo: null,
      operationalReason: 'CIRCUIT_OPEN',
    })
    expect(result.reasonCodes[0]).toBe('MX_LOOKUP_UNAVAILABLE')
  })

  it('behaviour without operationalReason is unchanged', () => {
    expect(aggregate({ engine: engineResponse(), typo: null })).toEqual({
      verdict: 'valid',
      score: 95,
      reasonCodes: [],
      disclaimer: AGGREGATE_DISCLAIMER,
    })
  })
})

describe('aggregate - invariants', () => {
  const scenarios: Array<[string, AggregateInput]> = [
    ['clean', { engine: engineResponse(), typo: null }],
    [
      'syntax invalid',
      {
        engine: engineResponse({ syntax: { valid: false, username: '', domain: '' } }),
        typo: null,
      },
    ],
    [
      'mx failure',
      { engine: engineResponse({ mx: { has_mx: null, records: [], error: 'x' } }), typo: null },
    ],
    [
      'no mx',
      { engine: engineResponse({ mx: { has_mx: false, records: [], error: '' } }), typo: null },
    ],
    [
      'catch-all',
      { engine: engineResponse({ smtp: smtp({ catch_all: true }) }), typo: 'gmail.com' },
    ],
    ['smtp error', { engine: engineResponse({ smtp: smtp({ error: 'x' }) }), typo: null }],
    [
      'policy refused',
      { engine: engineResponse({ smtp: smtp({ attempted: false, disabled: true }) }), typo: null },
    ],
    [
      'rejected',
      { engine: engineResponse({ smtp: smtp({ mailbox_accepted: false }) }), typo: null },
    ],
    ['full', { engine: engineResponse({ smtp: smtp({ full_inbox: true }) }), typo: null }],
    ['disabled', { engine: engineResponse({ smtp: smtp({ disabled: true }) }), typo: null }],
    [
      'disposable+role+typo',
      { engine: engineResponse({ disposable: true, role_account: true }), typo: 'gmail.com' },
    ],
    ['no probe', { engine: engineResponse({ smtp: null }), typo: null }],
  ]

  it('every result carries the exact disclaimer', () => {
    for (const [name, input] of scenarios) {
      expect(aggregate(input).disclaimer, name).toBe(
        "These are risk signals, not delivery guarantees. Results marked 'unknown' should not be deleted automatically.",
      )
    }
  })

  it('every emitted code exists in REASON_CODES', () => {
    for (const [name, input] of scenarios) {
      for (const code of aggregate(input).reasonCodes) {
        expect(isReasonCode(code), `${name}: ${code}`).toBe(true)
      }
    }
  })

  it('infrastructure failure alone is never invalid', () => {
    // Every way a lookup can fail without evidence about the address itself.
    const infraFailures: EngineResponse[] = [
      engineResponse({ mx: { has_mx: null, records: [], error: 'dns timeout' } }),
      engineResponse({ mx: { has_mx: null, records: [], error: '' } }),
      engineResponse({ smtp: smtp({ error: 'connect refused' }) }),
      engineResponse({
        smtp: smtp({ attempted: true, mailbox_accepted: false, error: 'timeout' }),
      }),
      engineResponse({ smtp: smtp({ attempted: false, disabled: true }) }),
    ]
    for (const engine of infraFailures) {
      const result = run(engine)
      expect(result.verdict, JSON.stringify(engine.mx) + JSON.stringify(engine.smtp)).toBe(
        'unknown',
      )
    }
  })

  it('scores stay in the documented sort range', () => {
    for (const [name, input] of scenarios) {
      const { score } = aggregate(input)
      expect(score, name).toBeGreaterThanOrEqual(0)
      expect(score, name).toBeLessThanOrEqual(95)
    }
  })
})
