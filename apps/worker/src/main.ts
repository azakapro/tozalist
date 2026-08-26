import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import pino from 'pino'
import { createClient } from '@tozalist/db'
import {
  assertRequiredEnv,
  createObjectStorage,
  EngineClient,
  readS3Config,
  redactedLoggerOptions,
} from '@tozalist/shared'
import { buildConnectionOptions } from './connection.js'
import { readWorkerConfig } from './config.js'
import { buildBatchWorker } from './batch/worker.js'
import { buildLifecycleWorker, scheduleLifecycleSweep } from './lifecycle/worker.js'
import {
  buildWorkerMetrics,
  instrumentEngine,
  instrumentWorker,
  startMetricsServer,
  trackQueueDepth,
} from './metrics.js'
import { buildWebhookPublisher, buildWebhookWorker } from './webhooks/worker.js'
import { DomainCircuit } from './smtp/domain-circuit.js'
import { MxThrottle } from './smtp/throttle.js'
import { buildSmtpWorker, shutdownWorker } from './smtp/worker.js'
import type { EngineVerifier } from './smtp/types.js'

/**
 * Worker entrypoint: the smtp-probe queue consumer.
 *
 * Every log line is structured JSON. Job payloads carry only row IDs; emails
 * are loaded from PostgreSQL at processing time and never logged.
 */
// Redaction is mandatory: secret-key censoring + deep email scrubbing.
// Fail fast, listing every missing variable at once (roadmap 8.1).
assertRequiredEnv(['DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'])

const logger = pino({ base: null, ...redactedLoggerOptions() })
const config = readWorkerConfig()
const connectionOptions = buildConnectionOptions(config.redisUrl)

// lazyConnect belongs to this client, not to the shared options: BullMQ opens
// and owns its own connections. Connecting explicitly means "worker ready" is
// only logged after Redis has actually answered.
const redis = new Redis({ ...connectionOptions, lazyConnect: true })
const { db, sql } = createClient()

const metrics = buildWorkerMetrics()

let engine: EngineVerifier | undefined
const getEngine = (): EngineVerifier => {
  // Instantiated on first use only: with SMTP disabled it never exists.
  engine ??= instrumentEngine(new EngineClient(), metrics)
  return engine
}

let shuttingDown = false

redis.on('error', (error: Error) => {
  if (shuttingDown) return
  // Only the error class name: a raw Redis error message can echo connection
  // details, including credentials embedded in the URL.
  logger.error({ error_name: error.name }, 'worker redis error')
})

await redis.connect()
await redis.ping()

const storage = createObjectStorage(readS3Config())
const webhookPublisher = buildWebhookPublisher(connectionOptions)

const batchWorker = buildBatchWorker({
  connection: connectionOptions,
  deps: { db, storage, engine: getEngine(), logger, webhookPublisher },
})

const webhookWorker = buildWebhookWorker({
  connection: connectionOptions,
  deps: { db, logger, metrics },
})

// Hourly retention sweep. Registration is idempotent across worker restarts.
const lifecycleWorker = buildLifecycleWorker({
  connection: connectionOptions,
  deps: { db, storage, logger, now: () => new Date() },
})
await scheduleLifecycleSweep(connectionOptions)

const worker = buildSmtpWorker({
  connection: connectionOptions,
  concurrency: config.smtpWorkerConcurrency,
  deps: {
    db,
    throttle: new MxThrottle({ redis }),
    circuit: new DomainCircuit({ redis }),
    logger,
    smtpEnabled: config.smtpEnabled,
    getEngine,
    metrics,
  },
})

// Prometheus: job outcomes/durations per queue, queue depth at scrape time,
// and the /metrics scrape server on its own local port.
instrumentWorker(worker, 'smtp-probe', metrics)
instrumentWorker(batchWorker, 'batch-process', metrics)
instrumentWorker(webhookWorker, 'webhook-deliver', metrics)
instrumentWorker(lifecycleWorker, 'lifecycle-purge', metrics)
const depthQueues = ['smtp-probe', 'batch-process', 'webhook-deliver', 'lifecycle-purge'].map(
  (name) => ({ name, queue: new Queue(name, { connection: connectionOptions }) }),
)
trackQueueDepth(metrics, depthQueues)
const metricsServer = startMetricsServer(metrics.registry, config.metricsPort, config.metricsHost)
logger.info(
  { metrics_port: config.metricsPort, metrics_host: config.metricsHost },
  'metrics server listening',
)

console.log('worker ready')
logger.info(
  {
    queues: ['smtp-probe', 'batch-process', 'webhook-deliver', 'lifecycle-purge'],
    concurrency: config.smtpWorkerConcurrency,
    smtp_enabled: config.smtpEnabled,
  },
  'worker ready',
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shuttingDown = true
    void (async () => {
      const drain = await shutdownWorker(worker, logger, 30_000)
      await batchWorker.close().catch(() => undefined)
      await webhookWorker.close().catch(() => undefined)
      await lifecycleWorker.close().catch(() => undefined)
      metricsServer.close()
      await Promise.allSettled(depthQueues.map(({ queue }) => queue.close()))
      await webhookPublisher.close().catch(() => undefined)
      storage.close()
      await Promise.allSettled([redis.quit(), sql.end()])
      logger.info({ drain }, 'worker shut down')
      process.exit(drain === 'drained' ? 0 : 1)
    })()
  })
}
