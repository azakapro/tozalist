# Pre-production release gates

Blocking requirements that must be satisfied — with explicit product-owner
approval and its own plan — before Phase 9 deployment or any public beta.
None of these are authorized inside Phase 8 implementation work.

## 1. Next.js / React framework upgrade (framework support)

- **Status:** BLOCKING, not yet scheduled.
- **Current:** dashboard and web run Next.js `14.2.20`.
- **Problem:** as of this review (2026-08-25), Next.js lists 14.x as
  unsupported, and its 11 December 2025 security update instructs all
  13.x/14.x users to upgrade for additional React Server Components
  vulnerabilities.
- **Required before launch:** the product owner approves a supported
  Next.js/React upgrade plan and its full regression review (all dashboard and
  web tests, CSP/header behavior, MDX/legal pages, i18n routing, the pricing
  single-source rendering, and a fresh security pass). The roadmap's
  fixed-stack rule means the upgrade is a separate approved step — this is a
  release gate, not a waiver.
- **Sources:** Next.js support policy (https://nextjs.org/support-policy);
  Next.js security update, 11 December 2025
  (https://nextjs.org/blog/security-update-2025-12-11).

## 2. Lighthouse ≥ 95 (performance/accessibility)

- **Status:** `NOT_RUN` — carried since Phase 6.
- **Required before launch:** run an actual Lighthouse audit against the built
  public site and record real scores; the ≥ 95 target is not claimed until then.

## 3. Batch-result CSV formula hardening (carried from Step 7.1)

- **Status:** open.
- The self-service data export neutralizes spreadsheet formulas; the older
  Step 4.1 batch **result** CSV (which reproduces customer input) does not.
  Harden it in the pre-launch security pass.

## 4. Metrics monitoring credential and bind

- **Status:** implemented in Step 8.1; operational reminder.
- Deployments must set a strong `METRICS_TOKEN` (API `/metrics` fails closed
  without it) and keep the worker scrape server on loopback unless a monitoring
  network is deliberately configured via `METRICS_HOST`.

## 5. Backend dependency-security remediation (high-severity advisories)

- **Status:** BLOCKING, not yet scheduled.
- **Problem:** an independent `pnpm audit --prod --audit-level=high` on the
  current lockfile (recorded during the Step 8.3 framework upgrade, 2026-08-26)
  found four pre-existing high-severity production-dependency advisories in the
  Fastify/Drizzle backend chain. They were **not** introduced by the
  Next.js/React upgrade:
  - `fastify@4.29.1` — Content-Type `tab` body-validation bypass;
    advisory `GHSA-jx2c-rxcm-jvmq`; patched only in Fastify `>=5.7.2`.
  - `drizzle-orm@0.38.4` — improperly escaped SQL identifier injection;
    advisory `GHSA-gpj5-g38j-94v9`; patched in `>=0.45.2`.
  - `find-my-way@8.2.2` (via Fastify) — HTTP/2 denial of service;
    advisory `GHSA-c96f-x56v-gq3h`; patched in `>=9.7.0`.
  - `@fastify/static@6.12.0` (via Swagger UI) — route-guard bypass /
    path traversal; advisory `GHSA-83w8-p2f5-377r`; patched in `>=10.1.1`.
- **Required before launch:** the product owner approves a separate backend
  dependency-security remediation plan covering a compatible **Fastify 5**
  migration, a **Drizzle** upgrade, and compatible **Swagger UI / @fastify/static
  / find-my-way (router)** updates. That work package needs its own security
  review, the full integration regression suite, remote CI, and a draft PR — it
  is a separate approved step, not part of the framework upgrade. No versions
  are chosen and no dependency is edited here; this is a release gate, not a fix.
- **Sources:** GitHub Security Advisories `GHSA-jx2c-rxcm-jvmq`,
  `GHSA-gpj5-g38j-94v9`, `GHSA-c96f-x56v-gq3h`, `GHSA-83w8-p2f5-377r`.
