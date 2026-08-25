import type { ObjectStorage } from '@tozalist/shared'

/**
 * Startup readiness for object storage.
 *
 * The API must not start listening - and therefore must not expose the batch
 * upload route - unless the configured bucket verifiably exists. A failure
 * here is fatal by design: an API that accepts uploads it cannot store would
 * take customers' files and lose them.
 */

export const STORAGE_NOT_READY_MESSAGE =
  'object storage is not ready: the bucket could not be verified or created'

/** Thrown when the bucket cannot be verified/created. Carries only the error
 * CLASS NAME of the underlying failure - never provider text, endpoints, or
 * credentials - so it is safe to log as-is. */
export class StorageNotReadyError extends Error {
  override readonly name = 'StorageNotReadyError'
  readonly causeName: string

  constructor(causeName: string) {
    super(STORAGE_NOT_READY_MESSAGE)
    this.causeName = causeName
  }
}

/** Verifies (or creates) the bucket. Idempotent; call before listening. */
export async function ensureStorageReady(storage: ObjectStorage): Promise<void> {
  try {
    await storage.ensureBucket()
  } catch (error) {
    throw new StorageNotReadyError(error instanceof Error ? error.name : 'unknown')
  }
}
