# TozaList

Consent-first email-list hygiene for businesses in Uzbekistan and the CIS.
Upload a list you already own, get back a verdict and a plain-language reason
for every address, and decide what to keep.

TozaList is a complete, runnable SaaS monorepo: a public marketing site, a
customer dashboard, a REST API with OpenAPI docs, a background worker, an
internal Go validation engine, and a production deployment kit. It was built
as an end-to-end product exercise and is published here as open source.

> **Status:** feature-complete MVP. Runs locally with one Compose command;
> ships production Dockerfiles, a hardened Compose stack, backups, and a smoke
> test. It has not been deployed to a public host and has no real customers.
> Legal pages carry a "draft" banner and payments are invoice-only by design.

## What it does — and deliberately does not do

| Does                                                                          | Does not                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Syntax, MX, disposable-domain, role-account, and provider-typo checks         | Guarantee delivery — every result is a **signal with a reason code** |
| Optional SMTP mailbox probing with per-host throttling (off by default)       | Sell, enrich, or look up contact data                                |
| Offline phone-number format validation (`libphonenumber-js`, UZ default)      | Carrier lookup, live number status, or number-to-owner               |
| Streaming CSV batches up to 100k rows with dedup, caching, and credit refunds | Scrape any platform                                                  |
| Signed webhooks, retention (7/30/90 days), export, and deletion               | Tell a customer to delete an `unknown` result                        |
| Uzbek, Russian, and English UI                                                | Copy any competitor's name, copy, or endpoints                       |

`unknown` is a first-class verdict. Catch-all domains, timeouts, and lookup
failures are reported honestly as "we could not tell", never as `invalid`.

## Architecture

```
                 ┌────────────────────┐   ┌────────────────────┐
  browser  ───►  │ apps/web (Next.js) │   │ apps/dashboard     │
                 │ marketing, docs,   │   │ session auth, MFA, │
                 │ legal, pilot form  │   │ keys, checks, CSV  │
                 └─────────┬──────────┘   └─────────┬──────────┘
                           │  /v1 (API key)         │  /internal (cookie + CSRF)
                           ▼                        ▼
                 ┌──────────────────────────────────────────────┐
                 │ apps/api (Fastify 5)                          │
                 │ auth · rate limit · credits ledger · cache    │
                 │ batches · webhooks · OpenAPI · /metrics       │
                 └────┬──────────────┬──────────────┬────────────┘
                      │              │              │
                PostgreSQL 16     Redis 7       S3 / MinIO
                (Drizzle ORM)    (BullMQ)      (CSV objects)
                      ▲              │
                      │              ▼
                 ┌──────────────────────────────┐    ┌──────────────────────┐
                 │ apps/worker (BullMQ)          │───►│ services/engine (Go)  │
                 │ batch CSV · SMTP throttling   │    │ AfterShip/email-      │
                 │ webhooks · retention purge    │    │ verifier, internal   │
                 └──────────────────────────────┘    │ network ONLY         │
                                                     └──────────────────────┘
```

| Layer           | Choice                                                         |
| --------------- | -------------------------------------------------------------- |
| Language        | TypeScript (strict) everywhere; Go for the engine sidecar      |
| API             | Fastify 5, Zod, OpenAPI 3.1 generated from route schemas       |
| Web + dashboard | Next.js 16 (App Router), React 19, Tailwind, self-hosted fonts |
| Validation      | Go sidecar wrapping `AfterShip/email-verifier` (MIT)           |
| Database        | PostgreSQL 16 + Drizzle ORM, append-only credit ledger         |
| Queue           | Redis 7 + BullMQ                                               |
| Object storage  | S3-compatible (MinIO locally)                                  |
| Packaging       | pnpm workspaces, Docker Compose, Caddy with automatic TLS      |

The engine has no authentication and is **never** exposed publicly: in
production it lives on an internal Docker network and the smoke test asserts
it is unreachable from outside. See [docs/architecture.md](docs/architecture.md).

## Quick start

Prerequisites: Node 22 (`.nvmrc`), pnpm 9, Docker Desktop or Docker Engine
with Compose v2.

```bash
git clone https://github.com/azakapro/tozalist.git
cd tozalist
pnpm install
cp .env.example .env            # local placeholders only; .env is git-ignored
docker compose up -d            # postgres, redis, minio, and the Go engine
pnpm build                      # workspace packages resolve to their dist/
pnpm db:migrate
pnpm db:seed                    # prints a local API key ONCE
pnpm dev                        # api :3001, worker, web :3000, dashboard :3002
```

Fastest way to see it work, no account needed: in a second terminal run
`pnpm try` and open http://localhost:3005 — one input, type an email, get a
verdict. It mints a temporary key for the seeded demo organisation and revokes
it when you press Ctrl+C.

### Checking whether a mailbox really exists

By default only offline checks run, so a well-formed address at a real domain
comes back `unknown` with `SMTP_NOT_CHECKED`. To probe the mailbox itself over
SMTP (which is what tells you whether `someone@gmail.com` exists):

1. Your network must allow outbound port 25. Test with
   `nc -z -G 5 gmail-smtp-in.l.google.com 25`; most home connections work,
   most cloud VPS providers block it until you ask.
2. In `.env` set `SMTP_ENABLED=true`, and give the probe a real identity:
   `SMTP_HELO_DOMAIN=yourdomain.example` and `SMTP_PROBE_FROM=postmaster@yourdomain.example`.
3. Enable it for the demo organisation (it is per-organisation by design):

   ```bash
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE organizations SET smtp_enabled = true WHERE id = '"'"'00000000-0000-4000-8000-000000000001'"'"';"'
   ```

4. Restart `docker compose up -d engine` and `pnpm dev`. `pnpm try` now waits for
   the probe: a missing Gmail mailbox returns `invalid` / `MAILBOX_REJECTED`, an
   existing one `valid`. Providers that accept every recipient (mail.ru does)
   are reported as `unknown` / `CATCH_ALL_DOMAIN`, and a provider that refuses
   to talk to your IP (iCloud does this for many residential ranges) as
   `unknown` / `SMTP_UNAVAILABLE` - the probe never guesses.

Then try it:

```bash
export KEY=tzl_live_...         # the key printed by db:seed

curl -s localhost:3001/v1/email/check \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"email":"someone@gmial.com","smtp":false}' | jq .data
```

```json
{
  "verdict": "risky",
  "reason_codes": ["POSSIBLE_TYPO", "MX_LOOKUP_UNAVAILABLE", "SMTP_NOT_CHECKED"],
  "suggestion": "gmail.com",
  "disclaimer": "These are risk signals, not delivery guarantees. ..."
}
```

- Public site: http://localhost:3000 (Uzbek by default; `/ru`, `/en`)
- Dashboard: http://localhost:3002 — create an organisation, enrol MFA, mint keys, upload a CSV
- API reference: http://localhost:3001/docs (Swagger UI) and `/openapi.json`

Batch upload from the command line:

```bash
curl -s localhost:3001/v1/batches -H "Authorization: Bearer $KEY" -F file=@list.csv
curl -s localhost:3001/v1/batches/<batch_id> -H "Authorization: Bearer $KEY"   # progress + signed download URL
```

The Go engine is only ever reached through Compose. `docker-compose.override.yml`
(loaded automatically in development) maps it to `127.0.0.1:8080` so the
host-run API and worker can talk to it; production uses `docker-compose.prod.yml`
explicitly and publishes nothing but Caddy's 80/443.

## Repository layout

```
apps/
  api/          Fastify API: auth, credits, checks, batches, webhooks, metrics
  worker/       BullMQ worker: batch pipeline, SMTP throttling, webhook delivery, retention purge
  dashboard/    Next.js customer dashboard (session auth, TOTP MFA, keys, usage, billing)
  web/          Next.js public site: landing, docs, legal pages, pilot form (uz/ru/en)
packages/
  core/         Pure domain logic: normalisation, typo map, verdict aggregation, reason codes, 500-case corpus
  db/           Drizzle schema, migrations, seed, lifecycle helpers
  shared/       Engine client (retries + circuit breaker), S3 storage, logging redaction, env helpers
services/
  engine/       Go sidecar wrapping AfterShip/email-verifier; internal-only HTTP
deploy/         Production Compose, Caddy, backup/restore scripts, deploy runbook
scripts/        Smoke test, deployment verification, secret scan
docs/           Architecture, data model, webhooks, beta kit, release gates, launch checklist
```

## Development

| Command                | What it does                                                   |
| ---------------------- | -------------------------------------------------------------- |
| `pnpm dev`             | Runs api, worker, web and dashboard together (`concurrently`)  |
| `pnpm build`           | Builds every workspace package in dependency order             |
| `pnpm test`            | Vitest across all packages (integration suites use Compose)    |
| `pnpm typecheck`       | `tsc --noEmit` in every TypeScript workspace                   |
| `pnpm lint`            | ESLint; `pnpm format:check` for Prettier                       |
| `pnpm db:migrate`      | Applies pending Drizzle migrations                             |
| `pnpm db:seed`         | Demo org + 10,000 credits; prints an API key once              |
| `pnpm db:test:prepare` | Creates the isolated test database for integration suites      |
| `pnpm core:bench`      | Runs the 500-case accuracy corpus; exits non-zero on any drift |
| `pnpm smoke -- ...`    | End-to-end smoke test against a deployed stack                 |
| `pnpm deploy:verify`   | 14 static checks on the production Compose/Docker contract     |

Entry points load the workspace `.env` automatically in development and never
override variables that are already set, so CI and production pass
configuration explicitly. Edit a package under `packages/` and rebuild it
(`pnpm --filter @tozalist/core build`) for the apps to pick it up.

Go engine tests, without a local Go toolchain:

```bash
docker run --rm -v "$PWD/services/engine:/src" -w /src golang:1.22-alpine go test ./...
```

## Quality gates

CI runs on every push and pull request: frozen install, production dependency
audit (blocking), secret scan, banned-copy lint (no "guaranteed", "verified",
"100% accurate" anywhere in any locale), build, typecheck, ~630 workspace tests
against real Postgres/Redis/MinIO containers, and the accuracy corpus.

Highlights worth reading:

- **No double-spend:** 20 concurrent requests against 10 credits leave exactly 10 successes and a zero balance.
- **Streaming batches:** live-heap growth between a 1k-row and a 50k-row CSV is asserted under 40 MB.
- **Log redaction:** a full check flow is captured and asserted to contain no raw email or API key.
- **SSRF:** webhook targets are resolved and rejected for private ranges at registration _and_ delivery.
- **CSV formula injection:** every result cell starting with `= + - @ \t \r` is neutralised.
- **Lighthouse:** public site scores 100/100/96/100 desktop and 99/100/96/100 mobile.

## Deployment

`deploy/README.md` documents a single-host production deployment: non-root
multi-stage images, Caddy with automatic TLS, PostgreSQL backups to S3 with
7-daily/4-weekly retention, a guarded restore drill, and a smoke test that
also proves the engine is unreachable. `docs/LAUNCH-CHECKLIST.md` is the
ordered path from a bare domain to a live synthetic-data preview.

## Documentation

- [docs/architecture.md](docs/architecture.md) — components, topology, trust boundary
- [docs/data-model.md](docs/data-model.md) — schema, retention rules, append-only ledger
- [docs/webhooks.md](docs/webhooks.md) — delivery contract and signature verification (Node, Python)
- [docs/beta/](docs/beta/) — design-partner kit: onboarding checklist, interview script, accuracy measurement, stop criteria
- [docs/PRE-PRODUCTION-GATES.md](docs/PRE-PRODUCTION-GATES.md) — release gates and their evidence
- [TODO-PAYMENTS.md](TODO-PAYMENTS.md) — what Click/Payme integration would require
- [docs/agent-loop/](docs/agent-loop/) — the roadmap and the PM/CTO relay protocol the project was built with

## How it was built

The product was implemented step by step from a fixed roadmap
([docs/agent-loop/ROADMAP.md](docs/agent-loop/ROADMAP.md)) using an
AI-assisted workflow: one roadmap step at a time, each with required
verification and acceptance criteria, reviewed against the actual diff before
the next step began. The relay records in `docs/agent-loop/` are left in place
as an honest trace of that process.

## License

MIT — see [LICENSE](LICENSE). `AfterShip/email-verifier` is used under its MIT
license; see `services/engine/THIRD_PARTY_LICENSES`.
