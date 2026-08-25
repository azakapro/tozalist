import { Queue } from 'bullmq'
import {
  BATCH_PROCESS_QUEUE,
  buildRedisConnectionOptions,
  SMTP_PROBE_QUEUE,
  type BatchProcessJobData,
  type SmtpProbeJobData,
} from '@tozalist/shared'
import type { BatchQueuePublisher, SmtpQueuePublisher } from './types.js'

/**
 * The production SMTP job publisher: a thin BullMQ queue wrapper. Payloads
 * carry only the check UUID; job options keep completed jobs from piling up.
 *
 * Connection options come from the same shared parser the worker uses, so
 * database index, credentials and TLS can never drift between the process
 * that enqueues and the process that consumes.
 */
export function createSmtpQueuePublisher(
  redisUrl: string,
  queueName: string = SMTP_PROBE_QUEUE,
): SmtpQueuePublisher {
  const queue = new Queue<SmtpProbeJobData>(queueName, {
    connection: buildRedisConnectionOptions(redisUrl),
  })

  return {
    async enqueue(emailCheckId: string): Promise<void> {
      await queue.add('probe', { emailCheckId }, { removeOnComplete: 1000, removeOnFail: 1000 })
    },
    async close(): Promise<void> {
      await queue.close()
    },
  }
}

/** The production batch-process publisher; same connection parser, same rules. */
export function createBatchQueuePublisher(
  redisUrl: string,
  queueName: string = BATCH_PROCESS_QUEUE,
): BatchQueuePublisher {
  const queue = new Queue<BatchProcessJobData>(queueName, {
    connection: buildRedisConnectionOptions(redisUrl),
  })

  return {
    async enqueue(batchId: string): Promise<void> {
      await queue.add('process', { batchId }, { removeOnComplete: 1000, removeOnFail: 1000 })
    },
    async close(): Promise<void> {
      await queue.close()
    },
  }
}
