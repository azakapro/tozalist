# engine

Internal email-validation sidecar (Go), built on the MIT-licensed
[AfterShip/email-verifier](https://github.com/AfterShip/email-verifier)
(pinned in `go.mod`; license text in
`THIRD_PARTY_LICENSES/AfterShip-email-verifier-MIT.txt`).

## Trust boundary

**Internal-only.** The service has no host `ports:` mapping in
`docker-compose.yml` and must never be exposed publicly. The sole exception is
local development: `docker-compose.override.yml` (auto-loaded in local development) maps it to `127.0.0.1:8080` only
(loopback, unreachable from the network) so host-run processes can call it.
Never deploy with that override. Only the API and the
worker, from inside the Compose network, may call it. Adding a `ports:` entry
for this service is a security regression. Email addresses travel only in
request bodies, never in URLs.

## Endpoints

- `GET /health` → `{"status":"ok"}`
- `POST /verify` → verification result (contract below)

### Request

```json
{ "email": "x@example.com", "smtp": false, "catch_all": false }
```

Malformed JSON, unknown fields, and a missing/empty `email` are rejected
with 400. The body is limited to 4 KiB.

### Response

```json
{
  "email": "x@example.com",
  "syntax": { "valid": true, "username": "x", "domain": "example.com" },
  "mx": { "has_mx": true, "records": ["mx.example.com."], "error": "" },
  "disposable": false,
  "role_account": false,
  "free_provider": false,
  "smtp": {
    "attempted": false,
    "mailbox_accepted": false,
    "catch_all": false,
    "full_inbox": false,
    "disabled": false,
    "error": ""
  },
  "duration_ms": 12
}
```

Contract rules:

- Every field is always present in its object, including false booleans and
  empty error strings.
- `smtp` is `null` exactly when the request had `"smtp": false`.
- `"smtp": true` with `SMTP_ENABLED=false` returns `attempted=false`,
  `disabled=true` and performs **no** network SMTP attempt. When
  `attempted=true`, `disabled` instead reports the provider's
  mailbox-disabled signal.
- `mx.has_mx` is three-valued: `true`/`false` when the lookup succeeded,
  `null` when the lookup itself failed (then `mx.error` is non-empty). A DNS
  failure is never reported as "no MX records".
- `smtp.mailbox_accepted` is a low-level protocol signal (RCPT TO accepted),
  not a delivery promise. Catch-all servers accept everything.
- The SMTP conversation is the engine's own (`smtpprobe.go`), not the
  library's: a random recipient is tried first, and only a `2xx` there means
  `catch_all=true`. A policy refusal (`5.7.x`, blocklists), a `4xx`, or any
  other non-mailbox reply ends the probe with `smtp.error` set to a short
  categorised message such as `probe blocked by the mail server at RCPT
  (catch-all test) (550)` - never a verdict, never the recipient, never the
  server's free text.
- Lookup timeouts return HTTP 200 with the partial results that were safely
  available and a timeout description in `mx.error` / `smtp.error` - never a
  5xx solely because a lookup timed out.

## Environment

| Variable                 | Default                 | Meaning                                     |
| ------------------------ | ----------------------- | ------------------------------------------- |
| `ENGINE_PORT`            | `8080`                  | HTTP listen port (internal)                 |
| `SMTP_ENABLED`           | `false`                 | Process-level switch for SMTP probing       |
| `SMTP_HELO_DOMAIN`       | `localhost`             | EHLO name when probing                      |
| `SMTP_PROBE_FROM`        | `postmaster@localhost`  | MAIL FROM when probing (never logged)       |
| `VERIFY_TIMEOUT_SECONDS` | `15`                    | Total deadline for one `/verify` request    |

SMTP probing runs only when **both** the request asks (`"smtp": true`) and the
process allows (`SMTP_ENABLED=true`). Catch-all probing additionally requires
`"catch_all": true`. Note that most ISPs and cloud providers block outbound
port 25, so `mailbox_accepted` is frequently unavailable even when enabled.

## Privacy

Structured JSON logs contain at most: the domain, a SHA-256 hash of the local
part, duration, and an outcome category. The full email address, raw local
part, `SMTP_PROBE_FROM` value and configuration secrets never appear in logs;
tests capture log output and enforce this.

## Development

```bash
go test ./...                      # unit tests; no live DNS or SMTP
docker compose up -d --build engine
docker compose exec -T engine wget -qO- http://127.0.0.1:8080/health
```

Upstream features deliberately left disabled: Gravatar, SOCKS proxy, vendor
API verifiers, automatic disposable-list updates, domain suggestions.
