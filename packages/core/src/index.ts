export {
  err,
  flatMap,
  isErr,
  isOk,
  map,
  ok,
  unwrapOr,
  type Err,
  type Ok,
  type Result,
} from './result.js'
export { isReasonCode, REASON_CODES, type ReasonCode } from './reason-codes.js'
export {
  EMAIL_CHANGES,
  normalizeEmail,
  type EmailChange,
  type NormalizedEmail,
} from './normalize-email.js'
export { detectTypo, KNOWN_PROVIDER_DOMAINS, levenshtein } from './domain-typo.js'
export { DEFAULT_PHONE_COUNTRY, validatePhone, type PhoneResult } from './phone.js'
export {
  aggregate,
  AGGREGATE_DISCLAIMER,
  type AggregateInput,
  type AggregateResult,
  type EngineResponse,
  type Verdict,
} from './aggregate.js'
export {
  formatAmount,
  getPlan,
  PLAN_CODES,
  PLAN_CONFIG_VERSION,
  PLANS,
  type Plan,
  type PlanCode,
} from './plans.js'
