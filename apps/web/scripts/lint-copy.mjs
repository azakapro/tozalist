#!/usr/bin/env node
/**
 * Banned-copy gate (§0.2). Scans the public site's message file for claim
 * language that must never appear in any locale, and exits non-zero on a
 * match. Wired as the web app's prebuild step, so both local builds and CI
 * fail on violations.
 *
 * Banned: adjective-claims only. "guarantee" as a verb in "we do not
 * guarantee" is honest and allowed; "guaranteed delivery" is not.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'lib', 'messages.ts')

export const BANNED_TERMS = [
  'guaranteed',
  'deliverable',
  '100% accurate',
  'verified',
  'safe to send',
  // Russian and Uzbek adjective-claim equivalents.
  'гарантированн', // "guaranteed ..." claims
  'проверенный владел', // "verified owner"
  'kafolatlangan', // uz "guaranteed"
  // Person/phone-owner claims in any language.
  'phone owner',
  'owner of the phone',
  'владелец номера',
  'raqam egasi',
]

/** Strips // and block comments so only real copy is scanned. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

export function findViolations(text) {
  const lower = stripComments(text).toLowerCase()
  return BANNED_TERMS.filter((term) => lower.includes(term.toLowerCase()))
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const text = readFileSync(target, 'utf8')
  const violations = findViolations(text)
  if (violations.length > 0) {
    console.error('BANNED COPY found in lib/messages.ts:')
    for (const term of violations) console.error(`  - "${term}"`)
    process.exit(1)
  }
  console.log('copy lint: clean')
}
