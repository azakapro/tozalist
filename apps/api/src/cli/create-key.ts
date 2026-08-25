import { parseArgs } from 'node:util'
import { createApiKeyForOrg, createClient, type DatabaseClient } from '@tozalist/db'

/**
 * pnpm api:create-key --org <organization-uuid> --name <name>
 *
 * Prints the plaintext key exactly once, after the transaction has committed.
 * Nothing else sensitive is printed: no hashes, no connection strings.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CliResult = { exitCode: number }

export async function createKeyCommand(
  db: DatabaseClient,
  args: string[],
  print: (line: string) => void = console.log,
): Promise<CliResult> {
  let org: string | undefined
  let name: string | undefined
  try {
    const parsed = parseArgs({
      args,
      options: { org: { type: 'string' }, name: { type: 'string' } },
      strict: true,
    })
    org = parsed.values.org
    name = parsed.values.name
  } catch {
    print('usage: pnpm api:create-key --org <organization-uuid> --name <name>')
    return { exitCode: 2 }
  }

  if (org === undefined || !UUID_PATTERN.test(org)) {
    print('error: --org must be a valid organization UUID')
    return { exitCode: 2 }
  }
  if (name === undefined || name.trim() === '') {
    print('error: --name is required')
    return { exitCode: 2 }
  }

  const result = await createApiKeyForOrg(db, org.toLowerCase(), name.trim())
  if (!result.ok) {
    print(
      result.reason === 'org_not_found'
        ? 'error: organization not found'
        : 'error: organization is deleted',
    )
    return { exitCode: 1 }
  }

  print('API key created')
  print(`  key id:  ${result.created.apiKeyId}`)
  print(`  org:     ${result.created.orgId}`)
  print(`  prefix:  ${result.created.keyPrefix}`)
  print('')
  print('  Plaintext key (shown once, not recoverable):')
  print(`    ${result.created.plaintext}`)
  return { exitCode: 0 }
}

// Invoked directly via `tsx src/cli/create-key.ts`; tests import the function.
if (process.argv[1]?.endsWith('create-key.ts') || process.argv[1]?.endsWith('create-key.js')) {
  const { db, sql } = createClient({ maxConnections: 1 })
  try {
    const { exitCode } = await createKeyCommand(db, process.argv.slice(2))
    process.exitCode = exitCode
  } finally {
    await sql.end()
  }
}
