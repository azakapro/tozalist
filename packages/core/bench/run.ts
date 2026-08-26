import { buildCorpus, CORPUS_SIZE } from './corpus.js'
import {
  EMAIL_REASON_CODES,
  precision,
  recall,
  scoreCorpus,
  VERDICTS,
  type ReasonMetric,
} from './score.js'

/**
 * `pnpm core:bench` - the accuracy-regression gate (roadmap 8.2).
 *
 * Runs the real aggregation pipeline over the deterministic synthetic corpus,
 * prints a verdict confusion matrix and per-reason-code precision/recall, and
 * exits NON-ZERO on ANY mismatch. Because the corpus is synthetic and labelled
 * independently of the pipeline, correctness must be 100%: this measures LOGIC
 * CORRECTNESS, not real-world deliverability accuracy (see bench/README.md).
 */

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

function fmtRatio(value: number | null): string {
  return value === null ? '  n/a' : `${(value * 100).toFixed(1)}%`
}

function main(): void {
  const corpus = buildCorpus()
  const result = scoreCorpus(corpus)

  console.log(`\nAccuracy regression corpus - ${result.total} synthetic fixtures\n`)

  if (result.total !== CORPUS_SIZE) {
    console.error(`FAIL: corpus size is ${result.total}, expected exactly ${CORPUS_SIZE}.`)
    process.exit(1)
  }

  // Confusion matrix: rows = expected verdict, columns = actual verdict.
  console.log('Verdict confusion matrix (rows = expected, columns = actual):')
  console.log('  ' + pad('exp \\ act', 12) + VERDICTS.map((v) => pad(v, 9)).join(''))
  for (const expected of VERDICTS) {
    const row = VERDICTS.map((actual) => pad(String(result.confusion[expected][actual]), 9)).join(
      '',
    )
    console.log('  ' + pad(expected, 12) + row)
  }

  // Per-reason-code precision / recall.
  console.log('\nPer-reason-code precision / recall:')
  console.log(
    '  ' +
      pad('reason code', 22) +
      pad('TP', 5) +
      pad('FP', 5) +
      pad('FN', 5) +
      pad('precision', 11) +
      'recall',
  )
  for (const code of EMAIL_REASON_CODES) {
    const metric = result.reasonMetrics.find((m) => m.code === code) as ReasonMetric
    console.log(
      '  ' +
        pad(code, 22) +
        pad(String(metric.tp), 5) +
        pad(String(metric.fp), 5) +
        pad(String(metric.fn), 5) +
        pad(fmtRatio(precision(metric)), 11) +
        fmtRatio(recall(metric)),
    )
  }

  console.log(`\n${result.passed}/${result.total} fixtures matched exactly.`)

  if (result.mismatches.length > 0) {
    console.error(`\nFAIL: ${result.mismatches.length} mismatch(es):`)
    for (const mismatch of result.mismatches.slice(0, 25)) {
      console.error(
        `  [${mismatch.category}] ${mismatch.email}\n` +
          `    verdict expected=${mismatch.expectedVerdict} actual=${mismatch.actualVerdict}\n` +
          `    reasons expected=[${mismatch.expectedReasonCodes.join(', ')}] ` +
          `actual=[${mismatch.actualReasonCodes.join(', ')}]`,
      )
    }
    if (result.mismatches.length > 25) {
      console.error(`  ... and ${result.mismatches.length - 25} more.`)
    }
    process.exit(1)
  }

  console.log('\nPASS: 100% logic correctness on the synthetic corpus.')
}

main()
