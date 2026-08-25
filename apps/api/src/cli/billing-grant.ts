import { parseArgs } from 'node:util'
import { createClient, grantCreditsWithAudit, type DatabaseClient } from '@tozalist/db'

/**
 * pnpm billing:grant --org <organization-uuid> --credits <n> --note "Invoice INV-001 paid 2026-09-01"
 *
 * One additive credit-ledger grant plus its audit event, atomically. The
 * reference is derived from (credits, note), so replaying the identical
 * command cannot grant twice. Prints only the result - never connection
 * details or credentials.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CliResult = { exitCode: number }

export async function billingGrantCommand(
  db: DatabaseClient,
  args: string[],
  print: (line: string) => void = console.log,
): Promise<CliResult> {
  let org: string | undefined
  let credits: string | undefined
  let note: string | undefined
  try {
    const parsed = parseArgs({
      args,
      options: {
        org: { type: 'string' },
        credits: { type: 'string' },
        note: { type: 'string' },
      },
      strict: true,
    })
    org = parsed.values.org
    credits = parsed.values.credits
    note = parsed.values.note
  } catch {
    print('usage: pnpm billing:grant --org <organization-uuid> --credits <n> --note "..."')
    return { exitCode: 2 }
  }

  if (org === undefined || !UUID_PATTERN.test(org)) {
    print('error: --org must be a valid organization UUID')
    return { exitCode: 2 }
  }
  const amount = Number(credits)
  if (credits === undefined || !Number.isSafeInteger(amount) || amount <= 0) {
    print('error: --credits must be a positive whole number')
    return { exitCode: 2 }
  }
  if (note === undefined || note.trim() === '') {
    print('error: --note is required (e.g. "Invoice INV-001 paid 2026-09-01")')
    return { exitCode: 2 }
  }

  const result = await grantCreditsWithAudit(db, {
    orgId: org.toLowerCase(),
    credits: amount,
    note: note.trim(),
  })
  if (!result.ok) {
    const messages = {
      // Defensive: the helper re-validates on its own; reaching invalid_input
      // here means the CLI's checks and the helper's disagree - still safe.
      invalid_input: 'error: the grant input was rejected - nothing was granted',
      org_not_found: 'error: organization not found',
      org_deleted: 'error: organization is deleted',
      duplicate_reference:
        'error: an identical grant (same credits and note) already exists - nothing was granted',
    } as const
    print(messages[result.reason])
    return { exitCode: 1 }
  }

  print('Credits granted')
  print(`  org:        ${org.toLowerCase()}`)
  print(`  credits:    +${amount}`)
  print(`  ledger id:  ${result.ledgerId}`)
  print(`  reference:  ${result.referenceId}`)
  return { exitCode: 0 }
}

// Invoked directly via `tsx src/cli/billing-grant.ts`; tests import the function.
if (
  process.argv[1]?.endsWith('billing-grant.ts') ||
  process.argv[1]?.endsWith('billing-grant.js')
) {
  const { db, sql } = createClient({ maxConnections: 1 })
  try {
    const { exitCode } = await billingGrantCommand(db, process.argv.slice(2))
    process.exitCode = exitCode
  } finally {
    await sql.end()
  }
}
