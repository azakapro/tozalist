import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Boundary gate (roadmap 7.2): pilot billing is invoice-and-ledger only.
 * This test fails the suite if any workspace package ever gains a
 * payment-provider dependency before the TODO-PAYMENTS.md prerequisites are
 * done and the PM authorizes the step.
 */
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const FORBIDDEN = [
  'click-uz',
  'payme',
  'paycom',
  'stripe',
  'paypal',
  'braintree',
  'adyen',
  'square',
]

function workspacePackageJsons(): string[] {
  const files = [join(REPO_ROOT, 'package.json')]
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(REPO_ROOT, group), { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(join(REPO_ROOT, group, entry.name, 'package.json'))
    }
  }
  return files
}

describe('no payment provider', () => {
  it('no workspace package depends on a payment provider SDK', () => {
    for (const file of workspacePackageJsons()) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const names = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]
      for (const name of names) {
        for (const forbidden of FORBIDDEN) {
          expect(name.toLowerCase().includes(forbidden), `${file}: ${name}`).toBe(false)
        }
      }
    }
  })

  it('TODO-PAYMENTS.md records every deferred prerequisite', () => {
    const todo = readFileSync(join(REPO_ROOT, 'TODO-PAYMENTS.md'), 'utf8').toLowerCase()
    for (const required of [
      'legal entity',
      'merchant onboarding',
      'fiscalization',
      'recurring',
      'refund',
      'reconciliation',
      'open questions',
    ]) {
      expect(todo, required).toContain(required)
    }
  })
})
