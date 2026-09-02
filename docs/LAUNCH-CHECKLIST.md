# Launch checklist — public synthetic-data preview

Goal: `tozalist.uz`, `app.tozalist.uz`, and `api.tozalist.uz` live on one VPS,
running the production Compose stack with synthetic data only. Legal pages keep
their DRAFT banner; `SMTP_ENABLED=false`; no real customer lists.

Every command below is already documented in `deploy/README.md`; this file is
the ordered path through it, plus the purchases you need to make first.

## 0. What to buy (about 30 minutes, all self-service)

| Item                   | Recommendation                                                                                                                                                                                     | Why                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS                    | Hetzner Cloud **CPX31** (4 vCPU, 8 GB RAM, 160 GB disk), Ubuntu 24.04, Falkenstein or Helsinki. Add your SSH public key at creation. Enable the free Hetzner firewall with only 22/80/443 inbound. | The stack runs 9 containers plus image builds on the host; 4 GB hosts swap during `next build`. Hetzner has stable outbound networking and cheap object storage. |
| Product object storage | Hetzner **Object Storage** bucket `tozalist-prod` in the same region, one S3 credential pair. Endpoint `https://<region>.your-objectstorage.com`.                                                  | Holds batch input/result CSVs and data exports. Must be HTTPS and off-host.                                                                                      |
| Backup object storage  | A **second** bucket `tozalist-backups` with a **separate** credential pair (or Backblaze B2 for provider diversity).                                                                               | `deploy/backup.sh` requires a dedicated `BACKUP_S3_*` credential; sharing the product credential is rejected by the README contract.                             |
| Domain                 | You already control `tozalist.uz`. You need DNS access to create three `A` records.                                                                                                                | Caddy issues Let's Encrypt certificates automatically once DNS resolves to the host.                                                                             |

Alternatives if Hetzner cannot bill you: DigitalOcean (Frankfurt, 4 vCPU/8 GB
droplet + Spaces) or Vultr (Frankfurt). Uzbek providers (UZINFOCOM, Beeline
Cloud) work for the compute but rarely offer S3-compatible storage; pair them
with Backblaze B2 if you go that way.

Port 25 is blocked by default on all of these; that is fine, `SMTP_ENABLED`
stays `false` for the preview.

## 1. DNS (do this first; propagation runs while you provision)

Create these `A` records pointing to the VPS IPv4 (add `AAAA` if you enable
IPv6):

| Name  | Value      | TTL |
| ----- | ---------- | --- |
| `@`   | `<VPS IP>` | 300 |
| `app` | `<VPS IP>` | 300 |
| `api` | `<VPS IP>` | 300 |

Do **not** add a record for the engine, Postgres, Redis, or metrics; they are
never exposed.

## 2. Host preparation (README "Host preparation")

SSH in as root or a sudo user with your key, then:

```bash
apt-get update && apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
usermod -aG docker "$USER"
```

Then run the UFW / fail2ban / unattended-upgrades block from
`deploy/README.md` exactly as written. Test a second SSH session before
`ufw enable`. Disable SSH password auth only after key login works.

## 3. Clone and configure

```bash
git clone https://github.com/azakapro/tozalist.git /opt/tozalist
cd /opt/tozalist
mkdir -p /secure && chmod 700 /secure
cp deploy/.env.production.example /secure/tozalist.production.env
chmod 600 /secure/tozalist.production.env
```

Fill every value in `/secure/tozalist.production.env`. Generate each secret
independently:

```bash
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48
```

Required values and where they come from:

| Variable                                                                                                                         | Source                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `DOMAIN`                                                                                                                         | `tozalist.uz`                                             |
| `ACME_EMAIL`                                                                                                                     | an address you read; Let's Encrypt expiry notices go here |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                                                                              | choose; password generated                                |
| `REDIS_PASSWORD`, `SESSION_SECRET`, `METRICS_TOKEN`                                                                              | generated, each different                                 |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                                        | product bucket credential                                 |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` | backup bucket credential (different from product)         |
| `SMTP_ENABLED`                                                                                                                   | `false`                                                   |
| `VERIFY_TIMEOUT_SECONDS`                                                                                                         | `15`                                                      |

Validate (must succeed only after every value is filled):

```bash
docker compose --env-file /secure/tozalist.production.env -f docker-compose.prod.yml config --quiet
```

## 4. First deployment (README "First deployment")

```bash
export IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
docker compose --env-file /secure/tozalist.production.env -f docker-compose.prod.yml build api worker dashboard web engine postgres-backup
docker compose --env-file /secure/tozalist.production.env -f docker-compose.prod.yml up -d --wait --wait-timeout 300
docker compose --env-file /secure/tozalist.production.env -f docker-compose.prod.yml ps
```

Expect every service `healthy`. The `migrate` one-shot runs before the API.
Caddy needs DNS to resolve to this host to obtain certificates; if `ps` shows
Caddy healthy but HTTPS fails, wait for DNS and check
`docker compose ... logs caddy`.

## 5. Seed the synthetic demo org and smoke-test

```bash
docker compose --env-file /secure/tozalist.production.env -f docker-compose.prod.yml exec -T api node packages/db/dist/seed.js
```

The API key is printed once. Put it in your password manager. Then, from your
laptop (needs `pnpm install` in the repo):

```bash
read -r -s SMOKE_API_KEY; export SMOKE_API_KEY
pnpm smoke -- --web-url https://tozalist.uz --api-url https://api.tozalist.uz --dashboard-url https://app.tozalist.uz --engine-url https://tozalist.uz:8080/health
unset SMOKE_API_KEY
```

All checks must pass, including "engine not publicly reachable".

## 6. Prove backup and restore once (README "Backups and restore drills")

Trigger one backup run, list the bucket, and run the disposable-database
restore drill exactly as documented. Do not skip this: it is the only proof
that the backup credential and bucket policy work.

## 7. Done criteria for "live preview"

- [ ] `https://tozalist.uz/uz`, `/ru`, `/en` return 200 with valid TLS
- [ ] `https://app.tozalist.uz/login` loads; signup creates an org; MFA enrolls
- [ ] `https://api.tozalist.uz/docs` renders; `pnpm smoke` passes
- [ ] `https://tozalist.uz:8080` and `api.tozalist.uz/metrics` are unreachable from outside
- [ ] One backup object exists in the backup bucket; restore drill passed
- [ ] Pilot form submission creates a `leads` row (verify with the runbook query in `docs/beta/first-14-days-runbook.md`)

## What stays closed after launch (business gates, not code)

| Gate                    | Owner | Unblocks                                                                       |
| ----------------------- | ----- | ------------------------------------------------------------------------------ |
| Uzbek legal review      | you   | flip `LEGAL_PAGES_DRAFT` in `apps/web/lib/site-config.ts`; real customer lists |
| Legal entity + merchant | you   | Click/Payme per `TODO-PAYMENTS.md`; until then invoices + `pnpm billing:grant` |
| Port 25 unblock request | you   | `SMTP_ENABLED=true` for mailbox probing (optional; product works without it)   |
