# CTO Report — Step 6.1 correction (CORS trust boundary, rate-limit member, badge localization)

## Step and outcome

Step `6.1`, correction cycle per `PM-DECISION.md`. The public-site/dashboard trust boundary is restored with route-separated CORS, the public rate limiter uses collision-safe CSPRNG members, the four sample verdict badges are localized, and lead-email normalization preserves the local part. Still on `feat/phase-6-public-site`, local-only, uncommitted. No Step 6.2 work.

## Correction implemented

1. **Route-separated CORS** — the root-level allowlist is gone. Two encapsulated scopes now carry their own explicit policies via a new `addScopedCors` helper (`apps/api/src/cors.ts`): an onRequest header hook plus a preflight OPTIONS route, both scope-local, so policies structurally cannot bleed:
   - `/internal/*`: `DASHBOARD_ORIGIN` only, credentialed, GET/POST, Content-Type + X-CSRF-Token.
   - `/public/leads`: `WEB_ORIGIN` only, **no** `Access-Control-Allow-Credentials` ever, POST only, Content-Type only.
   - Non-matching origins receive no Access-Control-* headers anywhere.
   Implementation note: the first attempt used two sibling `@fastify/cors` registrations, which deadlocked at boot and leaked scope; the plugin was replaced with the explicit ~40-line scoped implementation and removed from dependencies (license record deleted accordingly).
2. **Collision-safe rate-limit member** — the Lua `math.random()` suffix in `public-leads.ts` is replaced by a Node `randomUUID()` passed per request as an ARGV, matching the API-key limiter's rule. The Lua operation remains a single atomic script; failure remains fail-closed.
3. **Badge localization** — the four sample-result badges render from new locale keys: uz `yaroqli/xavfli/noma'lum/yaroqsiz`, ru `рабочий/рискованный/неизвестно/нерабочий`, en unchanged; the sample descriptions lost their embedded English tokens in all locales. The copy-lint gate stays clean.
4. **Lead email normalization** — trimmed, domain lowercased, local part preserved byte-for-byte (RFC 5321), replacing the previous full lowercase.

All retained behavior verified unchanged: honeypot success-without-storage, strict body bounds, 180-day lead expiry, no personal-data logging, honest no-delivery copy, banned-copy prebuild gate.

## Files changed (correction only)

`apps/api/src/cors.ts` (new) · `apps/api/src/app.ts` (scoped registration) · `apps/api/src/routes/public-leads.ts` (member + normalization) · `apps/api/src/public-leads.integration.test.ts` (+3 tests, 1 updated) · `apps/web/lib/messages.ts` (badge keys, de-tokenized samples) · `apps/web/app/[locale]/page.tsx` (badges from messages) · `apps/web/tests/locales.test.tsx` (+1) · `apps/api/package.json`/`pnpm-lock.yaml` (−@fastify/cors) · `THIRD_PARTY_LICENSES/` (record removed with the dependency).

## Required proof (all passing)

- **Trust boundary**: `WEB_ORIGIN` receives no Access-Control-* header on `/internal/me` — asserted for both preflight and simple requests; the dashboard origin keeps credentialed access to `/internal`; the dashboard origin gets nothing on `/public/leads`; and the lead endpoint's allowed preflight carries **no** allow-credentials header. The pre-existing dashboard CORS test also passes against the new implementation.
- **Redis-unavailable**: a lead POST with Redis down returns the generic 500 envelope, stores nothing, and neither the response nor captured logs contain the submitted email, domain, or phone.
- **Per-IP behavior retained**: 3 allowed → 429, other IPs unaffected.
- **Localization**: the badge test pins the exact uz/ru values and asserts they differ from English; the completeness walk covers the new keys automatically.
- **Local-part preservation**: the lead-write test now submits mixed case and asserts the stored email keeps the local part exactly while the domain lowers.

## Verification results

`pnpm db:test:prepare` ✓ · `pnpm web:lint-copy` ✓ clean · web ✓ **14** (+1) · api ✓ **145** (+3) · `pnpm -r build` ✓ (prebuild gate observed) · `pnpm -r test` ✓ **500** (core 173, shared 43, db 52, api 145, worker 50, dashboard 23, web 14) · `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm format:check` ✓ · `git diff --check` clean. **Lighthouse remains `NOT_RUN`** — no audit harness or local browser binary in this environment; the ≥95 target is not claimed.

## Risks or decisions requiring PM review

- `@fastify/cors` was removed in favor of the explicit scoped implementation — a dependency reduction made necessary by the boot deadlock, flagged since dependency changes deserve PM visibility.

## Known limitations / blockers

Lighthouse `NOT_RUN` as recorded. Prior open notes unchanged.
