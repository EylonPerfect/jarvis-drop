# J.A.R.V.I.S. Command Center — full-stack app

This repo contains the **implemented** J.A.R.V.I.S. Command Center: a pixel-faithful
port of the Claude Design prototype into a real, buildable full-stack app, wired to a
live backend.

- **`apps/web`** — Vite + React + TypeScript frontend. All 11 screens + the About and
  Agent Builder modals, ported 1:1 from the design (same tokens, same HUD components).
- **`apps/bff`** — Fastify + TypeScript **backend-for-frontend**. Owns a Postgres store
  for the domains hermes doesn't model, and proxies **hermes-agent** (NousResearch,
  deployed on a Hostinger VPS) for chat, runs, jobs, sessions, models, skills & health.
- **`packages/shared`** — TypeScript types shared by both.

> The original design export is preserved untouched under `project/` and `chats/`.
> `README.md` (repo root) is the Claude Design handoff note.

---

## Architecture

```
Browser (React)  ──HTTP/SSE──▶  BFF (Fastify)  ──HTTP/SSE──▶  hermes-agent gateway  ──▶  swappable LLM
                                     │                          (127.0.0.1:8642, Bearer)
                                     └──SQL──▶  Postgres (agents · tasks · calendar · KB · costs)
```

**Why a BFF?** The hermes API grants the agent's *full toolset, including terminal
commands*. Its Bearer key must never reach the browser, and the gateway must not be
exposed publicly unauthenticated. The BFF holds the key server-side, adds CORS control,
and blends hermes data with our own Postgres for the screens hermes can't back.

Hermes is an **agent harness** (isolated sub-agents · self-improving skills ·
cross-session memory · pluggable Tools+MCP) driving any model. So the mapping is:

| Screen | Backed by |
|---|---|
| Conversations | hermes `/v1/chat/completions` (SSE stream) + sessions |
| System Monitor | hermes health + runs events; host gauges; seeded ledger/logs |
| Workflows | hermes Jobs API (`/api/jobs`, run/pause/resume) |
| Tools & Skills | Postgres toggles + hermes `/v1/toolsets` & `/v1/skills` |
| AI Core | hermes `/v1/models` (list) + Postgres provider/toggle state |
| Memory | Postgres facts/cost + hermes `/api/sessions` (recent convos) |
| Agents (roster + Builder) | Postgres orchestration config + hermes `/v1/runs` |
| Command Center | blend of the above |
| Tasks · Calendar · Knowledge Base | Postgres (hermes has no equivalent) |

Every screen renders instantly from a built-in seed fallback and **upgrades to live data**
when the BFF (and, where relevant, hermes) is reachable.

---

## Prerequisites

- **Node 20+**
- **Postgres 14+** (local, on the VPS, or managed)
- A running **hermes-agent** gateway (optional for the UI — screens work with seeded data
  and chat falls back to a canned reply when hermes is offline; required for live agent
  responses). See below.

## Setup

```bash
cp .env.example .env      # then edit — see "Configuration"
npm install               # installs all workspaces
npm run db:migrate        # create tables
npm run db:seed           # load the demo data (mirrors the prototype exactly)
```

## Run (dev)

```bash
npm run dev               # BFF (:8787) + web (:5173) together
# or individually:
npm run dev:bff
npm run dev:web
```

Open http://localhost:5173.

## Build & serve (prod)

```bash
npm run build             # typechecks + builds shared, bff, web
npm --workspace=@jarvis/bff run start   # runs the BFF via tsx
# serve apps/web/dist as static files behind your proxy
```

---

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `PORT` | BFF port (default 8787) |
| `WEB_ORIGIN` | Allowed browser origin(s) for CORS, comma-separated |
| `HERMES_BASE_URL` | hermes gateway URL — prefer `http://127.0.0.1:8642` (co-located) or HTTPS behind Traefik |
| `HERMES_API_KEY` | Bearer token = `API_SERVER_KEY` from `~/.hermes/.env` on the VPS |
| `HERMES_SESSION_KEY` | Stable per-operator key → hermes long-term memory (`X-Hermes-Session-Key`) |
| `HERMES_MODEL` | Model id advertised by hermes (cosmetic; server-side config picks the real LLM) |
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_SSL` | `true` if your managed Postgres requires TLS |
| `VITE_API_BASE` | URL the browser uses to reach the BFF |

### Enabling hermes on the VPS

In `~/.hermes/.env` on the Hostinger VPS:

```
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
API_SERVER_HOST=127.0.0.1
API_SERVER_KEY=<a-strong-secret>          # put the same value in this repo's HERMES_API_KEY
```

Then run the gateway (`hermes gateway`). **Do not** bind it to a public interface or open
8642 to the internet — run the BFF on the same VPS and reach hermes over loopback, or put
hermes behind an authenticated TLS reverse proxy.

> **Provider keys** (Groq/OpenAI/Anthropic/…) live in `~/.hermes/.env` + `config.yaml` on
> the VPS and are **not** writable over the HTTP API. The AI Core screen lists models
> (`/v1/models`) and records connection *intent*; set the actual keys on the box.

---

## Deployment notes

- **Co-locate the BFF with hermes** on the VPS so the Bearer key stays on loopback.
- Serve `apps/web/dist` as static assets (Nginx/Traefik/Caddy). Set `VITE_API_BASE` to the
  BFF's public URL (or same-origin behind a path prefix) and add that origin to `WEB_ORIGIN`.
- Point `DATABASE_URL` at Postgres on the VPS (or a managed instance; set `DATABASE_SSL=true`).
- Single-operator by design (no login yet) — every request threads one `HERMES_SESSION_KEY`.
  Add auth + per-user session keys when you go multi-user.

## API surface (BFF)

`GET /api/health` · `GET|POST|DELETE /api/agents` · `GET /api/agents/runs|runtime` ·
`GET|POST|PATCH|DELETE /api/tasks` · `GET|POST|DELETE /api/calendar/reminders` ·
`GET /api/calendar/time` · `GET /api/memory/vector-store|cost|facts|conversations` ·
`GET|POST|DELETE /api/knowledge/sources` · `GET /api/knowledge/collections|stats` ·
`GET|PATCH /api/tools` · `GET /api/workflows|/runs|/stats` · `POST /api/workflows/:id/:action` ·
`GET|PATCH /api/aicore` · `GET /api/system/gauges|ledger|slow-turns|logs|health` ·
`GET /api/command/feed` · `POST /api/chat` · `POST /api/chat/stream` (SSE)
