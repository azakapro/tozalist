import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { Redis } from 'ioredis'
import {
  checkTestDatabaseConfig,
  createClient,
  creditLedger,
  organizations,
  type DatabaseClient,
} from '@tozalist/db'
import {
  createObjectStorage,
  readS3Config,
  type EngineResponse,
  type ObjectStorage,
} from '@tozalist/shared'
import type { EngineCaller, SmtpQueuePublisher } from '../types.js'

const checkedDb = checkTestDatabaseConfig(process.env)

export const hasIntegrationEnv = checkedDb.ok

export function connectTestDb(): ReturnType<typeof createClient> {
  if (!checkedDb.ok) throw new Error(checkedDb.message)
  process.env.DATABASE_URL = checkedDb.url
  return createClient({ maxConnections: 4 })
}

export function connectTestRedis(): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
}

export function uniqueName(label: string): string {
  return `test-${label}-${randomUUID().slice(0, 8)}`
}

export async function createOrg(
  db: DatabaseClient,
  overrides: Partial<typeof organizations.$inferInsert> = {},
): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: uniqueName('org'), ...overrides })
    .returning({ id: organizations.id })
  if (org === undefined) throw new Error('failed to create test organisation')
  return org.id
}

export type CapturedLogs = { lines: Array<Record<string, unknown>>; stream: Writable }

/** A writable stream that parses each JSON log line for auditing in tests. */
export function captureStream(): CapturedLogs {
  const lines: Array<Record<string, unknown>> = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim() !== '') {
          try {
            lines.push(JSON.parse(line) as Record<string, unknown>)
          } catch {
            lines.push({ raw: line })
          }
        }
      }
      callback()
    },
  })
  return { lines, stream }
}

export async function grantCredits(
  db: DatabaseClient,
  orgId: string,
  amount: number,
): Promise<void> {
  await db.insert(creditLedger).values({
    orgId,
    delta: amount,
    reason: 'grant',
    referenceId: `test-grant-${randomUUID()}`,
  })
}

export function engineResponseFixture(overrides: Partial<EngineResponse> = {}): EngineResponse {
  return {
    email: 'user@example.test',
    syntax: { valid: true, username: 'user', domain: 'example.test' },
    mx: { has_mx: true, records: ['mx.example.test.'], error: '' },
    disposable: false,
    role_account: false,
    free_provider: false,
    smtp: null,
    duration_ms: 3,
    ...overrides,
  }
}

/** Engine stub: echoes the queried email back into a clean response. */
export function stubEngine(
  behavior: 'ok' | 'fail' = 'ok',
): EngineCaller & { calls: Array<{ email: string; smtp: boolean; catchAll: boolean }> } {
  const calls: Array<{ email: string; smtp: boolean; catchAll: boolean }> = []
  return {
    calls,
    verify(email, opts) {
      calls.push({ email, smtp: opts.smtp, catchAll: opts.catchAll })
      if (behavior === 'fail') return Promise.reject(new Error('engine exploded internally'))
      const at = email.lastIndexOf('@')
      const domain = at >= 0 ? email.slice(at + 1) : ''
      const username = at >= 0 ? email.slice(0, at) : email
      return Promise.resolve(
        engineResponseFixture({
          email,
          syntax: { valid: at > 0 && domain !== '', username, domain },
          mx: { has_mx: true, records: [`mx.${domain || 'invalid'}.`], error: '' },
        }),
      )
    },
  }
}

/** Queue stub: records enqueued IDs, or fails on demand. */
export function stubQueue(
  behavior: 'ok' | 'fail' = 'ok',
): SmtpQueuePublisher & { jobs: string[]; closed: boolean } {
  const state = { jobs: [] as string[], closed: false }
  return {
    get jobs() {
      return state.jobs
    },
    get closed() {
      return state.closed
    },
    enqueue(emailCheckId: string) {
      if (behavior === 'fail') return Promise.reject(new Error('queue backend unreachable'))
      state.jobs.push(emailCheckId)
      return Promise.resolve()
    },
    close() {
      state.closed = true
      return Promise.resolve()
    },
  }
}

/** Object storage against local MinIO; bucket auto-created. */
export async function connectTestStorage(): Promise<ObjectStorage> {
  const storage = createObjectStorage(readS3Config(process.env))
  await storage.ensureBucket()
  return storage
}

/** Builds a multipart/form-data body with one CSV file field. */
export function multipartCsv(
  csv: string,
  filename = 'list.csv',
): { body: Buffer; contentType: string } {
  const boundary = '----tozalist-test-boundary'
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

/** Batch queue stub mirroring the SMTP one. */
export function stubBatchQueue(behavior: 'ok' | 'fail' = 'ok'): {
  enqueue(batchId: string): Promise<void>
  close(): Promise<void>
  jobs: string[]
} {
  const jobs: string[] = []
  return {
    jobs,
    enqueue(batchId: string) {
      if (behavior === 'fail') return Promise.reject(new Error('queue backend unreachable'))
      jobs.push(batchId)
      return Promise.resolve()
    },
    close() {
      return Promise.resolve()
    },
  }
}
