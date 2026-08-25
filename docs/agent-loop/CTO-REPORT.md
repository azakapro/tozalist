# CTO Report — Step 7.1 correction (lifecycle durability and accounting completion)

## Step and outcome

Step `7.1`, correction cycle per `PM-DECISION.md`. All four items are done: every destructive storage path is now failure-safe and retryable with fault-injection proof, the three-year credit-ledger lifecycle is complete behind a migration-backed double-gated trigger, CSV export cells are hardened against spreadsheet formula injection with a ZIP round-trip test, and the sweep drains all expired batches page by page. Still on `feat/phase-7-lifecycle-billing`, local-only, uncommitted. No Step 7.2 work, no GitHub writes.

## Correction implemented

### 1. Failure-safe destructive storage paths

- **Partial S3 responses fail closed** (`packages/shared/src/s3.ts`): `deleteObjects` now chunks to the S3 1000-key limit and checks each response's per-key `Errors`; any error throws the fixed `STORAGE_DELETE_FAILED` message, which by construction carries no key, endpoint, credential, or customer value. The check lives in an exported pure `ensureDeleteSucceeded`, unit-proven against a fabricated partial response (including that the thrown message contains neither the key nor the S3 error code).
- **Org purge: storage strictly first.** The sweep now empties the org's prefix, **re-lists to confirm it is empty**, and only then runs the DB purge — so the terminal `purged_at` marker can only exist after the objects are confirmed gone. `hardDeleteOrganizationData` became DB-only with this ordering contract in its doc comment. A storage failure leaves `purged_at` NULL and the org still listed as due; the fault-injection test proves the failed run writes **no sweep audit event**, leaves rows/objects/marker untouched, leaks no key into logs, and that the next healthy sweep completes the purge. Race-safety: no new object can appear for a purge-eligible org because batch creation, exports, and uploads all require an active organisation, and the org has been soft-deleted ≥ 30 days.
- **Wipe endpoint: objects deleted inside the transaction, before any row.** `deleteAllCheckDataForOrg` was replaced by `wipeCheckDataForOrg(db, orgId, deleteObjects)`: one transaction that (a) locks the organisation row FOR UPDATE — the same lock batch creation takes to debit credits, so a concurrently created batch cannot slip between key enumeration and row deletion — (b) enumerates keys, (c) awaits object deletion, (d) deletes rows. A storage throw rolls the whole transaction back: rows intact, no audit, no success response, plainly retryable. Proven at the db layer (fault injection + retry + enumerate-before-delete ordering) and end-to-end at the API layer (faulty-storage app returns 500 `INTERNAL_ERROR`, rows and object survive, zero audit events, logs carry the error class only; the healthy retry completes).
- **Expired-batch purge**: objects were already deleted before rows; with the fail-closed shared layer a partial deletion now aborts before any row is touched. Fault-injection test proves the row survives still pointing at its object (retryable, never orphaned) and the next sweep finishes the job.
- **Drain, not 500**: the sweep loops `listExpiredBatches` page by page until none remain (page size injectable). Test runs 5 expired batches at page size 2 — three pages — and proves zero rows and zero objects remain.

### 2. Three-year ledger completion (migration `0006_ledger_retention_purge`)

- The append-only trigger function is replaced with a **double-gated** version: DELETE passes only when the transaction-local `tozalist.allow_ledger_purge = 'on'` (SET LOCAL — dies with the transaction) **and** the row is ≥ 3 years old by the database's own clock. UPDATE and TRUNCATE remain unconditionally rejected; ordinary DELETE remains rejected. Tests prove a plain application delete still throws even for a 3-year-old row, and that the flag alone cannot delete a young row — the trigger re-checks age itself.
- `purgeExpiredLedgerEntries(db, now)` is the single sanctioned path (SET LOCAL inside its transaction; JS cutoff = injected now minus 3 calendar years). Boundary test: a row exactly at the cutoff is purged, a row one second younger is retained. The JS cutoff is deliberately the stricter of the two clocks; the trigger is the backstop.
- `deleteRetiredOrganizations(db)` removes an anonymized organization row **only** when it is purged and no ledger row references it — tested: the row survives while one old ledger entry remains, disappears after retention completes, and the org's audit events go to `org_id = NULL` (ON DELETE SET NULL) with their target id intact — no orphaned references. Active and merely soft-deleted organisations are never touched.
- Both steps run at the end of every hourly sweep; counts (`ledger_entries`, `orgs_removed`) join the sweep's audit event and summary line.

### 3. CSV formula-injection hardening

`neutralizeFormula` in the export module prefixes a standard apostrophe to any **string** cell beginning with `=`, `+`, `-`, `@`, tab, or CR, before CSV quoting; numbers and booleans the system renders itself (ledger deltas, counts, flags) stay numeric. ZIP round-trip test seeds a formula email (`=cmd@…`), a `=HYPERLINK(...)` batch filename, and an `@IMPORTDATA(...)` audit target, downloads the export through the real signed URL, and asserts each cell is inert (apostrophe-prefixed, no line in any CSV starts with `=` or `@`), while ordinary values and the org-scoping guarantees are unchanged. Known consequence: phone numbers exported as `'+998…` — the standard mitigation applied uniformly.

### 4. Retained behavior (re-verified by existing tests)

180-day lead expiry marker governs the lead sweep (per the PM's confirmation; legal draft untouched); signed links 24h; export/wipe admin + MFA + CSRF; API delete endpoints refund nothing and reveal nothing foreign/expired; destructive tests confined to `tozalist_test` and the isolated `tozalist-test` bucket.

## Files changed (correction only)

`packages/shared/src/{s3.ts, index.ts}` + new `s3.test.ts` · `packages/db/drizzle/0006_ledger_retention_purge.sql` (+ journal/snapshot) · `packages/db/src/{lifecycle.ts, index.ts, lifecycle.integration.test.ts}` · `apps/worker/src/lifecycle/{processor.ts, lifecycle.integration.test.ts}` · `apps/api/src/internal/{routes.ts, data-export.ts}` · `apps/api/src/lifecycle.integration.test.ts`.

## Verification results (PM's required order)

`pnpm db:test:prepare` ✓ (migration 0006 applies) · copy lint ✓ clean · affected suites ✓ — shared **48** (+5), db **62** (+3), worker **55** (+3), api **153** (+2), dashboard 26 · `pnpm -r build` ✓ · `pnpm -r test` ✓ **541** (core 173, shared 48, db 62, api 153, worker 55, dashboard 26, web 24) · `pnpm lint` ✓ · `pnpm -r typecheck` ✓ · `pnpm format:check` ✓ after the build · `git diff --check` ✓ clean. **Lighthouse remains `NOT_RUN`.** The worker entrypoint was never started; no sweep ran against development data.

## Risks or notes for PM review

- The apostrophe neutralization is visible in exported cells that legitimately begin with `+` (phone numbers) — standard and accepted, noted for support docs.
- The batch **result CSV** customers download from Step 4.1 predates this correction and does not neutralize formulas; it reproduces the customer's own input back to them. Flagged as possible future hardening, not changed here to avoid altering approved Step 4.x output format inside a 7.1 correction.
- The trigger's age gate uses the database clock while the sweep's WHERE uses the injected clock; the JS filter is always the stricter one in production (both are "now"), and tests pin the boundary on the JS side with the trigger as backstop.

## Git status

`feat/phase-7-lifecycle-billing`, all Step 7.1 work (implementation + correction) local and uncommitted on top of `9589580`. No PR exists; the Phase 7 draft PR remains deferred until Step 7.2 is approved and synchronized.
