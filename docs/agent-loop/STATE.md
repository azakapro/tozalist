# PM–CTO Relay State

- Status: `ready_for_cto`
- Current step: `8.1`
- Current step title: Observability and security pass (CI Node runtime-contract sync handoff)
- Owner: Claude Code
- Completed through: the CI MinIO-service correction is synchronized as commit `18ab3c3` on `origin/feat/phase-8-hardening`; `origin/main` remains `edf29a8`; no Phase 8 PR exists. The approved runtime correction remains local and uncommitted: `.nvmrc` selects `22.22.0`, root `engines.node` is `>=22.19.0`, and existing Node-version documentation matches the locked `undici@8.10.0` engine floor.
- Last verified: PM, 2026-08-25 — exact runtime-contract diff inspected; CI continues to read `.nvmrc`; a clean frozen install succeeded on Node 22.22.0 with no lockfile drift; `git diff --check` passes. GitHub Actions remains `NOT_RUN` for this correction until the authorized push.
- Next action: Claude Code performs only the PM-authorized seven-file commit (`ci: align Node runtime contract`) and pushes `feat/phase-8-hardening` to `origin`, with no PR. Then it reports the resulting commit and stops for PM remote-CI verification. Step 8.2 is locked pending a green GitHub Actions run.

Do not begin Step 8.2 or any later roadmap step until the PM records remote-CI approval.
