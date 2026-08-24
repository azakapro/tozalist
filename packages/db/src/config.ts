/**
 * Database configuration.
 *
 * The connection string carries a password, so it is validated by shape only
 * and never echoed into an error message or a log line.
 */

export type DatabaseConfig = {
  readonly url: string
}

type Env = Readonly<Record<string, string | undefined>>

export function readDatabaseConfig(env: Env = process.env): DatabaseConfig {
  const raw = env.DATABASE_URL

  if (raw === undefined || raw.trim() === '') {
    throw new Error('DATABASE_URL is required. Copy .env.example to .env and set it.')
  }

  const url = raw.trim()
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    throw new Error('DATABASE_URL is not a valid URL')
  }

  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error(
      `DATABASE_URL must use the postgres: or postgresql: scheme, received "${protocol}"`,
    )
  }

  return { url }
}

/**
 * Why a test database was rejected.
 *
 * `missing` means "no test database configured" - callers may skip integration
 * tests. The other codes mean "configured, but unsafe" and must never be
 * downgraded to a skip: they exist to stop a test run from destroying a real
 * database.
 */
export type TestDatabaseRejection =
  | { readonly ok: false; readonly code: 'missing'; readonly message: string }
  | { readonly ok: false; readonly code: 'same_as_development'; readonly message: string }
  | { readonly ok: false; readonly code: 'unsafe_name'; readonly message: string }
  | { readonly ok: false; readonly code: 'invalid'; readonly message: string }

export type TestDatabaseCheck = { readonly ok: true; readonly url: string } | TestDatabaseRejection

/** Databases the test suite is allowed to drop and recreate must end in this. */
const REQUIRED_TEST_DATABASE_SUFFIX = '_test'

/**
 * Decides whether destructive test setup may run.
 *
 * Three independent guards, because the cost of getting this wrong is someone's
 * development database: DATABASE_URL_TEST must exist, must differ from
 * DATABASE_URL, and must name a database ending in `_test`.
 */
export function checkTestDatabaseConfig(env: Env = process.env): TestDatabaseCheck {
  const raw = env.DATABASE_URL_TEST

  if (raw === undefined || raw.trim() === '') {
    return {
      ok: false,
      code: 'missing',
      message: 'DATABASE_URL_TEST is not set. Integration tests need a dedicated test database.',
    }
  }

  const url = raw.trim()
  const development = env.DATABASE_URL?.trim()

  if (development !== undefined && development !== '' && url === development) {
    return {
      ok: false,
      code: 'same_as_development',
      message:
        'DATABASE_URL_TEST must not equal DATABASE_URL. Refusing to run destructive setup against the development database.',
    }
  }

  let databaseName: string
  try {
    databaseName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    return { ok: false, code: 'invalid', message: 'DATABASE_URL_TEST is not a valid URL' }
  }

  if (!databaseName.endsWith(REQUIRED_TEST_DATABASE_SUFFIX)) {
    return {
      ok: false,
      code: 'unsafe_name',
      message: `DATABASE_URL_TEST must point at a database whose name ends in "${REQUIRED_TEST_DATABASE_SUFFIX}", received "${databaseName}".`,
    }
  }

  return { ok: true, url }
}

/** Same guards, but fatal. Used by anything that is about to drop a database. */
export function requireTestDatabaseConfig(env: Env = process.env): DatabaseConfig {
  const checked = checkTestDatabaseConfig(env)
  if (!checked.ok) throw new Error(checked.message)

  return { url: checked.url }
}
