import { and, arrayContains, desc, eq, isNull, sql } from 'drizzle-orm'
import type { DatabaseExecutor } from './client.js'
import { organizations, webhookDeliveries, webhookEndpoints } from './schema/index.js'
import type { WebhookDelivery, WebhookEndpoint } from './schema/index.js'

/**
 * Webhook endpoint and delivery helpers. The endpoint secret lives only in
 * the endpoints table; helpers that feed list responses never select it.
 */

export async function createWebhookEndpoint(
  db: DatabaseExecutor,
  input: { orgId: string; url: string; events: string[]; secret: string },
): Promise<WebhookEndpoint> {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      orgId: input.orgId,
      url: input.url,
      secret: input.secret,
      events: input.events,
      active: true,
    })
    .returning()
  if (row === undefined) throw new Error('failed to insert the webhook endpoint')
  return row
}

export type WebhookEndpointSummary = {
  id: string
  url: string
  events: string[]
  active: boolean
  createdAt: Date
}

/** Active endpoints for an org - WITHOUT the secret column. */
export async function listWebhookEndpointsForOrg(
  db: DatabaseExecutor,
  orgId: string,
): Promise<WebhookEndpointSummary[]> {
  return db
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      events: webhookEndpoints.events,
      active: webhookEndpoints.active,
      createdAt: webhookEndpoints.createdAt,
    })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.orgId, orgId), isNull(webhookEndpoints.deletedAt)))
    .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id))
}

/** Soft delete; idempotent-safe: only an active endpoint matches. */
export async function softDeleteWebhookEndpoint(
  db: DatabaseExecutor,
  id: string,
  orgId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(webhookEndpoints)
    .set({ deletedAt: now, active: false })
    .where(
      and(
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.orgId, orgId),
        isNull(webhookEndpoints.deletedAt),
      ),
    )
    .returning({ id: webhookEndpoints.id })
  return rows.length > 0
}

/** Active endpoints of an active org subscribed to `event`. */
export async function findEndpointsForEvent(
  db: DatabaseExecutor,
  orgId: string,
  event: string,
): Promise<Array<{ id: string }>> {
  return db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .innerJoin(organizations, eq(webhookEndpoints.orgId, organizations.id))
    .where(
      and(
        eq(webhookEndpoints.orgId, orgId),
        eq(webhookEndpoints.active, true),
        isNull(webhookEndpoints.deletedAt),
        isNull(organizations.deletedAt),
        arrayContains(webhookEndpoints.events, [event]),
      ),
    )
}

export async function createWebhookDelivery(
  db: DatabaseExecutor,
  input: {
    id: string
    endpointId: string
    eventType: string
    payload: Record<string, unknown>
    expiresAt: Date
  },
): Promise<void> {
  await db.insert(webhookDeliveries).values({
    id: input.id,
    endpointId: input.endpointId,
    eventType: input.eventType,
    payload: input.payload,
    status: 'pending',
    attempts: 0,
    expiresAt: input.expiresAt,
  })
}

export type DeliveryForProcessing = {
  delivery: WebhookDelivery
  endpoint: { id: string; url: string; secret: string }
}

/** Loads a pending delivery with its live endpoint. Undefined when the
 * delivery is missing/terminal or the endpoint/org is gone - callers finish
 * quietly in that case. */
export async function getDeliveryForProcessing(
  db: DatabaseExecutor,
  deliveryId: string,
): Promise<DeliveryForProcessing | undefined> {
  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      endpointId: webhookEndpoints.id,
      url: webhookEndpoints.url,
      secret: webhookEndpoints.secret,
      endpointDeletedAt: webhookEndpoints.deletedAt,
      endpointActive: webhookEndpoints.active,
      orgDeletedAt: organizations.deletedAt,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
    .innerJoin(organizations, eq(webhookEndpoints.orgId, organizations.id))
    .where(eq(webhookDeliveries.id, deliveryId))

  if (row === undefined) return undefined
  if (row.delivery.status !== 'pending') return undefined
  if (!row.endpointActive || row.endpointDeletedAt !== null || row.orgDeletedAt !== null) {
    return undefined
  }
  return {
    delivery: row.delivery,
    endpoint: { id: row.endpointId, url: row.url, secret: row.secret },
  }
}

export type AttemptRecord = {
  attempt: number
  at: string
  status_code?: number
  error?: string
}

export type DeliveryOutcome =
  | { kind: 'delivered'; record: AttemptRecord }
  | { kind: 'retry'; nextRetryAt: Date; record: AttemptRecord }
  | { kind: 'failed'; record: AttemptRecord }

/** Appends one attempt record and advances the delivery's state. Every
 * outcome - success included - carries the true attempt number and timestamp,
 * so the append-only log reads as an accurate ordered history. */
export async function recordDeliveryAttempt(
  db: DatabaseExecutor,
  deliveryId: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  const record: AttemptRecord = outcome.record

  const base = {
    attempts: sql`${webhookDeliveries.attempts} + 1`,
    attemptLog: sql`${webhookDeliveries.attemptLog} || ${JSON.stringify([record])}::jsonb`,
  }

  if (outcome.kind === 'delivered') {
    await db
      .update(webhookDeliveries)
      .set({ ...base, status: 'delivered', nextRetryAt: null, lastError: null })
      .where(eq(webhookDeliveries.id, deliveryId))
    return
  }
  if (outcome.kind === 'retry') {
    await db
      .update(webhookDeliveries)
      .set({
        ...base,
        status: 'pending',
        nextRetryAt: outcome.nextRetryAt,
        lastError: outcome.record.error ?? null,
      })
      .where(eq(webhookDeliveries.id, deliveryId))
    return
  }
  await db
    .update(webhookDeliveries)
    .set({ ...base, status: 'failed', nextRetryAt: null, lastError: outcome.record.error ?? null })
    .where(eq(webhookDeliveries.id, deliveryId))
}
