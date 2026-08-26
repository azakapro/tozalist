#!/usr/bin/env node
/**
 * Load benchmark (roadmap 8.1): POST /v1/email/check at a target 100 rps for
 * 2 minutes, in two variants:
 *   - cache-miss: every request checks a UNIQUE address (full engine round trip)
 *   - cache-hit:  every request checks the SAME address (one charge, then 7d cache)
 *
 * Percentiles (incl. the exact p95 the roadmap requires) are computed here
 * from the raw per-response latency samples autocannon emits, not from its
 * fixed-percentile summary - so p95 is a real measured value, never an
 * estimate.
 *
 * Usage:  node bench/run-bench.mjs <api-url> <tzl_live_key> [duration-seconds]
 * Output: one JSON line per variant. The key is an argument, never printed.
 */
import autocannon from 'autocannon'

const [apiUrl, apiKey, durationArg] = process.argv.slice(2)
if (!apiUrl || !apiKey) {
  console.error('usage: node bench/run-bench.mjs <api-url> <tzl_live_key> [duration-seconds]')
  process.exit(2)
}
const duration = Number(durationArg ?? 120)

/** Exact percentile from raw samples: nearest-rank on the sorted array. */
function percentile(sortedMs, fraction) {
  if (sortedMs.length === 0) return null
  const rank = Math.ceil(fraction * sortedMs.length)
  return sortedMs[Math.min(sortedMs.length - 1, Math.max(0, rank - 1))]
}

async function run(name, requests) {
  const samples = []
  const instance = autocannon({
    url: apiUrl,
    requests,
    duration,
    connections: 20,
    overallRate: 100,
  })
  // Every completed response reports its latency in ms.
  instance.on('response', (_client, _status, _bytes, responseTimeMs) => {
    samples.push(responseTimeMs)
  })
  const result = await new Promise((resolve, reject) => {
    instance.on('done', resolve)
    instance.on('error', reject)
  })

  samples.sort((a, b) => a - b)
  const summary = {
    variant: name,
    duration_s: duration,
    target_rps: 100,
    achieved_rps: Number(result.requests.average.toFixed(1)),
    total_requests: result.requests.total,
    samples: samples.length,
    non2xx: result.non2xx,
    errors: result.errors,
    timeouts: result.timeouts,
    latency_ms: {
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
      max: samples.length > 0 ? samples[samples.length - 1] : null,
    },
  }
  console.log(JSON.stringify(summary))
  return summary
}

const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
const requestFor = (email) => ({
  method: 'POST',
  path: '/v1/email/check',
  headers,
  body: JSON.stringify({ email }),
})

const runId = Date.now().toString(36)
const missRequests = Array.from({ length: Math.ceil(duration * 110) }, (_, index) =>
  requestFor(`user-${runId}-${index}@bench-tozalist.example`),
)

console.error(`# cache-miss variant (${duration}s)`)
await run('cache-miss', missRequests)
console.error(`# cache-hit variant (${duration}s)`)
await run('cache-hit', [requestFor(`steady-${runId}@bench-tozalist.example`)])
