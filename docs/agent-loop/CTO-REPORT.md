# CTO Report — Step 8.1 correction (CI MinIO service image)

## Step and outcome

Step `8.1`, focused CI-only correction per `PM-DECISION.md`. The GitHub Actions `minio` service now uses the already project-verified pinned official image with the required `server /data` command, replacing the retired `bitnami/minio:2024` tag that made remote CI run `32850667497` fail during service-container initialization (before checkout or any project gate). Only `.github/workflows/ci.yml` and the relay records changed. Still on `feat/phase-8-hardening`, local-only — **no commit, push, PR, or any other Git write** (none authorized this cycle).

## Change made (`.github/workflows/ci.yml`)

In the `jobs.gates.services.minio` block, exactly:

```diff
       minio:
-        image: bitnami/minio:2024
+        image: minio/minio:RELEASE.2025-09-07T16-13-09Z
+        command: server /data
         env:
```

The explicit `command: server /data` is required because the official `minio/minio` image does not default to server mode. The image is the same pinned release already used and verified in `docker-compose.yml` (whose curl-based health check depends on this release actually shipping curl). Everything else in the service is unchanged: `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` env names and values, `ports: ['9000:9000']`, and the `--health-cmd "curl -f http://localhost:9000/minio/health/live"` options with the same interval/timeout/retries. No other service (postgres, redis), env var, CI gate, trigger, timeout, test database name/credentials, or step was touched, and no MinIO-dependent test was skipped or worked around.

## Verification (local, to the extent available)

- **YAML syntax**: `.github/workflows/ci.yml` parses cleanly; the parsed `minio` service is exactly `{ image: minio/minio:RELEASE.2025-09-07T16-13-09Z, command: "server /data", env: {MINIO_ROOT_USER, MINIO_ROOT_PASSWORD}, ports: ['9000:9000'], options: <unchanged health check> }`.
- **Pinned image + command reaches the health endpoint**: ran `docker run … minio/minio:RELEASE.2025-09-07T16-13-09Z server /data` with the same root-user/root-password env. `GET /minio/health/live` returned **HTTP 200** within ~2 s, and the CI health command's exact form — `curl -f http://localhost:9000/minio/health/live` executed **inside** the container — succeeded, confirming the image ships the `curl` the health check relies on. Container stopped afterward; only a transient local container was used.
- **`git diff --check`**: clean.

Scope of local verification, stated honestly: this proves the pinned image with `server /data` starts and becomes healthy, and that the health command works. It does **not** and cannot execute the GitHub Actions runner locally, so it is not a claim that GitHub CI passed. Per the PM's own framing, the authoritative confirmation is a green GitHub Actions run after a later, explicitly authorized correction push — which is not authorized in this cycle.

## Files changed

`.github/workflows/ci.yml` (MinIO service image + command only) · `docs/agent-loop/CTO-REPORT.md` · `docs/agent-loop/STATE.md`. `docs/agent-loop/PM-DECISION.md` is the PM's correction decision and was left untouched. No product code, tests, dependencies, licenses, docker-compose, benchmarks, logging, metrics, or security-header changes.

## Carry-forward pre-production gates (unchanged, still blocking)

- The supported Next.js/React upgrade in `docs/PRE-PRODUCTION-GATES.md` remains blocking before Phase 9 deployment or public beta; no framework upgrade was performed here.
- Lighthouse remains a Phase 9 deployment gate. GitHub Actions must be re-triggered by a later, explicitly authorized correction push and pass before Step 8.2.

## Git status

`feat/phase-8-hardening`, this CI correction local and uncommitted on top of the synced commit `6b4d2c3`. No PR exists. Awaiting PM review; a Git sync (to re-trigger remote CI) happens only on an explicit later authorization.
