/**
 * Bench-only API server: identical production wiring EXCEPT the per-key rate
 * limiter, which is raised far above the 100 rps target. The production
 * limiter (100 requests / 10 s per key) is a product policy that would cap a
 * capacity benchmark at 10 rps by design; raising it here measures what the
 * service itself can do. Never deployed - run by hand from apps/api.
 */
import { Redis } from 'ioredis'
import { EngineClient, createObjectStorage, readS3Config } from '@tozalist/shared'
import { createClient } from '@tozalist/db'
import { buildApp } from '../src/app.js'
import { readApiConfig } from '../src/config.js'
import { createBatchQueuePublisher, createSmtpQueuePublisher } from '../src/smtp-queue.js'

const config = readApiConfig()
const { db } = createClient()
const redis = new Redis(config.redisUrl)

const app = buildApp({
  logger: true,
  deps: {
    db,
    redis,
    engine: new EngineClient(),
    smtpQueue: createSmtpQueuePublisher(config.redisUrl),
    batchQueue: createBatchQueuePublisher(config.redisUrl),
    storage: createObjectStorage(readS3Config()),
    smtpEnabled: false,
    rateLimit: { limit: 1_000_000, keyPrefix: 'bench:rl:' },
  },
})

await app.listen({ port: Number(process.env.BENCH_PORT ?? 3011), host: '127.0.0.1' })
console.log('bench api listening')
