import type { Readable } from 'node:stream'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * S3-compatible object storage shared by the API (uploads, signed downloads,
 * deletes) and the worker (streaming reads, result uploads). One
 * implementation so key layout and configuration cannot drift.
 *
 * Batch objects live at org/{orgId}/batches/{batchId}/input.csv and
 * .../result.csv - customer data, deleted with the batch row.
 */

export type S3Config = {
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
}

/** Reads S3_* variables. Throws naming only the variable, never its value. */
export function readS3Config(
  env: Readonly<Record<string, string | undefined>> = process.env,
): S3Config {
  const read = (name: string): string => {
    const value = env[name]
    if (value === undefined || value.trim() === '') {
      throw new Error(`${name} is required for object storage`)
    }
    return value.trim()
  }
  return {
    endpoint: read('S3_ENDPOINT'),
    accessKey: read('S3_ACCESS_KEY'),
    secretKey: read('S3_SECRET_KEY'),
    bucket: read('S3_BUCKET'),
  }
}

export function batchInputKey(orgId: string, batchId: string): string {
  return `org/${orgId}/batches/${batchId}/input.csv`
}

/** Everything an organisation owns lives under this prefix. */
export function orgObjectPrefix(orgId: string): string {
  return `org/${orgId}/`
}

/**
 * A data-export ZIP. The creation time is embedded in the key so the retention
 * sweep can expire exports without a database record: the signed link lives 24
 * hours, the object itself is removed by the next sweep after that.
 */
export function exportObjectKey(orgId: string, createdAtMs: number, id: string): string {
  return `org/${orgId}/exports/${createdAtMs}-${id}.zip`
}

/** The embedded creation time of an export key, or null for other keys. */
export function exportKeyCreatedAtMs(key: string): number | null {
  const match = /^org\/[0-9a-f-]+\/exports\/(\d+)-[0-9a-f-]+\.zip$/.exec(key)
  if (match === null) return null
  const ms = Number(match[1])
  return Number.isSafeInteger(ms) ? ms : null
}

export function batchResultKey(orgId: string, batchId: string): string {
  return `org/${orgId}/batches/${batchId}/result.csv`
}

/**
 * The one error message any storage deletion failure surfaces. Fixed text by
 * design: it can never carry an object key, endpoint, credential, or customer
 * value, no matter what the S3 SDK put in the underlying response.
 */
export const STORAGE_DELETE_FAILED = 'object storage deletion incomplete'

/**
 * Fails closed on a partial DeleteObjects response. S3 (and MinIO) can return
 * 200 with per-key errors in the body; treating that as success is how
 * customer objects get orphaned. Exported so tests can prove the behavior
 * with a fabricated partial response.
 */
export function ensureDeleteSucceeded(
  errors: Array<{ Key?: string | undefined }> | undefined,
): void {
  if (errors !== undefined && errors.length > 0) {
    throw new Error(STORAGE_DELETE_FAILED)
  }
}

/** DeleteObjects accepts at most 1000 keys per request. */
const DELETE_BATCH_LIMIT = 1000

export type ObjectStorage = {
  /** Streams `body` to `key` without buffering the whole object. */
  uploadStream(key: string, body: Readable, contentType?: string): Promise<void>
  /** Opens a streaming read of `key`. */
  getStream(key: string): Promise<Readable>
  /**
   * Deletes the given keys; missing keys are not an error, but a per-key
   * failure in the response is: the call throws STORAGE_DELETE_FAILED and the
   * caller must treat the whole deletion as retryable.
   */
  deleteObjects(keys: string[]): Promise<void>
  /** Lists every key under `prefix`, following pagination to the end. */
  listKeys(prefix: string): Promise<string[]>
  /** A presigned GET URL for `key`, valid `expiresInSeconds`. */
  presignDownload(key: string, expiresInSeconds: number): Promise<string>
  /** Creates the bucket when absent (local development and tests). */
  ensureBucket(): Promise<void>
  close(): void
}

export function createObjectStorage(config: S3Config): ObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    // MinIO and most S3-compatibles need path-style addressing.
    forcePathStyle: true,
  })
  const bucket = config.bucket

  return {
    async uploadStream(key, body, contentType = 'text/csv') {
      const upload = new Upload({
        client,
        params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
        // Small part size keeps memory flat; lib-storage streams parts.
        partSize: 5 * 1024 * 1024,
        queueSize: 1,
      })
      await upload.done()
    },

    async getStream(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (result.Body === undefined) throw new Error('object storage returned an empty body')
      return result.Body as Readable
    },

    async deleteObjects(keys) {
      for (let start = 0; start < keys.length; start += DELETE_BATCH_LIMIT) {
        const chunk = keys.slice(start, start + DELETE_BATCH_LIMIT)
        // Quiet mode still reports per-key ERRORS in the body; only successes
        // are suppressed. Missing keys are treated as deleted, not as errors.
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((key) => ({ Key: key })), Quiet: true },
          }),
        )
        ensureDeleteSucceeded(result.Errors)
      }
    },

    async listKeys(prefix) {
      const keys: string[] = []
      let continuationToken: string | undefined
      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ...(continuationToken !== undefined ? { ContinuationToken: continuationToken } : {}),
          }),
        )
        for (const object of result.Contents ?? []) {
          if (object.Key !== undefined) keys.push(object.Key)
        }
        continuationToken = result.IsTruncated === true ? result.NextContinuationToken : undefined
      } while (continuationToken !== undefined)
      return keys
    },

    async presignDownload(key, expiresInSeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      })
    },

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }))
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: bucket }))
      }
    },

    close() {
      client.destroy()
    },
  }
}
