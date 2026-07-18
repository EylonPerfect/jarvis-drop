#!/usr/bin/env bash
# ============================================================================
# Automated Postgres backup for After Human (CLAUDE.md BATCH 4: "automated DB
# backups + tested restore"). Runs pg_dump inside the DB container in custom
# format (-Fc, compressed, restorable with pg_restore), rotates old dumps, and
# writes a checksum. Schedule via cron (see BACKUP-RESTORE.md).
#
#   Cron (daily 03:15, keep 14 days):
#     15 3 * * * /root/jarvis-work/p10/scripts/pg_backup.sh >> /var/log/ah-backup.log 2>&1
#
# Env overrides:
#   PG_CONTAINER (default jarvis-new-db-1)
#   PG_USER      (default jarvis)
#   PG_DB        (default jarvis)
#   BACKUP_DIR   (default /root/backups/postgres)
#   RETAIN_DAYS  (default 14)
#   OFFSITE_CMD  (optional: a command receiving the dump path as $1, e.g. an
#                rclone/scp push — off-box copy so a host loss is survivable)
# ============================================================================
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-jarvis-new-db-1}"
PG_USER="${PG_USER:-jarvis}"
PG_DB="${PG_DB:-jarvis}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/postgres}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/${PG_DB}_${ts}.dump"
tmp="/tmp/ah_backup_${ts}.dump"   # staged inside the container

echo "[$(date -u +%FT%TZ)] backing up $PG_DB from $PG_CONTAINER -> $out"
# -Fc = custom format (compressed, selective restore). Dump to a file INSIDE the
# container, verify it there with `pg_restore --list` (a corrupt dump fails to
# list), then copy it out. (Piping --list over docker stdin mis-reads the header,
# so we verify against a real in-container path.)
docker exec "$PG_CONTAINER" sh -c "pg_dump -U '$PG_USER' -d '$PG_DB' -Fc -f '$tmp' && pg_restore --list '$tmp' > /dev/null" \
  || { echo "ERROR: dump or verification failed"; docker exec "$PG_CONTAINER" rm -f "$tmp" 2>/dev/null || true; exit 1; }
docker cp "$PG_CONTAINER:$tmp" "$out"
docker exec "$PG_CONTAINER" rm -f "$tmp" 2>/dev/null || true

# integrity: sha256 + magic-header smoke (custom-format dumps start with "PGDMP")
sha256sum "$out" > "$out.sha256"
head -c 5 "$out" | grep -q "PGDMP" \
  && echo "[$(date -u +%FT%TZ)] dump verified (TOC listed + PGDMP header), $(du -h "$out" | cut -f1)" \
  || { echo "ERROR: dump failed header check"; exit 1; }

# optional off-box copy
if [ -n "${OFFSITE_CMD:-}" ]; then
  echo "[$(date -u +%FT%TZ)] offsite: $OFFSITE_CMD $out"
  eval "$OFFSITE_CMD \"$out\"" || echo "WARN: offsite copy failed (local dump kept)"
fi

# rotation
find "$BACKUP_DIR" -name "${PG_DB}_*.dump" -mtime +"$RETAIN_DAYS" -print -delete || true
find "$BACKUP_DIR" -name "${PG_DB}_*.dump.sha256" -mtime +"$RETAIN_DAYS" -delete || true

echo "[$(date -u +%FT%TZ)] backup complete"
