import type { EngineResponse } from '@tozalist/shared'

/** The one engine capability routes need; tests provide a stub. */
export type EngineCaller = {
  verify(
    email: string,
    opts: { smtp: boolean; catchAll: boolean; requestId?: string | undefined },
  ): Promise<EngineResponse>
}

/**
 * The SMTP job publisher. The production implementation wraps a BullMQ queue;
 * tests substitute a recorder. Payloads carry only the check UUID plus the
 * originating request id for cross-service tracing.
 */
export type SmtpQueuePublisher = {
  enqueue(emailCheckId: string, requestId?: string): Promise<void>
  close(): Promise<void>
}

/** Publisher for batch-process jobs. Payloads carry only the batch UUID. */
export type BatchQueuePublisher = {
  enqueue(batchId: string, requestId?: string): Promise<void>
  close(): Promise<void>
}
