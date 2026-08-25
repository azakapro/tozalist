# PM Decision

## Review

- Step ID: `7.1` — Retention, deletion, and export (including the lifecycle-durability and accounting-completion correction).
- Baseline checked: `YES — feat/phase-7-lifecycle-billing starts at merged origin/main commit 9589580.`
- CTO report, actual diff, recovery paths, ledger migration, export serialization, route authorization, and affected tests reviewed: `YES`.
- Scope checked: `YES — changes remain within Step 7.1. No payment-provider, production deployment, legal/privacy-copy, or GitHub write has occurred.`
- Storage durability: `APPROVED — DeleteObjects now fails closed on per-key errors; expired batch and org cleanup keep their database state retryable until object removal succeeds; organisation prefixes are re-listed before purged_at is written; the account wipe locks the active organisation while enumerating, deletes objects before rows, and rolls back database work on a storage failure.`
- Accounting and retention: `APPROVED — migration 0006 retains normal append-only UPDATE/DELETE/TRUNCATE protection, permits only transaction-local, database-age-gated deletion after three years, and removes anonymized organisation rows only after their retained ledger is empty. The stored 180-day lead expiry remains the accepted canonical implementation.`
- Privacy and security: `APPROVED — export and wipe retain admin + MFA + CSRF checks; signed download URLs are neither logged nor audited; storage failures surface only fixed/generic responses; customer-controlled self-service-export cells are neutralized before CSV quoting. No client-secret, unsafe HTML, or unsafe navigation path was introduced by this step.`
- Acceptance evidence: `APPROVED — CTO reports db preparation plus real test-MinIO fault injection; PM independently reran build, the full workspace test suite (541 passing), lint, typecheck, formatting after build, and diff check. PM did not rerun db:test:prepare because this review environment has no DATABASE_URL_TEST and must not substitute a development database for destructive setup.`
- Carry-forward note: `The pre-existing Step 4.1 batch-result CSV is still a separate formula-injection hardening candidate. It was not altered in this scoped correction; the new self-service data export is protected. Track the older result-download path in the Phase 8 security pass before production launch.`

## Decision

- Decision: `APPROVED`
- Rationale: `The focused correction closes the previously blocking object-storage failure, accounting-retention, batch-draining, and spreadsheet-formula risks with testable retry behavior. The remaining batch-result CSV note is pre-existing and outside the reviewed self-service-export path; it is recorded as a Phase 8 hardening gate, not a reason to hold Step 7.1.`

## Exact next action — Step 7.1 Git sync only

Claude Code must remain on `feat/phase-7-lifecycle-billing` and perform no product work.

1. Reconfirm that the working tree contains exactly the reviewed Step 7.1 files and relay records listed below; stop and report if anything else is present.
2. Create one atomic commit with this exact message:

   ```text
   lifecycle: add retention, export, and deletion controls
   ```

3. Push only `feat/phase-7-lifecycle-billing` to `origin`. Do not push or modify `main`.
4. Do not create or update a pull request; the single Phase 7 draft PR is due only after Step 7.2 is approved and synchronized.
5. Update `CTO-REPORT.md` with the commit hash and remote branch, set `STATE.md` to `awaiting_pm_review` for PM sync verification, and stop. Do not begin Step 7.2.

Reviewed commit scope:

```text
.env.example
THIRD_PARTY_LICENSES/types-yauzl-MIT.txt
THIRD_PARTY_LICENSES/types-yazl-MIT.txt
THIRD_PARTY_LICENSES/yauzl-MIT.txt
THIRD_PARTY_LICENSES/yazl-MIT.txt
apps/api/package.json
apps/api/scripts/export-openapi.ts
apps/api/src/app.ts
apps/api/src/internal/data-export.ts
apps/api/src/internal/routes.ts
apps/api/src/lifecycle.integration.test.ts
apps/api/src/openapi/operations.ts
apps/api/src/routes/email-check.ts
apps/api/src/routes/phone-check.ts
apps/dashboard/app/settings/page.tsx
apps/dashboard/lib/data-controls.tsx
apps/dashboard/lib/messages.ts
apps/dashboard/tests/data-controls.test.tsx
apps/worker/src/lifecycle/lifecycle.integration.test.ts
apps/worker/src/lifecycle/processor.ts
apps/worker/src/lifecycle/worker.ts
apps/worker/src/main.ts
apps/worker/src/test/support.ts
docs/agent-loop/CTO-REPORT.md
docs/agent-loop/PM-DECISION.md
docs/agent-loop/STATE.md
packages/db/drizzle/0005_gigantic_the_hand.sql
packages/db/drizzle/0006_ledger_retention_purge.sql
packages/db/drizzle/meta/0005_snapshot.json
packages/db/drizzle/meta/0006_snapshot.json
packages/db/drizzle/meta/_journal.json
packages/db/src/export.ts
packages/db/src/index.ts
packages/db/src/lifecycle.integration.test.ts
packages/db/src/lifecycle.ts
packages/db/src/schema/organizations.ts
packages/shared/src/checks.ts
packages/shared/src/index.ts
packages/shared/src/s3.test.ts
packages/shared/src/s3.ts
pnpm-lock.yaml
```

## Explicit exceptional permissions

- [x] Commit — scope: `one atomic Step 7.1 commit containing only the reviewed paths above, on feat/phase-7-lifecycle-billing, with the exact message stated above.`
- [x] Push — scope: `only feat/phase-7-lifecycle-billing to origin after that commit.`
- [ ] Create/update draft pull request — scope: `N/A — deferred until Step 7.2 completes and is approved.`
- [ ] Merge — scope: `N/A — product owner only.`
- [ ] Deploy — scope: `N/A`.
- [ ] Delete material data — scope: `N/A — no new destructive test or production action is authorized by this sync handoff.`
- [ ] Enable production SMTP — scope: `N/A`.
- [ ] Process real customer data — scope: `N/A`.
- [ ] Add a payment provider — scope: `N/A`.
- [ ] Change legal/privacy policy — scope: `N/A`.

## State transition

- State status: `ready_for_cto`
- Current step after decision: `7.1` (Git sync handoff only)
- Owner: `Claude Code`
- Next action: `Perform only the explicitly authorized commit and push, report the hash/branch, set awaiting_pm_review, and stop.`
