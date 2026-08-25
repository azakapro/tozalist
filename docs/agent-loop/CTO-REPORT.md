# CTO Report — Step 8.1 correction (labelled free-text secret leakage)

## Step and outcome

Step `8.1`, focused correction per `PM-DECISION.md`. The remaining reproduced leaks are closed: a labelled secret such as `password=…` inside an `Error`, or `webhook_secret=…` in an ordinary log message string, is now censored. Scope was limited to logging/redaction code and its tests. Still on `feat/phase-8-hardening`, local-only, uncommitted. No Git write.

## Correction implemented (`packages/shared/src/logging.ts`)

### 1. Labelled free-text secrets censored

The text-safe path (`redactSecretsInText`, used for both Pino message strings and Error message/stack text) now censors labelled secrets in addition to email hashing and shaped-secret patterns. A separator- and case-insensitive label alternation covers `password`/`passwd`/`pwd`, `api key`/`api_key`, `access key`, `secret`/`secret key`/`client secret`, `webhook secret`/`webhook_secret`, `token`, `authorization`/`auth`, `cookie`, `mfa`/`mfa code`, `recovery code`/`recovery_code`, `credential`, and `private key`. Two passes run after the existing email and shaped-secret passes:

- **delimited** (`label = value` / `label: value`): the value (any non-space run) is replaced with the fixed censor;
- **whitespace** (`label value`): a value of 6+ characters is censored, which catches `password hunter2secret` while sparing short prose like `token was refreshed`.

Only the value is replaced — the label and delimiter are kept for readability, and **no captured value is ever echoed**. Ordering matters and is documented: emails hash first, then shaped secrets (so `authorization: Bearer <token>` loses the whole token via the `Bearer` pattern, not just up to the first space), then the labelled passes.

### 2. Native Error diagnostics stay closed

`redactError` continues to run message and stack through this same, now-stronger `redactSecretsInText`, so a labelled or shaped secret in untrusted Error text is censored while the Error class name (`type`), redacted `cause`, and redacted enumerable properties are preserved. This keeps the previously approved behavior (email in an Error message still degrades to `domain#hash`, proven by the retained existing test) while adding labelled-secret coverage — the alternative the decision permits, now backed by tests for the required patterns and the same no-leak invariant. The depth-cap censoring, cycle-safe identity tracking, `serializers.err`, and Error-aware `logMethod` from the prior correction are unchanged.

## Proof — actual Pino output (`packages/shared/src/logging.test.ts`)

Two new real-Pino capture tests were added and all prior ones retained:

- **direct `logger.error(new Error(...))`** whose message carries generic `password=…` and `token=…` values — neither value appears in serialized output; `[REDACTED]` and the `Error` class do;
- **ordinary `logger.info`/`logger.warn` message strings** carrying labelled `cookie` (`session=…`), `authorization=Basic …`, `api_key=…`, `mfa_code=…`, `recovery_code=…`, and `webhook_secret=…` values — none of the six synthetic secrets survives;
- unchanged and still green: the deep 10-level object/array secret, the `tzl_live_` direct-Error fixture, the Error `cause`/enumerable-property case, email hashing, the `api_key_id` correlation-field-survives case, and the cyclic-object case.

The API's full check-flow hardening test (real `buildApp` logger) also continues to pass.

## Files changed (correction only)

`packages/shared/src/logging.ts` (labelled-secret passes in `redactSecretsInText`) · `packages/shared/src/logging.test.ts` (+2 real-Pino labelled tests). No production code outside the redaction module changed; no new dependencies.

## Verification results

`pnpm db:test:prepare` ✓ · shared redaction tests ✓ (**69**, +2) · API hardening + auth tests ✓ · `pnpm secret-scan` ✓ clean (363 files) · copy lint ✓ · `pnpm -r build` ✓ · `pnpm -r test` ✓ **584** (core 177, shared 69, db 71, api 169, worker 59, dashboard 32, web 26) · `pnpm test:scripts` ✓ **5** · `pnpm lint` ✓ · `pnpm -r typecheck` ✓ · `pnpm format:check` ✓ after build · `git diff --check` ✓. Benchmarks were **not** rerun — benchmark code was out of scope and the previously recorded `bench/RESULTS.md` figures remain valid. **`NOT_RUN`** (carried, unchanged): the GitHub Actions workflow itself and Lighthouse.

## Note for PM review

- The whitespace-delimited labelled pass censors 6+ character values after a secret label; this can, in rare cases, censor a non-secret word that follows such a label in prose (e.g. `authorization required` → the word after the label). That is a safe over-redaction (no leak, occasional noise), deliberately biased toward closing leaks — flagged as a judgment call.

## Carry-forward pre-production gates (unchanged, still blocking)

- The Next.js/React framework upgrade in `docs/PRE-PRODUCTION-GATES.md` remains blocking before Phase 9 deployment or public beta; no framework upgrade was performed here.
- CI stays `NOT_RUN` until a later explicitly authorized branch push; Lighthouse remains a Phase 9 deployment gate.

## Git status

`feat/phase-8-hardening`, all Step 8.1 work (implementation + all three corrections) local and uncommitted on top of `edf29a8`. No PR exists. Awaiting PM review; Git sync only on an explicit authorization.
