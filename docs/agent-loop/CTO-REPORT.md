# CTO Report — Step 8.3 correction (framework upgrade + pre-existing-advisory disclosure)

## Step and outcome

Step `8.3`, the pre-Phase-9 framework-support release gate, implemented and verified on the fresh branch `feat/framework-support-next16` (created from fetched `origin/main` at `d06218e`). Dashboard and public-web are upgraded to the supported line — Next.js **16.3.3** / React **19.2.8** — off the unsupported 14.x. The App Router async-`params` migration is applied throughout `apps/web`, SSG and all locale routes are preserved, and every carried behavior (sessions, MFA/CSRF, lead form, CSP/headers, MDX/DRAFT banners, i18n routing, generated OpenAPI reference, plan pricing) is re-proven. Local-only, uncommitted; **no commit, push, PR, deploy, or Phase 9 work**. No new framework features (React Compiler etc.) were enabled.

## Versions (pinned exactly, no prerelease/latest)

| Package | Before | After |
| --- | --- | --- |
| `next` (web + dashboard) | 14.2.20 | **16.3.3** |
| `@next/mdx` (web) | ^14 | **16.3.3** |
| `react`, `react-dom` (web + dashboard) | ^18.3.1 | **19.2.8** |
| `@types/react` (web + dashboard) | ^18.3.18 | **19.2.8** |
| `@types/react-dom` (web + dashboard) | ^18.3.5 | **19.2.5** |

Nothing else changed: Fastify, the Go engine, database, worker, shared/core packages, Tailwind, billing, and product behavior are untouched.

## App Router async-`params` migration (`apps/web`)

Next 16 makes route `params` an async Promise. All twelve `[locale]` route entries were migrated to async Server Components that `await params`:

- `page.tsx` — both `generateMetadata` (now `async … : Promise<Metadata>`) and `LandingPage` await params; the `isLocale` type guard narrows the resolved `locale` to `Locale` (the now-unused `type Locale` import was removed).
- `contact`, `privacy`, `terms`, `prohibited-use`, `docs` index, and the five docs pages (`glossary`, `quickstart`, `limitations`, `reference`, `webhooks`) — each `export default async function … ({ params }: { params: Promise<{ locale: string }> })` with `const { locale } = await params` before the `isLocale` guard.

`generateStaticParams` signatures are unchanged (they return param values, not receive them), so **SSG is preserved** — the build statically prerenders all 38 pages across the three locales. The dashboard has no dynamic route segments, so no async-params change was needed there.

## Preserved and re-proven behaviors

- **CSP / security headers** — verified concretely by serving each app under `next start` and inspecting live responses: both web (`/uz`) and dashboard (`/login`) still emit HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and the full CSP (`default-src 'self'`, `connect-src 'self' <api>`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'`). The `headers()` config is unchanged.
- **i18n routing** — `/uz`, `/ru`, `/en` and nested docs routes all serve 200 under Next 16; `locales.test.tsx` and the new async-params test pass.
- **MDX compilation + DRAFT banners** — the build compiles all MDX legal/docs pages under `@next/mdx` 16 (the privacy data-map content renders in the static output); `draft-banner` tests pass.
- **Generated OpenAPI reference** — the web prebuild still exports `openapi.json` and the reference page renders in the build.
- **Plan-driven pricing** — `pricing-plans.test.tsx` (updated for the async component) still asserts every price/allowance renders from `@tozalist/core` PLANS in all locales, with no hard-coded amounts.
- **Dashboard sessions, MFA, CSRF, public lead form** — the API integration suite (169) and dashboard suite (32) pass unchanged, including MFA flow, billing, data-controls, and the pilot/lead form.

## Regression tests added

- `apps/web/tests/async-params.test.tsx` — pins the migration: awaiting Promise `params` renders each localized page (docs index + glossary) with the resolved locale in links/content, and an unknown locale triggers `notFound()` from resolved params.
- `apps/web/tests/pricing-plans.test.tsx` — updated to `await LandingPage({ params: Promise.resolve({ locale }) })`, keeping the single-source pricing gate intact under the async component model.

No existing test was weakened or deleted to make the upgrade pass.

## Narrowly-scoped compatibility edits (documented)

- `.prettierignore` — added `**/next-env.d.ts`. Next 16 regenerates these files ("This file should not be edited") in a form Prettier reformats; excluding the generated files is the correct fix rather than fighting regeneration. `apps/{web,dashboard}/next-env.d.ts` show the Next 16-regenerated content.
- License records — `THIRD_PARTY_LICENSES/{next-MIT.txt, react-MIT.txt, react-dom-MIT.txt}` added (verbatim MIT texts from the installed packages) and `next-mdx-MIT.txt` refreshed to the 16.3.3 text. `next`/`react`/`react-dom` were direct dependencies never previously recorded; recording them at this major-version change closes that gap. No new dependency was added.

## Verification results (PM's required list)

`pnpm install` ✓ · `pnpm install --frozen-lockfile` ✓ (exit 0) · `pnpm web:lint-copy` ✓ clean · `pnpm core:bench` ✓ 500/500 · `pnpm -r build` ✓ (web 38 static pages; dashboard compiles) · `pnpm -r test` ✓ **614** (core 186, shared 69, db 71, api 169, worker 59, dashboard 32, web **28** (+2)) · `pnpm lint` ✓ · `pnpm -r typecheck` ✓ · `pnpm format:check` ✓ · `pnpm secret-scan` ✓ clean (373 files) · `git diff --check` ✓. `pnpm db:test:prepare` ✓. **`NOT_RUN`**: the GitHub Actions workflow (runs on a later authorized push) and Lighthouse (Phase 9 deployment gate — not claimed here).

## Focused security review (fresh, this upgrade)

- **Next config** — `next.config.mjs` for both apps unchanged apart from being run by Next 16; `createMDX` and `pageExtensions` intact; no `output: 'export'`, so `headers()` applies at serve time (verified live above). No experimental/React-Compiler flags enabled.
- **CSP / header output** — verified emitting on live responses for both apps (above); no relaxation, no new external origins (only the existing API origin in `connect-src`). `'unsafe-inline'` script-src remains the standard Next hydration trade-off, unchanged.
- **Route rendering** — all pages remain Server Components; the async migration moved param resolution server-side only. No new client boundary or data exposure. `notFound()` guards on unknown locales are retained and tested.
- **MDX rendering** — compiles under `@next/mdx` 16; content is the same repo-authored MDX; no remote/user content path introduced.
- **Client data flow** — no client component changed; the lead form and dashboard client code are byte-identical; no new network destinations.
- **Dependency changes (this step)** — only the framework set (all MIT), pinned to exact supported versions; lockfile updated by pnpm; no unrelated or prerelease dependency. The Next.js/React code and configuration review above is clean and introduced no vulnerability. This review is code/config only — it does **not** claim a deploy or a Lighthouse audit.

### Pre-existing production dependency advisories (independent PM audit — corrected disclosure)

The PM independently ran `pnpm audit --prod --audit-level=high` against the current lockfile and found four **pre-existing** high-severity production-dependency advisories. **None was introduced by the Next.js/React upgrade** — they live in the Fastify/Drizzle backend chain, which Step 8.3 did not touch — and the exact Next-focused code/config review remains clean. They are disclosed here and registered as a blocking pre-production gate (see `docs/PRE-PRODUCTION-GATES.md` #5):

  - `fastify@4.29.1` — Content-Type `tab` body-validation bypass; advisory `GHSA-jx2c-rxcm-jvmq`; patched only in Fastify `>=5.7.2`.
  - `drizzle-orm@0.38.4` — improperly escaped SQL identifier injection; advisory `GHSA-gpj5-g38j-94v9`; patched in `>=0.45.2`.
  - `find-my-way@8.2.2` (via Fastify) — HTTP/2 denial of service; advisory `GHSA-c96f-x56v-gq3h`; patched in `>=9.7.0`.
  - `@fastify/static@6.12.0` (via Swagger UI) — route-guard bypass / path traversal; advisory `GHSA-83w8-p2f5-377r`; patched in `>=10.1.1`.

  Remediation is deliberately **not** attempted in this documentation-only correction (it needs a compatible Fastify 5 migration, a Drizzle upgrade, and compatible Swagger-UI/static/router updates, each with its own regression pass); it is deferred to the new pre-production gate.

## Known consequences / carry-forward

- React 19 + Next 16 are a major upgrade; behavior is re-proven by the full green suite and live header/route checks, but the authoritative remote confirmation is a green GitHub Actions run after a later authorized sync (not authorized this cycle).
- Still-required pre-launch gates: a real **Lighthouse** audit meeting the documented target; **batch-result CSV formula neutralization** (the older Step 4.1 result CSV); and the newly-registered **backend dependency-security remediation** gate for the four pre-existing high-severity advisories above (`docs/PRE-PRODUCTION-GATES.md` #5). Deployment, public beta, production SMTP, real customer data, payment-provider work, and legal-policy finalization remain out of scope.

## Files changed

`apps/web/package.json`, `apps/dashboard/package.json`, `pnpm-lock.yaml` · all 12 `apps/web/app/[locale]/**/page.tsx` (async params) · `apps/web/tests/pricing-plans.test.tsx`, new `apps/web/tests/async-params.test.tsx` · `apps/{web,dashboard}/next-env.d.ts` (Next-generated) · `.prettierignore` · `THIRD_PARTY_LICENSES/{next-MIT.txt, react-MIT.txt, react-dom-MIT.txt, next-mdx-MIT.txt}` · `docs/agent-loop/{CTO-REPORT.md, STATE.md}`. `docs/agent-loop/PM-DECISION.md` is the PM's decision, left untouched.

## Git status

`feat/framework-support-next16`, all Step 8.3 work local and uncommitted on top of `origin/main` (`d06218e`). No PR exists. Awaiting PM review; no Git write is authorized in this cycle.
