import { Queue, Worker } from 'bullmq'
import type { RedisOptions } from 'bullmq'
import { LIFECYCLE_PURGE_QUEUE } from '@tozalist/shared'
import { runLifecycleSweep, type LifecycleDeps } from './processor.js'

/** The sweep runs at the top of every hour. */
export const LIFECYCLE_CRON = '0 * * * *'

export function buildLifecycleWorker(options: {
  connection: RedisOptions
  deps: LifecycleDeps
  queueName?: string
}): Worker {
  return new Worker(
    options.queueName ?? LIFECYCLE_PURGE_QUEUE,
    async () => {
      await runLifecycleSweep(options.deps)
    },
    {
      connection: options.connection,
      // Two sweeps must never overlap; one at a time is plenty for an hourly job.
      concurrency: 1,
      autorun: true,
    },
  )
}

/**
 * Registers the hourly repeatable job. BullMQ deduplicates by repeat options,
 * so calling this on every worker boot is idempotent.
 */
export async function scheduleLifecycleSweep(
  connection: RedisOptions,
  queueName: string = LIFECYCLE_PURGE_QUEUE,
): Promise<void> {
  const queue = new Queue(queueName, { connection })
  try {
    await queue.add(
      'sweep',
      {},
      {
        repeat: { pattern: LIFECYCLE_CRON },
        removeOnComplete: 24,
        removeOnFail: 24,
      },
    )
  } finally {
    await queue.close()
  }
}
