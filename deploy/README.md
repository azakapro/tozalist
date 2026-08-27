# Synthetic Preview Deployment

This package runs TozaList on one Docker host behind Caddy. It is limited to a
synthetic-data preview: SMTP remains disabled, payment providers are absent,
legal-page draft banners remain, and real customer data is not authorized.

## Automated local proof

Docker Desktop or a Docker Engine with Compose v2 must be running. This command
uses a uniquely named stack, synthetic credentials, local MinIO, and disposable
volumes. It builds and inspects every image, starts the stack, seeds a one-time
synthetic API key without printing it, runs public smoke checks, creates an S3
backup, restores it to a disposable database, and tears down only that isolated
stack:

```bash
pnpm deploy:verify:runtime
```

`KEEP_STEP91_STACK=true` preserves the isolated verification stack for debugging.
Otherwise teardown includes only the `tozalist-step91-verify` volumes and networks;
it does not touch the normal developer stack or production volumes.

## Host preparation

Use a supported Linux host with current Docker Engine and the Compose v2 plugin,
at least 50 GB of encrypted storage, SSH-key access, and off-host S3-compatible
backup storage. Before enabling UFW, verify the SSH rule and an independent SSH
session so you do not lock yourself out.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose

sudo apt-get update
sudo apt-get install -y fail2ban unattended-upgrades
sudo systemctl enable --now fail2ban unattended-upgrades
```

Disable SSH password authentication only after key login has been tested. Restrict
Docker access to trusted administrators: membership in the `docker` group is
effectively root access.

## DNS and TLS

Create `A`/`AAAA` records pointing to the host for:

- `${DOMAIN}` — public site
- `app.${DOMAIN}` — dashboard
- `api.${DOMAIN}` — API

Only ports 80 and 443 may be reachable from the internet. Caddy obtains and renews
certificates automatically using `ACME_EMAIL`. PostgreSQL, Redis, the engine,
metrics, object storage, and backup services must remain unexposed.

## Production environment

Keep the environment file outside version control and readable only by the deploy
account:

```bash
cp deploy/.env.production.example /secure/path/to/tozalist.production.env
chmod 600 /secure/path/to/tozalist.production.env
```

Fill every empty value. Generate independent random values for the database,
Redis, session, metrics, product-storage, and backup-storage credentials. Product
and backup S3 endpoints must use HTTPS. The backup credential should be scoped to
the dedicated backup bucket/prefix; product storage should use a different bucket
or credential. Keep `SMTP_ENABLED=false`.

Validate before building. The unchanged example must fail because required values
are empty:

```bash
docker compose \
  --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml config --quiet
```

Do not paste the rendered configuration into tickets or logs: it contains expanded
credentials.

## First deployment

Build from a reviewed commit and give the images an immutable release label:

```bash
export IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
docker compose \
  --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml build api worker dashboard web engine postgres-backup
docker compose \
  --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml up -d --wait --wait-timeout 300
docker compose \
  --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml ps
```

The one-shot `migrate` service applies migrations before the API becomes healthy.
Do not run a second migration command concurrently.

For the synthetic preview only, seed the fixed demo organization and 10,000-credit
grant from a private terminal. The command prints a fresh API key once; place it in
your password manager and do not paste it into shell history, chat, or relay files.

```bash
docker compose \
  --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml exec -T api node packages/db/dist/seed.js
```

Run the public smoke test by reading the key silently into the process environment:

```bash
read -r -s SMOKE_API_KEY
export SMOKE_API_KEY
pnpm smoke -- \
  --web-url "https://${DOMAIN}" \
  --api-url "https://api.${DOMAIN}" \
  --dashboard-url "https://app.${DOMAIN}" \
  --engine-url "https://${DOMAIN}:8080/health"
unset SMOKE_API_KEY
```

The smoke fixtures all use `.invalid` addresses and request `smtp: false`. TLS
certificate verification is always enabled for public hosts.

## Updating and rollback

This single-host layout is not truly zero downtime; a rebuild or schema change may
cause a short interruption. Announce a maintenance window, take a verified backup,
then build and recreate services from the reviewed commit:

```bash
export IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
docker compose --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml build api worker dashboard web engine postgres-backup
docker compose --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml up -d --wait --wait-timeout 300
```

For rollback, check out the previously reviewed commit, set its `IMAGE_TAG`, rebuild,
and run the same `up` command. Never roll back across an incompatible database
migration without a separately reviewed recovery plan.

## Backups and restore drills

`postgres-backup` writes a compressed SQL dump daily over authenticated HTTPS to
`BACKUP_S3_BUCKET/BACKUP_S3_PREFIX`. It also writes a weekly copy on Sunday and
prunes the remote destination to the newest 7 daily and 4 weekly objects. Its
health marker is updated only after dump, upload, and remote retention succeed.

Inspect health and local filenames without printing environment variables:

```bash
docker compose --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml ps postgres-backup
docker compose --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml exec -T postgres-backup \
  find /backups -maxdepth 1 -name 'tozalist-*.sql.gz' -type f -print
```

A restore is permitted only to a different database ending in `_restore_drill`.
The script drops/recreates that disposable target, loads the chosen dump, and runs a
query proof. It refuses an empty target, the configured production database, a
non-disposable name, or a mismatched confirmation value.

```bash
export RESTORE_TARGET_DATABASE=tozalist_review_restore_drill
export RESTORE_CONFIRMATION="restore-disposable:${RESTORE_TARGET_DATABASE}"
docker compose --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml exec -T \
  -e RESTORE_TARGET_DATABASE -e RESTORE_CONFIRMATION \
  postgres-backup /usr/local/bin/restore.sh /backups/<reviewed-backup>.sql.gz
unset RESTORE_CONFIRMATION RESTORE_TARGET_DATABASE
```

Production restoration is intentionally not automated by this script. It requires
a separate PM-approved incident plan and an independently verified backup.

## Monitoring and operations

The API metrics route requires the bearer `METRICS_TOKEN` and Caddy returns 404 for
public `/metrics`. Worker metrics bind only to loopback inside its container. A
host-local collector or controlled tunnel can scrape them without publishing a
port. This internal diagnostic expands the token only inside the API container:

```bash
docker compose --env-file /secure/path/to/tozalist.production.env \
  -f docker-compose.prod.yml exec -T api sh -c \
  'wget -qO- --header="Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3001/metrics'
```

Use `docker compose ps` and scoped service logs for diagnosis. Never dump an entire
environment, rendered Compose configuration, database URL, authorization header,
or storage endpoint with credentials into logs.

## SMTP and real-data boundary

With `SMTP_ENABLED=false`, the preview performs offline/synthetic checks only and
does not probe recipient mailboxes. Outbound port 25 is not required for this
preview. Enabling SMTP, processing real customer data, changing legal/privacy
policy, deploying a payment provider, or performing a production restore requires
an explicit PM decision outside this package.
