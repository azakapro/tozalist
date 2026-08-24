import { pgEnum } from 'drizzle-orm/pg-core'

/** Members can use the product; admins can also manage the organisation. */
export const userRoleEnum = pgEnum('user_role', ['admin', 'member'])

/** Why credits moved. Grants and refunds are positive, checks are negative. */
export const creditReasonEnum = pgEnum('credit_reason', [
  'grant',
  'single_check',
  'batch_check',
  'refund',
  'adjustment',
])

export const emailVerdictEnum = pgEnum('email_verdict', ['valid', 'invalid', 'risky', 'unknown'])

export const batchStatusEnum = pgEnum('batch_status', [
  'pending',
  'validating',
  'processing',
  'done',
  'failed',
])

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'delivered',
  'failed',
])

export const leadSourceEnum = pgEnum('lead_source', [
  'landing_pilot',
  'landing_contact',
  'landing_checklist',
])
