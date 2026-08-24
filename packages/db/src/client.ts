import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { readDatabaseConfig } from './config.js'

export type DatabaseClient = ReturnType<typeof drizzle>

/**
 * Anything that can run a statement: the pooled client or an open transaction.
 *
 * Helpers take this rather than `DatabaseClient` so the same function works
 * inside and outside `db.transaction(...)`.
 */
export type DatabaseExecutor = Pick<
  DatabaseClient,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>

export type CreateClientOptions = {
  /** Keep this at 1 for one-shot scripts such as migrate and seed. */
  readonly maxConnections?: number
}

/**
 * Opens a pooled PostgreSQL connection.
 *
 * Callers own the returned handles and must close the `sql` client; the process
 * will not exit while the pool is open.
 */
export function createClient(options: CreateClientOptions = {}): {
  db: DatabaseClient
  sql: postgres.Sql
} {
  const { url } = readDatabaseConfig()
  const sql = postgres(url, { max: options.maxConnections ?? 10 })

  return { db: drizzle(sql), sql }
}
