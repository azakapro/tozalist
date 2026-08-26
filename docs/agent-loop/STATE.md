# PM–CTO Relay State

- Status: `ready_for_cto`
- Current step: `8.4`
- Current step title: Backend dependency-security remediation (approved for Git handoff)
- Owner: Claude Code (CTO)
- Completed through: Step `8.3` merged into `origin/main` at `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66`. Step `8.4` with the three PM-required corrections applied locally on `feat/backend-dependency-security` (HEAD still at that exact base; nothing staged, committed, or pushed — the branch does not exist on the remote).
- Corrections applied and re-verified:
  1. **Duplicate/stale direct `drizzle-orm` declarations removed** — now exactly three, all exact `0.45.2`: `apps/api` → `dependencies` (runtime import in `src/cli/billing-statement.ts`), `apps/worker` → `devDependencies` (test-only imports; no runtime dependency), `packages/db` → `dependencies`; lockfile regenerated through pnpm only.
  2. **Fastify 5 logging migration completed** — moved `disableRequestLogging: true` and `requestIdLogLabel: 'request_id'` from deprecated top-level options into the official `LogController` configuration in `apps/api/src/app.ts`; `FSTDEP023`/`FSTDEP024` eliminated; built-in request logging still suppressed and custom `request_id` line and redaction behavior preserved.
  3. **Phone-check/email-check/batch expiry fixtures made durable** — replaced injected-clock `NOW_MS + 30 * DAY_MS` with real-clock `rowExpiry(days)` helper in `seedOrgData`, `seedEmailCheck`, and all row expiry fields; rows now never prematurely expire (always relative to real clock, always in the future at any run date); expired-row assertion preserved.
- Last verified test total: **624 workspace tests** (core 186, shared 69, DB 71, API 179, worker 59, dashboard 32, web 28) + **5 root tooling-script tests** + **500/500** accuracy fixtures. Independent PM verification also passed guarded `tozalist_test` preparation, API **179/179** without `FSTDEP023`/`FSTDEP024`, DB **71/71**, production audit with no known vulnerabilities, and `git diff --check`. Remote CI remains `NOT_RUN` until the authorized push.
- Last verification: PM, 2026-08-26
- Next action: Perform only the authorized Step 8.4 atomic commit, push `feat/backend-dependency-security`, create the exact draft PR, record the handoff in the relay, set state to `awaiting_pm_review`, and stop. Do not merge or begin another step.

Do not begin Phase 9, CSV formula hardening, Lighthouse work, deployment, public beta, production SMTP, real-customer-data processing, payment-provider work, or legal/privacy-policy changes until the PM records its approval.
