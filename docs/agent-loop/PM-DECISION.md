# PM Decision

## Review

- Step ID: `6.2` correction — Public docs and legal pages.
- Baseline checked: `YES — all Phase 6 work is local on feat/phase-6-public-site, on top of synchronized Step 6.1 commit 5370fea.`
- CTO report and actual implementation reviewed: `YES — generated OpenAPI reference, glossary, MDX pages, draft-banner flag, contact lead source, copy gate, sitemap, formatter handling, and licenses.`
- Scope checked: `YES — all changes belong to Phase 6. No Phase 7 work, payments, deployment, real-data processing, or product-accounting change is present.`
- Privacy/security/legal-status checked: `YES — the legal pages retain the single DRAFT banner; the privacy table now truthfully distinguishes a 180-day expiry marker from the not-yet-live automatic purge. This is not legal approval. Any manual deletion commitment remains an owner operational responsibility until Phase 7 implements purge automation.`
- Acceptance evidence checked: `YES — the glossary is generated from core with an exact drift test; every legal page uses the single DRAFT flag; prohibited use includes every required category; the contact form writes only the enum-approved landing_contact source.`
- Verification independently rerun: `YES — database preparation, copy lint, web 24, API 146, workspace build (including a fresh OpenAPI export and 39 static pages), formatter after the build, lint, typecheck, core 173, shared 43, db 52, dashboard 23, worker 50, and diff check all pass: 511 tests total.`
- Lighthouse: `NOT_RUN — the ≥95 performance/accessibility target remains a Phase 9 pre-launch audit gate and is not claimed.`
- Dependency compliance checked: `YES — @next/mdx 14.2.35, @mdx-js/loader 3.1.1, @mdx-js/react 3.1.1, and @types/mdx 2.0.14 are MIT in their installed package metadata, with matching root THIRD_PARTY_LICENSES records.`

## Decision

- Decision: `APPROVED`
- Rationale: `Step 6.2 and its focused correction satisfy the roadmap acceptance criteria and all required release gates now pass after a clean build. Phase 6 is ready for its single GitHub review handoff. The legal pages remain plainly marked as engineering drafts, not approved legal terms.`

## Authorized Git sync and Phase 6 draft PR

On `feat/phase-6-public-site`, make one atomic commit containing only the reviewed Step 6.2 work, its correction, and relay records; then push only that branch to `origin`; then create one **draft** pull request into `main`. Do not merge it.

Included paths:

- `.prettierignore`
- `THIRD_PARTY_LICENSES/mdx-js-loader-MIT.txt`
- `THIRD_PARTY_LICENSES/mdx-js-react-MIT.txt`
- `THIRD_PARTY_LICENSES/next-mdx-MIT.txt`
- `THIRD_PARTY_LICENSES/types-mdx-MIT.txt`
- `apps/api/package.json`
- `apps/api/scripts/export-openapi.ts`
- `apps/api/src/public-leads.integration.test.ts`
- `apps/api/src/routes/public-leads.ts`
- `apps/web/.gitignore`
- `apps/web/app/[locale]/contact/page.tsx`
- `apps/web/app/[locale]/docs/glossary/page.tsx`
- `apps/web/app/[locale]/docs/limitations/page.tsx`
- `apps/web/app/[locale]/docs/page.tsx`
- `apps/web/app/[locale]/docs/quickstart/page.tsx`
- `apps/web/app/[locale]/docs/reference/page.tsx`
- `apps/web/app/[locale]/docs/webhooks/page.tsx`
- `apps/web/app/[locale]/privacy/page.tsx`
- `apps/web/app/[locale]/prohibited-use/page.tsx`
- `apps/web/app/[locale]/terms/page.tsx`
- `apps/web/app/sitemap.ts`
- `apps/web/content/limitations.mdx`
- `apps/web/content/privacy.mdx`
- `apps/web/content/prohibited-use.mdx`
- `apps/web/content/quickstart.mdx`
- `apps/web/content/terms.mdx`
- `apps/web/content/webhooks.mdx`
- `apps/web/lib/draft-banner.tsx`
- `apps/web/lib/glossary.ts`
- `apps/web/lib/messages.ts`
- `apps/web/lib/openapi.ts`
- `apps/web/lib/page-shell.tsx`
- `apps/web/lib/pilot-form.tsx`
- `apps/web/lib/site-config.ts`
- `apps/web/mdx-components.tsx`
- `apps/web/mdx.d.ts`
- `apps/web/next.config.mjs`
- `apps/web/package.json`
- `apps/web/scripts/lint-copy.mjs`
- `apps/web/tests/draft-banner.test.tsx`
- `apps/web/tests/glossary.test.ts`
- `apps/web/tests/openapi.test.ts`
- `apps/web/tests/pilot-form.test.tsx`
- `docs/agent-loop/CTO-REPORT.md`
- `docs/agent-loop/PM-DECISION.md`
- `docs/agent-loop/STATE.md`
- `pnpm-lock.yaml`

Use commit message: `web: add public docs and draft legal pages`.

Create a draft PR with:

- Title: `Phase 6: public site, docs, and draft policies`
- Base: `main`
- Body: `Delivers Phase 6 in two reviewed commits: localized pilot landing and lead intake; public docs with build-time OpenAPI reference, generated reason-code glossary, and webhook guide; plus draft privacy, terms, and prohibited-use pages. Verification: 511 tests; 39 static public pages; build, copy lint, formatter-after-build, lint, typecheck, and diff check pass. Known pre-launch gates: Lighthouse ≥95 remains unmeasured; legal pages are DRAFT pending counsel; lead expiry is marked at 180 days and requires manual handling until the Phase 7 purge job.`

After the commit, push, and draft-PR creation, record the commit hash, remote branch, and PR URL in `CTO-REPORT.md`; set `STATE.md` to `awaiting_pm_review` with Step `6.2`; and stop. Do not edit product code, begin Step 7.1, merge, deploy, enable production SMTP, process real customer data, add payments, or remove/approve the DRAFT legal banner.

## Explicit exceptional permissions

- [x] Commit — scope: `one atomic Step 6.2 commit containing only the listed paths on feat/phase-6-public-site; message exactly “web: add public docs and draft legal pages”.`
- [x] Push — scope: `only feat/phase-6-public-site to origin; never main.`
- [x] Create draft pull request — scope: `one new draft PR from feat/phase-6-public-site into main; title and body exactly as specified above.`
- [ ] Merge — scope: `N/A — product owner merges manually in GitHub.`
- [ ] Deploy — scope: `N/A`
- [ ] Delete material data — scope: `N/A`
- [ ] Enable production SMTP — scope: `N/A`
- [ ] Process real customer data — scope: `N/A`
- [ ] Add a payment provider — scope: `N/A`
- [ ] Change legal/privacy policy — scope: `N/A — pages remain DRAFT pending counsel.`

## State transition

- State status: `ready_for_cto`
- Current step after decision: `6.2` (approved Git-sync and Phase 6 draft-PR handoff only)
- Owner: `Claude Code`
- Next action: `Commit, push, and create only the authorized Phase 6 draft PR; report the result, set awaiting_pm_review, and stop.`
