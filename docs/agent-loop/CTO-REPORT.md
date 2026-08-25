# CTO Report — Step 5.2 (Check, batch, and usage UI)

## Step and outcome

Step `5.2` implemented in full and verified: the /check, /batches and /usage dashboard pages with the mandated verdict UX, cost-before-confirm uploads, progress polling, verdict-distribution bars, a running-balance ledger with date filter and CSV export, a plain-SVG checks-per-day chart, empty/error states on every page, and component tests with a fully mocked API — including the required assertion that `unknown` is never styled as an error.

## Files changed (this step)

Dashboard (new): `lib/verdict.tsx` (VerdictCard + style map — valid green ✓, risky amber !, unknown gray ?, invalid red ✕), `lib/states.tsx` (ApiUnreachable with retry; NoCredits linking to billing), `lib/upload-confirm.tsx` (client-side `countCsvRows` header-aware counting + the "Use N credits" confirmation gate), `app/check/page.tsx` (email/phone tabs, verdict card, reason explanations, "Did you mean …?", always-visible disclaimer, no-credits and error states), `app/batches/page.tsx` (drag-and-drop + click-to-choose, pre-confirm cost estimate, 2s progress polling that stops when nothing is in flight, stacked verdict bar with counts and percentages, download link from a fresh signed URL, delete with confirmation, empty/rejected/unreachable states), `app/usage/page.tsx` (running-balance ledger table, date-range filter, client-side CSV export, dependency-free SVG bar chart), `tests/{verdict,upload-confirm,states,batches-polling}.test.tsx`, `vitest.config.ts`. Modified: `lib/messages.ts` (all new strings through the i18n file), `lib/shell.tsx` (nav), `package.json` (test script; devDeps vitest, @testing-library/react 16.3.2 MIT, jsdom 25.0.1 MIT — jsdom pinned to ^25 because ^27 requires Node ≥22.22.2 and the toolchain runs 22.22.0 with engine-strict; licenses recorded).

API (required to make the pages function): `check-service.ts` (new) — the single email/phone check orchestration extracted from the /v1 routes; `routes/email-check.ts` and `routes/phone-check.ts` rebuilt on it with byte-identical behavior (all 22 pre-existing check/credit tests pass unchanged); `internal/product.ts` (new) — session-authenticated, CSRF-protected, OpenAPI-hidden wrappers: POST /internal/check/email + /internal/check/phone (same service → identical crediting/caching), batches upload/list/get/delete (same inspection, reservation, deletion-policy and audit code paths; audit actor is the session user), GET /internal/usage (balance, windowed running-balance ledger with optional from/to, 30-day per-day counts); `app.ts` wiring.

packages/db: `getChecksPerDay` (UTC daily counts across email+phone) and `getLedgerWithRunningBalance` (window-sum over full history so the balance column stays truthful under date filters; raw-SQL date params serialized as ISO strings — a Date-parameter bug caught by the integration test).

## Acceptance-criteria evidence

- **Cost shown before confirming an upload** — component test: rows counted client-side (header-aware), the confirmation button's literal text is `Use 1250 credits`, and `onConfirm` has not fired before the click. Cancel backs out without confirming; the button disables while uploading.
- **`unknown` visually and textually distinct from `invalid` — test asserts this** — the CRITICAL test renders an unknown card and asserts: no `red` class anywhere in container or markup; the exact text "Do not delete — we could not determine this address." present; container classes differ from the invalid card's; and invalid never shows that notice. A parallel test pins valid=green, risky=amber, invalid=red.
- **Empty and error states on every page** — no-credits (402 → NoCredits with billing link) on /check and /batches; API-unreachable with a working retry (tested: fails, retries, recovers); no-batches-yet explainer (tested); upload-rejected banner carrying the server's reason; usage empty-period state. 
- Also tested: verdict reason codes render with their plain-English explanations; "Did you mean gmail.com?" renders; the disclaimer renders under all four verdicts; progress polling advances the bar 20%→60%, removes it at done, and stops polling when nothing is in flight (fake timers, mocked API).
- Server-side: 3 new integration tests prove the internal check endpoints charge identically (credits_used 1 → 99 remaining), CSRF is enforced on the product surface, and the running balance reconciles row-by-row against deltas with per-day counts present.

## Verification results

`pnpm db:test:prepare` ✓ · api ✓ **136** (+3) · dashboard ✓ **20** (new) · worker ✓ 50 · db ✓ 52 · shared ✓ 43 · `pnpm -r build` ✓ · `pnpm -r test` ✓ **474** (core 173, shared 43, db 52, api 136, worker 50, dashboard 20) · `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm format:check` ✓ · `git diff --check` clean.

## Scope / privacy / security / retention

The internal product endpoints reuse the exact same service/helpers as /v1 — no second implementation of credit, cache, SMTP, batch, or deletion rules; dashboard batch deletion carries the session user as audit actor. No new data stores. `unknown` messaging follows §0.2 (never tell customers to delete an unknown). All new user-facing strings went through the i18n messages file. No banned words.

## Risks or decisions requiring PM review

1. **The step required API-side additions** (`/internal` product wrappers + the check-service extraction + two db helpers) that the roadmap text does not spell out but the UI cannot function without. The extraction is the anti-drift choice: v1 routes were rebuilt on the shared service with their full pre-existing test suite passing unchanged.
2. **"Link to billing" points to /settings** — no billing page exists until Phase 6; the settings page is the closest real destination. Trivial to repoint later.
3. Client-side row counting is an ESTIMATE for the confirm gate (header-aware line count); the server's streaming inspection remains authoritative for the actual reservation. Numbers match for well-formed CSVs; multi-line quoted fields could differ slightly — the server number is what gets charged.
4. Usage CSV export exports the currently loaded (filtered, up to 200) ledger rows client-side; a full-history export endpoint is future work if needed.
5. Batch listing on the dashboard uses page size 20 without pagination UI (newest first); the public API keeps full cursor pagination.

## Known limitations / blockers

None blocking. Prior open notes unchanged.
