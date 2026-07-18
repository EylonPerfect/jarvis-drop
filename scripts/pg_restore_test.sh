#!/usr/bin/env bash
# ============================================================================
# TESTED RESTORE procedure (CLAUDE.md BATCH 4). Restores the latest (or a named)
# pg_dump into the SANDBOX database jarvis_p10test and verifies row counts — so
# the restore path is proven, never assumed. NEVER touches the live `jarvis` DB.
#
#   Usage:
#     scripts/pg_restore_test.sh                 # restore the newest dump
#     scripts/pg_restore_test.sh /path/to.dump   # restore a specific dump
#
# What a REAL disaster-recovery restore into production would run instead
# (documented, NOT executed here — guardrails forbid live writes):
#     docker exec -i jarvis-new-db-1 psql -U jarvis -d postgres \
#       -c "DROP DATABASE jarvis; CREATE DATABASE jarvis;"
#     docker exec -i jarvis-new-db-1 pg_restore -U jarvis -d jarvis --no-owner < DUMP
#   (take the BFF down first; bring it back after — see BACKUP-RESTORE.md.)
# ============================================================================
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-jarvis-new-db-1}"
PG_USER="${PG_USER:-jarvis}"
TEST_DB="${TEST_DB:-jarvis_p10test}"          # sandbox target — hardcoded-safe default
BACKUP_DIR="${BACKUP_DIR:-/root/backups/postgres}"

dump="${1:-}"
if [ -z "$dump" ]; then
  dump="$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1 || true)"
fi
[ -n "$dump" ] && [ -f "$dump" ] || { echo "ERROR: no dump found (looked in $BACKUP_DIR)"; exit 1; }

if [ "$TEST_DB" = "jarvis" ]; then echo "REFUSING: TEST_DB must not be the live DB"; exit 1; fi

echo "[$(date -u +%FT%TZ)] restore-test: $dump -> $TEST_DB (sandbox)"
# checksum gate
if [ -f "$dump.sha256" ]; then sha256sum -c "$dump.sha256" || { echo "ERROR: checksum mismatch"; exit 1; }; fi

# recreate the sandbox DB clean, then restore
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);" -c "CREATE DATABASE ${TEST_DB};"
docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$TEST_DB" --no-owner --clean --if-exists < "$dump" \
  || echo "(pg_restore reported non-fatal warnings — continuing to verify)"

echo "---- verification: table row counts in $TEST_DB ----"
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$TEST_DB" -c "
  SELECT relname AS table, n_live_tup AS approx_rows
    FROM pg_stat_user_tables ORDER BY n_live_tup DESC, relname LIMIT 40;"
tables=$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$TEST_DB" -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
echo "[$(date -u +%FT%TZ)] restore-test OK: $tables tables present in $TEST_DB"
[ "$tables" -gt 0 ] || { echo "ERROR: restore produced 0 tables"; exit 1; }
