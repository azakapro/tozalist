import postgres from 'postgres'
import { loadWorkspaceEnv } from '@tozalist/shared'
import { requireTestDatabaseConfig } from './config.js'

// Local development reads the workspace .env; CI and deployments pass env explicitly.
loadWorkspaceEnv()

/**
 * Drops and recreates the integration test database.
 *
 * This is destructive by design, which is why {@link requireTestDatabaseConfig}
 * runs first: no DATABASE_URL_TEST, or one that matches DATABASE_URL, or one
 * that does not end in `_test`, and this script refuses to do anything.
 *
 * Migrations are not applied here - the test suite applies them, which is how
 * it proves a fresh migration works.
 */
const { url } = requireTestDatabaseConfig()

const target = new URL(url)
const databaseName = target.pathname.replace(/^\//, '')

// Connect to the maintenance database: you cannot drop the database you are in.
const maintenanceUrl = new URL(url)
maintenanceUrl.pathname = '/postgres'

// Notices such as "database does not exist, skipping" are expected here.
const sql = postgres(maintenanceUrl.toString(), { max: 1, onnotice: () => {} })

try {
  // FORCE terminates leftover connections from a previous interrupted run.
  await sql.unsafe(`drop database if exists "${databaseName}" with (force)`)
  await sql.unsafe(`create database "${databaseName}"`)
  // The database name is safe to print; the URL carries a password and is not.
  console.log(`test database ready: ${databaseName}`)
} finally {
  await sql.end()
}
