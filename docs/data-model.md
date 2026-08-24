# Data model

The schema lives in [`packages/db/src/schema`](../packages/db/src/schema), one
file per table, and is the source of truth for the SQL in
[`packages/db/drizzle`](../packages/db/drizzle). Never edit a generated
migration that has already been applied — change the schema and generate a new
one with `pnpm db:generate`.

Conventions across every table: UUID primary keys (`gen_random_uuid()`),
`timestamp with time zone` for every point in time, explicit foreign keys, and
`NOT NULL` unless the column genuinely means "unknown".

## Tables

| Table                | Owned by     | Holds                                           | Retention                             |
| -------------------- | ------------ | ----------------------------------------------- | ------------------------------------- |
| `organizations`      | —            | Customer account, `retention_days`, SMTP opt-in | `deleted_at` (soft delete)            |
| `users`              | organization | Dashboard sign-in, Argon2id hash, TOTP secret   | `deleted_at`, cascade from org        |
| `api_keys`           | organization | SHA-256 key hash + display prefix               | `revoked_at`, `expires_at`, cascade   |
| `credit_ledger`      | organization | Append-only credit movements                    | **none by design** (financial record) |
| `email_checks`       | organization | Per-address verdicts and evidence               | `expires_at`, cascade                 |
| `phone_checks`       | organization | Per-number format verdicts                      | `expires_at`, cascade                 |
| `batches`            | organization | Uploaded list state + object storage keys       | `expires_at`, cascade                 |
| `webhook_endpoints`  | organization | Callback URL and signing secret                 | `deleted_at`, cascade                 |
| `webhook_deliveries` | endpoint     | Attempt log and payload                         | `expires_at`, cascade from endpoint   |
| `audit_events`       | organization | Who did what to which object                    | `expires_at`; actors `set null`       |
| `leads`              | —            | Public form submissions                         | `expires_at` + `deleted_at`           |

Enums: `user_role`, `credit_reason`, `email_verdict`, `batch_status`,
`webhook_delivery_status`, `lead_source`.

## The credit ledger is append-only

A balance is always `SUM(delta)` over `credit_ledger`, computed by
`getCreditBalance()`. There is no balance column anywhere in the schema, and
adding one would create a second source of truth that can silently drift.

The rule is enforced by the database, not by convention. Migration
`0001_append_only_credit_ledger` installs triggers that reject `UPDATE`,
`DELETE` and `TRUNCATE` on the table. A mistaken grant is corrected by appending
an `adjustment` or `refund` entry.

`reference_id` names the operation that caused a movement. A partial unique
index on `(org_id, reference_id) WHERE reference_id IS NOT NULL` makes replaying
that operation a no-op instead of a second charge — this is what stops repeated
seed runs from granting credits twice, and it is enforced at insert time rather
than by a check-then-insert that could race.

`credit_ledger.org_id` is `ON DELETE RESTRICT`, so a hard organisation delete
cannot quietly erase the money trail. Organisations are soft-deleted instead.

## Retention

Every table that holds personal, customer-owned or customer-generated data has
an explicit expiry or deletion path, listed above — including tables nothing
writes to yet. `organizations.retention_days` (default 30) is what future
sweepers use to set `expires_at` on child rows.

Two things the sweeper will have to do beyond deleting rows:

- `batches` rows point at objects in S3/MinIO. The object is customer data too,
  so `input_object_key` and `result_object_key` must be deleted alongside the row.
- `audit_events` keeps actor references as `SET NULL` rather than cascading:
  deleting a user must not erase the record that something happened.

## Secrets

- API keys: only `sha256(key)` and a 12-character display prefix are stored. The
  plaintext is shown once at creation and is unrecoverable afterwards.
- Passwords: Argon2id (`$argon2id$…`), never reversible, never plaintext.
- `users.mfa_secret` and `webhook_endpoints.secret` must never be logged,
  returned by an API response, or copied into `audit_events.metadata`.

## Not implemented at step 0.2

Schema only. No API endpoints, authentication, validation, jobs, uploads,
webhook delivery, billing, or dashboard features — and no carrier, HLR, owner,
enrichment or live-status data in `phone_checks`.
