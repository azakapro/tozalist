import type { Readable } from 'node:stream'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
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

export function batchResultKey(orgId: string, batchId: string): string {
  return `org/${orgId}/batches/${batchId}/result.csv`
}

export type ObjectStorage = {
  /** Streams `body` to `key` without buffering the whole object. */
  uploadStream(key: string, body: Readable, contentType?: string): Promise<void>
  /** Opens a streaming read of `key`. */
  getStream(key: string): Promise<Readable>
  /** Deletes the given keys; missing keys are not an error. */
  deleteObjects(keys: string[]): Promise<void>
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
      if (keys.length === 0) return
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
        }),
      )
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
