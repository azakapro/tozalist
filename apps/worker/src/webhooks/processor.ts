import { DelayedError, type Job } from 'bullmq'
import type pino from 'pino'
import {
  getDeliveryForProcessing,
  recordDeliveryAttempt,
  type AttemptRecord,
  type DatabaseClient,
} from '@tozalist/db'
import {
  checkWebhookHost,
  defaultHostResolver,
  signWebhookBody,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_MS,
  WEBHOOK_TIMEOUT_MS,
  type HostResolver,
  type WebhookDeliverJobData,
  type WebhookEnvelope,
  type WebhookEvent,
} from '@tozalist/shared'
import { fetchWebhookTransport, type WebhookTransport } from './transport.js'

/**
 * Webhook delivery processor.
 *
 * Safety order per attempt: re-resolve the destination host and reject
 * private/reserved addresses (DNS can be re-pointed AFTER registration), then
 * POST the signed envelope with a 5s timeout and no redirect following. Any
 * 2xx is delivered. Failures follow the exact retry schedule 1m, 5m, 30m,
 * 2h, 6h; after the sixth attempt the delivery is failed.
 *
 * Every attempt is recorded on the delivery row with its response code or a
 * fixed error category - never foreign response text. Logs carry the delivery
 * id, endpoint id and outcome; never URLs, secrets, or payloads.
 */

export type WebhookProcessorDeps = {
  db: DatabaseClient
  logger: pino.Logger
  transport?: WebhookTransport
  resolver?: HostResolver
  clock?: () => number
}

type FailureCategory =
  'ssrf_blocked' | 'redirect_refused' | 'timeout' | 'network_error' | 'http_error'

export function createWebhookProcessor(deps: WebhookProcessorDeps) {
  const transport = deps.transport ?? fetchWebhookTransport
  const resolver = deps.resolver ?? defaultHostResolver
  const clock = deps.clock ?? Date.now

  return async function processDelivery(
    job: Job<WebhookDeliverJobData>,
    token?: string,
  ): Promise<void> {
    const loaded = await getDeliveryForProcessing(deps.db, job.data.deliveryId)
    if (loaded === undefined) {
      // Deleted endpoint/org, or already terminal: finish quietly.
      deps.logger.info({ delivery_id: job.data.deliveryId, outcome: 'not_deliverable' })
      return
    }
    const { delivery, endpoint } = loaded
    const attemptNumber = delivery.attempts + 1

    const finishAttempt = async (category: FailureCategory, statusCode?: number): Promise<void> => {
      const record: AttemptRecord = {
        attempt: attemptNumber,
        at: new Date(clock()).toISOString(),
        ...(statusCode !== undefined ? { status_code: statusCode } : {}),
        error: category,
      }

      if (attemptNumber >= WEBHOOK_MAX_ATTEMPTS) {
        await recordDeliveryAttempt(deps.db, delivery.id, { kind: 'failed', record })
        deps.logger.warn({
          delivery_id: delivery.id,
          endpoint_id: endpoint.id,
          outcome: 'failed',
          attempts: attemptNumber,
          error: category,
        })
        return
      }

      const delayMs = WEBHOOK_RETRY_SCHEDULE_MS[attemptNumber - 1] ?? 0
      const nextRetryAt = new Date(clock() + delayMs)
      await recordDeliveryAttempt(deps.db, delivery.id, { kind: 'retry', nextRetryAt, record })
      deps.logger.info({
        delivery_id: delivery.id,
        endpoint_id: endpoint.id,
        outcome: 'retry_scheduled',
        attempt: attemptNumber,
        retry_in_ms: delayMs,
        error: category,
      })
      await job.moveToDelayed(clock() + delayMs, token)
      throw new DelayedError()
    }

    // SSRF re-check at DELIVERY time: registration-time DNS is not trusted.
    const url = new URL(endpoint.url)
    const ssrf = await checkWebhookHost(url.hostname, resolver)
    if (!ssrf.ok) {
      return finishAttempt('ssrf_blocked')
    }
    // The socket will be PINNED to this approved address - the transport never
    // performs its own DNS lookup, so a post-check re-resolution cannot reach
    // anything the check did not approve.
    const approvedAddress = ssrf.addresses[0]
    if (approvedAddress === undefined) {
      return finishAttempt('ssrf_blocked')
    }

    // The envelope is rebuilt per attempt so the signed timestamp is fresh -
    // consumers verify freshness to reject replays.
    const stored = delivery.payload as { event: string; data: Record<string, unknown> }
    const envelope: WebhookEnvelope = {
      event: stored.event as WebhookEvent,
      data: stored.data,
      timestamp: new Date(clock()).toISOString(),
      delivery_id: delivery.id,
    }
    const rawBody = JSON.stringify(envelope)
    const signature = signWebhookBody(endpoint.secret, rawBody)

    const result = await transport({
      url: endpoint.url,
      body: rawBody,
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Timestamp': envelope.timestamp,
        'X-Delivery-Id': delivery.id,
        'X-Event-Type': envelope.event,
      },
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      connectToAddress: approvedAddress,
    })

    switch (result.kind) {
      case 'response':
        if (result.statusCode >= 200 && result.statusCode < 300) {
          await recordDeliveryAttempt(deps.db, delivery.id, {
            kind: 'delivered',
            record: {
              attempt: attemptNumber,
              at: new Date(clock()).toISOString(),
              status_code: result.statusCode,
            },
          })
          deps.logger.info({
            delivery_id: delivery.id,
            endpoint_id: endpoint.id,
            outcome: 'delivered',
            attempt: attemptNumber,
            status_code: result.statusCode,
          })
          return
        }
        return finishAttempt('http_error', result.statusCode)
      case 'redirect':
        return finishAttempt('redirect_refused', result.statusCode)
      case 'timeout':
        return finishAttempt('timeout')
      case 'network_error':
        return finishAttempt('network_error')
    }
  }
}
