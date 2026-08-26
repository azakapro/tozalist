import { MetricsRegistry, type Counter, type Histogram } from '@tozalist/shared'

/**
 * API metrics (roadmap 8.1), exposed at GET /metrics in Prometheus text
 * format. One registry per app instance so parallel test apps never collide.
 * Label values are always closed sets - route patterns, methods, statuses,
 * fixed outcome strings - never request data.
 */
export type ApiMetrics = {
  registry: MetricsRegistry
  httpRequests: Counter
  httpDuration: Histogram
  cacheEvents: Counter
  creditsSpent: Counter
  engineCalls: Counter
  engineDuration: Histogram
}

export function buildApiMetrics(): ApiMetrics {
  const registry = new MetricsRegistry()
  return {
    registry,
    httpRequests: registry.counter(
      'tozalist_http_requests_total',
      'HTTP requests by route pattern, method, and status code.',
    ),
    httpDuration: registry.histogram(
      'tozalist_http_request_duration_seconds',
      'HTTP request latency by route pattern, method, and status code.',
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    ),
    cacheEvents: registry.counter(
      'tozalist_check_cache_events_total',
      'Email-check cache lookups by result (hit or miss).',
    ),
    creditsSpent: registry.counter(
      'tozalist_credits_spent_total',
      'Credits debited, by kind (single_check, phone_check).',
    ),
    engineCalls: registry.counter(
      'tozalist_engine_calls_total',
      'Engine verify calls from the API, by outcome (ok or error).',
    ),
    engineDuration: registry.histogram(
      'tozalist_engine_call_duration_seconds',
      'Engine verify latency from the API.',
      [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    ),
  }
}
