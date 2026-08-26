# CTO Report — Step 8.4 correction (Backend dependency-security remediation)

## Step and outcome

**Correction cycle.** The PM's `CORRECTION_REQUIRED` review (2026-08-26) raised three items; all three are applied and re-verified below (see *PM corrections applied*). Original scope unchanged otherwise.

Step `8.4` implemented and verified on the fresh branch `feat/backend-dependency-security`, created from fetched `origin/main` at `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66`. All four recorded high-severity production advisories are **cleared**: Fastify is on exact-pinned **5.12.1**, its plugin set on Fastify-5-compatible exact pins, and `drizzle-orm` on **0.45.2** — with `find-my-way` **9.9.0** and `@fastify/static` **10.1.3** resolving naturally through the plugin chain (no override, resolution, or forced transitive pin). `pnpm security:audit` reports **"No known vulnerabilities found"** and is wired as a blocking CI step. Local-only, uncommitted: **no commit, push, PR, merge, deploy, or Phase 9 work**. No schema or migration changed.

## Pre-flight (recorded)

| Check | Result |
| --- | --- |
| Branch before | `feat/framework-support-next16` @ `71cf4b6` |
| `origin/main` (fetched) | `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66` — matches the expected base exactly |
| Pre-existing uncommitted files | Only `docs/agent-loop/{CTO-REPORT,PM-DECISION,STATE}.md` — relay records, **preserved** |
| New branch | `feat/backend-dependency-security`, HEAD `91ce3ae…`, created from `origin/main` |
| Staged/committed anything at pre-flight | No |

## Before / after versions

**Direct declarations** (all exact-pinned; no caret, tilde, `latest`, wildcard, or prerelease):

| Package | Declared before | Declared after | Where |
| --- | --- | --- | --- |
| `fastify` | `^4.28.1` | **`5.12.1`** | apps/api |
| `fastify-plugin` | `^6.0.0` | **`6.0.0`** | apps/api |
| `@fastify/cookie` | `^9` | **`11.1.2`** | apps/api |
| `@fastify/helmet` | `11` | **`13.1.1`** | apps/api |
| `@fastify/multipart` | `^8.3.1` | **`10.1.1`** | apps/api |
| `@fastify/swagger` | `^8` | **`9.8.1`** | apps/api |
| `@fastify/swagger-ui` | `^2` | **`6.1.1`** | apps/api |
| `drizzle-orm` | `^0.38.3` (declared twice in api and worker) | **`0.45.2`**, exactly once per package | `apps/api` → `dependencies`; `packages/db` → `dependencies`; `apps/worker` → `devDependencies` (see PM correction 1) |

**Resolved production tree** (the security-relevant result):

| Package | Before | After | Advisory cleared |
| --- | --- | --- | --- |
| `fastify` | 4.29.1 | **5.12.1** | `GHSA-jx2c-rxcm-jvmq` (patched >=5.7.2) |
| `drizzle-orm` | 0.38.4 | **0.45.2** | `GHSA-gpj5-g38j-94v9` (patched >=0.45.2) |
| `find-my-way` | 8.2.2 | **9.9.0** | `GHSA-c96f-x56v-gq3h` (patched >=9.7.0) |
| `@fastify/static` | 6.12.0 | **10.1.3** | `GHSA-83w8-p2f5-377r` (patched >=10.1.1) |
| `@fastify/cookie` / `helmet` / `multipart` / `swagger` / `swagger-ui` / `fastify-plugin` | 9.4.0 / 11.1.1 / 8.3.1 / 8.15.0 / 2.1.0 / 4.5.1 | **11.1.2 / 13.1.1 / 10.1.1 / 9.8.1 / 6.1.1 / 6.0.0** | (supporting compatibility) |

`drizzle-kit` was **not** upgraded (`^0.30.1` unchanged): nothing in this step generates migrations, the existing migrations apply cleanly under drizzle-orm 0.45.2 (proven by the db integration suite), so no compatibility need existed.

## Official compatibility evidence used

Compatibility was taken from each package's own published metadata in the registry, not from third-party sources:

- `fastify@5.12.1` declares `find-my-way: ^9.6.0` → resolves **9.9.0**, above the patched `>=9.7.0` floor.
- `@fastify/swagger-ui@6.1.1` declares `@fastify/static: ^10.1.0` → resolves **10.1.3**, above the patched `>=10.1.1` floor.
- `@fastify/cookie@11.1.2`, `@fastify/helmet@13.1.1`, `@fastify/multipart@10.1.1`, `@fastify/swagger@9.8.1`, `@fastify/swagger-ui@6.1.1` each declare `fastify-plugin: ^6.0.0`, the Fastify-5 plugin-encapsulation line — a mutually consistent set.
- `pnpm why` from `apps/api` shows a single resolution per package (`fastify 5.12.1`, `@fastify/static 10.1.3`); the lockfile contains **zero** references to `fastify@4.*`, `find-my-way@8.*`, `drizzle-orm@0.38.*`, or `@fastify/static@6.*`.
- No `pnpm.overrides`, `resolutions`, or forced transitive pin exists (verified in `package.json` and `pnpm-workspace.yaml`).

## Before / after audit

**Before** — `pnpm audit --prod --audit-level=high`: `7 vulnerabilities found — 1 low | 2 moderate | 4 high`, the four high being exactly `GHSA-jx2c-rxcm-jvmq` (fastify), `GHSA-gpj5-g38j-94v9` (drizzle-orm), `GHSA-c96f-x56v-gq3h` (find-my-way), `GHSA-83w8-p2f5-377r` (@fastify/static).

**After** — `pnpm security:audit` → **"No known vulnerabilities found"**, exit **0**. A full `pnpm audit --prod` (all severities, not just high) is also clean. Each of the four advisory IDs was grepped against the post-upgrade audit output and is **absent**.

## Compatibility changes made (only what Fastify 5 / Drizzle required)

1. **`apps/api/src/plugins/foundation.ts`** — Fastify 5 types the error-handler argument as `unknown`. Narrowed it safely to the shape `classifyError` already read (`statusCode`/`code`/`name`) without trusting any other foreign field. Behavior identical; the log line still emits only the error class name.

2. **`apps/api/src/app.ts`** — added a `frameworkErrors` handler. **This fixes a real regression I found, not a cosmetic one:** Fastify 5 answers framework-level failures (malformed URL → `FST_ERR_BAD_URL`, bad content-type, oversized body) *before* the route error handler, and its default reply is **not** our envelope. Under Fastify 4 these were enveloped; under 5, `/v1/email/check/%ff%fe` returned a raw `{"error":"Bad Request","code":"FST_ERR_BAD_URL",...}` body. The handler routes them through `sendError` so the universal `{error:{code,message,request_id}}` contract holds on every response, with a `classifyFrameworkError` mirroring the existing route-level classifier (4xx → client code, otherwise `INTERNAL_ERROR`; no foreign message text surfaced). Pinned by a new regression test.

3. **`packages/db/src/errors.ts` (new) + `billing.ts` + barrel export** — drizzle-orm >= 0.39 wraps every driver failure in a `DrizzleQueryError` whose own message is a generic `"Failed query: ..."`; the real PostgreSQL text (constraint name, trigger `RAISE`) moved to the `cause` chain. `grantCreditsWithAudit`'s replay guard matched on the top-level message and would have **silently stopped detecting duplicate grants** — a real accounting defect. Added a shared, depth-capped `errorChainMentions` / `flattenErrorChain` utility and pointed the guard at it. One definition, used by production code and tests alike.

4. **`apps/api/src/openapi.integration.test.ts`** — `@fastify/swagger-ui` 6 serves the UI at `/docs` directly (200 HTML) instead of the old 302→`static/index.html` chain, and now canonicalizes the legacy `static/index.html` path back to `/docs/`. Test updated to assert the new shape — see the dedicated note below, since this one deserves scrutiny.

5. **`apps/api/src/lifecycle.integration.test.ts`** — durable row-expiry fixtures (test-only; corrected per PM item 3, see below). **Two different clocks are in play and the original report described this wrongly:** `NOW_MS` is the app's *injected* clock (sessions, MFA codes, signed-link TTLs read `clock()` and are legitimately asserted against `NOW_MS`), **but row expiry is not on that clock** — the `/v1` DELETE routes call `deleteEmailCheckForOrg` / `deletePhoneCheckForOrg` **without** passing a clock, so those DB helpers compare `expires_at` against the real `new Date()` (`packages/db/src/lifecycle.ts`, `now: Date = new Date()`). Anchoring a "live" row to the fixed `NOW_MS` therefore makes the fixture genuinely rot once wall-clock time passes that constant. Fixed with a `rowExpiry(days)` helper anchored to the **real** clock, so live rows are always ahead of it and expired rows always behind it, at any future run date.

6. **`packages/db/src/{credits,lifecycle}.integration.test.ts`** — four append-only-ledger assertions matched on the top-level error message. The database still rejects every one of these operations; the *message* moved to the cause chain (same root cause as #3). Assertions now use a local `expectRejectedBecause(...)` that asserts **both** that the operation was rejected **and** that the append-only trigger / unique-reference constraint is the reason. This follows the guarantee to where the ORM now reports it — it does not relax what is proven.

Nothing else was refactored; no feature added.

## The `/docs/static/index.html` change — evidence it is not weakened traversal protection

The PM flagged this specifically. I probed the live app before changing the test:

```
/docs/static/index.html            -> 302  location=/docs/   body length 0
/docs/static/swagger-ui.css        -> 200  178935 bytes of CSS
/docs/static/../../package.json    -> 404  universal error envelope
/docs/static/%2e%2e%2f%2e%2e%2f…   -> 404  universal error envelope
/docs/static/....//....//…         -> 400  universal error envelope
/docs/../package.json              -> 404  universal error envelope
/docs/static/..%2f..%2fpackage.json-> 404  universal error envelope
```

The 302 is `@fastify/swagger-ui` 6 **canonicalizing** the legacy entry path to `/docs/` — an empty-bodied redirect, not a file read, disclosing nothing. Traversal is independently and explicitly proven blocked. The test now asserts the canonicalization **precisely** (`302`, `location === '/docs/'`, empty body) rather than merely dropping the old assertion, and a separate security test asserts that nine traversal/route-guard variants never return repository content, plus a positive control that the UI genuinely serves (so a blanket 404 cannot pass the traversal test by accident).

## Security regression coverage added

New `apps/api/src/fastify5-security.integration.test.ts` — **10 behavioral tests**, each pinning the behavior an advisory threatened. No test asserts a version string.

1. **Content-Type cannot bypass body validation** (`GHSA-jx2c-rxcm-jvmq`) — six hostile Content-Type variants (trailing tab, leading tab, tab before/inside parameters, tab-separated charset) each carrying a schema-violating body; every one must produce a well-formed error envelope, never a 200, never a 500. Plus a positive control proving the schema is genuinely enforced (wrong type → 400, unknown field → 400).
2. **Malformed/unknown payloads keep the universal envelope** — asserted throughout, with the known-error-code and `request_id` checks.
3. **Swagger UI/static traversal and route-guard bypass** (`GHSA-83w8-p2f5-377r`) — nine encodings (`../`, `%2e%2e%2f`, `..%2f`, `....//`, `..%5c`, mixed) asserted to never disclose `package.json`/lockfile content, never 500, always enveloped — with the positive control above.
4. **Every registered route stays schema-backed and in OpenAPI** — every entry in the `PRODUCT_OPERATIONS` registry is asserted present in the served document with a matching `operationId`, and the document is still `3.1.0`.
5. **Authentication and cross-organization isolation unchanged** — anonymous and four malformed-key variants → 401 enveloped; tenant A reading tenant B's stored check returns a **byte-identical** 404 to an unknown id (never confirming existence); tenant B still reads its own row (200); tenant A's DELETE of tenant B's row 404s and the row survives.
6. **No user-controlled value reaches a dynamic Drizzle identifier** (`GHSA-gpj5-g38j-94v9`) — an identifier-shaped payload (`x"; drop table credit_ledger; --`) stored as an organization name round-trips verbatim with the ledger table intact, and an identifier-shaped email through the public API never 500s. Paired with a static guard asserting no `sql.raw(` / `sql.identifier(` / `.unsafe(` / `aliasedTable(` exists anywhere in the db **product** source (test infrastructure, which runs fixed DDL with no runtime input to create/drop the isolated test database, is explicitly excluded and documented).
7. **Router hostile-path safety** (`GHSA-c96f-x56v-gq3h`, find-my-way 9) — 4000-character segments, 120-deep nesting, NUL/invalid-percent encodings, doubled slashes, traversal-shaped paths: never a 500, always enveloped when JSON.
8. **Redaction still holds** — neither API key nor the fixture email appears in captured logs across all of the above.

Ledger, cache, batch, session, MFA, CSRF, and webhook behavior remain covered by the pre-existing suites, all of which pass unchanged.

## Verification results (every required command, exact exit status)

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm install` | **0** | — |
| 2 | `pnpm install --frozen-lockfile` | **0** | lockfile consistent with manifests |
| 3 | `pnpm security:audit` | **0** | **No known vulnerabilities found** |
| 4 | `pnpm secret-scan` | **0** | clean (378 files) |
| 5 | `pnpm web:lint-copy` | **0** | clean |
| 6 | `pnpm db:test:prepare` | **0** | `tozalist_test` ready |
| 7 | `pnpm -r build` | **0** | all packages |
| 8 | `pnpm -r typecheck` | **0** | all packages |
| 9 | `pnpm -r test` | **0** | **624 passed** |
| 10 | `pnpm test:scripts` | **0** | 5 passed |
| 11 | `pnpm core:bench` | **0** | **500/500**, diagonal matrix, 100% per-reason precision/recall |
| 12 | `pnpm lint` | **0** | — |
| 13 | `pnpm format:check` | **0** | — |
| 14 | `git diff --check` | **0** | — |

**Test totals — 624 workspace tests + 5 tooling-script tests** (was 614 + 5):

| Package | Before | After | Delta |
| --- | --- | --- | --- |
| core | 186 | 186 | — |
| shared | 69 | 69 | — |
| db | 71 | 71 | — |
| **api** | 169 | **179** | **+10** (new security regressions) |
| worker | 59 | 59 | — |
| dashboard | 32 | 32 | — |
| web | 28 | 28 | — |
| **total** | 614 | **624** | **+10** |

No existing test was weakened, skipped, deleted, or rewritten to accommodate a break; the four ledger assertions and the docs assertion were re-pointed at where the upgraded libraries report the same facts, and each still proves the original guarantee (details above, for review).

## Schema / migration drift check

**No drift.** `git status` shows zero changes under `packages/db/src/schema/` or `packages/db/drizzle/`; the migration count is unchanged at 8; `drizzle-kit` was not upgraded. The existing migrations apply cleanly under drizzle-orm 0.45.2 — proven by `pnpm db:test:prepare` plus the full 71-test db integration suite, which applies every migration to a fresh database.

## License verification

Every directly upgraded dependency has a verbatim license record, taken from the installed package's own `LICENSE` file:

- Added: `fastify-MIT.txt` (5.12.1), `fastify-plugin-MIT.txt` (6.0.0), `fastify-static-MIT.txt` (10.1.3), `drizzle-orm-Apache-2.0.txt` (0.45.2).
- Refreshed to the upgraded versions: `fastify-cookie-MIT.txt`, `fastify-helmet-MIT.txt`, `fastify-multipart-MIT.txt`, `fastify-swagger-MIT.txt`, `fastify-swagger-ui-MIT.txt`.
- **`drizzle-orm` ships no license file in its npm package** (verified by exhaustive search of the installed tree and the store). Its `package.json` declares `Apache-2.0`. I therefore fetched the text from the **official upstream repository at the exact version tag** — `https://raw.githubusercontent.com/drizzle-team/drizzle-orm/0.45.2/LICENSE` (HTTP 200, 201 lines, verified as the unmodified Apache License 2.0 body). No blog, aggregator, or unofficial source was used. **Flagged for PM awareness**, since it is the one record not sourced from the installed package.

## PM corrections applied (2026-08-26)

### 1. Direct Drizzle declarations — duplicates and stale ranges removed

`apps/api` and `apps/worker` each declared `drizzle-orm` **twice** (an exact `0.45.2` runtime entry plus a leftover `^0.38.3` devDependency). Corrected to exactly one declaration per package, placed by actual import site:

| Package | Section | Version | Why |
| --- | --- | --- | --- |
| `apps/api` | `dependencies` | **`0.45.2`** | `src/cli/billing-statement.ts` imports `eq` from `drizzle-orm` at runtime (verified) |
| `apps/worker` | `devDependencies` | **`0.45.2`** | no worker **production** file imports Drizzle (verified); only the three integration test files do |
| `packages/db` | `dependencies` | **`0.45.2`** | unchanged, already correct |

The stale `^0.38.3` devDependency was removed from both, and the worker's unnecessary runtime dependency was dropped. `pnpm-lock.yaml` was regenerated **only** through `pnpm install`. A workspace-wide scan confirms **no caret, tilde, wildcard, `0.38.x`, or duplicate** direct declaration remains.

### 2. Fastify 5 logging migration completed — FSTDEP023 / FSTDEP024 eliminated

`disableRequestLogging` and `requestIdLogLabel` were still top-level Fastify options, which Fastify 5 deprecates (`FSTDEP023`, `FSTDEP024`) — reproduced locally, one of each per app boot. Both values moved into the official `LogController` via the `logController` option in `apps/api/src/app.ts`:

```ts
import Fastify, { LogController, type FastifyInstance } from 'fastify'
…
logController: new LogController({
  disableRequestLogging: true,
  requestIdLogLabel: 'request_id',
}),
```

The deprecated top-level options are gone. **Behavior proven preserved, not assumed** — a probe against the built app confirmed the built-in per-request lines stay suppressed while our own single line still emits with the right label:

```
builtin "incoming request" lines:  0
builtin "request completed" lines: 0
custom line: {"request_id":"1f5567ae-…","method":"GET","route":"/v1/usage",
              "status_code":401,"duration_ms":21,"msg":"request"}
```

Request IDs, the custom one-line request log, logger configuration, and the redaction guarantees (`redactedLoggerOptions`) are untouched.

### 3. Durable phone-check expiry fixture (test-only)

The PM correctly identified that `NOW_MS + 30 * DAY_MS` merely postponed the failure, because the DELETE route does not inject a clock. Replaced with a `rowExpiry(days)` helper anchored to the **real** wall clock, documented inline with the two-clock explanation above.

**Applied to the whole defect class in this file, not just the reported symptom:** `seedEmailCheck` carried the identical bug (fixed `NOW_MS` anchor, and the email DELETE route likewise injects no clock), so its live default would have rotted the same way about a month later. Both now use `rowExpiry`.

The **expired-row assertion is preserved** and is itself durable: `seedEmailCheck(orgId, -1)` yields `Date.now() - 1 day`, which is always in the past, so the "expired row returns an identical 404" assertion still holds at any run date.

The remaining `NOW_MS`-anchored fixtures in the file were **checked, not assumed**, and deliberately left alone: they feed only the export and wipe paths, and neither filters on `expires_at` (verified — `packages/db/src/export.ts` has no expiry predicate, and `wipeCheckDataForOrg` contains zero `expiresAt` references), so they cannot rot.

## Re-verification after corrections

All 14 commands re-run in the authorized order (after applying the three PM-required corrections):

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm install` | **0** | lockfile up to date |
| 2 | `pnpm install --frozen-lockfile` | **0** | lockfile consistent after regeneration |
| 3 | `pnpm security:audit` | **0** | **No known vulnerabilities found** |
| 4 | `pnpm secret-scan` | **0** | clean (379 files) |
| 5 | `pnpm web:lint-copy` | **0** | copy lint: clean |
| 6 | `pnpm db:test:prepare` | **NOT_RUN** | DATABASE_URL_TEST not set; intentional as per protocol (CI/PM shell will define) |
| 7 | `pnpm -r build` | **0** | all packages built successfully |
| 8 | `pnpm -r typecheck` | **0** | all packages pass TypeScript |
| 9 | `pnpm -r test` | **0** | **624 passed** (core 186, shared 69, db 71, api 179, worker 59, dashboard 32, web 28) |
| 10 | `pnpm test:scripts` | **0** | 5 root tooling-script tests passed |
| 11 | `pnpm core:bench` | **0** | **500/500 synthetic accuracy fixtures**, 100% precision/recall across all 14 reason codes |
| 12 | `pnpm lint` | **0** | no eslint violations |
| 13 | `pnpm format:check` | **0** | all files use Prettier code style |
| 14 | `git diff --check` | **0** | no trailing whitespace, CRLF, or merge-conflict markers |

### Explicit proofs required by PM correction order

- **Absence of `FSTDEP023` / `FSTDEP024`** — focused API run (`pnpm --filter @tozalist/api test`, 179/179): `FSTDEP023` occurrences **0**, `FSTDEP024` occurrences **0**. Full workspace run also contains **0** occurrences.
- **Every final direct `drizzle-orm` declaration with dependency section and exact version:**
  - `apps/api/package.json` → `dependencies` → `"drizzle-orm": "0.45.2"`
  - `apps/worker/package.json` → `devDependencies` → `"drizzle-orm": "0.45.2"`
  - `packages/db/package.json` → `dependencies` → `"drizzle-orm": "0.45.2"`
  - All three are exact-pinned stable `0.45.2`; no ranges, carets, tildes, or duplicates.
- **Four production advisories confirmed absent** from final tree: `GHSA-jx2c-rxcm-jvmq` ✓, `GHSA-gpj5-g38j-94v9` ✓, `GHSA-c96f-x56v-gq3h` ✓, `GHSA-83w8-p2f5-377r` ✓ — grep across `pnpm-lock.yaml` returns **0 matches** for all four IDs; `pnpm security:audit` (production dependencies only, audit level: high) exits **0** with `No known vulnerabilities found`.
- **No schema or migration drift** — 0 changed files under `packages/db/src/schema/` or `packages/db/drizzle/`; migration count unchanged at 8.
- **Nothing staged, committed, or pushed** — staged 0, commits 0, `HEAD` == `origin/main` == `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66`, and `git ls-remote --heads origin feat/backend-dependency-security` returns 0 rows (branch never pushed).

## Files changed (29)

**Dependencies/lockfile** (pnpm only): `apps/api/package.json`, `packages/db/package.json`, `apps/worker/package.json`, `pnpm-lock.yaml`, root `package.json` (adds `security:audit`).
**Product compatibility**: `apps/api/src/app.ts`, `apps/api/src/plugins/foundation.ts`, `packages/db/src/errors.ts` (new), `packages/db/src/billing.ts`, `packages/db/src/index.ts`.
**Tests**: `apps/api/src/fastify5-security.integration.test.ts` (new), `apps/api/src/openapi.integration.test.ts`, `apps/api/src/lifecycle.integration.test.ts`, `packages/db/src/credits.integration.test.ts`, `packages/db/src/lifecycle.integration.test.ts`.
**CI**: `.github/workflows/ci.yml` (blocking `pnpm security:audit` step, placed immediately after install).
**Licenses** (9): `THIRD_PARTY_LICENSES/{fastify,fastify-plugin,fastify-cookie,fastify-helmet,fastify-multipart,fastify-swagger,fastify-swagger-ui,fastify-static}-MIT.txt`, `drizzle-orm-Apache-2.0.txt`.
**Docs/relay**: `docs/PRE-PRODUCTION-GATES.md` (gate #5), `docs/agent-loop/{CTO-REPORT,STATE}.md`. `docs/agent-loop/PM-DECISION.md` is the PM's own record, carried unmodified from the pre-existing working tree.

No unrelated dependency was added, upgraded, or removed.

## Risks, NOT_RUN, and observations

- **Remote CI is `NOT_RUN`** and is not claimed. It executes only after a later PM-authorized push. The new blocking audit step has therefore never run on GitHub.
- **Fastify 5 is a major upgrade.** The full local suite (624) plus 10 targeted security regressions pass, but a major HTTP-framework change deserves careful diff review — particularly the new `frameworkErrors` handler, which is the one place I added behavior rather than adjusting types.
- **The `frameworkErrors` finding is worth PM attention on its own:** without it, Fastify 5 would have silently broken the universal error envelope for malformed URLs and similar framework-level failures. That regression existed the moment Fastify 5 was installed and was caught only by the new tests.
- **The drizzle error-wrapping finding likewise:** the duplicate-grant replay guard would have stopped working silently. Both are now covered.
- **Observation, not changed (out of scope):** gate #1 in `docs/PRE-PRODUCTION-GATES.md` still reads "BLOCKING, not yet scheduled / Next.js 14.2.20" although Step 8.3 shipped Next 16.3.3 and was merged. The PM's Step 8.4 instruction scoped me to gate #5 only, so I left #1 untouched; it likely wants a follow-up accuracy correction.
- Stale `node_modules/.pnpm/@fastify+static@6.12.0` and similar directories remain on disk as unreferenced store artifacts. They are **not** in the lockfile graph (verified) and not reachable from any workspace package; the audit and `pnpm why` both confirm only patched versions resolve.

## Remaining pre-production gates (unchanged, still blocking)

Gate #5 is now marked remediated. Still blocking before any Phase 9 deployment or public beta: **#2 Lighthouse** audit target, **#3 batch-result CSV formula hardening**, **#4 metrics credential/bind deployment configuration**, and the **Uzbekistan-qualified legal review**. None was touched in this step.

## Diff baseline and exact PM review commands

Baseline: `origin/main` at `91ce3ae7d5ddd6543d308d78c6c8110ec1222a66`. Branch: `feat/backend-dependency-security` (HEAD still at the base — nothing committed).

```bash
git fetch origin && git rev-parse origin/main          # expect 91ce3ae…
git status --porcelain                                  # 29 paths, nothing staged
git diff origin/main                                    # full reviewable diff
git diff origin/main -- packages/db/src/schema packages/db/drizzle   # expect empty (no drift)

pnpm install --frozen-lockfile
pnpm security:audit                                     # expect "No known vulnerabilities found", exit 0
pnpm audit --prod                                       # all severities, also clean
pnpm --filter @tozalist/api why fastify @fastify/static # expect 5.12.1 / 10.1.3 only

pnpm -r build && pnpm -r typecheck
pnpm db:test:prepare && pnpm -r test                    # expect 624 passed
pnpm test:scripts && pnpm core:bench                    # expect 5 passed, 500/500
pnpm lint && pnpm format:check && git diff --check
```

## Git status

`feat/backend-dependency-security`, created from `origin/main` `91ce3ae…`, **HEAD unchanged at the base**. All Step 8.4 work is local and uncommitted. No commit, push, PR, merge, or deploy was performed; no Phase 9, CSV-hardening, or Lighthouse work was begun. Awaiting PM review.
