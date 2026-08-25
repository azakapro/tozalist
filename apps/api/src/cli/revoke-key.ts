import { parseArgs } from 'node:util'
import { createClient, revokeApiKeyById, type DatabaseClient } from '@tozalist/db'

/**
 * pnpm api:revoke-key --key-id <api-key-uuid>
 *
 * Idempotent: revoking an already-revoked key changes nothing and writes no
 * second audit event. Never prints key material.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CliResult = { exitCode: number }

export async function revokeKeyCommand(
  db: DatabaseClient,
  args: string[],
  print: (line: string) => void = console.log,
): Promise<CliResult> {
  let keyId: string | undefined
  try {
    const parsed = parseArgs({
      args,
      options: { 'key-id': { type: 'string' } },
      strict: true,
    })
    keyId = parsed.values['key-id']
  } catch {
    print('usage: pnpm api:revoke-key --key-id <api-key-uuid>')
    return { exitCode: 2 }
  }

  if (keyId === undefined || !UUID_PATTERN.test(keyId)) {
    print('error: --key-id must be a valid API-key UUID')
    return { exitCode: 2 }
  }

  const result = await revokeApiKeyById(db, keyId.toLowerCase())
  switch (result) {
    case 'revoked':
      print(`API key ${keyId} revoked`)
      return { exitCode: 0 }
    case 'already_revoked':
      print(`API key ${keyId} was already revoked; nothing changed`)
      return { exitCode: 0 }
    case 'not_found':
      print('error: API key not found')
      return { exitCode: 1 }
  }
}

if (process.argv[1]?.endsWith('revoke-key.ts') || process.argv[1]?.endsWith('revoke-key.js')) {
  const { db, sql } = createClient({ maxConnections: 1 })
  try {
    const { exitCode } = await revokeKeyCommand(db, process.argv.slice(2))
    process.exitCode = exitCode
  } finally {
    await sql.end()
  }
}
