import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BANNED_TERMS, findViolations, stripComments } from '../scripts/lint-copy.mjs'

describe('banned-copy linter', () => {
  it('flags every banned claim term', () => {
    for (const term of BANNED_TERMS) {
      expect(findViolations(`some copy with ${term} inside`), term).toContain(term)
    }
  })

  it('is case-insensitive', () => {
    expect(findViolations('This is GUARANTEED to work')).toContain('guaranteed')
    expect(findViolations('Гарантированная доставка')).toContain('гарантированн')
  })

  it('does not flag honest negations that avoid claim adjectives', () => {
    expect(findViolations('We do not guarantee delivery — nobody honestly can.')).toEqual([])
    expect(findViolations('Biz kafolat bermaymiz.')).toEqual([])
    expect(findViolations('Мы не гарантируем доставку.')).toEqual([])
  })

  it('ignores comments so the term list can be documented in code', () => {
    const source = '// guaranteed deliverable\n/* verified */\nconst x = "clean copy"'
    expect(findViolations(source)).toEqual([])
    expect(stripComments(source)).not.toContain('guaranteed')
  })

  it('the real message file passes in every locale', () => {
    const source = readFileSync(join(__dirname, '..', 'lib', 'messages.ts'), 'utf8')
    expect(findViolations(source)).toEqual([])
  })
})
