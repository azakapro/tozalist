# TozaList architecture

TozaList is a consent-first email-list hygiene SaaS. This document describes the
foundation as it exists at step 0.1: the component map, how the pieces talk to
each other locally, and the one trust boundary that must not be crossed.

## Components

| Component             | Path              | Runtime                 | Role                                                            |
| --------------------- | ----------------- | ----------------------- | --------------------------------------------------------------- |
| `@tozalist/web`       | `apps/web`        | Next.js 14 (App Router) | Public marketing surface. Placeholder page only.                |
| `@tozalist/dashboard` | `apps/dashboard`  | Next.js 14 (App Router) | Authenticated customer surface. Placeholder page only.          |
| `@tozalist/api`       | `apps/api`        | Fastify 4 (Node 20+)    | HTTP entrypoint for the product. Today: `GET /health`.          |
| `@tozalist/worker`    | `apps/worker`     | Node 20+ / BullMQ       | Background process. Today: connects to Redis and idles.         |
| `engine`              | `services/engine` | Go (own module)         | Internal validation engine. Today: placeholder process.         |
| `@tozalist/core`      | `packages/core`   | TypeScript library      | Pure domain logic, no I/O. Today: `Result` primitive.           |
| `@tozalist/shared`    | `packages/shared` | TypeScript library      | Types and constants shared across surfaces.                     |
| `@tozalist/db`        | `packages/db`     | Drizzle + PostgreSQL    | Schema, migrations, client. See [data-model.md](data-model.md). |

### Infrastructure (Docker Compose)

| Service    | Image                        | Host port              | Purpose                          |
| ---------- | ---------------------------- | ---------------------- | -------------------------------- |
| `postgres` | `postgres:16-alpine`         | `5432`                 | System of record (named volume). |
| `redis`    | `redis:7-alpine`             | `6379`                 | Queue backend for BullMQ.        |
| `minio`    | `minio/minio`                | `9000`, console `9001` | S3-compatible object storage.    |
| `engine`   | built from `services/engine` | **none**               | Internal validation engine.      |

## Local development topology

```
                 host machine
  ┌──────────────────────────────────────────────┐
  │  pnpm dev                                    │
  │    web        :3000 ─┐                       │
  │    dashboard  :3002 ─┼──► api :3001 ─────────┼──┐
  │    worker           ─┘                       │  │
  └──────────────────────────────────────────────┘  │
                                                    │  ENGINE_URL
        docker compose (network: tozalist_default)  │  (never from a browser)
  ┌─────────────────────────────────────────────────┼──┐
  │  postgres :5432   redis :6379   minio :9000/:9001  │
  │                                                    │
  │  engine  (expose 8080, no host port) ◄─────────────┘
  └────────────────────────────────────────────────────┘
```

- Node processes run on the host via `pnpm dev`; stateful services run in Docker.
- The Node processes reach Postgres, Redis and MinIO over published host ports,
  using the values in `.env`.
- `ENGINE_URL` defaults to `http://engine:8080`, which resolves only inside the
  compose network. Calling the engine from a host process is therefore not
  possible by default, and that is deliberate — see below.

## Trust boundary

There is exactly one hard boundary in this system:

> **The Go engine is internal-only and must never be public.**

Concretely:

1. The `engine` service in `docker-compose.yml` declares `expose: ['8080']` and
   **no** `ports:` mapping. It is unreachable from the host and from the
   internet. Adding a `ports:` entry for `engine` is a security regression.
2. Only server-side components (`api`, `worker`) may call the engine. Browser
   code in `web` and `dashboard` must never receive an engine URL, and
   `ENGINE_URL` must never be exposed through a `NEXT_PUBLIC_*` variable.
3. In deployed environments the engine sits on a private network behind the API.
   Any public traffic that needs it is proxied and authorised by the API first.
4. `@tozalist/shared` encodes this in `INTERNAL_ONLY_SERVICES`, so the rule is
   assertable in code and in tests, not just in prose.

The engine handles list data that is only ever processed with the list owner's
consent. Keeping it off the public network means an engine bug can never be
reached directly by an untrusted caller.

## Data and secrets

- Configuration comes from environment variables only. `.env` is git-ignored;
  `.env.example` holds local placeholders and never real credentials.
- Connection strings (`DATABASE_URL`, `REDIS_URL`) carry passwords, so the code
  that validates them reports failures without echoing the value.

## Data

The schema, its retention rules and the append-only credit ledger are described
in [data-model.md](data-model.md).

## Not implemented at step 0.2

The database schema exists, but nothing writes to it yet. No validation, SMTP
probing, authentication, billing, queues or jobs, upload handling, webhook
delivery, or analytics. Those arrive in later steps.
