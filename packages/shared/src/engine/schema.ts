import { z } from 'zod'

/**
 * Runtime schema for the Go engine's POST /verify response (step 1.1
 * contract). Every object is strict: a missing field, an extra field, or a
 * wrong type is contract drift and must fail loudly rather than flow onward
 * as corrupt data.
 *
 * z.strictObject is Zod 4's canonical spelling of .strict() - unknown keys
 * are rejected, not stripped.
 */

export const engineSyntaxSchema = z.strictObject({
  valid: z.boolean(),
  username: z.string(),
  domain: z.string(),
})

export const engineMxSchema = z.strictObject({
  /**
   * Three-valued by design, matching the engine: true/false when the lookup
   * succeeded, null when the lookup itself failed (then `error` is set).
   */
  has_mx: z.boolean().nullable(),
  records: z.array(z.string()),
  error: z.string(),
})

export const engineSmtpSchema = z.strictObject({
  attempted: z.boolean(),
  mailbox_accepted: z.boolean(),
  catch_all: z.boolean(),
  full_inbox: z.boolean(),
  disabled: z.boolean(),
  error: z.string(),
})

export const engineResponseSchema = z.strictObject({
  email: z.string(),
  syntax: engineSyntaxSchema,
  mx: engineMxSchema,
  disposable: z.boolean(),
  role_account: z.boolean(),
  free_provider: z.boolean(),
  /** null exactly when the request did not ask for an SMTP probe. */
  smtp: engineSmtpSchema.nullable(),
  duration_ms: z.number(),
})

export type EngineResponse = z.infer<typeof engineResponseSchema>
