import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { ZipFile } from 'yazl'
import {
  pageAuditEventsForExport,
  pageBatchesForExport,
  pageEmailChecksForExport,
  pageLedgerForExport,
  pagePhoneChecksForExport,
  type DatabaseClient,
  type ExportPager,
} from '@tozalist/db'
import { exportObjectKey, type ObjectStorage } from '@tozalist/shared'

/** Signed export links live exactly 24 hours (roadmap 7.1). */
export const EXPORT_LINK_TTL_SECONDS = 24 * 60 * 60

/**
 * Neutralizes spreadsheet formula injection: a customer-controlled cell whose
 * text begins with =, +, -, @ (or a stray tab/CR) would otherwise execute as
 * a formula when the CSV is opened in Excel/LibreOffice/Sheets. The standard
 * mitigation is a leading apostrophe, which those programs strip for display.
 * Applied to string cells only - numbers and booleans we render ourselves
 * (deltas, counts, flags) are not attacker-controlled and must stay numeric.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

/** Minimal CSV escaping: quote cells containing separators, quotes or newlines. */
function toCsvLine(cells: Array<string | number | boolean | null>): string {
  return (
    cells
      .map((cell) => {
        const text =
          typeof cell === 'string' ? neutralizeFormula(cell) : cell === null ? '' : String(cell)
        if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
        return text
      })
      .join(',') + '\n'
  )
}

type CsvSpec<T extends { id: string }> = {
  filename: string
  header: string[]
  pager: ExportPager<T>
  row: (item: T) => Array<string | number | boolean | null>
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString())

function categories(db: DatabaseClient, orgId: string): Array<CsvSpec<{ id: string }>> {
  const specs = [
    {
      filename: 'email_checks.csv',
      header: [
        'id',
        'email',
        'verdict',
        'reason_codes',
        'cached',
        'credits_used',
        'created_at',
        'expires_at',
      ],
      pager: pageEmailChecksForExport(db, orgId),
      row: (check) => [
        check.id,
        check.emailNormalized,
        check.verdict,
        check.reasonCodes.join('|'),
        check.cached,
        check.creditsUsed,
        iso(check.createdAt),
        iso(check.expiresAt),
      ],
    } satisfies CsvSpec<
      Awaited<ReturnType<ReturnType<typeof pageEmailChecksForExport>>>['rows'][number]
    >,
    {
      filename: 'phone_checks.csv',
      header: [
        'id',
        'phone_e164',
        'valid',
        'country',
        'line_type_guess',
        'reason_codes',
        'credits_used',
        'created_at',
        'expires_at',
      ],
      pager: pagePhoneChecksForExport(db, orgId),
      row: (check) => [
        check.id,
        check.e164,
        check.valid,
        check.country,
        check.lineTypeGuess,
        check.reasonCodes.join('|'),
        check.creditsUsed,
        iso(check.createdAt),
        iso(check.expiresAt),
      ],
    } satisfies CsvSpec<
      Awaited<ReturnType<ReturnType<typeof pagePhoneChecksForExport>>>['rows'][number]
    >,
    {
      filename: 'batches.csv',
      header: [
        'id',
        'filename',
        'status',
        'total_rows',
        'processed_rows',
        'error',
        'created_at',
        'completed_at',
        'expires_at',
      ],
      pager: pageBatchesForExport(db, orgId),
      row: (batch) => [
        batch.id,
        batch.filename,
        batch.status,
        batch.totalRows,
        batch.processedRows,
        batch.error,
        iso(batch.createdAt),
        iso(batch.completedAt),
        iso(batch.expiresAt),
      ],
    } satisfies CsvSpec<
      Awaited<ReturnType<ReturnType<typeof pageBatchesForExport>>>['rows'][number]
    >,
    {
      filename: 'credit_ledger.csv',
      header: ['id', 'delta', 'reason', 'reference_id', 'note', 'created_at'],
      pager: pageLedgerForExport(db, orgId),
      row: (entry) => [
        entry.id,
        entry.delta,
        entry.reason,
        entry.referenceId,
        entry.note,
        iso(entry.createdAt),
      ],
    } satisfies CsvSpec<
      Awaited<ReturnType<ReturnType<typeof pageLedgerForExport>>>['rows'][number]
    >,
    {
      filename: 'audit_events.csv',
      header: ['id', 'action', 'target_type', 'target_id', 'metadata', 'created_at'],
      pager: pageAuditEventsForExport(db, orgId),
      row: (event) => [
        event.id,
        event.action,
        event.targetType,
        event.targetId,
        JSON.stringify(event.metadata),
        iso(event.createdAt),
      ],
    } satisfies CsvSpec<
      Awaited<ReturnType<ReturnType<typeof pageAuditEventsForExport>>>['rows'][number]
    >,
  ]
  return specs as unknown as Array<CsvSpec<{ id: string }>>
}

export type ExportResult = {
  exportId: string
  /** Signed download URL - MUST never be logged or audited. */
  url: string
  expiresAt: Date
}

/**
 * Streams one organisation's data into a ZIP of CSVs directly to object
 * storage, then signs a 24-hour download link. Entries are pumped one at a
 * time and every write honors backpressure, so memory stays flat no matter
 * how many rows the organisation has.
 */
export async function buildOrgDataExport(
  deps: { db: DatabaseClient; storage: ObjectStorage },
  orgId: string,
  now: Date = new Date(),
): Promise<ExportResult> {
  const exportId = randomUUID()
  const key = exportObjectKey(orgId, now.getTime(), exportId)

  const zip = new ZipFile()
  // yazl's stream types predate node's; piping through a PassThrough gives the
  // uploader a genuine Readable without casts.
  const output = new PassThrough()
  zip.outputStream.pipe(output)
  const uploadDone = deps.storage.uploadStream(key, output, 'application/zip')

  for (const spec of categories(deps.db, orgId)) {
    const entry = new PassThrough()
    zip.addReadStream(entry, spec.filename)
    const write = async (line: string): Promise<void> => {
      if (!entry.write(line)) await once(entry, 'drain')
    }
    await write(toCsvLine(spec.header))
    let afterId: string | null = null
    do {
      const page = await spec.pager(afterId)
      for (const item of page.rows) await write(toCsvLine(spec.row(item)))
      afterId = page.nextAfterId
    } while (afterId !== null)
    entry.end()
  }
  zip.end()
  await uploadDone

  const url = await deps.storage.presignDownload(key, EXPORT_LINK_TTL_SECONDS)
  return { exportId, url, expiresAt: new Date(now.getTime() + EXPORT_LINK_TTL_SECONDS * 1000) }
}
