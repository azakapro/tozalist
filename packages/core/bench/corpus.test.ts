import { describe, expect, it } from 'vitest'
import { buildCorpus, CORPUS_SIZE } from './corpus.js'
import { EMAIL_REASON_CODES, scoreCorpus, VERDICTS } from './score.js'

/**
 * Corpus coverage + gate, inside the normal test suite (roadmap 8.2). The
 * standalone `pnpm core:bench` prints the matrix; this proves the same
 * invariants run under `pnpm -r test`.
 */
describe('accuracy regression corpus', () => {
  const corpus = buildCorpus()

  it('contains exactly 500 fixtures', () => {
    expect(corpus).toHaveLength(CORPUS_SIZE)
  })

  it('is deterministic: two builds are deeply equal', () => {
    expect(buildCorpus()).toEqual(buildCorpus())
  })

  it('never references a real, resolvable domain: non-existent cases use reserved TLDs', () => {
    const nonexistent = corpus.filter((f) => f.category === 'nonexistent-domain')
    expect(nonexistent.length).toBeGreaterThan(0)
    for (const fixture of nonexistent) {
      expect(fixture.stubbedEngineResponse.syntax.domain).toMatch(/\.(invalid|test)$/)
    }
  })

  it('every fixture truthfully identifies the address it evaluates', () => {
    // fixture.email must be the exact address aggregate() sees via the stub.
    for (const fixture of corpus) {
      expect(fixture.email, fixture.category).toBe(fixture.stubbedEngineResponse.email)
    }
  })

  it('includes genuine non-ASCII Unicode email coverage', () => {
    const hasNonAscii = (value: string): boolean =>
      [...value].some((char) => char.codePointAt(0)! > 0x7f)
    const nonAscii = corpus.filter(
      (f) =>
        f.category === 'unicode-idn-long-valid' &&
        hasNonAscii(f.email) &&
        (hasNonAscii(f.stubbedEngineResponse.syntax.username) ||
          hasNonAscii(f.stubbedEngineResponse.syntax.domain)),
    )
    // At least one real non-ASCII address whose stub carries the non-ASCII code
    // point in its local part or domain - not merely ASCII punycode.
    expect(nonAscii.length).toBeGreaterThan(0)
  })

  it('covers every verdict class in its expected labels', () => {
    const verdicts = new Set(corpus.map((f) => f.expectedVerdict))
    for (const verdict of VERDICTS) expect(verdicts, verdict).toContain(verdict)
  })

  it('covers every email reason code in its expected labels', () => {
    const codes = new Set(corpus.flatMap((f) => f.expectedReasonCodes))
    for (const code of EMAIL_REASON_CODES) expect(codes, code).toContain(code)
  })

  it('covers each required roadmap category', () => {
    const categories = new Set(corpus.map((f) => f.category))
    for (const required of [
      'valid-global-provider',
      'valid-cis-uz-provider',
      'valid-corporate',
      'syntax-failure',
      'disposable',
      'role-account',
      'nonexistent-domain',
      'typo',
      'unicode-idn-long-valid',
      'unicode-idn-long-invalid',
      'catch-all',
      'smtp-rejected',
      'smtp-full',
      'smtp-disabled',
      'smtp-error',
      'mx-unavailable',
      'smtp-not-checked',
      'operational-smtp_disabled',
      'operational-circuit_open',
    ]) {
      expect(categories, required).toContain(required)
    }
  })

  it('the real pipeline matches every label: 100% logic correctness, confusion matrix diagonal', () => {
    const result = scoreCorpus(corpus)
    // Every mismatch is printed for debugging if this ever regresses.
    expect(result.mismatches, JSON.stringify(result.mismatches.slice(0, 10), null, 2)).toEqual([])
    expect(result.passed).toBe(CORPUS_SIZE)
    // Off-diagonal confusion cells must all be zero.
    for (const expected of VERDICTS) {
      for (const actual of VERDICTS) {
        if (expected !== actual) {
          expect(result.confusion[expected][actual], `${expected}->${actual}`).toBe(0)
        }
      }
    }
  })
})
