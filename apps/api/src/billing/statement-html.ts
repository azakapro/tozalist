import type { MonthlyStatement } from '@tozalist/db'

/** Standard HTML entity escaping; ledger notes are operator-entered text. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const REASON_LABELS: Record<string, string> = {
  grant: 'Credit grant',
  single_check: 'Single check',
  batch_check: 'Batch reservation',
  refund: 'Refund',
  adjustment: 'Adjustment',
}

/**
 * Renders a self-contained monthly statement page. Content comes from the
 * ledger only; the org is identified by id, never by name (the statement can
 * outlive a rename, and the file must carry no more identity than needed).
 */
export function renderStatementHtml(orgId: string, statement: MonthlyStatement): string {
  const rows = statement.entries
    .map(
      (entry) => `      <tr>
        <td>${entry.createdAt.toISOString()}</td>
        <td>${escapeHtml(REASON_LABELS[entry.reason] ?? entry.reason)}</td>
        <td>${entry.delta > 0 ? '+' : ''}${entry.delta}</td>
        <td>${escapeHtml(entry.note ?? '')}</td>
      </tr>`,
    )
    .join('\n')

  const summaryRows: Array<[string, number]> = [
    ['Opening balance', statement.openingBalance],
    ['Credits granted', statement.creditsGranted],
    ['Credits consumed (checks charged)', statement.creditsConsumed],
    ['Credits refunded', statement.creditsRefunded],
    ['Adjustments', statement.adjustments],
    ['Closing balance', statement.closingBalance],
  ]

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TozaList statement ${escapeHtml(statement.month)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; color: #0f172a; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; font-size: 14px; }
  th { background: #f1f5f9; }
  .meta { color: #475569; font-size: 13px; }
</style>
</head>
<body>
  <h1>TozaList — Monthly statement</h1>
  <p class="meta">Organization: ${escapeHtml(orgId)}<br>Month: ${escapeHtml(statement.month)} (UTC)</p>
  <h2>Summary</h2>
  <table>
${summaryRows
  .map(([label, value]) => `      <tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>`)
  .join('\n')}
      <tr><th>Batches run</th><td>${statement.batchesRun}</td></tr>
  </table>
  <h2>Ledger entries</h2>
  <table>
    <thead>
      <tr><th>When (UTC)</th><th>Type</th><th>Credits</th><th>Note</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="meta">Balances are credits, not currency. Generated from the append-only credit ledger.</p>
</body>
</html>
`
}
