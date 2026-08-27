#!/usr/bin/env bash
set -Eeuo pipefail

required=(
  POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_DB PGPASSWORD
  BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET BACKUP_S3_PREFIX
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'backup refused: required variable %s is missing\n' "$name" >&2
    exit 1
  fi
done

case "$BACKUP_S3_ENDPOINT" in
  https://*) ;;
  http://minio:9000)
    if [[ "${BACKUP_ALLOW_INSECURE_LOCAL:-false}" != 'true' ]]; then
      printf 'backup refused: BACKUP_S3_ENDPOINT must use HTTPS\n' >&2
      exit 1
    fi
    ;;
  *)
    printf 'backup refused: BACKUP_S3_ENDPOINT must use HTTPS\n' >&2
    exit 1
    ;;
esac

backup_dir="${BACKUP_DIR:-/backups}"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
daily_name="tozalist-${timestamp}.sql.gz"
daily_file="${backup_dir}/${daily_name}"
daily_key="${BACKUP_S3_PREFIX%/}/daily/${daily_name}"

umask 077
pg_dump \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --no-owner \
  --no-privileges \
  | gzip -9 >"$daily_file"
test -s "$daily_file"

aws_args=(--endpoint-url "$BACKUP_S3_ENDPOINT" --region "$BACKUP_S3_REGION")
aws "${aws_args[@]}" s3 cp --only-show-errors "$daily_file" "s3://${BACKUP_S3_BUCKET}/${daily_key}"

if [[ "$(date -u +%u)" == '7' ]]; then
  weekly_key="${BACKUP_S3_PREFIX%/}/weekly/${daily_name}"
  aws "${aws_args[@]}" s3 cp --only-show-errors "$daily_file" "s3://${BACKUP_S3_BUCKET}/${weekly_key}"
fi

prune_remote() {
  local kind="$1"
  local keep="$2"
  local prefix="${BACKUP_S3_PREFIX%/}/${kind}/"
  local keys
  keys="$(aws "${aws_args[@]}" s3api list-objects-v2 \
    --bucket "$BACKUP_S3_BUCKET" \
    --prefix "$prefix" \
    --query 'Contents[].Key' \
    --output text)"

  printf '%s\n' "$keys" \
    | tr '\t' '\n' \
    | sed '/^None$/d;/^[[:space:]]*$/d' \
    | LC_ALL=C sort -r \
    | tail -n "+$((keep + 1))" \
    | while IFS= read -r key; do
        aws "${aws_args[@]}" s3 rm --only-show-errors "s3://${BACKUP_S3_BUCKET}/${key}"
      done
}

prune_remote daily 7
prune_remote weekly 4

find "$backup_dir" -type f -name 'tozalist-*.sql.gz' -mtime +7 -delete
touch "${backup_dir}/.last-backup"
printf 'backup completed: daily upload and remote retention succeeded\n'
