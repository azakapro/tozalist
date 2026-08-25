import { randomUUID } from 'node:crypto'
import type pino from 'pino'
import { createWebhookDelivery, findEndpointsForEvent, type DatabaseClient } from '@tozalist/db'
import type { WebhookEvent } from '@tozalist/shared'

/** Publisher seam for webhook-deliver jobs; tests inject a recorder. */
export type WebhookJobPublisher = {
  enqueue(deliveryId: string): Promise<void>
}

/**
 * Fans one batch event out to every subscribed active endpoint: one delivery
 * row + one job per endpoint. Payload rows store {event, data} - the envelope
 * timestamp and signature are produced per delivery attempt.
 *
 * Emission must never sink the batch that triggered it: callers wrap this in
 * their own error handling; failures here are logged as categories only.
 */
export async function emitBatchWebhookEvent(
  db: DatabaseClient,
  publisher: WebhookJobPublisher,
  logger: pino.Logger,
  input: {
    orgId: string
    event: WebhookEvent
    data: Record<string, unknown>
    retentionDays: number
  },
): Promise<void> {
  const endpoints = await findEndpointsForEvent(db, input.orgId, input.event)
  if (endpoints.length === 0) return

  const expiresAt = new Date(Date.now() + input.retentionDays * 24 * 60 * 60 * 1000)

  for (const endpoint of endpoints) {
    const deliveryId = randomUUID()
    await createWebhookDelivery(db, {
      id: deliveryId,
      endpointId: endpoint.id,
      eventType: input.event,
      payload: { event: input.event, data: input.data },
      expiresAt,
    })
    try {
      await publisher.enqueue(deliveryId)
    } catch (error) {
      // The delivery row exists with status pending; a later sweep or manual
      // replay can pick it up. Never let queue trouble break batch completion.
      logger.warn({
        delivery_id: deliveryId,
        outcome: 'enqueue_failed',
        error_name: error instanceof Error ? error.name : 'unknown',
      })
    }
  }
}
