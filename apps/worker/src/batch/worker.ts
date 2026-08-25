import { Worker } from 'bullmq'
import type { RedisOptions } from 'bullmq'
import { BATCH_PROCESS_QUEUE, type BatchProcessJobData } from '@tozalist/shared'
import { createBatchProcessor, type BatchProcessorDeps } from './processor.js'

/** Batches are heavy; a small fixed concurrency keeps memory bounded. */
export const BATCH_WORKER_CONCURRENCY = 2

export function buildBatchWorker(options: {
  connection: RedisOptions
  deps: BatchProcessorDeps
  queueName?: string
  concurrency?: number
}): Worker<BatchProcessJobData> {
  return new Worker<BatchProcessJobData>(
    options.queueName ?? BATCH_PROCESS_QUEUE,
    createBatchProcessor(options.deps),
    {
      connection: options.connection,
      concurrency: options.concurrency ?? BATCH_WORKER_CONCURRENCY,
      autorun: true,
    },
  )
}
