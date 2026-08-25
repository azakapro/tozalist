import type { EngineResponse } from '@tozalist/shared'

// The queue name and job payload are a shared contract with the API.
export { SMTP_PROBE_QUEUE, type SmtpProbeJobData } from '@tozalist/shared'

export type { StoredEmailCheck } from '@tozalist/shared'

/** The one engine capability the worker needs; tests substitute a mock. */
export type EngineVerifier = {
  verify(email: string, opts: { smtp: boolean; catchAll: boolean }): Promise<EngineResponse>
}
