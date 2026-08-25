import { Readable } from 'node:stream'
import { parseArgs } from 'node:util'
import { eq } from 'drizzle-orm'
import {
  createClient,
  getMonthlyStatement,
  organizations,
  parseStatementMonth,
  type DatabaseClient,
} from '@tozalist/db'
import {
  createObjectStorage,
  readS3Config,
  statementObjectKey,
  type ObjectStorage,
} from '@tozalist/shared'
import { renderStatementHtml } from '../billing/statement-html.js'

/**
 * pnpm billing:statement --org <organization-uuid> --month YYYY-MM
 *
 * Renders the month's HTML statement from the credit ledger and stores it at
 * org/{orgId}/statements/{month}.html. Customers download it from /billing
 * through a time-limited signed link; this command never prints URLs,
 * credentials, or connection details - only the object key.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CliResult = { exitCode: number }

export async function billingStatementCommand(
  db: DatabaseClient,
  storage: ObjectStorage,
  args: string[],
  print: (line: string) => void = console.log,
): Promise<CliResult> {
  let org: string | undefined
  let month: string | undefined
  try {
    const parsed = parseArgs({
      args,
      options: { org: { type: 'string' }, month: { type: 'string' } },
      strict: true,
    })
    org = parsed.values.org
    month = parsed.values.month
  } catch {
    print('usage: pnpm billing:statement --org <organization-uuid> --month YYYY-MM')
    return { exitCode: 2 }
  }

  if (org === undefined || !UUID_PATTERN.test(org)) {
    print('error: --org must be a valid organization UUID')
    return { exitCode: 2 }
  }
  if (month === undefined || parseStatementMonth(month) === null) {
    print('error: --month must be a real calendar month in YYYY-MM form')
    return { exitCode: 2 }
  }
  const orgId = org.toLowerCase()

  const [organisation] = await db
    .select({ id: organizations.id, deletedAt: organizations.deletedAt })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  if (organisation === undefined) {
    print('error: organization not found')
    return { exitCode: 1 }
  }
  if (organisation.deletedAt !== null) {
    print('error: organization is deleted')
    return { exitCode: 1 }
  }

  const statement = await getMonthlyStatement(db, orgId, month)
  if (statement === null) {
    print('error: --month must be a real calendar month in YYYY-MM form')
    return { exitCode: 2 }
  }

  const key = statementObjectKey(orgId, month)
  await storage.uploadStream(
    key,
    Readable.from([renderStatementHtml(orgId, statement)]),
    'text/html',
  )

  print('Statement stored')
  print(`  org:      ${orgId}`)
  print(`  month:    ${month}`)
  print(`  entries:  ${statement.entries.length}`)
  print(`  closing:  ${statement.closingBalance}`)
  print(`  object:   ${key}`)
  print('Customers can download it from the dashboard /billing page.')
  return { exitCode: 0 }
}

// Invoked directly via `tsx src/cli/billing-statement.ts`; tests import the function.
if (
  process.argv[1]?.endsWith('billing-statement.ts') ||
  process.argv[1]?.endsWith('billing-statement.js')
) {
  const { db, sql } = createClient({ maxConnections: 1 })
  const storage = createObjectStorage(readS3Config())
  try {
    await storage.ensureBucket()
    const { exitCode } = await billingStatementCommand(db, storage, process.argv.slice(2))
    process.exitCode = exitCode
  } finally {
    storage.close()
    await sql.end()
  }
}
