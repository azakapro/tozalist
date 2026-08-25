import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Redis } from 'ioredis'
import { createClient } from '@tozalist/db'
import { buildApp } from '../src/app.js'
import type { ObjectStorage } from '@tozalist/shared'

/**
 * Exports the generated OpenAPI 3.1 document to a JSON file so the public
 * docs site can render the API reference at BUILD time - no running API
 * needed at request time, no drift possible (the same registry drives both).
 *
 * Connections are lazy: postgres and lazyConnect ioredis never actually dial
 * out during a spec export.
 */
const outArg = process.argv.indexOf('--out')
const outPath = resolve(
  process.cwd(),
  outArg >= 0 ? (process.argv[outArg + 1] ?? 'openapi.json') : 'openapi.json',
)

process.env.DATABASE_URL ??= 'postgresql://spec:spec@localhost:5432/spec_export_only'
const { db, sql } = createClient({ maxConnections: 1 })
const redis = new Redis({ lazyConnect: true, maxRetriesPerRequest: null })

const noopStorage: ObjectStorage = {
  uploadStream: () => Promise.resolve(),
  getStream: () => Promise.reject(new Error('spec export only')),
  deleteObjects: () => Promise.resolve(),
  listKeys: () => Promise.resolve([]),
  presignDownload: () => Promise.resolve(''),
  ensureBucket: () => Promise.resolve(),
  close: () => undefined,
}

const app = buildApp({
  deps: {
    db,
    redis,
    engine: { verify: () => Promise.reject(new Error('spec export only')) },
    smtpQueue: { enqueue: () => Promise.resolve(), close: () => Promise.resolve() },
    storage: noopStorage,
    batchQueue: { enqueue: () => Promise.resolve(), close: () => Promise.resolve() },
    smtpEnabled: false,
  },
})

await app.ready()
const document = (app as unknown as { swagger: () => unknown }).swagger()
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n')
console.log(`openapi.json written: ${outPath}`)
await app.close()
redis.disconnect()
await sql.end({ timeout: 1 })
