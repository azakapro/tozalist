import { desc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiKeys, auditEvents, organizations, sha256Hex, type DatabaseClient } from '@tozalist/db'
import { createKeyCommand } from './cli/create-key.js'
import { revokeKeyCommand } from './cli/revoke-key.js'
import { connectTestDb, createOrg, hasIntegrationEnv } from './test/support.js'

describe.skipIf(!hasIntegrationEnv)('key management CLIs', () => {
  let db: DatabaseClient
  let sqlEnd: () => Promise<void>
  let orgId: string

  beforeAll(async () => {
    const connection = connectTestDb()
    db = connection.db
    sqlEnd = () => connection.sql.end()
    orgId = await createOrg(db)
  })

  afterAll(async () => {
    await sqlEnd()
  })

  function capture(): { lines: string[]; print: (line: string) => void } {
    const lines: string[] = []
    return { lines, print: (line) => lines.push(line) }
  }

  // --- 18. create-key ------------------------------------------------------------

  it('create-key prints a usable plaintext key once; the DB holds only its hash', async () => {
    const { lines, print } = capture()
    const result = await createKeyCommand(db, ['--org', orgId, '--name', 'cli key'], print)
    expect(result.exitCode).toBe(0)

    const output = lines.join('\n')
    const match = /tzl_live_[0-9A-Za-z]{32}/.exec(output)
    expect(match).not.toBeNull()
    const plaintext = match?.[0] ?? ''

    // Printed exactly once.
    expect(output.split(plaintext).length - 1).toBe(1)
    // No hash, no connection string in the output.
    expect(output).not.toMatch(/[0-9a-f]{64}/)
    expect(output).not.toContain('postgres')

    const [stored] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, sha256Hex(plaintext)))
    expect(stored).toBeDefined()
    expect(stored?.keyPrefix).toBe(plaintext.slice(0, 12))
    expect(JSON.stringify(stored)).not.toContain(plaintext)

    // Audit event for creation exists and holds no key material.
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'api_key.created'))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1)
    expect(audit?.targetId).toBe(stored?.id)
    expect(JSON.stringify(audit)).not.toContain(plaintext)
  })

  it('create-key validates its arguments and the organization', async () => {
    const bad = capture()
    expect(
      (await createKeyCommand(db, ['--org', 'not-a-uuid', '--name', 'x'], bad.print)).exitCode,
    ).toBe(2)
    expect((await createKeyCommand(db, ['--name', 'x'], bad.print)).exitCode).toBe(2)
    expect((await createKeyCommand(db, ['--org', orgId], bad.print)).exitCode).toBe(2)

    const ghost = capture()
    const missing = await createKeyCommand(
      db,
      ['--org', '00000000-0000-4000-8000-00000000beef', '--name', 'x'],
      ghost.print,
    )
    expect(missing.exitCode).toBe(1)
    expect(ghost.lines.join('\n')).toContain('organization not found')

    const doomed = await createOrg(db)
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, doomed))
    const deleted = capture()
    expect(
      (await createKeyCommand(db, ['--org', doomed, '--name', 'x'], deleted.print)).exitCode,
    ).toBe(1)
    expect(deleted.lines.join('\n')).toContain('deleted')
  })

  // --- 19. revoke-key -------------------------------------------------------------

  it('revoke-key revokes once, is idempotent, and audits exactly one revocation', async () => {
    const created = capture()
    await createKeyCommand(db, ['--org', orgId, '--name', 'revoke me'], created.print)
    const plaintext = /tzl_live_[0-9A-Za-z]{32}/.exec(created.lines.join('\n'))?.[0] ?? ''
    const [row] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, sha256Hex(plaintext)))
    if (row === undefined) throw new Error('setup failed')

    const first = capture()
    expect((await revokeKeyCommand(db, ['--key-id', row.id], first.print)).exitCode).toBe(0)
    expect(first.lines.join('\n')).toContain('revoked')

    const second = capture()
    expect((await revokeKeyCommand(db, ['--key-id', row.id], second.print)).exitCode).toBe(0)
    expect(second.lines.join('\n')).toContain('already revoked')

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'api_key.revoked'))
    const forThisKey = audits.filter((event) => event.targetId === row.id)
    expect(forThisKey).toHaveLength(1)
    expect(JSON.stringify(forThisKey)).not.toContain(plaintext)

    const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.id, row.id))
    expect(stored?.revokedAt).not.toBeNull()
  })

  it('revoke-key rejects bad ids and reports unknown keys', async () => {
    const bad = capture()
    expect((await revokeKeyCommand(db, ['--key-id', 'nope'], bad.print)).exitCode).toBe(2)

    const missing = capture()
    expect(
      (
        await revokeKeyCommand(
          db,
          ['--key-id', '00000000-0000-4000-8000-00000000dead'],
          missing.print,
        )
      ).exitCode,
    ).toBe(1)
    expect(missing.lines.join('\n')).toContain('not found')
  })
})
