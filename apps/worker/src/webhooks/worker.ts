import { Queue, Worker } from 'bullmq'
import type { RedisOptions } from 'bullmq'
import { WEBHOOK_DELIVER_QUEUE, type WebhookDeliverJobData } from '@tozalist/shared'
import { createWebhookProcessor, type WebhookProcessorDeps } from './processor.js'
import type { WebhookJobPublisher } from './emit.js'

export function buildWebhookWorker(options: {
  connection: RedisOptions
  deps: WebhookProcessorDeps
  queueName?: string
  concurrency?: number
}): Worker<WebhookDeliverJobData> {
  return new Worker<WebhookDeliverJobData>(
    options.queueName ?? WEBHOOK_DELIVER_QUEUE,
    createWebhookProcessor(options.deps),
    {
      connection: options.connection,
      concurrency: options.concurrency ?? 5,
      autorun: true,
    },
  )
}

/** In-process publisher used by the batch processor to enqueue deliveries. */
export function buildWebhookPublisher(
  connection: RedisOptions,
  queueName: string = WEBHOOK_DELIVER_QUEUE,
): WebhookJobPublisher & { close(): Promise<void> } {
  const queue = new Queue<WebhookDeliverJobData>(queueName, { connection })
  return {
    async enqueue(deliveryId: string): Promise<void> {
      await queue.add('deliver', { deliveryId }, { removeOnComplete: 1000, removeOnFail: 1000 })
    },
    async close(): Promise<void> {
      await queue.close()
    },
  }
}
