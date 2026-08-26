# PM Decision

## Step 8.2 final review

- Step ID: `8.2` — Accuracy regression corpus.
- Acceptance: `PASS — exactly 500 deterministic synthetic fixtures; every fixture self-identifies the evaluated stub address; genuine non-ASCII Unicode, punycode IDN, and long-address coverage; reserved .invalid/.test non-existent-domain cases; no DNS or engine/network access; 100% pass/fail regression gate using the real local aggregation pipeline; CI wired; documentation clearly limits the result to logic correctness.`
- Evidence: `pnpm core:bench passes 500/500 with a diagonal verdict matrix and 100% precision/recall for every email reason code, and exits non-zero when a label is deliberately corrupted. Independent PM verification passed pnpm -r test: 612 workspace tests (core 186, shared 69, db 71, api 169, worker 59, dashboard 32, web 26); secret scan, copy lint, build, lint, typecheck, tooling tests, format-after-build, and diff check also passed. The standalone DB-preparation command requires DATABASE_URL_TEST, which is intentionally absent in this PM shell; the integration suite and CI define it.`
- Scope, privacy, accounting, and retention: `PASS — corpus data is synthetic and stub-only. No customer data, payment, ledger, retention, deployment, SMTP, or legal-policy behavior changed. tsx is a dev-only MIT dependency with a verbatim license record. Bench code is typechecked/tested but excluded from product dist.`

## Decision

- Decision: `APPROVED`
- Rationale: `Step 8.2 meets both roadmap acceptance criteria and the focused corrections. Phase 8 is now locally complete. The final branch sync and its one draft PR are authorized; GitHub Actions must pass before the product owner manually merges.`

## Explicit final Phase 8 Git handoff

Remain on `feat/phase-8-hardening`. Perform only this handoff; do not begin Phase 9.

1. Before staging, confirm the working-tree change set is exactly these sixteen paths:

   - `.github/workflows/ci.yml`
   - `THIRD_PARTY_LICENSES/tsx-MIT.txt`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`
   - `package.json`
   - `packages/core/bench/README.md`
   - `packages/core/bench/corpus.test.ts`
   - `packages/core/bench/corpus.ts`
   - `packages/core/bench/run.ts`
   - `packages/core/bench/score.ts`
   - `packages/core/package.json`
   - `packages/core/tsconfig.build.json`
   - `packages/core/tsconfig.json`
   - `packages/core/vitest.config.ts`
   - `pnpm-lock.yaml`

2. Create one atomic commit containing exactly those reviewed paths with this exact message:

   ```text
   hardening: add accuracy regression corpus
   ```

3. Push only `feat/phase-8-hardening` to `origin`. Do not push or alter `main`.
4. Create exactly one **draft** pull request into `main` after the push, with this exact title:

   ```text
   Phase 8: security hardening and accuracy regression gate
   ```

   Use this PR body:

   ```md
   ## Summary

   - Step 8.1: logging redaction, request tracing, metrics, security headers, CORS boundaries, secret scanning, environment validation, endpoint fuzzing, load-test evidence, and GitHub Actions gates.
   - Step 8.2: a deterministic 500-fixture synthetic email corpus, a fail-closed `pnpm core:bench` aggregation-regression gate, CI integration, and clear logic-correctness limitations.

   ## Verification

   - 612 workspace tests plus 5 tooling-script tests pass locally.
   - `pnpm core:bench`: 500/500 exact matches, diagonal verdict matrix, 100% reason-code precision/recall; an intentionally corrupted label exits non-zero.
   - Secret scan, copy lint, build, lint, typecheck, formatter, and whitespace checks pass locally.
   - GitHub Actions on this final commit remains the required remote gate before merge.

   ## Boundaries

   - Corpus data is synthetic and stub-only; it does not query DNS, invoke the engine, or process customer data.
   - Real-world deliverability accuracy is deferred to consented design-partner outcomes in Phase 9.2.
   - Phase 9 remains blocked on the documented Next.js/React upgrade gate and Lighthouse deployment gate.

   Manual merge by the product owner only.
   ```

5. Do not merge the PR. After the push and draft-PR creation, write the commit hash, remote branch, and PR URL into `CTO-REPORT.md`; set `STATE.md` to `awaiting_pm_review` with PM as owner and remote-CI/PR verification as the only next action; then stop. Those post-handoff relay-record edits remain uncommitted.

## Boundaries and carry-forward gates

- Do not commit or push anything beyond the sixteen authorized paths; do not merge, deploy, enable production SMTP, process real customer data, add a payment provider, delete material data, or change legal/privacy policy.
- The product owner manually merges only after PM verifies the final GitHub Actions run and the draft PR.
- The supported Next.js/React upgrade and Lighthouse remain blocking pre-production gates for Phase 9.

## State transition

- State status: `ready_for_cto`
- Current step: `8.2`
- Owner: `Claude Code`
- Next action: `Perform only the authorized final Phase 8 commit, feature-branch push, and draft-PR handoff, then stop for PM remote verification.`
