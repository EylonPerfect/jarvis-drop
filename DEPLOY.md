# Deploying J.A.R.V.I.S. Command Center to the Hostinger VPS

This deploys the whole stack (Postgres + BFF + Nginx-served web) as one Docker Compose
project, **co-located with hermes-agent** on the same VPS. Nginx is the only public port;
it serves the web build and proxies `/api` (SSE-safe) to the BFF, which talks to hermes
over the Docker host gateway.

```
Internet ─▶ Nginx (:8080)  ─/─▶  static web (SPA)
                           ─/api▶ BFF (:8787) ─▶ hermes gateway (:8642, loopback) ─▶ Nexos/LLM
                                        └─▶ Postgres (compose-internal)
```

---

## 1. Enable the hermes **API server** (one-time, on the VPS)

The Hostinger template's **ADMIN_USERNAME / ADMIN_PASSWORD** are for the **Hermes dashboard**
— they are *not* the API credential this app uses. This app talks to hermes' **OpenAI-compatible
API server** (port 8642), which authenticates with a separate **`API_SERVER_KEY`**.

SSH into the VPS and enable it in `~/.hermes/.env` (create the keys if absent):

```bash
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
# Bind so the Docker bridge gateway can reach it (see step 3). 0.0.0.0 is fine
# ONLY if the VPS firewall blocks 8642 from the public internet.
API_SERVER_HOST=0.0.0.0
API_SERVER_KEY=<generate-a-strong-secret>     # ← this is the app's HERMES_API_KEY
```

Restart the hermes gateway so it picks up the API server (per the template's process
manager, e.g. `hermes gateway` / the container's restart). Verify:

```bash
curl -H "Authorization: Bearer <API_SERVER_KEY>" http://127.0.0.1:8642/health
```

> Nexos AI credits (the "Nexos API Key" in the template) are hermes' **model brain** and are
> configured inside hermes — this app never uses them directly.

> **Firewall:** ensure port **8642 is NOT open to the internet**. It grants the agent's full
> toolset (including terminal). Only the Docker gateway / localhost should reach it.

## 2. Get the app onto the VPS

```bash
git clone <this-repo-url> jarvis && cd jarvis
cp .env.example .env
```

Edit `.env`:

```bash
WEB_PORT=8080                         # public port for the UI (put behind Traefik/HTTPS ideally)
WEB_ORIGIN=http://<vps-ip>:8080       # or https://your-domain
POSTGRES_USER=jarvis
POSTGRES_PASSWORD=<strong-db-password>
POSTGRES_DB=jarvis
HERMES_BASE_URL=http://host.docker.internal:8642
HERMES_API_KEY=<the API_SERVER_KEY from step 1>
HERMES_SESSION_KEY=operator-primary
HERMES_MODEL=hermes
```

## 3. Bring it up

```bash
./scripts/deploy.sh          # builds + starts, waits for /api/health
```

Open `http://<vps-ip>:8080`. `GET /api/health` should report `db:true, hermes:true`.

**How the BFF reaches hermes:** the compose file adds `host.docker.internal:host-gateway`
to the BFF container, so `HERMES_BASE_URL=http://host.docker.internal:8642` resolves to the
VPS host. This requires hermes to listen on an interface the Docker gateway can reach
(hence `API_SERVER_HOST=0.0.0.0` + firewall in step 1). If you prefer strict loopback,
run the BFF with host networking instead and set `HERMES_BASE_URL=http://127.0.0.1:8642`.

## 4. TLS / domain (recommended)

The VPS already runs Traefik (from the hermes template). Point a router at the `web`
container (port 80) for `https://jarvis.your-domain`, and set `WEB_ORIGIN` to that URL.
Otherwise expose `WEB_PORT` directly and use a firewall.

---

## CI/CD (optional, push-to-deploy)

`.github/workflows/ci.yml` runs typecheck + web build + a Postgres migrate/seed smoke test
on every push/PR. `.github/workflows/deploy.yml` SSH-deploys on push to `main` once you set:

- Repo **variable** `DEPLOY_ENABLED=true`
- Repo **secrets** `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PATH` (repo path on the VPS)

## Operations

```bash
docker compose ps                 # status
docker compose logs -f bff        # BFF logs
docker compose exec bff npm --workspace=@jarvis/bff run seed   # re-seed demo data
docker compose down               # stop (keeps the DB volume)
docker compose down -v            # stop + wipe the DB volume
```

## Single-container alternative

For a minimal footprint you can skip Nginx and let the BFF serve the web build itself:
build the web (`npm run build --workspace=@jarvis/web`), set `SERVE_WEB=true` and
`WEB_DIR=/path/to/apps/web/dist`, and run only the BFF + Postgres. Nginx is still the
recommended production topology (static caching, TLS, decoupling).
