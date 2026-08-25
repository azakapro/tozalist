import { describe, expect, it } from 'vitest'
import { normalizeEmail } from './normalize-email.js'

describe('normalizeEmail', () => {
  describe('whitespace', () => {
    it('trims leading and trailing whitespace', () => {
      expect(normalizeEmail('  user@example.com  ')).toEqual({
        normalized: 'user@example.com',
        changes: ['TRIMMED_WHITESPACE'],
      })
    })

    it('trims tabs and newlines from pasted input', () => {
      expect(normalizeEmail('\tuser@example.com\n')).toEqual({
        normalized: 'user@example.com',
        changes: ['TRIMMED_WHITESPACE'],
      })
    })

    it('does not record trimming when there is nothing to trim', () => {
      expect(normalizeEmail('user@example.com').changes).toEqual([])
    })

    it('preserves whitespace inside the address untouched', () => {
      const result = normalizeEmail('us er@example.com')
      expect(result.normalized).toBe('us er@example.com')
      expect(result.changes).toEqual([])
    })
  })

  describe('wrappers', () => {
    it('strips angle brackets from a pasted display-name address', () => {
      expect(normalizeEmail('<user@example.com>')).toEqual({
        normalized: 'user@example.com',
        changes: ['STRIPPED_ANGLE_BRACKETS'],
      })
    })

    it('strips double quotes', () => {
      expect(normalizeEmail('"user@example.com"')).toEqual({
        normalized: 'user@example.com',
        changes: ['STRIPPED_DOUBLE_QUOTES'],
      })
    })

    it('strips single quotes', () => {
      expect(normalizeEmail("'user@example.com'")).toEqual({
        normalized: 'user@example.com',
        changes: ['STRIPPED_SINGLE_QUOTES'],
      })
    })

    it('strips only one wrapper layer', () => {
      const result = normalizeEmail('"<user@example.com>"')
      expect(result.normalized).toBe('<user@example.com>')
      expect(result.changes).toEqual(['STRIPPED_DOUBLE_QUOTES'])
    })

    it('leaves a mismatched wrapper alone', () => {
      const result = normalizeEmail('<user@example.com')
      expect(result.normalized).toBe('<user@example.com')
      expect(result.changes).toEqual([])
    })

    it('leaves a closing-only wrapper alone', () => {
      expect(normalizeEmail("user@example.com'").normalized).toBe("user@example.com'")
    })

    it('does not treat an opening quote in a quoted local part as a wrapper', () => {
      const result = normalizeEmail('"john doe"@example.com')
      expect(result.normalized).toBe('"john doe"@example.com')
      expect(result.changes).toEqual([])
    })

    it('trims and then strips a wrapper, recording both', () => {
      expect(normalizeEmail('  <user@example.com>  ')).toEqual({
        normalized: 'user@example.com',
        changes: ['TRIMMED_WHITESPACE', 'STRIPPED_ANGLE_BRACKETS'],
      })
    })

    it('trims whitespace hiding inside a wrapper', () => {
      const result = normalizeEmail('< user@example.com >')
      expect(result.normalized).toBe('user@example.com')
      expect(result.changes).toEqual(['STRIPPED_ANGLE_BRACKETS', 'TRIMMED_WHITESPACE'])
    })
  })

  describe('casing', () => {
    it('preserves local-part casing entirely (RFC 5321: it may be case-sensitive)', () => {
      expect(normalizeEmail('User@example.com')).toEqual({
        normalized: 'User@example.com',
        changes: [],
      })
    })

    it('lowercases the domain', () => {
      expect(normalizeEmail('user@EXAMPLE.COM')).toEqual({
        normalized: 'user@example.com',
        changes: ['LOWERCASED_DOMAIN'],
      })
    })

    it('lowercases the domain while leaving the local part untouched', () => {
      expect(normalizeEmail('User@Example.COM')).toEqual({
        normalized: 'User@example.com',
        changes: ['LOWERCASED_DOMAIN'],
      })
    })

    it('splits on the last @ so a quoted @ stays in the untouched local part', () => {
      expect(normalizeEmail('"USER@HOME"@Example.COM')).toEqual({
        normalized: '"USER@HOME"@example.com',
        changes: ['LOWERCASED_DOMAIN'],
      })
    })

    it('does not change casing in a string without an @ separator', () => {
      const result = normalizeEmail('NotAnEmail')
      expect(result.normalized).toBe('NotAnEmail')
      expect(result.changes).toEqual([])
    })

    it('regression: local-part casing is never changed by any normalization path', () => {
      const cases: Array<[string, string]> = [
        ['User@example.com', 'User'],
        ['  MiXeD.CaSe@EXAMPLE.COM  ', 'MiXeD.CaSe'],
        ['<UPPER@Example.com>', 'UPPER'],
        ['"QuOtEd LoCaL"@Example.COM', '"QuOtEd LoCaL"'],
        ["'Wrapped@Example.com'", 'Wrapped'],
        ['User+TAG@Example.COM', 'User+TAG'],
        ['"A@B"@C.COM', '"A@B"'],
      ]
      for (const [input, expectedLocal] of cases) {
        const { normalized } = normalizeEmail(input)
        expect(normalized, input).not.toBeNull()
        const at = (normalized as string).lastIndexOf('@')
        expect((normalized as string).slice(0, at), input).toBe(expectedLocal)
      }
    })
  })

  describe('content preservation', () => {
    it('keeps plus-addressing intact, casing included', () => {
      expect(normalizeEmail('User+Newsletter@Example.COM')).toEqual({
        normalized: 'User+Newsletter@example.com',
        changes: ['LOWERCASED_DOMAIN'],
      })
    })

    it('keeps dots in the local part', () => {
      expect(normalizeEmail('first.last@gmail.com').normalized).toBe('first.last@gmail.com')
    })

    it('does not judge validity: hopeless input is normalized, not rejected', () => {
      const result = normalizeEmail('  NOT AN EMAIL  ')
      expect(result.normalized).toBe('NOT AN EMAIL')
      expect(result.changes).toEqual(['TRIMMED_WHITESPACE'])
    })

    it('keeps multiple consecutive dots (validity is the syntax check, not ours)', () => {
      expect(normalizeEmail('a..b@example.com').normalized).toBe('a..b@example.com')
    })
  })

  describe('empty input', () => {
    it('returns null for the empty string', () => {
      expect(normalizeEmail('')).toEqual({ normalized: null, changes: [] })
    })

    it('returns null for whitespace-only input, recording the trim', () => {
      expect(normalizeEmail('   ')).toEqual({
        normalized: null,
        changes: ['TRIMMED_WHITESPACE'],
      })
    })

    it('returns null when only a wrapper remains', () => {
      expect(normalizeEmail('<>')).toEqual({
        normalized: null,
        changes: ['STRIPPED_ANGLE_BRACKETS'],
      })
    })

    it('returns null for a wrapper around whitespace', () => {
      expect(normalizeEmail('" "')).toEqual({
        normalized: null,
        changes: ['STRIPPED_DOUBLE_QUOTES', 'TRIMMED_WHITESPACE'],
      })
    })
  })

  describe('unchanged input', () => {
    it.each([
      'user@example.com',
      'first.last+tag@gmail.com',
      'x@y.z',
      'user@sub.domain.example.com',
    ])('reports no changes for already-normal %s', (input) => {
      expect(normalizeEmail(input)).toEqual({ normalized: input, changes: [] })
    })
  })
})
