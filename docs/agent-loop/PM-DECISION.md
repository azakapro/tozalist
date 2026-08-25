# PM Decision

## Review

- Step ID: `6.1` correction — Landing page.
- Baseline checked: `YES — feat/phase-6-public-site starts at origin/main 62fd04167380a0cbc2a9d7525051af791c32fdbb.`
- CTO report, actual diff, and relevant API/web code reviewed: `YES`.
- Scope checked: `YES — the public lead endpoint, CORS separation, localization, static public site, and copy gate are all necessary Step 6.1 work. No later roadmap work is included.`
- Privacy, security, accounting, and retention checked: `YES — public leads have a 180-day expiry, are not logged, honeypot submissions are not stored, Redis failure closes the public write path, and no payment or credit path changed. The public web origin has no CORS access to dashboard routes; only the dashboard origin receives credentialed internal-route CORS.`
- Verification independently rerun: `YES — database preparation; copy lint; web 14; API 145; worker 50; core 173; shared 43; db 52; dashboard 23 (500 total); workspace build; lint; typecheck; format check; and diff check all pass.`
- Lighthouse: `NOT_RUN — this environment has no local audit harness or browser binary. The ≥95 performance/accessibility target is not claimed. A deployed-site Lighthouse audit and production proxy/IP-rate-limit verification remain required pre-launch gates in Phase 9.`

## Decision

- Decision: `APPROVED`
- Rationale: `The correction eliminates the previous credentialed-CORS trust-boundary leak structurally: the public endpoint is in a separate non-credentialed scope and the dashboard surface remains dashboard-origin-only. The public limiter is collision-safe and fail-closed, lead email handling preserves the local part, and visible sample verdict labels are fully localized. The independent verification matches the CTO report.`

## Authorized Git sync — Step 6.1 only

Commit the reviewed Step 6.1 work plus relay records in one atomic commit on `feat/phase-6-public-site`, then push only that branch to `origin`. Do not create or update a pull request: the single Public site draft PR is authorized only after Step 6.2.

Included paths:

- `.env.example`
- `THIRD_PARTY_LICENSES/fastify-cors-MIT.txt` (removal)
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/config.ts`
- `apps/api/src/cors.ts`
- `apps/api/src/internal/routes.ts`
- `apps/api/src/public-leads.integration.test.ts`
- `apps/api/src/routes/public-leads.ts`
- `apps/api/src/server.ts`
- `apps/web/app/[locale]/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/robots.ts`
- `apps/web/app/sitemap.ts`
- `apps/web/lib/locale-switcher.tsx`
- `apps/web/lib/messages.ts`
- `apps/web/lib/pilot-form.tsx`
- `apps/web/package.json`
- `apps/web/scripts/lint-copy.mjs`
- `apps/web/tests/lint-copy.test.ts`
- `apps/web/tests/locales.test.tsx`
- `apps/web/tests/pilot-form.test.tsx`
- `apps/web/vitest.config.ts`
- `docs/agent-loop/CTO-REPORT.md`
- `docs/agent-loop/PM-DECISION.md`
- `docs/agent-loop/PROTOCOL.md`
- `docs/agent-loop/STATE.md`
- `eslint.config.mjs`
- `package.json`
- `pnpm-lock.yaml`

Use commit message: `web: add localized pilot landing page`.

After the commit and push, report the commit hash and remote branch in `CTO-REPORT.md`, set `STATE.md` to `awaiting_pm_review` with Step `6.1`, and stop. Do not edit product code, begin Step 6.2, create/update a PR, merge, deploy, or process real customer data in this sync handoff.

## Explicit exceptional permissions

- [x] Commit — scope: `one atomic Step 6.1 commit containing only the listed paths on feat/phase-6-public-site; message exactly “web: add localized pilot landing page”.`
- [x] Push — scope: `only feat/phase-6-public-site to origin; never main.`
- [ ] Create/update draft pull request — scope: `Not authorized. Phase 6 receives one draft PR only after Step 6.2 is approved and synchronized.`
- [ ] Merge — scope: `N/A — product owner merges manually in GitHub.`
- [ ] Deploy — scope: `N/A`
- [ ] Delete material data — scope: `N/A`
- [ ] Enable production SMTP — scope: `N/A`
- [ ] Process real customer data — scope: `N/A`
- [ ] Add a payment provider — scope: `N/A`
- [ ] Change legal/privacy policy — scope: `N/A`

## State transition

- State status: `ready_for_cto`
- Current step after decision: `6.1` (approved Git-sync handoff only)
- Owner: `Claude Code`
- Next action: `Commit and push only the authorized Step 6.1 paths, update the relay with the resulting hash and remote branch, set awaiting_pm_review, and stop.`
