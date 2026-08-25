import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createObjectStorage, readS3Config, type ObjectStorage } from '@tozalist/shared'
import { ensureStorageReady, STORAGE_NOT_READY_MESSAGE, StorageNotReadyError } from './startup.js'
import { hasIntegrationEnv } from './test/support.js'

describe('object-storage startup readiness', () => {
  it('invokes bucket readiness exactly once per call and is idempotent', async () => {
    let calls = 0
    const storage = {
      ensureBucket: () => {
        calls += 1
        return Promise.resolve()
      },
    } as unknown as ObjectStorage

    await ensureStorageReady(storage)
    await ensureStorageReady(storage)
    expect(calls).toBe(2)
  })

  it('fails closed with a fixed message that never leaks provider details', async () => {
    const hostile = new Error(
      'connect failed for http://minio:9000 using AKIA_FAKE_KEY:sup3rs3cret',
    )
    hostile.name = 'S3ServiceException'
    const storage = {
      ensureBucket: () => Promise.reject(hostile),
    } as unknown as ObjectStorage

    const error = await ensureStorageReady(storage).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(StorageNotReadyError)
    const typed = error as StorageNotReadyError
    expect(typed.message).toBe(STORAGE_NOT_READY_MESSAGE)
    expect(typed.causeName).toBe('S3ServiceException')
    const serialized = JSON.stringify({ message: typed.message, cause: typed.causeName })
    expect(serialized).not.toContain('sup3rs3cret')
    expect(serialized).not.toContain('AKIA_FAKE_KEY')
    expect(serialized).not.toContain('minio:9000')
  })

  it.skipIf(!hasIntegrationEnv)(
    'initializes a clean bucket on real object storage and leaves behavior unchanged',
    async () => {
      // A bucket name that has never existed: the fresh-install scenario.
      const config = {
        ...readS3Config(process.env),
        bucket: `tz-startup-${randomUUID().slice(0, 12)}`,
      }
      const storage = createObjectStorage(config)
      try {
        await ensureStorageReady(storage)
        // Startup is idempotent on an existing bucket too.
        await ensureStorageReady(storage)

        // The freshly created bucket is genuinely usable end to end.
        const key = `startup-check/${randomUUID()}.csv`
        await storage.uploadStream(key, Readable.from(['email\nready@startup.test\n']))
        const stream = await storage.getStream(key)
        let body = ''
        for await (const chunk of stream) body += String(chunk)
        expect(body).toContain('ready@startup.test')
        await storage.deleteObjects([key])
      } finally {
        storage.close()
      }
    },
  )
})
