#!/usr/bin/env bash
# One-command deploy for the J.A.R.V.I.S. Command Center stack.
# Run on the VPS from the repo root:  ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

# Load WEB_PORT for the health check (default 8080).
WEB_PORT="$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || true)"
WEB_PORT="${WEB_PORT:-8080}"

echo "▶ Pulling latest…"
git pull --ff-only || echo "  (skipped git pull)"

echo "▶ Building & starting containers…"
docker compose up -d --build

echo "▶ Waiting for health at http://localhost:${WEB_PORT}/api/health …"
for i in $(seq 1 40); do
  if curl -fsS "http://localhost:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    echo -n "  health: "; curl -s "http://localhost:${WEB_PORT}/api/health"; echo
    echo "✅ Up. Open http://<vps-ip>:${WEB_PORT}"
    exit 0
  fi
  sleep 3
done

echo "❌ Health check timed out. Recent logs:" >&2
docker compose logs --tail=60
exit 1
