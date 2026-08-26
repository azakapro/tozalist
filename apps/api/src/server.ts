import { Redis } from 'ioredis'
import { assertRequiredEnv } from '@tozalist/shared'
import { APP_NAME, EngineClient } from '@tozalist/shared'
import { createClient } from '@tozalist/db'
import { buildApp } from './app.js'
import { readApiConfig } from './config.js'
import { createObjectStorage, readS3Config } from '@tozalist/shared'
import { createBatchQueuePublisher, createSmtpQueuePublisher } from './smtp-queue.js'
import { ensureStorageReady, StorageNotReadyError } from './startup.js'

// Fail fast, listing every missing variable at once (roadmap 8.1).
assertRequiredEnv(['DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'])

const config = readApiConfig()
const { db, sql } = createClient()
const redis = new Redis(config.redisUrl)
const smtpQueue = createSmtpQueuePublisher(config.redisUrl)
const batchQueue = createBatchQueuePublisher(config.redisUrl)
const storage = createObjectStorage(readS3Config())

const app = buildApp({
  logger: true,
  deps: {
    db,
    redis,
    engine: new EngineClient(),
    smtpQueue,
    storage,
    batchQueue,
    smtpEnabled: config.smtpEnabled,
    ...(config.metricsToken !== null ? { metricsToken: config.metricsToken } : {}),
    ...(config.internalAuth !== null ? { internalAuth: config.internalAuth } : {}),
    webOrigin: config.webOrigin,
  },
})

if (config.internalAuth === null) {
  app.log.warn('SESSION_SECRET is not set; /internal dashboard routes are disabled')
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() =>
        Promise.allSettled([smtpQueue.close(), batchQueue.close(), redis.quit(), sql.end()]),
      )
      .then(() => {
        storage.close()
        process.exit(0)
      })
  })
}

// Fail closed BEFORE listening: no verified bucket, no upload route, no lost
// files. Only the failure class name is logged - never provider error text,
// endpoints, or credentials.
try {
  await ensureStorageReady(storage)
} catch (error) {
  app.log.error(
    { error_name: error instanceof StorageNotReadyError ? error.causeName : 'unknown' },
    'object storage is not ready; refusing to start',
  )
  process.exit(1)
}

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`${APP_NAME} api listening on port ${config.port}`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
