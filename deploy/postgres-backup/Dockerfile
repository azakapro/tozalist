# syntax=docker/dockerfile:1
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli bash gzip \
  && mkdir -p /backups \
  && chown postgres:postgres /backups
COPY --chown=postgres:postgres backup.sh restore.sh /usr/local/bin/
RUN chmod 0555 /usr/local/bin/backup.sh /usr/local/bin/restore.sh
USER postgres
VOLUME ["/backups"]
HEALTHCHECK --interval=1h --timeout=5s --start-period=2m --retries=2 \
  CMD test -f /backups/.last-backup && test "$(find /backups/.last-backup -mmin -1500 | wc -l)" -eq 1
ENTRYPOINT ["/bin/bash", "-c"]
CMD ["while /usr/local/bin/backup.sh; do sleep 86400; done; exit 1"]
