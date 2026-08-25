import { and, eq, isNull } from 'drizzle-orm'
import type { DatabaseClient, DatabaseExecutor } from './client.js'
import { generateApiKey, type GeneratedApiKey } from './crypto.js'
import { apiKeys, auditEvents, organizations } from './schema/index.js'

/**
 * Typed API-key operations shared by the API's auth layer and the key CLIs.
 * Plaintext keys exist only in the return value of creation - never in a row,
 * an audit event, or a log line.
 */

/** How long operational audit records are kept before the retention sweep. */
export const AUDIT_RETENTION_DAYS = 90

function auditExpiry(now: Date): Date {
  return new Date(now.getTime() + AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

export type AuthenticatedKey = {
  apiKeyId: string
  orgId: string
}

export type ApiKeyLookup =
  | { ok: true; key: AuthenticatedKey }
  | { ok: false; reason: 'unknown_key' | 'revoked_key' | 'expired_key' | 'org_deleted' }

/** Resolves a SHA-256 key hash to an active key, or a safe failure category. */
export async function findActiveApiKeyByHash(
  db: DatabaseExecutor,
  keyHash: string,
  now: Date = new Date(),
): Promise<ApiKeyLookup> {
  const [row] = await db
    .select({
      id: apiKeys.id,
      orgId: apiKeys.orgId,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
      orgDeletedAt: organizations.deletedAt,
    })
    .from(apiKeys)
    .innerJoin(organizations, eq(apiKeys.orgId, organizations.id))
    .where(eq(apiKeys.keyHash, keyHash))

  if (row === undefined) return { ok: false, reason: 'unknown_key' }
  if (row.revokedAt !== null) return { ok: false, reason: 'revoked_key' }
  if (row.expiresAt !== null && row.expiresAt <= now) return { ok: false, reason: 'expired_key' }
  if (row.orgDeletedAt !== null) return { ok: false, reason: 'org_deleted' }

  return { ok: true, key: { apiKeyId: row.id, orgId: row.orgId } }
}

/** Stamps last_used_at. Callers throttle this; the write itself is plain. */
export async function touchApiKeyLastUsed(
  db: DatabaseExecutor,
  apiKeyId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, apiKeyId))
}

export type AuditEventInput = {
  orgId?: string | null
  actorUserId?: string | null
  actorApiKeyId?: string | null
  action: string
  targetType: string
  targetId: string
  /** Must never contain key material, headers, emails or foreign error text. */
  metadata?: Record<string, unknown>
}

/** Appends one audit event with the operational retention window applied. */
export async function recordAuditEvent(
  db: DatabaseExecutor,
  event: AuditEventInput,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(auditEvents).values({
    orgId: event.orgId ?? null,
    actorUserId: event.actorUserId ?? null,
    actorApiKeyId: event.actorApiKeyId ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata ?? {},
    expiresAt: auditExpiry(now),
  })
}

export type CreatedApiKey = {
  apiKeyId: string
  orgId: string
  plaintext: string
  keyPrefix: string
}

export type CreateApiKeyResult =
  { ok: true; created: CreatedApiKey } | { ok: false; reason: 'org_not_found' | 'org_deleted' }

/**
 * Creates a key for an active organisation, atomically with its audit event.
 * The plaintext exists only in the returned value.
 */
export async function createApiKeyForOrg(
  db: DatabaseClient,
  orgId: string,
  name: string,
  options: { actorUserId?: string } = {},
): Promise<CreateApiKeyResult> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id, deletedAt: organizations.deletedAt })
      .from(organizations)
      .where(eq(organizations.id, orgId))

    if (org === undefined) return { ok: false, reason: 'org_not_found' } as const
    if (org.deletedAt !== null) return { ok: false, reason: 'org_deleted' } as const

    const key: GeneratedApiKey = generateApiKey()
    const [inserted] = await tx
      .insert(apiKeys)
      .values({ orgId, name, keyHash: key.keyHash, keyPrefix: key.keyPrefix })
      .returning({ id: apiKeys.id })
    if (inserted === undefined) throw new Error('failed to insert the API key')

    // The actor is the authenticated dashboard user when one exists (the CLI
    // has none - a system action). The created key is the TARGET, never the
    // actor: a key cannot have created itself.
    await recordAuditEvent(tx, {
      orgId,
      ...(options.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: inserted.id,
      metadata: { name, key_prefix: key.keyPrefix },
    })

    return {
      ok: true,
      created: {
        apiKeyId: inserted.id,
        orgId,
        plaintext: key.plaintext,
        keyPrefix: key.keyPrefix,
      },
    } as const
  })
}

export type RevokeApiKeyResult = 'revoked' | 'already_revoked' | 'not_found'

/**
 * Revokes a key by ID. Idempotent: the UPDATE only matches an active key, so a
 * second call changes nothing and writes no second audit event.
 */
export async function revokeApiKeyById(
  db: DatabaseClient,
  apiKeyId: string,
  options: { actorUserId?: string; now?: Date } = {},
): Promise<RevokeApiKeyResult> {
  const now = options.now ?? new Date()
  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.id, apiKeyId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id, orgId: apiKeys.orgId })

    const [first] = revoked
    if (first !== undefined) {
      // Same attribution rule as creation: the revoked key is the target only.
      await recordAuditEvent(tx, {
        orgId: first.orgId,
        ...(options.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
        action: 'api_key.revoked',
        targetType: 'api_key',
        targetId: first.id,
      })
      return 'revoked' as const
    }

    const [existing] = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId))
    return existing === undefined ? ('not_found' as const) : ('already_revoked' as const)
  })
}
