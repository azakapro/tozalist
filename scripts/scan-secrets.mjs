#!/usr/bin/env node
/**
 * Secret-hygiene gate (roadmap 8.1): scans the repository for secret-shaped
 * content and exits non-zero on a match. Runs locally and in CI before every
 * merge.
 *
 * What it looks for:
 *  - private key blocks (PEM headers)
 *  - AWS access key ids (AKIA...)
 *  - GitHub/Slack/Google-style token prefixes
 *  - our own live API keys (tzl_live_ followed by real key material)
 *  - assignments of high-entropy literals to secret-named variables
 *
 * Matches print file:line and a pattern NAME only - never the matched text,
 * so the scanner itself cannot leak what it found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.docker-data',
  'generated',
])
const SKIP_FILES = new Set(['pnpm-lock.yaml'])
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.ico', '.zip', '.gz', '.woff', '.woff2'])
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|\/test\/|\/tests\//

/**
 * High-confidence signatures: scanned in ALL files, including tests. These
 * shapes are never legitimate fixtures - a real private key or cloud token
 * committed anywhere, even a test, is a leak.
 */
export const HIGH_CONFIDENCE_PATTERNS = [
  { name: 'private-key-block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'tozalist-live-key', pattern: /\btzl_live_[A-Za-z0-9]{24,}\b/ },
]

/**
 * Source-only signatures: secret-named assignments and generic high-entropy
 * string literals. Skipped in tests, which legitimately hold fabricated
 * key-shaped fixtures and long deterministic hashes.
 */
export const SOURCE_ONLY_PATTERNS = [
  {
    name: 'secret-assignment',
    // secret-named identifier = quoted literal of 24+ token characters.
    pattern:
      /(?:password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|token)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']/i,
  },
]

/**
 * Shannon entropy (bits/char) of a string - high for random secrets, low for
 * natural-language or repetitive text.
 */
export function shannonEntropy(text) {
  const counts = new Map()
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const probability = count / text.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy
}

const STRING_LITERAL = /["'`]([A-Za-z0-9+/_=-]{32,})["'`]/g

/**
 * Flags a generic high-entropy literal: 32+ base64/hex-ish characters with
 * entropy above ~4.0 bits/char and a mix of letters and digits. Import
 * specifiers and pure-hex ids (which recur in fixtures) are deliberately not
 * this pattern's job - that is what the high-confidence list and source-only
 * scoping cover.
 */
export function findHighEntropyLiterals(line) {
  const hits = []
  for (const match of line.matchAll(STRING_LITERAL)) {
    const value = match[1]
    const hasLetter = /[A-Za-z]/.test(value)
    const hasDigit = /[0-9]/.test(value)
    const notHexOnly = !/^[0-9a-f]+$/i.test(value)
    if (hasLetter && hasDigit && notHexOnly && shannonEntropy(value) > 4.0) {
      hits.push({ name: 'high-entropy-literal' })
    }
  }
  return hits
}

/** Back-compat export: the full pattern set for a given file classification. */
export const PATTERNS = [...HIGH_CONFIDENCE_PATTERNS, ...SOURCE_ONLY_PATTERNS]

const ALLOW_MARKER = 'secret-scan: allow'

export function findSecretMatches(text, { isTest = false } = {}) {
  const matches = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    // A reviewable inline pledge suppresses this line - used only for known
    // character-set constants that are not secrets. Never suppresses the
    // high-confidence signatures below.
    const allowed = line.includes(ALLOW_MARKER)
    for (const { name, pattern } of HIGH_CONFIDENCE_PATTERNS) {
      if (pattern.test(line)) matches.push({ line: index + 1, name })
    }
    if (!isTest && !allowed) {
      for (const { name, pattern } of SOURCE_ONLY_PATTERNS) {
        if (pattern.test(line)) matches.push({ line: index + 1, name })
      }
      for (const hit of findHighEntropyLiterals(line)) {
        matches.push({ line: index + 1, name: hit.name })
      }
    }
  }
  return matches
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name))
      continue
    }
    yield join(dir, entry.name)
  }
}

const isMain = process.argv[1]?.endsWith('scan-secrets.mjs')
if (isMain) {
  let failed = false
  let scanned = 0
  for (const file of walk(ROOT)) {
    const path = relative(ROOT, file)
    const extension = path.slice(path.lastIndexOf('.'))
    if (SKIP_FILES.has(path.split('/').pop() ?? '') || SKIP_EXTENSIONS.has(extension)) continue
    if (statSync(file).size > 2 * 1024 * 1024) continue
    // Tests are scanned for high-confidence signatures only; source gets the
    // full set including generic high-entropy literals.
    const matches = findSecretMatches(readFileSync(file, 'utf8'), { isTest: TEST_FILE.test(path) })
    scanned += 1
    for (const match of matches) {
      failed = true
      console.error(`SECRET-LIKE CONTENT: ${path}:${match.line} (${match.name})`)
    }
  }
  if (failed) process.exit(1)
  console.log(`secret scan: clean (${scanned} files)`)
}
