import { describe, expect, it } from 'vitest'
import { findHighEntropyLiterals, findSecretMatches, shannonEntropy } from './scan-secrets.mjs'

describe('secret scanner', () => {
  it('flags a generic high-entropy literal in non-test source', () => {
    const line = `const key = "aG9uZXN0bHlSYW5kb20xMjM0NTZBQkNkZWZn"`
    expect(findSecretMatches(line, { isTest: false }).map((m) => m.name)).toContain(
      'high-entropy-literal',
    )
    // The same line in a test file is not flagged by the generic heuristic.
    expect(findSecretMatches(line, { isTest: true })).toEqual([])
  })

  it('flags high-confidence signatures even in test files', () => {
    // Fixtures are assembled from fragments so this file carries no contiguous
    // secret literal for the repo-wide scanner to flag - while the runtime
    // strings still exercise the regexes exactly.
    const privateKey = '-----BEGIN RSA ' + 'PRIVATE KEY-----'
    const awsKey = `const k = "${'AKIA' + 'IOSFODNN7EXAMPLE'}"`
    const liveKey = `const k = "${'tzl_live_' + 'abcdefghijklmnopqrstuvwxyz012345'}"`
    for (const line of [privateKey, awsKey, liveKey]) {
      expect(findSecretMatches(line, { isTest: true }).length, line).toBeGreaterThan(0)
    }
  })

  it('does not flag ordinary prose, hex ids, or import specifiers', () => {
    for (const line of [
      `import { buildApp } from './app.js'`,
      `const id = "3f2a4b1c-9d8e-4f00-8a11-000000000000"`,
      `const hash = "a".repeat(64)`,
      `// This is a normal comment explaining the retention sweep behaviour`,
    ]) {
      expect(findSecretMatches(line, { isTest: false }), line).toEqual([])
    }
  })

  it('honours an inline allow pledge for known non-secret constants', () => {
    const line = `const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567abc123" // secret-scan: allow (alphabet)`
    expect(findSecretMatches(line, { isTest: false })).toEqual([])
    // But the pledge never suppresses a high-confidence signature.
    const withKey = `const k = "${'AKIA' + 'IOSFODNN7EXAMPLE'}" // secret-scan: allow (nice try)`
    expect(findSecretMatches(withKey, { isTest: false }).length).toBeGreaterThan(0)
  })

  it('entropy is higher for random strings than for repetitive text', () => {
    expect(shannonEntropy('aaaaaaaaaaaaaaaa')).toBeLessThan(1)
    expect(shannonEntropy('aG9uZXN0bHlSYW5kb20xMjM')).toBeGreaterThan(4)
    expect(findHighEntropyLiterals('const x = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"')).toEqual([])
  })
})
