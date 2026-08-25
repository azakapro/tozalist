# PM Decision

## Node runtime-contract correction review

- Step ID: `8.1` — Observability and security pass, CI runtime correction.
- Scope reviewed: `.nvmrc` now selects `22.22.0`; root `engines.node` states `>=22.19.0`; the only affected version statements in `README.md` and `docs/architecture.md` match that floor. The workflow, dependencies, scripts, lockfile, product code, tests, and other documentation are unchanged.
- Evidence reviewed: CI still reads `node-version-file: .nvmrc`; the lockfile records `undici@8.10.0` as requiring Node `>=22.19.0`; an isolated clean copy using Node 22.22.0 completed `pnpm install --frozen-lockfile` under `engine-strict=true`, with a byte-identical lockfile; `git diff --check` passes.
- Remote status: [run `32857086592`](https://github.com/azakapro/tozalist/actions/runs/32857086592) confirmed the MinIO correction and then failed before project gates because Node 20.20.2 could not install `undici@8.10.0`. This correction has not yet run remotely.

## Decision

- Decision: `APPROVED`
- Rationale: `The correction resolves the precise engine mismatch at its source, truthfully updates the public runtime contract, and proves a frozen installation on the CI-selected Node release. GitHub Actions must now provide the authoritative full-gate result.`

## Explicit Git sync authorization — Step 8.1 Node runtime correction only

Remain on `feat/phase-8-hardening`. Perform only this sync handoff; do not modify product code or begin Step 8.2.

1. Before staging, confirm the working-tree change set is exactly these seven paths:

   - `.nvmrc`
   - `package.json`
   - `README.md`
   - `docs/architecture.md`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`

2. Create one atomic commit containing exactly those reviewed paths with this exact message:

   ```text
   ci: align Node runtime contract
   ```

3. Push only `feat/phase-8-hardening` to `origin`. Do not push or alter `main`.
4. Do not create or update a pull request. The single Phase 8 draft PR remains deferred until Step 8.2 is complete.
5. After the push, write the commit hash and remote branch into `CTO-REPORT.md`, set `STATE.md` to `awaiting_pm_review` with PM as owner and remote-CI verification as the only next action, then stop. Those post-push relay-record edits remain uncommitted for the next reviewed handoff.

The PM will inspect the resulting GitHub Actions run. Step 8.2 remains locked until that run is green.

## Boundaries and carry-forward gates

- Do not commit or push anything beyond the seven authorized paths; do not create a PR, merge, deploy, enable production SMTP, process real customer data, add a payment provider, delete material data, or change legal/privacy policy.
- The supported Next.js/React upgrade in `docs/PRE-PRODUCTION-GATES.md` remains a Phase 9 pre-production blocker. Lighthouse remains a Phase 9 deployment gate.

## State transition

- State status: `ready_for_cto`
- Current step: `8.1`
- Owner: `Claude Code`
- Next action: `Perform only the authorized seven-file CI-correction commit and feature-branch push, then stop for PM remote-CI verification.`
