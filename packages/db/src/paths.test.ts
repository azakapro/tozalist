import { existsSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from './paths.js'

describe('MIGRATIONS_DIR', () => {
  it('points at a directory that exists in the package', () => {
    expect(existsSync(MIGRATIONS_DIR)).toBe(true)
    expect(statSync(MIGRATIONS_DIR).isDirectory()).toBe(true)
  })

  it('resolves to the drizzle output folder configured in drizzle.config.ts', () => {
    expect(MIGRATIONS_DIR.replace(/\/$/, '').endsWith('/packages/db/drizzle')).toBe(true)
  })
})
