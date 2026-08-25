import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DatabaseClient, DatabaseExecutor } from './client.js'
import { hashPassword, sha256Hex } from './crypto.js'
import { recordAuditEvent } from './api-keys.js'
import { organizations, users } from './schema/index.js'
import type { User } from './schema/index.js'

/**
 * Account and organisation management for the dashboard's session auth.
 * Passwords are Argon2id; recovery codes are stored only as SHA-256 hashes.
 */

export type SignupResult =
  { ok: true; orgId: string; userId: string } | { ok: false; reason: 'email_taken' }

/** Creates an organisation and its admin user atomically, with audit events. */
export async function signupOrgWithAdmin(
  db: DatabaseClient,
  input: { orgName: string; email: string; password: string },
): Promise<SignupResult> {
  const passwordHash = await hashPassword(input.password)

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
    if (existing !== undefined) return { ok: false, reason: 'email_taken' } as const

    const [org] = await tx
      .insert(organizations)
      .values({ name: input.orgName })
      .returning({ id: organizations.id })
    if (org === undefined) throw new Error('failed to create the organisation')

    const [user] = await tx
      .insert(users)
      .values({ orgId: org.id, email: input.email, passwordHash, role: 'admin' })
      .returning({ id: users.id })
    if (user === undefined) throw new Error('failed to create the admin user')

    await recordAuditEvent(tx, {
      orgId: org.id,
      actorUserId: user.id,
      action: 'org.created',
      targetType: 'organization',
      targetId: org.id,
    })
    await recordAuditEvent(tx, {
      orgId: org.id,
      actorUserId: user.id,
      action: 'user.created',
      targetType: 'user',
      targetId: user.id,
      metadata: { role: 'admin' },
    })

    return { ok: true, orgId: org.id, userId: user.id } as const
  })
}

/** Loads an active user (active org) by email, including the password hash. */
export async function findUserForLogin(
  db: DatabaseExecutor,
  email: string,
): Promise<(User & { orgDeletedAt: Date | null }) | undefined> {
  const [row] = await db
    .select({ user: users, orgDeletedAt: organizations.deletedAt })
    .from(users)
    .innerJoin(organizations, eq(users.orgId, organizations.id))
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
  if (row === undefined) return undefined
  return { ...row.user, orgDeletedAt: row.orgDeletedAt }
}

export async function getUserById(db: DatabaseExecutor, id: string): Promise<User | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
  return row
}

/** Stores the TOTP secret and the recovery-code hashes at enrollment. */
export async function enrollMfa(
  db: DatabaseClient,
  userId: string,
  input: { secret: string; recoveryCodes: string[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({
        mfaSecret: input.secret,
        mfaRecoveryCodes: input.recoveryCodes.map((code) => sha256Hex(code)),
      })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning({ id: users.id, orgId: users.orgId })
    if (user === undefined) throw new Error('user not found for MFA enrollment')

    await recordAuditEvent(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'user.mfa_enrolled',
      targetType: 'user',
      targetId: user.id,
    })
  })
}

/**
 * Consumes one recovery code atomically: the hash is removed from the array
 * only if present, so a code can never be used twice - even concurrently.
 */
export async function consumeRecoveryCode(
  db: DatabaseClient,
  userId: string,
  code: string,
): Promise<boolean> {
  const hash = sha256Hex(code)
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ codes: users.mfaRecoveryCodes, orgId: users.orgId })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .for('update')
    if (user === undefined || !user.codes.includes(hash)) return false

    await tx
      .update(users)
      .set({ mfaRecoveryCodes: user.codes.filter((entry) => entry !== hash) })
      .where(eq(users.id, userId))

    await recordAuditEvent(tx, {
      orgId: user.orgId,
      actorUserId: userId,
      action: 'user.recovery_code_used',
      targetType: 'user',
      targetId: userId,
    })
    return true
  })
}

export type OrgSettings = { name: string; retentionDays: number; smtpEnabled: boolean }

export async function getOrgSettings(
  db: DatabaseExecutor,
  orgId: string,
): Promise<OrgSettings | undefined> {
  const [row] = await db
    .select({
      name: organizations.name,
      retentionDays: organizations.retentionDays,
      smtpEnabled: organizations.smtpEnabled,
    })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
  return row
}

export async function updateOrgSettings(
  db: DatabaseClient,
  orgId: string,
  actorUserId: string,
  changes: { name?: string; retentionDays?: number },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(organizations)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.retentionDays !== undefined ? { retentionDays: changes.retentionDays } : {}),
      })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .returning({ id: organizations.id })
    if (updated === undefined) return false

    await recordAuditEvent(tx, {
      orgId,
      actorUserId,
      action: 'org.settings_updated',
      targetType: 'organization',
      targetId: orgId,
      // Field names only - values like the org name are customer data.
      metadata: { fields: Object.keys(changes) },
    })
    return true
  })
}

/** Soft-deletes the organisation; the retention sweep purges data later. */
export async function softDeleteOrganization(
  db: DatabaseClient,
  orgId: string,
  actorUserId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .update(organizations)
      .set({ deletedAt: now })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .returning({ id: organizations.id })
    if (deleted === undefined) return false

    await recordAuditEvent(tx, {
      orgId,
      actorUserId,
      action: 'org.deleted',
      targetType: 'organization',
      targetId: orgId,
      metadata: { purge: 'scheduled_by_retention_sweep' },
    })
    return true
  })
}

/** Recent audit events for the dashboard activity feed, org-scoped. */
export async function listRecentAuditEvents(
  db: DatabaseExecutor,
  orgId: string,
  limit: number,
): Promise<Array<{ id: string; action: string; targetType: string; createdAt: Date }>> {
  const { auditEvents } = await import('./schema/index.js')
  return db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId))
    .orderBy(sql`${auditEvents.createdAt} desc`)
    .limit(limit)
}

/** Non-revoked keys for the dashboard key list: prefix only, never hashes. */
export async function listApiKeysForOrg(
  db: DatabaseExecutor,
  orgId: string,
): Promise<
  Array<{
    id: string
    name: string
    keyPrefix: string
    createdAt: Date
    revokedAt: Date | null
    lastUsedAt: Date | null
  }>
> {
  const { apiKeys } = await import('./schema/index.js')
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId))
    .orderBy(sql`${apiKeys.createdAt} desc`)
}
