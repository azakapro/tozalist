# PM Decision

## Step 8.5 local approval and Git handoff — 2026-08-26

- Decision: `APPROVED`
- Baseline: `feat/batch-csv-formula-hardening` at exact merged main `ead04597ae99bb0b1c32f993d6806809bbf2fdc6`.
- Actual diff: `PASS — exactly six paths: worker serializer, focused worker integration test, pre-production gate record, and the three relay files.`
- Security behavior: `PASS — actual produced CSV is parsed cell-by-cell; all six formula triggers are apostrophe-neutralized in hostile headers and data, quoted/comma content remains valid, ordinary cells are unchanged, and the stored input is byte-identical.`
- Regression evidence: `PASS — worker 60/60; workspace 625/625; 50k streaming memory assertion; frozen install, production audit, secret scan, copy lint, guarded test DB preparation, build, typecheck, lint, format, and diff check.`
- Drift/scope: `PASS — no dependency, package manifest, lockfile, schema, migration, deployment, SMTP, payment, Lighthouse implementation, or unrelated change.`

### Authorized Git handoff

1. Stage and commit exactly these six paths:
   - `apps/worker/src/batch/processor.ts`
   - `apps/worker/src/batch/batch.integration.test.ts`
   - `docs/PRE-PRODUCTION-GATES.md`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`
2. Use the exact commit message:

   ```text
   security: neutralize batch result formulas
   ```

3. Push only `feat/batch-csv-formula-hardening` to origin; do not alter `main`.
4. Create one draft PR into `main` titled:

   ```text
   Release gate: harden batch result CSV cells
   ```

   The body must summarize the six formula triggers, parsed-cell/input-preservation
   evidence, 60 worker tests, 625 workspace tests, clean audit, unchanged streaming
   behavior, and remaining Lighthouse/metrics/legal gates. State that manual
   product-owner merge is required.
5. Do not merge. Record the commit/PR/remote-CI-pending evidence in the relay as
   uncommitted post-handoff edits, set state to `awaiting_pm_review`, and stop.

### State transition

- State status: `ready_for_cto`
- Current step: `8.5`
- Owner: `Codex orchestration for the approved mechanical handoff`
- Next action: `Create only the exact Step 8.5 commit, feature push, and draft PR; then stop for remote CI review.`

## Step 8.4 merge verification and Step 8.5 authorization — 2026-08-26

### Step 8.4 merge verification

- Decision: `APPROVED`
- PR #8: `MERGED` at `2026-08-26T15:47:22Z`.
- Merged main: `origin/main` is merge commit `ead04597ae99bb0b1c32f993d6806809bbf2fdc6`, whose parents are the prior main `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66` and approved Step 8.4 commit `1af38f7d2927f50627ee2d18443777e3ff01c532`.
- Ancestry: `1af38f7` is confirmed reachable from `origin/main`.
- Step 8.4 status: `COMPLETE`.

### Step 8.5 — batch-result CSV formula hardening

- Decision: `APPROVED`
- Owner: `Claude Code (CTO)`
- Execution mode: `Local implementation and verification only; no commit, push, PR, merge, deployment, or Step 9 work in this action.`
- Fast-launch priority: `This is the final small code-level security gate before the synthetic-data deployment track. Lighthouse optimization and extended beta documentation are deferred; legal approval remains mandatory before real customer data.`

#### Authorized scope

1. Preserve the three uncommitted relay files, switch/create `feat/batch-csv-formula-hardening` from exact `origin/main` commit `ead04597ae99bb0b1c32f993d6806809bbf2fdc6`, and carry only the relay records forward before implementation. Stop on any baseline or worktree discrepancy.
2. Harden `apps/worker/src/batch/processor.ts` so every string cell written to a batch **result** CSV is neutralized before ordinary CSV quoting when its first character is `=`, `+`, `-`, `@`, tab, or carriage return. Prefix one apostrophe, matching the already-proven self-service export behavior. This includes customer-controlled original data and headers; do not alter the stored input CSV.
3. Preserve valid CSV round-tripping, quotes, commas, newlines, Unicode, ordinary values, output column order, streaming/constant-memory behavior, credit accounting, cache/deduplication, malformed-row behavior, refunds, storage keys, and webhook behavior. Do not buffer the result in memory.
4. Add focused worker regression coverage using actual produced result CSV data. Cover every dangerous leading character, quoted/comma-containing formula cells, hostile header cells, ordinary values unchanged, and proof that the original uploaded CSV is unchanged. Parse or otherwise assert cells precisely enough that quoting cannot create a false pass.
5. Update `docs/PRE-PRODUCTION-GATES.md` only after evidence passes: mark gate #3 remediated with the test evidence, and correct stale gate #1 to record the already-merged Step 8.3 Next.js 16/React 19 remediation. Do not modify other gate requirements.
6. No new dependency, lockfile change, schema/migration change, generated deployment file, Lighthouse implementation, SMTP change, payment work, or unrelated cleanup is authorized.

#### Required verification

Run and report exact exit status and totals for:

1. `pnpm install --frozen-lockfile`
2. `pnpm security:audit`
3. `pnpm secret-scan`
4. `pnpm web:lint-copy`
5. `pnpm db:test:prepare`
6. `pnpm --filter @tozalist/worker build`
7. `pnpm --filter @tozalist/worker typecheck`
8. `pnpm --filter @tozalist/worker test`
9. `pnpm -r test`
10. `pnpm lint`
11. `pnpm format:check`
12. `git diff --check`

Also prove no dependency, lockfile, schema, or migration file changed and that nothing is staged, committed, or pushed.

#### Acceptance criteria

- Every formula trigger is inert in actual batch result cells, including hostile headers and quoted/comma-containing input.
- Ordinary cells and the input object are byte-preserved; valid output CSV remains parseable and the pipeline remains streaming.
- Focused worker and full workspace suites pass with security audit clean.
- Gate documentation is accurate; all other launch blockers remain explicit.
- `CTO-REPORT.md` and `STATE.md` contain exact evidence; state returns to `awaiting_pm_review` with PM ownership; Claude stops.

### State transition

- State status: `ready_for_cto`
- Current step: `8.5`
- Owner: `Claude Code (CTO)`
- Next action: `Implement and verify only the bounded batch-result CSV formula hardening, report, and stop.`

## Step 8.4 remote verification — 2026-08-26

- Decision: `APPROVED`
- Pull request: `#8 — Release gate: remediate backend dependency advisories`.
- Remote commit: `1af38f7d2927f50627ee2d18443777e3ff01c532`, one commit with parent `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66` and the exact approved message.
- Remote diff: `PASS — exactly the 29 PM-authorized paths; no extra file.`
- Remote CI: `PASS — both the push-event gates job (run 32981390832) and pull-request gates job (run 32981433826) completed successfully on the approved commit.`
- PR state: `OPEN, DRAFT, UNMERGED`, base `main`, head `feat/backend-dependency-security`; exact approved title and body.
- Scope: `PASS — no deployment, production SMTP, real customer data, payment-provider, schema/migration, Phase 9, or unrelated work.`

### Product-owner action

The Step 8.4 implementation and remote evidence are approved for manual merge. The product owner may mark PR #8 ready and merge it into `main`. Codex/Claude must not perform that merge without a separate direct instruction from the product owner. After the owner merges, PM must fetch and verify `origin/main` before authorizing the next launch-critical step.

### State transition

- State status: `awaiting_owner_merge`
- Current step: `8.4`
- Owner: Product owner
- Next action: `Product owner manually merges approved PR #8; PM then verifies origin/main and selects the shortest safe launch-critical next step.`

## Step 8.4 correction approval and Git handoff — 2026-08-26

- Decision: `APPROVED`
- Step ID: `8.4` — Backend dependency-security remediation.
- Local implementation review: `PASS — all three requested corrections are present: exactly three direct drizzle-orm declarations at exact 0.45.2 with correct runtime/development placement; Fastify LogController replaces deprecated top-level logging options; real-clock row-expiry fixtures remove the latent date failure.`
- Independent PM verification: `PASS — pnpm security:audit exits 0 with "No known vulnerabilities found"; guarded tozalist_test preparation exits 0; API passes 179/179 with no FSTDEP023/FSTDEP024 output; DB passes 71/71; git diff --check is clean; HEAD and origin/main both equal 91ce3ae7d5ddd6543d308d78c6c8110ec1222a66; nothing is staged.`
- Full CTO verification accepted subject to remote CI: `624 workspace tests, 5 tooling-script tests, and 500/500 accuracy fixtures; install/frozen install, audit, secret scan, copy lint, build, typecheck, lint, format, and whitespace gates pass. Remote CI remains NOT_RUN and is mandatory before merge.`

### Authorized Git handoff

Perform only this handoff on `feat/backend-dependency-security`:

1. Confirm the worktree contains exactly these 29 reviewed paths and no staged files:
   - `.github/workflows/ci.yml`
   - `THIRD_PARTY_LICENSES/drizzle-orm-Apache-2.0.txt`
   - `THIRD_PARTY_LICENSES/fastify-MIT.txt`
   - `THIRD_PARTY_LICENSES/fastify-cookie-MIT.txt`
   - `THIRD_PARTY_LICENSES/fastify-helmet-MIT.txt`
   - `THIRD_PARTY_LICENSES/fastify-multipart-MIT.txt`
   - `THIRD_PARTY_LICENSES/fastify-plugin-MIT.txt`
   - `THIRD_PARTY_LICENSES/fastify-static-MIT.txt`
   - `THIRD_PARTY_LICENSES/fastify-swagger-MIT.txt`
   - `THIRD_PARTY_LICENSES/fastify-swagger-ui-MIT.txt`
   - `apps/api/package.json`
   - `apps/api/src/app.ts`
   - `apps/api/src/fastify5-security.integration.test.ts`
   - `apps/api/src/lifecycle.integration.test.ts`
   - `apps/api/src/openapi.integration.test.ts`
   - `apps/api/src/plugins/foundation.ts`
   - `apps/worker/package.json`
   - `docs/PRE-PRODUCTION-GATES.md`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`
   - `package.json`
   - `packages/db/package.json`
   - `packages/db/src/billing.ts`
   - `packages/db/src/credits.integration.test.ts`
   - `packages/db/src/errors.ts`
   - `packages/db/src/index.ts`
   - `packages/db/src/lifecycle.integration.test.ts`
   - `pnpm-lock.yaml`
2. Create one atomic commit containing exactly those paths with this exact message:

   ```text
   security: upgrade Fastify and Drizzle
   ```

3. Push only `feat/backend-dependency-security` to `origin`. Do not alter `main`.
4. Create exactly one draft pull request into `main` with this exact title:

   ```text
   Release gate: remediate backend dependency advisories
   ```

   Use this PR body:

   ```md
   ## Summary

   - Upgrades Fastify, its compatible plugin set, and Drizzle to stable exact-pinned patched versions, clearing all four recorded high-severity production advisories without overrides or schema/migration drift.
   - Preserves the API, OpenAPI, authentication, tenant-isolation, ledger, logging, and error-envelope contracts, including compatibility fixes for Fastify framework errors and Drizzle's wrapped error cause chain.
   - Adds focused security regressions, verbatim license records, and a blocking production-dependency audit in CI.

   ## Verification

   - 624 workspace tests plus 5 tooling-script tests pass locally; the accuracy corpus remains 500/500.
   - Production audit reports no known vulnerabilities; frozen install, build, typecheck, lint, format, secret scan, copy lint, test-database preparation, and whitespace checks pass.
   - API passes 179/179 without FSTDEP023/FSTDEP024; DB passes 71/71; no schema or migration changed.

   ## Remaining launch work

   - Remote CI on this commit is required before merge.
   - This PR does not deploy, enable SMTP, process real customer data, begin Phase 9, or complete the remaining launch gates.

   Manual merge by the product owner only.
   ```

5. Do not merge. After creating the draft PR, update `CTO-REPORT.md` with the commit hash, remote branch, PR number/URL, exact-path confirmation, draft/unmerged status, and remote CI as pending. Set `STATE.md` to `awaiting_pm_review` with PM ownership and remote PR/CI review as the only next action. Leave those post-handoff relay edits uncommitted and stop.

### State transition

- State status: `ready_for_cto`
- Current step: `8.4`
- Owner: `Claude Code (CTO)`
- Next action: `Perform only the authorized Step 8.4 commit, feature-branch push, and draft-PR handoff, then stop.`

## Step 8.4 initial PM review — 2026-08-26

- Decision: `CORRECTION_REQUIRED`
- Step ID: `8.4` — Backend dependency-security remediation.
- Scope reviewed: `The complete local 29-path worktree diff on feat/backend-dependency-security against origin/main 91ce3ae7d5ddd6543d308d78c6c8110ec1222a66; nothing is staged or committed.`
- Independent evidence: `PASS WITH CORRECTIONS — pnpm security:audit exits 0 with "No known vulnerabilities found"; the API suite passes 179/179 and the DB suite passes 71/71. The patched resolved versions, behavioral security coverage, universal framework-error envelope, Drizzle cause-chain handling, schema/migration non-drift, CI audit gate, and license records are substantively in scope.`

### Required corrections

1. Remove both stale direct `drizzle-orm: ^0.38.3` declarations. `apps/api/package.json` currently declares Drizzle twice; retain one exact `0.45.2` runtime dependency because `src/cli/billing-statement.ts` imports it. `apps/worker/package.json` also declares it twice; retain one exact `0.45.2` development dependency because only integration tests import it, and remove the unnecessary runtime dependency. Regenerate `pnpm-lock.yaml` only through pnpm and prove all direct Drizzle declarations are exact `0.45.2` with no stale range.
2. Complete the Fastify 5 logging migration. The independent 179-test API run emits repeated `FSTDEP023` and `FSTDEP024` warnings because `disableRequestLogging` and `requestIdLogLabel` remain deprecated top-level Fastify options. Move both values into the official `LogController`/`logController` configuration, preserving disabled built-in request logging, the `request_id` label, the existing custom one-line request logging, and redaction behavior. The focused/API verification output must contain neither warning.
3. Replace the changed `NOW_MS + 30 * DAY_MS` phone-check expiry workaround with a durable fixture. The DELETE route calls `deletePhoneCheckForOrg` without an injected clock, so the DB helper defaults to the real `new Date()`; adding 30 days merely postpones the same failure. Keep this test-only and make the owned phone fixture unexpired relative to the real wall clock (or otherwise permanently deterministic), while retaining the explicit expired-row assertion. Correct the CTO report's explanation so it does not claim this path reads only the injected clock.

### Re-verification and reporting

- Re-run all 14 Step 8.4 commands in the authorized order and report exact exit codes and totals. In addition, explicitly report the absence of `FSTDEP023`/`FSTDEP024`, list every final direct `drizzle-orm` declaration with dependency section and exact version, and re-prove the four advisory IDs absent from the final production tree.
- Update `CTO-REPORT.md` and set `STATE.md` back to `awaiting_pm_review` with PM ownership, then stop. Do not stage, commit, push, create a PR, merge, deploy, begin Phase 9, or change any scope outside these corrections.

### State transition

- State status: `correction_required`
- Current step: `8.4`
- Owner: `Claude Code (CTO)`
- Next action: `Apply only the three Step 8.4 corrections above, run the complete verification set, report, and stop.`

## Step 8.4 authorization — backend dependency-security remediation

- Decision: `APPROVED`
- Roadmap-order correction: `Insert this bounded pre-production security gate as Step 8.4 between the completed Step 8.3 framework-support gate and Step 9.1. This explicit decision changes the order only by adding Step 8.4; Step 9.1 remains locked.`
- Owner: `Claude Code (CTO)`
- Execution mode: `Local implementation and verification only. No commit, push, pull request, merge, deploy, or Phase 9 work is authorized.`

### Authorized scope

1. Preserve the uncommitted relay records, fetch `origin/main`, and create/switch to a fresh local branch named `feat/backend-dependency-security` from verified `origin/main` merge commit `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66`. If `origin/main`, the branch base, or the pre-existing worktree differs, stop and report the discrepancy rather than improvising.
2. Upgrade Fastify from 4.x to an exact-pinned stable Fastify 5 release that is at least `5.7.2` and below 6. Do not use prerelease, alpha, beta, release-candidate, `latest` ranges, carets, or tildes for the upgraded security-sensitive dependency set.
3. Upgrade every directly used Fastify plugin to an exact-pinned stable version officially compatible with Fastify 5, including `@fastify/cookie` (Fastify-5-compatible major), `@fastify/helmet` (Fastify-5-compatible major), `@fastify/multipart`, `@fastify/swagger` (9.x or later stable Fastify-5-compatible release), `@fastify/swagger-ui` (Fastify-5-compatible release), and `fastify-plugin` where required. The resolved tree must contain patched `find-my-way >=9.7.0` and patched `@fastify/static >=10.1.1`; do not add a forced override merely to hide an incompatible plugin tree.
4. Upgrade every direct `drizzle-orm` declaration consistently to an exact-pinned stable version `>=0.45.2` and `<1.0.0`. Upgrade `drizzle-kit` only if compatibility requires it, and then pin it exactly and document why. Do not change the schema or generate a new migration unless a genuine compatibility defect requires it; any schema/migration change is a blocker requiring PM review before proceeding.
5. Make only compatibility changes required by Fastify 5, the compatible plugin set, and patched Drizzle. Follow the Fastify v5 migration contract, including full JSON schemas for request and response validation. Preserve every route, HTTP status, universal error envelope, request ID, authentication rule, rate limit, credit transaction, cache behavior, OpenAPI 3.1 document, Swagger UI route, session/MFA/CSRF behavior, batch streaming limit, webhook SSRF protections, security header, log-redaction rule, and retention/deletion behavior.
6. Add focused regression coverage for the affected boundaries. At minimum: malformed/tabbed `Content-Type` cannot bypass body validation; malformed or unknown payloads still use the universal envelope and never become a 500; Swagger UI/static asset traversal and route-guard attempts disclose no files; all registered routes remain schema-backed and present in OpenAPI; cross-organization and authentication behavior remains unchanged; and no user-controlled runtime value reaches a dynamic Drizzle identifier or alias. Tests must assert behavior, not dependency version strings alone.
7. Add a root production-dependency audit command and a blocking CI gate using `pnpm audit --prod --audit-level=high`. The command must fail on any high or critical production advisory. Do not suppress, ignore, allowlist, or downgrade an advisory to make the gate pass.
8. Update `pnpm-lock.yaml` only through pnpm. Add or refresh verbatim license records for every direct dependency whose package/version is added or materially upgraded in this step, including missing direct Fastify and Drizzle records. Do not copy license text from unofficial sources.
9. Update `docs/PRE-PRODUCTION-GATES.md` only after the evidence passes: mark gate #5 remediated with exact resolved versions and audit evidence, while retaining the remaining Lighthouse, CSV formula-hardening, metrics, and legal gates.

### Required verification

Claude must run and report every command below with exact exit status and totals:

1. `pnpm install`
2. `pnpm install --frozen-lockfile`
3. The new root production-audit command, proving zero high/critical production advisories
4. `pnpm secret-scan`
5. `pnpm web:lint-copy`
6. `pnpm db:test:prepare`
7. `pnpm -r build`
8. `pnpm -r typecheck`
9. `pnpm -r test`
10. `pnpm test:scripts`
11. `pnpm core:bench` with 500/500
12. `pnpm lint`
13. `pnpm format:check`
14. `git diff --check`

Also record the resolved versions of `fastify`, `find-my-way`, `drizzle-orm`, `@fastify/static`, and every directly upgraded Fastify plugin. Inspect the final production dependency tree and confirm the four advisories recorded in gate #5 are absent. Remote CI is `NOT_RUN` until a later PM-authorized push and must not be claimed.

### Acceptance criteria

- All four recorded production advisories are absent, and the blocking production audit exits successfully with no high or critical advisory.
- Fastify 5 and its plugins are officially compatible, stable, exact-pinned, and preserve the complete API/OpenAPI/session/security contract.
- Drizzle is patched without schema drift, migration drift, tenant isolation regression, ledger regression, or unsafe dynamic identifier flow.
- Focused security regressions and the complete existing suite pass; no existing test is weakened, skipped, deleted, or rewritten merely to accommodate a break.
- Dependency and lockfile changes contain no unrelated upgrades; required license texts are verbatim and recorded.
- `docs/PRE-PRODUCTION-GATES.md`, `CTO-REPORT.md`, and `STATE.md` accurately report evidence and remaining gates.

### Explicit permissions and prohibitions

- Authorized: fetch `origin/main`; create/switch the local branch `feat/backend-dependency-security`; install the bounded dependencies above; modify only files necessary for this remediation, its tests, audit CI gate, licenses, and relay/reporting documentation.
- Not authorized: commit, push, create a PR, merge, deploy, enable production SMTP, process real customer data, change payment providers, change legal/privacy policy, alter database schema/data, run destructive commands, weaken security controls, suppress audit findings, begin CSV formula hardening, run the Lighthouse gate as implementation work, or begin Step 9.1.

### State transition

- State status: `ready_for_cto`
- Current step: `8.4`
- Owner: `Claude Code (CTO)`
- Next action: `Implement and verify Step 8.4 only, report, set awaiting_pm_review, and stop.`

## Step 8.3 remote verification and merge — 2026-08-26

- Step ID: `8.3` — Supported Next.js/React upgrade release gate.
- Decision: `APPROVED`
- Actual remote diff reviewed: `YES — commit 71cf4b6e63ac2596a24c87e7b3f82f25f7a66d59 has parent d06218ee72cce872945bcee0b7dd2156be66d008 and exactly the 27 authorized paths.`
- Pull request reviewed: `YES — PR #7 used the exact approved title and body, base main, head feat/framework-support-next16, and remained draft/unmerged during the CTO handoff.`
- Remote verification: `PASS — both the push run 32943609504 and pull-request run 32943637741 completed successfully on 71cf4b6. Their gates passed install, secret scan, banned-copy lint, lint, test-database creation, build, typecheck, the complete test suite, tooling tests, the 500/500 accuracy corpus, format, and whitespace checks.`
- Merge verification: `PASS — the product owner manually merged PR #7. The fetched origin/main now points to merge commit 91ce3ae7d5ddd6543d308d78c6c8110ec1222a66, and 71cf4b6 is its ancestor.`
- Scope verification: `PASS — exact framework pins, async route-parameter migration, generated-file handling, regression tests, licenses, and the lockfile are in scope. Backend package versions did not change; no Phase 9, deployment, production SMTP, real customer data, payment-provider, or legal-policy work was included.`
- Rationale: `The implementation, remote handoff, CI gates, and manual merge all match the approved Step 8.3 scope. The supported-framework release gate is complete. This approval does not waive the separately recorded pre-production blockers.`

### Carry-forward blockers before Step 9.1

Step `9.1` is not yet authorized. `STATE.md` is moved to `blocked` with PM ownership until the PM explicitly scopes and approves the remaining work in `docs/PRE-PRODUCTION-GATES.md`:

1. Backend dependency-security remediation for the four recorded high-severity Fastify/Drizzle-chain advisories.
2. Batch-result CSV formula neutralization with regression coverage.
3. A real Lighthouse audit demonstrating the required performance and accessibility targets.
4. Production metrics credential/bind requirements as an operational deployment constraint.
5. Uzbekistan-qualified legal review before any real customer data is processed.

No commit, push, deployment, public beta, production SMTP, real-customer-data processing, dependency remediation, payment-provider work, or legal/privacy-policy finalization is authorized by this record.

### State transition

- State status: `blocked`
- Current step: `9.1` (not yet authorized)
- Owner: PM
- Next action: `PM defines and approves one bounded pre-production gate at a time before releasing Step 9.1 to Claude Code.`

## Phase 8 completion and remote verification

- Step ID: `8.2` — Accuracy regression corpus.
- Acceptance: `PASS — exactly 500 deterministic synthetic fixtures; every fixture self-identifies the evaluated stub address; genuine non-ASCII Unicode, punycode IDN, and long-address coverage; reserved .invalid/.test non-existent-domain cases; no DNS or engine/network access; 100% pass/fail regression gate using the real local aggregation pipeline; CI wired; documentation clearly limits the result to logic correctness.`
- Evidence: `pnpm core:bench passes 500/500 with a diagonal verdict matrix and 100% precision/recall for every email reason code, and exits non-zero when a label is deliberately corrupted. Independent PM verification passed pnpm -r test: 612 workspace tests (core 186, shared 69, db 71, api 169, worker 59, dashboard 32, web 26); secret scan, copy lint, build, lint, typecheck, tooling tests, format-after-build, and diff check also passed. The standalone DB-preparation command requires DATABASE_URL_TEST, which is intentionally absent in this PM shell; the integration suite and CI define it.`
- Scope, privacy, accounting, and retention: `PASS — corpus data is synthetic and stub-only. No customer data, payment, ledger, retention, deployment, SMTP, or legal-policy behavior changed. tsx is a dev-only MIT dependency with a verbatim license record. Bench code is typechecked/tested but excluded from product dist.`
- Remote CI: `PASS — the push and pull-request runs for final commit 11921830d16e1c9791ad978820cdaa82da67a596 both completed successfully, including the accuracy-regression gate.`
- Pull request: `#6 — Phase 8: security hardening and accuracy regression gate — was manually merged by the product owner.`
- Merged main: `d06218ee72cce872945bcee0b7dd2156be66d008`, fetched and confirmed as `origin/main`.

## Decision

- Decision: `APPROVED`
- Rationale: `Step 8.3 meets its framework-support acceptance scope. The Next.js/React upgrade, async route-parameter migration, exact framework dependency pins, generated-file handling, licenses, and regression coverage are all in scope and pass independent PM verification. The corrected disclosure accurately records four pre-existing high-severity backend advisories and registers their remediation as a separate blocking pre-production gate; this approval does not waive or remediate those advisories.`

## Explicit Step 8.3 Git handoff

Remain on `feat/framework-support-next16`. Perform only this handoff; do not begin Phase 9 or the backend dependency-security remediation.

1. Before staging, confirm the working-tree change set is exactly these 27 reviewed paths:

   - `.prettierignore`
   - `THIRD_PARTY_LICENSES/next-MIT.txt`
   - `THIRD_PARTY_LICENSES/next-mdx-MIT.txt`
   - `THIRD_PARTY_LICENSES/react-MIT.txt`
   - `THIRD_PARTY_LICENSES/react-dom-MIT.txt`
   - `apps/dashboard/next-env.d.ts`
   - `apps/dashboard/package.json`
   - `apps/web/app/[locale]/contact/page.tsx`
   - `apps/web/app/[locale]/docs/glossary/page.tsx`
   - `apps/web/app/[locale]/docs/limitations/page.tsx`
   - `apps/web/app/[locale]/docs/page.tsx`
   - `apps/web/app/[locale]/docs/quickstart/page.tsx`
   - `apps/web/app/[locale]/docs/reference/page.tsx`
   - `apps/web/app/[locale]/docs/webhooks/page.tsx`
   - `apps/web/app/[locale]/page.tsx`
   - `apps/web/app/[locale]/privacy/page.tsx`
   - `apps/web/app/[locale]/prohibited-use/page.tsx`
   - `apps/web/app/[locale]/terms/page.tsx`
   - `apps/web/next-env.d.ts`
   - `apps/web/package.json`
   - `apps/web/tests/async-params.test.tsx`
   - `apps/web/tests/pricing-plans.test.tsx`
   - `docs/PRE-PRODUCTION-GATES.md`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`
   - `pnpm-lock.yaml`

2. Create one atomic commit containing exactly those paths with this exact message:

   ```text
   web: upgrade to Next 16 and React 19
   ```

3. Push only `feat/framework-support-next16` to `origin`. Do not push or alter `main`.
4. Create exactly one draft pull request into `main` with this exact title:

   ```text
   Release gate: upgrade to Next.js 16 and React 19
   ```

   Use this PR body:

   ```md
   ## Summary

   - Upgrades the dashboard and public site from unsupported Next.js 14 / React 18 to exact-pinned Next.js 16.3.3 / React 19.2.8.
   - Migrates all localized App Router pages to asynchronous `params` while preserving 38 static pages, locale routing, metadata, MDX, pricing, and the generated API reference.
   - Re-proves CSP/security headers, dashboard authentication-related suites, the public lead form, and framework-specific regression coverage.
   - Records required license texts and a generated-file formatting exception.

   ## Verification

   - 614 workspace tests plus 5 tooling-script tests pass locally.
   - Frozen install, copy lint, synthetic accuracy gate (500/500), full build, lint, typecheck, format, secret scan, and whitespace checks pass.
   - The upgrade's focused Next/React security review is clean; remote CI on this commit remains required before merge.

   ## Remaining launch gates

   - Lighthouse audit target, batch-result CSV formula neutralization, and the newly documented backend dependency-security remediation remain blocking before any deployment or public beta.
   - The backend advisory remediation is deliberately separate from this framework upgrade; this PR does not upgrade Fastify or Drizzle.

   Manual merge by the product owner only.
   ```

5. Do not merge the PR. After the push and draft-PR creation, record the commit hash, remote branch, and PR URL in `CTO-REPORT.md`; set `STATE.md` to `awaiting_pm_review` with PM ownership and remote-CI/PR verification as the only next action; then stop. These post-handoff relay-record edits remain uncommitted.

No deployment, public beta, production SMTP, real customer data, payment-provider work, legal-policy finalization, or backend dependency remediation is authorized.

## State transition

- State status: `ready_for_cto`
- Current step: `8.3`
- Owner: `Claude Code`
- Next action: `Perform only the authorized Step 8.3 commit, feature-branch push, and draft-PR handoff, then stop for PM remote verification.`
