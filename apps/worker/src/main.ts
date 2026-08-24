import { Redis } from 'ioredis'
import { buildConnectionOptions } from './connection.js'
import { readWorkerConfig } from './config.js'

/**
 * Worker entrypoint.
 *
 * Scope note (step 0.1): this process establishes the Redis connection that
 * BullMQ workers will be attached to, then stays alive. It registers no queues
 * and processes no jobs yet.
 */
const config = readWorkerConfig()

// lazyConnect belongs to this client, not to the shared options: BullMQ opens
// and owns its own connections. Connecting explicitly means "worker ready" is
// only logged after Redis has actually answered.
const connection = new Redis({ ...buildConnectionOptions(config.redisUrl), lazyConnect: true })

let shuttingDown = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shuttingDown = true
    void connection.quit().then(() => process.exit(0))
  })
}

connection.on('error', (error: Error) => {
  if (shuttingDown) return
  // The connection string itself is never logged - it may contain a password.
  console.error(`worker redis error: ${error.message}`)
})

await connection.connect()
await connection.ping()
console.log('worker ready')
