#!/usr/bin/env bash
# ============================================================================
# Incident detector tick (CLAUDE.md BATCH 4). Calls the BFF's incident-scan
# endpoint, which runs the cost-runaway + bail-out/report-spike detectors and
# fires alerts (deduped). Runs out-of-process so the BFF keeps zero background
# timers. Schedule via cron:
#
#     */10 * * * * /root/jarvis-work/ops/scripts/incident_scan.sh >> /root/cron-logs/incident_scan.log 2>&1
#
# --- OPS COPY (fixed for prod host cron) -----------------------------------
# Divergence from /root/jarvis-new/scripts/incident_scan.sh (flagged, live not
# edited):
#   1. BFF is on the docker network only (container port 8787 is NOT published
#      to the host), so http://localhost:8787 is unreachable from the host/cron.
#      Resolve the bff container IP on the jarvis-new_default network at runtime
#      (survives container restarts — looked up fresh each tick).
#   2. The BFF's global onRequest gate (access-code mode) requires the baseline
#      X-API-Key: $BFF_API_KEY on EVERY /api request; /api/admin/incident-scan
#      is not exempt. The original sent only X-Superadmin-Key -> always 401
#      {"error":"unauthorized"}. We now send BOTH X-API-Key and X-Superadmin-Key.
#   3. Load secrets from ENV_FILE (default ops/.env) so cron needs no inline env,
#      and use absolute /usr/bin paths (cron PATH is minimal).
# ============================================================================
set -euo pipefail

DOCKER="${DOCKER:-/usr/bin/docker}"
CURL="${CURL:-/usr/bin/curl}"
ENV_FILE="${ENV_FILE:-/root/jarvis-work/ops/.env}"
BFF_CONTAINER="${BFF_CONTAINER:-jarvis-new-bff-1}"
BFF_NETWORK="${BFF_NETWORK:-jarvis-new_default}"

# Load BFF_API_KEY + SUPERADMIN_API_KEY (only if not already in env).
if [ -z "${SUPERADMIN_API_KEY:-}" ] || [ -z "${BFF_API_KEY:-}" ]; then
  if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
fi
: "${SUPERADMIN_API_KEY:?set SUPERADMIN_API_KEY (or provide ENV_FILE)}"
: "${BFF_API_KEY:?set BFF_API_KEY (baseline BFF gate) (or provide ENV_FILE)}"

# Resolve the bff on the docker network unless BFF_URL is explicitly overridden.
if [ -z "${BFF_URL:-}" ]; then
  BFF_IP="$("$DOCKER" inspect -f "{{(index .NetworkSettings.Networks \"$BFF_NETWORK\").IPAddress}}" "$BFF_CONTAINER" 2>/dev/null || true)"
  [ -n "$BFF_IP" ] || { echo " [$(date -u +%FT%TZ)] scan FAILED: cannot resolve $BFF_CONTAINER IP on $BFF_NETWORK"; exit 1; }
  BFF_URL="http://$BFF_IP:8787"
fi

"$CURL" -fsS -m 20 -X POST "$BFF_URL/api/admin/incident-scan" \
  -H "X-API-Key: $BFF_API_KEY" \
  -H "X-Superadmin-Key: $SUPERADMIN_API_KEY" \
  -H "Content-Type: application/json" -d "{}" \
  && echo " [$(date -u +%FT%TZ)] scan ok" \
  || { echo " [$(date -u +%FT%TZ)] scan FAILED"; exit 1; }
