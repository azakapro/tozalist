# CTO Report — Step 9.2 correction

- Step: `9.2` — Beta onboarding kit (PM correction cycle)
- Branch: `feat/beta-onboarding-kit`, from exact `origin/main` `1660a833e05bfaca98577f83de47915d96479a3c`
- HEAD: `1660a833e05bfaca98577f83de47915d96479a3c` (no commits made)
- Date: 2026-08-27
- Result: `CORRECTION_COMPLETE_AWAITING_PM_REVIEW`
- Git/external state: nothing committed, staged, pushed, PR'd, merged, or deployed

## Outcome

All three PM corrections are applied, each verified against the actual product contract it conflicted with. Only the three named documents changed; the other three kit documents and the exact nine-path scope are preserved. All six original Step 9.2 checks pass again.

## PM corrections applied (2026-08-27)

### 1. Runbook: nonexistent lead inbox → real PostgreSQL lead-review workflow

`docs/beta/first-14-days-runbook.md` no longer assumes any inbox, notification, or lead UI. Changes:

- The daily-loop line "check the pilot form inbox … reply to every new request" now points to a new "Reviewing pilot-form leads (the only supported workflow)" section; Day 1's "confirm it arrives" now says to confirm the stored row via that same workflow and to mark the synthetic test row's `id` in the tracker so it is never counted (it is removed by the retention sweep — no manual deletion instruction). Day 10's unrelated "commitment the moment it arrives" was rephrased to "is received" so no "arriving" phrasing remains anywhere.
- The new section states the facts first: a submission is stored as a row in the production PostgreSQL `leads` table and nothing else happens — no email notification, lead inbox, or dashboard view. Review happens from a restricted server terminal using Compose v2 with `--env-file /secure/path/to/tozalist.production.env` and `-f docker-compose.prod.yml`, matching `deploy/README.md`'s existing command contract verbatim.
- The command: `docker compose … exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, created_at, source, locale, email, company, phone, message FROM leads WHERE deleted_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 50;"'`. The single-quoted `sh -c` makes `POSTGRES_USER`/`POSTGRES_DB` expand inside the container only, so no environment value or credential appears on screen or in host shell history; the connection uses the container's local socket. The result set is limited (LIMIT 50) and excludes soft-deleted (`deleted_at IS NULL`) and expired (`expires_at > now()`) rows — only active, unexpired leads.
- Privacy rules are explicit: the output is personal data, read in place; never copied into chat, relay files, source control, analytics, spreadsheets, or the tracker; no `echo` of connection strings, no `env`/`printenv`. The daily tracker records only the lead's `id` (UUID), date, `source`/`locale`, and pipeline status — raw contact fields never leave the database; replies are written directly in a mail/messaging client from the terminal view.
- Explicit no-build rule: no export scripts, notification hooks, or admin UI; outgrowing the 50-row view is a PM product decision, not a runbook workaround.

### 2. Onboarding checklist: retention restricted to the supported `7/30/90`

`docs/beta/onboarding-checklist.md` section 5 replaced the unrestricted `____ days` blank with exactly three checkboxes — `7`, `30` (marked as product default), `90` — and states the product accepts no other value, naming 45/60/180 as examples that cannot be set. The unverifiable "product default 30 days" parenthetical claim moved from prose into the option list where it is checkable.

### 3. Interview script: truthful, narrow opening

The verbatim opening no longer says "Everything stays between us". It now says: "I'll take notes and use them internally as research for what we build; and please don't share any actual customer data with me — counts and rough numbers are all I need." This describes exactly the two real facts (internal research-note use; the no-customer-data rule) and promises no confidentiality, secrecy, deletion, legal status, or data handling beyond current practice.

## Required verification

### 1. Corrected commands re-read against the actual contracts — `PASS`

- `docker-compose.prod.yml`: the `postgres` service (postgres:16-alpine) defines `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` in its environment; the runbook command `exec`s that exact service name and references only `POSTGRES_USER`/`POSTGRES_DB`, never the password. The `--env-file /secure/path/to/tozalist.production.env` + `-f docker-compose.prod.yml` form matches `deploy/README.md` exactly.
- `packages/db/src/schema/leads.ts`: every column in the query (`id`, `created_at`, `source`, `locale`, `email`, `company`, `phone`, `message`, `deleted_at`, `expires_at`) exists in the schema. The SELECT was additionally executed verbatim against the local test database (which carries the real migrated schema): it ran successfully and returned 8 fixture rows — proof of syntax and column validity, not just a read-through.
- Retention contract: `apps/api/src/internal/routes.ts:61` `RETENTION_CHOICES = new Set([7, 30, 90])` (enforced at :476) and `apps/dashboard/app/settings/page.tsx:10` `RETENTION_OPTIONS = [7, 30, 90]` — the checklist now offers exactly these three values with 30 as default.

### 2. Runbook forbidden-content check — `PASS`

Grep across the corrected runbook: the only occurrences of "inbox"/"notification"/"admin UI" are the factual negations stating those things do not exist and must not be built (mirroring the PM's own correction text); zero instructions print credentials or environment values; zero instructions copy raw personal data anywhere; no invented UI or API is referenced. No "arriving/arrives" phrasing about submissions remains.

### 3. The six original Step 9.2 checks — all `PASS`

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Exact path set, no out-of-scope diff | `PASS` | `git status --porcelain`: exactly `M` on the three relay records + untracked `docs/beta/` containing only the six authorized files. |
| 2 | No `TODO`/`TBD`/placeholder/secret/raw-personal-data/claim | `PASS` | Case-insensitive grep across `docs/beta/`: zero hits. |
| 3 | Coverage and cross-reference consistency | `PASS` | All intra-kit links machine-checked, 0 broken; the new runbook section changes no cross-document definitions. |
| 4 | `pnpm secret-scan` | `PASS` | Exit 0; `secret scan: clean (402 files)`. |
| 5 | `pnpm format:check` | `PASS` | Exit 0; all files match Prettier style (the three corrected files were re-formatted through Prettier). |
| 6 | `git diff --check` | `PASS` | Exit 0 including the new files (via intent-to-add, then unstaged; worktree returned to the exact state in check 1). |

## Drift and scope

- Only `docs/beta/first-14-days-runbook.md`, `docs/beta/onboarding-checklist.md`, `docs/beta/interview-script.md`, and the relay records changed in this correction; `accuracy-measurement.md`, `weekly-report-template.md`, and `stop-criteria.md` are byte-identical to the reviewed versions.
- No product code, configuration, dependency, lockfile, schema, migration, or deployment file changed. The one temporary SQL-validation script ran from the scratchpad/`packages/db` and was deleted; it does not appear in the worktree.
- 0 commits ahead of `origin/main`; nothing staged; branch local-only.

## Next action

PM reviews the corrected three documents and this evidence. Step 9.2 remains the final roadmap step; the Phase 9 Git handoff and the `complete` transition are PM decisions after approval.
