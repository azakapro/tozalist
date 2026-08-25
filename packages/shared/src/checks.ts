import { z } from 'zod'
import { engineResponseSchema, type EngineResponse } from './engine/schema.js'

/**
 * The contract shared between the API (which creates checks and enqueues SMTP
 * probes) and the worker (which completes them). Job payloads carry only the
 * check row's UUID - never an email address.
 */

/** BullMQ queue name for SMTP probe jobs. */
export const SMTP_PROBE_QUEUE = 'smtp-probe'

/** The whole job payload. Nothing personal crosses Redis. */
export type SmtpProbeJobData = {
  emailCheckId: string
}

/** BullMQ queue name for batch CSV processing jobs. */
export const BATCH_PROCESS_QUEUE = 'batch-process'

/** Hourly retention sweep (repeatable job); payload-free. */
export const LIFECYCLE_PURGE_QUEUE = 'lifecycle-purge'

/** Batch job payload: only the batch row's UUID crosses Redis. */
export type BatchProcessJobData = {
  batchId: string
}

/**
 * Operational counters stored in batches.stats. Never contains addresses -
 * only counts and the detected column layout.
 */
export type BatchStats = {
  /** Zero-based index of the email column in the source CSV. */
  email_column: number
  /** Whether the first CSV row is a header row. */
  has_header: boolean
  malformed_rows: number
  /** Unique, uncached rows actually charged. */
  charged: number
  /** Rows answered from the 7-day cache. */
  cached: number
  /** In-file duplicate rows reusing an earlier row's result. */
  duplicates: number
  /** Rows the engine could not assess (answered unknown, never charged). */
  engine_errors: number
  distribution: { valid: number; invalid: number; risky: number; unknown: number }
}

/**
 * SMTP lifecycle of a stored check. Explicit on purpose: `engine.smtp === null`
 * cannot distinguish "offline check, probe never wanted" from "probe queued
 * and still pending".
 */
export const SMTP_STATUSES = ['skipped', 'pending', 'complete'] as const
export type SmtpStatus = (typeof SMTP_STATUSES)[number]

/**
 * The typed snapshot stored in email_checks.checks_json. Everything needed to
 * re-render a check consistently after polling, without recomputation.
 */
export const storedEmailCheckSchema = z.strictObject({
  engine: engineResponseSchema,
  score: z.number(),
  disclaimer: z.string(),
  typo: z.string().nullable(),
  smtp_status: z.enum(SMTP_STATUSES),
  /** Preserves a terminal operational outcome (probe refused) for re-rendering. */
  operational_reason: z.enum(['SMTP_DISABLED', 'CIRCUIT_OPEN']).optional(),
})

export type StoredEmailCheck = z.infer<typeof storedEmailCheckSchema>

/** Parses a stored snapshot, or null when it does not match the contract. */
export function parseStoredEmailCheck(value: unknown): StoredEmailCheck | null {
  const parsed = storedEmailCheckSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type { EngineResponse }
