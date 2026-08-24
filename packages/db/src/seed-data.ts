import { and, eq, isNull } from 'drizzle-orm'
import type { DatabaseClient, DatabaseExecutor } from './client.js'
import { generateApiKey, hashPassword } from './crypto.js'
import { apiKeys, creditLedger, organizations, users } from './schema/index.js'

/**
 * Local development seed data.
 *
 * Fixed identifiers make the seed re-runnable: the demo organisation is found
 * by a constant UUID and the demo user by its email, so a second run reuses
 * them instead of piling up duplicates. The demo address uses example.com,
 * which RFC 2606 reserves for documentation - it is not a real person.
 */
export const DEMO_ORG_ID = '00000000-0000-4000-8000-000000000001'
export const DEMO_ORG_NAME = 'TozaList Demo'
export const DEMO_USER_EMAIL = 'admin@example.com'
export const DEMO_USER_PASSWORD = 'tozalist-local-dev'
export const DEMO_API_KEY_NAME = 'Demo key (seed)'

/** Initial credit grant, applied at most once per environment. */
export const INITIAL_CREDIT_GRANT = 10_000

/**
 * Reference for the initial grant. The partial unique index on
 * (org_id, reference_id) turns this string into the idempotency key: a second
 * seed run conflicts and grants nothing.
 */
export const INITIAL_GRANT_REFERENCE = 'seed:initial-credit-grant'

export type SeedResult = {
  readonly orgId: string
  readonly userId: string
  /** Shown to the operator once and never stored. */
  readonly apiKeyPlaintext: string
  readonly apiKeyPrefix: string
  /** False when a previous seed run already granted the initial credits. */
  readonly creditsGranted: boolean
}

/**
 * Creates (or reuses) the demo organisation, admin user and credit grant, and
 * mints a fresh API key.
 *
 * The caller is responsible for running this inside a transaction - see
 * {@link seedDemoData}, which does exactly that.
 */
export async function seedDemoDataInTransaction(tx: DatabaseExecutor): Promise<SeedResult> {
  const org = await upsertDemoOrganization(tx)
  const user = await upsertDemoUser(tx, org.id)
  const apiKey = await createDemoApiKey(tx, org.id)
  const creditsGranted = await grantInitialCredits(tx, org.id)

  return {
    orgId: org.id,
    userId: user.id,
    apiKeyPlaintext: apiKey.plaintext,
    apiKeyPrefix: apiKey.keyPrefix,
    creditsGranted,
  }
}

/** Runs the whole seed atomically: either every row lands, or none does. */
export function seedDemoData(db: DatabaseClient): Promise<SeedResult> {
  return db.transaction((tx) => seedDemoDataInTransaction(tx))
}

async function upsertDemoOrganization(tx: DatabaseExecutor): Promise<{ id: string }> {
  const [existing] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, DEMO_ORG_ID))

  if (existing !== undefined) return existing

  const [created] = await tx
    .insert(organizations)
    .values({ id: DEMO_ORG_ID, name: DEMO_ORG_NAME })
    .returning({ id: organizations.id })

  if (created === undefined) throw new Error('seed: failed to create the demo organisation')
  return created
}

async function upsertDemoUser(tx: DatabaseExecutor, orgId: string): Promise<{ id: string }> {
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, DEMO_USER_EMAIL), isNull(users.deletedAt)))

  if (existing !== undefined) return existing

  const [created] = await tx
    .insert(users)
    .values({
      orgId,
      email: DEMO_USER_EMAIL,
      // Argon2id: the demo password is well-known, its hash still must not be.
      passwordHash: await hashPassword(DEMO_USER_PASSWORD),
      role: 'admin',
    })
    .returning({ id: users.id })

  if (created === undefined) throw new Error('seed: failed to create the demo user')
  return created
}

async function createDemoApiKey(
  tx: DatabaseExecutor,
  orgId: string,
): Promise<{ plaintext: string; keyPrefix: string }> {
  const key = generateApiKey()

  await tx.insert(apiKeys).values({
    orgId,
    name: DEMO_API_KEY_NAME,
    keyHash: key.keyHash,
    keyPrefix: key.keyPrefix,
  })

  return { plaintext: key.plaintext, keyPrefix: key.keyPrefix }
}

/**
 * Grants the initial credits, exactly once.
 *
 * Idempotency is enforced by the database, not by a prior read: the insert is
 * attempted every run and the unique index on (org_id, reference_id) rejects
 * the duplicate. A check-then-insert would race; this cannot.
 */
async function grantInitialCredits(tx: DatabaseExecutor, orgId: string): Promise<boolean> {
  const granted = await tx
    .insert(creditLedger)
    .values({
      orgId,
      delta: INITIAL_CREDIT_GRANT,
      reason: 'grant',
      referenceId: INITIAL_GRANT_REFERENCE,
      note: 'Initial local development grant',
    })
    .onConflictDoNothing()
    .returning({ id: creditLedger.id })

  return granted.length > 0
}
