# CTO Report — Step 9.1 correction

- Step: `9.1` — Synthetic-data preview deployment package
- Branch: `feat/synthetic-preview-deployment`
- Base and current HEAD: `948b6b1579237da4a1bf9fce247b89557440155b`
- Date: 2026-08-27
- Result: `VERIFIED_AWAITING_PM_REVIEW`
- Git/external state: nothing staged, committed, pushed, deployed, or made public

## Outcome

The Step 9.1 correction is implemented. All repository checks pass, all six production images build, image metadata is correct, the production Compose contract passes, the pinned Caddy parser accepts the Caddyfile, and deterministic backup-retention/restore/smoke tests pass.

After the host restart, `pnpm deploy:verify:runtime` completed all eight stages with exit 0. It built and inspected all six images, observed 12 isolated services, ran the complete synthetic public smoke flow, proved only Caddy published 80/443 and Caddy had no route to the engine, verified two backup objects, restored seeded data into a disposable `_restore_drill` database, and removed every isolated container, network, and volume.

Step 9.1 is ready for PM review. This report is not Git-handoff permission.

## Corrected implementation

### Images and build context

- Added a root `.dockerignore` excluding `.git`, environment/credential files, relay working records, host dependency/build output, coverage, tests, and local artifacts while retaining required source and manifests.
- Added reproducible pnpm-workspace multi-stage Dockerfiles for API, worker, dashboard, and web.
- Each build copies workspace manifests before install, builds dependency workspaces before consumers, and does not depend on host `dist` or `.next` output.
- API final image contains the compiled API and database migrations needed at runtime.
- Dashboard/web use the actual monorepo Next standalone layout and copy static output into the corresponding `apps/dashboard` and `apps/web` paths.
- Worker health is a real loopback probe of its metrics server on port 9464.
- The existing engine image and a purpose-built PostgreSQL backup image are included in the production build.

### Production topology

- `docker-compose.prod.yml` contains Caddy, API, worker, dashboard, web, engine, migrate, PostgreSQL, Redis, and PostgreSQL backup services.
- Only Caddy publishes host ports 80/443; all application, metrics, engine, database, Redis, and backup ports stay private.
- Caddy is attached only to `edge`; engine, PostgreSQL, Redis, backup, API, and worker use the private `backend` network as required.
- Redis requires authentication, uses credentialed internal URLs, enables AOF, and authenticates its health check.
- Required deployment values use fail-closed Compose expansion.
- Product object storage and dedicated backup object storage have separate required variables.
- SMTP remains hard-disabled.
- Caddy uses automatic TLS/compression/default proxy forwarding and explicitly rejects the public API `/metrics` path.

### Backup, restore, and synthetic verification

- The non-root backup image contains PostgreSQL client, Bash, gzip, and AWS CLI.
- Backups fail closed, require encrypted transport except for the explicit isolated local-MinIO verifier, upload through signed AWS CLI requests, retain 7 daily and 4 weekly remote objects, and update health only after success.
- Restore refuses empty, production, or non-`_restore_drill` targets and requires an exact disposable-target confirmation before drop/create/restore/query proof.
- The smoke command exercises actual API routes, multipart batch upload/polling, three public locales, dashboard reachability, auth rejection, an authenticated synthetic `.invalid` address, and public engine isolation. The key is accepted only through `SMOKE_API_KEY` and neither keys nor response bodies are printed.
- An isolated Compose overlay provides synthetic-only local MinIO, dedicated stack names/networks/volumes, and local Caddy routing without changing production behavior.
- `pnpm deploy:verify:runtime` builds, inspects, starts, smokes, verifies ports/networks, proves backup upload, performs only a disposable restore, and tears down only its uniquely named synthetic stack.

## Required verification

| # | Verification | Result | Evidence |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | `PASS` | Exit 0; lockfile already current; 648 packages restored from the existing frozen graph. |
| 2 | `pnpm security:audit` | `PASS` | Exit 0; `No known vulnerabilities found`. |
| 3 | `pnpm secret-scan` | `PASS` | Exit 0; 396 files clean. |
| 4 | `pnpm web:lint-copy` | `PASS` | Exit 0; copy lint clean. |
| 5 | `pnpm db:test:prepare` | `PASS` | Exit 0 with the repository local environment loaded; dedicated `tozalist_test` ready. |
| 6 | `pnpm -r build` | `PASS` | Exit 0; seven projects built; dashboard 12/12 and web 38/38 static pages generated. |
| 7 | `pnpm -r typecheck` | `PASS` | Exit 0 for all seven projects. |
| 8 | `pnpm -r test` | `PASS` | Exit 0; 625/625 workspace tests. |
| 9 | `pnpm test:scripts` | `PASS` | Exit 0; 5/5 tooling tests. |
| 10 | `pnpm core:bench` | `PASS` | Exit 0; 500/500 fixtures exact, 100% precision/recall for every reason code. |
| 11 | `pnpm lint` | `PASS` | Exit 0. |
| 12 | `pnpm format:check` | `PASS` | Exit 0. |
| 13 | `git diff --check` | `PASS` | Exit 0. |
| 14 | Production Compose rendering | `PASS` | `pnpm deploy:verify`: 14/14 checks, including fail-closed unchanged environment and actual pinned-image Caddy validation through BuildKit. |
| 15 | Build and inspect every image | `PASS` | All six images built. Metadata and in-container filesystem inspection proved final user, healthcheck, exposed port, entrypoint, no TypeScript package, and no source/test/declaration artifacts. |
| 16 | Start stack, smoke, network, backup, restore, teardown | `PASS` | `pnpm deploy:verify:runtime` exit 0; 12 services observed, complete smoke passed, isolation passed, two backup objects verified, seeded-data restore passed, scoped teardown passed. |

### Passing test totals

- Core: 186
- Shared: 69
- Database: 71
- API: 179
- Worker: 60
- Dashboard: 32
- Web: 28
- Workspace total: **625**
- Tooling-script tests: **5**
- Accuracy corpus: **500/500**
- Deployment contract checks: **14/14**

## Image evidence

All of these images built successfully:

- `tozalist-api:step91`
- `tozalist-worker:step91`
- `tozalist-dashboard:step91`
- `tozalist-web:step91`
- `tozalist-engine:step91`
- `tozalist-postgres-backup:step91`

`docker image inspect` recorded:

| Image | User | Port | Entrypoint | Healthcheck |
|---|---|---:|---|---|
| API | `tozalist` | 3001 | `node apps/api/dist/server.js` | loopback `/health` |
| Worker | `tozalist` | 9464 | `node apps/worker/dist/main.js` | loopback `/metrics` |
| Dashboard | `tozalist` | 3002 | `node server.js` in standalone app directory | loopback HTTP |
| Web | `tozalist` | 3000 | `node server.js` in standalone app directory | loopback `/en` |
| Engine | `engine` | 8080 | `/usr/local/bin/engine` | loopback `/health` |
| Backup | `postgres` | no published host port | scheduled `/usr/local/bin/backup.sh` | successful-backup recency |

## Runtime evidence

- Docker client/server: 29.7.2; Docker Compose: v5.4.0.
- Migrations exited 0 and every long-running service reached healthy state.
- Synthetic smoke passed API health, invalid-key rejection, authenticated check, batch round-trip, `en`/`uz`/`ru` pages, dashboard reachability, and absence of a public engine listener.
- Runtime publishers showed only Caddy on host 80/443. Caddy could not resolve/reach the backend-only engine service.
- The backup sidecar became healthy, an explicit post-seed backup succeeded, and two daily objects were observed in isolated MinIO.
- The latest post-seed backup restored only into `synthetic_preview_restore_drill`; the restored organization query proved seeded data was recovered.
- Final evidence: `Runtime evidence: 12 services observed; 2 backup object(s); disposable restore query passed.`
- Teardown removed every `tozalist-step91-verify` container, network, and volume. Existing developer containers and unrelated containers/data were left untouched.

### Defects caught and corrected during runtime proof

1. API/worker images retained declarations and vendor tests. Production dependencies now come from a pruned throwaway stage, and final workspace output removes declarations, maps, tests, and the DB test-preparation artifact.
2. The first pruned images omitted pnpm workspace dependency links. The final layers now copy the exact application/core/db/shared production link trees; direct runtime imports and migrations pass.
3. Isolated MinIO initially received a different synthetic secret from the backup sidecar. The verifier still uses separately named product/backup variables, but one local-only MinIO account consistently backs both.
4. The first engine-isolation probe reached the separate developer engine on host 8080. The isolated probe now uses a verification-only host port, while runtime publisher inspection independently proves the production engine publishes nothing.
5. The startup health backup preceded synthetic seeding. Stage 7 now explicitly creates a post-seed backup before restore, proving data-bearing recovery rather than schema-only recovery.

## Drift and scope

- `pnpm-lock.yaml`: unchanged.
- Dependency versions: unchanged.
- Database schema and migrations: unchanged.
- Business logic: unchanged.
- No deployment, commit, push, PR, merge, SMTP enablement, customer-data processing, payment work, or legal/privacy-policy change.
- Existing PM relay decision was preserved.

## Files in Step 9.1

New:

- `.dockerignore`
- `apps/api/Dockerfile`
- `apps/worker/Dockerfile`
- `apps/dashboard/Dockerfile`
- `apps/web/Dockerfile`
- `docker-compose.prod.yml`
- `deploy/.env.production.example`
- `deploy/Caddyfile`
- `deploy/Caddyfile.verify`
- `deploy/README.md`
- `deploy/backup.sh`
- `deploy/restore.sh`
- `deploy/docker-compose.verify.yml`
- `deploy/postgres-backup/Dockerfile`
- `scripts/deployment-verification.mjs`
- `scripts/smoke-test.mjs`
- `scripts/verify-production-stack.mjs`

Modified:

- `apps/dashboard/next.config.mjs`
- `apps/web/next.config.mjs`
- `package.json`
- relay records under `docs/agent-loop/`

## Next action

PM reviews the actual diff, this report, and the Step 9.1 acceptance criteria. If approved, PM may authorize the exact Step 9.1 Git handoff; no commit, push, PR, deployment, or Step 9.2 work is authorized by this report alone.
