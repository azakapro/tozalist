import type { EngineResponse } from '@tozalist/shared'

/** The one engine capability routes need; tests provide a stub. */
export type EngineCaller = {
  verify(email: string, opts: { smtp: boolean; catchAll: boolean }): Promise<EngineResponse>
}

/**
 * The SMTP job publisher. The production implementation wraps a BullMQ queue;
 * tests substitute a recorder. Payloads carry only the check UUID.
 */
export type SmtpQueuePublisher = {
  enqueue(emailCheckId: string): Promise<void>
  close(): Promise<void>
}

/** Publisher for batch-process jobs. Payloads carry only the batch UUID. */
export type BatchQueuePublisher = {
  enqueue(batchId: string): Promise<void>
  close(): Promise<void>
}
