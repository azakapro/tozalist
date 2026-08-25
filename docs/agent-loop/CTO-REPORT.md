# CTO Report — Step 7.2 correction (authoritative grant validation)

## Step and outcome

Step `7.2`, correction cycle per `PM-DECISION.md`. `grantCreditsWithAudit` — the authoritative manual-grant boundary — now enforces the accounting invariant itself: it validates and canonicalizes its input before deriving the reference and before any transaction opens, so an invalid call writes nothing anywhere regardless of who the caller is. Still on `feat/phase-7-lifecycle-billing`, local-only, uncommitted. Nothing else from the reviewed Step 7.2 changed; no Phase 8 work, no GitHub writes, no new dependencies.

## Correction implemented

1. **Validation inside the helper, before anything else** (`packages/db/src/billing.ts`): `grantCreditsWithAudit` now rejects, up front, any credits value that is not a positive safe integer (`Number.isSafeInteger(credits) && credits > 0` — this refuses negatives, zero, fractions, `NaN`, infinities, and beyond-`MAX_SAFE_INTEGER` values) and any note that is blank after trimming. The check runs **before** the reference hash is computed and **before** the grant transaction opens — an invalid call cannot touch the ledger, the audit trail, or even the reference space.
2. **Canonical note used consistently**: the trimmed note is the single canonical form used for **both** the reference hash and the stored ledger note. Whitespace-only variants of the same invoice now hash to the same reference, so `"  Invoice INV-9 paid  "` replayed as `"Invoice INV-9 paid"` collides with the replay guard instead of becoming a second grant. `grantReference`'s contract comment states the canonical-note requirement.
3. **Fixed, caller-safe failure**: invalid input returns the new `{ ok: false, reason: 'invalid_input' }` — a fixed token that never echoes the note, the amount, or any connection/configuration data. The CLI keeps its friendly per-field messages for interactive use and now also maps the helper's `invalid_input` defensively ("the grant input was rejected — nothing was granted"), so even a disagreement between the two validation layers stays safe and quiet.
4. **Nothing else altered**: plan pricing, invoice-request retention, bank-detail handling, statement storage, signed-link scoping, and the payment-provider boundary are untouched (their tests all still pass unchanged).

## Regression tests added (database layer, direct against the helper)

- **Invalid inputs write nothing**: `-100`, `0`, `2.5`, `NaN`, `+Infinity`, `MAX_SAFE_INTEGER + 2`, empty note, and whitespace-only note each return exactly `{ ok: false, reason: 'invalid_input' }`, and the org's ledger **and** audit tables are then asserted completely empty — zero rows leaked from eight invalid attempts.
- **Canonical whitespace replay-protection**: a padded note grants once; the trimmed variant of the same invoice is refused as `duplicate_reference`; exactly one ledger row exists, its stored note is the canonical trimmed text, and its reference equals `grantReference(credits, trimmedNote)`.
- **Retained behavior re-verified**: the existing tests for successful grants (one ledger row + one audit event atomically), identical-command replay refusal, unknown-org and deleted-org refusal, and all CLI validation/replay/output-hygiene behavior pass unchanged.

## Files changed (correction only)

`packages/db/src/billing.ts` (validation, canonicalization, `invalid_input` variant) · `packages/db/src/billing.integration.test.ts` (+2 tests) · `apps/api/src/cli/billing-grant.ts` (defensive `invalid_input` mapping).

## Verification results

`pnpm db:test:prepare` ✓ · affected suite: db ✓ **71** (+2) · `pnpm -r build` ✓ · `pnpm -r test` ✓ **569** (core 177, shared 48, db **71**, api 160, worker 55, dashboard 32, web 26) · `pnpm lint` ✓ · `pnpm -r typecheck` ✓ · `pnpm format:check` ✓ after the build · `git diff --check` ✓ clean. **Lighthouse remains `NOT_RUN`** (Phase 9 gate). No production, provider, legal, or destructive action; tests stayed within the isolated test database.

## Notes for PM review

- The PM's retention note is acknowledged and carried: before the DRAFT privacy policy is finalized, its data map must add the `invoice_requests` record (org, requesting user, plan, timestamp; removed at org purge). No legal copy was touched in this correction, per the explicit prohibition — this stays on the pre-finalization checklist.

## Git status

`feat/phase-7-lifecycle-billing`, all Step 7.2 work (implementation + this correction) local and uncommitted on top of `17f9055`. No PR exists. Per PROTOCOL, the single Phase 7 draft PR follows only after corrected-7.2 approval and an explicit sync authorization naming files, message, branch, and PR title.
