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

- **Status:** REMEDIATED (Step 8.4, 2026-08-26) — pending PM review and a later
  authorized push/merge. Remote CI on this work is `NOT_RUN`.
- **What was vulnerable:** four high-severity production advisories in the
  Fastify/Drizzle chain, recorded during Step 8.3.
- **Resolved patched versions now in the production tree:**

  | Package                            | Before | After      | Advisory cleared                         |
  | ---------------------------------- | ------ | ---------- | ---------------------------------------- |
  | `fastify`                          | 4.29.1 | **5.12.1** | `GHSA-jx2c-rxcm-jvmq` (patched >=5.7.2)  |
  | `drizzle-orm`                      | 0.38.4 | **0.45.2** | `GHSA-gpj5-g38j-94v9` (patched >=0.45.2) |
  | `find-my-way` (via Fastify)        | 8.2.2  | **9.9.0**  | `GHSA-c96f-x56v-gq3h` (patched >=9.7.0)  |
  | `@fastify/static` (via Swagger UI) | 6.12.0 | **10.1.3** | `GHSA-83w8-p2f5-377r` (patched >=10.1.1) |

  Supporting plugins upgraded to Fastify-5-compatible exact pins:
  `@fastify/cookie` 11.1.2, `@fastify/helmet` 13.1.1, `@fastify/multipart`
  10.1.1, `@fastify/swagger` 9.8.1, `@fastify/swagger-ui` 6.1.1,
  `fastify-plugin` 6.0.0. No pnpm override, resolution, or forced transitive
  pin was used; every version resolves through normal plugin compatibility.

- **Production-audit result:** `pnpm security:audit`
  (`pnpm audit --prod --audit-level=high`) exits 0 with **"No known
  vulnerabilities found"**. All four advisory IDs above are absent from the
  resolved production tree, and the lockfile contains no reference to the
  vulnerable versions. The audit is wired as a **blocking** CI step; no
  ignore list, suppression, allowlist, or severity downgrade is used.
- **Test totals:** 624 workspace tests (core 186, shared 69, db 71, api 179,
  worker 59, dashboard 32, web 28) + 5 tooling-script tests, all passing,
  including 10 new Fastify-5/Drizzle security regressions. The accuracy
  corpus remains 500/500. No schema or migration changed.

**Still open — this gate does not clear the others.** Lighthouse (#2),
batch-result CSV formula hardening (#3), the metrics deployment configuration
(#4), and the Uzbekistan-qualified legal review remain blocking before any
Phase 9 deployment or public beta.
