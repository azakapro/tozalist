import { randomBytes } from 'node:crypto'
import cookie from '@fastify/cookie'
import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  consumeRecoveryCode,
  createApiKeyForOrg,
  enrollMfa,
  findUserForLogin,
  getCreditBalance,
  getOrgSettings,
  getUsageSummary,
  getUserById,
  listApiKeysForOrg,
  listBatchesForOrg,
  listRecentAuditEvents,
  recordAuditEvent,
  revokeApiKeyById,
  signupOrgWithAdmin,
  softDeleteOrganization,
  updateOrgSettings,
  verifyPassword,
  wipeCheckDataForOrg,
  type DatabaseClient,
} from '@tozalist/db'
import { sendError } from '../errors.js'
import {
  clearSession,
  newCsrfToken,
  readSession,
  writeSession,
  type SessionConfig,
  type SessionData,
} from './session.js'
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js'
import { buildOrgDataExport, EXPORT_LINK_TTL_SECONDS } from './data-export.js'
import type { ObjectStorage } from '@tozalist/shared'

/**
 * /internal/* - the dashboard's session-cookie API. Never API-key
 * authenticated; locked by CORS to the dashboard origin; every mutation
 * requires the session's CSRF token in X-CSRF-Token. All routes are hidden
 * from the public OpenAPI document.
 *
 * MFA policy: TOTP is mandatory for admins. A fresh signup must enroll before
 * the session counts as verified; later logins require a code (or a
 * single-use recovery code).
 */

export type InternalRouteOptions = {
  db: DatabaseClient
  session: SessionConfig
  dashboardOrigin: string
  clock?: () => number
  /** Required by the data-export and check-data-wipe endpoints. */
  storage?: ObjectStorage
}

const HIDDEN = { hide: true } as const

const RETENTION_CHOICES = new Set([7, 30, 90])

export const internalRoutes = fp<InternalRouteOptions>(async (app: FastifyInstance, opts) => {
  const clock = opts.clock ?? Date.now

  await app.register(cookie)

  type Authed = { session: SessionData }

  async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
    options: { mfa?: boolean; csrf?: boolean } = {},
  ): Promise<Authed | null> {
    const session = await readSession(request, opts.session)
    if (session === null) {
      void sendError(reply, 'UNAUTHORIZED')
      return null
    }
    // Stateless sealed cookies stay cryptographically valid until they
    // expire, so liveness is re-checked against the database: a session for a
    // deleted organisation dies here, not at the cookie's TTL.
    const org = await getOrgSettings(opts.db, session.orgId)
    if (org === undefined) {
      clearSession(reply, opts.session)
      void sendError(reply, 'UNAUTHORIZED')
      return null
    }
    if (options.mfa === true && !session.mfaVerified) {
      void sendError(reply, 'UNAUTHORIZED', 'Multi-factor verification is required.')
      return null
    }
    if (options.csrf === true) {
      const token = request.headers['x-csrf-token']
      if (typeof token !== 'string' || token !== session.csrfToken) {
        void sendError(reply, 'UNAUTHORIZED', 'The request is missing a valid CSRF token.')
        return null
      }
    }
    return { session }
  }

  // ---- auth ----------------------------------------------------------------

  app.post<{ Body: { org_name: string; email: string; password: string } }>(
    '/internal/signup',
    {
      schema: {
        ...HIDDEN,
        body: {
          type: 'object',
          properties: {
            org_name: { type: 'string', minLength: 2, maxLength: 120 },
            email: { type: 'string', minLength: 5, maxLength: 320 },
            password: { type: 'string', minLength: 10, maxLength: 200 },
          },
          required: ['org_name', 'email', 'password'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const result = await signupOrgWithAdmin(opts.db, {
        orgName: request.body.org_name.trim(),
        email: request.body.email.trim().toLowerCase(),
        password: request.body.password,
      })
      if (!result.ok) {
        return sendError(reply, 'VALIDATION_ERROR', 'This email address is already registered.')
      }

      const session: SessionData = {
        userId: result.userId,
        orgId: result.orgId,
        role: 'admin',
        mfaVerified: false,
        csrfToken: newCsrfToken(),
      }
      await writeSession(reply, opts.session, session)
      return reply.status(200).send({
        data: { mfa_setup_required: true, csrf_token: session.csrfToken },
        meta: { request_id: request.id },
      })
    },
  )

  app.post<{ Body: { email: string; password: string } }>(
    '/internal/login',
    {
      schema: {
        ...HIDDEN,
        body: {
          type: 'object',
          properties: {
            email: { type: 'string', minLength: 5, maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
          required: ['email', 'password'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = await findUserForLogin(opts.db, request.body.email.trim().toLowerCase())
      // One generic message for every failure: no account enumeration.
      const rejected = () => sendError(reply, 'UNAUTHORIZED', 'The email or password is incorrect.')
      if (user === undefined || user.orgDeletedAt !== null) return rejected()
      if (!(await verifyPassword(user.passwordHash, request.body.password))) return rejected()

      const mfaEnrolled = user.mfaSecret !== null
      const session: SessionData = {
        userId: user.id,
        orgId: user.orgId,
        role: user.role,
        mfaVerified: false,
        csrfToken: newCsrfToken(),
      }
      await writeSession(reply, opts.session, session)
      await recordAuditEvent(opts.db, {
        orgId: user.orgId,
        actorUserId: user.id,
        action: 'user.login',
        targetType: 'user',
        targetId: user.id,
        metadata: { mfa_pending: mfaEnrolled },
      })

      return reply.status(200).send({
        data: {
          mfa_required: mfaEnrolled,
          mfa_setup_required: !mfaEnrolled && user.role === 'admin',
          csrf_token: session.csrfToken,
        },
        meta: { request_id: request.id },
      })
    },
  )

  app.post('/internal/logout', { schema: HIDDEN }, async (request, reply) => {
    const authed = await requireSession(request, reply, { csrf: true })
    if (authed === null) return
    await recordAuditEvent(opts.db, {
      orgId: authed.session.orgId,
      actorUserId: authed.session.userId,
      action: 'user.logout',
      targetType: 'user',
      targetId: authed.session.userId,
    })
    clearSession(reply, opts.session)
    return reply.status(200).send({ data: { logged_out: true }, meta: { request_id: request.id } })
  })

  // ---- MFA -----------------------------------------------------------------

  app.post('/internal/mfa/enroll', { schema: HIDDEN }, async (request, reply) => {
    const authed = await requireSession(request, reply, { csrf: true })
    if (authed === null) return

    const user = await getUserById(opts.db, authed.session.userId)
    if (user === undefined) return sendError(reply, 'UNAUTHORIZED')
    if (user.mfaSecret !== null) {
      return sendError(reply, 'VALIDATION_ERROR', 'Multi-factor auth is already enrolled.')
    }

    const secret = generateTotpSecret()
    // Ten single-use recovery codes, shown exactly once; only hashes persist.
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex'))
    await enrollMfa(opts.db, user.id, { secret, recoveryCodes })

    return reply.status(200).send({
      data: {
        otpauth_uri: totpUri(secret, user.email),
        secret,
        recovery_codes: recoveryCodes,
      },
      meta: { request_id: request.id },
    })
  })

  app.post<{ Body: { code: string } }>(
    '/internal/mfa/verify',
    {
      schema: {
        ...HIDDEN,
        body: {
          type: 'object',
          properties: { code: { type: 'string', minLength: 6, maxLength: 32 } },
          required: ['code'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const authed = await requireSession(request, reply, { csrf: true })
      if (authed === null) return

      const user = await getUserById(opts.db, authed.session.userId)
      if (user === undefined || user.mfaSecret === null) {
        return sendError(reply, 'VALIDATION_ERROR', 'Multi-factor auth is not enrolled.')
      }

      const code = request.body.code.trim()
      let method: 'totp' | 'recovery_code' | null = verifyTotp(user.mfaSecret, code, clock())
        ? 'totp'
        : null
      if (method === null) {
        // Recovery codes are consumed atomically: single use, ever.
        method = (await consumeRecoveryCode(opts.db, user.id, code)) ? 'recovery_code' : null
      }
      if (method === null) {
        return sendError(reply, 'UNAUTHORIZED', 'The verification code is not valid.')
      }

      // Only the fixed method category is recorded - never the code itself.
      await recordAuditEvent(opts.db, {
        orgId: authed.session.orgId,
        actorUserId: user.id,
        action: 'user.mfa_verified',
        targetType: 'user',
        targetId: user.id,
        metadata: { method },
      })

      await writeSession(reply, opts.session, { ...authed.session, mfaVerified: true })
      return reply
        .status(200)
        .send({ data: { mfa_verified: true }, meta: { request_id: request.id } })
    },
  )

  // ---- session state -------------------------------------------------------

  app.get('/internal/me', { schema: HIDDEN }, async (request, reply) => {
    const authed = await requireSession(request, reply)
    if (authed === null) return
    const user = await getUserById(opts.db, authed.session.userId)
    const org = user === undefined ? undefined : await getOrgSettings(opts.db, user.orgId)
    if (user === undefined || org === undefined) return sendError(reply, 'UNAUTHORIZED')

    return reply.status(200).send({
      data: {
        email: user.email,
        role: user.role,
        org_name: org.name,
        mfa_enrolled: user.mfaSecret !== null,
        mfa_verified: authed.session.mfaVerified,
        csrf_token: authed.session.csrfToken,
      },
      meta: { request_id: request.id },
    })
  })

  // ---- dashboard data ------------------------------------------------------

  app.get('/internal/overview', { schema: HIDDEN }, async (request, reply) => {
    const authed = await requireSession(request, reply, { mfa: true })
    if (authed === null) return
    const orgId = authed.session.orgId

    const [balance, usage, batches, activity] = await Promise.all([
      getCreditBalance(opts.db, orgId),
      getUsageSummary(opts.db, orgId, { limit: 1 }),
      listBatchesForOrg(opts.db, orgId, { limit: 5 }),
      listRecentAuditEvents(opts.db, orgId, 10),
    ])

    return reply.status(200).send({
      data: {
        credits: balance,
        checks_this_month: usage?.month ?? { email: 0, phone: 0, total: 0 },
        recent_batches:
          batches?.entries.map((batch) => ({
            batch_id: batch.id,
            filename: batch.filename,
            status: batch.status,
            total_rows: batch.totalRows,
            created_at: batch.createdAt.toISOString(),
          })) ?? [],
        recent_activity: activity.map((event) => ({
          action: event.action,
          target_type: event.targetType,
          at: event.createdAt.toISOString(),
        })),
      },
      meta: { request_id: request.id },
    })
  })

  // ---- API keys ------------------------------------------------------------

  app.get('/internal/keys', { schema: HIDDEN }, async (request, reply) => {
    const authed = await requireSession(request, reply, { mfa: true })
    if (authed === null) return
    const keys = await listApiKeysForOrg(opts.db, authed.session.orgId)
    return reply.status(200).send({
      data: {
        keys: keys.map((key) => ({
          key_id: key.id,
          name: key.name,
          key_prefix: key.keyPrefix,
          created_at: key.createdAt.toISOString(),
          revoked_at: key.revokedAt === null ? null : key.revokedAt.toISOString(),
          last_used_at: key.lastUsedAt === null ? null : key.lastUsedAt.toISOString(),
        })),
      },
      meta: { request_id: request.id },
    })
  })

  app.post<{ Body: { name: string } }>(
    '/internal/keys',
    {
      schema: {
        ...HIDDEN,
        body: {
          type: 'object',
          properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const authed = await requireSession(request, reply, { mfa: true, csrf: true })
      if (authed === null) return
      if (authed.session.role !== 'admin') return sendError(reply, 'UNAUTHORIZED')

      const created = await createApiKeyForOrg(
        opts.db,
        authed.session.orgId,
        request.body.name.trim(),
        { actorUserId: authed.session.userId },
      )
      if (!created.ok) return sendError(reply, 'VALIDATION_ERROR')

      // The plaintext key crosses this response once and is unrecoverable.
      return reply.status(200).send({
        data: {
          key_id: created.created.apiKeyId,
          key_prefix: created.created.keyPrefix,
          plaintext_key: created.created.plaintext,
        },
        meta: { request_id: request.id },
      })
    },
  )

  app.post<{ Params: { id: string } }>(
    '/internal/keys/:id/revoke',
    {
      schema: {
        ...HIDDEN,
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const authed = await requireSession(request, reply, { mfa: true, csrf: true })
      if (authed === null) return
      if (authed.session.role !== 'admin') return sendError(reply, 'UNAUTHORIZED')

      // Ownership check: the key must belong to this org.
      const keys = await listApiKeysForOrg(opts.db, authed.session.orgId)
      if (!keys.some((key) => key.id === request.params.id)) {
        return sendError(reply, 'NOT_FOUND')
      }
      const result = await revokeApiKeyById(opts.db, request.params.id, {
        actorUserId: authed.session.userId,
      })
      return reply.status(200).send({
        data: { revoked: result === 'revoked', already_revoked: result === 'already_revoked' },
        meta: { request_id: request.id },
      })
    },
  )

  // ---- settings ------------------------------------------------------------

  app.get('/internal/settings', { schema: HIDDEN }, async (request, reply) => {
    const authed = await requireSession(request, reply, { mfa: true })
    if (authed === null) return
    const settings = await getOrgSettings(opts.db, authed.session.orgId)
    if (settings === undefined) return sendError(reply, 'UNAUTHORIZED')
    return reply.status(200).send({
      data: { org_name: settings.name, retention_days: settings.retentionDays },
      meta: { request_id: request.id },
    })
  })

  app.post<{ Body: { org_name?: string; retention_days?: number } }>(
    '/internal/settings',
    {
      schema: {
        ...HIDDEN,
        body: {
          type: 'object',
          properties: {
            org_name: { type: 'string', minLength: 2, maxLength: 120 },
            retention_days: { type: 'integer' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const authed = await requireSession(request, reply, { mfa: true, csrf: true })
      if (authed === null) return
      if (authed.session.role !== 'admin') return sendError(reply, 'UNAUTHORIZED')

      if (
        request.body.retention_days !== undefined &&
        !RETENTION_CHOICES.has(request.body.retention_days)
      ) {
        return sendError(reply, 'VALIDATION_ERROR', 'Retention must be 7, 30, or 90 days.')
      }
      const updated = await updateOrgSettings(
        opts.db,
        authed.session.orgId,
        authed.session.userId,
        {
          ...(request.body.org_name !== undefined ? { name: request.body.org_name.trim() } : {}),
          ...(request.body.retention_days !== undefined
            ? { retentionDays: request.body.retention_days }
            : {}),
        },
      )
      if (!updated) return sendError(reply, 'UNAUTHORIZED')
      return reply.status(200).send({ data: { updated: true }, meta: { request_id: request.id } })
    },
  )

  // ---- data lifecycle (roadmap 7.1) ---------------------------------------

  app.post('/internal/export', { schema: HIDDEN }, async (request, reply) => {
    const authed = await requireSession(request, reply, { mfa: true, csrf: true })
    if (authed === null) return
    if (authed.session.role !== 'admin') return sendError(reply, 'UNAUTHORIZED')
    if (opts.storage === undefined) {
      request.log.error({ request_id: request.id }, 'export requested without storage configured')
      return sendError(reply, 'INTERNAL_ERROR')
    }

    const result = await buildOrgDataExport(
      { db: opts.db, storage: opts.storage },
      authed.session.orgId,
      new Date(clock()),
    )
    // The signed URL is returned to the requester ONLY - the audit trail
    // records that an export happened, never the credential-bearing link.
    await recordAuditEvent(opts.db, {
      orgId: authed.session.orgId,
      actorUserId: authed.session.userId,
      action: 'data.exported',
      targetType: 'organization',
      targetId: authed.session.orgId,
      metadata: { export_id: result.exportId, link_ttl_seconds: EXPORT_LINK_TTL_SECONDS },
    })
    return reply.status(200).send({
      data: {
        export_id: result.exportId,
        url: result.url,
        expires_at: result.expiresAt.toISOString(),
      },
      meta: { request_id: request.id },
    })
  })

  app.post<{ Body: { confirm: string } }>(
    '/internal/checks/delete-all',
    {
      schema: {
        ...HIDDEN,
        body: {
          type: 'object',
          properties: { confirm: { type: 'string', minLength: 1, maxLength: 32 } },
          required: ['confirm'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const authed = await requireSession(request, reply, { mfa: true, csrf: true })
      if (authed === null) return
      if (authed.session.role !== 'admin') return sendError(reply, 'UNAUTHORIZED')
      // Typing the exact word is the deliberate friction for a hard delete.
      if (request.body.confirm !== 'DELETE') {
        return sendError(reply, 'VALIDATION_ERROR', 'Type DELETE to confirm.')
      }
      if (opts.storage === undefined) {
        request.log.error({ request_id: request.id }, 'wipe requested without storage configured')
        return sendError(reply, 'INTERNAL_ERROR')
      }

      const storage = opts.storage
      // Objects are deleted inside the wipe transaction, BEFORE any row: a
      // storage failure rolls the whole wipe back (rows intact, no audit, no
      // success response) and the request can simply be retried. The org row
      // is locked for the duration, so a concurrently created batch cannot
      // slip between key enumeration and row deletion.
      let wiped
      try {
        wiped = await wipeCheckDataForOrg(opts.db, authed.session.orgId, (keys) =>
          storage.deleteObjects(keys),
        )
      } catch (error) {
        request.log.error(
          { request_id: request.id, error_name: error instanceof Error ? error.name : 'Error' },
          'check-data wipe failed before completion',
        )
        return sendError(reply, 'INTERNAL_ERROR')
      }
      if (wiped === null) return sendError(reply, 'UNAUTHORIZED')

      await recordAuditEvent(opts.db, {
        orgId: authed.session.orgId,
        actorUserId: authed.session.userId,
        action: 'check_data.deleted',
        targetType: 'organization',
        targetId: authed.session.orgId,
        metadata: {
          email_checks: wiped.emailChecks,
          phone_checks: wiped.phoneChecks,
          batches: wiped.batches,
          batch_objects: wiped.batchObjects,
        },
      })
      return reply.status(200).send({
        data: {
          deleted: true,
          email_checks: wiped.emailChecks,
          phone_checks: wiped.phoneChecks,
          batches: wiped.batches,
        },
        meta: { request_id: request.id },
      })
    },
  )

  app.post<{ Body: { confirm_name: string } }>(
    '/internal/org/delete',
    {
      schema: {
        ...HIDDEN,
        body: {
          type: 'object',
          properties: { confirm_name: { type: 'string', minLength: 1, maxLength: 120 } },
          required: ['confirm_name'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const authed = await requireSession(request, reply, { mfa: true, csrf: true })
      if (authed === null) return
      if (authed.session.role !== 'admin') return sendError(reply, 'UNAUTHORIZED')

      const settings = await getOrgSettings(opts.db, authed.session.orgId)
      if (settings === undefined) return sendError(reply, 'UNAUTHORIZED')
      // Typing the exact organisation name is the deliberate friction.
      if (request.body.confirm_name !== settings.name) {
        return sendError(reply, 'VALIDATION_ERROR', 'The confirmation name does not match.')
      }

      await softDeleteOrganization(opts.db, authed.session.orgId, authed.session.userId)
      clearSession(reply, opts.session)
      return reply.status(200).send({ data: { deleted: true }, meta: { request_id: request.id } })
    },
  )
})
