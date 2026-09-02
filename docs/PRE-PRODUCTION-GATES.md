# Pre-production release gates

Blocking requirements that must be satisfied — with explicit product-owner
approval and its own plan — before Phase 9 deployment or any public beta.
None of these are authorized inside Phase 8 implementation work.

## 1. Next.js / React framework upgrade (framework support)

- **Status:** REMEDIATED — Step 8.3 merged in PR #7 on 2026-08-26.
- **Current:** dashboard and web use exact-pinned Next.js `16.3.3`, React
  `19.2.8`, and React DOM `19.2.8`.
- **Evidence:** the async App Router migration, 38-page static build,
  CSP/security headers, dashboard authentication suites, MDX/legal pages, i18n
  routing, pricing single-source rendering, and framework-specific regressions
  passed locally and in both remote CI runs before merge.
- **Sources:** Next.js support policy (https://nextjs.org/support-policy);
  Next.js security update, 11 December 2025
  (https://nextjs.org/blog/security-update-2025-12-11).

## 2. Lighthouse ≥ 95 (performance/accessibility)

- **Status:** PASSED — audited 2026-09-02 against the production build of
  `apps/web` at merged `main` `9d01342` (`next build` + `next start`,
  Lighthouse 12, headless Chrome, `--only-categories` performance,
  accessibility, best-practices, seo).
- **Scores** (identical across `/uz`, `/ru`, `/en`):

  | Form factor | Performance | Accessibility | Best practices | SEO |
  | ----------- | ----------- | ------------- | -------------- | --- |
  | Desktop     | 100         | 100           | 96             | 100 |
  | Mobile      | 99          | 100           | 96             | 100 |

- The only best-practices deduction was a console 404 for `/favicon.ico`
  (no site icon was shipped). An `app/icon.svg` now provides one.
- Re-run after any change to the public site's layout, fonts, or scripts:

  ```bash
  pnpm --filter web build && pnpm --filter web start &
  npx -y lighthouse@12 http://localhost:3000/uz --preset=desktop \
    --chrome-flags='--headless=new' --output=json --output-path=./lh.json
  ```

## 3. Batch-result CSV formula hardening (carried from Step 7.1)

- **Status:** REMEDIATED locally in Step 8.5 — pending PM review and later
  authorized remote CI/merge.
- Every string cell written to a batch result CSV, including customer headers
  and original columns, is neutralized before CSV quoting when it begins with
  `=`, `+`, `-`, `@`, tab, or carriage return. The stored input object is not
  modified.
- A real worker integration test parses the produced result CSV and verifies
  every trigger cell-by-cell, including quoted/comma-containing values and
  hostile headers. Ordinary cells round-trip unchanged, the input remains
  byte-identical, and the existing 1k-versus-50k streaming memory test passes.

## 4. Metrics monitoring credential and bind

- **Status:** implemented in Step 8.1; operational reminder.
- Deployments must set a strong `METRICS_TOKEN` (API `/metrics` fails closed
  without it) and keep the worker scrape server on loopback unless a monitoring
  network is deliberately configured via `METRICS_HOST`.

## 5. Backend dependency-security remediation (high-severity advisories)

- **Status:** REMEDIATED and merged — Step 8.4, PR #8, 2026-08-26. Both the
  push and pull-request remote CI gates passed before merge.
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

**Still open — these remediations do not clear the others.** Lighthouse (#2),
the metrics deployment configuration (#4), and the Uzbekistan-qualified legal
review remain blocking before a fully certified real-customer launch.
