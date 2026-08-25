# PM Decision

## Review

- Step ID: `7.2` — Pilot billing, including the authoritative manual-grant correction.
- Baseline checked: `YES — all reviewed Step 7.2 work is local on feat/phase-7-lifecycle-billing above the synchronized Step 7.1 commit 17f9055.`
- Scope checked: `PASS — the implementation remains invoice-and-ledger billing only. There is no Click/Payme/provider SDK, checkout, card processing, payment webhook, merchant credential, production action, or legal/privacy-policy change.`
- Accounting correction: `PASS — grantCreditsWithAudit now validates a positive safe integer and canonical non-blank note before reference derivation or transaction work; invalid input returns only the fixed invalid_input token. Direct database tests prove negative, zero, fractional, non-finite, oversized, empty, and whitespace-only grants leave zero ledger and audit rows. Trimmed-note replays collide and the stored ledger note is canonical.`
- Privacy and access control: `PASS — invoice creation is admin + MFA + CSRF gated; statement links are scoped to the authenticated organisation, expire after one hour, and their signed URLs are neither logged nor audited. Bank instructions remain environment-only and are absent from audit and log output. Invoice-request rows hold only organisation, requester, plan, and timestamps and are deleted with the organisation purge.`
- Retention decision: `ACCEPTED FOR THIS STEP — before the DRAFT privacy policy is finalized, its data map must explicitly cover invoice-request records and their organisation-lifetime retention. This approval does not authorize any legal-copy change.`
- Plan and statement evidence: `PASS — the three pilot plans are one client-safe core configuration used by both public-web and dashboard rendering; statement boundaries are [start, end), ledger notes are HTML-escaped, statements delete with the organisation prefix, and a test prevents payment-provider dependencies.`
- Verification independently rerun by PM: `PASS — pnpm -r build; pnpm -r test (569 tests: core 177, shared 48, db 71, api 160, worker 55, dashboard 32, web 26); pnpm lint; pnpm -r typecheck; pnpm format:check after build; and git diff --check.`
- Database-preparation note: `A bare pnpm db:test:prepare in the PM shell reports DATABASE_URL_TEST is not exported. The full test run did execute all 71 database tests, including the direct billing integration tests, against the isolated test setup; the CTO separately reports migration preparation passed. This local shell-environment gap does not change the reviewed application behavior, but deployment/CI must provide DATABASE_URL_TEST explicitly wherever that standalone preparation script is used.`

## Decision

- Decision: `APPROVED`
- Rationale: `The focused accounting defect is corrected at the authoritative database boundary, the direct regression evidence is meaningful, and Step 7.2 meets its roadmap acceptance criteria. Together with synchronized Step 7.1, Phase 7 is ready for its single draft pull-request handoff.`

## Explicit Phase 7 Git sync authorization

Claude Code may perform this handoff only. Do not edit product code, begin Step 8.1, merge, deploy, process real data, add a payment provider, or change legal/privacy policy.

1. On `feat/phase-7-lifecycle-billing`, verify the working tree contains exactly these reviewed Step 7.2 paths before staging:

   - `.env.example`
   - `TODO-PAYMENTS.md`
   - `apps/api/package.json`
   - `apps/api/src/app.ts`
   - `apps/api/src/billing.integration.test.ts`
   - `apps/api/src/billing/statement-html.ts`
   - `apps/api/src/cli/billing-grant.ts`
   - `apps/api/src/cli/billing-statement.ts`
   - `apps/api/src/config.ts`
   - `apps/api/src/internal/billing.ts`
   - `apps/api/src/no-payment-provider.test.ts`
   - `apps/dashboard/app/billing/page.tsx`
   - `apps/dashboard/lib/messages.ts`
   - `apps/dashboard/lib/shell.tsx`
   - `apps/dashboard/package.json`
   - `apps/dashboard/tests/billing.test.tsx`
   - `apps/web/app/[locale]/page.tsx`
   - `apps/web/lib/messages.ts`
   - `apps/web/tests/pricing-plans.test.tsx`
   - `apps/worker/src/lifecycle/lifecycle.integration.test.ts`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`
   - `package.json`
   - `packages/core/src/index.ts`
   - `packages/core/src/plans.test.ts`
   - `packages/core/src/plans.ts`
   - `packages/db/drizzle/0007_colossal_bushwacker.sql`
   - `packages/db/drizzle/meta/0007_snapshot.json`
   - `packages/db/drizzle/meta/_journal.json`
   - `packages/db/src/billing.integration.test.ts`
   - `packages/db/src/billing.ts`
   - `packages/db/src/index.ts`
   - `packages/db/src/lifecycle.ts`
   - `packages/db/src/schema/index.ts`
   - `packages/db/src/schema/invoice-requests.ts`
   - `packages/shared/src/index.ts`
   - `packages/shared/src/s3.ts`
   - `pnpm-lock.yaml`

   If the exact set differs, stop without staging or committing.
2. Commit those paths in one atomic commit with this exact message: `billing: add invoice-based pilot billing`.
3. Push only `feat/phase-7-lifecycle-billing` to `origin`. Do not push or modify `main`.
4. Create one **draft** pull request from `feat/phase-7-lifecycle-billing` into `main`, titled `Phase 7: lifecycle controls and pilot billing`. Its body must summarize Steps 7.1–7.2, cite the 569-test verification, state that billing is invoice-and-ledger only with no payment provider, flag the DRAFT privacy-policy data-map prerequisite, and state that the product owner manually merges it.
5. Record the resulting commit hash, remote branch, and PR URL in `CTO-REPORT.md`; set `STATE.md` to `awaiting_pm_review`, owner PM, with remote-handoff verification and product-owner merge as the next actions; then stop.

## Explicit exceptional permissions

- [x] Commit — scope: `Only the exact 39 reviewed Step 7.2 paths listed above, as one atomic commit on feat/phase-7-lifecycle-billing.`
- [x] Push — scope: `Only feat/phase-7-lifecycle-billing to origin; never main.`
- [x] Create draft pull request — scope: `One new draft PR from feat/phase-7-lifecycle-billing to main with the exact title above.`
- [ ] Merge — scope: `Product owner only, manually in GitHub.`
- [ ] Deploy — scope: `N/A`.
- [ ] Delete material data — scope: `N/A — only isolated test fixtures/objects permitted during verification.`
- [ ] Enable production SMTP — scope: `N/A`.
- [ ] Process real customer data — scope: `N/A`.
- [ ] Add a payment provider — scope: `N/A`.
- [ ] Change legal/privacy policy — scope: `N/A`.

## State transition

- State status: `ready_for_cto`
- Current step: `7.2` (approved sync handoff only)
- Owner: `Claude Code`
- Next action: `Perform only the explicitly authorized Phase 7 commit, push, and draft-PR handoff; report and stop.`
