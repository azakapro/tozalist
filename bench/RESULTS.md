# Benchmark results — POST /v1/email/check

Recorded 2026-08-25 (roadmap 8.1). Reproduce with:

```
pnpm --filter @tozalist/api exec tsx bench/server.mts   # bench API on :3011
node bench/run-bench.mjs http://127.0.0.1:3011 <tzl_live_key> 120
```

## Machine and setup

|             |                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CPU         | Apple M1 Pro (10 cores)                                                                                                                                                                                                        |
| Memory      | 16 GB                                                                                                                                                                                                                          |
| OS          | macOS 27.0                                                                                                                                                                                                                     |
| Node        | v22.22.0                                                                                                                                                                                                                       |
| Services    | PostgreSQL 16, Redis 7, MinIO, engine sidecar — all in local Docker                                                                                                                                                            |
| Server      | bench/server.mts: production wiring, SMTP disabled, per-key rate limiter raised (production policy is 100 req/10 s per key, which by design caps a single key at 10 rps; the bench measures service capacity past that policy) |
| Load        | autocannon 8.0.0 — 20 connections, overallRate 100 rps, 120 s per variant                                                                                                                                                      |
| Percentiles | computed here from every per-response latency sample autocannon emits (nearest-rank); p95 is a real measured value, not an interpolation or estimate                                                                           |

## Results (2 minutes at a sustained 100 rps each)

| Variant                                                         | Requests | Errors | non-2xx | p50     | **p95**     | p99     | max     |
| --------------------------------------------------------------- | -------- | ------ | ------- | ------- | ----------- | ------- | ------- |
| cache-miss (unique address per request; full engine round trip) | 12046    | 0      | 0       | 9.4 ms  | **34.2 ms** | 48.7 ms | 1829 ms |
| cache-hit (same address; 7-day cache)                           | 12000    | 0      | 0       | 12.0 ms | **27.9 ms** | 33.2 ms | 93 ms   |

Notes:

- p50/p95/p99 are exact nearest-rank percentiles over all 12046 (miss)
  and 12000 (hit) per-response latency samples — not autocannon's
  fixed-percentile summary.
- Every request in both variants returned 2xx: zero errors, zero timeouts,
  zero rate-limit rejections (limiter raised for the run as noted above).
- The cache-miss max tail comes from the engine round trip plus the
  deliberate FOR UPDATE serialization of credit debits per organisation — a
  single-org benchmark is that lock's worst case; real traffic spreads across
  orgs. p95 stays well within interactive range.
- Bench data was synthetic (bench-*.example addresses in the local dev
  database, carrying normal retention expiry).
