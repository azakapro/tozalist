import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasMigrations, listMigrationFiles } from './migrations.js'
import { MIGRATIONS_DIR } from './paths.js'

function fixture(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'tozalist-migrations-'))
  for (const file of files) {
    const target = join(dir, file)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, '-- test fixture\n')
  }
  return dir
}

describe('listMigrationFiles', () => {
  it('returns SQL files in the order Drizzle applies them', () => {
    const dir = fixture(['0001_init.sql', '0010_later.sql', '0002_next.sql'])
    expect(listMigrationFiles(dir)).toEqual(['0001_init.sql', '0002_next.sql', '0010_later.sql'])
  })

  it('ignores the drizzle journal and other non-SQL files', () => {
    const dir = fixture(['meta/_journal.json', 'README.md', '0001_init.sql'])
    expect(listMigrationFiles(dir)).toEqual(['0001_init.sql'])
  })

  it('treats a missing directory as empty rather than throwing', () => {
    expect(listMigrationFiles(join(tmpdir(), 'tozalist-does-not-exist-3f9a'))).toEqual([])
  })
})

describe('hasMigrations', () => {
  it('is false for an empty migrations directory', () => {
    expect(hasMigrations(fixture([]))).toBe(false)
    expect(hasMigrations(fixture(['meta/_journal.json']))).toBe(false)
  })

  it('is true as soon as SQL exists, even without a journal', () => {
    // Failing loudly beats silently skipping a real migration.
    expect(hasMigrations(fixture(['0001_init.sql']))).toBe(true)
  })

  it('finds the migrations committed in this repository', () => {
    const files = listMigrationFiles(MIGRATIONS_DIR)

    expect(hasMigrations(MIGRATIONS_DIR)).toBe(true)
    expect(files[0]).toMatch(/^0000_/)
    expect(files.some((file) => file.endsWith('_append_only_credit_ledger.sql'))).toBe(true)
  })
})
