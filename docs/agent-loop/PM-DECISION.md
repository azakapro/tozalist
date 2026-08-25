# PM Decision

## CI MinIO-service correction review

- Step ID: `8.1` — Observability and security pass, CI service correction.
- Scope reviewed: `.github/workflows/ci.yml` replaces only the unavailable `bitnami/minio:2024` image with the existing pinned project image and adds the required `command: server /data`. The service's root credentials, port mapping, curl health command, retries, and all other CI configuration are unchanged.
- Evidence reviewed: the workflow diff is exactly two functional lines; `docker-compose.yml` already pins `minio/minio:RELEASE.2025-09-07T16-13-09Z`; YAML and diff checks pass; the pinned image with `server /data` returned HTTP 200 from `/minio/health/live`; the CI health command succeeds inside that container.
- Remote status: run [`32850667497`](https://github.com/azakapro/tozalist/actions/runs/32850667497) failed before checkout because its retired Bitnami image could not be pulled. This correction has not yet run in GitHub Actions.

## Decision

- Decision: `APPROVED`
- Rationale: `The correction is minimal, preserves the CI test surface, and has locally verified the exact official image, command, and health check that failed remotely. A new GitHub Actions run remains the authoritative acceptance check.`

## Explicit Git sync authorization — Step 8.1 CI correction only

Remain on `feat/phase-8-hardening`. Perform only this sync handoff; do not modify product code or start Step 8.2.

1. Before staging, confirm the working-tree change set is exactly these four paths:

   - `.github/workflows/ci.yml`
   - `docs/agent-loop/CTO-REPORT.md`
   - `docs/agent-loop/PM-DECISION.md`
   - `docs/agent-loop/STATE.md`

2. Create one atomic commit containing exactly those reviewed paths with this exact message:

   ```text
   ci: fix MinIO service image
   ```

3. Push only `feat/phase-8-hardening` to `origin`. Do not push or alter `main`.
4. Do not create or update a pull request. The single Phase 8 draft PR remains deferred until Step 8.2 is complete.
5. After the push, write the commit hash and remote branch into `CTO-REPORT.md`, set `STATE.md` to `awaiting_pm_review` with PM as owner and remote-CI verification as the only next action, then stop. Those post-push relay-record edits remain uncommitted for the next reviewed handoff.

The PM will inspect the resulting GitHub Actions run. Step 8.2 remains locked until that run is green.

## Boundaries and carry-forward gates

- Do not commit or push anything beyond the four authorized paths; do not create a PR, merge, deploy, enable production SMTP, process real customer data, add a payment provider, delete material data, or change legal/privacy policy.
- The supported Next.js/React upgrade in `docs/PRE-PRODUCTION-GATES.md` remains a Phase 9 pre-production blocker. Lighthouse remains a Phase 9 deployment gate.

## State transition

- State status: `ready_for_cto`
- Current step: `8.1`
- Owner: `Claude Code`
- Next action: `Perform only the authorized four-file CI-correction commit and feature-branch push, then stop for PM remote-CI verification.`
