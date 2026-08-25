import type { Readable } from 'node:stream'
import { parse } from 'csv-parse'

/**
 * Streaming CSV inspection for uploads: detects the email column, counts data
 * rows, and never holds more than the 50-row detection sample in memory.
 */

export const MAX_BATCH_ROWS = 100_000

/** Header names that identify the email column, compared case-insensitively. */
const EMAIL_HEADER_NAMES = new Set([
  'email',
  'e-mail',
  'mail',
  'email_address',
  'pochta',
  'elektron pochta',
])

const DETECTION_SAMPLE_ROWS = 50

export type CsvInspection =
  | { ok: true; emailColumn: number; hasHeader: boolean; totalRows: number }
  | { ok: false; reason: 'empty' | 'no_email_column' | 'too_many_rows' }

/** Consumes the stream fully (so a tee'd upload can finish) and inspects it. */
export async function inspectCsv(stream: Readable): Promise<CsvInspection> {
  const parser = stream.pipe(
    parse({ bom: true, relaxColumnCount: true, relaxQuotes: true, skipEmptyLines: true }),
  )

  let first: string[] | null = null
  const sample: string[][] = []
  let records = 0

  for await (const record of parser as AsyncIterable<string[]>) {
    records += 1
    if (first === null) first = record
    if (sample.length < DETECTION_SAMPLE_ROWS) sample.push(record)
    if (records > MAX_BATCH_ROWS + 1) {
      // Definitely over the cap either way; drain the rest without storing.
      continue
    }
  }

  if (first === null || records === 0) return { ok: false, reason: 'empty' }

  const headerIndex = first.findIndex((cell) => EMAIL_HEADER_NAMES.has(cell.trim().toLowerCase()))

  if (headerIndex >= 0) {
    const totalRows = records - 1
    if (totalRows === 0) return { ok: false, reason: 'empty' }
    if (totalRows > MAX_BATCH_ROWS) return { ok: false, reason: 'too_many_rows' }
    return { ok: true, emailColumn: headerIndex, hasHeader: true, totalRows }
  }

  // Headerless: the column with the most @-containing cells in the sample.
  const columns = Math.max(...sample.map((record) => record.length))
  let bestColumn = -1
  let bestCount = 0
  for (let column = 0; column < columns; column++) {
    let count = 0
    for (const record of sample) {
      if ((record[column] ?? '').includes('@')) count += 1
    }
    if (count > bestCount) {
      bestCount = count
      bestColumn = column
    }
  }

  if (bestColumn < 0) return { ok: false, reason: 'no_email_column' }
  if (records > MAX_BATCH_ROWS) return { ok: false, reason: 'too_many_rows' }
  return { ok: true, emailColumn: bestColumn, hasHeader: false, totalRows: records }
}
