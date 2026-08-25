import { Queue, Worker } from 'bullmq'
import type { RedisOptions } from 'bullmq'
import type pino from 'pino'
import { createSmtpProbeProcessor, type ProcessorDeps } from './processor.js'
import { SMTP_PROBE_QUEUE, type SmtpProbeJobData } from './types.js'

/**
 * Wires the smtp-probe BullMQ worker.
 *
 * Note for later phases (internal extension point): result fan-out - webhook
 * events, notifications - belongs in a follow-up listener on job completion,
 * not inside the processor. Nothing is implemented here yet by design.
 */
export type SmtpWorkerOptions = {
  connection: RedisOptions
  concurrency: number
  deps: ProcessorDeps
  /** Override the queue name in tests to isolate runs. */
  queueName?: string
}

export function buildSmtpWorker(options: SmtpWorkerOptions): Worker<SmtpProbeJobData> {
  return new Worker<SmtpProbeJobData>(
    options.queueName ?? SMTP_PROBE_QUEUE,
    createSmtpProbeProcessor(options.deps),
    {
      connection: options.connection,
      concurrency: options.concurrency,
      autorun: true,
    },
  )
}

export function buildSmtpQueue(
  connection: RedisOptions,
  queueName: string = SMTP_PROBE_QUEUE,
): Queue<SmtpProbeJobData> {
  return new Queue<SmtpProbeJobData>(queueName, { connection })
}

/**
 * Graceful shutdown: stop taking new jobs, give active ones up to
 * `drainTimeoutMs`, then close connections. Returns 'drained' when everything
 * finished, 'timed_out' when the limit expired.
 */
export async function shutdownWorker(
  worker: Worker<SmtpProbeJobData>,
  logger: pino.Logger,
  drainTimeoutMs = 30_000,
): Promise<'drained' | 'timed_out'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), drainTimeoutMs)
  })

  const closed = worker.close().then((): 'drained' => 'drained')

  const result = await Promise.race([closed, timeout])
  if (timer !== undefined) clearTimeout(timer)

  if (result === 'timed_out') {
    logger.warn({ drain_timeout_ms: drainTimeoutMs }, 'shutdown drain timeout exceeded')
    // Force-close whatever is left so the process can exit.
    await worker.close(true)
  }
  return result
}
