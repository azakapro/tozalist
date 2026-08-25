import { createHmac, randomBytes } from 'node:crypto'

/**
 * The webhook contract shared by the API (registration) and the worker
 * (delivery): event names, retry schedule, secret format and signing.
 */

export const WEBHOOK_EVENTS = ['batch.completed', 'batch.failed'] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

/** BullMQ queue name for webhook delivery jobs. */
export const WEBHOOK_DELIVER_QUEUE = 'webhook-deliver'

/** The whole job payload: only the delivery row's UUID crosses Redis. */
export type WebhookDeliverJobData = {
  deliveryId: string
}

/**
 * Exact retry backoff after each failed attempt: 1m, 5m, 30m, 2h, 6h. After
 * the schedule is exhausted (6 total attempts) the delivery is failed.
 */
export const WEBHOOK_RETRY_SCHEDULE_MS = [
  60_000, 300_000, 1_800_000, 7_200_000, 21_600_000,
] as const

export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_MS.length + 1

/** Delivery HTTP timeout. */
export const WEBHOOK_TIMEOUT_MS = 5_000

/** Mints an endpoint secret: whsec_ + 32 random bytes, base64url. Returned to
 * the customer exactly once at registration; never logged. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`
}

/** Hex HMAC-SHA256 of the RAW request body - the signature customers verify. */
export function signWebhookBody(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/** The wire envelope POSTed to endpoints. */
export type WebhookEnvelope = {
  event: WebhookEvent
  data: Record<string, unknown>
  timestamp: string
  delivery_id: string
}
