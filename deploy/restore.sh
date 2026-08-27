#!/usr/bin/env bash
set -Eeuo pipefail

backup_file="${1:-}"
target="${RESTORE_TARGET_DATABASE:-}"
production="${POSTGRES_DB:-}"
confirmation="${RESTORE_CONFIRMATION:-}"

for name in POSTGRES_HOST POSTGRES_PORT POSTGRES_USER PGPASSWORD POSTGRES_DB; do
  if [[ -z "${!name:-}" ]]; then
    printf 'restore refused: required variable %s is missing\n' "$name" >&2
    exit 1
  fi
done
if [[ -z "$target" || "$target" == "$production" || ! "$target" =~ _restore_drill$ ]]; then
  printf 'restore refused: target must be a non-production database ending in _restore_drill\n' >&2
  exit 1
fi
if [[ "$confirmation" != "restore-disposable:${target}" ]]; then
  printf 'restore refused: RESTORE_CONFIRMATION does not exactly match the disposable target\n' >&2
  exit 1
fi
if [[ -z "$backup_file" || ! -f "$backup_file" || ! -s "$backup_file" ]]; then
  printf 'restore refused: a nonempty local gzip backup file is required\n' >&2
  exit 1
fi

dropdb --if-exists \
  --host "$POSTGRES_HOST" --port "$POSTGRES_PORT" --username "$POSTGRES_USER" \
  "$target"
createdb \
  --host "$POSTGRES_HOST" --port "$POSTGRES_PORT" --username "$POSTGRES_USER" \
  "$target"
gzip -dc "$backup_file" | psql \
  --host "$POSTGRES_HOST" --port "$POSTGRES_PORT" --username "$POSTGRES_USER" \
  --dbname "$target" --set ON_ERROR_STOP=on --quiet
psql \
  --host "$POSTGRES_HOST" --port "$POSTGRES_PORT" --username "$POSTGRES_USER" \
  --dbname "$target" --set ON_ERROR_STOP=on --tuples-only --command 'select 1' \
  | grep -q '1'
printf 'restore drill completed and target query succeeded\n'
