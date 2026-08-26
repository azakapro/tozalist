# PM Decision

## Phase 8 completion and remote verification

- Step ID: `8.2` — Accuracy regression corpus.
- Acceptance: `PASS — exactly 500 deterministic synthetic fixtures; every fixture self-identifies the evaluated stub address; genuine non-ASCII Unicode, punycode IDN, and long-address coverage; reserved .invalid/.test non-existent-domain cases; no DNS or engine/network access; 100% pass/fail regression gate using the real local aggregation pipeline; CI wired; documentation clearly limits the result to logic correctness.`
- Evidence: `pnpm core:bench passes 500/500 with a diagonal verdict matrix and 100% precision/recall for every email reason code, and exits non-zero when a label is deliberately corrupted. Independent PM verification passed pnpm -r test: 612 workspace tests (core 186, shared 69, db 71, api 169, worker 59, dashboard 32, web 26); secret scan, copy lint, build, lint, typecheck, tooling tests, format-after-build, and diff check also passed. The standalone DB-preparation command requires DATABASE_URL_TEST, which is intentionally absent in this PM shell; the integration suite and CI define it.`
- Scope, privacy, accounting, and retention: `PASS — corpus data is synthetic and stub-only. No customer data, payment, ledger, retention, deployment, SMTP, or legal-policy behavior changed. tsx is a dev-only MIT dependency with a verbatim license record. Bench code is typechecked/tested but excluded from product dist.`
- Remote CI: `PASS — the push and pull-request runs for final commit 11921830d16e1c9791ad978820cdaa82da67a596 both completed successfully, including the accuracy-regression gate.`
- Pull request: `#6 — Phase 8: security hardening and accuracy regression gate — was manually merged by the product owner.`
- Merged main: `d06218ee72cce872945bcee0b7dd2156be66d008`, fetched and confirmed as `origin/main`.

## Decision

- Decision: `APPROVED`
- Rationale: `Step 8.3 meets its framework-support acceptance scope. The Next.js/React upgrade, async route-parameter migration, exact framework dependency pins, generated-file handling, licenses, and regression coverage are all in scope and pass independent PM verification. The corrected disclosure accurately records four pre-existing high-severity backend advisories and registers their remediation as a separate blocking pre-production gate; this approval does not waive or remediate those advisories.`

## Explicit Step 8.3 Git handoff

Remain on `feat/framework-support-next16`. Perform only this handoff; do not begin Phase 9 or the backend dependency-security remediation.

1. Before staging, confirm the working-tree change set is exactly these 27 reviewed paths:

   - `.prettierignore`
   - `THIRD_PARTY_LICENSES/next-MIT.txt`
   - `THIRD_PARTY_LICENSES/next-mdx-MIT.txt`
   - `THIRD_PARTY_LICENSES/react-MIT.txt`
   - `THIRD_PARTY_LICENSES/react-dom-MIT.txt`
   - `apps/dashboard/next-env.d.ts`
   - `apps/dashboard/package.json`
   - `apps/web/app/[locale]/contact/page.tsx`
   - `apps/web/app/[locale]/docs/glossary/page.tsx`
   - `apps/web/app/[locale]/docs/limitations/page.tsx`
   - `apps/web/app/[locale]/docs/page.tsx`
   - `apps/web/app/[locale]/docs/quickstart/page.tsx`
   - `apps/web/app/[locale]/docs/reference/page.tsx`
   - `apps/web/app/[locale]/docs/webhooks/page.tsx`
   - `apps/web/app/[locale]/page.tsx`
   - `apps/web/app/[locale]/privacy/page.tsx`
   - `apps/web/app/[locale]/prohibited-use/page.tsx`
   - `apps/web/app/[locale]/terms/page.tsx`
   - `apps/web/next-env.d.ts`
   - `apps/web/package.json`
   - `apps/web/tests/async-params.test.tsx`
   - `apps/web/tests/pricing-plans.test.tsx`
   - `docs/PRE-PRODUCTION-GATES.md`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`
   - `pnpm-lock.yaml`

2. Create one atomic commit containing exactly those paths with this exact message:

   ```text
   web: upgrade to Next 16 and React 19
   ```

3. Push only `feat/framework-support-next16` to `origin`. Do not push or alter `main`.
4. Create exactly one draft pull request into `main` with this exact title:

   ```text
   Release gate: upgrade to Next.js 16 and React 19
   ```

   Use this PR body:

   ```md
   ## Summary

   - Upgrades the dashboard and public site from unsupported Next.js 14 / React 18 to exact-pinned Next.js 16.3.3 / React 19.2.8.
   - Migrates all localized App Router pages to asynchronous `params` while preserving 38 static pages, locale routing, metadata, MDX, pricing, and the generated API reference.
   - Re-proves CSP/security headers, dashboard authentication-related suites, the public lead form, and framework-specific regression coverage.
   - Records required license texts and a generated-file formatting exception.

   ## Verification

   - 614 workspace tests plus 5 tooling-script tests pass locally.
   - Frozen install, copy lint, synthetic accuracy gate (500/500), full build, lint, typecheck, format, secret scan, and whitespace checks pass.
   - The upgrade's focused Next/React security review is clean; remote CI on this commit remains required before merge.

   ## Remaining launch gates

   - Lighthouse audit target, batch-result CSV formula neutralization, and the newly documented backend dependency-security remediation remain blocking before any deployment or public beta.
   - The backend advisory remediation is deliberately separate from this framework upgrade; this PR does not upgrade Fastify or Drizzle.

   Manual merge by the product owner only.
   ```

5. Do not merge the PR. After the push and draft-PR creation, record the commit hash, remote branch, and PR URL in `CTO-REPORT.md`; set `STATE.md` to `awaiting_pm_review` with PM ownership and remote-CI/PR verification as the only next action; then stop. These post-handoff relay-record edits remain uncommitted.

No deployment, public beta, production SMTP, real customer data, payment-provider work, legal-policy finalization, or backend dependency remediation is authorized.

## State transition

- State status: `ready_for_cto`
- Current step: `8.3`
- Owner: `Claude Code`
- Next action: `Perform only the authorized Step 8.3 commit, feature-branch push, and draft-PR handoff, then stop for PM remote verification.`
