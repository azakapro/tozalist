# PM–CTO Relay State

- Status: `ready_for_cto`
- Current step: `8.5`
- Current step title: Batch-result CSV formula hardening (approved for Git handoff)
- Owner: Codex orchestration
- Completed through: Step `8.4` merged by PR #8 into `origin/main` at `ead04597ae99bb0b1c32f993d6806809bbf2fdc6`; the approved Step 8.4 commit `1af38f7d2927f50627ee2d18443777e3ff01c532` is its second parent and ancestor. All four backend advisories are remediated and both remote CI gates passed.
- Corrections applied and re-verified:
  1. **Duplicate/stale direct `drizzle-orm` declarations removed** — now exactly three, all exact `0.45.2`: `apps/api` → `dependencies` (runtime import in `src/cli/billing-statement.ts`), `apps/worker` → `devDependencies` (test-only imports; no runtime dependency), `packages/db` → `dependencies`; lockfile regenerated through pnpm only.
  2. **Fastify 5 logging migration completed** — moved `disableRequestLogging: true` and `requestIdLogLabel: 'request_id'` from deprecated top-level options into the official `LogController` configuration in `apps/api/src/app.ts`; `FSTDEP023`/`FSTDEP024` eliminated; built-in request logging still suppressed and custom `request_id` line and redaction behavior preserved.
  3. **Phone-check/email-check/batch expiry fixtures made durable** — replaced injected-clock `NOW_MS + 30 * DAY_MS` with real-clock `rowExpiry(days)` helper in `seedOrgData`, `seedEmailCheck`, and all row expiry fields; rows now never prematurely expire (always relative to real clock, always in the future at any run date); expired-row assertion preserved.
- Last verified test total: **625 workspace tests** (core 186, shared 69, DB 71, API 179, worker **60**, dashboard 32, web 28). Step 8.5 additionally passes frozen install, production audit with no known vulnerabilities, secret scan, copy lint, guarded `tozalist_test` preparation, worker build/typecheck, lint, format, and diff check. The existing 1k-versus-50k streaming memory assertion remains green.
- Last verification: PM/Codex local review, 2026-08-26
- Next action: Perform only the exact six-path Step 8.5 commit, feature-branch push, and draft PR authorized in the newest PM decision; record the handoff, set state to `awaiting_pm_review`, and stop. Do not merge, deploy, or begin Step 9.

Do not begin Phase 9, Lighthouse work, deployment, public beta, production SMTP, real-customer-data processing, payment-provider work, or legal/privacy-policy changes until the PM records its approval.
