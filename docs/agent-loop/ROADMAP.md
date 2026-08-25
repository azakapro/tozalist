# Email-List Hygiene MVP — Implementation Roadmap v2

**Project:** Consent-first email validation SaaS for Uzbekistan (1Lookup-inspired, deliberately narrow scope)
**Pipeline:** ChatGPT holds this document → hands Claude Code **one step at a time** → Claude Code implements → ChatGPT verifies against acceptance criteria → next step.

---

## 0. Read this first

### Instructions for ChatGPT (the orchestrator)

You are the project manager. The user will paste this roadmap to you once, then repeatedly ask "next step."

**Your job each turn:**
1. Give the user **exactly one step's prompt**, in a copy-paste code block, unmodified.
2. Wait for the user to paste back Claude Code's output/diff.
3. Verify against that step's **acceptance criteria**. Also run the **universal review checks** (§0.4) every single time.
4. If it fails → write a short corrective re-prompt naming the specific defect. If it passes → confirm and give the next step.

**Never** give two steps at once. **Never** rewrite a prompt to "improve" it before the first attempt — prompts are self-contained by design (Claude Code starts each session without memory of this document). Do add a corrective note if a *previous* step revealed a deviation Claude Code should know about.

### 0.1 Fixed stack — do not change mid-project

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere except the engine sidecar |
| API | Fastify 4 |
| Dashboard + Landing | Next.js 14 (app router), Tailwind |
| Validation engine | **Go sidecar wrapping `AfterShip/email-verifier` (MIT)** |
| DB | PostgreSQL 16 + Drizzle ORM |
| Queue | Redis 7 + BullMQ |
| Object storage | S3-compatible (MinIO local) |
| Dev/prod | Docker Compose |

**Why the Go sidecar:** the SMTP/catch-all/MX logic is a solved commodity — `AfterShip/email-verifier` is MIT-licensed and battle-tested. Wrapping it in a ~200-line internal HTTP service saves ~2 weeks and gives better-tested validation than hand-rolling. Everything else stays TypeScript. The sidecar is **never** exposed publicly; only the Fastify API calls it.

### 0.2 Hard product boundaries (enforce on every step)

- **No phone carrier/HLR lookup, no live number status, no number→owner.** Phone = offline format validation only (`libphonenumber-js`).
- **No person enrichment, reverse lookup, skip tracing, people search, B2B contact append.**
- **No scraping** of any platform.
- Every verdict is a **signal with a reason code** — never a guarantee. Banned words in code, API responses, UI, and marketing copy: *guaranteed, deliverable, verified owner, 100% accurate, safe to send*.
- **Catch-all / timeout / uncertain → `unknown`**, never `invalid`. Customers must never be told to delete an `unknown`.
- Every table or object holding customer data needs a retention/deletion path.
- No 1Lookup name, copy, UI text, or endpoint names copied verbatim. Patterns are generic industry practice; content is not.

### 0.3 Phase map

| Phase | Weeks | Delivers |
|---|---|---|
| 0 | Day 1 | Monorepo, docker compose, DB schema |
| 1 | 1 | Validation engine (Go sidecar + TS core) |
| 2 | 2 | Queue, throttling, circuit breaker |
| 3 | 3 | REST API, auth, credits, cache, OpenAPI |
| 4 | 4 | Batch CSV pipeline + webhooks |
| 5 | 5 | Dashboard |
| 6 | 6 | **Landing page + public site** |
| 7 | 7 | Compliance plumbing + pilot billing |
| 8 | 8 | Hardening, observability, accuracy corpus |
| 9 | 9 | Deployment + beta kit |

### 0.4 Universal review checks (ChatGPT runs these on EVERY step)

1. **No feature creep** beyond the step's prompt — especially no carrier/enrichment/scraping code sneaking in.
2. **Language discipline** — none of the banned words from §0.2 anywhere.
3. **Secrets** — nothing hardcoded; API keys stored hashed; no secrets in logs.
4. **Retention** — any new customer-data store has a deletion path.
5. **Tests assert behavior** — not just "it runs." Reject `expect(true).toBe(true)`-tier tests.
6. **TypeScript strict** — no `any`, no `@ts-ignore` without a written justification comment.

---

# PHASE 0 — Foundation (Day 1)

## Step 0.1 — Monorepo + tooling

```
Create a TypeScript monorepo for an email-validation SaaS using pnpm workspaces:

apps/api          — Fastify 4 + TypeScript. Empty server, GET /health returns {"status":"ok"}. Port from env API_PORT (default 3001).
apps/worker       — BullMQ worker process. Empty skeleton that connects to Redis and logs "worker ready".
apps/dashboard    — Next.js 14 app router + Tailwind. Default page.
apps/web          — Next.js 14 app router + Tailwind. Separate public marketing site. Default page.
services/engine   — Go module (placeholder main.go printing "engine placeholder", plus Dockerfile). Do not implement logic yet.
packages/core     — Pure TypeScript validation logic. No I/O dependencies.
packages/db       — Drizzle ORM schema + migrations for PostgreSQL.
packages/shared   — Shared TypeScript types and constants used by api/worker/dashboard.

Root config: pnpm-workspace.yaml, base tsconfig with "strict": true, ESLint + Prettier, vitest configured in api/worker/core/db/shared.

docker-compose.yml with: postgres:16 (named volume), redis:7, minio (S3-compatible, console on 9001), and the engine service built from services/engine.

.env.example listing: DATABASE_URL, REDIS_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, API_PORT, ENGINE_URL, SMTP_ENABLED (default false), SMTP_HELO_DOMAIN, SMTP_PROBE_FROM.

Root README with setup: pnpm install → docker compose up -d → pnpm db:migrate → pnpm dev.

Add one meaningful test per TS package. Verify: pnpm install, pnpm -r build, pnpm -r test all succeed, and curl localhost:3001/health works.
```

**Acceptance criteria**
- [ ] `pnpm -r build` and `pnpm -r test` both pass
- [ ] `docker compose up -d` starts postgres, redis, minio, engine
- [ ] `strict: true` set; `/health` responds

## Step 0.2 — Database schema

```
In packages/db, define a Drizzle ORM PostgreSQL schema and generate the initial migration.

Tables:

organizations: id uuid pk, name, created_at, deleted_at nullable, retention_days int default 30, smtp_enabled bool default false
users: id, org_id fk, email unique, password_hash, role enum(admin,member), mfa_secret nullable, created_at
api_keys: id, org_id fk, name, key_hash (sha256 — never store plaintext), key_prefix (first 12 chars for display), created_at, revoked_at nullable, last_used_at nullable
credit_ledger: id, org_id fk, delta int (positive=grant, negative=spend), reason enum(grant,single_check,batch_check,refund,adjustment), reference_id nullable, note nullable, created_at
  → Balance is ALWAYS computed as SUM(delta). Never add a mutable balance column.
email_checks: id, org_id fk, email_normalized, email_hash (sha256, indexed), verdict enum(valid,invalid,risky,unknown), reason_codes text[], checks_json jsonb, cached bool, credits_used int, created_at, expires_at
phone_checks: id, org_id fk, e164 nullable, input_hash, valid bool, country nullable, line_type_guess nullable, reason_codes text[], credits_used, created_at, expires_at
batches: id, org_id fk, filename, status enum(pending,validating,processing,done,failed), total_rows, processed_rows, error nullable, input_object_key, result_object_key nullable, created_at, completed_at nullable, expires_at
webhook_endpoints: id, org_id fk, url, secret, events text[], active bool, created_at
webhook_deliveries: id, endpoint_id fk, event_type, payload jsonb, status enum(pending,delivered,failed), attempts int, last_error nullable, next_retry_at nullable, created_at
audit_events: id, org_id fk nullable, actor_user_id nullable, actor_api_key_id nullable, action, target_type, target_id, metadata jsonb, created_at
leads: id, email, company nullable, phone nullable, message nullable, source (enum: landing_pilot, landing_contact, landing_checklist), locale, created_at
  → For the landing page's pilot-request form. Include a deletion path.

Indexes: email_checks(org_id, email_hash, created_at), phone_checks(org_id, input_hash), credit_ledger(org_id, created_at), audit_events(org_id, created_at), batches(org_id, created_at).

Scripts: pnpm db:migrate (runner), pnpm db:seed (one demo org + admin user + API key printed once in plaintext + 10,000 credit grant).

Tests (vitest against a test database): migrations apply cleanly; the SUM-based balance pattern returns correct values after mixed grants and spends.
```

**Acceptance criteria**
- [ ] Fresh migration applies cleanly; seed prints a usable key
- [ ] Keys hashed; balance derived via SUM, no balance column
- [ ] Every customer-data table has `expires_at` or `deleted_at`

---

# PHASE 1 — Validation engine (Week 1)

## Step 1.1 — Go engine sidecar wrapping AfterShip/email-verifier

```
Implement services/engine: a small internal-only Go HTTP service wrapping the MIT-licensed library github.com/AfterShip/email-verifier.

Endpoints:
GET  /health → {"status":"ok"}
POST /verify  body {"email":"x@y.com","smtp":false,"catch_all":false}

Response (stable contract — apps/api depends on this shape):
{
  "email": "...",
  "syntax":     {"valid": bool, "username": "...", "domain": "..."},
  "mx":         {"has_mx": bool, "records": ["..."]},
  "disposable": bool,
  "role_account": bool,
  "free_provider": bool,
  "smtp":       {"attempted": bool, "deliverable": bool, "catch_all": bool, "full_inbox": bool, "disabled": bool, "error": "" } | null,
  "duration_ms": 123
}

Requirements:
- Configure the verifier: EnableSMTPCheck() only when the request sets smtp=true AND env SMTP_ENABLED=true. Default SMTP_ENABLED=false.
- Env config: ENGINE_PORT (default 8080), SMTP_ENABLED, SMTP_HELO_DOMAIN, SMTP_PROBE_FROM, VERIFY_TIMEOUT_SECONDS (default 15).
- Bind to 0.0.0.0 but document clearly in the README that this service must NEVER be exposed publicly — it has no authentication and is reachable only on the internal docker network.
- Hard timeout per request; on timeout return 200 with smtp.error set (never a 5xx for a timeout — the caller needs the partial result).
- Structured JSON logging: log the DOMAIN and a hash of the local part, never the full email address.
- Graceful shutdown on SIGTERM.
- Multi-stage Dockerfile, distroless or alpine final image, non-root user, HEALTHCHECK hitting /health.
- Go tests for the handler using a stubbed verifier interface: success, syntax failure, timeout, smtp-disabled paths.
- Include the AfterShip MIT license text in services/engine/THIRD_PARTY_LICENSES.

Do NOT add any carrier lookup, phone, enrichment, or scraping capability to this service. Email checks only.
```

**Acceptance criteria**
- [ ] Response contract matches spec exactly (apps/api will depend on it)
- [ ] `SMTP_ENABLED=false` default; timeouts return 200 with partial data
- [ ] MIT license included; no full emails in logs; non-root container

## Step 1.2 — TS core: normalization, typo detection, phone

```
In packages/core, implement pure TypeScript functions with zero I/O:

1) normalizeEmail(input: string): { normalized: string | null; changes: string[] }
   Trim, lowercase domain, lowercase local part, strip surrounding angle brackets/quotes. Record every change applied.

2) detectTypo(domain: string): string | null
   Suggest corrections for common domain typos. Build a static map covering global providers (gmail, yahoo, hotmail, outlook, icloud, proton) AND the CIS/Uzbekistan market: mail.ru, yandex.ru, yandex.com, inbox.ru, list.ru, bk.ru, rambler.ru, umail.uz, exat.uz. Include TLD typos (.cmo → .com, .con → .com, .ru variants). Use Levenshtein distance ≤2 against the known-domain list plus an explicit typo map for common cases.

3) validatePhone(input: string, defaultCountry = "UZ"): PhoneResult
   Use libphonenumber-js. Return { e164, valid, country, lineTypeGuess, reasonCodes }.
   Reason codes: PHONE_OK, PHONE_INVALID_FORMAT, PHONE_TOO_SHORT, PHONE_TOO_LONG, PHONE_UNKNOWN_COUNTRY.
   CRITICAL: offline metadata only. No network calls of any kind. No carrier lookup, no HLR, no live status. Add a JSDoc note stating lineTypeGuess is a numbering-plan inference, not live carrier data.

4) Export a frozen REASON_CODES const object — the single source of truth for every reason code string in the system, each with a plain-English customer-facing explanation. This will be reused by the API, the dashboard, and the docs.

Tests: 40+ cases for normalization/typos (including Cyrillic-adjacent and .uz domains), and phone tests for +998 mobile, bare 9-digit UZ numbers, UZ landline, RU/KZ numbers, and garbage input.
```

**Acceptance criteria**
- [ ] Zero network calls in core; UZ/CIS domains and `+998` covered
- [ ] `REASON_CODES` is the single source of truth with explanations
- [ ] 40+ meaningful tests pass

## Step 1.3 — Verdict aggregator

```
In packages/core, implement the aggregator that converts the engine sidecar's response plus local checks into a final customer-facing verdict.

aggregate(input: { engine: EngineResponse; typo: string | null }): {
  verdict: 'valid' | 'invalid' | 'risky' | 'unknown';
  score: number;
  reasonCodes: string[];
  disclaimer: string;
}

Rules, in strict priority order:
1. engine.syntax.valid === false → invalid (SYNTAX_INVALID)
2. engine.mx.has_mx === false → invalid (DOMAIN_NO_MX)
3. engine.smtp exists AND smtp.catch_all === true → unknown (CATCH_ALL_DOMAIN)
4. engine.smtp exists AND smtp.error non-empty → unknown (SMTP_UNAVAILABLE)
5. engine.smtp exists AND smtp.deliverable === false AND no error AND not catch_all → invalid (MAILBOX_REJECTED)
6. engine.smtp exists AND smtp.full_inbox → risky (MAILBOX_FULL)
7. engine.smtp exists AND smtp.disabled → invalid (MAILBOX_DISABLED)
8. engine.disposable === true → risky (DISPOSABLE_DOMAIN)
9. engine.role_account === true → risky (ROLE_ACCOUNT)
10. typo !== null → risky (POSSIBLE_TYPO), include the suggestion in reason metadata
11. engine.smtp === null (SMTP not run) and all above pass → unknown (SMTP_NOT_CHECKED) — we cannot claim mailbox existence from MX alone
12. Otherwise → valid

score: 0-100, for SORTING ONLY. valid 90-100, risky 40-70, unknown 50, invalid 0-10. Document in JSDoc that score is a sort key, never a probability of delivery.

disclaimer (constant, always present in output): "These are risk signals, not delivery guarantees. Results marked 'unknown' should not be deleted automatically."

Write one test per rule plus at least 8 combination tests (disposable+role, catch_all+typo, no-smtp+role, etc.). Verify the priority order is respected when multiple conditions apply.
```

**Acceptance criteria**
- [ ] Priority order exactly as specified; combination tests prove ordering
- [ ] Rule 11 present — MX alone never yields `valid`
- [ ] Disclaimer in every result

---

# PHASE 2 — Queue and throttling (Week 2)

## Step 2.1 — Engine client with resilience

```
In packages/shared, implement a typed HTTP client for the Go engine sidecar used by both apps/api and apps/worker:

class EngineClient {
  verify(email: string, opts: { smtp: boolean; catchAll: boolean }): Promise<EngineResponse>
}

Requirements:
- Base URL from env ENGINE_URL. Typed response matching the sidecar contract exactly (define the Zod schema and validate responses at runtime — fail loudly on contract drift).
- Timeouts: 5s for non-SMTP requests, 20s for SMTP requests.
- Retry: 2 retries with exponential backoff (200ms, 800ms) for network errors and 5xx ONLY. Never retry a 4xx or a timeout on an SMTP request (a mail server that timed out should not be hit again immediately).
- Circuit breaker on the engine service itself: after 5 consecutive failures, open for 30s and throw EngineUnavailableError immediately. Half-open with a single probe.
- Every call emits structured logs with duration and outcome; never log the full email.

Tests with a mocked HTTP layer: success, contract-drift rejection, retry behavior, no-retry-on-4xx, circuit open/half-open/close transitions.
```

**Acceptance criteria**
- [ ] Runtime schema validation catches contract drift
- [ ] No retry on 4xx or SMTP timeout; circuit breaker states tested

## Step 2.2 — SMTP throttling worker

```
Create the smtp-probe processing in apps/worker: a BullMQ worker consuming an "smtp-probe" queue and calling EngineClient with smtp=true.

Throttling (all state in Redis, since multiple worker instances may run):
- Per destination MX host: max 1 concurrent probe and max 5 probes per minute, sliding window. Excess jobs are DELAYED and retried, never dropped.
- Global concurrency: env SMTP_WORKER_CONCURRENCY, default 10.
- Per-domain circuit breaker: after 3 consecutive failures for a domain, skip that domain for 1 hour — resolve jobs immediately as unknown / CIRCUIT_OPEN.

On completion: re-run the core aggregator with the SMTP data and UPDATE the existing email_checks row (verdict, reason_codes, checks_json), then enqueue any webhook events.

Config: SMTP_ENABLED (default false). When false, the worker resolves every job immediately as unknown / SMTP_DISABLED without contacting the engine — this must be the default local-dev behavior.

Logging: pino JSON, one line per job — domain, outcome, duration, retry count. Never the full email address. Graceful SIGTERM shutdown finishing in-flight jobs (max 30s).

Integration tests using a real Redis test container: rate limit delays excess jobs, circuit breaker opens and closes, SMTP_DISABLED short-circuits, graceful shutdown drains.
```

**Acceptance criteria**
- [ ] Rate limit + circuit breaker proven with tests, state in Redis
- [ ] `SMTP_ENABLED=false` default short-circuits to `unknown`
- [ ] No full emails logged; graceful shutdown works

---

# PHASE 3 — REST API (Week 3)

## Step 3.1 — Auth, API keys, rate limiting

```
In apps/api (Fastify), implement authentication and rate limiting.

- Bearer auth: "Authorization: Bearer <key>". Look up sha256(key) in api_keys; reject 401 if missing or revoked. Attach { orgId, apiKeyId } to the request. Update last_used_at, throttled to once per minute per key via Redis.
- Key format: "ehk_live_" + 32 random base62 chars (crypto-secure). CLI for now: pnpm api:create-key --org <id> --name <name>, printing the plaintext key exactly once.
- Rate limit: 100 requests per 10 seconds per API key, sliding window in Redis. On breach → 429 with a Retry-After header in seconds.
- Universal error envelope for ALL errors: {"error": {"code": "...", "message": "...", "request_id": "..."}}. Codes: UNAUTHORIZED, RATE_LIMITED, INSUFFICIENT_CREDITS, VALIDATION_ERROR, NOT_FOUND, PAYLOAD_TOO_LARGE, INTERNAL_ERROR.
- Request ID: uuid per request, echoed in X-Request-Id and included in every log line for that request.
- JSON body limit 1MB → 413 PAYLOAD_TOO_LARGE.
- Audit: write audit_events for auth failures and key revocations.

Tests: valid key, revoked key, malformed header, missing header, rate-limit trip and Retry-After accuracy, oversized body.
```

**Acceptance criteria**
- [ ] Hash-only key verification; correct `Retry-After`
- [ ] One consistent error envelope with request IDs everywhere

## Step 3.2 — Check endpoints with credits and cache

```
In apps/api implement the core endpoints.

POST /v1/email/check
Body: {"email": "...", "smtp": false}
Flow:
1. Validate body (reject unknown fields → 400 VALIDATION_ERROR).
2. Compute balance = SUM(credit_ledger.delta) for the org, cached in Redis for 10s. If < 1 → 402 INSUFFICIENT_CREDITS.
3. Cache lookup: email_checks WHERE org_id AND email_hash AND created_at > now() - 7 days, most recent first. On hit → return stored result with meta.cached=true and credits_used=0. Do NOT write a ledger row.
4. On miss: normalizeEmail → EngineClient.verify(smtp:false) → detectTypo → aggregate.
5. If smtp=true AND org.smtp_enabled AND env SMTP_ENABLED: enqueue an smtp-probe job, return the current verdict with meta.smtp="pending" plus check_id.
6. In a SINGLE database transaction: insert email_checks (expires_at = now + org.retention_days) AND insert credit_ledger (delta -1, reason single_check, reference_id = check id). A failed pipeline must never spend credits.

Response:
{
  "data": {"email": "...", "verdict": "...", "score": 0, "reason_codes": ["..."], "reason_explanations": {"CODE": "plain English"}, "suggestion": "gmail.com" | null, "checks": {"syntax": {}, "domain": {}, "disposable": bool, "role_account": bool, "smtp": {} | null}, "disclaimer": "..."},
  "meta": {"request_id": "...", "credits_used": 1, "credits_remaining": 0, "cached": false, "smtp": "skipped"|"pending"|"complete", "api_version": "v1"}
}

GET /v1/email/check/{id} — re-fetch a check (for polling a pending SMTP result). Owner org only; other orgs get 404, never 403.

POST /v1/phone/check — body {"phone":"...","country":"UZ"}. 1 credit, same envelope, uses validatePhone from core. Response must include the disclaimer that this is format validation only and carries no information about whether the number is active or who owns it.

GET /v1/usage — current balance, checks this month, recent ledger entries (paginated).

Tests: cache hit/miss, 7-day cache boundary, 402 on depletion, cross-org 404, phone format cases, and a concurrency test firing 20 simultaneous requests against an org with 10 credits — assert exactly 10 succeed, balance lands at 0, never negative, no double-spend.
```

**Acceptance criteria**
- [ ] Concurrency test proves no double-spend and no negative balance
- [ ] Cache hits cost 0 credits and write no ledger row
- [ ] Phone response states format-only limitation

## Step 3.3 — OpenAPI + validation

```
Add @fastify/swagger and @fastify/swagger-ui to apps/api.

- Define OpenAPI 3.1 schemas as Fastify route schemas for every endpoint, so they enforce runtime request validation as well as generate docs. Unknown body fields → 400 VALIDATION_ERROR.
- Document every error response (400/401/402/404/413/429/500) with the shared envelope.
- Serve /openapi.json and human-readable docs at /docs.
- Add example requests/responses for each endpoint.
- Test: fetch /openapi.json and validate it against the OpenAPI 3.1 metaschema; assert every registered route appears in the spec (fail if a route is undocumented).
```

**Acceptance criteria**
- [ ] Every route documented and runtime-validated; spec passes metaschema
- [ ] Test fails if a route lacks a schema

---

# PHASE 4 — Batch pipeline + webhooks (Week 4)

## Step 4.1 — Batch CSV processing

```
Implement batch processing across apps/api and apps/worker.

POST /v1/batches — multipart CSV upload, max 20MB, max 100,000 rows.
1. Stream the upload to S3 at org/{org_id}/batches/{batch_id}/input.csv — never buffer the whole file in memory.
2. Detect the email column: by header name (email, e-mail, mail, email_address, pochta, elektron pochta) or, if headerless, by sampling the first 50 rows for @-containing values.
3. Count rows, compute cost (1 credit/row), check balance. Insufficient → 402 with the shortfall in the message.
4. Reserve credits: write a single negative ledger entry (reason batch_check, reference_id = batch id).
5. Create the batches row (status pending), enqueue a "batch-process" job, return {batch_id, total_rows, credit_cost, status}.

Batch worker:
- STREAM the CSV row by row (constant memory regardless of file size).
- Deduplicate within the file: process each unique normalized address once, reuse the result for repeats, charge once.
- Reuse the 7-day org cache for addresses already checked; those rows cost 0.
- Write a result CSV to S3: all original columns preserved, plus normalized_email, verdict, score, reason_codes, suggestion.
- Update processed_rows every 500 rows so the dashboard can show progress.
- Malformed row → verdict invalid with SYNTAX_INVALID; never crash the job. Track a malformed_rows count.
- On completion: reconcile the ledger (refund the difference between reserved credits and actually-charged unique/uncached rows as a positive entry with reason refund), set status done, set expires_at per org retention, enqueue the webhook event.
- On failure: status failed with the error message, refund ALL reserved credits.

GET /v1/batches/{id} — status, progress, counts, verdict distribution, and when done a freshly-signed S3 download URL valid 1 hour. Owner org only; others get 404.
GET /v1/batches — paginated list for the org.
DELETE /v1/batches/{id} — immediate deletion of the DB row and both S3 objects, audit-logged.

Tests against real test containers: a 10,000-row synthetic CSV end to end, duplicates charged once, cached rows charged zero, ledger reconciliation exact, malformed rows handled, cross-org access 404, failure path refunds fully, and a memory assertion proving streaming (peak memory stays flat between a 1k-row and 50k-row file).
```

**Acceptance criteria**
- [ ] Streaming proven; duplicates and cache hits charged correctly
- [ ] Ledger reconciles exactly on both success and failure paths
- [ ] Cross-org access → 404; signed URLs expire

## Step 4.2 — Webhooks

```
Implement webhooks.

POST /v1/webhooks — body {"url": "https://...", "events": ["batch.completed","batch.failed"]}
- HTTPS only; reject http:// with VALIDATION_ERROR.
- SSRF protection: resolve the hostname and reject if it maps to a private or reserved range — 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, 0.0.0.0/8, ::1, fc00::/7, fe80::/10. Re-check the resolved IP at delivery time too, not only at registration (DNS can be re-pointed after registration).
- Generate a 32-byte secret, return it exactly once.
GET /v1/webhooks, DELETE /v1/webhooks/{id}.

Delivery (worker):
- POST JSON: {"event": "batch.completed", "data": {"batch_id": "...", "status": "...", "total_rows": n, "verdict_counts": {...}}, "timestamp": "ISO8601", "delivery_id": "uuid"}
- Headers: X-Signature (hex HMAC-SHA256 of the RAW request body using the endpoint secret), X-Timestamp, X-Delivery-Id, X-Event-Type.
- 5-second timeout. Do NOT follow redirects. Any 2xx = delivered.
- Retries with backoff: 1m, 5m, 30m, 2h, 6h, then status failed. Record every attempt in webhook_deliveries with the response code and error.

Add a docs section showing customers how to verify the signature, with a Node.js and a Python example, including a timing-safe comparison and a timestamp-freshness check to prevent replay.

Tests: HMAC correctness against a known vector, every SSRF rejection case (including DNS-rebind at delivery time), redirect refusal, timeout handling, and the exact retry schedule with fake timers.
```

**Acceptance criteria**
- [ ] SSRF checked at registration AND delivery; redirects refused
- [ ] HMAC verifiable by the documented samples; retry schedule exact

---

# PHASE 5 — Dashboard (Week 5)

## Step 5.1 — Auth, org, and API keys

```
In apps/dashboard (Next.js 14 app router), implement session auth and organization management.

- Add /internal/* endpoints to apps/api, authenticated by session cookie (httpOnly, secure, SameSite=lax) rather than API key. CORS locked to the dashboard origin. CSRF tokens on all mutations.
- Use lucia-auth or iron-session — no paid third-party auth service.
- Argon2id password hashing. TOTP MFA mandatory for the admin role: QR enrollment on first login, code required on subsequent logins. Generate 10 single-use recovery codes at enrollment, shown once.
- Pages: /login, /signup (creates org + admin user), /dashboard (credits remaining, checks this month, recent batches, recent activity), /keys (list showing key_prefix only; create shows the full key once in a copy-to-clipboard modal with a warning; revoke with confirmation), /settings (org name, retention_days selector of 7/30/90 with an explanation of what each means, danger zone: delete organization → soft delete + scheduled purge, requires typing the org name to confirm).
- Every state-changing action writes an audit_event.
- ALL user-facing strings in a single messages file structured for i18n with locales en/ru/uz — implement English fully now, leave ru/uz keys present but falling back to English.
- Tailwind only, no external UI kit. Clean and minimal.

Tests: signup/login/logout flows, MFA enrollment and challenge, recovery codes single-use, key creation shows once, revocation blocks API use.
```

**Acceptance criteria**
- [ ] MFA enforced for admins; recovery codes single-use
- [ ] Keys displayed once; i18n structure with en/ru/uz keys in place

## Step 5.2 — Check, batch, and usage UI

```
Add to apps/dashboard:

/check — single email and phone check form.
- Verdict rendered with color and icon: valid=green, risky=amber, unknown=gray, invalid=red.
- CRITICAL UX rule: "unknown" must be visually distinct from "invalid" and accompanied by the text "Do not delete — we could not determine this address." Never render unknown in red.
- Show each reason code with its plain-English explanation from REASON_CODES.
- Show the typo suggestion prominently when present ("Did you mean ...?").
- Disclaimer always visible below the result.

/batches — CSV upload and history.
- Drag-and-drop with client-side row counting and a credit-cost estimate shown BEFORE the user confirms. Confirmation button reads "Use N credits".
- Progress bar polling while processing; download button when done.
- Results summary: stacked bar of verdict distribution with counts and percentages.
- History table with status, rows, date, download, delete.

/usage — credit ledger table with running balance, date-range filter, CSV export, and a simple checks-per-day chart (no heavy charting dependency — plain SVG or a tiny library).

Every page needs empty states and error states: no credits (link to billing), API unreachable (retry button), no batches yet (explain what to upload), upload rejected (why).

Component tests with a mocked API: verdict rendering per state (asserting unknown is NOT styled as an error), cost-before-confirm flow, progress polling, error states.
```

**Acceptance criteria**
- [ ] Cost shown before confirming an upload
- [ ] `unknown` visually and textually distinct from `invalid` — test asserts this
- [ ] Empty and error states on every page

---

# PHASE 6 — Landing page and public site (Week 6)

> The report's first-14-days plan requires a live landing page for buyer interviews. If you want it earlier, Step 6.1 can be pulled forward to week 1 — it has no dependency on the API beyond the leads table.

## Step 6.1 — Landing page

```
In apps/web (the public marketing site, separate from the dashboard), build the landing page.

Structure:
1. Hero — headline stating the narrow promise: cleaning email lists a business already owns. Subheadline naming the audience (agencies, exporters, local SaaS, e-commerce). Primary CTA "Request a pilot", secondary "See how it works".
2. Problem — three concrete costs of dirty lists: bounced campaigns damaging sender reputation, failed onboarding from signup typos, wasted spend on dead addresses.
3. How it works — four steps: upload or call the API → we check format, domain, mail records, disposable and role patterns → you get a verdict with a reason for each address → you delete or keep with confidence. Include a visual sample result showing all four verdict states, with "unknown" explicitly explained as "keep this, we could not determine it".
4. What we do NOT do — an explicit trust section: we do not sell contact data, we do not look up phone owners or carriers, we do not scrape, we do not provide data about people you do not already have a relationship with, we do not guarantee delivery. This section is a differentiator, not a disclaimer — write it confidently.
5. Pricing — three research-priced tiers marked clearly as pilot pricing: Pilot 500,000 UZS / 10,000 checks, Team 1,500,000 UZS / 50,000 checks, API 3,500,000 UZS / 200,000 checks. Each with a "Request pilot" CTA. Add a line stating pricing is being finalized with our first partners.
6. Data handling — plain-language summary: your data stays yours, choose 7/30/90-day retention, delete anytime, we never use your lists for anything but your checks.
7. Pilot request form — fields: email (required), company, phone (optional), monthly email volume (select ranges), message. Posts to the API, writes to the leads table with source=landing_pilot. Success state thanks them and says when to expect a reply. Honeypot field + simple rate limiting for spam.
8. FAQ — 8 questions covering: what happens to my data, do you guarantee delivery (no — explain why nobody honestly can), what does unknown mean, do you have an API, can I use this on a purchased list (no — state the policy plainly), which languages do you support, how do I pay, what if results are wrong.
9. Footer — links to /privacy, /terms, /docs, contact.

Requirements:
- i18n with the SAME message-file structure as the dashboard, locales uz/ru/en. Write full Uzbek (Latin script) and Russian copy — this is the primary market and the landing page must be usable in Uzbek. English as fallback.
- Locale switcher in the header; default locale uz; routes /uz, /ru, /en with /uz as root redirect.
- Responsive, mobile-first. Uzbekistan traffic is heavily mobile.
- Performance: static generation, no heavy JS, no external font CDN (self-host), target Lighthouse performance ≥95 and accessibility ≥95.
- SEO: per-locale metadata, Open Graph tags, hreflang alternates, sitemap.xml, robots.txt, JSON-LD Organization schema.
- BANNED copy anywhere on this page: "guaranteed", "deliverable", "100% accurate", "verified", "safe to send", any claim about a person or phone owner. Have the build fail on these: add a script pnpm web:lint-copy that greps the message files for banned terms in all locales and exits non-zero on a match. Wire it into CI.

Tests: form submission happy path and validation errors, honeypot rejection, locale switching, and the banned-copy linter itself.
```

**Acceptance criteria**
- [ ] Full Uzbek + Russian copy, not machine-placeholder text
- [ ] "What we do NOT do" section present; banned-copy linter in CI and passing
- [ ] Lighthouse perf/a11y ≥95; form writes to `leads`

## Step 6.2 — Public docs and legal pages

```
Add to apps/web:

/docs — public developer documentation:
- Quickstart: get a key → first check with curl → interpret the response → first batch.
- Full API reference rendered from apps/api's openapi.json (fetch at build time; use Scalar or a lightweight OpenAPI renderer).
- Webhook verification guide with the Node and Python samples from Step 4.2.
- Reason-code glossary generated from REASON_CODES in packages/core — every code, what it means, and the recommended action. This must be generated, not hand-copied, so it cannot drift.
- A "Limitations" page stating plainly: no delivery guarantee, what unknown and catch-all mean and why they are not failures, phone checks are format-only with no carrier or owner data, retention behavior, deletion rights, and that results must not be used for automated decisions about people.

/privacy, /terms, /prohibited-use — as MDX pages, each with a visible "DRAFT — pending legal review" banner until a lawyer signs off (banner controlled by a single config flag so it can be removed in one place).
- Privacy must include a data map table: what we store, where, how long, why, and how to delete it.
- Prohibited use must list: purchased lists, scraped lists, lists without a consent basis, consumer/credit/employment/insurance screening, harassment or stalking, and any automated decision affecting a person's access to services.

/contact — simple form writing to leads with source=landing_contact.

Tests: docs build without errors, the reason-code glossary matches REASON_CODES exactly (a test that fails if core adds a code with no explanation), and the DRAFT banner renders while the flag is on.
```

**Acceptance criteria**
- [ ] Glossary generated from core — drift test present
- [ ] DRAFT banners on all legal pages behind one flag
- [ ] Prohibited-use policy complete

---

# PHASE 7 — Compliance and billing (Week 7)

## Step 7.1 — Retention, deletion, export

```
Implement the data lifecycle.

Scheduled purge (BullMQ repeatable job, hourly):
- Hard-delete email_checks and phone_checks past expires_at.
- Delete S3 batch input and result objects past expires_at, then the batches rows.
- Hard-delete organizations soft-deleted more than 30 days ago, cascading to users, api_keys, checks, batches, webhooks, and all S3 objects. Keep credit_ledger rows for 3 years for accounting, but anonymize them (null the org name reference, keep only the org id).
- Delete leads older than 12 months.
- Write one audit_event per run with counts per category, and log a summary line.

Self-service:
- Dashboard /settings → "Export my data": generates a ZIP in S3 containing CSVs of all check results, batch metadata, ledger, and audit events, exposed as a 24-hour signed link shown in the UI with an expiry countdown.
- Dashboard /settings → "Delete all check data": immediate hard delete of checks and batch objects, requires typed confirmation, audit-logged.
- DELETE /v1/email/check/{id} and DELETE /v1/phone/check/{id}.

Tests with injected clock (fake timers): purge deletes exactly what is expired and nothing else, S3 objects actually removed (assert against the test MinIO), cascade leaves zero orphans in any table or bucket, export contains every category, immediate deletion is immediate.
```

**Acceptance criteria**
- [ ] Purge verified against both DB and S3; zero orphans after cascade
- [ ] Export complete; deletion immediate and audited

## Step 7.2 — Pilot billing

```
Implement invoice-based pilot billing. Do NOT integrate Click or Payme yet — that requires merchant approval and a registered legal entity, which are business prerequisites, not code.

- Plans in config (not the database): PILOT 500000 UZS / 10000 checks, TEAM 1500000 UZS / 50000 checks, API 3500000 UZS / 200000 checks. Single source of truth shared by apps/web pricing and the dashboard.
- CLI: pnpm billing:grant --org <id> --credits <n> --note "Invoice INV-001 paid 2026-09-01" → one credit_ledger grant entry + audit event. Refuses to run without a note.
- Dashboard /billing: credits remaining, usage this month vs plan allowance, ledger history, and a "Request invoice" form (choose plan → creates a lead/request record → shows bank transfer instructions pulled from env config).
- Monthly statement: pnpm billing:statement --org <id> --month YYYY-MM → renders an HTML statement (checks used, batches run, credits consumed, opening/closing balance) saved to S3, downloadable from /billing.
- Low-balance warning banner in the dashboard under 10% of the last grant.

Create TODO-PAYMENTS.md listing exactly what Click/Payme integration will require later: legal entity registration, merchant onboarding, tax/fiscalization requirements, recurring payment API, refund flow, reconciliation with the credit ledger, and the open questions to ask each provider.

Tests: grants create correct ledger entries, statements compute correct totals for a month boundary, plan config is not duplicated between web and dashboard.
```

**Acceptance criteria**
- [ ] Ledger-only billing, no payment-provider code
- [ ] Plan config single-sourced; `TODO-PAYMENTS.md` present

---

# PHASE 8 — Hardening (Week 8)

## Step 8.1 — Observability and security pass

```
Hardening pass across all apps.

1. Logging: pino everywhere with JSON output. Propagate request_id from API → queue job → worker → engine call. Redaction: full email addresses, API keys, passwords, and webhook secrets must NEVER appear in logs — implement pino redact paths plus a custom serializer that replaces any email with domain + hash of the local part. Write a test that captures log output during a full check flow and asserts no raw email or key appears.

2. Metrics: /metrics Prometheus endpoints on api and worker — request count and latency histogram by route and status, queue depth and job duration, engine call latency and failure rate, SMTP probe outcomes by reason code, cache hit rate, credit spend rate, webhook delivery success rate.

3. Security headers: helmet on api, CSP on dashboard and web, HSTS, X-Frame-Options DENY, no-referrer. CORS strictly limited: /v1/* allows any origin (it is key-authenticated API), /internal/* only the dashboard origin.

4. Secret hygiene: a CI script scanning the repo for secret-like patterns (private keys, AWS keys, high-entropy strings in non-test files) failing the build on a match. All config via env with a startup validation step that fails fast listing every missing variable.

5. Input hardening: fuzz every endpoint with empty body, oversized body, wrong content-type, null bytes, 10,000-character emails, deeply nested JSON, unicode direction-override characters, and SQL/NoSQL injection strings. Assert correct error envelopes, never a 500.

6. Load test: k6 or autocannon script for POST /v1/email/check at 100 rps for 2 minutes, cache-hit and cache-miss variants. Record p50/p95/p99 in bench/RESULTS.md with the machine spec.

7. CI (GitHub Actions): lint, typecheck, test, build, secret scan, banned-copy lint, and the accuracy corpus from Step 8.2, on every push and PR.
```

**Acceptance criteria**
- [ ] Log-redaction test passes on a full flow; CI green with all gates
- [ ] Fuzz inputs never produce a 500; benchmarks recorded

## Step 8.2 — Accuracy regression corpus

```
Create packages/core/bench/corpus — a deterministic labeled test corpus of 500 email addresses covering:
- Valid addresses at global providers and CIS/UZ providers (gmail, mail.ru, yandex.ru, umail.uz, corporate patterns)
- Every syntax failure class
- Disposable domains
- Role accounts
- Nonexistent domains — use .invalid and .test reserved TLDs so tests never touch real DNS
- Typo domains that should trigger suggestions
- Unicode, IDN, and very long addresses
- Catch-all and SMTP-failure scenarios via a stubbed engine response

Each entry: {email, stubbedEngineResponse, expectedVerdict, expectedReasonCodes}.

pnpm core:bench runs the full aggregation pipeline against the corpus with the engine stubbed per-fixture, then prints a confusion matrix (expected vs actual verdict) and per-reason-code precision/recall. Because the corpus is synthetic and deterministic, accuracy must be 100% — the command exits non-zero on ANY mismatch, making it a regression gate rather than a quality score.

Wire into CI. Document in bench/README.md that this measures LOGIC CORRECTNESS, not real-world accuracy — real accuracy can only be measured against consented customer lists with observed bounce outcomes, which happens during the design-partner beta.
```

**Acceptance criteria**
- [ ] 500 deterministic cases, 100% gate in CI
- [ ] README distinguishes logic correctness from real-world accuracy

---

# PHASE 9 — Deployment and beta (Week 9)

> ⚠️ **GATE: do not process real customer data in production until an Uzbekistan-qualified lawyer has confirmed hosting location, controller/processor roles, retention, and cross-border processing.** Deploy and demo with synthetic data until then.

## Step 9.1 — Production deployment

```
Prepare production deployment.

- Multi-stage Dockerfiles for api, worker, dashboard, web, engine. Alpine or distroless final images, non-root users, HEALTHCHECKs, no dev dependencies in final layers.
- docker-compose.prod.yml: all services plus postgres with automated backup (pg_dump sidecar on cron → S3, 7 daily + 4 weekly retained), redis with AOF persistence, Caddy reverse proxy with automatic TLS for api.<domain>, app.<domain>, and <domain> (the marketing site as the apex).
- CRITICAL: the engine service must be bound to the internal docker network only — no published ports, not reachable from the internet. Add a comment explaining why and a smoke-test assertion that it is unreachable externally.
- deploy/README.md: server provisioning checklist (UFW allowing only 80/443/SSH, fail2ban, unattended-upgrades, SSH key-only auth), env setup, first deploy, migration procedure, zero-downtime redeploy, rollback procedure, and a backup RESTORE drill with exact commands.
- Port 25 note in deploy/README.md: most VPS providers block outbound port 25, which SMTP probing requires. Document the unblock request process, and state clearly that SMTP_ENABLED=false is a fully supported configuration where verdicts degrade gracefully to unknown — the product still works without it.
- Smoke test: pnpm smoke --base-url https://api.<domain> covering health, auth rejection, an authenticated check with a seeded key, a small batch round-trip, the marketing site returning 200 in all three locales, and the engine NOT being publicly reachable.
```

**Acceptance criteria**
- [ ] Engine unreachable externally — asserted by the smoke test
- [ ] Documented and tested rollback + backup restore
- [ ] Port-25 constraint documented with graceful fallback

## Step 9.2 — Beta onboarding kit

```
Create the design-partner beta kit as markdown in docs/beta/:

1. onboarding-checklist.md — per-partner template: consent basis confirmed and documented, list source declared, sample size, agreed success metric, retention setting chosen, named contact for false-positive feedback, pilot start and review dates, pricing agreed in writing.
2. interview-script.md — the 20-buyer interview script from the research plan: data source, monthly email volume, hard-bounce cost, current tool and spend, consent basis, last cleanup date, decision maker, budget, preferred payment method, willingness to pay for a 30-day pilot. Include the rule: never request raw personal data at interview stage — aggregate counts and anonymized examples only.
3. accuracy-measurement.md — how to measure real accuracy with a partner lawfully: compare our verdicts against their observed bounce outcomes on a consented list, define true/false positive and negative for each verdict class, explain that unknown is excluded from accuracy scoring rather than counted as a miss, and set the minimum sample size for a meaningful result.
4. weekly-report-template.md — per-partner weekly: checks run, verdict distribution, latency, support tickets, false positives reported, feature requests.
5. stop-criteria.md — the written gates: day 14 (20 interviews, 10 qualified beta requests, 3 written paid-pilot commitments, else pause the build), week 10 (3-5 partners using real consented lists, 2+ weekly), week 13 (3+ paying customers, positive contribution margin, repeatable acquisition message). Include the explicit instruction that failing a gate means pausing and reassessing, not building more features.

Also add a "first 14 days" runbook tying the landing page, the interview script, and the pilot form together into a day-by-day sequence.
```

**Acceptance criteria**
- [ ] All five documents present and specific enough to use unedited
- [ ] Stop criteria written as hard gates, not aspirations

---

# Appendix A — Open-source dependencies

| Purpose | Project | License note |
|---|---|---|
| Email verification engine | `AfterShip/email-verifier` (Go) | MIT — vendored via the sidecar; include license text |
| Disposable domains | `disposable-email-domains/disposable-email-domains` | Bundled with the verifier; refreshable |
| Phone format validation | `catamphetamine/libphonenumber-js` | MIT |
| Typo detection reference | `mailcheck/mailcheck`, `ZooTools/email-spell-checker` | Reference implementations for our own map |
| Alternative engine (evaluate later) | `reacherhq/check-if-email-exists` (Rust) | Check licensing before commercial use |

Any new dependency must have its license recorded in `THIRD_PARTY_LICENSES` before it is merged.

# Appendix B — Parallel business track

Code alone does not de-risk this. Run alongside the build:

- **Weeks 1–2:** 20 structured buyer interviews; publish the landing page (Step 6.1 can be pulled forward); collect 10 qualified beta requests and 3 written paid-pilot commitments.
- **Week 3:** local counsel on controller/processor roles, retention, cross-border processing, data localization, and consent language. Contact Click and Payme about merchant eligibility for this entity type.
- **Weeks 7–8:** onboard 3–5 design partners with consented data only.
- **Week 13:** decision memo — continue, narrow, or stop.

**Stop rule:** fewer than 5 qualified beta requests by day 14 → pause after Phase 3 and revisit the wedge before building the dashboard and landing page out further.
