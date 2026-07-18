# Database Backups & Restore — After Human

Automated `pg_dump` backups + a **tested** restore procedure (CLAUDE.md BATCH 4).

## Backups
`scripts/pg_backup.sh` dumps the live `jarvis` DB from inside the `jarvis-new-db-1`
container in custom format (`-Fc`: compressed, selectively restorable), verifies
each dump (`sha256` + `pg_restore --list` smoke), rotates by age, and optionally
pushes off-box.

**Schedule (cron):**
```
15 3 * * * /root/jarvis-work/p10/scripts/pg_backup.sh >> /var/log/ah-backup.log 2>&1
```
Defaults: `BACKUP_DIR=/root/backups/postgres`, `RETAIN_DAYS=14`. Off-box copy:
set `OFFSITE_CMD` (e.g. `rclone copy` / `scp`) so a host loss is survivable — a
backup that only lives on the same box is not a real backup.

## Tested restore (sandbox)
`scripts/pg_restore_test.sh [dump]` restores the newest (or a named) dump into
`jarvis_p10test` and verifies table/row counts. It **refuses** to target the live
DB. Run it regularly so the restore path is proven, not assumed:
```
scripts/pg_restore_test.sh
# → recreates jarvis_p10test, pg_restore, prints row counts, asserts >0 tables
```

## Real disaster recovery (production restore — documented, run deliberately)
Guardrails forbid running this against live here; this is the procedure:
1. Stop the app so nothing writes mid-restore: `docker compose stop bff`
   (law 1: ensure no un-ended live call — `GET /api/live/status`).
2. Recreate + restore:
   ```
   docker exec -i jarvis-new-db-1 psql -U jarvis -d postgres \
     -c "DROP DATABASE jarvis WITH (FORCE); CREATE DATABASE jarvis;"
   docker exec -i jarvis-new-db-1 pg_restore -U jarvis -d jarvis --no-owner < DUMP
   ```
3. Bring the app back: `docker compose up -d bff`. Schema is idempotent
   (migrate-on-boot re-applies `CREATE TABLE IF NOT EXISTS`).
4. Verify: `GET /api/health` (db:true), spot-check row counts, confirm a clone loads.

## RPO / RTO
- **RPO** ≈ 24h with the daily cron (tighten by scheduling more often / WAL archiving later).
- **RTO** ≈ minutes (custom-format restore of this DB size), plus app restart.
