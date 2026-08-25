# CTO Report — Step 5.2 correction (/check API-unreachable retry)

## Step and outcome

Step `5.2`, correction cycle per `PM-DECISION.md` (2026-08-25T11:08:00+0500). The `/check` page now renders the shared API-unreachable state with its Retry button for non-credit failures, matching `/batches` and `/usage`. Work was done on the required fresh local branch `fix/step-5.2-check-api-retry`, created from the fetched `origin/main` baseline (`dc6dd26`, the PR #2 merge), with the uncommitted relay records retained. Nothing was committed, pushed, PR'd, merged, or deployed.

## Correction implemented

1. `apps/dashboard/app/check/page.tsx`: the generic error paragraph is gone. Any non-402 request failure now renders the existing shared `ApiUnreachable` component with its Retry button. No raw error text can surface — the component shows only the fixed translated message.
2. **Retry repeats the exact submitted check**: the page captures the last submitted `{kind, value}` pair at submit time, and Retry re-runs that request — even when the user has since edited the input field or switched tabs. The 402 no-credits behavior is unchanged (still the `NoCredits` state, never the retry state).
3. Email and phone tabs share one code path (`runCheck`), so both get identical retry behavior.

## Files changed (correction only)

- `apps/dashboard/app/check/page.tsx` — shared unreachable state + captured-request retry.
- `apps/dashboard/tests/check-retry.test.tsx` — new (3 tests).

No API, worker, database, engine, public web, auth, accounting, retention, or GitHub configuration changes.

## Required test coverage (all passing, mocked API)

- **Fail → state → Retry → result**: the mocked API rejects with a hostile error embedding `ECONNREFUSED` and an internal detail; the shared state and Retry appear; neither error string is anywhere in the DOM; the user then edits the input to a half-typed value, clicks Retry, and the assertion proves the second request is byte-identical to the ORIGINAL submission; on recovery the state disappears and the verdict card renders.
- **402 still yields NoCredits**, never the retry state.
- **Phone tab parity**: same fail/retry/recover flow through `/internal/check/phone`.
- The existing CRITICAL test that `unknown` is never styled red is retained and passing, as is the full pre-existing dashboard suite.

## Verification results

dashboard ✓ **23** (+3) · `pnpm -r build` ✓ · `pnpm -r test` ✓ **477** (core 173, shared 43, db 52, api 136, worker 50, dashboard 23) · `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm format:check` ✓ · `git diff --check` clean. Working tree holds only the two correction files plus the relay records — uncommitted by instruction.

## Risks or decisions requiring PM review

- Retry intentionally replays the CAPTURED submission rather than the current input-field contents; a user who wants to check the newly typed value presses Check as usual. This reading follows the correction's "the same currently entered email or phone check" as the check that was entered when the failure happened.

## Known limitations / blockers

None blocking. Prior open notes unchanged.
