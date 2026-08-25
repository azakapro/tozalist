import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { Writable } from 'node:stream'
import pino from 'pino'
import { createClient, checkTestDatabaseConfig, type DatabaseClient } from '@tozalist/db'
import { emailChecks, organizations } from '@tozalist/db'
import {
  createObjectStorage,
  readS3Config,
  type EngineResponse,
  type ObjectStorage,
} from '@tozalist/shared'
import { buildConnectionOptions } from '../connection.js'
import type { StoredEmailCheck } from '../smtp/types.js'

const checkedDb = checkTestDatabaseConfig(process.env)

export const hasIntegrationEnv = checkedDb.ok

export function connectTestDb(): ReturnType<typeof createClient> {
  if (!checkedDb.ok) throw new Error(checkedDb.message)
  // createClient reads DATABASE_URL; point it at the test database for this
  // process only. Guards above already proved the two URLs differ.
  process.env.DATABASE_URL = checkedDb.url
  return createClient({ maxConnections: 4 })
}

export function testRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379'
}

export function connectTestRedis(): Redis {
  return new Redis({ ...buildConnectionOptions(testRedisUrl()), lazyConnect: false })
}

/** Unique per-test namespace so parallel/consecutive runs never collide. */
export function uniqueName(label: string): string {
  return `test-${label}-${randomUUID().slice(0, 8)}`
}

export function engineSnapshot(overrides: Partial<EngineResponse> = {}): EngineResponse {
  return {
    email: 'user@snapshot.test',
    syntax: { valid: true, username: 'user', domain: 'snapshot.test' },
    mx: { has_mx: true, records: ['MX1.snapshot.test.'], error: '' },
    disposable: false,
    role_account: false,
    free_provider: false,
    smtp: null,
    duration_ms: 3,
    ...overrides,
  }
}

export async function createOrg(db: DatabaseClient): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: uniqueName('org') })
    .returning({ id: organizations.id })
  if (org === undefined) throw new Error('failed to create test organisation')
  return org.id
}

export async function insertEmailCheck(
  db: DatabaseClient,
  orgId: string,
  engine: EngineResponse,
  overrides: Partial<typeof emailChecks.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(emailChecks)
    .values({
      orgId,
      emailNormalized: engine.email,
      emailHash: `hash-${randomUUID()}`,
      verdict: 'unknown',
      reasonCodes: [],
      checksJson: {
        engine,
        score: 50,
        disclaimer: 'test disclaimer',
        typo: null,
        smtp_status: 'pending',
      } satisfies StoredEmailCheck,
      cached: false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning({ id: emailChecks.id })
  if (row === undefined) throw new Error('failed to insert test email check')
  return row.id
}

export type CapturedLogs = { lines: Array<Record<string, unknown>>; logger: pino.Logger }

/** A pino logger writing into memory so tests can audit every emitted line. */
export function captureLogger(): CapturedLogs {
  const lines: Array<Record<string, unknown>> = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim() !== '') lines.push(JSON.parse(line) as Record<string, unknown>)
      }
      callback()
    },
  })
  return { lines, logger: pino({ base: null }, stream) }
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 15_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('waitFor timed out')
}

/** Object storage against the local MinIO from .env; bucket auto-created. */
export async function connectTestStorage(): Promise<ObjectStorage> {
  const storage = createObjectStorage(readS3Config(process.env))
  await storage.ensureBucket()
  return storage
}

/** Reads a whole object into a string (test-only convenience). */
export async function readObject(storage: ObjectStorage, key: string): Promise<string> {
  const stream = await storage.getStream(key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}
