# CTO Report — Step 6.2 correction (documentation release integrity)

## Step and outcome

Step `6.2`, correction cycle per `PM-DECISION.md`. All four items are done: the format gate now passes immediately after a clean build that freshly exports the OpenAPI document, the four MDX dependency licenses are recorded in `THIRD_PARTY_LICENSES/`, the draft privacy data map no longer presents lead auto-deletion as an existing operation, and the shared Terms MDX links each locale to its own prohibited-use page. Still on `feat/phase-6-public-site`, local-only, uncommitted. No Phase 7 work, no Step 6.1 behavior change, no GitHub writes.

## Correction implemented

1. **Format gate reliable after a clean build** — `apps/web/generated` added to the root `.prettierignore` (the repository's normal ignore mechanism, alongside `dist`, `.next`, and the other generated paths). The build-time OpenAPI export is unchanged and the copy gate untouched. Proven in the PM's exact order: `pnpm -r build` ran first (prebuild freshly exported `apps/web/generated/openapi.json`; 39/39 static pages), the generated file's presence was confirmed, and `pnpm format:check` then passed.
2. **Dependency licenses recorded** — four new records copied verbatim from each installed package's own license file, following the per-dependency-file convention:
   - `THIRD_PARTY_LICENSES/next-mdx-MIT.txt` — `@next/mdx` **14.2.35**, license field `MIT` (copyright Vercel, Inc.)
   - `THIRD_PARTY_LICENSES/mdx-js-loader-MIT.txt` — `@mdx-js/loader` **3.1.1**, license field `MIT` (copyright Compositor and Vercel, Inc.)
   - `THIRD_PARTY_LICENSES/mdx-js-react-MIT.txt` — `@mdx-js/react` **3.1.1**, license field `MIT` (copyright Compositor and Vercel, Inc.)
   - `THIRD_PARTY_LICENSES/types-mdx-MIT.txt` — `@types/mdx` **2.0.14** (dev-only), license field `MIT` (copyright Microsoft Corporation)
   Versions and license fields were read from each package's installed `package.json`.
3. **Precise draft privacy wording** — the leads row's "How long" now reads "Marked to expire after 180 days\*", and a footnote under the table states plainly that each request stores a 180-day expiry date, that the scheduled job deleting expired requests automatically is planned but not live yet, and that until then expired and requested records are deleted manually. No retention policy, legal status, or roadmap change; the DRAFT banner remains on all three legal pages (asserted by the existing draft-banner tests, still passing).
4. **Locale-neutral legal navigation** — the Terms link is now relative (`./prohibited-use`). Rendered output verified: `/ru/terms` HTML carries `href="./prohibited-use"`, which resolves to `/ru/prohibited-use` (and likewise per locale). A sweep for other hard-coded `/uz/`, `/ru/`, `/en/` links across `content/`, `lib/`, and `app/` found none.

## Files changed (correction only)

`.prettierignore` (+`apps/web/generated`) · `THIRD_PARTY_LICENSES/{next-mdx-MIT.txt, mdx-js-loader-MIT.txt, mdx-js-react-MIT.txt, types-mdx-MIT.txt}` (new) · `apps/web/content/privacy.mdx` (leads row + footnote) · `apps/web/content/terms.mdx` (relative link).

## Verification results (PM's required order)

1. `pnpm db:test:prepare` ✓ (`tozalist_test` ready)
2. Copy lint ✓ clean (messages + all 6 MDX files, including the reworded privacy text)
3. Web tests ✓ **24** · API tests ✓ **146**
4. `pnpm -r build` ✓ — prebuild ran the copy gate and freshly exported `openapi.json`; 39/39 static pages; corrected privacy wording and relative Terms link confirmed in the rendered HTML
5. `pnpm -r test` ✓ **511** (core 173, shared 43, db 52, api 146, worker 50, dashboard 23, web 24)
6. `pnpm lint` ✓
7. `pnpm -r typecheck` ✓ (exit 0)
8. `pnpm format:check` ✓ — run **after** the build with `apps/web/generated/openapi.json` present on disk
9. `git diff --check` ✓ clean

**Lighthouse remains `NOT_RUN`** — no audit was executed; the ≥95 target is not claimed and stays a Phase 9 pre-launch gate.

## Risks or decisions requiring PM review

- The privacy footnote commits us to manual deletion of expired leads until the Phase 7 purge job ships — an operational promise the owner should be comfortable making while the DRAFT banner is up.
- Unchanged from the main report: legal copy is engineering-drafted pending real legal review; docs prose is English-only under localized chrome; glossary recommended actions are engineering-written product guidance.

## Git status

`feat/phase-6-public-site`, all Step 6.2 work (implementation + this correction) local and uncommitted on top of `5370fea`. No PR exists. Per PROTOCOL, the single Phase 6 draft PR follows only after corrected-6.2 approval and an explicit sync authorization naming files, message, branch, and PR title.
