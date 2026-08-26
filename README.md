# TozaList

Consent-first email-list hygiene SaaS — the private monorepo for
[tozalist.uz](https://tozalist.uz).

TozaList cleans mailing lists that their owners have consent to process: it
takes a list, checks it, and hands back a healthier one, without ever scraping,
enriching, or looking up people who never opted in. This repository holds the
whole product: two web surfaces, an HTTP API, a background worker, an internal
Go validation engine, and the shared TypeScript packages behind them.

> **Status: step 1.1 — foundation, database schema, and the engine sidecar.**
> The Go engine now verifies emails (syntax, MX, disposable/role/free lists,
> SMTP probing off by default), but nothing calls it yet: no API integration,
> no authentication, no billing, no jobs, and no product endpoints.

## Folder tree

```
tozalist/
├── apps/
│   ├── api/          @tozalist/api        Fastify 4 HTTP API (GET /health)
│   ├── worker/       @tozalist/worker     BullMQ worker process (Redis only)
│   ├── dashboard/    @tozalist/dashboard  Next.js 14 customer dashboard
│   └── web/          @tozalist/web        Next.js 14 public site
├── packages/
│   ├── core/         @tozalist/core       Pure domain logic, no I/O
│   ├── db/           @tozalist/db         Drizzle schema, migrations, seed
│   └── shared/       @tozalist/shared     Shared types and constants
├── services/
│   └── engine/       Go module — internal-only email-validation sidecar
├── docs/
│   ├── architecture.md
│   └── data-model.md
├── docker-compose.yml    postgres 16, redis 7, minio, engine
└── .env.example
```

## Prerequisites

| Tool    | Version                                             |
| ------- | --------------------------------------------------- |
| Node.js | 22.19.0 or newer (see [`.nvmrc`](.nvmrc))           |
| pnpm    | 9 (`corepack enable`)                               |
| Docker  | with Compose v2 (`docker compose`)                  |
| Go      | 1.22+ — only if you build the engine outside Docker |

```bash
nvm use          # or: fnm use
corepack enable
```

## Environment setup

```bash
cp .env.example .env
docker compose up -d
```

`.env.example` contains local placeholders only. `.env` is git-ignored — never
commit real credentials, and never put one in `.env.example`.

| Variable                                                     | Purpose                                  |
| ------------------------------------------------------------ | ---------------------------------------- |
| `DATABASE_URL`                                               | PostgreSQL connection string             |
| `REDIS_URL`                                                  | Redis connection string (BullMQ backend) |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | MinIO / S3 object storage                |
| `API_PORT`                                                   | API listen port (default `3001`)         |
| `ENGINE_URL`                                                 | Internal engine address — never public   |
| `SMTP_ENABLED`, `SMTP_HELO_DOMAIN`, `SMTP_PROBE_FROM`        | SMTP probing, disabled at this step      |

`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` configure the Compose
Postgres container and must stay consistent with `DATABASE_URL`.

## Local commands

```bash
pnpm install
pnpm dev          # api :3001, worker, web :3000, dashboard :3002
```

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `pnpm dev`        | Runs api, worker, web and dashboard together        |
| `pnpm build`      | Builds every workspace package in dependency order  |
| `pnpm test`       | Vitest across api, worker, core, db and shared      |
| `pnpm lint`       | ESLint over the repository                          |
| `pnpm typecheck`  | `tsc --noEmit` in every TypeScript workspace        |
| `pnpm format`     | Prettier write (`pnpm format:check` to verify)      |
| `pnpm db:migrate` | Applies pending Drizzle migrations (none exist yet) |
| `pnpm db:seed`    | Seed script placeholder                             |

The Go engine is managed through Docker Compose only:

```bash
docker compose up -d engine && docker compose logs engine
```

The engine has no host port in the base Compose file — that is the production
trust boundary. To reach it from API/worker processes running on your machine
during local development, add the dev override (loopback-only mapping) and
point `ENGINE_URL` at it:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

```
# .env for host-run local development
ENGINE_URL=http://127.0.0.1:8080
```

Production configuration keeps the internal hostname: `ENGINE_URL=http://engine:8080`.
`docker-compose.dev.yml` is for local development only and must never be used
in a deployment.

Health check once the API is running:

```bash
curl -fsS http://localhost:3001/health
```

```json
{ "status": "ok" }
```

## Database

```bash
pnpm db:migrate   # apply migrations
pnpm db:seed      # demo data; prints a local-only API key once
```

The seed is safe to re-run: it reuses the demo organisation and user, and the
initial 10,000-credit grant is applied at most once. It prints a freshly minted
API key exactly once — that plaintext is never stored and cannot be recovered.

Integration tests need their own database:

```bash
pnpm db:test:prepare
pnpm --filter @tozalist/db test
```

See [docs/data-model.md](docs/data-model.md) for the schema, the retention rules,
and why the credit ledger is append-only.

## Webhooks

Batch lifecycle notifications with signed payloads: see
[docs/webhooks.md](docs/webhooks.md) for the delivery contract and signature
verification samples (Node.js and Python).

## Architecture

See [docs/architecture.md](docs/architecture.md) for the component map, the local
topology, and the trust boundary: **the Go engine is internal-only and must
never be exposed publicly.**
