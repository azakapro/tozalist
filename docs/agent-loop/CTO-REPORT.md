# CTO Report — Step 8.2 correction (corpus fixture fidelity and Unicode coverage)

## Step and outcome

Step `8.2`, focused corpus correction per `PM-DECISION.md`. The two flagged issues are fixed: every fixture now truthfully identifies the address it evaluates (`fixture.email === fixture.stubbedEngineResponse.email` for all 500), and the Unicode/IDN category now contains genuine non-ASCII addresses, not only ASCII punycode/text. Two regression assertions pin both invariants. The corpus is still exactly 500, the gate still passes 100% and still fails closed. Scope was limited to the corpus data, its focused tests, and its README. Local-only, uncommitted; no Git write, no Phase 9 work.

## Corrections implemented (`packages/core/bench/`)

### 1. Fixture email fidelity

- **Syntax-failure fixtures**: `fixture.email` was a placeholder (`sample-${i}`) while `aggregate()` evaluated the actual malformed address in `stubbedEngineResponse.email`. Now `fixture.email` **is** that address (the raw sample, including its control-character cases), so the fixture self-identifies. Control-character and every-syntax-class coverage is unchanged.
- **Over-long invalid fixtures**: `fixture.email` was `long-invalid-${i}`; it is now the exact `${local}@${domain}` the stub carries. Length coverage (300-char local, 260-char domain) is unchanged.
- All other categories already satisfied the invariant (they build both fields from the same `${local}@${domain}` via `baseEngine`).

### 2. Genuine non-ASCII Unicode coverage

The `unicode-idn-long-valid` fixtures previously used only ASCII punycode (`xn--…`) domains and ASCII text. They now draw from a mixed set that includes **real non-ASCII code points** in the local part and/or domain — Cyrillic (`почта@пример.test`, the Uzbek `фойдаланувчи@example.test`), CJK (`用户@例子.test`), Greek (`σύνδεσμος@παράдейγμα.invalid`), and Latin-with-diacritics (`josé.muñoz@correo.example`) — alongside the retained ASCII punycode IDN domains and very long ASCII local parts. Every address stays far from any known provider (so `detectTypo` returns null and the verdict stays `valid`), uses reserved/example TLDs, and is fully stubbed — no DNS or network access. Distinctness is preserved with an index suffix that does not disturb the non-ASCII or length property.

### 3. Regression assertions (`corpus.test.ts`)

- **Fidelity**: asserts `fixture.email === fixture.stubbedEngineResponse.email` for every fixture.
- **Real Unicode**: asserts at least one `unicode-idn-long-valid` fixture whose email contains a non-ASCII code point (> U+007F) AND whose stubbed `syntax.username` or `syntax.domain` also carries a non-ASCII code point — so ASCII punycode alone cannot satisfy it.
- The exactly-500 count and all prior category/verdict/reason coverage assertions are retained and still pass.

### 4. README precision

`bench/README.md` now states the Unicode/IDN valid fixtures include genuine non-ASCII addresses (Cyrillic, CJK, Greek, Latin-with-diacritics) alongside ASCII punycode IDN and long ASCII locals — matching the corrected data.

## Scope confirmation

This correction changed **only** `packages/core/bench/{corpus.ts, corpus.test.ts, README.md}` and relay records. The scorer (`score.ts`) and runner gate (`run.ts`) are byte-identical to the reviewed Step 8.2 (verified unchanged vs the synced baseline `7452651`); the CI wiring, scripts, package dependencies, lockfile, and TypeScript/Vitest configuration were not touched by this correction (they remain the reviewed Step 8.2 state).

## Verification results

- **`pnpm core:bench`**: still 500/500, confusion matrix diagonal (valid 175, risky 135, unknown 65, invalid 125), every email reason code at 100% precision/recall, exit 0.
- **Gate still fails closed**: corrupting a catch-all fixture's expected verdict to `valid` produced 25 mismatches and exit 1; restoring returned exit 0.
- **Focused core suite**: `packages/core/bench/corpus.test.ts` now 9 tests (the two new invariants included), all passing.
- `pnpm db:test:prepare` ✓ · `pnpm secret-scan` ✓ clean (369 files) · copy lint ✓ · `pnpm -r build` ✓ (bench excluded from `dist`) · `pnpm -r test` ✓ **612** (core **186** (+2), shared 69, db 71, api 169, worker 59, dashboard 32, web 26) · `pnpm test:scripts` ✓ 5 · `pnpm lint` ✓ · `pnpm -r typecheck` ✓ · `pnpm format:check` ✓ after build · `git diff --check` ✓.
- **`NOT_RUN`** (carried, unchanged): the GitHub Actions workflow itself (runs on a later authorized push) and Lighthouse (Phase 9 gate).

## Acceptance criteria (unchanged, still met)

- [x] 500 deterministic cases, 100% gate in CI.
- [x] README distinguishes logic correctness from real-world accuracy.
- [x] (correction) Every fixture self-identifies its address; genuine non-ASCII Unicode coverage present; both invariants asserted.

## Files changed (correction only)

`packages/core/bench/corpus.ts` (email fidelity + non-ASCII fixtures) · `packages/core/bench/corpus.test.ts` (+2 invariant tests) · `packages/core/bench/README.md` (Unicode precision) · `docs/agent-loop/{CTO-REPORT.md, STATE.md}`. `docs/agent-loop/PM-DECISION.md` is the PM's decision, left untouched.

## Carry-forward pre-production gates (unchanged, still blocking)

- The supported Next.js/React upgrade in `docs/PRE-PRODUCTION-GATES.md` remains blocking before Phase 9 deployment or public beta.
- Lighthouse remains a Phase 9 deployment gate.

## Git status

`feat/phase-8-hardening`, all Step 8.2 work (implementation + this correction) local and uncommitted on top of the synced commit `7452651`. No PR exists. Per PROTOCOL, the single Phase 8 draft PR is created only after Step 8.2 is approved and explicitly synchronized. Awaiting PM review; no Git write is authorized in this cycle.
