import { createServer, type Server } from 'node:http'
import type { Queue, Worker } from 'bullmq'
import { MetricsRegistry, type Counter, type Gauge, type Histogram } from '@tozalist/shared'
import type { EngineVerifier } from './smtp/types.js'

/**
 * Worker metrics (roadmap 8.1), served at GET /metrics on a dedicated local
 * HTTP port. All labels are closed sets (queue names, fixed outcomes) -
 * never job payloads or customer data.
 */
export type WorkerMetrics = {
  registry: MetricsRegistry
  jobDuration: Histogram
  jobOutcomes: Counter
  queueDepth: Gauge
  smtpOutcomes: Counter
  engineCalls: Counter
  engineDuration: Histogram
  webhookDeliveries: Counter
}

export function buildWorkerMetrics(): WorkerMetrics {
  const registry = new MetricsRegistry()
  return {
    registry,
    jobDuration: registry.histogram(
      'tozalist_worker_job_duration_seconds',
      'Job processing time by queue.',
      [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    ),
    jobOutcomes: registry.counter(
      'tozalist_worker_jobs_total',
      'Completed and failed jobs by queue.',
    ),
    queueDepth: registry.gauge(
      'tozalist_queue_depth',
      'Waiting + delayed + active jobs by queue, sampled at scrape time.',
    ),
    smtpOutcomes: registry.counter(
      'tozalist_smtp_probe_outcomes_total',
      'SMTP probe job outcomes by fixed outcome code.',
    ),
    engineCalls: registry.counter(
      'tozalist_engine_calls_total',
      'Engine verify calls from the worker, by outcome (ok or error).',
    ),
    engineDuration: registry.histogram(
      'tozalist_engine_call_duration_seconds',
      'Engine verify latency from the worker.',
      [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    ),
    webhookDeliveries: registry.counter(
      'tozalist_webhook_deliveries_total',
      'Webhook delivery attempts by outcome (delivered, retry_scheduled, failed).',
    ),
  }
}

/** Counts completions/failures and observes duration from BullMQ events. */
export function instrumentWorker(
  worker: Pick<Worker, 'on'>,
  queue: string,
  metrics: WorkerMetrics,
): void {
  worker.on('completed', (job) => {
    metrics.jobOutcomes.inc({ queue, outcome: 'completed' })
    if (job.finishedOn !== undefined && job.processedOn !== undefined) {
      metrics.jobDuration.observe({ queue }, (job.finishedOn - job.processedOn) / 1000)
    }
  })
  worker.on('failed', (job) => {
    metrics.jobOutcomes.inc({ queue, outcome: 'failed' })
    if (job?.finishedOn !== undefined && job.processedOn !== undefined) {
      metrics.jobDuration.observe({ queue }, (job.finishedOn - job.processedOn) / 1000)
    }
  })
}

/** Samples queue depth (waiting + delayed + active) at scrape time. */
export function trackQueueDepth(
  metrics: WorkerMetrics,
  queues: ReadonlyArray<{ name: string; queue: Pick<Queue, 'getJobCounts'> }>,
): void {
  metrics.queueDepth.onCollect(async () => {
    for (const { name, queue } of queues) {
      const counts = await queue.getJobCounts('waiting', 'delayed', 'active')
      metrics.queueDepth.set(
        { queue: name },
        (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0),
      )
    }
  })
}

/** Wraps an engine so every verify call is timed and counted. */
export function instrumentEngine(engine: EngineVerifier, metrics: WorkerMetrics): EngineVerifier {
  return {
    async verify(email, opts) {
      const started = Date.now()
      try {
        const response = await engine.verify(email, opts)
        metrics.engineDuration.observe({}, (Date.now() - started) / 1000)
        metrics.engineCalls.inc({ outcome: 'ok' })
        return response
      } catch (error) {
        metrics.engineDuration.observe({}, (Date.now() - started) / 1000)
        metrics.engineCalls.inc({ outcome: 'error' })
        throw error
      }
    },
  }
}

/**
 * A tiny scrape server: GET /metrics only, anything else 404.
 *
 * Binds to LOOPBACK by default - the scraper is expected to run on the same
 * host (or via a sidecar/tunnel). Exposing another interface is an explicit
 * deployment-time choice via METRICS_HOST, never the default.
 */
export function startMetricsServer(
  registry: MetricsRegistry,
  port: number,
  host = '127.0.0.1',
): Server {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/metrics') {
      void registry.render().then((text) => {
        response.writeHead(200, { 'Content-Type': registry.contentType })
        response.end(text)
      })
      return
    }
    response.writeHead(404)
    response.end()
  })
  server.listen(port, host)
  return server
}
